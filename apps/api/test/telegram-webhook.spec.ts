import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

import { TelegramWebhookController } from '../src/modules/telegram-bot/telegram-webhook.controller';
import type { TelegramBotConfig } from '../src/modules/telegram-bot/telegram-bot.config';
import type { TelegramUpdateQueue } from '../src/modules/telegram-bot/telegram-update.queue';

/**
 * Вебхук — единственный публичный вход бота: он помечен @Public(), то есть
 * глобальный JwtAuthGuard его не защищает, и всё, что стоит между интернетом
 * и очередью, — сверка двух секретов.
 *
 * Проверяется главное: любое расхождение даёт 404, а не 403 и не 500.
 * 403 подтвердил бы существование маршрута тому, кто его перебирает,
 * и превратил бы подбор в игру «горячо-холодно». Ошибка здесь не заметна
 * ни по одному внешнему признаку — отсюда тест.
 *
 * Секретов ДВА И ОНИ РАЗНЫЕ. Раньше в обеих проверках стояло одно значение,
 * и тест это состояние закреплял. Смысл пары в том, что путь протекает
 * в журналы обратного прокси, а заголовок нет; при одинаковых значениях
 * увидевший URL в чужом логе знал бы оба. Поэтому здесь два непохожих
 * литерала, и подстановка секрета пути в заголовок обязана давать 404.
 */

const PATH_SECRET = 'S3cr3t-webhook-path-32-symbols-min!!';
const HEADER_SECRET = 'An0ther-webhook-header-32-symbols!!!';

function makeController(
  opts: { enabled?: boolean; pathSecret?: string; headerSecret?: string } = {},
): {
  controller: TelegramWebhookController;
  push: ReturnType<typeof vi.fn>;
} {
  const config = {
    enabled: opts.enabled ?? true,
    webhookSecret: opts.pathSecret ?? PATH_SECRET,
    webhookHeaderSecret: opts.headerSecret ?? HEADER_SECRET,
  } as unknown as TelegramBotConfig;

  const push = vi.fn(async () => 'queued' as const);
  const queue = { push } as unknown as TelegramUpdateQueue;

  return { controller: new TelegramWebhookController(config, queue), push };
}

/** Запрос с сырым телом — так его отдаёт парсер из main.ts. */
function makeRequest(raw = '{"update_id":1}'): FastifyRequest {
  return { rawBody: raw } as unknown as FastifyRequest;
}

const BODY = { update_id: 1 };

