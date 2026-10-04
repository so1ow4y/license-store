import { Module } from '@nestjs/common';

import { LicensesModule } from '@modules/licenses/licenses.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';

import { BillingController } from './billing.controller';
import { CheckoutProcessor } from './checkout.processor';
import { CheckoutService } from './checkout.service';
import { DigisellerClient } from './digiseller.client';
import { DigisellerService } from './digiseller.service';
import { FulfillmentService } from './fulfillment.service';
import { OrdersController } from './orders.controller';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentProfilesController, ProductPaymentOptionsController } from './payment-profiles.controller';
import { PaymentProfilesService } from './payment-profiles.service';
import { YookassaClient } from './yookassa.client';

/**
 * Оплата (ТЗ п.17): Digiseller (покупка на площадке, код у нас), ЮKassa и
 * криптовалюта (покупка на сайте). Клиенты провайдеров знают только свой
 * API; выдачу лицензии по оплаченному заказу делает FulfillmentService.
 */
@Module({
  imports: [LicensesModule, NotificationsModule],
  controllers: [
    BillingController,
    OrdersController,
    PaymentMethodsController,
    PaymentProfilesController,
    ProductPaymentOptionsController,
  ],
  providers: [
    DigisellerClient,
    DigisellerService,
    YookassaClient,
    PaymentMethodsService,
    PaymentProfilesService,
    FulfillmentService,
    CheckoutService,
    CheckoutProcessor,
  ],
  // PaymentProfilesService — кошельки для пополнения баланса реселлеров.
  exports: [DigisellerService, PaymentProfilesService],
})
export class BillingModule {}
