import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { RedisService } from '../src/common/redis/redis.service';
import type { NotificationService } from '../src/modules/notifications/notification.service';
import { escapeHtml, truncate } from '../src/modules/telegram-bot/telegram-html';
import {
  parseUpdateJson,
  quoteLossyIntegers,
} from '../src/modules/telegram-bot/dto/telegram-update.types';
import {
  TelegramApiService,
  TelegramSendError,
} from '../src/modules/telegram-bot/telegram.api';
import type { TelegramBotConfig } from '../src/modules/telegram-bot/telegram-bot.config';

/**
 * Транспорт бота проверяется без сети: fetch подменяется, а решения,
 * которые принимает клиент, наблюдаются по типу брошенной ошибки.
 *
 * Ловится три класса ошибок, каждый из которых иначе обнаруживается
 * только в бою:
 *
 *  1. Экранирование. Telegram разбирает HTML в тексте, и чужой @username
 *     с «<» либо роняет отправку целиком, либо превращает часть экрана
 *     бота в чужую ссылку.
 *  2. Классификация отказов. Telegram различает «бот заблокирован» и
 *     «чат не найден» ТОЛЬКО текстом при общем коде 400/403. Ошибка
 *     разбора здесь означает восемь часов ретраев в заблокированный чат
 *     либо, наоборот, отзыв живой привязки.
 *  3. Точность идентификаторов. JSON.parse превращает числа в double ДО
 *     reviver'а: идентификатор выше 2^53 теряется молча и один раз —
 *     привязкой к чужому аккаунту.
 */

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const CHAT_ID = 987654321n;

interface Fakes {
  service: TelegramApiService;
  updateMany: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
}

function makeService(opts: { enabled?: boolean; links?: Array<{ id: string; userId: string }> } = {}): Fakes {
  const config = {
    enabled: opts.enabled ?? true,
    token: TOKEN,
  } as unknown as TelegramBotConfig;

  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findMany = vi.fn(async () => opts.links ?? []);
  const prisma = {
    telegramLink: { updateMany, findMany },
  } as unknown as PrismaService;

  // set возвращает 'OK' — блокировка отправки в чат берётся с первой попытки,
  // иначе тест ждал бы реальные 400 мс на каждую.
  const redis = {
    client: { set: vi.fn(async () => 'OK') },
  } as unknown as RedisService;

  const enqueue = vi.fn(async () => 'notification-id');
  const notifications = { enqueue } as unknown as NotificationService;

  return {
    service: new TelegramApiService(config, prisma, redis, notifications),
    updateMany,
    findMany,
    enqueue,
  };
}

/** Ответ Bot API. ok:false у Telegram приезжает с HTTP-статусом ошибки. */
function reply(status: number, body: Record<string, unknown>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockFetch(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('escapeHtml', () => {
  it('заменяет все четыре опасных символа', () => {
    expect(escapeHtml('<b>&"</b>')).toBe('&lt;b&gt;&amp;&quot;&lt;/b&gt;');
  });

  it('обрабатывает амперсанд первым', () => {
    // Обратный порядок дал бы &amp;lt; — пользователь увидел бы сущность
    // вместо символа, и это первый признак того, что порядок перепутан.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('обезвреживает разметку в чужом username', () => {
    const injected = '<a href="https://phish.example">служба поддержки</a>';
    expect(escapeHtml(injected)).not.toContain('<a');
    expect(escapeHtml(injected)).not.toContain('href="');
  });

  it('пустая строка на null и undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('truncate', () => {
  it('не трогает строку в пределах лимита', () => {
    expect(truncate('короткая', 20)).toBe('короткая');
  });

  it('укладывается ровно в лимит вместе с многоточием', () => {
    const cut = truncate('абвгдеёжзийклмноп', 10);
    expect(cut.length).toBe(10);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('TelegramApiService — классификация отказов Bot API', () => {
  it('отправляет сообщение и возвращает номер', async () => {
    const fetchMock = mockFetch(reply(200, { ok: true, result: { message_id: 42 } }));
    const { service } = makeService();

    await expect(service.sendMessage(CHAT_ID, 'привет')).resolves.toEqual({ messageId: 42 });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;
    // chat_id уходит строкой: JSON.stringify на bigint бросает TypeError,
    // а глобальный toJSON из main.ts отдал бы число с потерей точности.
    expect(body.chat_id).toBe('987654321');
    expect(body.parse_mode).toBe('HTML');
    expect(body.disable_web_page_preview).toBe(true);
  });

  it('403 «bot was blocked» → chat_blocked и отметка в telegram_links', async () => {
    mockFetch(reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
    const { service, updateMany } = makeService();

    const error = await service.sendMessage(CHAT_ID, 'привет').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramSendError);
    expect((error as TelegramSendError).kind).toBe('chat_blocked');
    // Блокировка — НЕ отвязка: ставится только флаг, привязка живёт.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { chatBlocked: true } }),
    );
  });

  it('403 «user is deactivated» тоже считается chat_blocked', async () => {
    mockFetch(reply(403, { ok: false, error_code: 403, description: 'Forbidden: user is deactivated' }));
    const { service } = makeService();

    const error = (await service.sendMessage(CHAT_ID, 'привет').catch((e: unknown) => e)) as TelegramSendError;
    expect(error.kind).toBe('chat_blocked');
  });

  it('400 «chat not found» → chat_not_found, отзыв привязки и письмо', async () => {
    mockFetch(reply(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }));
    const { service, updateMany, enqueue } = makeService({
      links: [{ id: 'link-1', userId: 'user-1' }],
    });

    const error = (await service.sendMessage(CHAT_ID, 'привет').catch((e: unknown) => e)) as TelegramSendError;

    expect(error.kind).toBe('chat_not_found');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokeReason: 'chat_not_found' }),
      }),
    );
    // Почта — единственный оставшийся канал: без письма человек молча
    // перестал бы получать уведомления навсегда.
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateKey: 'telegram.unlinked', userId: 'user-1' }),
    );
  });

  it('429 отдаёт retry_after из parameters', async () => {
    // 30 секунд больше порога ожидания на месте — клиент обязан отдать
    // решение наружу, а не держать слот лимитера полминуты.
    mockFetch(
      reply(429, {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 30',
        parameters: { retry_after: 30 },
      }),
    );
    const { service } = makeService();

    const error = (await service.sendMessage(CHAT_ID, 'привет').catch((e: unknown) => e)) as TelegramSendError;

    expect(error.kind).toBe('rate_limited');
    expect(error.retryAfterSec).toBe(30);
  });

  it('неизвестный 400 → bad_request, а не бесконечные повторы', async () => {
    mockFetch(reply(400, { ok: false, error_code: 400, description: "Bad Request: can't parse entities" }));
    const { service } = makeService();

    const error = (await service.sendMessage(CHAT_ID, '<b>').catch((e: unknown) => e)) as TelegramSendError;
    expect(error.kind).toBe('bad_request');
  });

  it('«message is not modified» при правке экрана не считается ошибкой', async () => {
    // Пользователь нажал кнопку текущего экрана — рисовать ему ошибку не за что.
    mockFetch(
      reply(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: message is not modified',
      }),
    );
    const { service } = makeService();

    await expect(service.editMessageText(CHAT_ID, 5, 'тот же текст')).resolves.toBeUndefined();
  });

  it('выключенный рубильник даёт окончательный отказ, а не повторы', async () => {
    const { service } = makeService({ enabled: false });

    const error = (await service.sendMessage(CHAT_ID, 'привет').catch((e: unknown) => e)) as TelegramSendError;
    expect(error.kind).toBe('bad_request');
  });
});

