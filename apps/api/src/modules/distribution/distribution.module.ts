import { Module } from '@nestjs/common';

import { DistributionController } from './distribution.controller';
import { DistributionService } from './distribution.service';

/**
 * Раздача клиента-загрузчика. Отдельно от LauncherModule (API самого
 * загрузчика): там подписанные запросы программы, здесь — люди в браузере.
 */
@Module({
  controllers: [DistributionController],
  providers: [DistributionService],
})
export class DistributionModule {}
