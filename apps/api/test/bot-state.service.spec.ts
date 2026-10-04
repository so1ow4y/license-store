import { describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../src/common/redis/redis.service';
import { BotStateService } from '../src/modules/telegram-bot/bot-state.service';

/**
 * Состояние диалога и метки подтверждения.
 *
 * Главное здесь — «метка гасится ровно один раз». Два быстрых нажатия
 * «Да, сбросить» на телефоне — обычное дело, а сброс привязки необратим
 * и стоит человеку одного сброса из трёх. Если бы гашение было
 * «прочитали → сравнили → удалили», оба нажатия успевали бы прочитать
 * состояние до удаления, и второе сожгло бы второй сброс.
 *
 * Второй по важности случай — недоступный Redis. Для состояния допустима
 * деградация до «бот не понял», но НЕ до «раз проверить нечем, выполняем»:
 * метка защищает необратимое действие.
 */

const CHAT = 5_000_000_001n;

/** Мини-Redis в памяти: только те команды, которыми пользуется сервис. */
function makeRedis(): { redis: RedisService; store: Map<string, string>; ttl: Map<string, number> } {
  const store = new Map<string, string>();
  const ttl = new Map<string, number>();

  const client = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, mode?: string, seconds?: number) => {
      store.set(key, value);
      if (mode === 'EX' && typeof seconds === 'number') ttl.set(key, seconds);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      ttl.delete(key);
      return store.delete(key) ? 1 : 0;
    }),
    getdel: vi.fn(async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      ttl.delete(key);
      return value;
    }),
  };

  return { redis: { client } as unknown as RedisService, store, ttl };
}

/** Redis, который отвечает отказом на всё. */
function makeBrokenRedis(): RedisService {
  const fail = vi.fn(async () => {
    throw new Error('соединение потеряно');
  });

  return { client: { get: fail, set: fail, del: fail, getdel: fail } } as unknown as RedisService;
}

describe('BotStateService — состояние', () => {
  it('пустой чат находится в idle', async () => {
    const { redis } = makeRedis();
    const service = new BotStateService(redis);

    expect((await service.get(CHAT)).s).toBe('idle');
  });

  it('состояние сохраняется вместе со своим TTL', async () => {
    const { redis, ttl } = makeRedis();
    const service = new BotStateService(redis);

    await service.set(CHAT, 'awaiting_support_text');
    expect(ttl.get(`tg:state:${CHAT}`)).toBe(900);

    await service.set(CHAT, 'awaiting_hwid_confirm');
    expect(ttl.get(`tg:state:${CHAT}`)).toBe(120);
  });

  it('установка idle стирает ключ, а не пишет строку «idle»', async () => {
    const { redis, store } = makeRedis();
    const service = new BotStateService(redis);

    await service.set(CHAT, 'awaiting_digiseller_code');
    await service.set(CHAT, 'idle');

    expect(store.has(`tg:state:${CHAT}`)).toBe(false);
  });

  it('мусор в ключе сбрасывается в idle, а не роняет обработчик', async () => {
    const { redis, store } = makeRedis();
    const service = new BotStateService(redis);

    store.set(`tg:state:${CHAT}`, '{"это":"не состояние"}');
    expect((await service.get(CHAT)).s).toBe('idle');
    expect(store.has(`tg:state:${CHAT}`)).toBe(false);
  });

  it('недоступный Redis означает idle, а не исключение', async () => {
    const service = new BotStateService(makeBrokenRedis());
    await expect(service.get(CHAT)).resolves.toMatchObject({ s: 'idle' });
    await expect(service.set(CHAT, 'awaiting_key_confirm')).resolves.toBeUndefined();
  });
});

describe('BotStateService — метка подтверждения', () => {
  it('гасится ровно один раз', async () => {
    const { redis } = makeRedis();
    const service = new BotStateService(redis);

    const nonce = await service.newNonce(CHAT, 'awaiting_hwid_confirm', { licenseId: 'L-1' });

    const first = await service.consumeNonce(CHAT, 'awaiting_hwid_confirm', nonce);
    expect(first).toMatchObject({ licenseId: 'L-1', nonce });

    const second = await service.consumeNonce(CHAT, 'awaiting_hwid_confirm', nonce);
    expect(second).toBeNull();
  });

  it('чужая метка не подходит', async () => {
    const { redis } = makeRedis();
    const service = new BotStateService(redis);

    await service.newNonce(CHAT, 'awaiting_hwid_confirm', { licenseId: 'L-1' });

    expect(await service.consumeNonce(CHAT, 'awaiting_hwid_confirm', 'AAAAAAAA')).toBeNull();
  });

  it('метка одного состояния не годится для другого', async () => {
    const { redis } = makeRedis();
    const service = new BotStateService(redis);

    const nonce = await service.newNonce(CHAT, 'awaiting_key_confirm', { licenseId: 'L-1' });

    expect(await service.consumeNonce(CHAT, 'awaiting_hwid_confirm', nonce)).toBeNull();
  });

  it('метка отвязки не пересекается с меткой сброса привязки', async () => {
    const { redis } = makeRedis();
    const service = new BotStateService(redis);

    const nonce = await service.newNonce(CHAT, 'awaiting_unlink_confirm', { linkId: 'K-1' });

    expect(await service.consumeNonce(CHAT, 'awaiting_hwid_confirm', nonce)).toBeNull();
  });

  it('недоступный Redis НЕ пропускает необратимое действие', async () => {
    const service = new BotStateService(makeBrokenRedis());
    expect(await service.consumeNonce(CHAT, 'awaiting_hwid_confirm', 'AAAAAAAA')).toBeNull();
  });

  it('метка состоит из восьми символов без похожих цифр и букв', async () => {
    const { redis } = makeRedis();
    const service = new BotStateService(redis);

    for (let i = 0; i < 50; i++) {
      const nonce = await service.newNonce(CHAT, 'awaiting_hwid_confirm');
      expect(nonce).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });
});