describe('TelegramWebhookController — сверка секретов', () => {
  it('принимает апдейт, когда совпали и путь, и заголовок', async () => {
    const { controller, push } = makeController();

    await expect(
      controller.receive(PATH_SECRET, HEADER_SECRET, BODY, makeRequest()),
    ).resolves.toBeUndefined();

    expect(push).toHaveBeenCalledTimes(1);
  });

  it('отдаёт 404 при неверном секрете в пути', async () => {
    const { controller, push } = makeController();

    await expect(
      controller.receive('не-тот-секрет-той-же-длины-аааааааа', HEADER_SECRET, BODY, makeRequest()),
    ).rejects.toMatchObject({ status: 404 });

    expect(push).not.toHaveBeenCalled();
  });

  it('отдаёт 404 при неверном секрете в заголовке', async () => {
    // Путь верный — значит, злоумышленник вычитал его из журнала прокси.
    // Заголовок и есть то, чего в журнале нет.
    const { controller, push } = makeController();

    await expect(
      controller.receive(PATH_SECRET, 'другой-заголовок', BODY, makeRequest()),
    ).rejects.toMatchObject({ status: 404 });

    expect(push).not.toHaveBeenCalled();
  });

  it('секрет пути, подставленный в заголовок, НЕ подходит', async () => {
    // Главный тест этой пары: он падал бы, если бы контроллер снова начал
    // сверять оба места с одним значением. Ровно этот сценарий и есть
    // «утёк URL из логов прокси».
    const { controller, push } = makeController();

    await expect(
      controller.receive(PATH_SECRET, PATH_SECRET, BODY, makeRequest()),
    ).rejects.toMatchObject({ status: 404 });

    expect(push).not.toHaveBeenCalled();
  });

  it('отдаёт 404 при отсутствующем заголовке', async () => {
    const { controller, push } = makeController();

    await expect(
      controller.receive(PATH_SECRET, undefined, BODY, makeRequest()),
    ).rejects.toMatchObject({ status: 404 });

    expect(push).not.toHaveBeenCalled();
  });

  it('отдаёт 404 при выключенном рубильнике, даже если секреты верны', async () => {
    // Выключенный бот обязан быть неотличим от несуществующего маршрута:
    // иначе сам рубильник сообщает, что бот на этом хосте вообще есть.
    const { controller, push } = makeController({ enabled: false });

    await expect(
      controller.receive(PATH_SECRET, HEADER_SECRET, BODY, makeRequest()),
    ).rejects.toMatchObject({ status: 404 });

    expect(push).not.toHaveBeenCalled();
  });

  it('отдаёт 404 при пустом ожидаемом секрете', async () => {
    // Недонастроенный стенд не должен принимать апдейты от кого угодно:
    // пустое «ожидаемое» значение совпало бы с пустым присланным.
    const { controller, push } = makeController({ pathSecret: '', headerSecret: '' });

    await expect(controller.receive('', undefined, BODY, makeRequest())).rejects.toMatchObject({
      status: 404,
    });

    expect(push).not.toHaveBeenCalled();
  });

  it('отдаёт 404, если задан только один из двух секретов', async () => {
    // Полузаполненное окружение — состояние выкладки, где вторую переменную
    // забыли. Принимать апдейты «по одному секрету» в таком виде нельзя.
    const { controller, push } = makeController({ headerSecret: '' });

    await expect(
      controller.receive(PATH_SECRET, '', BODY, makeRequest()),
    ).rejects.toMatchObject({ status: 404 });

    expect(push).not.toHaveBeenCalled();
  });

  it('кладёт в очередь СЫРОЕ тело, а не разобранное', async () => {
    // Идентификаторы Telegram приходят числами; разобранный объект уже
    // мог потерять точность на значениях выше 2^53, сырая строка — нет.
    const raw = '{"update_id":7,"message":{"chat":{"id":9007199254740993}}}';
    const { controller, push } = makeController();

    await controller.receive(PATH_SECRET, HEADER_SECRET, BODY, makeRequest(raw));

    expect(push).toHaveBeenCalledWith(raw);
  });

  it('просит Telegram повторить, если очередь не приняла апдейт', async () => {
    // 503, а не 200: на 200 Telegram считает апдейт доставленным.
    const queue = {
      push: vi.fn(async () => 'unavailable' as const),
    } as unknown as TelegramUpdateQueue;

    const withFullQueue = new TelegramWebhookController(
      {
        enabled: true,
        webhookSecret: PATH_SECRET,
        webhookHeaderSecret: HEADER_SECRET,
      } as unknown as TelegramBotConfig,
      queue,
    );

    await expect(
      withFullQueue.receive(PATH_SECRET, HEADER_SECRET, BODY, makeRequest()),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('отвечает 200 на неразбираемое тело: повтор пришлёт тот же мусор', async () => {
    const queue = {
      push: vi.fn(async () => 'invalid' as const),
    } as unknown as TelegramUpdateQueue;

    const controller = new TelegramWebhookController(
      {
        enabled: true,
        webhookSecret: PATH_SECRET,
        webhookHeaderSecret: HEADER_SECRET,
      } as unknown as TelegramBotConfig,
      queue,
    );

    await expect(
      controller.receive(PATH_SECRET, HEADER_SECRET, BODY, makeRequest()),
    ).resolves.toBeUndefined();
  });
});
