import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { BotLinkService } from '../src/modules/telegram-bot/bot-link.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { NotificationService } from '../src/modules/notifications/notification.service';
import type { TwoFactorService } from '../src/modules/auth/two-factor.service';
import type { BotRateService } from '../src/modules/telegram-bot/bot-rate.service';
import type { TelegramApiService } from '../src/modules/telegram-bot/telegram.api';
import type { TelegramBotConfig } from '../src/modules/telegram-bot/telegram-bot.config';
import type { TgChat, TgUser } from '../src/modules/telegram-bot/dto/telegram-update.types';
import type { AuthenticatedUser } from '../src/modules/auth/guards/jwt-auth.guard';

/**
 * Привязка Telegram — единственное место, где посторонний человек может
 * получить второй канал управления чужим аккаунтом. Проверяются ровно те
 * четыре свойства, потеря которых не видна ни в одном сценарии ручного
 * тестирования, потому что «всё работает» и в сломанном виде:
 *
 *   1. В базу уходит ХЕШ токена, а не сам токен. Сломав это, мы получим
 *      работающего бота и дамп базы, который является списком отмычек.
 *   2. Три разные причины отказа дают ОДИН текст. Различимые ответы
 *      превращают бота в оракул «такой токен существовал».
 *   3. Новая привязка вытесняет старую, а не сосуществует с ней. Иначе
 *      уведомления продолжают уходить в забытый чат.
 *   4. При включённой 2FA код обязателен. Без этого перехваченная сессия
 *      заводит канал доступа, переживающий смену пароля.
 */

const USER_ID = '019fbacc-0000-7000-8000-000000000001';
const LINK_ID = '019fbacc-0000-7000-8000-000000000002';
const OLD_LINK_ID = '019fbacc-0000-7000-8000-000000000003';
const OTHER_USER_ID = '019fbacc-0000-7000-8000-000000000004';

const FROM: TgUser = { id: 424242n, is_bot: false, first_name: 'Иван', username: 'ivan' };
const CHAT: TgChat = { id: 424242n, type: 'private' };

interface Harness {
  service: BotLinkService;
  codeCreate: ReturnType<typeof vi.fn>;
  linkCreate: ReturnType<typeof vi.fn>;
  linkUpdate: ReturnType<typeof vi.fn>;
  linkDeleteMany: ReturnType<typeof vi.fn>;
  prefCreateMany: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  verifyTotp: ReturnType<typeof vi.fn>;
  hit: ReturnType<typeof vi.fn>;
}

/**
 * Сборка сервиса на литералах вместо Test.createTestingModule — так устроены
 * все остальные тесты проекта, и живой Postgres тут не нужен.
 */
