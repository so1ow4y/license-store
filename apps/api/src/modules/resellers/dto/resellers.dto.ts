import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResellerStatus, ResellerTopupStatus, ResellerTxType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

class PageDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ------------------------------------------------------------- администратор

class ResellerTermsDto {
  @ApiPropertyOptional({ example: 25, description: 'Скидка от цены тарифа, %' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ example: 5000, description: 'Насколько можно уйти в минус' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  creditLimit?: number;

  @ApiPropertyOptional({ type: [String], description: 'Разрешённые товары; пусто — все' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  allowedProductIds?: string[];

  @ApiPropertyOptional({ example: 10, description: 'Сбросов привязки клиентам в сутки' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  hwidResetDailyLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateResellerDto extends ResellerTermsDto {
  @ApiProperty({ example: 'partner42', description: 'Логин существующего аккаунта' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @ApiProperty({ example: 'Магазин «Партнёр»' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  displayName!: string;
}

export class UpdateResellerDto extends ResellerTermsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  displayName?: string;

  @ApiPropertyOptional({ enum: ResellerStatus })
  @IsOptional()
  @IsEnum(ResellerStatus)
  status?: ResellerStatus;
}

export class ChangeBalanceDto {
  @ApiProperty({ enum: ['TOPUP', 'ADJUSTMENT', 'COMMISSION'] })
  @IsIn([ResellerTxType.TOPUP, ResellerTxType.ADJUSTMENT, ResellerTxType.COMMISSION])
  type!: 'TOPUP' | 'ADJUSTMENT' | 'COMMISSION';

  @ApiProperty({ example: 10000, description: 'Пополнение и бонус — положительные; корректировка — любого знака' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  @Min(-10_000_000)
  @Max(10_000_000)
  amount!: number;

  @ApiPropertyOptional({ example: 'Оплата по счёту №15' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class ListResellersDto extends PageDto {
  @ApiPropertyOptional({ description: 'Название, логин или почта' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @ApiPropertyOptional({ enum: ResellerStatus })
  @IsOptional()
  @IsEnum(ResellerStatus)
  status?: ResellerStatus;
}

export class ListPageDto extends PageDto {}

// --------------------------------------------------------------- реселлер

export class IssueKeysDto {
  @ApiProperty({ description: 'Тариф: по нему ключ выдаст лицензию' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;

  @ApiPropertyOptional({ example: 90, description: 'Сколько дней ключ можно активировать; пусто — бессрочно' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  @ApiPropertyOptional({ example: 'Для клиента из Telegram' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListKeysDto extends PageDto {
  @ApiPropertyOptional({ enum: ['unused', 'used', 'cancelled', 'expired'] })
  @IsOptional()
  @IsIn(['unused', 'used', 'cancelled', 'expired'])
  state?: 'unused' | 'used' | 'cancelled' | 'expired';
}

export class ListClientLicensesDto extends PageDto {
  @ApiPropertyOptional({ description: 'Ключ, логин клиента, товар или тариф' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;
}

// ------------------------------------------------------------ пополнения

export class CreateTopupDto {
  @ApiProperty({ example: 10000, description: 'Сколько зачислить на баланс, в валюте баланса' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  @ApiProperty({ description: 'Кошелёк из списка: «id реквизитов:id кошелька»' })
  @IsString()
  @Matches(/^[0-9a-f-]{36}:[a-z0-9-]{1,32}$/)
  walletId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SubmitTopupTxDto {
  @ApiProperty({ description: 'Хеш (ID) транзакции из кошелька или обозревателя' })
  @IsString()
  @Length(16, 140)
  txHash!: string;
}

export class ListTopupsDto extends PageDto {
  @ApiPropertyOptional({ enum: ['OPEN', ...Object.values(ResellerTopupStatus)] })
  @IsOptional()
  @IsIn(['OPEN', ...Object.values(ResellerTopupStatus)])
  status?: 'OPEN' | ResellerTopupStatus;

  @ApiPropertyOptional({ description: 'Только заявки этого реселлера' })
  @IsOptional()
  @IsUUID()
  resellerId?: string;
}

export class ListCandidatesDto extends PageDto {
  @ApiPropertyOptional({ description: 'Начало логина или почты; пусто — все по алфавиту' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;
}

export class ResellerPaymentOptionDto {
  @ApiProperty({ description: 'Реквизиты из раздела реселлеров' })
  @IsUUID()
  profileId!: string;
}

export class UpdateResellerPaymentOptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class ConfirmTopupDto {
  @ApiPropertyOptional({ description: 'Фактически зачислить (если пришло не столько, сколько заявлено)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class RejectTopupDto {
  @ApiProperty({ example: 'Перевод не найден в сети' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ExtendClientLicenseDto {
  @ApiProperty({ description: 'Тариф продления того же товара' })
  @IsUUID()
  planId!: string;
}
