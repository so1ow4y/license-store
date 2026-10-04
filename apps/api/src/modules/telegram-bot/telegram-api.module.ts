import { Module } from '@nestjs/common';

import { BotRateService } from './bot-rate.service';
import { TelegramApiService } from './telegram.api';
import { TelegramBotConfig } from './telegram-bot.config';

/**
 * Транспорт Telegram без единой доменной зависимости.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ЧАСТЬ TelegramBotModule. Его импортирует
 * NotificationsModule: канал TELEGRAM в очереди уведомлений отправляет
 * сообщения тем же клиентом. Если бы NotificationsModule импортировал
 * полный TelegramBotModule, получился бы цикл:
 *
 *   NotificationsModule → TelegramBotModule → BillingModule → NotificationsModule
 *
 * (BillingModule импортирует NotificationsModule явно). Здесь же
 * зависимостей на домен нет вовсе — только ENV, Prisma и Redis, а они
 * глобальные.
 *
 * Экраны, привязка, роутер и обработчик очереди живут в TelegramBotModule
 * и импортируют этот модуль, а не наоборот.
 */
@Module({
  providers: [TelegramBotConfig, TelegramApiService, BotRateService],
  exports: [TelegramBotConfig, TelegramApiService, BotRateService],
})
export class TelegramApiModule {}
