import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';

import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { NotificationService } from '@modules/notifications/notification.service';

import { TelegramBotConfig } from './telegram-bot.config';

/**
 * Клиент Bot API.
 *
 * Здесь же живёт УЧЁТ ОТКАЗОВ ДОСТАВКИ (chat_blocked, chat_not_found),
 * а не в подсистеме уведомлений. Причина конструктивная: чтобы отметить
 * привязку заблокированной, надо знать chat_id → telegram_links, а это
 * таблица бота. Если бы этим занимался NotificationsModule, ему
 * понадобился бы BotLinkService, то есть импорт TelegramBotModule,
 * а тот через BillingModule импортирует NotificationsModule обратно —
 * готовый цикл. Здесь же нужен только Prisma.
 */

/** Таймаут одного запроса. Telegram отвечает за десятки миллисекунд; 10 с — это «узел мёртв». */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Паузы перед повторами. Повторяются ТОЛЬКО сеть и 5xx: 4xx от Telegram
 * не изменится ни через секунду, ни через девять, а повтор отправки после
 * успешного sendMessage с оборванным ответом даёт человеку два сообщения.
 */
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];

/**
 * Порог, до которого 429 пережидается на месте.
 *
 * Выше — исключение с retryAfterSec наружу: держать открытым запрос
 * и слот глобального лимитера минуту ради одного сообщения дороже,
 * чем отложить его через scheduledAt в очереди уведомлений.
 */
const INLINE_RETRY_AFTER_LIMIT_SEC = 5;

/** Не больше 25 обращений к Bot API за секунду со всего процесса (лимит площадки ~30). */
const GLOBAL_LIMIT = 25;
const GLOBAL_WINDOW_MS = 1_000;

/** Не чаще одного НОВОГО сообщения в секунду в один чат. */
const SEND_LOCK_PREFIX = 'tg:sendlock:';
const SEND_LOCK_ATTEMPTS = 3;
const SEND_LOCK_WAIT_MS = 400;

export interface TgSendResult {
  messageId: number;
}

/**
 * Клавиатура под сообщением.
 *
 * Тип объявлен здесь, потому что транспорт обязан уметь его сериализовать,
 * а собственного файла клавиатур (пакет 3, bot-keyboard.ts) на момент
 * написания транспорта не существует. Структурно они совпадают, и TypeScript
 * со структурной типизацией примет любой из двух.
 */
export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
}

/**
 * Вид отказа доставки. Классификация нужна вызывающему, чтобы решить,
 * повторять ли: для процессора уведомлений chat_blocked — окончательный
 * отказ (ретраи в заблокированный чат бессмысленны), rate_limited —
 * повод отложить, transient — повод попробовать снова.
 */
export type TelegramSendErrorKind =
  | 'chat_blocked'
  | 'chat_not_found'
  | 'rate_limited'
  | 'transient'
  | 'bad_request';

export class TelegramSendError extends Error {
  constructor(
    readonly kind: TelegramSendErrorKind,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'TelegramSendError';
  }
}

