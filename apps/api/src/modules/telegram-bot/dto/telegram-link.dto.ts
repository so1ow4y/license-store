import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Тело запроса на выпуск кода привязки.
 *
 * ВАЖНО для журналов: поле totpCode обязано попасть в REDACTED_FIELD_NAMES
 * (common/audit/audit.service.ts) и в redact.paths логгера. Эндпоинт помечен
 * @Audit, а интерцептор кладёт в снимок ВСЁ тело запроса целиком — без
 * цензора действующий код второго фактора уехал бы в журнал, который
 * хранится годами и просматривается людьми.
 */
export class InitTelegramLinkDto {
  @ApiPropertyOptional({
    description:
      'Код второго фактора либо код восстановления. Обязателен, если 2FA включена, ' +
      'и всегда — для области ADMIN.',
    example: '123456',
  })
  @IsOptional()
  @IsString()
  // Шесть цифр — TOTP; строка с дефисами — код восстановления
  // (A1B2C3D4-E5F6G7H8). Формат проверяется здесь, чтобы заведомо негодный
  // ввод не доходил до расшифровки секрета и перебора десяти хешей.
  @Matches(/^\d{6}$|^[A-Za-z0-9-]{8,32}$/, {
    message: 'Код должен быть шестизначным либо кодом восстановления',
  })
  @MaxLength(32)
  totpCode?: string;

  @ApiPropertyOptional({
    description:
      'Область привязки. ADMIN доступна только обладателю права на выпуск лицензий ' +
      'и живёт 30 дней вместо 90.',
    enum: ['USER', 'ADMIN'],
    default: 'USER',
  })
  @IsOptional()
  @IsIn(['USER', 'ADMIN'], { message: 'Область может быть только USER или ADMIN' })
  scope?: 'USER' | 'ADMIN';
}

/**
 * Ответ на выпуск кода. Существует ради Swagger, в рантайме не используется —
 * так же, как TokenPairDto в модуле auth.
 */
export class TelegramLinkInitDto {
  @ApiProperty({
    description:
      'Одноразовый токен, 43 символа base64url. В БД хранится только его SHA-256; ' +
      'повторно получить это значение нельзя.',
  })
  token!: string;

  @ApiProperty({ description: 'Готовая ссылка вида https://t.me/<bot>?start=<token>' })
  deepLink!: string;

  @ApiProperty({ description: 'Срок действия токена — 10 минут от выпуска' })
  expiresAt!: Date;
}

/** Состояние привязки для кабинета. */
export class TelegramLinkStateDto {
  @ApiProperty() linked!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Кэш @username ТОЛЬКО для показа. Идентификатором связи не является.',
  })
  username!: string | null;

  @ApiProperty({ nullable: true }) linkedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'Срок привязки: 90 дней для USER, 30 для ADMIN. Молчаливого продления нет.',
  })
  expiresAt!: Date | null;

  @ApiProperty({ nullable: true, enum: ['USER', 'ADMIN'] })
  scope!: 'USER' | 'ADMIN' | null;

  @ApiProperty({
    description:
      'Пользователь заблокировал бота в Telegram. Связь цела, доставка временно ' +
      'невозможна; снимается первым же сообщением боту.',
  })
  chatBlocked!: boolean;
}
