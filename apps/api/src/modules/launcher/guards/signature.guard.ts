import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AntiFraudSeverity, AntiFraudType } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';

import { CryptoService } from '@common/crypto/crypto.service';
import { SignatureService, type SignatureFailure } from '@common/crypto/signature.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';

/**
 * Проверка подписи запросов загрузчика (ТЗ п.14).
 *
 * TLS защищает канал, но не отвечает на вопрос «этот запрос действительно
 * сформировала наша сборка». На своей машине пользователь может подставить
 * корневой сертификат и читать весь трафик. Подпись привязывает запрос
 * к секрету ключа API, а метка времени и nonce — к моменту.
 *
 * Секрет один на сборку и поставляется с загрузчиком (уточнение в §3.5
 * TZ-LAUNCHER). Он извлекаем из бинарника — это данность, а не недосмотр:
 * задача подписи в том, чтобы сервер отличал свою сборку от произвольного
 * HTTP-клиента и мог отозвать скомпрометированный ключ, не трогая остальных.
 */

/**
 * Кэш ключей API: экономит запрос в Postgres на каждом запросе загрузчика.
 *
 * Имя ключа — контракт с ApiKeyService.revoke(), которая при отзыве делает
 * DEL `apikey:<prefix>`. Поменять префикс здесь и не поменять там — значит
 * тихо сломать немедленность отзыва: отозванная сборка проживёт ещё до конца
 * TTL. Это проверяет scripts/smoke-launcher.ps1 («отозванный ключ перестал
 * работать СРАЗУ»).
 */
const KEY_CACHE_PREFIX = 'apikey:';
const KEY_CACHE_TTL_SEC = 300;

export interface LauncherApiKey {
  id: string;
  prefix: string;
  scopes: string[];
}

/**
 * Запись кэша ключа.
 *
 * Секрет лежит ШИФРОТЕКСТОМ — ровно тем конвертом AES-GCM, что и в колонке
 * api_keys.signing_secret_enc. Обоснование и границы этого решения —
 * в комментарии к resolveSecret().
 */
interface CachedApiKey {
  id: string;
  /** Конверт из api_keys.signing_secret_enc, как есть. Открытого секрета здесь нет. */
  secretEnc: string;
  scopes: string[];
  /** Срок действия ключа в мс эпохи; null — бессрочный. */
  expiresAt: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: LauncherApiKey;
  }
}

@Injectable()
export class SignatureGuard implements CanActivate {
  private readonly logger = new Logger(SignatureGuard.name);

  constructor(
    private readonly signature: SignatureService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const prefix = this.header(request, 'x-api-key');
    const timestamp = this.header(request, 'x-timestamp');
    const nonce = this.header(request, 'x-nonce');
    const signatureValue = this.header(request, 'x-signature');

    if (!prefix || !timestamp || !nonce || !signatureValue) {
      throw this.fail('MISSING_HEADERS');
    }

    const secret = await this.resolveSecret(prefix);
    if (!secret) {
      // Неизвестный или отозванный ключ. Различать эти случаи наружу
      // не нужно — обе ситуации для клиента означают «обнови сборку».
      throw this.fail('BAD_SIGNATURE');
    }

    // Сырое тело нужно ровно в том виде, в каком оно пришло: подпись
    // считается по его хешу, а повторная сериализация разобранного JSON
    // может дать другие байты — другой порядок ключей, другие пробелы.
    const rawBody = this.rawBody(request);

    const result = await this.signature.verify(
      {
        method: request.method,
        path: this.pathOf(request),
        timestamp,
        nonce,
        signature: signatureValue,
        rawBody,
      },
      secret.signingSecret,
    );

    if (!result.ok) {
      await this.recordFraudEvent(result.reason, secret.id, request);
      throw this.fail(result.reason);
    }

    request.apiKey = { id: secret.id, prefix, scopes: secret.scopes };

    // Отметка использования нужна для админки — какие сборки ещё живы.
    // Пишется без ожидания: на горячем пути лишний запрос ни к чему.
    void this.prisma.apiKey
      .update({
        where: { id: secret.id },
        data: { lastUsedAt: new Date(), lastUsedIp: request.ip ?? null },
      })
      .catch(() => undefined);

    return true;
  }

