import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsService } from '../src/common/settings/settings.service';
import type { CryptoService } from '../src/common/crypto/crypto.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { RedisService } from '../src/common/redis/redis.service';

/**
 * Порядок разрешения настройки: кэш → БД → окружение → умолчание.
 *
 * Проверяется здесь, а не «глазами», из-за конкретного случая, который уже
 * один раз стоил бы дня отладки. Сид создаёт секретные настройки
 * (digiseller.api_key, telegram.bot_token, discord.client_secret) с ПУСТЫМ
 * значением — как заготовки под заполнение. Пока пустая строка считалась
 * значением, до окружения дело не доходило никогда: строка в БД есть, значит
 * возвращаем ''. При этом заполнить такой секрет было физически негде —
 * админского эндпоинта настроек нет, а класть в is_secret через SQL надо
 * шифротекст, которого руками не получить.
 *
 * Человек вписывал ключ в .env, сервис молча продолжал видеть пустоту, и
 * обнаруживалось это на первой реальной покупке.
 */

type Row = { key: string; id: string; value: unknown; isSecret: boolean };

function makeService(rows: Row[]) {
  const prisma = {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        rows.find((r) => r.key === where.key) ?? null,
      ),
      findMany: vi.fn(async () => rows),
    },
  } as unknown as PrismaService;

  const redis = { client: { duplicate: vi.fn(), publish: vi.fn() } } as unknown as RedisService;

  const crypto = {
    decrypt: vi.fn((raw: string) => `РАСШИФРОВАНО(${raw})`),
  } as unknown as CryptoService;

  const config = { get: vi.fn() } as never;

  return new SettingsService(prisma, redis, crypto, config);
}

const ID = '019fbacc-0000-7000-8000-000000000001';

afterEach(() => {
  delete process.env.DIGISELLER_API_KEY;
  delete process.env.LIMITS_HWID_MAX_TOTAL_RESETS;
  delete process.env.ANTIFRAUD_ENABLED;
});

describe('SettingsService — порядок разрешения значения', () => {
  it('пустой секрет из сида НЕ перекрывает окружение', async () => {
    // Ровно тот случай, ради которого написан этот файл.
    const svc = makeService([
      { key: 'digiseller.api_key', id: ID, value: '', isSecret: true },
    ]);
    process.env.DIGISELLER_API_KEY = 'ключ-из-окружения';

    await expect(svc.get('digiseller.api_key')).resolves.toBe('ключ-из-окружения');
  });

  it('заполненный секрет в БД главнее окружения', async () => {
    // Обратное направление: смысл настроек в том, что их меняют без
    // передеплоя, поэтому реальное значение в БД обязано выигрывать.
    const svc = makeService([
      { key: 'digiseller.api_key', id: ID, value: 'ШИФРОТЕКСТ', isSecret: true },
    ]);
    process.env.DIGISELLER_API_KEY = 'ключ-из-окружения';

    await expect(svc.get('digiseller.api_key')).resolves.toBe('РАСШИФРОВАНО(ШИФРОТЕКСТ)');
  });

  it('пустая строка без окружения падает в умолчание, а не возвращает пустоту', async () => {
    const svc = makeService([
      { key: 'digiseller.api_key', id: ID, value: '', isSecret: true },
    ]);

    await expect(svc.get('digiseller.api_key', 'умолчание')).resolves.toBe('умолчание');
  });

  it('строка из пробелов считается незаполненной', async () => {
    // Пробел в поле настройки — это опечатка, а не значение.
    const svc = makeService([
      { key: 'digiseller.api_key', id: ID, value: '   ', isSecret: true },
    ]);
    process.env.DIGISELLER_API_KEY = 'ключ-из-окружения';

    await expect(svc.get('digiseller.api_key')).resolves.toBe('ключ-из-окружения');
  });

  it('ЛОЖНЫЕ, но законные значения заготовкой НЕ считаются', async () => {
    // Главный риск этой правки: сочти мы «пустым» всё ложное — и выключенный
    // флаг молча превратился бы в умолчание, которое обычно включено.
    // Ноль сбросов HWID и выключенный антифрод — законные настройки.
    const svc = makeService([
      { key: 'limits.hwid.max_total_resets', id: ID, value: 0, isSecret: false },
      { key: 'antifraud.enabled', id: ID, value: false, isSecret: false },
    ]);
    process.env.LIMITS_HWID_MAX_TOTAL_RESETS = '3';
    process.env.ANTIFRAUD_ENABLED = 'true';

    await expect(svc.get('limits.hwid.max_total_resets')).resolves.toBe(0);
    await expect(svc.get('antifraud.enabled')).resolves.toBe(false);
  });

  it('массовая загрузка не кладёт заготовки в кэш', async () => {
    // get() смотрит кэш ПЕРВЫМ. Попади сюда пустая строка — правка порядка
    // разрешения не отработала бы ни разу, а выглядело бы это как «в .env
    // ключ есть, а сервис его не видит».
    const svc = makeService([
      { key: 'digiseller.api_key', id: ID, value: '', isSecret: true },
      { key: 'limits.rate.api_per_minute', id: ID, value: 120, isSecret: false },
    ]);

    await svc.reloadAll();
    process.env.DIGISELLER_API_KEY = 'ключ-из-окружения';

    await expect(svc.get('digiseller.api_key')).resolves.toBe('ключ-из-окружения');
    await expect(svc.get('limits.rate.api_per_minute')).resolves.toBe(120);
  });
});