function makeService(options: {
  /** Строки, которые вернёт атомарное гашение кода. Пусто = отказ. */
  redeemed?: Array<{ id: string; user_id: string; scope: 'USER' | 'ADMIN' }>;
  /** Привязки, уже занимающие уникальные слоты user_id / telegram_user_id. */
  blocking?: Array<{
    id: string;
    userId: string;
    chatId: bigint;
    telegramUserId: bigint;
    revokedAt: Date | null;
  }>;
  twoFactorEnabled?: boolean;
  hasAdminPermission?: boolean;
}): Harness {
  const codeCreate = vi.fn(async () => ({}));
  const linkCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    id: LINK_ID,
  }));
  const linkUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    id: OLD_LINK_ID,
  }));
  const linkDeleteMany = vi.fn(async () => ({ count: 1 }));
  const prefCreateMany = vi.fn(async () => ({ count: 4 }));

  const tx = {
    telegramLink: {
      findMany: vi.fn(async () => options.blocking ?? []),
      deleteMany: linkDeleteMany,
      update: linkUpdate,
      create: linkCreate,
    },
    telegramNotificationPref: {
      createMany: prefCreateMany,
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const prisma = {
    $queryRaw: vi.fn(async () => options.redeemed ?? []),
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    user: {
      findUnique: vi.fn(async () => ({
        id: USER_ID,
        status: 'ACTIVE',
        deletedAt: null,
        locale: 'ru',
        twoFactorEnabled: options.twoFactorEnabled ?? false,
        twoFactorConfirmedAt: options.twoFactorEnabled ? new Date() : null,
      })),
    },
    userRole: {
      findFirst: vi.fn(async () => (options.hasAdminPermission ? { userId: USER_ID } : null)),
    },
    telegramLinkCode: { create: codeCreate },
    telegramLink: { findUnique: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },
  } as unknown as PrismaService;

  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const enqueue = vi.fn(async () => 'notification-id');
  const notifications = { enqueue } as unknown as NotificationService;
  const verifyTotp = vi.fn(async () => undefined);
  const twoFactor = { verify: verifyTotp } as unknown as TwoFactorService;
  const hit = vi.fn(async () => true);
  const rate = { hit } as unknown as BotRateService;
  const sendMessage = vi.fn(async () => ({ messageId: 1 }));
  const telegram = { sendMessage } as unknown as TelegramApiService;
  const config = {
    enabled: true,
    deepLink: (token: string) => `https://t.me/pxcheats_bot?start=${token}`,
  } as unknown as TelegramBotConfig;

  return {
    service: new BotLinkService(prisma, audit, notifications, twoFactor, rate, telegram, config),
    codeCreate,
    linkCreate,
    linkUpdate,
    linkDeleteMany,
    prefCreateMany,
    sendMessage,
    enqueue,
    verifyTotp,
    hit,
  };
}

/**
 * Первый аргумент N-го вызова мока.
 *
 * Отдельная функция, потому что при strict-режиме tsconfig обращение
 * `mock.calls[0][0]` не проходит проверку типов: индекс массива может быть
 * пустым. Явный бросок здесь честнее восклицательного знака — если вызова
 * не было, тест обязан упасть с внятным текстом, а не с «cannot read
 * properties of undefined».
 */
function argOf<T>(fn: ReturnType<typeof vi.fn>, index = 0): T {
  const call = fn.mock.calls[index];
  if (!call) throw new Error(`ожидался вызов №${index + 1}, но его не было`);
  return call[0] as T;
}

function actor(permissions: string[] = []): AuthenticatedUser {
  return {
    id: USER_ID,
    sessionId: 'session',
    permissions: new Set(permissions),
    rolePriority: 10,
    twoFactorEnabled: false,
  };
}

describe('BotLinkService — выпуск кода привязки', () => {
  it('в базу уходит SHA-256, а не сам токен', async () => {
    const h = makeService({});

    const result = await h.service.initForUser({ actor: actor(), ip: '203.0.113.10' });

    expect(h.codeCreate).toHaveBeenCalledTimes(1);
    const written = argOf<{ data: { codeHash: string } }>(h.codeCreate).data;

    // Главное свойство: записанное значение — это хеш выданного токена.
    expect(written.codeHash).toBe(createHash('sha256').update(result.token, 'utf8').digest('hex'));
    // И оно НЕ равно самому токену — то есть по строке из базы привязку
    // не сделать.
    expect(written.codeHash).not.toBe(result.token);
    expect(JSON.stringify(written)).not.toContain(result.token);
  });

  it('токен влезает в лимит start-payload Telegram (64 символа)', async () => {
    const h = makeService({});
    const { token, deepLink } = await h.service.initForUser({ actor: actor() });

    // 32 байта base64url = 43 символа. Длиннее — Telegram молча обрежет,
    // и код станет неотличим от подделки.
    expect(token.length).toBeLessThanOrEqual(64);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(deepLink).toContain(token);
  });

  it('при включённой 2FA без кода выпуск отвергается', async () => {
    const h = makeService({ twoFactorEnabled: true });

    await expect(h.service.initForUser({ actor: actor() })).rejects.toMatchObject({
      response: { code: 'TWO_FACTOR_REQUIRED' },
    });

    // Код не выпущен: иначе перехваченная сессия получила бы второй канал
    // доступа в обход второго фактора.
    expect(h.codeCreate).not.toHaveBeenCalled();
  });

  it('при включённой 2FA код проверяется, и только потом выпускается токен', async () => {
    const h = makeService({ twoFactorEnabled: true });

    await h.service.initForUser({ actor: actor(), totpCode: '123456' });

    expect(h.verifyTotp).toHaveBeenCalledWith(USER_ID, '123456');
    expect(h.codeCreate).toHaveBeenCalledTimes(1);
  });

  it('область ADMIN без права не выдаётся', async () => {
    const h = makeService({});

    await expect(
      h.service.initForUser({ actor: actor(), scope: 'ADMIN' as never, totpCode: '123456' }),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });

  it('лимит списывается ДО проверки второго фактора', async () => {
    // Иначе эндпоинт превращается в бесплатный стенд для перебора TOTP.
    const h = makeService({ twoFactorEnabled: true });

    await expect(h.service.initForUser({ actor: actor() })).rejects.toThrow();

    expect(h.hit).toHaveBeenCalledWith(`tg:linkcode:${USER_ID}`, 5, 3600);
  });
});

describe('BotLinkService — подтверждение из чата', () => {
  it('несуществующий, использованный и просроченный код дают ОДИН ответ', async () => {
    // Все три случая на уровне SQL неразличимы: условие used_at IS NULL AND
    // expires_at > now() внутри UPDATE не возвращает строк ни в одном из них.
    // Тест фиксирует, что и снаружи они неразличимы тоже.
    const results = await Promise.all(
      [1, 2, 3].map(() => makeService({ redeemed: [] }).service.confirm('токен', FROM, CHAT)),
    );

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('привязка вне приватного чата отвергается', async () => {
    const h = makeService({ redeemed: [{ id: 'c1', user_id: USER_ID, scope: 'USER' }] });

    const result = await h.service.confirm('токен', FROM, { id: -100500n, type: 'supergroup' });

    expect(result).toEqual({ ok: false, reason: 'invalid' });
    // До гашения кода дело не дошло — иначе групповой чат сжигал бы чужой
    // действующий токен.
    expect(h.linkCreate).not.toHaveBeenCalled();
  });

  it('успешное подтверждение создаёт связь и набор настроек уведомлений', async () => {
    const h = makeService({ redeemed: [{ id: 'c1', user_id: USER_ID, scope: 'USER' }] });

    const result = await h.service.confirm('токен', FROM, CHAT);

    expect(result.ok).toBe(true);
    expect(h.linkCreate).toHaveBeenCalledTimes(1);

    const created = argOf<{ data: { expiresAt: Date; scope: string } }>(h.linkCreate).data;
    // 90 дней для обычной привязки — без молчаливого продления.
    const days = Math.round((created.expiresAt.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(90);
    expect(created.scope).toBe('USER');

    // Четыре категории: ADMIN обычному пользователю не создаётся.
    const prefs = argOf<{ data: unknown[] }>(h.prefCreateMany).data;
    expect(prefs).toHaveLength(4);
  });

  it('чужая привязка на том же telegram_user_id вытесняется', async () => {
    const h = makeService({
      redeemed: [{ id: 'c1', user_id: USER_ID, scope: 'USER' }],
      blocking: [
        {
          id: OLD_LINK_ID,
          userId: OTHER_USER_ID,
          chatId: 424242n,
          telegramUserId: 424242n,
          revokedAt: null,
        },
      ],
    });

    const result = await h.service.confirm('токен', FROM, CHAT);

    expect(result.ok).toBe(true);
    // Слот уникального telegram_user_id освобождён явно. Без этого создание
    // упало бы с P2002, потому что отзыв привязки мягкий и строка остаётся.
    expect(h.linkDeleteMany).toHaveBeenCalledTimes(1);
    const deleted = argOf<{ where: { id: { in: string[] } } }>(h.linkDeleteMany);
    expect(deleted.where.id.in).toEqual([OLD_LINK_ID]);

    // Прежний владелец аккаунта извещён письмом.
    const unlinked = h.enqueue.mock.calls.find(
      (call) => call[0].templateKey === 'telegram.unlinked',
    );
    expect(unlinked?.[0].userId).toBe(OTHER_USER_ID);

    // Прощание в ЭТОТ чат не шлётся: человек сидит в нём и сейчас увидит
    // экран успеха.
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('переезд аккаунта в другой чат прощается со старым', async () => {
    const h = makeService({
      redeemed: [{ id: 'c1', user_id: USER_ID, scope: 'USER' }],
      blocking: [
        {
          id: OLD_LINK_ID,
          userId: USER_ID,
          chatId: 111111n,
          telegramUserId: 111111n,
          revokedAt: null,
        },
      ],
    });

    await h.service.confirm('токен', FROM, CHAT);

    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(argOf<bigint>(h.sendMessage)).toBe(111111n);
  });

  it('повторная привязка того же чата воскрешает строку, а не создаёт новую', async () => {
    // Настройки уведомлений и номера обращений в поддержку ссылаются на
    // идентификатор привязки. Пересоздание сбрасывало бы тумблеры при
    // каждом продлении раз в 90 дней.
    const h = makeService({
      redeemed: [{ id: 'c1', user_id: USER_ID, scope: 'USER' }],
      blocking: [
        {
          id: OLD_LINK_ID,
          userId: USER_ID,
          chatId: 424242n,
          telegramUserId: 424242n,
          revokedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    });

    const result = await h.service.confirm('токен', FROM, CHAT);

    expect(result.ok).toBe(true);
    expect(h.linkUpdate).toHaveBeenCalledTimes(1);
    expect(h.linkCreate).not.toHaveBeenCalled();
    expect(h.linkDeleteMany).not.toHaveBeenCalled();

    const patched = argOf<{ data: { revokedAt: Date | null; revokeReason: string | null } }>(
      h.linkUpdate,
    ).data;
    // Признаки отзыва снимаются — иначе воскрешённая строка осталась бы
    // невидимой для resolve().
    expect(patched.revokedAt).toBeNull();
    expect(patched.revokeReason).toBeNull();
  });

  it('снятое право понижает область ADMIN до USER, а не отказывает', async () => {
    const h = makeService({
      redeemed: [{ id: 'c1', user_id: USER_ID, scope: 'ADMIN' }],
      hasAdminPermission: false,
    });

    const result = await h.service.confirm('токен', FROM, CHAT);

    expect(result.ok).toBe(true);
    const created = argOf<{ data: { scope: string; expiresAt: Date } }>(h.linkCreate).data;
    expect(created.scope).toBe('USER');
    expect(Math.round((created.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(90);
  });

  it('действующее право сохраняет область ADMIN и её тридцатидневный срок', async () => {
    const h = makeService({
      redeemed: [{ id: 'c1', user_id: USER_ID, scope: 'ADMIN' }],
      hasAdminPermission: true,
    });

    await h.service.confirm('токен', FROM, CHAT);

    const created = argOf<{ data: { scope: string; expiresAt: Date } }>(h.linkCreate).data;
    expect(created.scope).toBe('ADMIN');
    expect(Math.round((created.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(30);

    // Пятая категория (ADMIN) появляется только у админской области.
    const prefs = argOf<{ data: unknown[] }>(h.prefCreateMany).data;
    expect(prefs).toHaveLength(5);
  });
});
