import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PaymentMethodsService } from '../src/modules/billing/payment-methods.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { Env } from '../src/common/config/env.schema';
import type { CryptoService } from '../src/common/crypto/crypto.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Глобальные каналы оплаты: ключи Digiseller не уходят в панель, включить
 * Digiseller без ключей нельзя, ЮKassa и крипта включаются без реквизитов
 * (те проверяются у товара).
 */
function makeService(initial: Record<string, unknown> | null = null, env: Partial<Env> = {}) {
  let row: Record<string, unknown> | null = initial;
  const prisma = {
    paymentMethodConfig: {
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async () => (row ? [row] : [])),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        row = row ? { ...row, ...update } : { ...create };
        return row;
      }),
    },
  } as unknown as PrismaService;

  // «Шифрование» для теста: обратимое и заметное.
  const crypto = {
    encrypt: (plain: string) => `enc:${plain}`,
    decrypt: (envelope: string) => envelope.replace(/^enc:/, ''),
    keyVersion: 1,
  } as unknown as CryptoService;
  const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;

  const service = new PaymentMethodsService(prisma, crypto, audit, { APP_URL: 'http://api', ...env } as Env);
  return { service, getRow: () => row, audit };
}

describe('PaymentMethodsService', () => {
  it('не отдаёт значения ключей Digiseller в панель', async () => {
    const { service } = makeService({
      provider: 'DIGISELLER',
      enabled: true,
      title: 'Digiseller',
      config: {},
      secretsEnc: 'enc:{"sellerId":"42","apiKey":"live_key"}',
    });

    const list = await service.listForAdmin();
    const digiseller = list.find((m) => m.provider === 'DIGISELLER');

    expect(digiseller?.secretsSet).toEqual({ sellerId: true, apiKey: true });
    expect(JSON.stringify(list)).not.toContain('live_key');
    expect(list.find((m) => m.provider === 'YOOKASSA')?.webhookUrl).toBe('http://api/api/v1/billing/yookassa/webhook');
  });

  it('не включает Digiseller без ключей', async () => {
    const { service } = makeService();
    await expect(service.update('DIGISELLER', { enabled: true }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('включает канал ЮKassa без ключей — реквизиты проверяются у товара', async () => {
    const { service } = makeService();
    const result = await service.update('YOOKASSA', { enabled: true }, 'admin');
    expect(result?.enabled).toBe(true);
    expect(await service.isEnabled('YOOKASSA')).toBe(true);
  });

  it('пустая строка удаляет ключ, отсутствующее поле оставляет', async () => {
    const { service, getRow, audit } = makeService();

    await service.update('DIGISELLER', { secrets: { sellerId: '42', apiKey: 'k' } }, 'admin');
    await service.update('DIGISELLER', { secrets: { apiKey: '' } }, 'admin');

    expect(await service.secrets('DIGISELLER')).toEqual({ sellerId: '42', apiKey: '' });
    expect(String(getRow()?.secretsEnc)).not.toContain('"apiKey"');
    // В журнал попадают имена изменённых ключей, но не значения.
    expect(JSON.stringify(vi.mocked(audit.record).mock.calls)).not.toContain('"k"');
  });

  it('отвергает ключ, которого у канала нет', async () => {
    const { service } = makeService();
    await expect(service.update('YOOKASSA', { secrets: { shopId: 'x' } }, 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('Digiseller берёт ключи из окружения, если в панели не заданы', async () => {
    const { service } = makeService(null, { DIGISELLER_SELLER_ID: '42', DIGISELLER_API_KEY: 'env-key' });
    expect(await service.secrets('DIGISELLER')).toEqual({ sellerId: '42', apiKey: 'env-key' });
  });

  it('отдаёт каналы по порядку сортировки с названиями по умолчанию', async () => {
    const { service } = makeService({ provider: 'CRYPTO', enabled: true, title: 'Крипта', sortOrder: 5, config: {} });
    const channels = await service.channels();
    expect(channels.map((c) => c.provider)).toEqual(['DIGISELLER', 'YOOKASSA', 'CRYPTO']);
    expect(channels.find((c) => c.provider === 'CRYPTO')).toMatchObject({ enabled: true, title: 'Крипта' });
  });
});
