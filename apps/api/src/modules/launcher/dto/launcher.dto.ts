import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

import { IsLicenseKey } from './license-key';

const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;

export class CheckLicenseDto {
  @ApiProperty({ example: 'fc26' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productSlug!: string;

  @ApiProperty({
    description: 'Нормализованный Disk ID: без пробелов, в верхнем регистре',
    example: 'WD-WCC4N1234567',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  hwid!: string;

  @ApiProperty({ example: '1.4.2' })
  @IsString()
  @Matches(VERSION_RE, { message: 'Версия в формате major.minor.patch' })
  clientVersion!: string;

  /**
   * Единственное доказательство права на лицензию. Логина и пароля
   * загрузчик больше не спрашивает: ключ определяет и лицензию, и владельца.
   */
  @ApiProperty({ example: 'FC26-3HJ4-XUND-ETAZ-9877' })
  @IsLicenseKey()
  licenseKey!: string;
}

export class UpdateQueryDto {
  @ApiProperty({ example: 'fc26' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productSlug!: string;

  @ApiProperty({ example: '1.4.2' })
  @IsString()
  @Matches(VERSION_RE, { message: 'Версия в формате major.minor.patch' })
  clientVersion!: string;
}

export class LauncherLogDto {
  @ApiProperty({ enum: ['crash', 'error', 'diagnostic', 'user_report'] })
  @IsIn(['crash', 'error', 'diagnostic', 'user_report'])
  kind!: string;

  @ApiProperty({ example: '1.4.2' })
  @IsString()
  @Matches(VERSION_RE)
  clientVersion!: string;

  @ApiProperty({
    description:
      'Краткая выжимка. Пароли, токены, содержимое payload и Disk ID в открытом ' +
      'виде сюда класть нельзя — журнал хранится и просматривается людьми.',
  })
  @IsString()
  @Length(1, 512)
  summary!: string;

  /**
   * НЕОБЯЗАТЕЛЬНО — и это главное свойство эндпоинта, а не послабление.
   *
   * Самый ценный отчёт приходит от загрузчика, который как раз НЕ смог
   * аутентифицироваться: ключ отвергнут, конфиг повреждён, часы съехали и
   * подпись протухла. Эндпоинт, требующий валидную лицензию, отказывает
   * ровно тем отчётам, ради которых он существует.
   *
   * Ключ есть и разрешился → строка журнала получает licenseId, userId и
   * deviceId. Нет или не разрешился → в этих колонках NULL. Ответ в обоих
   * случаях 202: различие ответов превратило бы /logs в бесплатный
   * проверятор ключей в обход счётчиков check и payload.
   */
  @ApiPropertyOptional({ example: 'FC26-3HJ4-XUND-ETAZ-9877' })
  @IsOptional()
  @IsLicenseKey()
  licenseKey?: string;
}
