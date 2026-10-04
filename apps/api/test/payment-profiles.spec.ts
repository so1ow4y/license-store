import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PaymentProfilesService } from '../src/modules/billing/payment-profiles.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { CryptoService } from '../src/common/crypto/crypto.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { ChannelInfo, PaymentMethodsService } from '../src/modules/billing/payment-methods.service';

/**
 * Реквизиты оплаты: шаблоны и личные реквизиты товара, несколько привязок
 * на способ, выбор кошелька при покупке, удаление «для всех».
 * Prisma заменена памятью — проверяется логика.
 */

const PRODUCT = '019fbacc-0000-7000-8000-000000000001';
const OTHER_PRODUCT = '019fbacc-0000-7000-8000-000000000002';
const WALLET = { id: 'usdt', currency: 'USDT', network: 'TRC20', address: 'TXyz1234567890abcdefgh', rate: 95, decimals: 2 };

type Row = Record<string, unknown> & { id: string };
type OptionKey = { productId_profileId: { productId: string; profileId: string } };
type OptionWhere = { productId?: string; profileId?: string; provider?: string; enabled?: boolean; profile?: { archivedAt: null } };

function makeService(channelsEnabled: Partial<Record<'YOOKASSA' | 'CRYPTO', boolean>> = { YOOKASSA: true, CRYPTO: true }) {
  const profiles: Row[] = [];
  const options: Row[] = [];
  let tick = 0;

  const withIncludes = (p: Row) => ({
    ...p,
    product: p.productId ? { id: p.productId, name: `товар ${String(p.productId).slice(-1)}` } : null,
    productOptions: options
      .filter((o) => o.profileId === p.id)
      .map((o) => ({ enabled: o.enabled, product: { id: o.productId, name: 'товар', slug: 'p' } })),
  });
  const profileOf = (o: Row) => profiles.find((p) => p.id === o.profileId)!;
  const matches = (o: Row, where: OptionWhere) =>
    (!where.productId || o.productId === where.productId) &&
    (!where.profileId || o.profileId === where.profileId) &&
    (!where.provider || o.provider === where.provider) &&
    (where.enabled === undefined || o.enabled === where.enabled) &&
    (!where.profile || profileOf(o).archivedAt === null);
  const byKey = (where: OptionKey) =>
    options.find(
      (o) => o.productId === where.productId_profileId.productId && o.profileId === where.productId_profileId.profileId,
    );
  const sorted = (rows: Row[]) =>
    [...rows].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || Number(a.createdAt) - Number(b.createdAt));

  const prisma = {
    product: { count: vi.fn(async ({ where }: { where: { id: string } }) => ([PRODUCT, OTHER_PRODUCT].includes(where.id) ? 1 : 0)) },
    user: { findMany: vi.fn(async () => [{ id: 'admin', username: 'admin' }]) },
    paymentProfile: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        profiles.push({ archivedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        Object.assign(profiles.find((p) => p.id === where.id)!, data);
      }),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; archivedAt?: null } }) => {
        const row = profiles.find((p) => p.id === where.id && p.archivedAt === null);
        return row ? withIncludes(row) : null;
      }),
      findMany: vi.fn(async () => profiles.filter((p) => p.archivedAt === null).map(withIncludes)),
    },
    productPaymentOption: {
      findUnique: vi.fn(async ({ where }: { where: OptionKey }) => byKey(where) ?? null),
      findFirst: vi.fn(async ({ where }: { where: OptionWhere }) =>
        sorted(options.filter((o) => matches(o, where))).reverse()[0] ?? null,
      ),
      findMany: vi.fn(async ({ where, include }: { where: OptionWhere; include?: { profile?: unknown } }) =>
        sorted(options.filter((o) => matches(o, where))).map((o) =>
          include?.profile ? { ...o, profile: withIncludes(profileOf(o)) } : o,
        ),
      ),
      upsert: vi.fn(async ({ where, create, update }: { where: OptionKey; create: Row; update: Row }) => {
        const o = byKey(where);
        if (o) Object.assign(o, update);
        else options.push({ ...create, createdAt: tick++ });
      }),
      update: vi.fn(async ({ where, data }: { where: OptionKey; data: Row }) => Object.assign(byKey(where)!, data)),
      delete: vi.fn(async ({ where }: { where: OptionKey }) => {
        options.splice(options.indexOf(byKey(where)!), 1);
      }),
      deleteMany: vi.fn(async ({ where }: { where: { profileId: string } }) => {
        for (let i = options.length - 1; i >= 0; i--) if (options[i]!.profileId === where.profileId) options.splice(i, 1);
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;

  const crypto = {
    encrypt: (plain: string) => `enc:${plain}`,
    decrypt: (envelope: string) => envelope.replace(/^enc:/, ''),
    keyVersion: 1,
  } as unknown as CryptoService;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
  const channels: ChannelInfo[] = (['YOOKASSA', 'CRYPTO'] as const).map((provider, i) => ({
    provider,
    enabled: channelsEnabled[provider] ?? false,
    title: provider,
    description: null,
    sortOrder: i,
  }));
  const methods = {
    channels: vi.fn(async () => channels),
    isEnabled: vi.fn(async (p: 'YOOKASSA' | 'CRYPTO') => channelsEnabled[p] ?? false),
  } as unknown as PaymentMethodsService;

  return { service: new PaymentProfilesService(prisma, crypto, audit, methods), profiles, options };
}

describe('PaymentProfilesService', () => {
  it('создаёт шаблон ЮKassa и не отдаёт значения ключей', async () => {
    const { service } = makeService();
    const view = await service.create(
      { provider: 'YOOKASSA', name: 'Основной магазин', secrets: { shopId: '123', secretKey: 'live_key' } },
      'admin',
    );

    expect(view).toMatchObject({ kind: 'TEMPLATE', ready: true, secretsSet: { shopId: true, secretKey: true }, createdByUsername: 'admin' });
    expect(JSON.stringify(view)).not.toContain('live_key');
  });

  it('проверяет кошельки и отвергает реквизиты для Digiseller', async () => {
    const { service } = makeService();
    await expect(
      service.create({ provider: 'CRYPTO', name: 'x', config: { wallets: [{ ...WALLET, rate: -1 }] } }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ provider: 'DIGISELLER', name: 'x' }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('к товару привязывается несколько кошельков, покупатель выбирает любой', async () => {
    const { service } = makeService();
    const first = await service.create({ provider: 'CRYPTO', name: 'Первый', config: { wallets: [WALLET] } }, 'admin');
    const second = await service.create(
      { provider: 'CRYPTO', name: 'Второй', productId: PRODUCT, config: { wallets: [{ ...WALLET, id: 'btc', currency: 'BTC' }] } },
      'admin',
    );
    await service.attach(PRODUCT, first.id, 'support');
    await service.attach(PRODUCT, second.id, 'admin');

    const [crypto] = (await service.methodsForProduct(PRODUCT)) as { wallets?: { id: string }[] }[];
    expect(crypto?.wallets?.map((w) => w.id)).toEqual([`${first.id}:usdt`, `${second.id}:btc`]);

    // Без выбора — первые по порядку; с выбором — именно выбранный кошелёк.
    expect((await service.resolveForCheckout(PRODUCT, 'CRYPTO')).profileId).toBe(first.id);
    const chosen = await service.resolveForCheckout(PRODUCT, 'CRYPTO', `${second.id}:btc`);
    expect(chosen).toMatchObject({ profileId: second.id, walletId: 'btc' });
    await expect(service.resolveForCheckout(PRODUCT, 'CRYPTO', `${second.id}:usdt`)).rejects.toMatchObject({
      response: { code: 'WALLET_NOT_FOUND' },
    });
  });

  it('не привязывает чужие личные реквизиты', async () => {
    const { service } = makeService();
    const foreign = await service.create({ provider: 'CRYPTO', name: 'Чужой', productId: OTHER_PRODUCT, config: { wallets: [WALLET] } }, 'admin');

    await expect(service.attach(PRODUCT, foreign.id, 'admin')).rejects.toMatchObject({
      response: { code: 'PROFILE_OF_OTHER_PRODUCT' },
    });
  });

  it('на витрине только включённые каналы и включённые готовые реквизиты', async () => {
    const { service } = makeService({ YOOKASSA: false, CRYPTO: true });
    const crypto = await service.create({ provider: 'CRYPTO', name: 'Общий', config: { wallets: [WALLET] } }, 'admin');
    const shop = await service.create({ provider: 'YOOKASSA', name: 'Магазин', secrets: { shopId: '1', secretKey: 'k' } }, 'admin');
    await service.attach(PRODUCT, crypto.id, 'admin');
    await service.attach(PRODUCT, shop.id, 'admin');

    const methods = await service.methodsForProduct(PRODUCT);
    expect(methods.map((m) => m.provider)).toEqual(['CRYPTO']);
    // Адрес кошелька на витрине не раскрывается — только в созданном заказе.
    expect(JSON.stringify(methods)).not.toContain(WALLET.address);
    await expect(service.resolveForCheckout(PRODUCT, 'YOOKASSA')).rejects.toMatchObject({
      response: { code: 'PAYMENT_METHOD_DISABLED' },
    });

    await service.updateOption(PRODUCT, crypto.id, { enabled: false }, 'admin');
    expect(await service.methodsForProduct(PRODUCT)).toEqual([]);
  });

  it('неготовые реквизиты (без кошельков) не принимают оплату', async () => {
    const { service } = makeService();
    const empty = await service.create({ provider: 'CRYPTO', name: 'Пусто' }, 'admin');
    await service.attach(PRODUCT, empty.id, 'admin');

    expect(await service.methodsForProduct(PRODUCT)).toEqual([]);
    await expect(service.resolveForCheckout(PRODUCT, 'CRYPTO')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('удаление снимает реквизиты со всех товаров сразу', async () => {
    const { service, options, profiles } = makeService();
    const template = await service.create({ provider: 'CRYPTO', name: 'Общий', config: { wallets: [WALLET] } }, 'admin');
    await service.attach(PRODUCT, template.id, 'admin');
    await service.attach(OTHER_PRODUCT, template.id, 'admin');

    await expect(service.archive(template.id, 'admin')).resolves.toEqual({ detachedFrom: 2 });
    expect(options).toHaveLength(0);
    expect(profiles[0]?.archivedAt).toBeInstanceOf(Date);

    const result = await service.archiveMany([template.id], 'admin');
    expect(result).toMatchObject({ total: 1, succeeded: 0, failed: [{ code: 'NOT_FOUND' }] });
  });
});
