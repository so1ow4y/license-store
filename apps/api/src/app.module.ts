import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import * as path from 'node:path';

import { EnvModule } from '@common/config/env.module';
import { validateEnv } from '@common/config/env.schema';
import { CryptoModule } from '@common/crypto/crypto.module';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { LoggerModule } from '@common/logger/logger.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { RbacModule } from '@common/rbac/rbac.module';
import { RedisModule } from '@common/redis/redis.module';
import { SecurityModule } from '@common/security/security.module';
import { StorageModule } from '@common/storage/storage.module';
import { SettingsModule } from '@common/settings/settings.module';
import { AdminModule } from '@modules/admin/admin.module';
import { AuthModule } from '@modules/auth/auth.module';
import { HealthModule } from '@modules/health/health.module';
import { HwidModule } from '@modules/hwid/hwid.module';
import { BillingModule } from '@modules/billing/billing.module';
import { LauncherModule } from '@modules/launcher/launcher.module';
import { LicensesModule } from '@modules/licenses/licenses.module';
import { ProductsModule } from '@modules/products/products.module';
import { ResellersModule } from '@modules/resellers/resellers.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { TelegramBotModule } from '@modules/telegram-bot/telegram-bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // .env лежит в корне монорепы: одни и те же креды нужны
      // docker-compose, API и фронтенду. Дублировать их по папкам — способ
      // однажды поймать расхождение между тем, что поднял Docker,
      // и тем, куда подключается приложение.
      envFilePath: path.resolve(__dirname, '../../../.env'),
      // Валидация всей конфигурации при старте. Процесс не поднимется,
      // если чего-то не хватает — см. комментарий в env.schema.ts.
      validate: validateEnv,
      cache: true,
    }),

    // Строго после ConfigModule.forRoot: фабрика читает результат
    // выполненной им валидации.
    EnvModule,

    LoggerModule,
    PrismaModule,
    RedisModule,

    // Оба глобальные и взаимно зависимы: SettingsService расшифровывает
    // секреты через CryptoService, а PasswordService и SignatureService
    // читают параметры из настроек. Импортируются здесь, друг друга
    // файлами не импортируют — так цикл не возникает.
    StorageModule,
    CryptoModule,
    SettingsModule,

    // Первый глобальный guard — блокировка адресов: заблокированный IP
    // отсекается раньше проверки токена.
    SecurityModule,

    // --- Доменные модули ---------------------------------------------
    // Границы модульного монолита. Правило: модуль обращается к другому
    // только через его публичный сервис, экспортированный из модуля,
    // и никогда — напрямую к чужим репозиториям или таблицам.
    // Соблюдение этого правила — то, что позволит при необходимости
    // вырезать модуль в отдельный сервис за день, а не за месяц.
    // Планировщик для фоновых задач: разбор очереди уведомлений,
    // обслуживание партиций, поллинг Digiseller.
    ScheduleModule.forRoot(),

    NotificationsModule,
    HealthModule,

    // Строго ПОСЛЕ AuthModule: глобальные guard'ы вызываются в порядке
    // регистрации, и PermissionsGuard должен получить пользователя,
    // которого положил в запрос JwtAuthGuard.
    AuthModule,
    RbacModule,

    // Доменные модули идут после RbacModule: их эндпоинты защищены
    // декораторами, которые проверяет уже зарегистрированный guard.
    ProductsModule,
    LicensesModule,
    HwidModule,
    LauncherModule,
    BillingModule,
    AdminModule,
    ResellersModule,

    // Последним среди доменных: бот — потребитель их сервисов и не
    // предоставляет ничего, что нужно им. Его собственный контроллер
    // привязки защищён теми же глобальными guard'ами, поэтому он обязан
    // идти после AuthModule и RbacModule, как и остальные.
    //
    // Регистрируется независимо от TELEGRAM_BOT_ENABLED — почему именно
    // так, разобрано в шапке telegram-bot.module.ts. Коротко: при
    // выключенном рубильнике модуль поднимается, но вебхук отвечает 404,
    // процессоры выходят на первой строке, а выпуск ссылки привязки даёт
    // TELEGRAM_DISABLED вместо 404 «маршрута нет».
    TelegramBotModule,
  ],
  providers: [
    // Глобальный фильтр регистрируется провайдером, а не через
    // app.useGlobalFilters(): так он участвует в DI и может инжектить
    // сервисы — это понадобится, когда в него добавится запись
    // в audit_logs для 5xx.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
