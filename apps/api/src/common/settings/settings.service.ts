import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { Env } from '../config/env.schema';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Настройки платформы: значения из таблицы settings с кэшем в памяти.
 *
 * Цепочка разрешения значения — БД, затем окружение, затем умолчание в коде.
 * Это даёт админке возможность менять лимиты и параметры без передеплоя
 * (ТЗ п.8, раздел «Настройки»), но не требует, чтобы каждая настройка
 * обязательно присутствовала в БД.
 *
 * Кэш держится в памяти процесса, а не в Redis: настройки читаются почти
 * на каждом запросе и меняются редко, поэтому сетевой round-trip здесь
 * лишний. Redis используется для другого — рассылки инвалидации остальным
 * репликам, чтобы правка в админке применялась сразу на всех, а не через TTL.
 */

/** Канал pub/sub для оповещения реплик об изменении настройки. */
const INVALIDATION_CHANNEL = 'settings:invalidate';

/**
 * Страховка на случай, если сообщение об инвалидации потерялось —
 * например, реплика в этот момент переподключалась к Redis.
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  loadedAt: number;
}

@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private subscriber?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadAll();

    // Отдельное соединение: клиент ioredis в режиме подписки не может
    // выполнять обычные команды, поэтому основной переиспользовать нельзя.
    this.subscriber = this.redis.client.duplicate();
    await this.subscriber.subscribe(INVALIDATION_CHANNEL);
    this.subscriber.on('message', (_channel, key) => {
      if (key === '*') {
        void this.reloadAll();
      } else {
        this.cache.delete(key);
      }
    });

    this.logger.log(`загружено настроек: ${this.cache.size}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }

  /**
   * Значение настройки. Порядок разрешения: кэш → БД → окружение → умолчание.
   *
   * Секретные значения (is_secret) расшифровываются прозрачно.
   */
  async get<T>(key: string, fallback?: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.value as T;
    }

    const row = await this.prisma.setting.findUnique({ where: { key } });

    // Строка-заготовка не считается значением.
    //
    // Сид создаёт секретные настройки с пустым значением как ПЛЕЙСХОЛДЕРЫ
    // (digiseller.api_key, telegram.bot_token, discord.client_secret и др.,
    // см. prisma/seed.ts). Раз строка существует, прежний код возвращал ''
    // и до окружения не доходил НИКОГДА — то есть заполнить такой секрет
    // было физически негде: админского эндпоинта настроек нет, а SQL'ем в
    // is_secret надо класть шифротекст, которого руками не получить.
    // Человек вписывал ключ в .env, сервис молча продолжал видеть пустоту,
    // и выяснялось это на первой реальной покупке.
    //
    // Пустая строка ⇒ «не настроено» ⇒ идём дальше по цепочке. Заполненная
    // строка в БД по-прежнему главнее окружения: смысл настроек в том, что
    // их меняют без передеплоя.
    if (row && !this.isPlaceholder(row.value)) {
      // row.id обязателен для AAD: шифротекст привязан к конкретной строке,
      // и без её идентификатора расшифровка не пройдёт.
      const value = row.isSecret
        ? this.safeDecryptSecret(row.key, row.id, row.value)
        : (row.value as T);
      this.cache.set(key, { value, loadedAt: Date.now() });
      return value as T;
    }

    // В БД нет — пробуем окружение. Ключ настройки переводится в имя
    // переменной: security.argon2.memory_kib → SECURITY_ARGON2_MEMORY_KIB.
    const envValue = process.env[key.replace(/\./g, '_').toUpperCase()];
    if (envValue !== undefined) {
      const parsed = this.coerce(envValue) as T;
      this.cache.set(key, { value: parsed, loadedAt: Date.now() });
      return parsed;
    }

    if (fallback !== undefined) {
      this.cache.set(key, { value: fallback, loadedAt: Date.now() });
      return fallback;
    }

    throw new NotFoundException(`настройка ${key} не найдена и не имеет значения по умолчанию`);
  }

  async getNumber(key: string, fallback?: number): Promise<number> {
    const value = await this.get<unknown>(key, fallback);
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new NotFoundException(`настройка ${key} не является числом: ${String(value)}`);
    }
    return num;
  }

  async getBoolean(key: string, fallback?: boolean): Promise<boolean> {
    const value = await this.get<unknown>(key, fallback);
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === 1 || value === '1';
  }

  async getString(key: string, fallback?: string): Promise<string> {
    const value = await this.get<unknown>(key, fallback);
    return typeof value === 'string' ? value : String(value);
  }

  /**
   * Изменение настройки. Шифрует секреты, обновляет БД и оповещает
   * остальные реплики.
   */
  async set(key: string, value: unknown, updatedById?: string): Promise<void> {
    const existing = await this.prisma.setting.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`настройка ${key} не существует`);
    }

    const stored = existing.isSecret
      ? this.crypto.encrypt(String(value), {
          table: 'settings',
          column: 'value',
          rowId: existing.id,
        })
      : value;

    await this.prisma.setting.update({
      where: { key },
      data: { value: stored as never, updatedById: updatedById ?? null },
    });

    this.cache.delete(key);
    // Публикуем ПОСЛЕ коммита: иначе другая реплика успеет перечитать
    // старое значение и закэшировать его заново.
    await this.redis.client.publish(INVALIDATION_CHANNEL, key);
  }

  /**
   * Полная перезагрузка кэша. Настроек порядка полусотни, поэтому дешевле
   * загрузить всё разом, чем ходить в БД за каждым ключом.
   */
  async reloadAll(): Promise<void> {
    const rows = await this.prisma.setting.findMany();
    this.cache.clear();

    for (const row of rows) {
      // Заготовки в кэш НЕ кладём. get() смотрит кэш первым, поэтому
      // положенная сюда пустая строка перекрыла бы разрешение через
      // окружение раз и навсегда — и правка приоритета в get() не
      // отработала бы ни разу.
      if (this.isPlaceholder(row.value)) continue;

      const value = row.isSecret
        ? this.safeDecryptSecret(row.key, row.id, row.value as unknown as string)
        : row.value;
      this.cache.set(row.key, { value, loadedAt: Date.now() });
    }
  }

  /** Сброс кэша на всех репликах. Для админского действия «перечитать настройки». */
  async invalidateAll(): Promise<void> {
    await this.reloadAll();
    await this.redis.client.publish(INVALIDATION_CHANNEL, '*');
  }

  /**
   * Строка в БД есть, но значения в ней нет — заготовка от сида.
   *
   * Пустая строка и null, а НЕ любое ложное значение: 0 и false — законные
   * значения настроек (например, отключённый флаг), и трактовать их как
   * «не настроено» значило бы молча подменять выключенное на умолчание,
   * которое обычно включено.
   */
  private isPlaceholder(raw: unknown): boolean {
    return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  }

  /**
   * Расшифровка секрета при массовой загрузке. Ошибку не пробрасываем:
   * один нерасшифровываемый секрет не должен мешать старту приложения,
   * иначе неудачная ротация ключа кладёт весь сервис.
   */
  private safeDecryptSecret(key: string, rowId: string, raw: unknown): unknown {
    if (typeof raw !== 'string' || raw.length === 0) return raw;
    try {
      return this.crypto.decrypt(raw, { table: 'settings', column: 'value', rowId });
    } catch (error) {
      this.logger.error(
        `не удалось расшифровать настройку ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** Приведение строки из окружения к числу или булеву, если это они. */
  private coerce(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const num = Number(raw);
    return Number.isFinite(num) && raw.trim() !== '' ? num : raw;
  }
}
