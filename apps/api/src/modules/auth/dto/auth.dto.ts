import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Ограничения длины дублируют проверки в PasswordService намеренно.
 *
 * ValidationPipe отсекает заведомо негодный ввод до того, как запрос
 * дойдёт до Argon2: хеширование стоит около 70 мс процессорного времени,
 * и тратить их на строку в мегабайт — готовый способ положить сервер.
 */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export class RegisterDto {
  @ApiProperty({ example: 'player@example.com' })
  @IsEmail({}, { message: 'Некорректный адрес электронной почты' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'player' })
  @IsString()
  @Length(3, 32)
  // Латиница, цифры, подчёркивание и дефис. Кириллица в логине запрещена
  // намеренно: визуально неотличимые символы (а/a, о/o, е/e) дают
  // тривиальную подмену аккаунта при обращении в поддержку.
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Логин может содержать только латиницу, цифры, дефис и подчёркивание',
  })
  username!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль короче ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX, { message: `Пароль длиннее ${PASSWORD_MAX} символов` })
  password!: string;

  @ApiPropertyOptional({ example: 'ru' })
  @IsOptional()
  @IsString()
  @Length(2, 8)
  locale?: string;
}

export class ChangeUsernameDto {
  @ApiProperty({ example: 'new_nick' })
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Логин может содержать только латиницу, цифры, дефис и подчёркивание',
  })
  username!: string;

  @ApiProperty({ description: 'Текущий пароль — подтверждение, что меняет владелец' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ChangeEmailDto {
  @ApiProperty({ example: 'new@example.com' })
  @IsEmail({}, { message: 'Некорректный адрес электронной почты' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ description: 'Текущий пароль' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ description: 'Email или логин', example: 'player@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  login!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiPropertyOptional({
    description: 'Нормализованный Disk ID. Передаётся загрузчиком, из браузера не приходит.',
    example: 'WD-WCC4N1234567',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  hwid?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class TwoFactorVerifyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  challengeToken!: string;

  @ApiProperty({
    description: 'Шесть цифр из приложения либо код восстановления',
    example: '123456',
  })
  @IsString()
  // Верхняя граница рассчитана на код восстановления вида A1B2C3D4-E5F6G7H8.
  @Length(6, 20)
  code!: string;
}

export class PasswordResetRequestDto {
  @ApiProperty({ example: 'player@example.com' })
  @IsEmail({}, { message: 'Некорректный адрес электронной почты' })
  @MaxLength(255)
  email!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'player@example.com' })
  @IsEmail({}, { message: 'Некорректный адрес электронной почты' })
  @MaxLength(255)
  email!: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty({ description: 'Токен из письма' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль короче ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX, { message: `Пароль длиннее ${PASSWORD_MAX} символов` })
  newPassword!: string;

  @ApiPropertyOptional({
    description:
      'Обязателен, если включён второй фактор. Без него доступ к почте обходил бы 2FA целиком.',
    example: '123456',
  })
  @IsOptional()
  @IsString()
  @Length(6, 20)
  twoFactorCode?: string;
}

export class PasswordChangeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль короче ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX, { message: `Пароль длиннее ${PASSWORD_MAX} символов` })
  newPassword!: string;
}

export class RegisterWithKeyDto {
  @ApiProperty({ example: 'ACDE-FGHJ-KMNP-QRTU' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'player' })
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Логин может содержать только латиницу, цифры, дефис и подчёркивание',
  })
  username!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль короче ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX, { message: `Пароль длиннее ${PASSWORD_MAX} символов` })
  password!: string;

  @ApiPropertyOptional({ description: 'Необязателен: ключ уже подтверждает право на доступ' })
  @IsOptional()
  @IsEmail({}, { message: 'Некорректный адрес электронной почты' })
  @MaxLength(255)
  email?: string;
}

export class RedeemKeyDto {
  @ApiProperty({ example: 'ACDE-FGHJ-KMNP-QRTU' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}

export class IssueKeysDto {
  @ApiProperty({ minimum: 1, maximum: 500, example: 10 })
  @IsInt()
  @Min(1)
  @Max(500)
  count!: number;

  @ApiPropertyOptional({ description: 'Указывается вместе с planId' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Указывается вместе с productId' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ description: 'Срок действия самого ключа, ISO 8601' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}


export class CreateApiKeyDto {
  @ApiProperty({ example: 'Griloder Windows 1.x' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiPropertyOptional({ type: [String], description: 'Список permission.slug' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Срок действия ключа, ISO 8601' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
export class PasswordSetDto {
  @ApiProperty({
    description: 'Первый пароль для аккаунта, созданного через Discord или Telegram',
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
  })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Пароль короче ${PASSWORD_MIN} символов` })
  @MaxLength(PASSWORD_MAX, { message: `Пароль длиннее ${PASSWORD_MAX} символов` })
  password!: string;
}

export class DiscordCallbackDto {
  @ApiProperty({ description: 'Код авторизации от Discord' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;

  @ApiProperty({ description: 'Значение state из /auth/discord/url' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  state!: string;
}

/**
 * Полезная нагрузка от Telegram Login Widget.
 *
 * Поля приходят как есть, в snake_case — это формат Telegram, менять его
 * нельзя: подпись считается ровно по этим именам, и любое переименование
 * до проверки сломает сверку.
 */
export class TelegramCallbackDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  photo_url?: string;

  @ApiProperty({ description: 'unix-время в секундах' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  auth_date!: string;

  @ApiProperty({ description: 'HMAC-SHA256 от данных, ключ производный от токена бота' })
  @IsString()
  @Length(64, 64)
  hash!: string;
}

export class TwoFactorEnableDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class TwoFactorDisableDto {
  @ApiProperty({ description: 'Требуется вместе с кодом' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 20)
  code!: string;
}

export class TwoFactorSetupDto {
  @ApiProperty({ description: 'Секрет в base32 — для ручного ввода' })
  secret!: string;

  @ApiProperty({ description: 'otpauth://-ссылка для QR-кода' })
  uri!: string;
}

export class RecoveryCodesDto {
  @ApiProperty({
    type: [String],
    description: 'Показываются ОДИН раз. Повторно сервер их не отдаёт.',
  })
  recoveryCodes!: string[];
}

// ---------------------------------------------------------------------------
//  Ответы
// ---------------------------------------------------------------------------

export class PublicUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty() locale!: string;
}

export class TokenPairDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Время жизни access-токена в секундах' }) expiresIn!: number;
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}

export class TwoFactorRequiredDto {
  @ApiProperty({ example: true }) twoFactorRequired!: true;
  @ApiProperty() challengeToken!: string;
  @ApiProperty() expiresIn!: number;
}
