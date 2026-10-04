import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, PaymentProvider } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrderDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty({ enum: ['YOOKASSA', 'CRYPTO'] })
  @IsIn(['YOOKASSA', 'CRYPTO'])
  provider!: 'YOOKASSA' | 'CRYPTO';

  @ApiPropertyOptional({ description: 'Кошелёк для оплаты криптовалютой: «id реквизитов:id кошелька» из списка способов' })
  @IsOptional()
  @IsString()
  @Matches(/^(?:[0-9a-f-]{36}:)?[a-z0-9-]{1,32}$/)
  walletId?: string;
}

export class SubmitCryptoTxDto {
  @ApiProperty({ description: 'Хеш (ID) транзакции из кошелька или обозревателя' })
  @IsString()
  @Length(16, 140)
  txHash!: string;
}

export class ConfirmOrderDto {
  @ApiPropertyOptional({ description: 'Комментарий для журнала' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectOrderDto {
  @ApiProperty({ example: 'Перевод не найден в сети' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ListOrdersDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ enum: PaymentProvider })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({ description: 'Только заказы, ждущие подтверждения оплаты' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  awaiting?: boolean;

  @ApiPropertyOptional({ description: 'Покупатель (учитывается только при праве .any)' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Номер заказа или логин покупателя' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export class ListMethodsDto {
  @ApiProperty({ description: 'Товар, который покупают' })
  @IsUUID()
  productId!: string;
}

export class ListProfilesDto {
  @ApiPropertyOptional({ description: 'Добавить к шаблонам личные реквизиты этого товара' })
  @IsOptional()
  @IsUUID()
  productId?: string;
}

export class CreateProfileDto {
  @ApiProperty({ enum: ['YOOKASSA', 'CRYPTO'] })
  @IsIn(['YOOKASSA', 'CRYPTO'])
  provider!: 'YOOKASSA' | 'CRYPTO';

  @ApiProperty({ example: 'Основной магазин' })
  @IsString()
  @Length(1, 128)
  name!: string;

  @ApiPropertyOptional({ description: 'Личные реквизиты товара; без поля — шаблон', nullable: true })
  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @ApiPropertyOptional({ description: 'Параметры: кошельки или настройки чека' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Ключи API магазина' })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Пустая строка удаляет ключ, отсутствующее поле не меняется' })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;
}

export class SearchProfilesDto {
  @ApiPropertyOptional({ description: 'Поиск: name:, provider:, kind:, product:, creator:, wallet:, id: и слова; AND/OR/NOT, скобки' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  q?: string;

  @ApiPropertyOptional({ enum: ['YOOKASSA', 'CRYPTO'] })
  @IsOptional()
  @IsIn(['YOOKASSA', 'CRYPTO'])
  provider?: 'YOOKASSA' | 'CRYPTO';

  @ApiPropertyOptional({ enum: ['TEMPLATE', 'PERSONAL'] })
  @IsOptional()
  @IsIn(['TEMPLATE', 'PERSONAL'])
  kind?: 'TEMPLATE' | 'PERSONAL';

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Созданы не раньше' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Созданы не позже' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

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

export class BulkProfilesDto {
  @ApiProperty({ type: [String], description: 'Реквизиты, которые удалить для всех товаров' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class AttachProfileDto {
  @ApiProperty({ description: 'Шаблон или личные реквизиты этого товара' })
  @IsUUID()
  profileId!: string;
}

export class UpdateProductOptionDto {
  @ApiPropertyOptional({ description: 'Принимать ли оплату на эти реквизиты' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Порядок на витрине внутри способа' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdatePaymentMethodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'Банковская карта или СБП' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Параметры провайдера; проверяются схемой провайдера' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Ключи API: пустая строка удаляет, отсутствующее поле не меняется' })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;
}
