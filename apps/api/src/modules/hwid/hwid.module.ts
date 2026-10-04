import { Module } from '@nestjs/common';

import { LicensesModule } from '@modules/licenses/licenses.module';

import { HwidController } from './hwid.controller';
import { HwidService } from './hwid.service';

@Module({
  // Первая привязка активирует лицензию — срок начинается именно там.
  imports: [LicensesModule],
  controllers: [HwidController],
  providers: [HwidService],
  // Экспортируется для Launcher API: проверка лицензии и сверка привязки
  // происходят в одном запросе.
  exports: [HwidService],
})
export class HwidModule {}
