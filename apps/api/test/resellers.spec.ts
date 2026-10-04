import { Prisma, ResellerStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ResellersService } from '../src/modules/resellers/resellers.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { PermissionsService } from '../src/common/rbac/permissions.service';
import type { RegistrationKeyService } from '../src/modules/auth/registration-key.service';
import type { AuthenticatedUser } from '../src/modules/auth/guards/jwt-auth.guard';
import type { HwidService } from '../src/modules/hwid/hwid.service';
import type { LicensesService } from '../src/modules/licenses/licenses.service';

/**
 * Реселлер: цена со скидкой, списание с баланса, отмена ключа, продление и
 * сброс привязки клиентам. Prisma заменена заглушками — проверяется логика
 * денег и ownership, а не SQL.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const PRODUCT = '019fbacc-0000-7000-8000-0000000000a1';
const OTHER_PRODUCT = '019fbacc-0000-7000-8000-0000000000a2';
const actor = { id: 'user-r', permissions: new Set(['reseller.panel']), rolePriority: 30 } as unknown as AuthenticatedUser;

function reseller(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    userId: 'user-r',
    displayName: 'Партнёр',
    status: ResellerStatus.ACTIVE,
    balance: D(1000),
    currency: 'RUB',
    discountPercent: D(25),
    creditLimit: D(0),
    allowedProductIds: [] as string[],
    hwidResetDailyLimit: 2,
    notes: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(opts: { reseller?: ReturnType<typeof reseller>; balanceAfter?: number | null; resetsToday?: number } = {}) {
  const r = opts.reseller ?? reseller();
  const queryRaw = vi.fn(async () => (opts.balanceAfter === null ? [] : [{ balance: D(opts.balanceAfter ?? 0), currency: 'RUB' }]));
  const tx = {
    $queryRaw: queryRaw,
    resellerTransaction: { create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})) },
    registrationKey: {
      findFirst: vi.fn(async () => ({ id: 'key-1', price: D('967.50'), planId: 'plan-1' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const prisma = {
    reseller: { findUnique: vi.fn(async () => r) },
    licensePlan: {
      findUnique: vi.fn(async () => ({
        id: 'plan-1',
        productId: PRODUCT,
        isActive: true,
        price: D(1290),
        currency: 'RUB',
        durationDays: 30,
        name: '30 дней',
        product: { id: PRODUCT, status: 'ACTIVE', name: 'FC 26' },
      })),
    },
    license: { findFirst: vi.fn(async () => ({ id: 'lic-1', productId: PRODUCT, status: 'ACTIVE' })) },
    hwidHistory: { count: vi.fn(async () => opts.resetsToday ?? 0) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const keys = { issueForReseller: vi.fn(async (_tx: unknown, p: { count: number }) =>
    Array.from({ length: p.count }, (_, i) => ({ id: `k${i}`, code: `AAAA-BBBB-CCCC-000${i}` }))) } as unknown as RegistrationKeyService;
  const licenses = { extendForReseller: vi.fn(async () => ({ id: 'lic-1' })) } as unknown as LicensesService;
  const hwid = { resetByReseller: vi.fn(async () => ({})) } as unknown as HwidService;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const permissions = { invalidate: vi.fn(async () => undefined) } as unknown as PermissionsService;

  return {
    service: new ResellersService(prisma, audit, permissions, keys, licenses, hwid),
    prisma,
    tx,
    keys,
    licenses,
    hwid,
  };
}

describe('ResellersService', () => {
  it('цена для реселлера — цена тарифа минус скидка, до копеек', () => {
    expect(ResellersService.priceFor(D(1290), D(25)).toFixed(2)).toBe('967.50');
    expect(ResellersService.priceFor(D(149), D(12.5)).toFixed(2)).toBe('130.38');
  });

  it('выпуск ключей списывает цену × количество и отдаёт коды', async () => {
    const { service, tx, keys } = makeService({ balanceAfter: 1000 - 967.5 * 2 + 5000 });
    const result = await service.issueKeys(actor, { planId: 'plan-1', count: 2 });

    expect(result.codes).toHaveLength(2);
    expect(result.total.toFixed(2)).toBe('1935.00');
    expect(vi.mocked(keys.issueForReseller).mock.calls[0]?.[1]).toMatchObject({ resellerId: 'res-1', count: 2 });
    // Списание идёт одной строкой журнала с отрицательной суммой.
    expect(vi.mocked(tx.resellerTransaction.create).mock.calls[0]?.[0]).toMatchObject({
      data: { type: 'SALE', quantity: 2 },
    });
  });

  it('не хватает баланса — отказ, ключи не выпускаются', async () => {
    const { service, keys } = makeService({ balanceAfter: null });
    await expect(service.issueKeys(actor, { planId: 'plan-1', count: 5 })).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_BALANCE' },
    });
    expect(keys.issueForReseller).not.toHaveBeenCalled();
  });

  it('приостановленный реселлер и чужой товар — отказ до списания', async () => {
    const suspended = makeService({ reseller: reseller({ status: ResellerStatus.SUSPENDED }) });
    await expect(suspended.service.issueKeys(actor, { planId: 'plan-1', count: 1 })).rejects.toMatchObject({
      response: { code: 'RESELLER_INACTIVE' },
    });

    const limited = makeService({ reseller: reseller({ allowedProductIds: [OTHER_PRODUCT] }) });
    await expect(limited.service.issueKeys(actor, { planId: 'plan-1', count: 1 })).rejects.toMatchObject({
      response: { code: 'PRODUCT_NOT_ALLOWED' },
    });
    expect(limited.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('отмена неиспользованного ключа возвращает его цену', async () => {
    const { service, tx } = makeService({ balanceAfter: 1967.5 });
    const result = await service.cancelKey(actor, 'key-1');
    expect(result.balance.toFixed(2)).toBe('1967.50');
    expect(vi.mocked(tx.resellerTransaction.create).mock.calls[0]?.[0]).toMatchObject({
      data: { type: 'REFUND', registrationKeyId: 'key-1' },
    });
  });

  it('уже активированный ключ отменить нельзя', async () => {
    const { service, tx } = makeService();
    vi.mocked(tx.registrationKey.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(service.cancelKey(actor, 'key-1')).rejects.toMatchObject({ response: { code: 'KEY_NOT_CANCELLABLE' } });
    expect(tx.resellerTransaction.create).not.toHaveBeenCalled();
  });

  it('несостоявшееся продление возвращает деньги', async () => {
    const { service, tx, licenses } = makeService({ balanceAfter: 500 });
    vi.mocked(licenses.extendForReseller).mockRejectedValueOnce(new Error('boom'));
    await expect(service.extendLicense(actor, 'lic-1', 'plan-1')).rejects.toThrow('boom');
    const types = vi.mocked(tx.resellerTransaction.create).mock.calls.map((c) => c[0].data.type);
    expect(types).toEqual(['SALE', 'REFUND']);
  });

  it('сброс привязки клиенту упирается в суточный лимит реселлера', async () => {
    const ok = makeService({ resetsToday: 1 });
    await expect(ok.service.resetHwid(actor, 'lic-1')).resolves.toEqual({ usedToday: 2, dailyLimit: 2 });

    const exhausted = makeService({ resetsToday: 2 });
    await expect(exhausted.service.resetHwid(actor, 'lic-1')).rejects.toMatchObject({
      response: { code: 'RESELLER_DAILY_LIMIT' },
    });
    expect(exhausted.hwid.resetByReseller).not.toHaveBeenCalled();
  });

  it('чужую лицензию реселлер не видит', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.license.findFirst).mockResolvedValueOnce(null);
    await expect(service.resetHwid(actor, 'lic-x')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });
});
