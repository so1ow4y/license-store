/**
 * Генератор контрольных векторов для разработчика загрузчика.
 *
 * Векторы получаются из ТОЙ ЖЕ реализации, что работает на сервере,
 * поэтому расхождение между клиентом и сервером ловится до того,
 * как появится первый эндпоинт.
 *
 * Запуск:  npx tsx test/generate-vectors.ts > ../../docs/SIGNATURE-VECTORS.md
 */
import { createHash } from 'node:crypto';
import { SignatureService } from '../src/common/crypto/signature.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import type { Env } from '../src/common/config/env.schema';

const service = new SignatureService(null as never, null as never);

const SECRET = 'test-signing-secret-do-not-use-in-production';

interface Vector {
  title: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}

const VECTORS: Vector[] = [
  {
    title: 'GET без тела',
    method: 'GET',
    path: '/api/v1/launcher/update',
    timestamp: '1785500000',
    nonce: '00112233445566778899aabbccddeeff',
    rawBody: '',
  },
  {
    title: 'POST с телом JSON',
    method: 'POST',
    path: '/api/v1/launcher/license/check',
    timestamp: '1785500000',
    nonce: '9f86d081884c7d659a2feaa0c55ad015',
    rawBody: '{"productSlug":"fc26","hwid":"WD-WCC4N1234567","clientVersion":"1.4.2"}',
  },
  {
    title: 'POST, метод в нижнем регистре — подпись та же, что для POST',
    method: 'post',
    path: '/api/v1/launcher/license/check',
    timestamp: '1785500000',
    nonce: '9f86d081884c7d659a2feaa0c55ad015',
    rawBody: '{"productSlug":"fc26","hwid":"WD-WCC4N1234567","clientVersion":"1.4.2"}',
  },
  {
    title: 'POST с кириллицей в теле (UTF-8)',
    method: 'POST',
    path: '/api/v1/launcher/logs',
    timestamp: '1785500000',
    nonce: 'ffeeddccbbaa99887766554433221100',
    rawBody: '{"kind":"error","summary":"не удалось прочитать Disk ID"}',
  },
];

const HWID_CASES = [
  '  wd-wcc4n 1234567 \t',
  'WD-WCC4N1234567',
  'wd-WCC4N1234567',
  'S4EWNX0N123456A',
];

function md(): string {
  const lines: string[] = [];

  lines.push('# Контрольные векторы подписи запросов');
  lines.push('');
  lines.push('Сгенерировано из серверной реализации `SignatureService`.');
  lines.push('Реализация на C++ обязана давать те же значения байт в байт.');
  lines.push('');
  lines.push('**Секрет для всех примеров:**');
  lines.push('');
  lines.push('```');
  lines.push(SECRET);
  lines.push('```');
  lines.push('');
  lines.push('Секрет тестовый. В бою `signingSecret` выдаётся сервером при входе.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Подпись');
  lines.push('');

  for (const v of VECTORS) {
    const payload = service.buildPayload(v);
    const signature = service.sign(payload, SECRET);
    const bodyHash = v.rawBody
      ? createHash('sha256').update(v.rawBody, 'utf8').digest('hex')
      : createHash('sha256').update('').digest('hex');

    lines.push(`### ${v.title}`);
    lines.push('');
    lines.push('| Поле | Значение |');
    lines.push('|---|---|');
    lines.push(`| METHOD | \`${v.method}\` |`);
    lines.push(`| PATH | \`${v.path}\` |`);
    lines.push(`| TIMESTAMP | \`${v.timestamp}\` |`);
    lines.push(`| NONCE | \`${v.nonce}\` |`);
    lines.push(`| BODY | ${v.rawBody ? `\`${v.rawBody}\`` : '_пустое_'} |`);
    lines.push(`| SHA256(BODY) | \`${bodyHash}\` |`);
    lines.push('');
    lines.push('Строка для подписи (символы `\\n` показаны явно):');
    lines.push('');
    lines.push('```');
    lines.push(payload.replace(/\n/g, '\\n\n'));
    lines.push('```');
    lines.push('');
    lines.push('**Подпись:**');
    lines.push('');
    lines.push('```');
    lines.push(signature);
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Нормализация Disk ID');
  lines.push('');
  lines.push('Клиент отправляет уже нормализованное значение. Хеш считает сервер,');
  lines.push('но нормализация обязана совпадать — иначе одна машина даст разные хеши.');
  lines.push('');

  const crypto = new CryptoService({
    ENCRYPTION_KEY: '11'.repeat(32),
    ENCRYPTION_KEY_VERSION: 1,
    HWID_PEPPER: 'aa'.repeat(32),
  } as Env);

  lines.push('| Что прочитал загрузчик | После нормализации |');
  lines.push('|---|---|');
  for (const raw of HWID_CASES) {
    lines.push(`| \`${JSON.stringify(raw).slice(1, -1)}\` | \`${crypto.normalizeDiskId(raw)}\` |`);
  }
  lines.push('');
  lines.push('Правила: убрать пробелы по краям, убрать **все** внутренние');
  lines.push('пробельные символы, привести к верхнему регистру.');
  lines.push('');
  lines.push('Первые три строки таблицы — один и тот же диск. Если реализация');
  lines.push('даёт для них разные значения, пользователь после обновления драйвера');
  lines.push('получит «устройство не совпадает».');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Хеш пустого тела');
  lines.push('');
  lines.push('Часто реализуют неверно — подставляют пустую строку вместо её хеша.');
  lines.push('');
  lines.push('```');
  lines.push(createHash('sha256').update('').digest('hex'));
  lines.push('```');

  return lines.join('\n');
}

process.stdout.write(md());
