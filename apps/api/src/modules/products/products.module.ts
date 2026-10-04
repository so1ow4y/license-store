import { Module } from '@nestjs/common';

import { PayloadsController } from './payloads.controller';
import { PayloadsService } from './payloads.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { VersionsService } from './versions.service';

@Module({
  // PayloadsController после ProductsController: у обоих база /products,
  // и порядок объявления — это порядок разрешения маршрутов. Пересечений
  // нет (второй сегмент всюду литеральный и различается), но полагаться
  // на это молча не стоит — при добавлении сюда маршрута вида
  // ':id/:something' порядок станет значимым.
  controllers: [ProductsController, PayloadsController],
  providers: [ProductsService, VersionsService, PayloadsService],
  // Экспортируются для модулей лицензий и Launcher API: первому нужны
  // тарифы для расчёта срока, второму — проверка обновлений и
  // опубликованная сборка payload'а для горячего пути (getPublishedBuild).
  exports: [ProductsService, VersionsService, PayloadsService],
})
export class ProductsModule {}
