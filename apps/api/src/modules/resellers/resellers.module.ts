import { Module } from '@nestjs/common';

import { AuthModule } from '@modules/auth/auth.module';
import { BillingModule } from '@modules/billing/billing.module';
import { HwidModule } from '@modules/hwid/hwid.module';
import { LicensesModule } from '@modules/licenses/licenses.module';

import { ResellerTopupsService } from './reseller-topups.service';
import { AdminResellersController, AdminResellerTopupsController, ResellerPanelController } from './resellers.controller';
import { ResellersService } from './resellers.service';

@Module({
  // AuthModule — выпуск ключей активации, LicensesModule — продление,
  // HwidModule — сброс привязки клиентам, BillingModule — крипто-кошельки
  // для пополнения баланса.
  imports: [AuthModule, LicensesModule, HwidModule, BillingModule],
  controllers: [ResellerPanelController, AdminResellersController, AdminResellerTopupsController],
  providers: [ResellersService, ResellerTopupsService],
})
export class ResellersModule {}
