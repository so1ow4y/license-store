import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { DigisellerService } from './digiseller.service';
import { RedeemCodeDto, RedeemOrderDto } from './dto/billing.dto';

/**
 * Оплата (ТЗ п.17).
 *
 * Покупатель платит на Digiseller, получает от площадки код и вводит его
 * здесь. Своей платёжной формы у нас нет и не будет: единственный канал —
 * площадка (ТЗ У-1), а значит на нашей стороне нет ни карт, ни кошельков,
 * ни целого класса связанных с ними требований.
 */
@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly digiseller: DigisellerService) {}

  @Post('digiseller/redeem')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Активировать код покупки Digiseller',
    description:
      'Проверяет код у площадки и выдаёт лицензию. Повторный вызов с тем же ' +
      'кодом от того же пользователя возвращает тот же результат, а не ошибку.',
  })
  @ApiResponse({ status: 200, description: 'ISSUED — лицензия выдана; ALREADY_YOURS — код уже активирован вами' })
  @ApiResponse({ status: 400, description: 'CODE_MALFORMED, CODE_NOT_ACCEPTED, TOO_MANY_ATTEMPTS' })
  @ApiResponse({
    status: 409,
    description:
      'CODE_ALREADY_USED — код активирован другим аккаунтом; PRODUCT_NOT_MAPPED; ' +
      'ORDER_AMOUNT_MISMATCH — оплачено заметно меньше цены тарифа, сделка ушла на разбор',
  })
  @ApiResponse({ status: 503, description: 'PROVIDER_UNAVAILABLE — площадка недоступна, повторить' })
  async redeem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemCodeDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.digiseller.redeem(user.id, dto.code, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: String(req.id ?? ''),
    });
  }

  @Post('digiseller/redeem-order')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Активировать покупку Digiseller по номеру заказа',
    description:
      'Запасной путь для случая, когда уникальные коды на карточке товара не ' +
      'включены и кода у покупки нет вовсе. Номер заказа не секрет — он ' +
      'выдаётся подряд, — поэтому право на покупку подтверждает совпадение ' +
      'почты с той, что площадка вернула в buyer_info. Повторный вызов с тем ' +
      'же номером от того же пользователя возвращает тот же результат.',
  })
  @ApiResponse({ status: 200, description: 'ISSUED — лицензия выдана; ALREADY_YOURS — покупка уже активирована вами' })
  @ApiResponse({ status: 400, description: 'ORDER_MALFORMED, ORDER_NOT_ACCEPTED, TOO_MANY_ATTEMPTS' })
  @ApiResponse({ status: 403, description: 'ORDER_EMAIL_MISMATCH — заказ оплачен другой почтой' })
  @ApiResponse({
    status: 409,
    description:
      'ORDER_NOT_PAID, ORDER_PAYMENT_FAILED, ORDER_EXPIRED, ORDER_REFUNDED, ' +
      'ORDER_REFUND_PENDING, ORDER_STATE_UNKNOWN, ORDER_NO_BUYER_EMAIL, ' +
      'ORDER_ALREADY_USED, PRODUCT_NOT_MAPPED, ORDER_AMOUNT_MISMATCH',
  })
  @ApiResponse({ status: 503, description: 'PROVIDER_UNAVAILABLE — площадка недоступна, повторить' })
  async redeemOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemOrderDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.digiseller.redeemByOrder(user.id, dto.orderNumber, dto.email, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: String(req.id ?? ''),
    });
  }

  // -------------------------------------------------------------------------
  //  Разбор зависших сделок
  // -------------------------------------------------------------------------

  @Get('digiseller/pending')
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.create.any')
  @ApiOperation({
    summary: 'Покупки, подтверждённые площадкой, но не выданные',
    description:
      'Единственная причина попасть сюда — товар площадки не привязан ни к ' +
      'одному тарифу. Это операционная ошибка владельца, и она обязана быть ' +
      'видимой: деньги у площадки, а у покупателя ничего.',
  })
  async pending(): Promise<unknown> {
    return this.digiseller.listPending();
  }

  @Post('digiseller/pending/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.create.any')
  @ApiOperation({
    summary: 'Довыдать лицензию по зависшей сделке',
    description:
      'Вызывается после того, как тариф привязан к товару. Код у площадки ' +
      'повторно не спрашивается: подтверждённый ответ уже сохранён.',
  })
  @ApiResponse({ status: 409, description: 'ALREADY_REDEEMED, PRODUCT_NOT_MAPPED, NO_CLAIMANT' })
  async complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.digiseller.completePending(id, user.id);
  }
}
