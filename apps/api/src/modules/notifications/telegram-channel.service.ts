import { Injectable, Logger } from '@nestjs/common';

import { TelegramApiService } from '@modules/telegram-bot/telegram.api';

/**
 * Канал доставки TELEGRAM для очереди уведомлений.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ КЛАСС, А НЕ ВЫЗОВ TelegramApiService ПРЯМО ИЗ ОБРАБОТЧИКА.
 * Обработчик очереди обязан выглядеть одинаково для всех каналов: получатель
 * строкой, отрендеренная пара subject/body, «отправь или брось». Bot API
 * работает не так — у него chat_id числовой (BigInt), темы сообщения нет
 * вовсе, а разметка задаётся параметром запроса. Эти три расхождения
 * разложились бы по switch'у в deliver(), и каждый следующий канал добавлял
 * бы туда свою порцию частностей.
 *
 * Классификацию отказов класс НЕ делает: её делает TelegramSendError в модуле
 * бота (403 → chat_blocked, 429 → rate_limited и так далее), а решение
 * «повторять или сдаться» принимает обработчик очереди. Ошибка пробрасывается
 * как есть — обёртка её потеряла бы, и заблокированный чат обрабатывался бы
 * восемью попытками за восемь часов вместо немедленного FAILED.
 */
@Injectable()
export class TelegramChannelService {
  private readonly logger = new Logger(TelegramChannelService.name);

  constructor(private readonly api: TelegramApiService) {}

  async send(
    recipient: string,
    rendered: { subject: string | null; body: string },
  ): Promise<void> {
    const chatId = this.parseChatId(recipient);

    // Темы у сообщения в Telegram нет. Непустой subject (например, у шаблона,
    // который администратор завёл по образцу письма) не выбрасывается, а идёт
    // первой строкой полужирным: потерять заголовок молча хуже, чем показать
    // его лишний раз. Текст УЖЕ экранирован при рендеринге — повторное
    // экранирование здесь превратило бы разметку шаблона в текст.
    const text = rendered.subject
      ? `<b>${rendered.subject}</b>\n${rendered.body}`
      : rendered.body;

    await this.api.sendMessage(chatId, text);
  }

  /**
   * chat_id из строкового поля recipient.
   *
   * BigInt, а не Number: идентификаторы Telegram уже вышли за 2³¹ и выйдут
   * за 2⁵³ — Number сломался бы молча, отправив сообщение в соседний чат.
   *
   * BigInt('мусор') бросает SyntaxError без единого намёка на то, какое
   * уведомление испортилось. Перехватываем и подставляем внятный текст:
   * он попадёт в notifications.error_message, откуда его и будут читать.
   */
  private parseChatId(recipient: string): bigint {
    try {
      return BigInt(recipient.trim());
    } catch {
      this.logger.error(`получатель telegram не является chat_id: ${recipient}`);
      throw new Error(`получатель telegram не является числовым chat_id`);
    }
  }
}