describe('Разбор апдейта — сохранность идентификаторов', () => {
  it('целое выше 2^53 переживает разбор без потери точности', () => {
    // 9007199254740993 = 2^53 + 1. Обычный JSON.parse отдаёт 9007199254740992.
    const raw = '{"update_id":10,"message":{"message_id":1,"date":1,"chat":{"id":9007199254740993,"type":"private"},"from":{"id":9007199254740993,"is_bot":false,"first_name":"И"}}}';

    const update = parseUpdateJson(raw);

    expect(update?.message?.chat.id).toBe(9007199254740993n);
    expect(update?.message?.from?.id).toBe(9007199254740993n);
  });

  it('не искажает текст пользователя, похожий на JSON', () => {
    // Замена регуляркой по имени поля испортила бы этот текст молча —
    // в поддержке это выглядело бы как порча данных без источника.
    const text = '{"id":9007199254740993}';
    const raw = JSON.stringify({
      update_id: 11,
      message: {
        message_id: 2,
        date: 1,
        chat: { id: 5, type: 'private' },
        from: { id: 5, is_bot: false, first_name: 'И' },
        text,
      },
    });

    expect(parseUpdateJson(raw)?.message?.text).toBe(text);
  });

  it('не трогает дробные числа', () => {
    expect(quoteLossyIntegers('{"a":1.00000000000000001,"b":1e20}')).toBe(
      '{"a":1.00000000000000001,"b":1e20}',
    );
  });

  it('отрицательный идентификатор группы разбирается как есть', () => {
    const raw = '{"update_id":12,"my_chat_member":{"chat":{"id":-1001234567890,"type":"supergroup"},"from":{"id":5,"is_bot":false,"first_name":"И"},"date":1,"old_chat_member":{"user":{"id":7,"is_bot":true,"first_name":"bot"},"status":"left"},"new_chat_member":{"user":{"id":7,"is_bot":true,"first_name":"bot"},"status":"member"}}}';

    expect(parseUpdateJson(raw)?.my_chat_member?.chat.id).toBe(-1001234567890n);
  });

  it('id колбэка остаётся строкой', () => {
    // В Bot API callback_query.id объявлен строкой. Разбор его в bigint
    // сломал бы answerCallbackQuery, и у пользователя навсегда остались
    // бы часики на кнопке.
    const raw = '{"update_id":13,"callback_query":{"id":"4382bfdwdsb323b2d9","from":{"id":5,"is_bot":false,"first_name":"И"},"data":"cb:root"}}';

    const query = parseUpdateJson(raw)?.callback_query;
    expect(query?.id).toBe('4382bfdwdsb323b2d9');
    expect(query?.data).toBe('cb:root');
  });

  it('мусор и битый JSON дают null, а не исключение', () => {
    expect(parseUpdateJson('не json')).toBeNull();
    expect(parseUpdateJson('{"нет":"update_id"}')).toBeNull();
    expect(parseUpdateJson('[]')).toBeNull();
  });

  it('неизвестный вид апдейта не мусор: возвращается сам апдейт без частей', () => {
    // Иначе расширение allowed_updates превращалось бы в поток
    // «отброшено» в журнале.
    const update = parseUpdateJson('{"update_id":14,"edited_message":{}}');
    expect(update?.update_id).toBe(14);
    expect(update?.message).toBeUndefined();
  });
});