interface TgApiEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger(TelegramApiService.name);

  /** Отметки времени последних обращений — окно глобального лимитера. */
  private readonly recentCalls: number[] = [];
  /**
   * Хвост очереди на слот. Без него двадцать параллельных отправок
   * одновременно увидят «в окне свободно» и пройдут все двадцать:
   * проверка и запись обязаны быть неделимы в пределах процесса.
   */
  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: TelegramBotConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
  ) {}

  // =========================================================================
  //  МЕТОДЫ BOT API
  // =========================================================================

  async sendMessage(
    chatId: bigint,
    text: string,
    opts?: {
      keyboard?: InlineKeyboard;
      replyToMessageId?: number;
      disableNotification?: boolean;
    },
  ): Promise<TgSendResult> {
    const result = await this.request<{ message_id: number }>(
      'sendMessage',
      {
        chat_id: String(chatId),
        text,
        ...this.commonSendOptions(),
        ...(opts?.keyboard ? { reply_markup: opts.keyboard } : {}),
        ...(opts?.replyToMessageId
          ? {
              reply_parameters: {
                message_id: opts.replyToMessageId,
                // Ответ на удалённое сообщение иначе роняет отправку целиком:
                // «message to be replied not found». Для нас связь с исходным
                // сообщением — украшение, а доставка — нет.
                allow_sending_without_reply: true,
              },
            }
          : {}),
        ...(opts?.disableNotification ? { disable_notification: true } : {}),
      },
      { chatId, throttleChat: true },
    );

    // Ответ без message_id формально невозможен, но вызывающий на него
    // рассчитывает: показ ключа удаляет своё сообщение через 90 секунд,
    // и NaN вместо номера означал бы ключ, оставшийся в чате навсегда.
    const messageId = result?.message_id;
    if (typeof messageId !== 'number') {
      throw new TelegramSendError('transient', 'Bot API вернул ответ без message_id');
    }

    return { messageId };
  }

  /**
   * Замена текста существующего сообщения — основной способ навигации:
   * один экран = одно сообщение, а не лента из двадцати.
   *
   * Троттлинг по чату здесь НЕ применяется. Правка не порождает уведомления
   * на устройстве и не является «сообщением в чат» в смысле флуд-контроля,
   * а последовательность апдейтов одного чата и без того сериализована
   * блокировкой tg:chat-lock в обработчике очереди. Задержка в секунду
   * на каждое нажатие кнопки превратила бы меню в неотзывчивое.
   */
  async editMessageText(
    chatId: bigint,
    messageId: number,
    text: string,
    opts?: { keyboard?: InlineKeyboard },
  ): Promise<void> {
    try {
      await this.request<unknown>(
        'editMessageText',
        {
          chat_id: String(chatId),
          message_id: messageId,
          text,
          ...this.commonSendOptions(),
          ...(opts?.keyboard ? { reply_markup: opts.keyboard } : {}),
        },
        { chatId },
      );
    } catch (error) {
      // «Не изменено» — это успех, а не отказ: пользователь нажал кнопку
      // текущего экрана. Пропускать наружу значит рисовать ему ошибку там,
      // где ничего не произошло.
      if (error instanceof TelegramSendError && /message is not modified/i.test(error.message)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Удаление сообщения. Нужно для секретов: сообщение с кодом Digiseller,
   * регключом или /start <token> удаляется ДО обработки и до логирования.
   *
   * Отсутствие сообщения ошибкой не считается — его мог удалить сам
   * пользователь, и это ровно тот результат, которого мы добивались.
   */
  async deleteMessage(chatId: bigint, messageId: number): Promise<void> {
    try {
      await this.request<unknown>(
        'deleteMessage',
        { chat_id: String(chatId), message_id: messageId },
        { chatId },
      );
    } catch (error) {
      if (
        error instanceof TelegramSendError &&
        /message to delete not found|message can'?t be deleted/i.test(error.message)
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Ответ на нажатие кнопки. Обязателен на КАЖДЫЙ callback_query, иначе
   * у пользователя крутятся часики до таймаута клиента.
   *
   * Ошибки не пробрасываются: «query is too old» приходит на любую кнопку
   * старше минуты, и превращать это в сбой экрана незачем — экран уже
   * отрисован, часики погаснут сами.
   */
  async answerCallbackQuery(id: string, opts?: { text?: string; showAlert?: boolean }): Promise<void> {
    try {
      await this.request<unknown>('answerCallbackQuery', {
        callback_query_id: id,
        ...(opts?.text ? { text: opts.text } : {}),
        ...(opts?.showAlert ? { show_alert: true } : {}),
      });
    } catch (error) {
      this.logger.debug(
        `ответ на callback не доставлен: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Выход из группы: бот работает только в приватных чатах (§7 ТЗ). */
  async leaveChat(chatId: bigint): Promise<void> {
    try {
      await this.request<unknown>('leaveChat', { chat_id: String(chatId) }, { chatId });
    } catch (error) {
      this.logger.warn(
        `не удалось покинуть чат: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Произвольный метод Bot API. Нужен административным экранам и скриптам
   * деплоя (setWebhook, setMyCommands), чтобы не заводить второй клиент
   * с собственными таймаутами и лимитером.
   */
  async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(method, body);
  }

  // =========================================================================
  //  ТРАНСПОРТ
  // =========================================================================

  /**
   * parse_mode и превью — на КАЖДОЙ отправке, а не по желанию вызывающего.
   *
   * disable_web_page_preview обязателен: без него любая ссылка в тексте
   * разворачивается картинкой на пол-экрана и выталкивает кнопки за край,
   * а ссылка из чужого текста (обращение в поддержку) заодно дёргает
   * чужой сервер от нашего имени.
   */
  private commonSendOptions(): Record<string, unknown> {
    return {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      // Старое имя параметра: часть методов Bot API до сих пор читает его,
      // и оставить только новое значит получить превью там, где его не ждут.
      disable_web_page_preview: true,
    };
  }

  private async request<T>(
    method: string,
    body: Record<string, unknown>,
    ctx: { chatId?: bigint; throttleChat?: boolean } = {},
  ): Promise<T> {
    if (!this.config.enabled) {
      // bad_request, а не transient: пока рубильник выключен, повторять
      // нечего — процессор уведомлений должен признать отказ окончательным,
      // а не биться восемь часов.
      throw new TelegramSendError('bad_request', 'бот выключен (TELEGRAM_BOT_ENABLED=false)');
    }

    const url = `https://api.telegram.org/bot${this.config.token}/${method}`;
    let lastTransient: TelegramSendError | null = null;

    for (let attempt = 0; ; attempt += 1) {
      await this.takeGlobalSlot();
      if (ctx.throttleChat && ctx.chatId !== undefined) await this.takeChatSlot(ctx.chatId);

      let outcome: TelegramSendError | { ok: true; result: T };
      try {
        outcome = await this.exchange<T>(url, body);
      } catch (error) {
        // Сеть и таймаут. AbortSignal.timeout даёт TimeoutError.
        outcome = new TelegramSendError(
          'transient',
          `сеть: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if ('ok' in outcome) return outcome.result;

      const failure = outcome;

      // Отметки о блокировке и отвязке ставятся один раз, на первом же
      // отказе: повторять их по кругу нечего, да и повторов у этих видов нет.
      if (failure.kind === 'chat_blocked' || failure.kind === 'chat_not_found') {
        await this.recordDeliveryFailure(failure.kind, ctx.chatId);
        throw failure;
      }

      if (failure.kind === 'bad_request') throw failure;

      if (failure.kind === 'rate_limited') {
        const wait = failure.retryAfterSec ?? 1;
        if (wait > INLINE_RETRY_AFTER_LIMIT_SEC || attempt >= RETRY_DELAYS_MS.length) throw failure;
        await sleep(wait * 1000);
        continue;
      }

      // transient
      lastTransient = failure;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }

    throw lastTransient ?? new TelegramSendError('transient', 'Bot API недоступен');
  }

  /** Один обмен с Bot API. Возвращает результат либо классифицированный отказ. */
  private async exchange<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<TelegramSendError | { ok: true; result: T }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await res.text();

    let envelope: TgApiEnvelope<T> | null = null;
    try {
      envelope = JSON.parse(text) as TgApiEnvelope<T>;
    } catch {
      envelope = null;
    }

    if (res.ok && envelope?.ok === true && envelope.result !== undefined) {
      return { ok: true, result: envelope.result };
    }

    // Метод без содержательного результата (deleteMessage, leaveChat)
    // отдаёт result: true — оно уже покрыто выше. Сюда попадает ok: true
    // без result, что для нас тоже успех.
    if (res.ok && envelope?.ok === true) {
      return { ok: true, result: undefined as T };
    }

    if (!envelope) {
      // Не JSON — почти всегда страница прокси или заглушка Telegram.
      return new TelegramSendError('transient', `не JSON от Bot API, HTTP ${res.status}`);
    }

    return this.classify(res.status, envelope);
  }

  /**
   * Классификация отказа Bot API.
   *
   * Telegram различает причины ТОЛЬКО текстом description при общем
   * error_code 400/403 — отдельных кодов у «чат не найден» и «бот
   * заблокирован» нет. Поэтому разбор по подстроке; список взят из
   * практики, а не выдуман, и неизвестный текст осознанно уходит
   * в bad_request, а не в «повторим восемь раз».
   */
  private classify(httpStatus: number, envelope: TgApiEnvelope<unknown>): TelegramSendError {
    const description = envelope.description ?? `HTTP ${httpStatus}`;
    const code = envelope.error_code ?? httpStatus;

    if (code === 429) {
      const retryAfter = envelope.parameters?.retry_after;
      return new TelegramSendError(
        'rate_limited',
        description,
        typeof retryAfter === 'number' && retryAfter > 0 ? Math.ceil(retryAfter) : 1,
      );
    }

    if (code >= 500) return new TelegramSendError('transient', description);

    // 401 — неверный или отозванный токен, а не отказ по сути: как transient
    // уведомления отработают лестницу повторов (~8 ч), пока токен чинят.
    if (code === 401) {
      this.logger.error('Bot API отвечает 401 — токен бота неверен или отозван');
      return new TelegramSendError('transient', description);
    }

    if (code === 403) {
      // «deactivated» — удалённый аккаунт: писать туда так же бессмысленно,
      // как в заблокировавший чат, и отличать их незачем.
      if (/bot was blocked|user is deactivated|bot can'?t initiate conversation|bot was kicked/i.test(description)) {
        return new TelegramSendError('chat_blocked', description);
      }
      return new TelegramSendError('bad_request', description);
    }

    if (code === 400 && /chat not found|peer_id_invalid/i.test(description)) {
      return new TelegramSendError('chat_not_found', description);
    }

    return new TelegramSendError('bad_request', description);
  }

  /**
   * Отметка отказа доставки в telegram_links.
   *
   * chat_blocked — НЕ отвязка: человек нажал «заблокировать бота» и может
   * разблокировать завтра. Флаг снимается первым же входящим апдейтом
   * (BotActorService.touch), привязка остаётся.
   *
   * chat_not_found — чат перестал существовать. Восстановить его нельзя,
   * поэтому привязка отзывается, а человек узнаёт об этом письмом: почта
   * здесь единственный оставшийся канал, и молчание оставило бы его без
   * уведомлений навсегда.
   */
  private async recordDeliveryFailure(
    kind: 'chat_blocked' | 'chat_not_found',
    chatId: bigint | undefined,
  ): Promise<void> {
    if (chatId === undefined) return;

    try {
      if (kind === 'chat_blocked') {
        await this.prisma.telegramLink.updateMany({
          where: { chatId, revokedAt: null },
          data: { chatBlocked: true },
        });
        return;
      }

      const links = await this.prisma.telegramLink.findMany({
        where: { chatId, revokedAt: null },
        select: { id: true, userId: true },
      });
      if (links.length === 0) return;

      await this.prisma.telegramLink.updateMany({
        where: { id: { in: links.map((l) => l.id) } },
        data: { revokedAt: new Date(), revokeReason: 'chat_not_found' },
      });

      for (const link of links) {
        await this.notifications.enqueue({
          templateKey: 'telegram.unlinked',
          channel: NotificationChannel.EMAIL,
          userId: link.userId,
          payload: { reason: 'chat_not_found' },
        });
      }

      this.logger.warn(`чат ${chatId} не найден — привязок отозвано: ${links.length}`);
    } catch (error) {
      // Учёт отказа не должен подменять собой сам отказ: вызывающий
      // обязан увидеть TelegramSendError, а не ошибку записи в БД.
      this.logger.error(
        `не удалось отметить отказ доставки (${kind}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // =========================================================================
  //  ЛИМИТЕРЫ
  // =========================================================================

  /**
   * Глобальный слот: не больше GLOBAL_LIMIT обращений за секунду.
   *
   * Считается в памяти процесса, а не в Redis, намеренно: лимит площадки
   * общий на бота, но при нескольких репликах точная общая арифметика
   * стоила бы round-trip на каждое сообщение. Реплики делят лимит грубо,
   * а перебор всё равно ловится 429 с retry_after, который мы соблюдаем.
   */
  private async takeGlobalSlot(): Promise<void> {
    const wait = this.gate.then(async () => {
      for (;;) {
        const now = Date.now();
        while (this.recentCalls.length > 0 && now - this.recentCalls[0]! >= GLOBAL_WINDOW_MS) {
          this.recentCalls.shift();
        }
        if (this.recentCalls.length < GLOBAL_LIMIT) {
          this.recentCalls.push(now);
          return;
        }
        await sleep(GLOBAL_WINDOW_MS - (now - this.recentCalls[0]!) + 5);
      }
    });

    // Отказ одного ожидающего не должен рвать цепочку остальным.
    this.gate = wait.catch(() => undefined);
    await wait;
  }

  /**
   * Слот чата: не чаще одного нового сообщения в секунду.
   *
   * Не дождались за три попытки — отправляем всё равно. Лимитер здесь
   * инструмент вежливости, а не рубеж безопасности: удержать сообщение
   * навсегда хуже, чем получить 429, который мы умеем пережидать.
   * Недоступный Redis по той же причине означает «пропускаем».
   */
  private async takeChatSlot(chatId: bigint): Promise<void> {
    const key = `${SEND_LOCK_PREFIX}${chatId}`;

    for (let attempt = 0; attempt < SEND_LOCK_ATTEMPTS; attempt += 1) {
      try {
        const acquired = await this.redis.client.set(key, '1', 'EX', 1, 'NX');
        if (acquired !== null) return;
      } catch {
        return;
      }
      await sleep(SEND_LOCK_WAIT_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
