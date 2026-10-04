import { createDecipheriv, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { Env } from '../src/common/config/env.schema';
import {
  CryptoService,
  type PayloadBindingFields,
  type SealedPayload,
} from '../src/common/crypto/crypto.service';

function makeService(): CryptoService {
  return new CryptoService({
    ENCRYPTION_KEY: '11'.repeat(32),
    ENCRYPTION_KEY_VERSION: 1,
    HWID_PEPPER: 'aa'.repeat(32),
  } as Env);
}

const SESSION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const INFO = Buffer.from('lp/payload/v1', 'ascii');

const FIELDS: PayloadBindingFields = {
  productSlug: 'fc26',
  sha256: 'ab'.repeat(32),
  size: 614400,
  version: '1.2.0',
};

/**
 * Вывод ключа НЕЗАВИСИМОЙ реализацией — двумя вызовами HMAC, ровно так,
 * как это делает C++ (Hkdf.cpp поверх HmacSha256). Если бы тест звал
 * crypto.hkdf, он проверял бы, что Node согласен сам с собой, а разошлись
 * бы стороны всё равно на клиенте — и без всякой диагностики.
 */
function deriveKeyIndependently(sessionKeyHex: string, iv: Buffer): Buffer {
  const prk = createHmac('sha256', iv).update(Buffer.from(sessionKeyHex, 'hex')).digest();
  return createHmac('sha256', prk)
    .update(Buffer.concat([INFO, Buffer.from([0x01])]))
    .digest();
}

/** Сборка AAD «руками», как её соберёт клиент из полученных заголовков. */
function buildAadIndependently(fields: {
  productSlug: string;
  sha256: string;
  size: string;
  version: string;
}): Buffer {
  return Buffer.from(
    ['lp/payload/v1', fields.productSlug, fields.sha256, fields.size, fields.version].join('\n'),
    'utf8',
  );
}

/** Расшифровка через createDecipheriv — не тот же код, что шифрует (subtle). */
function open(sealed: SealedPayload, key: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv, { authTagLength: 16 });
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

describe('CryptoService — HKDF-SHA256 против векторов RFC 5869', () => {
  // Векторы SHA-256 из приложения A RFC 5869. Проверяют KDF отдельно от
  // всего остального: расхождение KDF между Node и C++ проявляется
  // ИСКЛЮЧИТЕЛЬНО как провал GCM-тега, то есть без единого признака причины.
  const VECTORS = [
    {
      name: 'Test Case 1',
      ikm: Buffer.alloc(22, 0x0b),
      salt: Buffer.from('000102030405060708090a0b0c', 'hex'),
      info: Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'),
      length: 42,
      okm: '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    },
    {
      name: 'Test Case 2 — длинные вход и выход, Expand в три итерации',
      ikm: Buffer.from(Array.from({ length: 80 }, (_, i) => i)),
      salt: Buffer.from(Array.from({ length: 80 }, (_, i) => 0x60 + i)),
      info: Buffer.from(Array.from({ length: 80 }, (_, i) => 0xb0 + i)),
      length: 82,
      okm:
        'b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb4' +
        '1c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87',
    },
    {
      name: 'Test Case 3 — пустые salt и info',
      ikm: Buffer.alloc(22, 0x0b),
      salt: Buffer.alloc(0),
      info: Buffer.alloc(0),
      length: 42,
      okm: '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    },
  ];

  for (const v of VECTORS) {
    it(`совпадает с ${v.name}`, async () => {
      const svc = makeService();
      const okm = await svc.hkdfSha256(v.ikm, v.salt, v.info, v.length);
      expect(okm.toString('hex')).toBe(v.okm);
    });
  }

  it('возвращает Buffer, а не ArrayBuffer', async () => {
    // hkdf отдаёт ArrayBuffer; без обёртки .toString('hex') ниже по стеку
    // молча даст мусор, и это всплывёт только провалом тега у клиента.
    const okm = await makeService().hkdfSha256(Buffer.alloc(32, 1), Buffer.alloc(12, 2), INFO, 32);
    expect(Buffer.isBuffer(okm)).toBe(true);
    expect(okm).toHaveLength(32);
  });
});

describe('CryptoService — вывод эфемерного ключа payload', () => {
  it('совпадает с разложением на два HMAC — тем, что делает C++', async () => {
    const svc = makeService();
    const iv = Buffer.from('a1a2a3a4a5a6a7a8a9aaabac', 'hex');

    const key = await svc.derivePayloadKey(SESSION_KEY, iv);

    expect(key).toHaveLength(32);
    expect(key.equals(deriveKeyIndependently(SESSION_KEY, iv))).toBe(true);
  });

  it('даёт разные ключи для разных IV при том же sessionKey', async () => {
    // Соль = серверный IV, поэтому клиент, переиспользующий sessionKey,
    // всё равно получает свежий ключ на каждый ответ. Защитой от повтора
    // sessionKey это НЕ является — за это отвечает 400 SESSION_KEY_REUSED.
    const svc = makeService();
    const a = await svc.derivePayloadKey(SESSION_KEY, Buffer.alloc(12, 1));
    const b = await svc.derivePayloadKey(SESSION_KEY, Buffer.alloc(12, 2));

    expect(a.equals(b)).toBe(false);
  });

  it('отвергает sessionKey неверной длины', async () => {
    const svc = makeService();
    const iv = Buffer.alloc(12, 7);

    await expect(svc.derivePayloadKey('ab'.repeat(31), iv)).rejects.toThrow(/sessionKey/);
    await expect(svc.derivePayloadKey(SESSION_KEY.slice(0, 63), iv)).rejects.toThrow(/sessionKey/);
    await expect(svc.derivePayloadKey(SESSION_KEY + 'aa', iv)).rejects.toThrow(/sessionKey/);
    await expect(svc.derivePayloadKey('', iv)).rejects.toThrow(/sessionKey/);
  });

  it('отвергает sessionKey не-hex и в верхнем регистре', async () => {
    // Верхний регистр не нормализуется намеренно: два допустимых
    // представления одного ключа однажды разойдутся в векторах и тестах.
    const svc = makeService();
    const iv = Buffer.alloc(12, 7);

    await expect(svc.derivePayloadKey(SESSION_KEY.toUpperCase(), iv)).rejects.toThrow(/sessionKey/);
    await expect(svc.derivePayloadKey('zz'.repeat(32), iv)).rejects.toThrow(/sessionKey/);
  });

  it('отвергает соль неверной длины', async () => {
    const svc = makeService();
    await expect(svc.derivePayloadKey(SESSION_KEY, Buffer.alloc(16, 1))).rejects.toThrow(/12 байт/);
  });
});

describe('CryptoService — заголовки и AAD из одного выражения', () => {
  it('кладёт в AAD ровно те строки, что уходят в заголовки', async () => {
    const binding = makeService().buildPayloadBinding(FIELDS);

    expect(binding.aad.toString('utf8')).toBe(
      [
        'lp/payload/v1',
        binding.productSlug,
        binding.headers['X-Payload-Sha256'],
        binding.headers['X-Payload-Size'],
        binding.headers['X-Payload-Version'],
      ].join('\n'),
    );
  });

  it('разделяет поля одним 0x0A и не ставит завершающий перевод строки', async () => {
    const aad = makeService().buildPayloadBinding(FIELDS).aad;

    expect(aad.filter((b) => b === 0x0a)).toHaveLength(4);
    expect(aad[aad.length - 1]).not.toBe(0x0a);
  });

  it('канонизирует значение ОДИН раз — заголовок и AAD разъехаться не могут', async () => {
    // Хвостовой пробел в version из копипаста в админке — реальный спусковой
    // крючок: клиент обрезает значение заголовка с обеих сторон, и один байт
    // разницы даёт провал тега на 100% запросов к сборке при чистых 200
    // в наших логах.
    const binding = makeService().buildPayloadBinding({
      ...FIELDS,
      version: ' 1.2.0 ',
      sha256: 'AB'.repeat(32),
      size: 614400n,
    });

    expect(binding.headers['X-Payload-Version']).toBe('1.2.0');
    expect(binding.headers['X-Payload-Sha256']).toBe('ab'.repeat(32));
    expect(binding.headers['X-Payload-Size']).toBe('614400');
    expect(binding.aad.toString('utf8')).toContain('\n1.2.0');
    expect(binding.aad.toString('utf8')).not.toContain(' ');
  });

  it('останавливает выдачу на неканоничном значении вместо провала тега у клиента', () => {
    const svc = makeService();

    expect(() => svc.buildPayloadBinding({ ...FIELDS, version: '1.2.0 beta' })).toThrow(/version/);
    expect(() => svc.buildPayloadBinding({ ...FIELDS, version: '' })).toThrow(/version/);
    expect(() => svc.buildPayloadBinding({ ...FIELDS, sha256: 'ab'.repeat(31) })).toThrow(/sha256/);
    expect(() => svc.buildPayloadBinding({ ...FIELDS, productSlug: 'FC26' })).toThrow(
      /productSlug/,
    );
    expect(() => svc.buildPayloadBinding({ ...FIELDS, size: 0 })).toThrow(/size/);
    expect(() => svc.buildPayloadBinding({ ...FIELDS, size: 'много' })).toThrow(/size/);
  });

  it('не пропускает разделитель AAD внутрь значения поля', () => {
    // Иначе слаг вида "fc26\n<что угодно>" переписал бы структуру AAD.
    const svc = makeService();
    expect(() => svc.buildPayloadBinding({ ...FIELDS, productSlug: 'fc26\nfc27' })).toThrow();
    expect(() => svc.buildPayloadBinding({ ...FIELDS, version: '1.2\n.0' })).toThrow();
  });
});

describe('CryptoService — шифрование payload', () => {
  const PLAINTEXT = Buffer.from('FC26 payload — 3 МБ в бою, 40 байт в тесте\n', 'utf8');

  it('расшифровывается независимой реализацией с тем же ключом и AAD', async () => {
    const svc = makeService();
    const binding = svc.buildPayloadBinding(FIELDS);

    const sealed = await svc.sealForSession(PLAINTEXT, SESSION_KEY, binding.aad);

    expect(sealed.iv).toHaveLength(12);
    expect(sealed.tag).toHaveLength(16);
    // GCM не меняет длину — Content-Length равен длине открытого текста.
    expect(sealed.ciphertext).toHaveLength(PLAINTEXT.length);

    const key = deriveKeyIndependently(SESSION_KEY, sealed.iv);
    const aad = buildAadIndependently({
      productSlug: binding.productSlug,
      sha256: binding.headers['X-Payload-Sha256'],
      size: binding.headers['X-Payload-Size'],
      version: binding.headers['X-Payload-Version'],
    });

    expect(open(sealed, key, aad).equals(PLAINTEXT)).toBe(true);
  });

  it('генерирует свежий IV на каждый ответ', async () => {
    // Повтор пары (ключ, IV) в GCM — не ослабление, а полная потеря
    // стойкости вплоть до раскрытия ключа аутентификации. Одинаковые
    // шифротексты — прямой признак того, что IV где-то зафиксировали.
    const svc = makeService();
    const aad = svc.buildPayloadBinding(FIELDS).aad;

    const a = await svc.sealForSession(PLAINTEXT, SESSION_KEY, aad);
    const b = await svc.sealForSession(PLAINTEXT, SESSION_KEY, aad);

    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.tag.equals(b.tag)).toBe(false);

    // Оба при этом расшифровываются — переиспользование sessionKey клиентом
    // не создаёт повтора пары (ключ, IV), потому что IV генерирует сервер.
    for (const sealed of [a, b]) {
      const key = deriveKeyIndependently(SESSION_KEY, sealed.iv);
      expect(open(sealed, key, aad).equals(PLAINTEXT)).toBe(true);
    }
  });

  it('не расшифровывается ключом от другого sessionKey', async () => {
    const svc = makeService();
    const aad = svc.buildPayloadBinding(FIELDS).aad;
    const other = 'ff'.repeat(32);

    const sealed = await svc.sealForSession(PLAINTEXT, SESSION_KEY, aad);

    expect(() => open(sealed, deriveKeyIndependently(other, sealed.iv), aad)).toThrow();
  });

  it('воспроизводится байт в байт при заданном IV — на этом стоят векторы', async () => {
    const svc = makeService();
    const aad = svc.buildPayloadBinding(FIELDS).aad;
    const iv = Buffer.from('a1a2a3a4a5a6a7a8a9aaabac', 'hex');

    const a = await svc.sealForSessionWithIv(PLAINTEXT, SESSION_KEY, aad, iv);
    const b = await svc.sealForSessionWithIv(PLAINTEXT, SESSION_KEY, aad, iv);

    expect(a.ciphertext.equals(b.ciphertext)).toBe(true);
    expect(a.tag.equals(b.tag)).toBe(true);
  });

  it('шифрует многоблочный текст — одного блока мало, чтобы поймать счётчик', async () => {
    const svc = makeService();
    const aad = svc.buildPayloadBinding(FIELDS).aad;
    const big = Buffer.alloc(4096);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 7 + 13) % 256;

    const sealed = await svc.sealForSession(big, SESSION_KEY, aad);
    const key = deriveKeyIndependently(SESSION_KEY, sealed.iv);

    expect(open(sealed, key, aad).equals(big)).toBe(true);
  });
});

describe('CryptoService — AAD действительно входит в тег', () => {
  const PLAINTEXT = Buffer.from('содержимое сборки', 'utf8');

  /**
   * Каждый случай — подмена ОДНОГО поля AAD на стороне «клиента».
   * Без этих проверок решение об AAD не проверено ничем: заголовки
   * X-Payload-Sha256 и X-Payload-Size лежали бы вне AEAD.
   */
  const TAMPERED: Array<{ name: string; fields: PayloadBindingFields }> = [
    { name: 'productSlug', fields: { ...FIELDS, productSlug: 'fc27' } },
    { name: 'X-Payload-Sha256', fields: { ...FIELDS, sha256: 'cd'.repeat(32) } },
    { name: 'X-Payload-Size', fields: { ...FIELDS, size: 614401 } },
    { name: 'X-Payload-Version', fields: { ...FIELDS, version: '1.2.1' } },
  ];

  for (const t of TAMPERED) {
    it(`падает на теге при подмене ${t.name}`, async () => {
      const svc = makeService();
      const sealed = await svc.sealForSession(
        PLAINTEXT,
        SESSION_KEY,
        svc.buildPayloadBinding(FIELDS).aad,
      );
      const key = deriveKeyIndependently(SESSION_KEY, sealed.iv);

      expect(() => open(sealed, key, svc.buildPayloadBinding(t.fields).aad)).toThrow();
    });
  }

  it('оставляет шифротекст неизменным при подмене AAD — расходится только тег', async () => {
    // Свойство GCM, которое обязан знать разработчик клиента: одинаковое
    // тело и разный тег означают расхождение AAD, а не порчу канала.
    const svc = makeService();
    const iv = Buffer.from('a1a2a3a4a5a6a7a8a9aaabac', 'hex');

    const good = await svc.sealForSessionWithIv(
      PLAINTEXT,
      SESSION_KEY,
      svc.buildPayloadBinding(FIELDS).aad,
      iv,
    );
    const bad = await svc.sealForSessionWithIv(
      PLAINTEXT,
      SESSION_KEY,
      svc.buildPayloadBinding({ ...FIELDS, productSlug: 'fc27' }).aad,
      iv,
    );

    expect(bad.ciphertext.equals(good.ciphertext)).toBe(true);
    expect(bad.tag.equals(good.tag)).toBe(false);
  });

  it('падает на теге при порче шифротекста', async () => {
    // Обрыв соединения на середине тела даёт ровно этот исход, поэтому
    // клиент обязан отличать усечённый ответ от подмены сам — на теге
    // эти два случая неразличимы.
    const svc = makeService();
    const aad = svc.buildPayloadBinding(FIELDS).aad;
    const sealed = await svc.sealForSession(PLAINTEXT, SESSION_KEY, aad);
    const key = deriveKeyIndependently(SESSION_KEY, sealed.iv);

    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] = flipped.readUInt8(0) ^ 0x01;
    expect(() => open({ ...sealed, ciphertext: flipped }, key, aad)).toThrow();

    const truncated = sealed.ciphertext.subarray(0, sealed.ciphertext.length - 1);
    expect(() => open({ ...sealed, ciphertext: truncated }, key, aad)).toThrow();
  });

  it('падает на теге при порче самого тега', async () => {
    const svc = makeService();
    const aad = svc.buildPayloadBinding(FIELDS).aad;
    const sealed = await svc.sealForSession(PLAINTEXT, SESSION_KEY, aad);
    const key = deriveKeyIndependently(SESSION_KEY, sealed.iv);

    const tag = Buffer.from(sealed.tag);
    tag[15] = tag.readUInt8(15) ^ 0x80;
    expect(() => open({ ...sealed, tag }, key, aad)).toThrow();
  });
});
