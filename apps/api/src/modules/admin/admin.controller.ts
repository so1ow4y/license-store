import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { IpBlockService } from '@common/security/ip-block.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { AdminAuditService } from './admin-audit.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminUsersService } from './admin-users.service';
import {
  BlockByUsernameDto,
  BlockUserDto,
  BlockUsersIpsDto,
  BulkIpBlockDto,
  BulkUsersDto,
  CreateIpBlockDto,
  ListAntifraudDto,
  ListUsersDto,
  SearchLogDto,
  SetRolesDto,
  UpdateSettingDto,
  UpdateUserDto,
} from './dto/admin.dto';

/** Администрирование: пользователи и роли, настройки, журналы, блокировки. */
@ApiTags('admin')
@ApiBearerAuth('jwt')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly settings: AdminSettingsService,
    private readonly audit: AdminAuditService,
    private readonly ipBlocks: IpBlockService,
  ) {}

  // ---------------------------------------------------------- пользователи

  @Get('users')
  @RequirePermissions('users.read.any')
  @ApiOperation({ summary: 'Пользователи: поиск «поле:значение», в том числе по IP' })
  async listUsers(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListUsersDto): Promise<unknown> {
    return this.users.list(actor, query);
  }

  @Post('users/bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.block')
  @ApiOperation({ summary: 'Массовая блокировка или разблокировка (до 500 за раз)' })
  async bulkUsers(@CurrentUser() actor: AuthenticatedUser, @Body() dto: BulkUsersDto): Promise<unknown> {
    return this.users.bulk(actor, dto.ids, dto.action, dto.reason);
  }

  @Post('users/block-ips')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('security.ip_block')
  @ApiOperation({ summary: 'Заблокировать все адреса выбранных пользователей' })
  async blockUsersIps(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: BlockUsersIpsDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.users.blockIpsOf(actor, dto.ids, { reason: dto.reason, expiresInHours: dto.expiresInHours, actorIp: req.ip });
  }

  @Post('users/block-by-username')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.block')
  @ApiOperation({ summary: 'Заблокировать по логину' })
  async blockByUsername(@CurrentUser() actor: AuthenticatedUser, @Body() dto: BlockByUsernameDto): Promise<unknown> {
    return this.users.blockByUsername(actor, dto.username, dto.reason);
  }

  @Get('users/:id')
  @RequirePermissions('users.read.any')
  @ApiOperation({ summary: 'Карточка пользователя' })
  async getUser(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.users.get(id);
  }

  @Get('users/:id/ips')
  @RequirePermissions('security.ips.read')
  @ApiOperation({ summary: 'Адреса пользователя и сколько ещё аккаунтов с них заходило' })
  async userIps(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.users.listIps(id);
  }

  @Patch('users/:id')
  @RequirePermissions('users.update.any')
  @ApiOperation({ summary: 'Изменить логин, почту, отметку о подтверждении почты' })
  async updateUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<unknown> {
    return this.users.update(actor, id, dto);
  }

  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.block')
  @ApiOperation({ summary: 'Заблокировать: все сессии завершаются сразу' })
  async block(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockUserDto,
  ): Promise<unknown> {
    return this.users.block(actor, id, dto.reason);
  }

  @Post('users/:id/unblock')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.block')
  @ApiOperation({ summary: 'Разблокировать' })
  async unblock(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.users.unblock(actor, id);
  }

  @Put('users/:id/roles')
  @RequirePermissions('roles.assign')
  @ApiOperation({ summary: 'Назначить роли (только ниже своей)' })
  async setRoles(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolesDto,
  ): Promise<unknown> {
    return this.users.setRoles(actor, id, dto.roles);
  }

  @Get('roles')
  @RequirePermissions('roles.read', 'roles.assign')
  @ApiOperation({ summary: 'Роли с правами' })
  async roles(): Promise<unknown> {
    return this.users.listRoles();
  }

  // ------------------------------------------------------------- настройки

  @Get('settings')
  @RequirePermissions('settings.read', 'settings.manage')
  @ApiOperation({ summary: 'Настройки платформы (значения секретов скрыты)' })
  async listSettings(): Promise<unknown> {
    return this.settings.list();
  }

  @Patch('settings/:key')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Изменить настройку без перезапуска' })
  async updateSetting(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ): Promise<unknown> {
    return this.settings.update(key, dto.value, actor.id);
  }

  // --------------------------------------------------------------- журналы

  @Get('audit')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Журнал событий: поиск action:, actor:, actortype:, entity:, entityid:, ip:, request:' })
  async searchAudit(@Query() query: SearchLogDto): Promise<unknown> {
    return this.audit.searchAudit(query);
  }

  @Get('audit/stats')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Гистограмма и топ значений по журналу событий' })
  async auditStats(@Query() query: SearchLogDto): Promise<unknown> {
    return this.audit.auditStats(query);
  }

  @Get('logins')
  @RequirePermissions('logins.read')
  @ApiOperation({ summary: 'Журнал входов: поиск user:, ip:, result:, reason:, method:, country:' })
  async searchLogins(@Query() query: SearchLogDto): Promise<unknown> {
    return this.audit.searchLogins(query);
  }

  @Get('logins/stats')
  @RequirePermissions('logins.read')
  @ApiOperation({ summary: 'Гистограмма входов (с неудачными) и топ значений' })
  async loginStats(@Query() query: SearchLogDto): Promise<unknown> {
    return this.audit.loginStats(query);
  }

  @Get('antifraud')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'События антифрода' })
  async listAntifraud(@Query() query: ListAntifraudDto): Promise<unknown> {
    return this.audit.listAntifraud(query);
  }

  // -------------------------------------------------------- блокировки IP

  @Get('security/ip-blocks')
  @RequirePermissions('security.ip_block')
  @ApiOperation({ summary: 'Заблокированные адреса и подсети' })
  async listIpBlocks(): Promise<unknown> {
    return this.ipBlocks.list();
  }

  @Post('security/ip-blocks')
  @RequirePermissions('security.ip_block')
  @ApiOperation({ summary: 'Заблокировать адрес или подсеть (свой адрес заблокировать нельзя)' })
  async createIpBlock(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateIpBlockDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.ipBlocks.create(dto, { id: actor.id, ip: req.ip, rolePriority: actor.rolePriority });
  }

  @Post('security/ip-blocks/bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('security.ip_block')
  @ApiOperation({ summary: 'Массовая блокировка адресов (до 500 за раз)' })
  async bulkIpBlock(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: BulkIpBlockDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.ipBlocks.createMany(
      dto.values,
      { reason: dto.reason, expiresInHours: dto.expiresInHours },
      { id: actor.id, ip: req.ip, rolePriority: actor.rolePriority },
    );
  }

  @Delete('security/ip-blocks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('security.ip_block')
  @ApiOperation({ summary: 'Снять блокировку адреса' })
  async removeIpBlock(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.ipBlocks.remove(id, actor.id);
  }
}
