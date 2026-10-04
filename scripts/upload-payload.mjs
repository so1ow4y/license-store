// ============================================================================
//  Загрузка payload’а (DLL) на сервер — весь путь от черновика до публикации.
//
//  ЗАЧЕМ СКРИПТ. Путь состоит из пяти шагов, и пропуск любого оставляет
//  сборку в состоянии, где загрузчик её не видит, а причина не очевидна:
//    1. черновик сборки          POST /products/:id/payloads
//    2. ссылка на заливку        POST /products/payloads/:buildId/upload-url
//    3. байты прямо в хранилище  PUT по выданной ссылке
//    4. подтверждение            POST /products/payloads/:buildId/confirm-upload
//    5. публикация               POST /products/payloads/:buildId/publish
//
//  Хеш и размер считает СЕРВЕР, прочитав объект: эталон от клиента не
//  принимается, потому что именно им загрузчик проверяет расшифрованный
//  payload. Ссылки на СКАЧИВАНИЕ не существует вовсе — бакет payload’ов
//  presigned на чтение не отдаёт.
//
//  Сам файл скрипт не разбирает: читает как байты и передаёт дальше.
//
//  Запуск:
//    node scripts/upload-payload.mjs <путь-к-dll>                     — локально
//    node scripts/upload-payload.mjs <путь-к-dll> 77.221.154.85       — на сервер
//
//  Переменные окружения:
//    LP_BASE     адрес API с /api/v1 на конце
//    LP_PRODUCT  slug продукта (по умолчанию fc26)
//    LP_VERSION  версия сборки payload’а (по умолчанию следующая свободная)
// ============================================================================

import { readFileSync, existsSync, statSync } from 'node:fs';
import { getAdminToken } from './_admin-token.mjs';

const FILE = process.argv[2] ?? '';
const HOST = (process.argv[3] ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const REMOTE = HOST !== '' && !/^(localhost|127\.0\.0\.1)$/.test(HOST);

const BASE = process.env.LP_BASE ?? (REMOTE ? `http://${HOST}/api/v1` : 'http://localhost:3000/api/v1');
const SLUG = process.env.LP_PRODUCT ?? 'fc26';

const head = (t) => console.log(`\n\x1b[36m=== ${t} ===\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m[OK]\x1b[0m   ${s}`);
const note = (s) => console.log(`         ${s}`);
const die = (s) => { console.log(`  \x1b[31m[FAIL]\x1b[0m ${s}`); process.exit(1); };

if (!FILE) die('укажи путь к файлу: node scripts/upload-payload.mjs <путь-к-dll> [адрес-сервера]');
if (!existsSync(FILE)) die(`файла нет: ${FILE}`);

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { code: res.status, body: parsed };
}

console.log(`\nАдрес API: ${BASE}`);
console.log(`Файл:      ${FILE} (${statSync(FILE).size} байт)`);

// --- Доступ -----------------------------------------------------------------

head('Доступ администратора');

const password = (() => {
  try { return readFileSync(new URL('../.admin-password', import.meta.url), 'utf8').trim(); }
  catch { return undefined; }
})();

const admin = await getAdminToken({ base: BASE, ...(password ? { password } : {}) });
if (!admin) die('не удалось войти администратором');
ok('токен получен');

// --- Продукт ----------------------------------------------------------------

head('Продукт и версия');

const products = await api('GET', '/products', undefined, admin);
if (products.code !== 200) die(`каталог продуктов не отдан: HTTP ${products.code} ${JSON.stringify(products.body)}`);

const list = Array.isArray(products.body) ? products.body : (products.body?.items ?? products.body?.data ?? []);
const product = list.find((p) => p.slug === SLUG);
if (!product) die(`продукт ${SLUG} не найден; есть: ${list.map((p) => p.slug).join(', ')}`);
ok(`продукт ${product.slug} — ${product.name}`);

// Версия payload’а живёт на СВОЕЙ оси, независимой от версий продукта: новую
// сборку можно выкатить, не выпуская новый exe. Берём следующую свободную,
// иначе сервер ответит 409 на занятый номер.
let version = process.env.LP_VERSION;
if (!version) {
  const builds = await api('GET', `/products/${product.id}/payloads`, undefined, admin);
  const arr = Array.isArray(builds.body) ? builds.body : (builds.body?.items ?? []);
  const nums = arr.map((b) => Number(String(b.version).split('.')[1] ?? 0)).filter((n) => !Number.isNaN(n));
  version = `1.${nums.length ? Math.max(...nums) + 1 : 0}.0`;
}
ok(`версия сборки ${version}`);

// --- Заливка ----------------------------------------------------------------

head('Заливка');

const draft = await api('POST', `/products/${product.id}/payloads`, { version }, admin);
if (draft.code !== 201) die(`черновик не создан: HTTP ${draft.code} ${JSON.stringify(draft.body)}`);
const buildId = draft.body?.id;
ok(`черновик создан: ${buildId}`);

const filename = FILE.split(/[\\/]/).pop();
const up = await api('POST', `/products/payloads/${buildId}/upload-url`,
  { filename, contentType: 'application/octet-stream' }, admin);
if (up.code !== 200) die(`ссылка на заливку не выдана: HTTP ${up.code} ${JSON.stringify(up.body)}`);

const url = up.body?.url ?? up.body?.uploadUrl;
const objectKey = up.body?.objectKey ?? up.body?.key;
if (!url || !objectKey) die(`в ответе нет ссылки или ключа объекта: ${JSON.stringify(up.body)}`);
note(`объект: ${objectKey}`);

// Байты идут В ХРАНИЛИЩЕ НАПРЯМУЮ, минуя API: так тело не проходит через
// процесс Node и не занимает его память — на сервере с двумя гигабайтами
// это существенно.
const bytes = readFileSync(FILE);
const put = await fetch(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: bytes,
});
if (!put.ok) die(`заливка в хранилище не удалась: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
ok(`${bytes.length} байт залито`);

const conf = await api('POST', `/products/payloads/${buildId}/confirm-upload`, { objectKey }, admin);
if (conf.code !== 200) die(`подтверждение не прошло: HTTP ${conf.code} ${JSON.stringify(conf.body)}`);
ok('сервер прочитал объект и посчитал эталон');
note(`sha256: ${conf.body?.sha256 ?? conf.body?.hash ?? '—'}`);
note(`размер: ${conf.body?.sizeBytes ?? conf.body?.size ?? '—'}`);

// --- Публикация -------------------------------------------------------------

head('Публикация');

const pub = await api('POST', `/products/payloads/${buildId}/publish`, undefined, admin);
if (pub.code !== 200) die(`публикация не прошла: HTTP ${pub.code} ${JSON.stringify(pub.body)}`);
ok('сборка опубликована — с этого момента её выдаёт загрузчик');

const after = await api('GET', `/products/${product.id}/payloads`, undefined, admin);
const rows = Array.isArray(after.body) ? after.body : (after.body?.items ?? []);
for (const b of rows) {
  note(`${b.version}  ${b.status ?? (b.publishedAt ? 'PUBLISHED' : 'DRAFT')}  ${b.sizeBytes ?? ''}`);
}

console.log('');
console.log('\x1b[32mPAYLOAD НА СЕРВЕРЕ\x1b[0m');
