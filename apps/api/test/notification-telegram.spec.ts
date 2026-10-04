import { NotificationChannel, TelegramLinkScope, TelegramNotifyCategory } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../src/modules/notifications/notification.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { RedisService } from '../src/common/redis/redis.service';
import type { SettingsService } from '../src/common/settings/settings.service';
import type { BotRateService } from '../src/modules/telegram-bot/bot-rate.service';
import type { TelegramBotConfig } from '../src/modules/telegram-bot/telegram-bot.config';

/**
 * Канал TELEGRAM в подсистеме уведомлений.
 *
 * Четыре класса ошибок, которые этот файл ловит и которые иначе обнаружились
 * бы только на живых людях.
 *
 * 1. АДРЕС НЕ ИЗ ТОЙ ТАБЛИЦЫ. В базе есть oauth_accounts с provider_user_id
 *    от Telegram — он выглядит как подходящий идентификатор и им не является:
 *    это id пользователя виджета входа, а не чата с ботом. Отправка по нему
 *    даёт «chat not found», а этот ответ трактуется как «привязки больше нет»
 *    и отзывает живую привязку. Ошибка стоит человеку второго канала связи
 *    и выглядит при этом как сбой Telegram.
 *
 * 2. КЛЮЧ ЛИЦЕНЗИИ В ПЕРЕПИСКЕ. Payload события выдачи лицензии содержит
 *    licenseKey — он нужен письму. В Telegram он не нужен НИКОГДА (§7 ТЗ
 *    бота): переписка живёт в облаке, синхронизируется на все устройства
 *    и показывается на экране блокировки. Вырезание сделано механизмом,
 *    а не дисциплиной авторов шаблонов, — тест проверяет именно механизм.
 *
 * 3. ТИХИЕ ЧАСЫ, СЪЕВШИЕ ТРЕВОГУ. Откладывать до утра нужно бытовое
 *    («лицензия истекает через 7 дней»), а не «к вашему аккаунту подключён
 *    чужой Telegram». Второе, отложенное до 08:00, приходит через восемь
 *    часов после того, как что-то ещё можно было сделать.
 *
 * 4. ФИЛЬТР, СЪЕВШИЙ ПИСЬМО. Любая проверка Telegram-ветки обязана глушить
 *    только чат. Письмо — независимый якорь восстановления доступа, и оно
 *    уходит при выключенном боте, отсутствующей привязке, выключенной
 *    категории и исчерпанном потолке одинаково.
 */

const USER_ID = '019fbacc-0000-7000-8000-0000000000aa';
const LINK_ID = '019fbacc-0000-7000-8000-0000000000bb';
/** Заведомо больше 2^32: на Number такой chat_id сломался бы молча. */
const CHAT_ID = 8_589_934_592n;

type Link = {
  id: string;
  chatId: bigint;
  locale: string;
  scope: TelegramLinkScope;
  revokedAt: Date | null;
  chatBlocked: boolean;
  expiresAt: Date | null;
};

const ACTIVE_LINK: Link = {
  id: LINK_ID,
  chatId: CHAT_ID,
  locale: 'ru',
  scope: TelegramLinkScope.USER,
  revokedAt: null,
  chatBlocked: false,
  expiresAt: null,
};

interface Options {
  /** Строки telegram_links, среди которых ищет findFirst. */
  links?: Link[];
  /** Настройки категорий: category → enabled. Отсутствие строки = включено. */
  prefs?: Partial<Record<TelegramNotifyCategory, boolean>>;
  /** Рубильник TELEGRAM_BOT_ENABLED. */
  enabled?: boolean;
  /** Что отвечает счётчик потолка уведомлений. */
  rateAllows?: boolean;
  /** Шаблон, который вернёт БД в render(). */
  template?: { subject: string | null; body: string; isActive: boolean };
}

