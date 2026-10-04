import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { UpdatePaymentMethodDto } from './dto/orders.dto';
import { PaymentMethodsService } from './payment-methods.service';

@ApiTags('admin')
@Controller('admin/payment-methods')
@ApiBearerAuth('jwt')
@RequirePermissions('payments.manage')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  @ApiOperation({ summary: 'Способы оплаты с настройками (значения ключей не отдаются)' })
  async list(): Promise<unknown> {
    return this.methods.listForAdmin();
  }

  @Patch(':provider')
  @ApiOperation({ summary: 'Включить, выключить или настроить способ оплаты' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<unknown> {
    return this.methods.update(provider, dto, user.id);
  }
}
