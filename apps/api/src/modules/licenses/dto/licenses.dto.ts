import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LicenseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class IssueLicenseDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({
    description: 'Владелец. Без него лицензия выпускается в резерв и привязывается позже.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Комментарий для поддержки' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ExtendLicenseDto {
  @ApiPropertyOptional({
    description: 'Тариф продления. Без него берётся текущий тариф лицензии.',
  })
  @IsOptional()
  @IsUUID()
  planId?: string;
}

export class BlockLicenseDto {
  @ApiProperty({ example: 'Передача доступа третьим лицам' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class BulkLicensesDto {
  @ApiProperty({ enum: ['block', 'unblock'] })
  @IsIn(['block', 'unblock'])
  action!: 'block' | 'unblock';

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiPropertyOptional({ description: 'Причина — обязательна для блокировки' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class SetLicenseBuildDto {
  @ApiProperty({ nullable: true, description: 'Сборка из хранилища товара; null — по тарифу' })
  @IsOptional()
  @IsUUID()
  buildId!: string | null;
}

export class RevokeLicenseDto {
  @ApiProperty({ example: 'Возврат средств по сделке Digiseller' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

/**
 * Ответ ручки «показать ключ». Существует только ради Swagger, как TokenPairDto.
 *
 * Отдельный тип нужен, чтобы в схеме API было видно: полное значение ключа
 * возвращает ровно один маршрут, а все остальные отдают `maskedKey`.
 */
export class LicenseKeyDto {
  @ApiProperty({ example: 'FC26-ACDE-FGHJ-KMNP-QRTU' })
  key!: string;
}

export class ListLicensesDto {
  @ApiPropertyOptional({ enum: LicenseStatus })
  @IsOptional()
  @IsEnum(LicenseStatus)
  status?: LicenseStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Владелец (учитывается только при праве .any)' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Поиск по ключу лицензии или логину владельца' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @ApiPropertyOptional({
    description: 'Поиск (право .any): key:, user:, product:, plan:, status:, build:, id:, AND/OR/NOT, скобки',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Выдана не раньше' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Выдана не позже' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  // Query-параметры приходят строками: без явного преобразования
  // @IsInt отвергнет даже корректное значение.
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
