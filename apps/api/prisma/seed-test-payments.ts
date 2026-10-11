/**
 * Тестовые способы оплаты для разработки: два набора крипто-кошельков с
 * заведомо ненастоящими адресами — один в разделе товаров, другой в разделе
 * реселлеров. Включает канал «Криптовалюта» и привязывает реквизиты товаров
 * ко всем товарам, чтобы покупку и пополнение можно было пройти целиком.
 *
 * Деньги на эти адреса не уйдут: адреса не существуют ни в одной сети, а
 * оплату крипто-заказа всё равно подтверждает сотрудник вручную.
 *
 * Идемпотентен (ищет реквизиты по названию). На проде не запускается.
 * Запуск:  npm run db:seed:test-payments
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Как maintenance.ts: запуск напрямую через tsx, prisma.config.ts не применяется.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

import { PaymentScope, PrismaClient, type Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const prisma = new PrismaClient();

type Wallet = { id: string; currency: string; network: string; address: string; rate: number; decimals: number };

const PROFILES: Array<{ name: string; scope: PaymentScope; wallets: Wallet[]; instructions: string }> = [
  {
    name: 'ТЕСТ · Крипта для товаров',
    scope: PaymentScope.PRODUCTS,
    instructions: 'Тестовые реквизиты: адреса не настоящие, ничего не переводите. Для проверки укажите любой хеш.',
    wallets: [
      { id: 'test-usdt', currency: 'USDT', network: 'TRC20', address: 'TEST-USDT-TRC20-NOT-A-REAL-WALLET-0001', rate: 95, decimals: 2 },
      { id: 'test-btc', currency: 'BTC', network: 'Bitcoin', address: 'TEST-BTC-NOT-A-REAL-WALLET-0001', rate: 9_500_000, decimals: 8 },
    ],
  },
  {
    name: 'ТЕСТ · Крипта для реселлеров',
    scope: PaymentScope.RESELLERS,
    instructions: 'Тестовые реквизиты пополнения: адреса не настоящие. Для проверки укажите любой хеш.',
    wallets: [
      { id: 'test-usdt', currency: 'USDT', network: 'TRC20', address: 'TEST-USDT-TRC20-RESELLER-NOT-REAL-0002', rate: 95, decimals: 2 },
      { id: 'test-ton', currency: 'TON', network: 'TON', address: 'TEST-TON-RESELLER-NOT-A-REAL-WALLET-0002', rate: 300, decimals: 4 },
    ],
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Тестовые реквизиты на проде не создаются');
  }

  const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } });
  const ids: Record<PaymentScope, string> = { PRODUCTS: '', RESELLERS: '' };

  for (const p of PROFILES) {
    const config = { wallets: p.wallets, instructions: p.instructions, expireHours: 24 } as Prisma.InputJsonValue;
    const existing = await prisma.paymentProfile.findFirst({ where: { name: p.name, archivedAt: null } });
    if (existing) {
      await prisma.paymentProfile.update({ where: { id: existing.id }, data: { scope: p.scope, productId: null, config } });
      ids[p.scope] = existing.id;
      console.log(`· обновлены «${p.name}»`);
    } else {
      const id = uuidv7();
      await prisma.paymentProfile.create({
        data: { id, provider: 'CRYPTO', scope: p.scope, name: p.name, config, createdById: admin?.id, updatedById: admin?.id },
      });
      ids[p.scope] = id;
      console.log(`· созданы «${p.name}»`);
    }
  }

  await prisma.paymentMethodConfig.update({ where: { provider: 'CRYPTO' }, data: { enabled: true } });
  console.log('· канал «Криптовалюта» включён');

  const products = await prisma.product.findMany({ where: { status: { not: 'ARCHIVED' } }, select: { id: true, name: true } });
  for (const product of products) {
    await prisma.productPaymentOption.upsert({
      where: { productId_profileId: { productId: product.id, profileId: ids.PRODUCTS } },
      update: { enabled: true },
      create: { productId: product.id, profileId: ids.PRODUCTS, provider: 'CRYPTO', enabled: true, sortOrder: 100 },
    });
  }
  console.log(`· реквизиты товаров привязаны к товарам: ${products.length}`);
  console.log('\n✓ тестовые способы оплаты готовы');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