function makeService(options: Options = {}) {
  const created: Array<Record<string, unknown>> = [];
  const redisKeys: string[] = [];
  const takenKeys = new Set<string>();
  const links = options.links ?? [ACTIVE_LINK];

  const prisma = {
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
    },
    user: {
      findUnique: vi.fn(async () => ({ email: 'owner@example.test', locale: 'ru' })),
    },
    telegramLink: {
      // Условие findFirst повторяется вручную: смысл теста в том, ЧТО именно
      // мы считаем действующей привязкой, а не в том, что Prisma умеет where.
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const now = new Date();
        const match = links.find(
          (link) =>
            link.revokedAt === null &&
            !link.chatBlocked &&
            (link.expiresAt === null || link.expiresAt > now),
        );
        return where.userId === USER_ID && match ? match : null;
      }),
    },
    telegramNotificationPref: {
      findUnique: vi.fn(
        async ({ where }: { where: { linkId_category: { category: TelegramNotifyCategory } } }) => {
          const enabled = options.prefs?.[where.linkId_category.category];
          return enabled === undefined ? null : { enabled };
        },
      ),
    },
    notificationTemplate: {
      findUnique: vi.fn(async () => options.template ?? null),
    },
  } as unknown as PrismaService;

  const settings = { getString: vi.fn(async () => 'ru') } as unknown as SettingsService;

  // SET NX: второй раз тот же ключ не выставляется — как в живом Redis.
  const redis = {
    client: {
      set: vi.fn(async (key: string) => {
        redisKeys.push(key);
        if (takenKeys.has(key)) return null;
        takenKeys.add(key);
        return 'OK';
      }),
    },
  } as unknown as RedisService;

  const telegramConfig = { enabled: options.enabled ?? true } as unknown as TelegramBotConfig;

  const botRate = {
    hit: vi.fn(async () => options.rateAllows ?? true),
  } as unknown as BotRateService;

  const service = new NotificationService(prisma, settings, redis, telegramConfig, botRate);

  return { service, created, redisKeys, redis };
}

