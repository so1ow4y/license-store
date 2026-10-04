/**
 * Генератор контрольных векторов шифрования payload'а.
 *
 * Векторы считает ТА ЖЕ реализация, что работает на сервере (CryptoService),
 * поэтому расхождение между Node и C++ ловится до того, как появится сеть.
 * Это не украшение: расхождение KDF или канонизации AAD проявляется
 * ИСКЛЮЧИТЕЛЬНО как провал GCM-тега — состояние без единого признака причины,
 * и без векторов отладка превращается в двоичный поиск по двум реализациям.
 *
 * Запуск:  npx tsx scripts/generate-payload-vectors.ts > ../../docs/PAYLOAD-VECTORS.md
 *
 * Каталог scripts/ не входит в tsconfig include (там src/test/prisma) —
 * файл гоняется через tsx и в сборку не попадает.
 */
import { Logger } from '@nestjs/common';
import { createHash, createHmac, hkdf } from 'node:crypto';
import { promisify } from 'node:util';

import { CryptoService, type PayloadBindingFields } from '../src/common/crypto/crypto.service';
import type { Env } from '../src/common/config/env.schema';

// Конструктор CryptoService пишет строку в лог, а вывод скрипта уходит
// в markdown-файл целиком — лог испортил бы документ.
Logger.overrideLogger(false);

const crypto = new CryptoService({
  ENCRYPTION_KEY: '11'.repeat(32),
  ENCRYPTION_KEY_VERSION: 1,
  HWID_PEPPER: 'aa'.repeat(32),
} as Env);

const hkdfAsync = promisify(hkdf) as (
  digest: string,
  ikm: Buffer,
  salt: Buffer,
  info: Buffer,
  keylen: number,
) => Promise<ArrayBuffer>;

/** Байты a..b включительно — так RFC 5869 задаёт длинные входы. */
function byteRange(from: number, to: number): Buffer {
  return Buffer.from(Array.from({ length: to - from + 1 }, (_, i) => from + i));
}

/** Опубликованные векторы RFC 5869, приложение A. */
interface RfcVector {
  name: string;
  digest: 'sha256' | 'sha1';
  ikm: Buffer;
  salt: Buffer;
  info: Buffer;
  length: number;
  prk: string;
  okm: string;
}

const RFC_VECTORS: RfcVector[] = [
  {
    name: 'Test Case 1 — SHA-256, базовый',
    digest: 'sha256',
    ikm: Buffer.alloc(22, 0x0b),
    salt: Buffer.from('000102030405060708090a0b0c', 'hex'),
    info: Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'),
    length: 42,
    prk: '077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5',
    okm: '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
  },
  {
    name: 'Test Case 2 — SHA-256, длинные вход и выход',
    digest: 'sha256',
    ikm: byteRange(0x00, 0x4f),
    salt: byteRange(0x60, 0xaf),
    info: byteRange(0xb0, 0xff),
    length: 82,
    prk: '06a6b88c5853361a06104c9ceb35b45cef760014904671014a193f40c15fc244',
    okm:
      'b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb4' +
      '1c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87',
  },
  {
    name: 'Test Case 3 — SHA-256, пустые salt и info',
    digest: 'sha256',
    ikm: Buffer.alloc(22, 0x0b),
    salt: Buffer.alloc(0),
    info: Buffer.alloc(0),
    length: 42,
    prk: '19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04',
    okm: '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
  },
  {
    name: 'Test Case 4 — SHA-1, базовый',
    digest: 'sha1',
    ikm: Buffer.alloc(11, 0x0b),
    salt: Buffer.from('000102030405060708090a0b0c', 'hex'),
    info: Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'),
    length: 42,
    prk: '9b6c18c432a7bf8f0e71c8eb88f4b30baa2ba243',
    okm: '085a01ea1b10f36933068b56efa5ad81a4f14b822f5b091568a9cdd4f155fda2c22e422478d305f3f896',
  },
  {
    name: 'Test Case 5 — SHA-1, длинные вход и выход',
    digest: 'sha1',
    ikm: byteRange(0x00, 0x4f),
    salt: byteRange(0x60, 0xaf),
    info: byteRange(0xb0, 0xff),
    length: 82,
    prk: '8adae09a2a307059478d309b26c4115a224cfaf6',
    okm:
      '0bd770a74d1160f7c9f12cd5912a06ebff6adcae899d92191fe4305673ba2ffe8fa3f1a4e5ad79f3f334b' +
      '3b202b2173c486ea37ce3d397ed034c7f9dfeb15c5e927336d0441f4c4300e2cff0d0900b52d3b4',
  },
  {
    name: 'Test Case 6 — SHA-1, пустые salt и info',
    digest: 'sha1',
    ikm: Buffer.alloc(22, 0x0b),
    salt: Buffer.alloc(0),
    info: Buffer.alloc(0),
    length: 42,
    prk: 'da8c8a73c7fa77288ec6f5e7c297786aa0d32d01',
    okm: '0ac1af7002b3d761d1e55298da9d0506b9ae52057220a306e07b6b87e8df21d0ea00033de03984d34918',
  },
  {
    name: 'Test Case 7 — SHA-1, salt не задан',
    digest: 'sha1',
    ikm: Buffer.alloc(22, 0x0c),
    salt: Buffer.alloc(0),
    info: Buffer.alloc(0),
    length: 42,
    prk: '2adccada18779e7c2077ad2eb19d3f3e731385dd',
    okm: '2c91117204d745f3500d636a62f64f0ab3bae548aa53d423b0d1f27ebba6f5e5673a081d70cce7acfc48',
  },
];

