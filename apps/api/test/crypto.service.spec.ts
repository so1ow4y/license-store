import { describe, expect, it } from 'vitest';

import type { Env } from '../src/common/config/env.schema';
import { CryptoService, type EncryptionContext } from '../src/common/crypto/crypto.service';

const KEY_V1 = '11'.repeat(32);
const KEY_V2 = '22'.repeat(32);
const PEPPER = '33'.repeat(32);

function makeService(overrides: Partial<Env> = {}): CryptoService {
  const env = {
    ENCRYPTION_KEY: KEY_V1,
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_KEYS_RETIRED: undefined,
    HWID_PEPPER: PEPPER,
    ...overrides,
  } as Env;

  return new CryptoService(env);
}

const CTX: EncryptionContext = {
  table: 'users',
  column: 'two_factor_secret_enc',
  rowId: '019fbacc-0000-7000-8000-000000000001',
};

describe('CryptoService — шифрование полей', () => {
  it('расшифровывает то, что зашифровал', () => {
    const svc = makeService();
    const secret = 'JBSWY3DPEHPK3PXP';

    const envelope = svc.encrypt(secret, CTX);
    expect(svc.decrypt(envelope, CTX)).toBe(secret);
  });

  it('никогда не выдаёт одинаковый шифротекст для одного значения', () => {
    // Повторное использование IV в GCM раскрывает ключ аутентификации.
    // Одинаковые шифротексты — прямой признак того, что IV фиксирован.
    const svc = makeService();
    const a = svc.encrypt('одно и то же', CTX);
    const b = svc.encrypt('одно и то же', CTX);

    expect(a).not.toBe(b);
    expect(svc.decrypt(a, CTX)).toBe(svc.decrypt(b, CTX));
  });

  it('помечает шифротекст версией текущего ключа', () => {
    const svc = makeService({ ENCRYPTION_KEY_VERSION: 7 });
    expect(svc.encrypt('x', CTX).startsWith('v7.')).toBe(true);
  });

  it('обнаруживает подмену шифротекста', () => {
    // Это главное преимущество GCM над CBC: подмена не проходит молча.
    const svc = makeService();
    const envelope = svc.encrypt('важное значение', CTX);
    const [v, iv, tag, ct] = envelope.split('.');

    const flipped = ct!.slice(0, -2) + (ct!.slice(-2) === 'AA' ? 'AB' : 'AA');

    expect(() => svc.decrypt([v, iv, tag, flipped].join('.'), CTX)).toThrow();
  });

  it('не расшифровывает значение, перенесённое в чужую строку', () => {
    // Ради этого в AAD входят таблица, колонка и id владельца: иначе
    // 2FA-секрет одного пользователя можно скопировать другому.
    const svc = makeService();
    const envelope = svc.encrypt('секрет пользователя A', CTX);

    const otherRow: EncryptionContext = { ...CTX, rowId: '019fbacc-0000-7000-8000-000000000002' };
    expect(() => svc.decrypt(envelope, otherRow)).toThrow();

    const otherColumn: EncryptionContext = { ...CTX, column: 'hwid_enc' };
    expect(() => svc.decrypt(envelope, otherColumn)).toThrow();
  });

  it('читает записи, зашифрованные выведенным из обращения ключом', () => {
    // Сценарий ротации: запись сделана ключом версии 1, текущий — версии 2.
    const old = makeService({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_VERSION: 1 });
    const envelope = old.encrypt('старое значение', CTX);

    const rotated = makeService({
      ENCRYPTION_KEY: KEY_V2,
      ENCRYPTION_KEY_VERSION: 2,
      ENCRYPTION_KEYS_RETIRED: `1:${KEY_V1}`,
    });

    expect(rotated.decrypt(envelope, CTX)).toBe('старое значение');
    expect(rotated.needsReencryption(envelope)).toBe(true);
    expect(rotated.needsReencryption(rotated.encrypt('новое', CTX))).toBe(false);
  });

  it('внятно сообщает, если ключ выкинули из конфигурации', () => {
    // Молчать нельзя: для 2FA это выглядело бы как «не настроена»,
    // и второй фактор тихо отключился бы у всех.
    const old = makeService({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_VERSION: 1 });
    const envelope = old.encrypt('x', CTX);

    const svc = makeService({ ENCRYPTION_KEY: KEY_V2, ENCRYPTION_KEY_VERSION: 2 });
    expect(() => svc.decrypt(envelope, CTX)).toThrow(/ключ версии 1/);
  });

  it('отвергает повреждённый формат', () => {
    const svc = makeService();
    expect(() => svc.decrypt('мусор', CTX)).toThrow();
    expect(() => svc.decrypt('a.b.c', CTX)).toThrow();
  });
});

describe('CryptoService — HWID', () => {
  it('даёт одинаковый хеш для одного Disk ID', () => {
    const svc = makeService();
    expect(svc.hashHwid('WD-WCC4N1234567')).toBe(svc.hashHwid('WD-WCC4N1234567'));
  });

  it('нормализует регистр и пробелы', () => {
    // Серийник от DeviceIoControl приходит с разным регистром и хвостовыми
    // пробелами в зависимости от контроллера. Без нормализации та же машина
    // после обновления драйвера даст другой хеш.
    const svc = makeService();
    const canonical = svc.hashHwid('WD-WCC4N1234567');

    expect(svc.hashHwid('  wd-wcc4n1234567  ')).toBe(canonical);
    expect(svc.hashHwid('WD-WCC4N 1234567')).toBe(canonical);
    expect(svc.hashHwid('wd-WCC4N1234567\t')).toBe(canonical);
  });

  it('даёт разные хеши для разных дисков', () => {
    const svc = makeService();
    expect(svc.hashHwid('DISK-A')).not.toBe(svc.hashHwid('DISK-B'));
  });

  it('зависит от pepper', () => {
    // Дамп БД без pepper не позволяет восстановить исходные идентификаторы.
    const a = makeService({ HWID_PEPPER: '33'.repeat(32) });
    const b = makeService({ HWID_PEPPER: '44'.repeat(32) });

    expect(a.hashHwid('DISK-A')).not.toBe(b.hashHwid('DISK-A'));
  });

  it('выдаёт 64 hex-символа — ровно под колонку char(64)', () => {
    const svc = makeService();
    expect(svc.hashHwid('DISK-A')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('отвергает пустой Disk ID', () => {
    const svc = makeService();
    expect(() => svc.hashHwid('   ')).toThrow();
  });
});

describe('CryptoService — сравнение за постоянное время', () => {
  it('сравнивает корректно', () => {
    const svc = makeService();
    expect(svc.safeEqual('одинаково', 'одинаково')).toBe(true);
    expect(svc.safeEqual('одинаково', 'другое!!!')).toBe(false);
    expect(svc.safeEqual('короткое', 'длинное значение')).toBe(false);
  });
});
