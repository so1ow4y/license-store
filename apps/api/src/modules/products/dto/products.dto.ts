import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus, ReleaseChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Код продукта попадает в ключ лицензии и в путь объекта хранилища. Не длиннее
 * 32: ключ = код + 20 символов групп, а колонка licenses.key — VarChar(64).
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export class CreateProductDto {
  @ApiProperty({ example: 'fc26' })
  @IsString()
  @Matches(SLUG_RE, { message: 'Код: строчная латиница, цифры и дефис, от 3 до 32 символов' })
  slug!: string;

  @ApiProperty({ example: 'FC 26' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Лимит сбросов HWID. Не задан — берётся из настроек.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxHwidResets?: number;

  @ApiPropertyOptional({ description: 'Кулдаун между сбросами в часах. Не задан — из настроек.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8760)
  hwidResetCooldownHours?: number;
}

export class UpdateProductDto {
  @ApiPropertyOptional({
    description:
      'Новый код. Выданные ключи остаются рабочими, новые получат новый префикс; ' +
      'загрузчики, собранные со старым кодом, перестанут находить товар.',
  })
  @IsOptional()
  @IsString()
  @Matches(SLUG_RE, { message: 'Код: строчная латиница, цифры и дефис, от 3 до 32 символов' })
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Лимит сбросов HWID; null — из настроек' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxHwidResets?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Кулдаун между сбросами, ч; null — из настроек' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8760)
  hwidResetCooldownHours?: number | null;
}

export class CreatePlanDto {
  @ApiProperty({ example: '30d' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/, { message: 'Код тарифа: строчная латиница, цифры, дефис' })
  slug!: string;

  @ApiProperty({ example: '30 дней' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiProperty({
    nullable: true,
    description: 'Срок в днях. NULL означает бессрочный тариф (Lifetime).',
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36500)
  durationDays!: number | null;

  @ApiProperty({ example: 1290 })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 'RUB' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ description: 'ID товара на Digiseller — связь тарифа с площадкой' })
  @IsOptional()
  @IsInt()
  @Min(1)
  digisellerProductId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  digisellerProductId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateVersionDto {
  @ApiProperty({ example: '1.4.2' })
  @IsString()
  @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,4}$/, { message: 'Формат версии: major.minor.patch' })
  version!: string;

  @ApiPropertyOptional({ enum: ReleaseChannel })
  @IsOptional()
  @IsEnum(ReleaseChannel)
  channel?: ReleaseChannel;

  @ApiPropertyOptional({ description: 'Markdown' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  changelog?: string;

  @ApiPropertyOptional({
    description: 'Обязательное обновление: загрузчик откажется работать на старой версии',
  })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({ description: 'Минимальная версия загрузчика, способная это поставить' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,4}$/)
  minLauncherVersion?: string;
}

export class RequestUploadDto {
  @ApiProperty({ example: 'launcher-1.4.2.exe' })
  @IsString()
  @Length(1, 128)
  filename!: string;

  @ApiPropertyOptional({ example: 'application/octet-stream' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  contentType?: string;
}

export class ConfirmUploadDto {
  @ApiProperty({ description: 'Ключ объекта, полученный от /upload-url' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  objectKey!: string;
}

export class ManifestFileDto {
  @ApiProperty({ example: 'bin/launcher.exe' })
  @IsString()
  @Length(1, 512)
  path!: string;

  @ApiProperty({ description: '64 hex-символа в нижнем регистре' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'Контрольная сумма: 64 hex-символа нижнего регистра' })
  sha256!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  size!: number;

  @ApiPropertyOptional({
    description: 'Проверять при каждом запуске. Остальные — только после обновления.',
  })
  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;
}

export class SetManifestDto {
  @ApiProperty({ type: [ManifestFileDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManifestFileDto)
  files!: ManifestFileDto[];
}
