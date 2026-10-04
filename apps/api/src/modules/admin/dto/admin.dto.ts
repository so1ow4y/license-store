import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AntiFraudSeverity, AntiFraudType, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

class PageDto {
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

export class ListUsersDto extends PageDto {
  @ApiPropertyOptional({ description: 'Строка поиска: username:, email:, role:, status:, ip:, 2fa:, id: и слова' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  q?: string;

  @ApiPropertyOptional({ description: 'Логин или почта' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Зарегистрирован не раньше' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Зарегистрирован не позже' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Слаг роли' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  role?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, { message: 'Логин: 3–32 символа, латиница, цифры, _ . -' })
  username?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ description: 'Отметить почту подтверждённой или снять отметку' })
  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;
}

export class BlockUserDto {
  @ApiProperty({ example: 'Передача доступа третьим лицам' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class SetRolesDto {
  @ApiProperty({ example: ['user', 'support'] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  roles!: string[];
}

export class UpdateSettingDto {
  @ApiProperty({ description: 'Новое значение того же типа, что и текущее' })
  @IsDefined()
  value!: unknown;
}

/** Поиск по журналу: строка «поле:значение» и диапазон времени. */
export class SearchLogDto extends PageDto {
  @ApiPropertyOptional({ description: 'Например: action:user.* -actor:system ip:10.0.0.0/8 текст' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class BlockByUsernameDto extends BlockUserDto {
  @ApiProperty({ example: 'cheater42' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;
}

export class CreateIpBlockDto {
  @ApiProperty({ example: '203.0.113.7', description: 'Адрес или подсеть CIDR' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  value!: string;

  @ApiPropertyOptional({ example: 'Перебор паролей' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'Срок в часах; без поля — бессрочно', example: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number;
}

export class BulkUsersDto {
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
  @MaxLength(500)
  reason?: string;
}

class BlockDurationDto {
  @ApiPropertyOptional({ example: 'Мультиаккаунт' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'Срок в часах; без поля — бессрочно' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number;
}

export class BlockUsersIpsDto extends BlockDurationDto {
  @ApiProperty({ type: [String], description: 'Пользователи, чьи адреса заблокировать' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class BulkIpBlockDto extends BlockDurationDto {
  @ApiProperty({ type: [String], example: ['203.0.113.7', '198.51.100.0/24'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  values!: string[];
}

export class ListAntifraudDto extends PageDto {
  @ApiPropertyOptional({ enum: AntiFraudType })
  @IsOptional()
  @IsEnum(AntiFraudType)
  type?: AntiFraudType;

  @ApiPropertyOptional({ enum: AntiFraudSeverity })
  @IsOptional()
  @IsEnum(AntiFraudSeverity)
  severity?: AntiFraudSeverity;
}
