import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { LicensesService } from '../src/modules/licenses/licenses.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedUser } from '../src/modules/auth/guards/jwt-auth.guard';
import type { NotificationService } from '../src/modules/notifications/notification.service';

/**
 * Ключ лицензии предъявительский: кто увидел — тот и владелец. Поэтому
 * проверяется ОТСУТСТВИЕ поля `key` в ручках чтения — регрессия тут бесшумная
 * (`include` вместо `select` в одной строке возвращает дыру целиком).
 * Живые Postgres и Redis не нужны: проверяется форма ответа и решение о доступе.
 */

const OWNER_ID = '019fbacc-0000-7000-8000-00000000000a';
const STRANGER_ID = '019fbacc-0000-7000-8000-00000000000b';
const LICENSE_ID = '019fbacc-0000-7000-8000-000000000001';
const FULL_KEY = 'FC26-ACDE-FGHJ-KMNP-QRTU';

function actor(permissions: string[], id = OWNER_ID): AuthenticatedUser {
  return {
    id,
    sessionId: 'сессия',
    permissions: new Set(permissions),
    rolePriority: permissions.includes('licenses.read.any') ? 80 : 10,
    twoFactorEnabled: false,
  };
}

/** Строка лицензии в том объёме, в каком её отдают select'ы сервиса. */
function licenseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LICENSE_ID,
    key: FULL_KEY,
    userId: OWNER_ID,
    productId: '019fbacc-0000-7000-8000-000000000002',
    planId: '019fbacc-0000-7000-8000-000000000003',
    status: 'ACTIVE',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    activatedAt: new Date('2026-01-02T00:00:00.000Z'),
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    blockedAt: null,
    blockedReason: null,
    revokedAt: null,
    revokedReason: null,
    currentDeviceId: null,
    hwidResetCount: 0,
    lastHwidResetAt: null,
    lastCheckAt: null,
    lastCheckCountry: null,
    lastClientVersion: null,
    orderId: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    product: { slug: 'fc26', name: 'FC 26' },
    plan: { id: '019fbacc-0000-7000-8000-000000000003', slug: 'month', name: 'Месяц', durationDays: 30 },
    user: { id: OWNER_ID, username: 'owner' },
    ...overrides,
  };
}

function makeService(rows: ReturnType<typeof licenseRow>[]) {
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const notifications = {
    enqueue: vi.fn(async () => null),
    enqueueMulti: vi.fn(async () => ({ email: null, telegram: null })),
  } as unknown as NotificationService;

  const prisma = {
    license: {
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => rows.length),
      findUnique: vi.fn(async () => rows[0] ?? null),
      update: vi.fn(async () => rows[0] ?? null),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    // Список строится SQL-запросом: первый — id страницы, второй — общее число.
    $queryRaw: vi.fn(async (query: { sql: string }) =>
      query.sql.includes('count(*)') ? [{ total: rows.length }] : rows.map((r) => ({ id: r.id })),
    ),
  } as unknown as PrismaService;

  return {
    service: new LicensesService(prisma, audit, notifications),
    prisma,
    audit,
    notifications,
  };
}

