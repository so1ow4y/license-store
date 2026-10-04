import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { config as loadEnv } from 'dotenv';
import * as path from 'node:path';

import { SignatureService, type SignedRequest } from '../src/common/crypto/signature.service';
import type { RedisService } from '../src/common/redis/redis.service';
import type { SettingsService } from '../src/common/settings/settings.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Защита от повторов держится на атомарности SET NX в Redis, поэтому
 * проверяется на живом Redis, а не на заглушке: подменив хранилище,
 * мы бы проверили собственную выдумку, а не то, что реально защищает.
 */

const SECRET = 'launcher-signing-secret-for-tests';
const WINDOW_SEC = 300;

let redis: Redis;
let service: SignatureService;

function nonce(): string {
  return randomBytes(16).toString('hex');
}

function nowSec(): string {
  return String(Math.floor(Date.now() / 1000));
}

/** Формирует корректно подписанный запрос — как это будет делать загрузчик. */
function signedRequest(overrides: Partial<SignedRequest> = {}): SignedRequest {
  const base: Omit<SignedRequest, 'signature'> = {
    method: 'POST',
    path: '/api/v1/launcher/license/check',
    timestamp: nowSec(),
    nonce: nonce(),
    rawBody: '{"productSlug":"fc26"}',
    ...overrides,
  };

  return { ...base, signature: service.sign(service.buildPayload(base), SECRET), ...overrides };
}

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL!);

  const redisService = { client: redis } as unknown as RedisService;
  const settings = {
    getNumber: async (_key: string, fallback?: number) => fallback ?? WINDOW_SEC,
  } as unknown as SettingsService;

  service = new SignatureService(redisService, settings);
});

afterAll(async () => {
  await redis.quit();
});

describe('SignatureService', () => {
  it('принимает корректно подписанный запрос', async () => {
    const result = await service.verify(signedRequest(), SECRET);
    expect(result.ok).toBe(true);
  });

  it('отвергает повторное предъявление того же запроса', async () => {
    // Суть Replay Protection: перехваченный валидный запрос не должен
    // сработать во второй раз.
    const req = signedRequest();

    expect((await service.verify(req, SECRET)).ok).toBe(true);

    const replay = await service.verify(req, SECRET);
    expect(replay.ok).toBe(false);
    expect(replay).toMatchObject({ reason: 'REPLAY' });
  });

  it('отвергает подпись, сделанную другим секретом', async () => {
    const req = signedRequest();
    const result = await service.verify(req, 'секрет-другого-клиента');

    expect(result).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('отвергает запрос с подменённым телом', async () => {
    // Подпись покрывает хеш тела, поэтому подмена полезной нагрузки
    // при валидных заголовках не проходит.
    const req = signedRequest();
    const tampered = { ...req, rawBody: '{"productSlug":"gta5"}' };

    expect(await service.verify(tampered, SECRET)).toMatchObject({ reason: 'BAD_SIGNATURE' });
  });

  it('отвергает запрос с подменённым путём', async () => {
    const req = signedRequest();
    const tampered = { ...req, path: '/api/v1/admin/licenses' };

    expect(await service.verify(tampered, SECRET)).toMatchObject({ reason: 'BAD_SIGNATURE' });
  });

  it('отвергает устаревшую метку времени', async () => {
    const old = String(Math.floor(Date.now() / 1000) - WINDOW_SEC - 60);
    const req = signedRequest({ timestamp: old });

    expect(await service.verify(req, SECRET)).toMatchObject({ reason: 'EXPIRED' });
  });

  it('отвергает метку времени из будущего', async () => {
    // Окно двустороннее: иначе клиент со спешащими часами обходил бы
    // ограничение, подставляя время вперёд.
    const future = String(Math.floor(Date.now() / 1000) + WINDOW_SEC + 60);
    const req = signedRequest({ timestamp: future });

    expect(await service.verify(req, SECRET)).toMatchObject({ reason: 'EXPIRED' });
  });

  it('допускает небольшое расхождение часов клиента', async () => {
    const skewed = String(Math.floor(Date.now() / 1000) - 120);
    expect((await service.verify(signedRequest({ timestamp: skewed }), SECRET)).ok).toBe(true);
  });

  it('не отмечает nonce, если подпись неверна', async () => {
    // Проверка порядка: nonce пишется в Redis только после проверки подписи.
    // Иначе кто угодно сможет забивать хранилище, не зная секрета,
    // и заодно «сжигать» чужие nonce.
    const req = signedRequest();

    await service.verify(req, 'неверный-секрет');

    // Тот же nonce с правильной подписью должен пройти.
    expect((await service.verify(req, SECRET)).ok).toBe(true);
  });

  it('требует все заголовки подписи', async () => {
    const req = signedRequest();

    expect(await service.verify({ ...req, nonce: '' }, SECRET)).toMatchObject({
      reason: 'MISSING_HEADERS',
    });
    expect(await service.verify({ ...req, signature: '' }, SECRET)).toMatchObject({
      reason: 'MISSING_HEADERS',
    });
  });

  it('отвергает нечисловую метку времени', async () => {
    const req = signedRequest({ timestamp: 'вчера' });
    expect(await service.verify(req, SECRET)).toMatchObject({ reason: 'BAD_TIMESTAMP' });
  });

  it('канонизирует метод запроса', async () => {
    // Загрузчик может прислать метод в любом регистре — подпись
    // не должна от этого зависеть.
    const base = {
      method: 'post',
      path: '/api/v1/launcher/ping',
      timestamp: nowSec(),
      nonce: nonce(),
      rawBody: '',
    };
    const signature = service.sign(service.buildPayload(base), SECRET);

    expect((await service.verify({ ...base, method: 'POST', signature }, SECRET)).ok).toBe(true);
  });
});
