import { Module } from '@nestjs/common';

import { HwidModule } from '@modules/hwid/hwid.module';
import { ProductsModule } from '@modules/products/products.module';

import { LauncherController } from './launcher.controller';
import { LauncherService } from './launcher.service';
import { LicenseKeyService } from './license-key.service';
import { ApiScopeGuard } from './guards/api-scope.guard';
import { SignatureGuard } from './guards/signature.guard';
import { PayloadAdmissionService } from './payload-admission.service';
import { PayloadCacheService } from './payload-cache.service';
import { PayloadIssuesService } from './payload-issues.service';
import { PayloadService } from './payload.service';

@Module({
  // HwidModule — привязка и сверка устройства.
  // ProductsModule — проверка обновлений по versionCode и опубликованная
  // сборка payload'а (PayloadsService.getPublishedBuild): payload — артефакт
  // продукта, и читается он через публичный сервис своего модуля, а не
  // прямым запросом к чужой таблице.
  imports: [HwidModule, ProductsModule],
  controllers: [LauncherController],
  providers: [
    LauncherService,
    // Разрешение ключа лицензии вынесено отдельным провайдером: это
    // единственное место, где ключ вообще существует как значение, и все
    // счётчики перебора живут рядом с ним. Размазать их по LauncherService
    // значило бы получить два места, где ключ можно случайно залогировать.
    LicenseKeyService,
    SignatureGuard,
    ApiScopeGuard,
    // Выдача payload'а разложена на четыре провайдера не ради красоты:
    // у каждого свой ресурс и свой режим отказа. Кэш держит БАЙТЫ и
    // single-flight, допуск считает ПАМЯТЬ, журнал пишет СЛЕД, и только
    // PayloadService знает порядок, в котором это складывается в ответ.
    PayloadCacheService,
    PayloadAdmissionService,
    PayloadIssuesService,
    PayloadService,
  ],
  exports: [LauncherService],
})
export class LauncherModule {}
