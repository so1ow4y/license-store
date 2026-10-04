import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReleaseChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Админский вход в поток payload'а §7.
 *
 * Формы намеренно повторяют CreateVersionDto / RequestUploadDto /
 * ConfirmUploadDto из products.dto.ts: поток загрузки тот же самый
 * (черновик → presigned PUT → подтверждение с серверным sha256 →
 * публикация), и два похожих, но по-разному оформленных пути в одном
 * модуле дороже небольшой избыточности.
 */

/**
 * Номер версии сборки payload'а.
 *
 * Регулярка байт в байт та же, что у CreateVersionDto (products.dto.ts:162),
 * и это не косметика. Значение version уходит в X-Payload-Version И пятым
 * полем в AAD у AES-GCM, а клиент по контракту обрезает значение заголовка
 * с обеих сторон перед сборкой AAD. Версия «1.2.0 » с хвостовым пробелом
 * из копипаста дала бы расхождение AAD на один байт, то есть провал
 * GCM-тега у 100% пользователей этой сборки — при чистых 200 в наших логах
 * и без единого признака, по которому это можно отличить от порчи данных
 * в канале. Перевод строки внутри значения хуже: он подделывает границу
 * поля AAD. Поэтому пробелы и переводы строк отвергаются на входе, а не
 * канонизируются молча: молчаливая правка развела бы то, что лежит в БД,
 * и то, что уехало в ключ объекта хранилища.
 */
export const PAYLOAD_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;

/**
 * Название сборки в хранилище товара: латиница и цифры, сегменты через
 * точку, в конце — буква или цифра (1.2.0, v2, beta.3a). В контракт
 * загрузчика не уходит, поэтому может быть любым в этих рамках.
 */
export const BUILD_NAME_RE = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/;
const BUILD_NAME_MESSAGE = 'Название: латиница и цифры, можно через точку, в конце буква или цифра';

export class CreatePayloadBuildDto {
  @ApiProperty({ example: '1.2.0', description: 'Собственная ось версий payload’а, независимая от версий продукта' })
  @IsString()
  @Matches(PAYLOAD_VERSION_RE, { message: 'Формат версии: major.minor.patch' })
  version!: string;

  @ApiPropertyOptional({ example: 'stable.1a', description: 'Название в хранилище; по умолчанию — версия' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(BUILD_NAME_RE, { message: BUILD_NAME_MESSAGE })
  name?: string;

  @ApiPropertyOptional({
    enum: ReleaseChannel,
    description:
      'Сегодня доставляется только STABLE: горячий путь фильтрует канал жёстко, ' +
      'а уникальность (product_id, version) канал не учитывает.',
  })
  @IsOptional()
  @IsEnum(ReleaseChannel)
  channel?: ReleaseChannel;

  @ApiPropertyOptional({
    description:
      'Порог совместимости для 426 UPDATE_REQUIRED. По умолчанию не задан — ' +
      'загрузчик по решению владельца вечный, и выхода из 426 сегодня нет.',
    example: '1.0.0',
  })
  @IsOptional()
  @IsString()
  @Matches(PAYLOAD_VERSION_RE)
  minLauncherVersion?: string;
}

export class RequestPayloadUploadDto {
  @ApiProperty({ example: 'fc26mod_ship.dll' })
  @IsString()
  @Length(1, 128)
  filename!: string;

  @ApiPropertyOptional({ example: 'application/octet-stream' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  contentType?: string;
}

export class ConfirmPayloadUploadDto {
  @ApiProperty({ description: 'Ключ объекта, полученный от /upload-url' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  objectKey!: string;
}

export class RenamePayloadBuildDto {
  @ApiProperty({ example: 'stable.2' })
  @IsString()
  @Length(1, 64)
  @Matches(BUILD_NAME_RE, { message: BUILD_NAME_MESSAGE })
  name!: string;
}

export class ListPayloadBuildsDto {
  @ApiPropertyOptional({ description: 'Поиск: name:, version:, status:(draft|ready|published|unpublished), plan:, AND/OR/NOT, скобки' })
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

export class SetPlanBuildsDto {
  @ApiProperty({ description: 'Сборки тарифа (заменяют прежний набор)', type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  buildIds!: string[];
}
