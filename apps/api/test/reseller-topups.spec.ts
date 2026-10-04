import { Prisma, ResellerStatus, ResellerTopupStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ResellerTopupsService } from '../src/modules/resellers/reseller-topups.service';
import type { ResellersService } from '../src/modules/resellers/resellers.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { Env } from '../src/common/config/env.schema';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { SettingsService } from '../src/common/settings/settings.service';
import type { AuthenticatedUser } from '../src/modules/auth/guards/jwt-auth.guard';
import type { PaymentProfilesService } from '../src/modules/billing/payment-profiles.service';
import type { NotificationService } from '../src/modules/notifications/notification.service';

/**
 * Пополнение баланса реселлера криптой: заявка → хеш → подтверждение.
 * Главное — деньги зачисляются ровно один раз и один перевод не оплачивает
 * две вещи.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const reseller = { id: 'res-1', userId: 'user-r', status: ResellerStatus.ACTIVE, currency: 'RUB' };
const resellerActor = { id: 'user-r' } as unknown as AuthenticatedUser;
const adminActor = { id: 'admin-1' } as unknown as AuthenticatedUser;
const instructions = { kind: 'crypto', walletId: 'usdt', currency: 'USDT', network: 'TRC20', address: 'TX…', amount: '105.27', explorerTxUrl: null, note: null };

function topupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'top-1',
    resellerId: 'res-1',
    amount: D(10000),
    currency: 'RUB',
    profileId: 'prof-1',
    walletId: 'usdt',
    instructions,
    txHash: null as string | null,
    status: ResellerTopupStatus.PENDING as ResellerTopupStatus,
    creditedAmount: null,
    note: null,
    rejectReason: null,
    reviewedById: null,
    transactionId: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    submittedAt: null as Date | null,
    reviewedAt: null,
    reseller: { id: 'res-1', userId: 'user-r', displayName: 'Партнёр' },
    ...overrides,
  };
}

function makeService(row = topupRow()) {
  const tx = {
    resellerTopup: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({})),
    },
  };
  const prisma = {
    reseller: { findUnique: vi.fn(async () => reseller) },
    resellerTopup: {
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => row),
      findUnique: vi.fn(async () => row),
      findUniqueOrThrow: vi.fn(async () => row),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    payment: { findFirst: vi.fn(async () => null) },
    user: { findMany: vi.fn(async () => [{ id: 'admin-1', locale: 'ru' }]) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  const resellers = { credit: vi.fn(async () => D(13968)) } as unknown as ResellersService;
  const notifications = { enqueueMulti: vi.fn(async () => ({ email: null, telegram: null })) } as unknown as NotificationService;
  const profiles = {
    topupTarget: vi.fn(async () => ({
      profileId: 'prof-1',
      wallet: { id: 'usdt', currency: 'USDT', network: 'TRC20', address: 'TXaddr1234567890', rate: 95, decimals: 2 },
      config: { wallets: [], expireHours: 24 },
    })),
  } as unknown as PaymentProfilesService;
  const settings = { getString: vi.fn(async () => 'http://localhost:5173') } as unknown as SettingsService;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;

  return {
    service: new ResellerTopupsService(prisma, audit, notifications, settings, profiles, resellers, { FRONTEND_URL: 'http://x' } as Env),
    prisma,
    tx,
    resellers,
    notifications,
  };
}

describe('ResellerTopupsService', () => {
  it('заявка считает сумму в монетах по курсу кошелька, вверх', async () => {
    const { service, prisma } = makeService();
    await service.create(resellerActor, { amount: 10000, walletId: 'prof-1:usdt' });
    const data = (vi.mocked(prisma.resellerTopup.create).mock.calls[0] as unknown as [{ data: { instructions: { amount: string } } }])[0].data;
    expect(data.instructions.amount).toBe('105.27'); // 10000 / 95 = 105.263… → вверх
  });

  it('хеш отправляет заявку админам; хеш из заказа покупателя не принимается', async () => {
    const { service, prisma, notifications } = makeService();
    await service.submitTx(resellerActor, 'top-1', 'a'.repeat(64));
    expect(vi.mocked(notifications.enqueueMulti).mock.calls[0]?.[0]).toMatchObject({ templateKey: 'reseller.topup.awaiting' });

    vi.mocked(prisma.payment.findFirst).mockResolvedValueOnce({ id: 'pay-1' } as never);
    await expect(service.submitTx(resellerActor, 'top-1', 'b'.repeat(64))).rejects.toMatchObject({
      response: { code: 'TX_ALREADY_USED' },
    });
  });

  it('просроченную заявку без хеша оплатить нельзя', async () => {
    const { service } = makeService(topupRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.submitTx(resellerActor, 'top-1', 'c'.repeat(64))).rejects.toMatchObject({
      response: { code: 'TOPUP_EXPIRED' },
    });
  });

  it('подтверждение зачисляет деньги и привязывает строку журнала', async () => {
    const { service, tx, resellers } = makeService(topupRow({ status: ResellerTopupStatus.SUBMITTED, txHash: 'd'.repeat(64) }));
    const result = await service.confirm(adminActor, 'top-1', { amount: 9900 });
    expect(result.balance.toFixed(2)).toBe('13968.00');
    const call = vi.mocked(resellers.credit).mock.calls[0]!;
    expect(call[2].toFixed(2)).toBe('9900.00'); // зачислено фактически пришедшее
    expect(call[3]).toMatchObject({ type: 'TOPUP' });
    expect(vi.mocked(tx.resellerTopup.update).mock.calls[0]?.[0]).toMatchObject({ data: { transactionId: call[4] } });
  });

  it('вторая попытка подтвердить ту же заявку денег не зачисляет', async () => {
    const { service, tx, resellers } = makeService(topupRow({ status: ResellerTopupStatus.CONFIRMED }));
    vi.mocked(tx.resellerTopup.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(service.confirm(adminActor, 'top-1', {})).rejects.toMatchObject({ response: { code: 'TOPUP_NOT_OPEN' } });
    expect(resellers.credit).not.toHaveBeenCalled();
  });

  it('отклонение сообщает реселлеру причину', async () => {
    const { service, notifications } = makeService(topupRow({ status: ResellerTopupStatus.SUBMITTED }));
    await service.reject(adminActor, 'top-1', 'Перевод не найден');
    expect(vi.mocked(notifications.enqueueMulti).mock.calls[0]?.[0]).toMatchObject({
      templateKey: 'reseller.topup.rejected',
      payload: { reason: 'Перевод не найден' },
    });
  });

  it('отменить можно только заявку без хеша', async () => {
    const { service, prisma } = makeService();
    vi.mocked(prisma.resellerTopup.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(service.cancel(resellerActor, 'top-1')).rejects.toMatchObject({ response: { code: 'TOPUP_NOT_CANCELLABLE' } });
  });
});
