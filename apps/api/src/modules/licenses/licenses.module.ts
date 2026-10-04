import { Module } from '@nestjs/common';

import { LicenseExpiryProcessor } from './license-expiry.processor';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';

@Module({
  controllers: [LicensesController],
  providers: [LicensesService, LicenseExpiryProcessor],
  // Экспортируется для регистрации по ключу, оплаты Digiseller
  // и Launcher API: все они выдают или активируют лицензии,
  // и делать это должны одним способом.
  exports: [LicensesService],
})
export class LicensesModule {}
