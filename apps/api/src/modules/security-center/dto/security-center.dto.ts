import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CorrelationAction, CorrelationSource, HitSeverity, HitStatus, IpBlockLevel, TrafficPriorityKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PageDto } from '@modules/admin/dto/admin.dto';

// ---------------------------------------------------------------- правила

export class RuleDto {
  @ApiProperty({ example: 'Перебор паролей с одного адреса' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ enum: CorrelationSource })
  @IsEnum(CorrelationSource)
  source!: CorrelationSource;

  @ApiPropertyOptional({ example: 'result:failed', description: 'Строка поиска журнала' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  query?: string;

  @ApiProperty({ example: 'ip' })
  @IsString()
  @MaxLength(32)
  groupBy!: string;

  @ApiPropertyOptional({ example: 'user', description: 'Считать разные значения этого поля, а не события' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(32)
  distinctField?: string | null;

  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  threshold!: number;

  @ApiProperty({ example: 10, description: 'Окно, минут (до недели)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  windowMinutes!: number;

  @ApiPropertyOptional({ enum: HitSeverity })
  @IsOptional()
  @IsEnum(HitSeverity)
  severity?: HitSeverity;

  @ApiPropertyOptional({ enum: CorrelationAction })
  @IsOptional()
  @IsEnum(CorrelationAction)
  action?: CorrelationAction;

  @ApiPropertyOptional({ enum: IpBlockLevel })
  @IsOptional()
  @IsEnum(IpBlockLevel)
  blockLevel?: IpBlockLevel;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(65535, { each: true })
  blockPorts?: number[];

  @ApiPropertyOptional({ description: 'Срок блокировки в часах; null — бессрочно' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  blockHours?: number | null;

  @ApiPropertyOptional({ description: 'Пауза между сработками по одному ключу, минут' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_080)
  cooldownMinutes?: number;
}

/** Правка правила: любые поля, включая только «включено». */
export class UpdateRuleDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsEnum(CorrelationSource) source?: CorrelationSource;
  @IsOptional() @IsString() @MaxLength(1000) query?: string;
  @IsOptional() @IsString() @MaxLength(32) groupBy?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(32) distinctField?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) threshold?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_080) windowMinutes?: number;
  @IsOptional() @IsEnum(HitSeverity) severity?: HitSeverity;
  @IsOptional() @IsEnum(CorrelationAction) action?: CorrelationAction;
  @IsOptional() @IsEnum(IpBlockLevel) blockLevel?: IpBlockLevel;
  @IsOptional() @IsArray() @ArrayMaxSize(32) @IsInt({ each: true }) @Min(1, { each: true }) @Max(65535, { each: true }) blockPorts?: number[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(24 * 365) blockHours?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_080) cooldownMinutes?: number;
}

// ---------------------------------------------------------------- сработки

export class ListHitsDto extends PageDto {
  @ApiPropertyOptional({ enum: HitStatus })
  @IsOptional()
  @IsEnum(HitStatus)
  status?: HitStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ruleId?: string;

  @ApiPropertyOptional({ enum: HitSeverity })
  @IsOptional()
  @IsEnum(HitSeverity)
  severity?: HitSeverity;

  @ApiPropertyOptional({ description: 'Подстрока ключа: адрес, логин' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;
}

export class UpdateHitsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiProperty({ enum: HitStatus })
  @IsEnum(HitStatus)
  status!: HitStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ---------------------------------------------------------------- трафик

export class TrafficConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(4) @Max(10_000) maxConcurrent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) queueMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(60_000) queueTimeoutMs?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(101) bypassWeight?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(10_000) lagThresholdMs?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) anonymousWeight?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) authenticatedWeight?: number;
  @ApiPropertyOptional({ example: { super_admin: 100, support: 70 } })
  @IsOptional()
  @IsObject()
  roleWeights?: Record<string, number>;
  @IsOptional() @IsBoolean() attackMode?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) attackMinWeight?: number;
}

export class AddPriorityDto {
  @ApiProperty({ enum: TrafficPriorityKind })
  @IsEnum(TrafficPriorityKind)
  kind!: TrafficPriorityKind;

  @ApiProperty({ example: '203.0.113.7', description: 'Адрес/подсеть или логин' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  value!: string;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  weight!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// ---------------------------------------------------------------- дашборды

export class DashboardDto {
  @ApiProperty({ example: 'Входы' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shared?: boolean;

  @ApiPropertyOptional({ description: 'Виджеты: [{ type, title, size, source, q, field }]' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  widgets?: unknown[];
}

export class UpdateDashboardDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() shared?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) position?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(40) widgets?: unknown[];
}
