import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { CheckoutService, cryptoAmount, normalizeTxHash } from '../src/modules/billing/checkout.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { Env } from '../src/common/config/env.schema';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { SettingsService } from '../src/common/settings/settings.service';
import type { FulfillmentService } from '../src/modules/billing/fulfillment.service';
import type { PaymentProfilesService } from '../src/modules/billing/payment-profiles.service';
import type { YookassaClient, YookassaPayment } from '../src/modules/billing/yookassa.client';
import type { NotificationService } from '../src/modules/notifications/notification.service';

describe('cryptoAmount', () => {
  it('округляет вверх — из-за округления покупатель не недоплатит', () => {
    expect(cryptoAmount(new Prisma.Decimal(1290), 95, 2)).toBe('13.58'); // 13.578…
    expect(cryptoAmount(new Prisma.Decimal(1000), 100, 2)).toBe('10.00');
    expect(cryptoAmount(new Prisma.Decimal(1290), 6_500_000, 8)).toBe('0.00019847');
  });
});

describe('normalizeTxHash', () => {
  it('приводит hex к нижнему регистру, base58 не трогает', () => {
    expect(normalizeTxHash(' 0xABCDEF0123456789ABCDEF ')).toBe('0xabcdef0123456789abcdef');
    expect(normalizeTxHash('5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb')).toBe(
      '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb',
    );
  });

  it('отвергает мусор', () => {
    expect(() => normalizeTxHash('короткий')).toThrow(BadRequestException);
    expect(() => normalizeTxHash('abc def 1234567890123')).toThrow(BadRequestException);
  });
});

/**
 * Вебхук ЮKassa: телу не доверяем, статус перечитываем из API. Проверяется,
 * что лицензия выдаётся ровно один раз и только при совпадении суммы.
 */
describe('CheckoutService — ЮKassa', () => {
  const ORDER_ID = '019fbacc-0000-7000-8000-000000000101';
  const PAYMENT_ID = '019fbacc-0000-7000-8000-000000000102';

  function orderRow() {
    return {
      id: ORDER_ID,
      number: 'ORD-2026-000001',
      userId: '019fbacc-0000-7000-8000-00000000000a',
      productId: '019fbacc-0000-7000-8000-000000000002',
      planId: '019fbacc-0000-7000-8000-000000000003',
      amount: new Prisma.Decimal(1290),
      currency: 'RUB',
      status: 'PENDING',
      source: 'WEBSITE',
      comment: null,
      createdAt: new Date(),
      paidAt: null,
      deliveredAt: null,
      cancelledAt: null,
      product: { id: 'p', name: 'FC 26' },
      plan: { id: 'pl', name: '30 дней', durationDays: 30 },
      user: { id: 'u', username: 'buyer' },
      licenses: [],
      payments: [{ id: PAYMENT_ID, provider: 'YOOKASSA', profileId: 'profile-1', status: 'PENDING', externalId: 'yk-1' }],
    };
  }

  function remote(overrides: Partial<YookassaPayment> = {}): YookassaPayment {
    return {
      id: 'yk-1',
      status: 'succeeded',
      paid: true,
      amount: { value: '1290.00', currency: 'RUB' },
      metadata: { orderId: ORDER_ID, paymentId: PAYMENT_ID },
      payment_method: { type: 'bank_card' },
      ...overrides,
    };
  }

  function makeService(remotePayment: YookassaPayment) {
    let claimed = false;
    const tx = {
      // Первый условный UPDATE забирает заказ, все последующие — нет.
      order: {
        updateMany: vi.fn(async () => {
          const count = claimed ? 0 : 1;
          claimed = true;
          return { count };
        }),
      },
      payment: { update: vi.fn(async () => ({})) },
    };
    const prisma = {
      payment: {
        findUnique: vi.fn(async () => ({ id: PAYMENT_ID, orderId: ORDER_ID, externalId: 'yk-1', profileId: 'profile-1' })),
        update: vi.fn(async () => ({})),
      },
      order: { findUnique: vi.fn(async () => orderRow()) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaService;

    const fulfillment = {
      deliver: vi.fn(async () => ({ id: 'license-1', key: 'FC26-AAAA-AAAA-AAAA-AAAA' })),
      notifyIssued: vi.fn(async () => undefined),
    } as unknown as FulfillmentService;
    // Ключи берутся из реквизитов, на которые выставлен платёж.
    const profiles = {
      forPayment: vi.fn(async (profileId: string | null) =>
        profileId === 'profile-1'
          ? { profileId, config: { sendReceipt: false, vatCode: 1 }, secrets: { shopId: 'shop', secretKey: 'secret' } }
          : null,
      ),
    } as unknown as PaymentProfilesService;
    const yookassa = { getPayment: vi.fn(async () => remotePayment) } as unknown as YookassaClient;
    const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;

    const service = new CheckoutService(
      prisma,
      profiles,
      yookassa,
      fulfillment,
      {} as NotificationService,
      {} as SettingsService,
      audit,
      { FRONTEND_URL: 'http://localhost:5173' } as Env,
    );
    return { service, prisma, fulfillment, tx, profiles, yookassa };
  }

  it('сверяет статус ключами магазина, где создан платёж', async () => {
    const { service, profiles, yookassa } = makeService(remote());

    await service.handleYookassaWebhook({ object: { id: 'yk-1' } });

    expect(profiles.forPayment).toHaveBeenCalledWith('profile-1', 'YOOKASSA');
    expect(yookassa.getPayment).toHaveBeenCalledWith({ shopId: 'shop', secretKey: 'secret' }, 'yk-1');
  });

  it('успешный платёж выдаёт лицензию один раз, повторный вебхук ничего не делает', async () => {
    const { service, fulfillment } = makeService(remote());
    const body = { event: 'payment.succeeded', object: { id: 'yk-1' } };

    await service.handleYookassaWebhook(body);
    await service.handleYookassaWebhook(body);

    expect(fulfillment.deliver).toHaveBeenCalledTimes(1);
    expect(fulfillment.notifyIssued).toHaveBeenCalledTimes(1);
  });

  it('при расхождении суммы лицензию не выдаёт', async () => {
    const { service, fulfillment, prisma } = makeService(remote({ amount: { value: '1.00', currency: 'RUB' } }));

    await service.handleYookassaWebhook({ object: { id: 'yk-1' } });

    expect(fulfillment.deliver).not.toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalled();
  });

  it('платёж с чужими метаданными игнорирует', async () => {
    const { service, fulfillment } = makeService(remote({ metadata: { paymentId: 'другой' } }));

    await service.handleYookassaWebhook({ object: { id: 'yk-1' } });

    expect(fulfillment.deliver).not.toHaveBeenCalled();
  });

  it('незнакомое тело вебхука молча пропускает', async () => {
    const { service, fulfillment } = makeService(remote());

    await service.handleYookassaWebhook({ nonsense: true });
    await service.handleYookassaWebhook(null);

    expect(fulfillment.deliver).not.toHaveBeenCalled();
  });
});
