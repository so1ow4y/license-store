import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';

/**
 * Redis несёт три роли, и все три критичны для требований ТЗ п.21:
 *
 *   1. Кэш проверки лицензии — держит ответ в бюджете 150 мс, не трогая
 *      Postgres на каждый запрос загрузчика.
 *   2. Счётчики онлайна — heartbeat'ы 1000 клиентов НЕ пишутся в БД,
 *      иначе это 1.44 млн строк в сутки.
 *   3. Счётчики rate limit и антифрода — короткоживущие, писать их
 *      в долговременное хранилище незачем.
 *
 * Ни одна из ролей не требует сохранности данных: всё восстанавливается
 * из Postgres. Поэтому политика вытеснения allkeys-lru в docker-compose
 * безопасна — при переполнении Redis выбросит старое, а не упадёт.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      // Не подключаемся в конструкторе: иначе ошибка соединения падает
      // до того, как поднимется логгер, и в выводе оказывается голый stack.
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      // Экспоненциальная задержка с потолком: при недоступности Redis
      // не забиваем сеть переподключениями.
      retryStrategy: (times) => Math.min(times * 200, 5000),
      enableOfflineQueue: true,
      connectTimeout: 5000,
    });

    this.client.on('error', (err) => {
      // Не бросаем: Redis — кэш, его падение не должно ронять API.
      // Деградируем к прямым запросам в Postgres.
      this.logger.error(`ошибка Redis: ${err.message}`);
    });

    this.client.on('reconnecting', () => this.logger.warn('переподключение к Redis'));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('соединение с Redis установлено');
  }

  async onModuleDestroy(): Promise<void> {
    // quit() дожидается завершения текущих команд, в отличие от disconnect().
    await this.client.quit();
    this.logger.log('соединение с Redis закрыто');
  }

  async ping(): Promise<void> {
    const res = await this.client.ping();
    if (res !== 'PONG') throw new Error(`неожиданный ответ Redis: ${res}`);
  }
}
