import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DigisellerService } from '../src/modules/billing/digiseller.service';
import type { RedeemContext } from '../src/modules/billing/digiseller.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { RedisService } from '../src/common/redis/redis.service';
import type { SettingsService } from '../src/common/settings/settings.service';
import type { DigisellerClient } from '../src/modules/billing/digiseller.client';
import type { FulfillmentService } from '../src/modules/billing/fulfillment.service';
import type { PaymentMethodsService } from '../src/modules/billing/payment-methods.service';
import type { LicensesService } from '../src/modules/licenses/licenses.service';

/**
 * Вторая ось счётчика попыток активации: ключ источника выбирает вызывающий
 * (у Telegram-бота все запросы идут с одного IP). Проверяется имя ключа
 * в Redis; приватный метод вызывается напрямую, чтобы не поднимать весь
 * путь покупки.
 */

const USER_ID = '019fbacc-0000-7000-8000-00000000000a';
const ATTEMPTS_PREFIX = 'digiseller:attempts:';

type Bumped = { key: string; cost: number };

function makeService(settingsValues: Record<string, number> = {}) {
  const bumped: Bumped[] = [];

  const redis = {
    client: {
      incrby: vi.fn(async (key: string, cost: number) => {
        bumped.push({ key, cost });
        return cost;
      }),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => 3600),
    },
  } as unknown as RedisService;

  const settings = {
    get: vi.fn(async (key: string, fallback?: number) => settingsValues[key] ?? fallback),
  } as unknown as SettingsService;

  const service = new DigisellerService(
    {} as unknown as PrismaService,
    redis,
    settings,
    {} as unknown as DigisellerClient,
    {} as unknown as LicensesService,
    {} as unknown as FulfillmentService,
    {} as unknown as PaymentMethodsService,
    {} as unknown as AuditService,
  );

  // Метод приватный по замыслу: снаружи его звать незачем, а тест обязан
  // проверять именно его, потому что защита живёт целиком в имени ключа.
  const check = (ctx: RedeemContext, cost?: number): Promise<void> =>
    (
      service as unknown as {
        checkAttemptLimit(userId: string, ctx: RedeemContext, cost?: number): Promise<void>;
      }
    ).checkAttemptLimit(USER_ID, ctx, cost);

  return { service, check, bumped, redis, settings };
}

describe('DigisellerService — ось источника в счётчике попыток', () => {
  it('sourceKey задаёт ключ целиком, без префикса ip:', async () => {
    const { check, bumped } = makeService();

    await check({ ip: '10.0.0.1', sourceKey: 'telegram:123456789' });

    expect(bumped.map((b) => b.key)).toEqual([
      `${ATTEMPTS_PREFIX}${USER_ID}`,
      `${ATTEMPTS_PREFIX}telegram:123456789`,
    ]);
  });

  it('sourceKey сильнее ip: у бота один адрес на всех, и считать по нему нечего', async () => {
    const { check, bumped } = makeService();

    await check({ ip: '10.0.0.1', sourceKey: 'telegram:123456789' });

    expect(bumped.some((b) => b.key.includes('10.0.0.1'))).toBe(false);
  });

  it('без sourceKey ось остаётся прежней — адрес с префиксом ip:', async () => {
    const { check, bumped } = makeService();

    await check({ ip: '203.0.113.7' });

    expect(bumped.map((b) => b.key)).toEqual([
      `${ATTEMPTS_PREFIX}${USER_ID}`,
      `${ATTEMPTS_PREFIX}ip:203.0.113.7`,
    ]);
  });

  it('без адреса и без sourceKey считается только аккаунт', async () => {
    const { check, bumped } = makeService();

    await check({});

    expect(bumped).toHaveLength(1);
    expect(bumped[0]?.key).toBe(`${ATTEMPTS_PREFIX}${USER_ID}`);
  });

  it('старая настройка attempts_per_ip_per_hour остаётся умолчанием новой', async () => {
    // Переименование ключа не должно молча вернуть подкрученный владельцем
    // порог к заводскому значению.
    const { check, settings } = makeService({
      'limits.digiseller.attempts_per_ip_per_hour': 500,
    });

    await check({ sourceKey: 'telegram:1' });

    expect(vi.mocked(settings.get)).toHaveBeenCalledWith(
      'limits.digiseller.attempts_per_source_per_hour',
      500,
    );
  });

  it('превышение порога источника даёт TOO_MANY_ATTEMPTS', async () => {
    const { check, redis } = makeService({
      'limits.digiseller.attempts_per_hour': 1000,
      'limits.digiseller.attempts_per_source_per_hour': 2,
    });
    vi.mocked(redis.client.incrby).mockImplementation(async () => 3);

    await expect(check({ sourceKey: 'telegram:1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('недоступный Redis не рушит единственный платёжный канал', async () => {
    const { check, redis } = makeService();
    vi.mocked(redis.client.incrby).mockRejectedValue(new Error('соединение потеряно'));

    await expect(check({ sourceKey: 'telegram:1' })).resolves.toBeUndefined();
  });
});