  /**
   * Секрет подписи по префиксу ключа.
   *
   * В Redis уходит ШИФРОТЕКСТ, а не открытый секрет, и расшифровка идёт
   * на каждое попадание. Раньше здесь кэшировался открытый секрет, и это
   * обнуляло шифрование колонки целиком: Redis работает с appendonly yes,
   * каждый SET дописывался в AOF, и на диске накопились секреты подписи ВСЕХ
   * сборок в открытом виде (на стенде — 15 разных). Срок жизни такой утечки —
   * не 300 секунд TTL, а срок жизни файла AOF и его бэкапов.
   *
   * Чего эта правка НЕ делает, чтобы не создавать ложного чувства
   * защищённости: ключ шифрования лежит в ENCRYPTION_KEY на том же хосте.
   * Тот, кто получил и дамп Redis, и окружение процесса, восстановит секреты
   * ровно как раньше. Снимается ровно одно, но существенное: дамп Redis, том
   * redis_data и бэкапы этого тома перестают быть САМОДОСТАТОЧНЫМИ. Бэкапы
   * кэша ездят по другим маршрутам и с другими правами, чем бэкапы БД и
   * секреты окружения; покупается именно расхождение этих маршрутов.
   *
   * Цена — расшифровка AES-GCM на 32 байтах: единицы микросекунд против
   * сетевого RTT до Redis в том же вызове. Прежнее «расшифровка на каждый
   * запрос слишком дорога» никем не измерялось и расходится с порядком
   * величины на три знака.
   *
   * Почему не кэш в памяти процесса (как payload-cache.service.ts): он вообще
   * ничего не уносит на диск, но отзыв ключа доходит до кэша через DEL из
   * ApiKeyService.revoke(). В памяти воркера этот DEL не виден, и отозванная
   * сборка продолжила бы работать до конца TTL — либо пришлось бы заводить
   * pub/sub-инвалидацию, то есть вторую поверхность для рассинхронизации.
   * Немедленность отзыва дороже оставшейся разницы.
   */
  private async resolveSecret(
    prefix: string,
  ): Promise<{ id: string; signingSecret: string; scopes: string[] } | null> {
    const cacheKey = `${KEY_CACHE_PREFIX}${prefix}`;

    let record = await this.readCache(cacheKey);
    if (!record) {
      record = await this.loadKey(prefix);
      if (!record) return null;
      await this.writeCache(cacheKey, record);
    }

    // Срок проверяется НА ОБОИХ путях, а не только при промахе. Иначе ключ,
    // истёкший в течение TTL, работал бы до конца TTL по записи, положенной
    // ещё живым: отзыв кэш сбрасывает, а наступление даты — некому.
    if (record.expiresAt !== null && record.expiresAt < Date.now()) return null;

    // Ошибка расшифровки здесь — не клиентский случай, а наша авария
    // конфигурации (версия ключа выпала из связки, значение повреждено).
    // CryptoService.decrypt бросает 500 с внятной строкой, и это правильнее
    // тихого 403: 403 клиент трактует как «обнови сборку» и уйдёт чинить
    // не то.
    const signingSecret = this.crypto.decrypt(record.secretEnc, {
      table: 'api_keys',
      column: 'signing_secret_enc',
      rowId: record.id,
    });

    return { id: record.id, signingSecret, scopes: record.scopes };
  }

  /** Запись ключа из Postgres. null — ключа нет, он отозван или без секрета. */
  private async loadKey(prefix: string): Promise<CachedApiKey | null> {
    const key = await this.prisma.apiKey.findUnique({ where: { prefix } });
    if (!key || key.revokedAt || !key.signingSecretEnc) return null;

    return {
      id: key.id,
      secretEnc: key.signingSecretEnc,
      scopes: key.scopes,
      expiresAt: key.expiresAt?.getTime() ?? null,
    };
  }

