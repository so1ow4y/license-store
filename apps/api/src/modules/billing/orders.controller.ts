import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Public } from '@modules/auth/decorators/public.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { CheckoutService } from './checkout.service';
import {
  ConfirmOrderDto,
  CreateOrderDto,
  ListMethodsDto,
  ListOrdersDto,
  RejectOrderDto,
  SubmitCryptoTxDto,
} from './dto/orders.dto';
import { PaymentProfilesService } from './payment-profiles.service';

/** Покупка на сайте: способы оплаты, заказы, вебхук ЮKassa. */
@ApiTags('payments')
@Controller('billing')
export class OrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly profiles: PaymentProfilesService,
  ) {}

  @Get('methods')
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Способы, которыми можно оплатить товар прямо сейчас' })
  async listMethods(@Query() query: ListMethodsDto): Promise<unknown> {
    return this.profiles.methodsForProduct(query.productId);
  }

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Создать заказ',
    description:
      'ЮKassa: в ответе payment.instructions.url — страница оплаты. ' +
      'Крипта: адрес, сеть и сумма в монетах; после перевода пришлите хеш транзакции.',
  })
  @ApiResponse({ status: 400, description: 'PAYMENT_METHOD_DISABLED, WALLET_NOT_FOUND, EMAIL_REQUIRED_FOR_RECEIPT, PROVIDER_REJECTED' })
  @ApiResponse({ status: 409, description: 'TOO_MANY_PENDING_ORDERS' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto): Promise<unknown> {
    return this.checkout.createOrder(user.id, dto);
  }

  @Get('orders')
  @ApiBearerAuth('jwt')
  @RequirePermissions('orders.read.any', 'orders.read.own')
  @ApiOperation({ summary: 'Заказы: все или свои — по правам' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOrdersDto): Promise<unknown> {
    return this.checkout.list(user, query);
  }

  @Get('orders/:id')
  @ApiBearerAuth('jwt')
  @RequirePermissions('orders.read.any', 'orders.read.own')
  @ApiOperation({ summary: 'Заказ' })
  async byId(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.checkout.findVisible(user, id);
  }

  @Post('orders/:id/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('orders.read.any', 'orders.read.own')
  @ApiOperation({ summary: 'Перепроверить статус оплаты у ЮKassa' })
  async refresh(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.checkout.refresh(user, id);
  }

  @Post('orders/:id/crypto-tx')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Сообщить хеш крипто-транзакции' })
  @ApiResponse({ status: 409, description: 'TX_ALREADY_USED, ORDER_NOT_PENDING' })
  async submitTx(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitCryptoTxDto,
  ): Promise<unknown> {
    return this.checkout.submitCryptoTx(user.id, id, dto.txHash);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Отменить неоплаченный крипто-заказ' })
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.checkout.cancelByUser(user.id, id);
  }

  @Post('orders/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('orders.manage')
  @ApiOperation({ summary: 'Подтвердить оплату вручную и выдать лицензию' })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmOrderDto,
  ): Promise<unknown> {
    return this.checkout.confirmByAdmin(user.id, id, dto.note);
  }

  @Post('orders/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('orders.manage')
  @ApiOperation({ summary: 'Отклонить оплату: заказ отменяется, покупатель получает письмо' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrderDto,
  ): Promise<unknown> {
    return this.checkout.rejectByAdmin(user.id, id, dto.reason);
  }

  @Post('yookassa/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Уведомления ЮKassa',
    description: 'Тело не доверяется: статус платежа перечитывается из API ЮKassa нашими ключами.',
  })
  async yookassaWebhook(@Body() body: unknown): Promise<{ ok: true }> {
    await this.checkout.handleYookassaWebhook(body);
    return { ok: true };
  }
}