/** Боевые параметры вектора: фиксированы, чтобы результат воспроизводился. */
const SESSION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const IV_HEX = 'a1a2a3a4a5a6a7a8a9aaabac';
const IV = Buffer.from(IV_HEX, 'hex');
const PRODUCT_SLUG = 'fc26';

/** Вектор A — короткий, печатается целиком. Кириллица проверяет UTF-8 в теле. */
const PLAINTEXT_A = Buffer.from('FC26 payload vector A — байты, а не строка\n', 'utf8');
const VERSION_A = '1.2.0';

/** Вектор B — многоблочный: один блок AES не поймал бы ошибку счётчика. */
const PLAINTEXT_B = Buffer.alloc(4096);
for (let i = 0; i < PLAINTEXT_B.length; i += 1) {
  PLAINTEXT_B[i] = (i * 7 + 13) % 256;
}
const VERSION_B = '9.9.9';

function fail(message: string): never {
  process.stderr.write(`РАСХОЖДЕНИЕ: ${message}\n`);
  process.exit(1);
}

/** Hex-блок с переносом по 32 байта — иначе строка не читается в диффе. */
function hexBlock(buf: Buffer, bytesPerLine = 32): string {
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i += bytesPerLine) {
    lines.push(buf.subarray(i, i + bytesPerLine).toString('hex'));
  }
  return lines.length > 0 ? lines.join('\n') : '(пусто)';
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function main(): Promise<void> {
  const out: string[] = [];
  const push = (...lines: string[]): void => {
    out.push(...lines);
  };

  push('# Контрольные векторы шифрования payload\'а');
  push('');
  push('Сгенерировано `apps/api/scripts/generate-payload-vectors.ts` из серверной');
  push('реализации `CryptoService`. Реализация на C++ обязана давать те же значения');
  push('байт в байт.');
  push('');
  push('Файл не редактируется руками: он перегенерируется скриптом.');
  push('');
  push('> Зачем он нужен. Расхождение KDF или канонизации AAD между Node и C++');
  push('> проявляется ИСКЛЮЧИТЕЛЬНО как провал GCM-тега — у клиента нет ни кода');
  push('> ошибки, ни подсказки, что именно разошлось. Векторы разбивают эту');
  push('> неразличимую точку отказа на отдельно проверяемые шаги: HKDF, AAD,');
  push('> шифрование. Пока вектор не сошёлся на обеих сторонах, писать интеграцию');
  push('> бессмысленно.');
  push('');
  push('---');
  push('');
  push('## Схема');
  push('');
  push('```');
  push('key  = HKDF-SHA256(ikm = sessionKey(32 байта), salt = IV(12 байт),');
  push('                   info = ASCII "lp/payload/v1", L = 32)');
  push('AAD  = "lp/payload/v1" \\n productSlug \\n sha256 \\n size \\n version');
  push('тело = AES-256-GCM(key, IV, AAD, открытый текст), тег 16 байт отдельно');
  push('```');
  push('');
  push('- `IV` генерирует СЕРВЕР на каждый ответ и отдаёт в `X-Payload-Nonce` (24 hex).');
  push('- Тег уходит в `X-Payload-Tag` (32 hex), к телу НЕ приклеивается.');
  push('- В AAD поля разделены ОДНИМ `0x0A`, завершающего перевода строки НЕТ.');
  push('- Все значения — ASCII: hex в нижнем регистре, size десятичный без ведущих нулей.');
  push('- Клиент обязан обрезать значение заголовка с ОБЕИХ сторон перед сборкой AAD.');
  push('');
  push('Чего схема НЕ даёт — чтобы никто не рассчитывал на несуществующее:');
  push('');
  push('- Соль, равная IV, не защищает от клиента, переиспользующего `sessionKey`.');
  push('  Повтор пары (ключ, IV) исключает серверная генерация IV, и это свойство');
  push('  держится при ЛЮБОЙ соли. Реакция на сломанный клиент — отказ');
  push('  `400 SESSION_KEY_REUSED`, а не KDF.');
  push('- AAD не защищает от противника, терминирующего TLS: он видит `sessionKey`');
  push('  в теле запроса, выводит тот же ключ и переподписывает ответ целиком.');
  push('  AAD ловит НАШЕ рассогласование заголовков и тела, и только его.');
  push('- `X-Request-Id` в AAD не входит и подменяем — доверенной ссылкой');
  push('  на инцидент он не является.');
  push('');
  push('---');
  push('');
  push('## 1. HKDF-SHA256 — опубликованные векторы RFC 5869');
  push('');
  push('Проверяют KDF отдельно от всего остального. Значения ниже посчитаны этой');
  push('реализацией и сверены с приложением A RFC 5869 при генерации — если бы они');
  push('разошлись, скрипт бы упал.');
  push('');
  push('Случаи 1-3 идут ровно тем же путём, что боевой вывод ключа (SHA-256).');
  push('Случаи 4-7 на SHA-1 сервером не используются и приведены только для');
  push('проверки общей реализации `HmacSha256` на C++.');
  push('');

  for (const v of RFC_VECTORS) {
    const okm =
      v.digest === 'sha256'
        ? await crypto.hkdfSha256(v.ikm, v.salt, v.info, v.length)
        : Buffer.from(await hkdfAsync(v.digest, v.ikm, v.salt, v.info, v.length));
    const prk = createHmac(v.digest, v.salt).update(v.ikm).digest();

    if (okm.toString('hex') !== v.okm) {
      fail(`${v.name}: OKM не совпал с опубликованным в RFC 5869`);
    }
    if (prk.toString('hex') !== v.prk) {
      fail(`${v.name}: PRK не совпал с опубликованным в RFC 5869`);
    }

    push(`### ${v.name}`);
    push('');
    push('| Поле | Значение |');
    push('|---|---|');
    push(`| Hash | \`${v.digest === 'sha256' ? 'SHA-256' : 'SHA-1'}\` |`);
    push(`| IKM (${v.ikm.length} б) | \`${v.ikm.toString('hex') || '(пусто)'}\` |`);
    push(`| salt (${v.salt.length} б) | \`${v.salt.toString('hex') || '(пусто)'}\` |`);
    push(`| info (${v.info.length} б) | \`${v.info.toString('hex') || '(пусто)'}\` |`);
    push(`| L | \`${v.length}\` |`);
    push('');
    push('**PRK:**');
    push('');
    push('```');
    push(prk.toString('hex'));
    push('```');
    push('');
    push('**OKM:**');
    push('');
    push('```');
    push(hexBlock(okm));
    push('```');
    push('');
  }

  push('В случае 7 RFC оговаривает «salt не задан», что по RFC 5869 §2.2 означает');
  push('соль из HashLen нулевых байт. Здесь передана ПУСТАЯ соль: HMAC дополняет');
  push('короткий ключ нулями до размера блока, поэтому результат тот же — что и');
  push('подтверждается совпадением с опубликованным значением.');
  push('');
  push('---');
  push('');
  push('## 2. Вывод боевого ключа');
  push('');
  push('Те же параметры, что в бою: `info` фиксирована, `L` = 32, соль — серверный IV.');
  push('');
  push('| Поле | Значение |');
  push('|---|---|');
  push(`| sessionKey (IKM, 32 б) | \`${SESSION_KEY}\` |`);
  push(`| IV = salt (12 б) | \`${IV_HEX}\` |`);
  push('| info | ASCII `lp/payload/v1` (13 б) |');
  push(`| info в hex | \`${Buffer.from('lp/payload/v1', 'ascii').toString('hex')}\` |`);
  push('| L | `32` |');
  push('');

  const key = await crypto.derivePayloadKey(SESSION_KEY, IV);
  const prk = createHmac('sha256', IV).update(Buffer.from(SESSION_KEY, 'hex')).digest();
  const okmManual = createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from('lp/payload/v1', 'ascii'), Buffer.from([0x01])]))
    .digest();

  if (!okmManual.equals(key)) {
    fail('разложение HKDF на два HMAC не сошлось с crypto.hkdf');
  }

  push('**PRK = HMAC-SHA256(key = IV, msg = sessionKey):**');
  push('');
  push('```');
  push(prk.toString('hex'));
  push('```');
  push('');
  push('**Ключ AES-256 = OKM = HMAC-SHA256(key = PRK, msg = info || 0x01):**');
  push('');
  push('```');
  push(key.toString('hex'));
  push('```');
  push('');
  push('При `L` = 32 = длине хеша Expand это РОВНО одна итерация: на C++ два вызова');
  push('`HmacSha256` и ноль циклов. Скрипт при генерации сверяет это разложение');
  push('с результатом `crypto.hkdf` — если они разойдутся, вектор не выпустится.');
  push('');
  push('---');
  push('');

  interface FullVector {
    title: string;
    plaintext: Buffer;
    version: string;
    plaintextShown: boolean;
    note: string;
  }

  const fullVectors: FullVector[] = [
    {
      title: '3. Вектор A — короткий, печатается целиком',
      plaintext: PLAINTEXT_A,
      version: VERSION_A,
      plaintextShown: true,
      note: 'Открытый текст в UTF-8, с переводом строки внутри: транспорт обязан отдать байты как есть.',
    },
    {
      title: '4. Вектор B — многоблочный, 4096 байт',
      plaintext: PLAINTEXT_B,
      version: VERSION_B,
      plaintextShown: false,
      note: 'Открытый текст задан правилом `plaintext[i] = (i * 7 + 13) % 256`, i от 0 до 4095. Один блок AES не поймал бы ошибку в счётчике CTR.',
    },
  ];

  for (const v of fullVectors) {
    const binding = crypto.buildPayloadBinding({
      productSlug: PRODUCT_SLUG,
      sha256: sha256(v.plaintext),
      size: v.plaintext.length,
      version: v.version,
    });
    const sealed = await crypto.sealForSessionWithIv(v.plaintext, SESSION_KEY, binding.aad, IV);

    push(`## ${v.title}`);
    push('');
    push(v.note);
    push('');
    push('| Поле | Значение |');
    push('|---|---|');
    push(`| productSlug (в теле запроса) | \`${binding.productSlug}\` |`);
    push(`| X-Payload-Sha256 | \`${binding.headers['X-Payload-Sha256']}\` |`);
    push(`| X-Payload-Size | \`${binding.headers['X-Payload-Size']}\` |`);
    push(`| X-Payload-Version | \`${binding.headers['X-Payload-Version']}\` |`);
    push(`| X-Payload-Nonce (IV) | \`${sealed.iv.toString('hex')}\` |`);
    push(`| X-Payload-Tag | \`${sealed.tag.toString('hex')}\` |`);
    push('');
    push('AAD, символы `\\n` показаны явно:');
    push('');
    push('```');
    push(binding.aad.toString('utf8').replace(/\n/g, '\\n\n'));
    push('```');
    push('');
    push(`AAD в hex, длина ${binding.aad.length}, завершающего \`0a\` НЕТ:`);
    push('');
    push('```');
    push(hexBlock(binding.aad));
    push('```');
    push('');

    if (v.plaintextShown) {
      push(`Открытый текст, длина ${v.plaintext.length}, hex:`);
      push('');
      push('```');
      push(hexBlock(v.plaintext));
      push('```');
      push('');
      push('Шифротекст (без тега), hex:');
      push('');
      push('```');
      push(hexBlock(sealed.ciphertext));
      push('```');
      push('');
    } else {
      push('| Контроль | Значение |');
      push('|---|---|');
      push(`| SHA-256 открытого текста | \`${sha256(v.plaintext)}\` |`);
      push(`| SHA-256 шифротекста | \`${sha256(sealed.ciphertext)}\` |`);
      push(`| Первые 32 байта шифротекста | \`${sealed.ciphertext.subarray(0, 32).toString('hex')}\` |`);
      push(`| Последние 32 байта шифротекста | \`${sealed.ciphertext.subarray(-32).toString('hex')}\` |`);
      push('');
    }

    push(`Длина шифротекста равна длине открытого текста (${sealed.ciphertext.length}).`);
    push('GCM — потоковый режим, тег вынесен в отдельный заголовок.');
    push('');
    push('---');
    push('');
  }

  push('## 5. Отрицательный вектор — подменённый productSlug');
  push('');
  push('Тот же вектор A, но AAD собран со слагом `fc27`. Проверяет, что AAD');
  push('действительно входит в тег, а не лежит рядом.');
  push('');

  const bindingA = crypto.buildPayloadBinding({
    productSlug: PRODUCT_SLUG,
    sha256: sha256(PLAINTEXT_A),
    size: PLAINTEXT_A.length,
    version: VERSION_A,
  });
  const sealedA = await crypto.sealForSessionWithIv(PLAINTEXT_A, SESSION_KEY, bindingA.aad, IV);

  const bindingWrong = crypto.buildPayloadBinding({
    productSlug: 'fc27',
    sha256: sha256(PLAINTEXT_A),
    size: PLAINTEXT_A.length,
    version: VERSION_A,
  });
  const sealedWrong = await crypto.sealForSessionWithIv(
    PLAINTEXT_A,
    SESSION_KEY,
    bindingWrong.aad,
    IV,
  );

  if (!sealedWrong.ciphertext.equals(sealedA.ciphertext)) {
    fail('AAD повлиял на шифротекст — это противоречит определению GCM');
  }
  if (sealedWrong.tag.equals(sealedA.tag)) {
    fail('тег не изменился при смене AAD — AAD не участвует в аутентификации');
  }

  push('| Поле | Значение |');
  push('|---|---|');
  push(`| Тег при productSlug \`fc26\` | \`${sealedA.tag.toString('hex')}\` |`);
  push(`| Тег при productSlug \`fc27\` | \`${sealedWrong.tag.toString('hex')}\` |`);
  push('| Шифротекст | одинаковый в обоих случаях |');
  push('');
  push('Шифротекст не зависит от AAD по определению GCM — расходится только тег.');
  push('То же самое обязано происходить при подмене любого из `X-Payload-Sha256`,');
  push('`X-Payload-Size`, `X-Payload-Version`.');
  push('');
  push('---');
  push('');
  push('## 6. Канонизация полей');
  push('');
  push('Заголовки и AAD выводятся сервером из ОДНОГО выражения');
  push('(`CryptoService.buildPayloadBinding`). Разъехаться они не могут по');
  push('построению; таблица показывает, что именно уходит на провод.');
  push('');
  push('| Что лежит в сборке | Значение в заголовке и в AAD |');
  push('|---|---|');

  const canonCases: Array<{
    label: string;
    fields: PayloadBindingFields;
    field: 'X-Payload-Sha256' | 'X-Payload-Size' | 'X-Payload-Version';
  }> = [
    {
      label: 'version `1.2.0 ` (хвостовой пробел из копипаста)',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(32), size: 614400, version: '1.2.0 ' },
      field: 'X-Payload-Version',
    },
    {
      label: 'version ` 1.2.0` (пробел слева)',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(32), size: 614400, version: ' 1.2.0' },
      field: 'X-Payload-Version',
    },
    {
      label: 'sha256 в ВЕРХНЕМ регистре',
      fields: { productSlug: 'fc26', sha256: 'AB'.repeat(32), size: 614400, version: '1.2.0' },
      field: 'X-Payload-Sha256',
    },
    {
      label: 'size как BigInt `614400n`',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(32), size: 614400n, version: '1.2.0' },
      field: 'X-Payload-Size',
    },
    {
      label: 'size со строкой `007`',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(32), size: '007', version: '1.2.0' },
      field: 'X-Payload-Size',
    },
  ];

  for (const c of canonCases) {
    push(`| ${c.label} | \`${crypto.buildPayloadBinding(c.fields).headers[c.field]}\` |`);
  }

  push('');
  push('Что отвергается на сервере — вместо того чтобы уехать клиенту и провалить тег:');
  push('');
  push('| Что лежит в сборке | Результат |');
  push('|---|---|');

  const rejectCases: Array<{ label: string; fields: PayloadBindingFields }> = [
    {
      label: 'version `1.2.0 beta`',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(32), size: 614400, version: '1.2.0 beta' },
    },
    {
      label: 'version пустая',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(32), size: 614400, version: '' },
    },
    {
      label: 'sha256 из 63 символов',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(31) + 'a', size: 614400, version: '1.2.0' },
    },
    {
      label: 'productSlug `FC26`',
      fields: { productSlug: 'FC26', sha256: 'ab'.repeat(32), size: 614400, version: '1.2.0' },
    },
    {
      label: 'productSlug с переводом строки внутри',
      fields: { productSlug: 'fc26\nx', sha256: 'ab'.repeat(32), size: 614400, version: '1.2.0' },
    },
    {
      label: 'size = 0',
      fields: { productSlug: 'fc26', sha256: 'ab'.repeat(32), size: 0, version: '1.2.0' },
    },
  ];

  for (const c of rejectCases) {
    let result = 'ПРИНЯТО — этого быть не должно';
    try {
      crypto.buildPayloadBinding(c.fields);
    } catch {
      result = 'отказ, выдача остановлена (500 + строка в логе)';
    }
    if (result.startsWith('ПРИНЯТО')) {
      fail(`${c.label}: значение принято, хотя обязано быть отвергнуто`);
    }
    push(`| ${c.label.replace(/\n/g, '\\n')} | ${result} |`);
  }

  push('');
  push('---');
  push('');
  push('## 7. Порядок проверки на стороне клиента');
  push('');
  push('1. `HkdfExtract`/`HkdfExpand` против раздела 1 — пока не сошлось, дальше не идти.');
  push('2. Вывод ключа против раздела 2 — тот же `sessionKey` и тот же IV.');
  push('3. Сборка AAD против раздела 3: сравнивать БАЙТЫ, а не строку. Хвостовой');
  push('   пробел в значении заголовка виден только в hex.');
  push('4. Расшифровка вектора A и B, сверка sha256 открытого текста.');
  push('5. Раздел 5: подменить слаг в AAD и убедиться, что расшифровка ПАДАЕТ');
  push('   и в выходном буфере не остаётся ни байта открытого текста.');
  push('');

  process.stdout.write(out.join('\n') + '\n');
}

void main();