/** Строка уведомления нужного канала среди того, что ушло в notification.create. */
function rowFor(created: Array<Record<string, unknown>>, channel: NotificationChannel) {
  return created.find((row) => row.channel === channel);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveRecipient — адрес канала TELEGRAM', () => {
  it('адресом становится chat_id из telegram_links, а не идентификатор OAuth', async () => {
    const { service, created } = makeService();

    await service.enqueue({
      templateKey: 'telegram.linked',
      channel: NotificationChannel.TELEGRAM,
      userId: USER_ID,
    });

    expect(rowFor(created, NotificationChannel.TELEGRAM)?.recipient).toBe(String(CHAT_ID));
  });

  it('заблокированный чат получателем не считается — уведомление не ставится', async () => {
    const { service, created } = makeService({ links: [{ ...ACTIVE_LINK, chatBlocked: true }] });

    const id = await service.enqueue({
      templateKey: 'telegram.linked',
      channel: NotificationChannel.TELEGRAM,
      userId: USER_ID,
    });

    // Иначе очередь восемь часов долбилась бы в 403 «bot was blocked»,
    // а человек всё это время получал бы только письма — и правильно.
    expect(id).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('истёкшая привязка получателем не считается', async () => {
    const { service, created } = makeService({
      links: [{ ...ACTIVE_LINK, expiresAt: new Date(Date.now() - 1000) }],
    });

    await service.enqueue({
      templateKey: 'telegram.linked',
      channel: NotificationChannel.TELEGRAM,
      userId: USER_ID,
    });

    expect(created).toHaveLength(0);
  });
});

describe('enqueueMulti — письмо всегда, Telegram по возможности', () => {
  it('без привязки уходит только письмо', async () => {
    const { service, created } = makeService({ links: [] });

    const result = await service.enqueueMulti({
      templateKey: 'license.issued',
      userId: USER_ID,
      payload: { productName: 'FC 26' },
    });

    expect(result.email).not.toBeNull();
    expect(result.telegram).toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0]?.channel).toBe(NotificationChannel.EMAIL);
  });

  it('выключенный рубильник бота не мешает письму', async () => {
    const { service, created } = makeService({ enabled: false });

    const result = await service.enqueueMulti({ templateKey: 'license.issued', userId: USER_ID });

    expect(result.email).not.toBeNull();
    expect(result.telegram).toBeNull();
    expect(rowFor(created, NotificationChannel.EMAIL)).toBeDefined();
  });

  it('шаблон без категории (письмо со ссылкой восстановления) в чат не уходит', async () => {
    const { service, created } = makeService();

    // auth.password_reset содержит ссылку смены пароля. Список категорий —
    // белый: ключа в нём нет, значит Telegram-копии нет тоже.
    const result = await service.enqueueMulti({
      templateKey: 'auth.password_reset',
      userId: USER_ID,
    });

    expect(result.telegram).toBeNull();
    expect(rowFor(created, NotificationChannel.TELEGRAM)).toBeUndefined();
  });

  it('выключенная категория DEVICE глушит чат, но не почту', async () => {
    const { service, created } = makeService({ prefs: { DEVICE: false } });

    await service.enqueueMulti({ templateKey: 'hwid.reset', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.EMAIL)).toBeDefined();
    expect(rowFor(created, NotificationChannel.TELEGRAM)).toBeUndefined();
  });

  it('SECURITY доходит до чата даже выключённой настройкой', async () => {
    const { service, created } = makeService({ prefs: { SECURITY: false } });

    await service.enqueueMulti({ templateKey: 'telegram.linked', userId: USER_ID });

    // Возможность выключить эту категорию — готовый сценарий для угонщика:
    // привязал свой чат, выключил SECURITY, дальше тишина.
    expect(rowFor(created, NotificationChannel.TELEGRAM)).toBeDefined();
  });

  it('категория ADMIN не уходит в чат обычного пользователя', async () => {
    const { service, created } = makeService();

    await service.enqueueMulti({ templateKey: 'order.awaiting_confirmation', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.TELEGRAM)).toBeUndefined();
  });

  it('категория ADMIN уходит в чат с областью ADMIN', async () => {
    const { service, created } = makeService({
      links: [{ ...ACTIVE_LINK, scope: TelegramLinkScope.ADMIN }],
    });

    await service.enqueueMulti({ templateKey: 'order.awaiting_confirmation', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.TELEGRAM)).toBeDefined();
  });

  it('исчерпанный потолок часа глушит чат, но не почту', async () => {
    const { service, created } = makeService({ rateAllows: false });

    await service.enqueueMulti({ templateKey: 'license.expiring', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.EMAIL)).toBeDefined();
    expect(rowFor(created, NotificationChannel.TELEGRAM)).toBeUndefined();
  });

  it('исчерпанный потолок часа НЕ глушит SECURITY', async () => {
    const { service, created } = makeService({ rateAllows: false });

    await service.enqueueMulti({ templateKey: 'telegram.linked', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.TELEGRAM)).toBeDefined();
  });

  it('язык Telegram-копии берётся из привязки, а не из профиля', async () => {
    const { service, created } = makeService({ links: [{ ...ACTIVE_LINK, locale: 'en' }] });

    await service.enqueueMulti({ templateKey: 'license.issued', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.TELEGRAM)?.locale).toBe('en');
  });
});

describe('sanitizeTelegramPayload — ключ лицензии не попадает в переписку', () => {
  it('licenseKey вырезается, вместо него появляется maskedKey', async () => {
    const { service, created } = makeService();

    await service.enqueueMulti({
      templateKey: 'license.issued',
      userId: USER_ID,
      payload: {
        username: 'petya',
        productName: 'FC 26',
        licenseKey: 'FC26-ACDE-FGHJ-KMNP-QRTU',
      },
    });

    const email = rowFor(created, NotificationChannel.EMAIL)?.payload as Record<string, unknown>;
    const telegram = rowFor(created, NotificationChannel.TELEGRAM)?.payload as Record<
      string,
      unknown
    >;

    // Письмо ключ получает: покупателю его надо куда-то ввести.
    expect(email.licenseKey).toBe('FC26-ACDE-FGHJ-KMNP-QRTU');

    expect(telegram.licenseKey).toBeUndefined();
    expect(telegram.maskedKey).toBe('FC26-****-****-****-QRTU');
    expect(telegram.productName).toBe('FC 26');
  });

  it('вырезаются и остальные секретные имена полей', async () => {
    const { service, created } = makeService();

    await service.enqueueMulti({
      templateKey: 'license.issued',
      userId: USER_ID,
      payload: { code: '1234', token: 'abc', secret: 'x', password: 'y', productName: 'FC 26' },
    });

    const telegram = rowFor(created, NotificationChannel.TELEGRAM)?.payload as Record<
      string,
      unknown
    >;

    expect(Object.keys(telegram)).toEqual(['productName']);
  });

  it('ключ внутри свободного текста тоже вырезается', async () => {
    const { service, created } = makeService();

    await service.enqueueMulti({
      templateKey: 'license.revoked',
      userId: USER_ID,
      payload: { reason: 'дубль ключа FC26-ACDE-FGHJ-KMNP-QRTU у другого покупателя' },
    });

    const telegram = rowFor(created, NotificationChannel.TELEGRAM)?.payload as Record<
      string,
      unknown
    >;

    // Поле reason заполняет администратор руками — списком запрещённых
    // ИМЁН полей такой ключ не поймать, ловит только цензор по содержимому.
    expect(String(telegram.reason)).not.toContain('ACDE-FGHJ');
    expect(String(telegram.reason)).toContain('***');
  });
});

