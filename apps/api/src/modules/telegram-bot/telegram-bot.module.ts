import { Module } from '@nestjs/common';

import { AuthModule } from '@modules/auth/auth.module';
import { BillingModule } from '@modules/billing/billing.module';
import { HwidModule } from '@modules/hwid/hwid.module';
import { LicensesModule } from '@modules/licenses/licenses.module';
import { ProductsModule } from '@modules/products/products.module';

import { BotActorService } from './bot-actor.service';
import { BotLinkService } from './bot-link.service';
import { BOT_ROUTER } from './bot-router.interface';
import { BotRouterService } from './bot-router.service';
import { BotStateService } from './bot-state.service';
import { BotSupportService } from './bot-support.service';
import { AccountScreen } from './screens/account.screen';
import { ActivateScreen } from './screens/activate.screen';
import { AdminScreen } from './screens/admin.screen';
import { HelpScreen } from './screens/help.screen';
import { HwidScreen } from './screens/hwid.screen';
import { LicensesScreen } from './screens/licenses.screen';
import { ProductsScreen } from './screens/products.screen';
import { RootScreen } from './screens/root.screen';
import { SupportScreen } from './screens/support.screen';
import { TelegramApiModule } from './telegram-api.module';
import { TelegramLinkController } from './telegram-link.controller';
import { TelegramLinkProcessor } from './telegram-link.processor';
import { TelegramUpdateProcessor } from './telegram-update.processor';
import { TelegramUpdateQueue } from './telegram-update.queue';
import { TelegramWebhookController } from './telegram-webhook.controller';

/**
 * Telegram-бот как модуль API, а не отдельный сервис (решение 0.1 ТЗ).
 *
 * Доменные модули импортируются ради их публичных сервисов: бот не ходит
 * в собственный HTTP-API. Отдельный процесс потребовал бы пары JWT на каждого
 * пользователя, а refresh одноразовый — два быстрых тапа в чате выкидывали бы
 * человека с TOKEN_REUSED.
 *
 * TelegramApiModule отделён намеренно: его же импортирует NotificationsModule,
 * а импорт оттуда полного TelegramBotModule дал бы цикл через BillingModule.
 *
 * РУБИЛЬНИК. Модуль регистрируется всегда, независимо от
 * TELEGRAM_BOT_ENABLED, и это осознанно. Условная регистрация
 * (`...(enabled ? [TelegramBotModule] : [])`) потребовала бы читать
 * окружение в момент сборки графа модулей — до валидации схемы, — а также
 * убрала бы из Swagger и из маршрутов контроллер привязки, из-за чего
 * кабинет получал бы 404 вместо внятного TELEGRAM_DISABLED. Вместо этого
 * рубильник проверяется на трёх границах, где он что-то значит:
 * вебхук отвечает 404, оба процессора выходят на первой строке,
 * BotLinkService.initForUser бросает TELEGRAM_DISABLED. Провайдеры при этом
 * инстанцируются, но ни один из них не трогает токен в конструкторе —
 * TelegramBotConfig.token бросает только при обращении.
 */
@Module({
  imports: [
    TelegramApiModule,
    AuthModule,
    LicensesModule,
    HwidModule,
    BillingModule,
    ProductsModule,
  ],
  controllers: [TelegramWebhookController, TelegramLinkController],
  providers: [
    TelegramUpdateQueue,
    TelegramUpdateProcessor,
    TelegramLinkProcessor,
    BotActorService,
    BotLinkService,
    BotStateService,
    BotSupportService,
    BotRouterService,
    RootScreen,
    LicensesScreen,
    HwidScreen,
    ActivateScreen,
    AccountScreen,
    ProductsScreen,
    SupportScreen,
    HelpScreen,
    AdminScreen,
    // useExisting, а не useClass: иначе в графе окажутся два экземпляра
    // роутера — один у процессора очереди, второй у всех, кто инжектит
    // BotRouterService по классу. Экраны и состояние они бы делили, а вот
    // любое поле самого роутера разошлось бы.
    { provide: BOT_ROUTER, useExisting: BotRouterService },
  ],
  exports: [BotLinkService],
})
export class TelegramBotModule {}