describe('LicensesService — ключ в ручках чтения', () => {
  it('list() не содержит key и отдаёт маску', async () => {
    const { service } = makeService([licenseRow()]);

    const result = await service.list(actor(['licenses.read.any']));
    const item = result.items[0] as Record<string, unknown>;

    expect(item).not.toHaveProperty('key');
    expect(item.maskedKey).toBe('FC26-****-****-****-QRTU');
    expect(String(item.maskedKey)).not.toContain('ACDE');
  });

  it('list() с правом .own фильтрует по себе, даже если прислан чужой userId', async () => {
    const { service, prisma } = makeService([licenseRow()]);

    await service.list(actor(['licenses.read.own']), { userId: STRANGER_ID });

    const query = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as unknown as { values: unknown[] };
    expect(query.values).toContain(OWNER_ID);
    expect(query.values).not.toContain(STRANGER_ID);
  });

  it('list() с правом .own игнорирует строку поиска по полям', async () => {
    const { service, prisma } = makeService([licenseRow()]);

    await service.list(actor(['licenses.read.own']), { q: 'user:stranger' });

    const query = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as unknown as { values: unknown[] };
    expect(query.values).not.toContain('stranger');
  });

  it('findById() не содержит key и отдаёт маску', async () => {
    const { service } = makeService([licenseRow()]);

    const license = (await service.findById(LICENSE_ID, actor(['licenses.read.own']))) as Record<
      string,
      unknown
    >;

    expect(license).not.toHaveProperty('key');
    expect(license.maskedKey).toBe('FC26-****-****-****-QRTU');
  });

  it('findById() не открывает чужую лицензию с правом .own', async () => {
    const { service } = makeService([licenseRow({ userId: STRANGER_ID })]);

    await expect(
      service.findById(LICENSE_ID, actor(['licenses.read.own'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findById() не запрашивает почту владельца без права .any', async () => {
    const { service, prisma } = makeService([licenseRow()]);

    await service.findById(LICENSE_ID, actor(['licenses.read.own']));

    const args = vi.mocked(prisma.license.findUnique).mock.calls[0]?.[0] as {
      select: { user: { select: { email: boolean } } };
    };
    expect(args.select.user.select.email).toBe(false);
  });

  it('findById() запрашивает почту владельца при праве .any', async () => {
    const { service, prisma } = makeService([licenseRow()]);

    await service.findById(LICENSE_ID, actor(['licenses.read.any'], STRANGER_ID));

    const args = vi.mocked(prisma.license.findUnique).mock.calls[0]?.[0] as {
      select: { user: { select: { email: boolean } } };
    };
    expect(args.select.user.select.email).toBe(true);
  });

  it('findById() не отдаёт хеши HWID из истории привязок', async () => {
    const { service, prisma } = makeService([licenseRow()]);

    await service.findById(LICENSE_ID, actor(['licenses.read.any'], STRANGER_ID));

    const args = vi.mocked(prisma.license.findUnique).mock.calls[0]?.[0] as {
      select: { hwidHistory: { select: Record<string, boolean> } };
    };
    expect(args.select.hwidHistory.select).not.toHaveProperty('oldHwidHash');
    expect(args.select.hwidHistory.select).not.toHaveProperty('newHwidHash');
  });
});

describe('LicensesService.revealKey', () => {
  it('владельцу отдаёт полный ключ и пишет факт показа в аудит', async () => {
    const { service, audit } = makeService([licenseRow()]);

    await expect(service.revealKey(LICENSE_ID, actor(['licenses.read.own']), 'telegram')).resolves.toEqual({
      key: FULL_KEY,
    });

    const entry = vi.mocked(audit.record).mock.calls[0]?.[0];
    expect(entry?.action).toBe('license.key.reveal');
    // В журнал — факт, а не значение: журнал читает поддержка.
    expect(JSON.stringify(entry)).not.toContain(FULL_KEY);
  });

  it('чужую лицензию не открывает и не пишет «ключ показан»', async () => {
    const { service, audit } = makeService([licenseRow({ userId: STRANGER_ID })]);

    await expect(
      service.revealKey(LICENSE_ID, actor(['licenses.read.own'])),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(vi.mocked(audit.record)).not.toHaveBeenCalled();
  });
});

describe('LicensesService.revoke — извещение владельца', () => {
  it('ставит уведомление license.revoked без полного ключа в payload', async () => {
    const row = licenseRow({ user: { username: 'owner', locale: 'ru' } });
    const { service, notifications } = makeService([row]);

    await service.revoke(LICENSE_ID, 'возврат средств', actor(['licenses.read.any'], STRANGER_ID));

    const call = vi.mocked(notifications.enqueueMulti).mock.calls[0]?.[0];
    expect(call?.templateKey).toBe('license.revoked');
    expect(call?.payload?.maskedKey).toBe('FC26-****-****-****-QRTU');
    expect(JSON.stringify(call?.payload)).not.toContain(FULL_KEY);
    // Ровно одно уведомление: дубль через enqueue означал бы два письма.
    expect(vi.mocked(notifications.enqueue)).not.toHaveBeenCalled();
  });
});