describe('Тихие часы 23:00–08:00 МСК', () => {
  it('02:30 МСК откладывается до 08:00 того же утра', async () => {
    // 02:30 МСК 10 августа = 23:30 UTC 9 августа.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T23:30:00.000Z'));

    const { service, created } = makeService();
    await service.enqueueMulti({ templateKey: 'license.expiring', userId: USER_ID });

    const scheduledAt = rowFor(created, NotificationChannel.TELEGRAM)?.scheduledAt as Date;
    // 08:00 МСК 10 августа = 05:00 UTC 10 августа.
    expect(scheduledAt?.toISOString()).toBe('2026-08-10T05:00:00.000Z');
  });

  it('23:10 МСК откладывается на утро СЛЕДУЮЩИХ суток', async () => {
    // 23:10 МСК 10 августа = 20:10 UTC 10 августа.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T20:10:00.000Z'));

    const { service, created } = makeService();
    await service.enqueueMulti({ templateKey: 'license.expiring', userId: USER_ID });

    const scheduledAt = rowFor(created, NotificationChannel.TELEGRAM)?.scheduledAt as Date;
    expect(scheduledAt?.toISOString()).toBe('2026-08-11T05:00:00.000Z');
  });

  it('днём ничего не откладывается', async () => {
    // 15:00 МСК = 12:00 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));

    const { service, created } = makeService();
    await service.enqueueMulti({ templateKey: 'license.expiring', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.TELEGRAM)?.scheduledAt).toBeNull();
  });

  it('SECURITY будит: ночью уходит немедленно', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T23:30:00.000Z'));

    const { service, created } = makeService();
    await service.enqueueMulti({ templateKey: 'telegram.linked', userId: USER_ID });

    // Отложенное до утра «к вашему аккаунту подключён чужой чат» приходит
    // через восемь часов после того, как что-то ещё можно было сделать.
    expect(rowFor(created, NotificationChannel.TELEGRAM)?.scheduledAt).toBeNull();
  });

  it('ADMIN тоже будит', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T23:30:00.000Z'));

    const { service, created } = makeService({
      links: [{ ...ACTIVE_LINK, scope: TelegramLinkScope.ADMIN }],
    });
    await service.enqueueMulti({ templateKey: 'order.awaiting_confirmation', userId: USER_ID });

    expect(rowFor(created, NotificationChannel.TELEGRAM)?.scheduledAt).toBeNull();
  });
});

