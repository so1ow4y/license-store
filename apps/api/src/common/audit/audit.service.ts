import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '../prisma/prisma.service';
import { currentRequest } from '../request-context/request-context';

/**
 * Журнал аудита (ТЗ п.8, раздел «Логи»).
 *
 * Две особенности, обе намеренные.
 *
 * Записи НЕ имеют внешних ключей на актора и объект: журнал обязан
 * пережить удаление того, о ком он написан. Целостность обеспечивается
 * приложением, а не базой.
 *
 * actorLabel денормализован — сохраняется подпись актора на момент
 * действия. Если роль потом сменили или сотрудника удалили, журнал
 * остаётся правдивым: в нём написано, КЕМ человек был тогда.
 */

/**
 * Поля, которые вырезаются из снимков before/after.
 *
 * Список избыточен намеренно: журнал хранится годами и просматривается
 * людьми, поэтому дешевле замаскировать лишнее, чем однажды обнаружить
 * в нём хеш пароля или секрет двухфакторной аутентификации.
 *
 * Список — ЗАПРЕТИТЕЛЬНЫЙ, а не разрешительный, и это осознанный размен.
 * Разрешительный (белый список полей на каждый @Audit) не пропустил бы
 * ничего лишнего, но стоил бы правки в двадцати с лишним контроллерах и
 * молча терял бы полезные поля при каждом новом DTO. Цена выбранного
 * варианта — новое секретное имя поля надо не забыть дописать СЮДА;
 * поэтому имена перечислены с запасом, включая ещё не существующие.
 *
 * Сравнение регистронезависимое (см. REDACTED_FIELDS ниже): 'diskId' и
 * 'DiskID' — одно и то же поле, а различать их означало бы поставить
 * защиту журнала в зависимость от того, как кто-то назвал свойство DTO.
 * Подчёркивание регистр не убирает, поэтому snake_case-варианты
 * перечислены отдельно.
 */
const REDACTED_FIELD_NAMES = [
  // Пароли
  'password',
  'passwordHash',
  'password_hash',
  'newPassword',
  'currentPassword',
  'oldPassword',
  // Токены и сессии
  'token',
  'tokenHash',
  'token_hash',
  'refreshToken',
  'accessToken',
  'access_token',
  'challengeToken',
  'sessionKey',
  'session_key',
  'sessionKeyHex',
  // Секреты
  'secret',
  'clientSecret',
  'client_secret',
  'signingSecret',
  'signingSecretEnc',
  'signing_secret_enc',
  'twoFactorSecretEnc',
  'two_factor_secret_enc',
  'accessKeyId',
  'secretAccessKey',
  'credentials',
  // Одноразовые коды и коды восстановления
  'code',
  'codes',
  'twoFactorCode',
  'recoveryCodes',
  'recovery_codes',
  'twoFactorRecoveryCodes',
  'two_factor_recovery_codes',
  // HWID. Сырой Disk ID по ТЗ п.7 не показывается даже владельцу лицензии,
  // а из него тривиально считается hwid_hash (HMAC на стороне сервера) —
  // то есть строка аудита с diskId обходит всю схему «в базе только хеш и
  // шифротекст». Хеш маскируется вместе с сырым значением: он и есть тот
  // самый идентификатор машины, ради сокрытия которого схема заведена.
  'diskId',
  'disk_id',
  'hwid',
  'hwidEnc',
  'hwid_enc',
  'hwidHash',
  'hwid_hash',
  'newHwidHash',
  'oldHwidHash',
  // Ключи
  'keyHash',
  'key_hash',
  'apiKey',
  'api_key',
  'licenseKey',
  'license_key',
  // Telegram-бот. totpCode обязателен и стоит первым: POST
  // /auth/telegram/link/init помечен @Audit, а интерцептор кладёт в after
  // ВСЁ тело запроса — без цензора действующий код 2FA лёг бы в журнал,
  // который хранится годами и читается службой поддержки.
  //
  // linkToken/codeHash — сам токен привязки и его хеш: предъявитель токена
  // получает чужой аккаунт в чате, а хеш достаточен для сверки перебором
  // по короткому алфавиту, если формат когда-нибудь сузят.
  //
  // Слово 'key' в этот список не добавляется и добавлено быть не может:
  // оно слишком общее и вырезало бы, например, settings.key — то есть
  // сделало бы половину журнала настроек нечитаемой.
  'totpCode',
  'totp_code',
  'linkToken',
  'link_token',
  'codeHash',
  'code_hash',
  'uniqueCode',
  'unique_code',
  'registrationKey',
  'registration_key',
  'webhookSecret',
  'webhook_secret',
];

const REDACTED_FIELDS = new Set(REDACTED_FIELD_NAMES.map((name) => name.toLowerCase()));

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  actorType: ActorType;
  actorLabel?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Запись в журнал.
   *
   * НЕ бросает при ошибке. Провал записи в журнал не должен отменять
   * бизнес-операцию: потерянная строка аудита хуже, чем ничего,
   * но не настолько, чтобы из-за неё отваливалась выдача лицензии.
   * Сама ошибка при этом уходит в лог приложения.
   */
  async record(entry: AuditEntry): Promise<void> {
    // Не переданные явно IP, браузер и ID запроса берутся из текущего запроса:
    // без адреса журнал бесполезен для расследований.
    const request = currentRequest();
    try {
      await this.prisma.auditLog.create({
        data: {
          id: uuidv7(),
          actorId: entry.actorId ?? null,
          actorType: entry.actorType,
          actorLabel: entry.actorLabel ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          before: this.redact(entry.before) as never,
          after: this.redact(entry.after) as never,
          ip: entry.ip ?? request?.ip ?? null,
          userAgent: entry.userAgent ?? request?.userAgent ?? null,
          requestId: entry.requestId ?? request?.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `не удалось записать аудит ${entry.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Рекурсивная маскировка секретов.
   *
   * Обходит вложенные объекты и массивы: секрет может лежать не только
   * на верхнем уровне, но и внутри снимка связанной сущности. Тело
   * запроса из AuditInterceptor приходит сюда целиком, поэтому маскировка
   * обязана быть рекурсивной: `{"device": {"diskId": "..."}}` — такой же
   * запрос, как и плоский, и разница видна только здесь.
   */
  private redact(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return null;

    // Ограничение глубины — защита от циклических ссылок и от снимков,
    // которые тянут за собой пол-базы через include.
    if (depth > 6) return '[глубина превышена]';

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, depth + 1));
    }

    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'object') return value;

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_FIELDS.has(key.toLowerCase())
        ? '[REDACTED]'
        : this.redact(item, depth + 1);
    }
    return result;
  }
}