  /**
   * Чтение записи кэша.
   *
   * Любая невнятица трактуется как промах: запись просто перезапишется
   * из Postgres. В частности так же отрабатывают записи ПРЕЖНЕГО формата
   * (с полем signingSecret в открытом виде) — они переживают выкладку до
   * конца своего TTL, но по форме не подходят, и отдельная миграция кэша
   * не нужна. Уже лежащие на диске открытые секреты этим, разумеется, не
   * стираются — том redis_data и его бэкапы надо чистить руками.
   */
  private async readCache(cacheKey: string): Promise<CachedApiKey | null> {
    let raw: string | null;
    try {
      raw = await this.redis.client.get(cacheKey);
    } catch (error) {
      // Redis здесь — кэш, а не источник истины. Его недоступность не должна
      // класть весь горячий путь загрузчика: деградируем к Postgres.
      this.logger.warn(
        `кэш ключей API недоступен, читаем Postgres: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<CachedApiKey>;
      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.secretEnc !== 'string' ||
        !Array.isArray(parsed.scopes) ||
        !(parsed.expiresAt === null || typeof parsed.expiresAt === 'number')
      ) {
        return null;
      }

      return {
        id: parsed.id,
        secretEnc: parsed.secretEnc,
        scopes: parsed.scopes,
        expiresAt: parsed.expiresAt,
      };
    } catch {
      return null;
    }
  }

  /** Запись в кэш. Промах кэша дешевле отказа в проверке подписи. */
  private async writeCache(cacheKey: string, record: CachedApiKey): Promise<void> {
    try {
      await this.redis.client.set(cacheKey, JSON.stringify(record), 'EX', KEY_CACHE_TTL_SEC);
    } catch (error) {
      this.logger.warn(
        `не удалось положить ключ API в кэш: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Путь для подписи.
   *
   * Берётся ПОЛНЫЙ путь без query-строки — ровно то, что описано
   * в TZ-LAUNCHER §3.1 и заложено в контрольные векторы. Расхождение
   * здесь даёт SIGNATURE_INVALID на первом же запросе.
   */
  private pathOf(request: FastifyRequest): string {
    const url = request.url;
    const q = url.indexOf('?');
    return q === -1 ? url : url.slice(0, q);
  }

  /**
   * Сырое тело запроса ровно в том виде, в каком оно пришло.
   *
   * Сохраняется разборщиком content-type в main.ts. Пересобирать его
   * из разобранного объекта нельзя: клиент подписывает байты на проводе,
   * и повторная сериализация даёт другую строку при ином порядке ключей
   * или экранировании.
   */
  private rawBody(request: FastifyRequest): string {
    return (request as unknown as { rawBody?: string }).rawBody ?? '';
  }

  private header(request: FastifyRequest, name: string): string | null {
    const value = request.headers[name];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /**
   * Событие антифрода на неудачную проверку подписи.
   *
   * Пишется только для содержательных отказов: отсутствие заголовков —
   * это обычно кривой клиент, а вот неверная подпись или повтор означают
   * либо подделку, либо переигрывание перехваченного запроса.
   */
  private async recordFraudEvent(
    reason: SignatureFailure,
    apiKeyId: string,
    request: FastifyRequest,
  ): Promise<void> {
    if (reason !== 'BAD_SIGNATURE' && reason !== 'REPLAY') return;

    try {
      await this.prisma.antiFraudEvent.create({
        data: {
          id: uuidv7(),
          type: reason === 'REPLAY' ? AntiFraudType.REPLAY_ATTEMPT : AntiFraudType.SIGNATURE_MISMATCH,
          severity: AntiFraudSeverity.HIGH,
          ip: request.ip ?? null,
          details: { apiKeyId, path: this.pathOf(request), method: request.method },
          actionTaken: 'logged_only',
        },
      });
    } catch (error) {
      this.logger.error(
        `не удалось записать событие антифрода: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Отказ по подписи.
   *
   * Статус 403, а НЕ 401 — так зафиксировано в TZ-LAUNCHER, приложение Б,
   * и по этому документу пишется клиент. Разница содержательная: 401
   * означает «представься», и загрузчик на него пойдёт обновлять токен,
   * что подписи не починит. 403 означает «представился, но так нельзя».
   */
  private fail(reason: SignatureFailure): ForbiddenException {
    const map: Record<SignatureFailure, { code: string; message: string }> = {
      MISSING_HEADERS: { code: 'SIGNATURE_MISSING', message: 'Отсутствуют заголовки подписи' },
      BAD_TIMESTAMP: { code: 'SIGNATURE_INVALID', message: 'Некорректная метка времени' },
      EXPIRED: {
        code: 'SIGNATURE_EXPIRED',
        message: 'Метка времени вне допустимого окна. Проверьте системное время.',
      },
      REPLAY: { code: 'REPLAY', message: 'Запрос уже был обработан' },
      BAD_SIGNATURE: { code: 'SIGNATURE_INVALID', message: 'Подпись запроса неверна' },
    };

    const { code, message } = map[reason];
    return new ForbiddenException({ code, message });
  }
}