describe('Дедупликация Telegram-копий', () => {
  it('повтор того же события по той же лицензии отсеивается', async () => {
    const { service, created } = makeService();

    await service.enqueueMulti({
      templateKey: 'license.expiring',
      userId: USER_ID,
      payload: { licenseId: 'lic-1' },
    });
    await service.enqueueMulti({
      templateKey: 'license.expiring',
      userId: USER_ID,
      payload: { licenseId: 'lic-1' },
    });

    // Писем два, сообщений в чат — одно.
    expect(created.filter((r) => r.channel === NotificationChannel.EMAIL)).toHaveLength(2);
    expect(created.filter((r) => r.channel === NotificationChannel.TELEGRAM)).toHaveLength(1);
  });

  it('разные лицензии одного шаблона проходят обе', async () => {
    // Ось дедупликации — (userId, templateKey, licenseId). Без оси у человека
    // с тремя лицензиями, истекающими в один день, два уведомления из трёх
    // были бы съедены, и он узнал бы об истечении постфактум.
    const { service, created, redisKeys } = makeService();

    await service.enqueueMulti({
      templateKey: 'license.expiring',
      userId: USER_ID,
      payload: { licenseId: 'lic-1' },
    });
    await service.enqueueMulti({
      templateKey: 'license.expiring',
      userId: USER_ID,
      payload: { licenseId: 'lic-2' },
    });

    expect(redisKeys).toEqual([
      `tg:dedup:${USER_ID}:license.expiring:lic-1`,
      `tg:dedup:${USER_ID}:license.expiring:lic-2`,
    ]);
    expect(created.filter((r) => r.channel === NotificationChannel.TELEGRAM)).toHaveLength(2);
  });

  it('без licenseId осью становится хеш ключа, а не сам ключ', async () => {
    const { service, redisKeys } = makeService();

    await service.enqueueMulti({
      templateKey: 'hwid.reset',
      userId: USER_ID,
      payload: { licenseKey: 'FC26-ACDE-FGHJ-KMNP-QRTU' },
    });

    // Ключи Redis видны в MONITOR и в slowlog — то есть попали бы ровно туда,
    // куда §7.6 ТЗ запрещает попадать ключам лицензий.
    expect(redisKeys[0]).not.toContain('ACDE');
    expect(redisKeys[0]).toMatch(/^tg:dedup:.+:hwid\.reset:[0-9a-f]{16}$/);
  });

  it('SECURITY дедупликацию не проходит вовсе — Redis не трогается', async () => {
    const { service, redisKeys } = makeService();

    await service.enqueueMulti({ templateKey: 'telegram.linked', userId: USER_ID });
    await service.enqueueMulti({ templateKey: 'telegram.linked', userId: USER_ID });

    // Отвязали, привязали заново в тот же час — второе «бот подключён»
    // обязано дойти: именно оно и есть признак угона.
    expect(redisKeys).toHaveLength(0);
  });
});

describe('render — экранирование подстановок для Telegram', () => {
  it('значение подстановки экранируется, разметка шаблона остаётся', async () => {
    const { service } = makeService({
      template: {
        subject: null,
        body: '⚫️ <b>{{productName}}</b> отозвана. Причина: {{reason}}',
        isActive: true,
      },
    });

    const rendered = await service.render('license.revoked', NotificationChannel.TELEGRAM, 'ru', {
      productName: 'FC 26',
      reason: '<b>подделка</b> & возврат',
    });

    // Без экранирования чужой текст ломал бы нашу разметку, а Bot API
    // отвечал бы 400 на всё сообщение целиком.
    expect(rendered.body).toContain('<b>FC 26</b>');
    expect(rendered.body).toContain('&lt;b&gt;подделка&lt;/b&gt; &amp; возврат');
  });

  it('в письме подстановка НЕ экранируется', async () => {
    const { service } = makeService({
      template: { subject: null, body: 'Причина: {{reason}}', isActive: true },
    });

    const rendered = await service.render('license.revoked', NotificationChannel.EMAIL, 'ru', {
      reason: 'подделка & возврат',
    });

    expect(rendered.body).toBe('Причина: подделка & возврат');
  });

  it('ключ лицензии вырезается из готового текста Telegram-сообщения', async () => {
    // Последний рубеж: enqueue({channel: TELEGRAM}) можно позвать напрямую,
    // минуя санацию payload'а, — например, алертом администратору.
    const { service } = makeService({
      template: { subject: null, body: 'Ключ: {{licenseKey}}', isActive: true },
    });

    const rendered = await service.render('license.issued', NotificationChannel.TELEGRAM, 'ru', {
      licenseKey: 'FC26-ACDE-FGHJ-KMNP-QRTU',
    });

    expect(rendered.body).toBe('Ключ: ***');
  });
});
