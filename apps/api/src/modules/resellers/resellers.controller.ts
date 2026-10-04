import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import {
  ChangeBalanceDto,
  ConfirmTopupDto,
  CreateResellerDto,
  CreateTopupDto,
  ExtendClientLicenseDto,
  IssueKeysDto,
  ListClientLicensesDto,
  ListKeysDto,
  ListPageDto,
  ListResellersDto,
  ListTopupsDto,
  RejectTopupDto,
  SubmitTopupTxDto,
  UpdateResellerDto,
} from './dto/resellers.dto';
import { ResellerTopupsService } from './reseller-topups.service';
import { ResellersService } from './resellers.service';

/**
 * Панель реселлера. Всё «своё» определяется карточкой реселлера текущего
 * пользователя: чужих ключей, клиентов и лицензий отсюда не видно.
 */
@ApiTags('resellers')
@ApiBearerAuth('jwt')
@Controller('reseller')
export class ResellerPanelController {
  constructor(
    private readonly resellers: ResellersService,
    private readonly topups: ResellerTopupsService,
  ) {}

  @Get()
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Баланс, условия, цены для реселлера и сводка продаж' })
  async overview(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.resellers.overview(user.id);
  }

  @Post('keys')
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Выпустить ключи активации со своего баланса (коды показываются один раз)' })
  async issueKeys(@CurrentUser() user: AuthenticatedUser, @Body() dto: IssueKeysDto): Promise<unknown> {
    return this.resellers.issueKeys(user, dto);
  }

  @Get('keys')
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Мои ключи: неиспользованные целиком, остальные маской' })
  async keys(@CurrentUser() user: AuthenticatedUser, @Query() query: ListKeysDto): Promise<unknown> {
    return this.resellers.listKeys(user.id, query);
  }

  @Post('keys/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Отменить неиспользованный ключ и вернуть деньги на баланс' })
  async cancelKey(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.resellers.cancelKey(user, id);
  }

  @Get('licenses')
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Лицензии, проданные мной' })
  async licenses(@CurrentUser() user: AuthenticatedUser, @Query() query: ListClientLicensesDto): Promise<unknown> {
    return this.resellers.listLicenses(user.id, query);
  }

  @Post('licenses/:id/extend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Продлить лицензию клиента со своего баланса' })
  async extend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendClientLicenseDto,
  ): Promise<unknown> {
    return this.resellers.extendLicense(user, id, dto.planId);
  }

  @Post('licenses/:id/hwid-reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Сбросить привязку клиенту (суточный лимит реселлера)' })
  async resetHwid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.resellers.resetHwid(user, id, req.ip);
  }

  @Get('transactions')
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Мои операции по балансу' })
  async transactions(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPageDto): Promise<unknown> {
    return this.resellers.myTransactions(user.id, query);
  }

  // ------------------------------------------------------- пополнение баланса

  @Get('topups/options')
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Кошельки для пополнения баланса криптой' })
  async topupOptions(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.topups.options(user.id);
  }

  @Get('topups')
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Мои заявки на пополнение' })
  async myTopups(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPageDto): Promise<unknown> {
    return this.topups.listMine(user.id, query);
  }

  @Post('topups')
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Заявка на пополнение: адрес и сумма в монетах' })
  async createTopup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTopupDto): Promise<unknown> {
    return this.topups.create(user, dto);
  }

  @Post('topups/:id/tx')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Сообщить хеш перевода — заявка уходит администратору' })
  async submitTopupTx(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitTopupTxDto,
  ): Promise<unknown> {
    return this.topups.submitTx(user, id, dto.txHash);
  }

  @Post('topups/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reseller.panel')
  @ApiOperation({ summary: 'Отменить заявку до отправки хеша' })
  async cancelTopup(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.topups.cancel(user, id);
  }
}

/** Заявки реселлеров на пополнение — проверка и подтверждение администратором. */
@ApiTags('resellers')
@ApiBearerAuth('jwt')
@Controller('admin/reseller-topups')
export class AdminResellerTopupsController {
  constructor(private readonly topups: ResellerTopupsService) {}

  @Get()
  @RequirePermissions('resellers.read', 'resellers.topups.confirm')
  @ApiOperation({ summary: 'Заявки на пополнение (status=OPEN — незакрытые)' })
  async list(@Query() query: ListTopupsDto): Promise<unknown> {
    return this.topups.list(query);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('resellers.topups.confirm')
  @ApiOperation({ summary: 'Подтвердить поступление и пополнить баланс' })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmTopupDto,
  ): Promise<unknown> {
    return this.topups.confirm(user, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('resellers.topups.confirm')
  @ApiOperation({ summary: 'Отклонить заявку с причиной' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTopupDto,
  ): Promise<unknown> {
    return this.topups.reject(user, id, dto.reason);
  }
}

/** Реселлеры в админке: заведение, условия, баланс, история операций. */
@ApiTags('resellers')
@ApiBearerAuth('jwt')
@Controller('admin/resellers')
export class AdminResellersController {
  constructor(private readonly resellers: ResellersService) {}

  @Get()
  @RequirePermissions('resellers.read', 'resellers.manage')
  @ApiOperation({ summary: 'Реселлеры с балансом и продажами за 30 дней' })
  async list(@Query() query: ListResellersDto): Promise<unknown> {
    return this.resellers.list(query);
  }

  @Post()
  @RequirePermissions('resellers.manage')
  @ApiOperation({ summary: 'Сделать пользователя реселлером' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateResellerDto): Promise<unknown> {
    return this.resellers.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('resellers.read', 'resellers.manage')
  @ApiOperation({ summary: 'Карточка реселлера' })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.resellers.get(id);
  }

  @Patch(':id')
  @RequirePermissions('resellers.manage')
  @ApiOperation({ summary: 'Условия и статус реселлера' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResellerDto,
  ): Promise<unknown> {
    return this.resellers.update(user, id, dto);
  }

  @Post(':id/balance')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('resellers.balance')
  @ApiOperation({ summary: 'Пополнить, начислить бонус или скорректировать баланс' })
  async balance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeBalanceDto,
  ): Promise<unknown> {
    return this.resellers.changeBalance(user, id, dto);
  }

  @Get(':id/transactions')
  @RequirePermissions('resellers.read', 'resellers.manage')
  @ApiOperation({ summary: 'Операции по балансу реселлера' })
  async transactions(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListPageDto): Promise<unknown> {
    return this.resellers.transactions(id, query);
  }
}
