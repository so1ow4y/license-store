import { Global, Module } from '@nestjs/common';

import { TelegramApiModule } from '@modules/telegram-bot/telegram-api.module';

import { MailService } from './mail.service';
import { NotificationProcessor } from './notification.processor';
import { NotificationService } from './notification.service';
import { TelegramChannelService } from './telegram-channel.service';

/**
 * Уведомления (ТЗ п.16).
 *
 * Глобальный: ставить в очередь письма нужно почти из каждого доменного
 * модуля — выдача лицензии, сброс HWID, антифрод, заказы. Импортировать
 * модуль в каждый из них было бы шумом без пользы.
 *
 * ПОЧЕМУ ИМПОРТИРУЕТСЯ TelegramApiModule, А НЕ TelegramBotModule.
 * Нужны отсюда всего три вещи: транспорт Bot API, рубильник конфигурации
 * и счётчик лимитов. Полный модуль бота тянет за собой доменные модули —
 * в том числе BillingModule, который импортирует NotificationsModule явно.
 * Получился бы цикл NotificationsModule → TelegramBotModule → BillingModule →
 * NotificationsModule, и Nest упал бы на старте с «Cannot resolve
 * dependencies» либо, при forwardRef, отдал бы undefined вместо сервиса —
 * то есть уведомления молча перестали бы ставиться в очередь.
 *
 * Обратный импорт при этом не нужен: NotificationsModule глобальный, и
 * TelegramApiService получает NotificationService без единой строки в imports.
 */
@Global()
@Module({
  imports: [TelegramApiModule],
  providers: [MailService, NotificationService, NotificationProcessor, TelegramChannelService],
  exports: [NotificationService],
})
export class NotificationsModule {}
