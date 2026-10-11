import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { LauncherAudience, LauncherPlatform, ReleaseChannel } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { FastifyRequest } from 'fastify';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Public } from '@modules/auth/decorators/public.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { DistributionService } from './distribution.service';

class ReleaseDto {
  @ApiProperty({ example: '2.1.0' })
  @IsString()
  @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, { message: 'версия в формате 1.4.2' })
  version!: string;

  @ApiPropertyOptional({ enum: LauncherPlatform })
  @IsOptional()
  @IsEnum(LauncherPlatform)
  platform?: LauncherPlatform;

  @ApiPropertyOptional({ enum: ReleaseChannel })
  @IsOptional()
  @IsEnum(ReleaseChannel)
  channel?: ReleaseChannel;

  @ApiPropertyOptional({ description: 'Что нового' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ enum: LauncherAudience })
  @IsOptional()
  @IsEnum(LauncherAudience)
  audience?: LauncherAudience;

  @ApiPropertyOptional({ type: [String], description: 'Слаги ролей для audience = ROLES' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  roles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}

class UpdateReleaseDto {
  @IsOptional() @IsString() @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/) version?: string;
  @IsOptional() @IsEnum(LauncherPlatform) platform?: LauncherPlatform;
  @IsOptional() @IsEnum(ReleaseChannel) channel?: ReleaseChannel;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsEnum(LauncherAudience) audience?: LauncherAudience;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(64, { each: true }) roles?: string[];
  @IsOptional() @IsBoolean() isMandatory?: boolean;
}

class UploadDto {
  @ApiProperty({ example: 'LauncherSetup.exe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  filename!: string;

  @ApiPropertyOptional({ example: 'application/vnd.microsoft.portable-executable' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  contentType?: string;
}

class ConfirmDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  objectKey!: string;
}

class PageDto {
  @IsOptional() @IsString() @MaxLength(4000) requirements?: string;
  @IsOptional() @IsString() @MaxLength(4000) steps?: string;
}

/** Загрузчик: публичная раздача, кабинет и управление релизами. */
@ApiTags('products')
@Controller()
export class DistributionController {
  constructor(private readonly distribution: DistributionService) {}

  // ------------------------------------------------------------ посетители

  @Public()
  @Get('downloads/launcher/public')
  @ApiOperation({ summary: 'Публичные релизы загрузчика для главной страницы' })
  async publicReleases(): Promise<unknown> {
    return this.distribution.publicReleases();
  }

  @Public()
  @Post('downloads/launcher/:id/public')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ссылка на скачивание публичного релиза (5 минут)' })
  async publicDownload(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest): Promise<unknown> {
    return this.distribution.publicDownload(id, req.ip);
  }

  // ------------------------------------------------------------ кабинет

  @Get('downloads/launcher')
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Доступные мне версии загрузчика: последние и история' })
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.distribution.forUser(user);
  }

  @Post('downloads/launcher/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Ссылка на скачивание доступного мне релиза (5 минут)' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.distribution.userDownload(id, user, req.ip);
  }

  // ------------------------------------------------------------ админка

  @Get('admin/launcher/releases')
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Все релизы загрузчика, включая черновики' })
  async list(): Promise<unknown> {
    return this.distribution.list();
  }

  @Post('admin/launcher/releases')
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Черновик релиза загрузчика' })
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: ReleaseDto): Promise<unknown> {
    return this.distribution.create(dto, actor.id);
  }

  @Patch('admin/launcher/releases/:id')
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Изменить описание, аудиторию, обязательность' })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReleaseDto,
  ): Promise<unknown> {
    return this.distribution.update(id, dto, actor.id);
  }

  @Post('admin/launcher/releases/:id/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Ссылка для прямой загрузки файла в хранилище' })
  async uploadUrl(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadDto,
  ): Promise<unknown> {
    return this.distribution.requestUpload(id, dto, actor.id);
  }

  @Post('admin/launcher/releases/:id/confirm-upload')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Подтвердить загрузку: сервер считает SHA-256 сам' })
  async confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDto,
  ): Promise<unknown> {
    return this.distribution.confirmUpload(id, dto.objectKey, actor.id);
  }

  @Post('admin/launcher/releases/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Опубликовать релиз' })
  async publish(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.distribution.publish(id, true, actor.id);
  }

  @Post('admin/launcher/releases/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Снять с публикации — скачать его больше нельзя' })
  async unpublish(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.distribution.publish(id, false, actor.id);
  }

  @Delete('admin/launcher/releases/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Удалить неопубликованный релиз' })
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.distribution.remove(id, actor.id);
  }

  @Patch('admin/launcher/page')
  @ApiBearerAuth('jwt')
  @RequirePermissions('launcher.manage')
  @ApiOperation({ summary: 'Требования и шаги установки на странице загрузки' })
  async updatePage(@CurrentUser() actor: AuthenticatedUser, @Body() dto: PageDto): Promise<unknown> {
    return this.distribution.updatePage(dto, actor.id);
  }
}
