// ============================================================================
//  Сквозная проверка POST /api/v1/launcher/payload.
//
//  Почему Node, а не PowerShell как остальные смоук-скрипты: здесь надо
//  положить в хранилище настоящий двоичный файл, посчитать HKDF-SHA256,
//  расшифровать AES-256-GCM и сравнить байты. В PowerShell 5.1 всё это
//  делается через .NET-интеропы и ломается на первом же байте 0x00.
//
//  Провизионирование (пользователь, лицензия) идёт через psql в контейнере,
//  ровно как в smoke-launcher.ps1.
//
//  Запуск:  node scripts/smoke-payload.mjs
// ============================================================================

import { createHash, createHmac, randomBytes, hkdfSync, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAdminToken } from './_admin-token.mjs';

const BASE = process.env.LP_BASE ?? 'http://localhost:3000/api/v1';
const PG = process.env.LP_PG ?? 'lp-postgres';
const DLL = process.env.LP_DLL ??
  'C:\\Users\\user\\work\\chipa\\productionFC26\\out\\Release\\x64\\fc26mod_ship.dll';

const INFO = 'lp/payload/v1';
const PRODUCT = 'fc26';

let failed = 0;
const ok = (name) => console.log(`  \x1b[32m[OK]\x1b[0m   ${name}`);
const bad = (name, detail) => { failed++; console.log(`  \x1b[31m[FAIL]\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const head = (t) => console.log(`\n\x1b[36m=== ${t} ===\x1b[0m`);

function sql(query) {
  return execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'lp', '-d', 'license_platform', '-t', '-A'],
    { input: query, encoding: 'utf8' }).trim();
}

async function plain(method, path, body, token) {
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

/** Подписанный запрос — ровно так, как его формирует загрузчик (ТЗ §3.1). */
async function signed(method, path, body, token, apiKey, secret, opts = {}) {
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');

  // Query в подпись не входит: подписывается только путь (ТЗ §3.1).
  const signPath = '/api/v1' + path.split('?')[0];
  const bodyHash = createHash('sha256').update(bodyText, 'utf8').digest('hex');
  const canonical = [method.toUpperCase(), signPath, ts, nonce, bodyHash].join('\n');
  const signature = opts.signature ?? createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Timestamp': ts,
    'X-Nonce': nonce,
    'X-Signature': signature,
    'X-Client-Version': '1.0.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: bodyText === '' ? undefined : bodyText,
  });

  const buf = Buffer.from(await res.arrayBuffer());
  const ctype = res.headers.get('content-type') ?? '';
  let parsed = null;
  if (ctype.includes('json')) { try { parsed = JSON.parse(buf.toString('utf8')); } catch { /* пусто */ } }

  return { code: res.status, body: parsed, bytes: buf, headers: res.headers, nonce, signature };
}

// ---------------------------------------------------------------------------

const dllBytes = readFileSync(DLL);
const dllSha = createHash('sha256').update(dllBytes).digest('hex');
console.log(`payload: ${DLL}`);
console.log(`         ${dllBytes.length} байт, sha256 ${dllSha}`);

head('Подготовка');

const adminToken = await getAdminToken({ base: BASE });
if (!adminToken) { console.log('не удалось войти администратором'); process.exit(1); }

const keyRes = await plain('POST', '/auth/api-keys', { name: `payload smoke ${Date.now()}` }, adminToken);
check('ключ сборки выпущен', keyRes.code === 201, `HTTP ${keyRes.code}`);
const apiKey = keyRes.body.prefix;
const secret = keyRes.body.signingSecret;

const uname = `pl${Math.floor(Math.random() * 999999)}`;
await plain('POST', '/auth/register', { email: `${uname}@example.com`, username: uname, password: 'CorrectHorse42' });
sql(`UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='${uname}';`);
const userToken = (await plain('POST', '/auth/login', { login: uname, password: 'CorrectHorse42' })).body?.accessToken;
const userId = sql(`SELECT id FROM users WHERE username='${uname}';`);
check('пользователь заведён', Boolean(userToken && userId));

const productId = sql(`SELECT id FROM products WHERE slug='${PRODUCT}';`);
const planId = sql(`SELECT id FROM license_plans WHERE product_id='${productId}' AND slug='30d';`);
const lic = (await plain('POST', '/licenses', { productId, planId, userId }, adminToken)).body;
check('лицензия выдана', Boolean(lic?.id));

// ---------------------------------------------------------------------------

head('Заливка payload через админский путь');

const version = `9.${Math.floor(Math.random() * 900) + 1}.0`;
const draft = await plain('POST', `/products/${productId}/payloads`, { version }, adminToken);
check('черновик сборки создан', draft.code === 201, `HTTP ${draft.code} ${JSON.stringify(draft.body)}`);
const buildId = draft.body?.id;

const up = await plain('POST', `/products/payloads/${buildId}/upload-url`, { filename: 'fc26mod_ship.dll' }, adminToken);
check('ссылка на загрузку получена', up.code === 200, `HTTP ${up.code} ${JSON.stringify(up.body)}`);
check('бакет — payloads, не releases', up.body?.bucket === 'payloads', String(up.body?.bucket));

const putRes = await fetch(up.body.uploadUrl, {
  method: 'PUT', body: dllBytes, headers: { 'Content-Type': 'application/octet-stream' },
});
check('DLL положен в хранилище', putRes.ok, `HTTP ${putRes.status}`);

const confirm = await plain('POST', `/products/payloads/${buildId}/confirm-upload`, { objectKey: up.body.objectKey }, adminToken);
check('загрузка подтверждена', confirm.code === 200, `HTTP ${confirm.code} ${JSON.stringify(confirm.body)}`);
check('СЕРВЕР посчитал sha256 сам и он совпал с настоящим', confirm.body?.sha256 === dllSha,
  `сервер: ${confirm.body?.sha256}`);
check('размер совпал', Number(confirm.body?.size) === dllBytes.length, String(confirm.body?.size));

const pub = await plain('POST', `/products/payloads/${buildId}/publish`, undefined, adminToken);
check('сборка опубликована', pub.code === 200, `HTTP ${pub.code} ${JSON.stringify(pub.body)}`);

const reupload = await plain('POST', `/products/payloads/${buildId}/upload-url`, { filename: 'evil.dll' }, adminToken);
check('опубликованную сборку НЕЛЬЗЯ перезалить', reupload.code === 409,
  `HTTP ${reupload.code} — эталон подменяем, а им клиент проверяет целостность`);

// ---------------------------------------------------------------------------

head('Отказы до привязки устройства');

const hwid = `WD-PAYLOAD-${Math.floor(Math.random() * 999999)}`;
const early = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') },
  userToken, apiKey, secret);
check('payload до license/check отклонён', early.code === 403, `HTTP ${early.code}`);
check('код НЕ HWID_MISMATCH (иначе клиент сотрёт секреты зря)',
  early.body?.code !== 'HWID_MISMATCH', String(early.body?.code));
console.log(`         код отказа: ${early.body?.code}`);

const noSig = await plain('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') }, userToken);
check('без подписи отклонено', noSig.code === 403, `HTTP ${noSig.code}`);
check('код SIGNATURE_MISSING', noSig.body?.code === 'SIGNATURE_MISSING', String(noSig.body?.code));

// ---------------------------------------------------------------------------

head('Привязка через license/check');

const lcheck = await signed('POST', '/launcher/license/check',
  { productSlug: PRODUCT, hwid, clientVersion: '1.0.0' }, userToken, apiKey, secret);
check('проверка лицензии прошла', lcheck.code === 200, `HTTP ${lcheck.code} ${JSON.stringify(lcheck.body)}`);

const licRow = sql(`SELECT status || '|' || (current_device_id IS NOT NULL)::text FROM licenses WHERE id='${lic.id}';`);
check('лицензия ACTIVE и привязана', licRow === 'ACTIVE|true', licRow);

// ---------------------------------------------------------------------------

head('Выдача payload');

const sessionKey = randomBytes(32).toString('hex');
const got = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey }, userToken, apiKey, secret);

check('payload отдан', got.code === 200, `HTTP ${got.code} ${JSON.stringify(got.body)}`);
if (got.code !== 200) { console.log('\nдальше без payload проверять нечего'); process.exit(1); }

const h = (n) => got.headers.get(n);
check('Content-Type — octet-stream', (h('content-type') ?? '').includes('application/octet-stream'), String(h('content-type')));
check('Cache-Control: no-store', (h('cache-control') ?? '').includes('no-store'), String(h('cache-control')));
check('X-Payload-Sha256 совпал с настоящим DLL', h('x-payload-sha256') === dllSha, String(h('x-payload-sha256')));
check('X-Payload-Size совпал', Number(h('x-payload-size')) === dllBytes.length, String(h('x-payload-size')));
check('X-Payload-Nonce — 24 hex', /^[0-9a-f]{24}$/.test(h('x-payload-nonce') ?? ''), String(h('x-payload-nonce')));
check('X-Payload-Tag — 32 hex', /^[0-9a-f]{32}$/.test(h('x-payload-tag') ?? ''), String(h('x-payload-tag')));
check('X-Payload-Version отдан', Boolean(h('x-payload-version')), String(h('x-payload-version')));
check('шифротекст той же длины, что открытый текст (GCM — потоковый)',
  got.bytes.length === dllBytes.length, `${got.bytes.length} против ${dllBytes.length}`);
check('шифротекст НЕ равен открытому тексту', !got.bytes.equals(dllBytes));

// --- расшифровка ровно так, как это будет делать загрузчик -----------------

const iv = Buffer.from(h('x-payload-nonce'), 'hex');
const tag = Buffer.from(h('x-payload-tag'), 'hex');
const key = Buffer.from(hkdfSync('sha256', Buffer.from(sessionKey, 'hex'), iv, Buffer.from(INFO, 'ascii'), 32));

const aad = Buffer.from([INFO, PRODUCT, h('x-payload-sha256'), h('x-payload-size'), h('x-payload-version')].join('\n'), 'ascii');

let plain_ = null;
try {
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aad);
  d.setAuthTag(tag);
  plain_ = Buffer.concat([d.update(got.bytes), d.final()]);
  ok('AES-256-GCM расшифровался, тег сошёлся');
} catch (e) {
  bad('AES-256-GCM расшифровка', e.message);
}

if (plain_) {
  check('расшифрованные байты СОВПАЛИ с исходным DLL', plain_.equals(dllBytes),
    `${plain_.length} байт против ${dllBytes.length}`);
  check('sha256 расшифрованного совпал с X-Payload-Sha256',
    createHash('sha256').update(plain_).digest('hex') === h('x-payload-sha256'));
  check('первые два байта — MZ, то есть это действительно PE',
    plain_[0] === 0x4d && plain_[1] === 0x5a);
}

// --- AAD действительно аутентифицирует заголовки ---------------------------

try {
  const badAad = Buffer.from([INFO, PRODUCT, 'f'.repeat(64), h('x-payload-size'), h('x-payload-version')].join('\n'), 'ascii');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(badAad);
  d.setAuthTag(tag);
  Buffer.concat([d.update(got.bytes), d.final()]);
  bad('подмена sha256 в AAD должна ломать тег', 'расшифровалось с чужим AAD');
} catch {
  ok('подмена X-Payload-Sha256 ломает GCM-тег — заголовок реально под защитой');
}

// ---------------------------------------------------------------------------

head('Повторы и чужие машины');

const reuse = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey }, userToken, apiKey, secret);
check('тот же sessionKey второй раз отвергнут', reuse.code >= 400,
  `HTTP ${reuse.code} — статический sessionKey в сборке остался бы незамеченным`);
console.log(`         код отказа: ${reuse.body?.code}`);

const fresh = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') },
  userToken, apiKey, secret);
check('НОВЫЙ sessionKey работает', fresh.code === 200, `HTTP ${fresh.code} ${JSON.stringify(fresh.body)}`);
check('второй ответ зашифрован ДРУГИМ ключом (байты не совпадают)',
  fresh.code !== 200 || !fresh.bytes.equals(got.bytes));

const otherDisk = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid: 'SEAGATE-SOMEONE-ELSE', sessionKey: randomBytes(32).toString('hex') },
  userToken, apiKey, secret);
check('чужой диск отклонён', otherDisk.code === 403, `HTTP ${otherDisk.code}`);
check('код HWID_MISMATCH', otherDisk.body?.code === 'HWID_MISMATCH', String(otherDisk.body?.code));

const replay = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') },
  userToken, apiKey, secret, { nonce: got.nonce, signature: got.signature });
check('повтор перехваченного запроса отклонён', replay.code === 403, `HTTP ${replay.code}`);

// ---------------------------------------------------------------------------

head('Ограничение ключа сборки по scope');

// Ключ с ЯВНЫМ набором scope, в котором payload'а нет. Проверяем не
// переходное послабление («пустой scopes = все»), а сам запрет: до этой
// задачи поле scopes заполнялось и не читалось ни разу.
const narrow = await plain('POST', '/auth/api-keys',
  { name: `narrow ${Date.now()}`, scopes: ['launcher:check'] }, adminToken);
check('ключ с ограниченным scope выпущен', narrow.code === 201, `HTTP ${narrow.code}`);

if (narrow.code === 201) {
  const denied = await signed('POST', '/launcher/payload',
    { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') },
    userToken, narrow.body.prefix, narrow.body.signingSecret);
  check('ключ без launcher:payload не получает payload', denied.code === 403, `HTTP ${denied.code}`);
  check('код API_KEY_SCOPE', denied.body?.code === 'API_KEY_SCOPE', String(denied.body?.code));

  const allowed = await signed('POST', '/launcher/license/check',
    { productSlug: PRODUCT, hwid, clientVersion: '1.0.0' },
    userToken, narrow.body.prefix, narrow.body.signingSecret);
  check('тот же ключ на license/check работает — запрет точечный, а не общий',
    allowed.code === 200, `HTTP ${allowed.code}`);

  const narrowId = sql(`SELECT id FROM api_keys WHERE prefix='${narrow.body.prefix}';`);
  if (narrowId) await plain('DELETE', `/auth/api-keys/${narrowId}`, undefined, adminToken);
}

// ---------------------------------------------------------------------------

head('Отказы по состоянию лицензии');

sql(`UPDATE licenses SET status='BLOCKED', blocked_at=now() WHERE id='${lic.id}';`);
const blocked = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') },
  userToken, apiKey, secret);
check('заблокированная лицензия — payload не выдан', blocked.code === 403, `HTTP ${blocked.code}`);
console.log(`         код отказа: ${blocked.body?.code}`);

sql(`UPDATE licenses SET status='ACTIVE', expires_at=now() - interval '1 day' WHERE id='${lic.id}';`);
const expired = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') },
  userToken, apiKey, secret);
check('истёкшая лицензия — payload не выдан', expired.code === 403, `HTTP ${expired.code}`);
console.log(`         код отказа: ${expired.body?.code}`);

sql(`UPDATE licenses SET status='ACTIVE', expires_at=now() + interval '30 days' WHERE id='${lic.id}';`);

// --- КРИТИЧНЫЙ Д1: PENDING с проставленной привязкой -----------------------

sql(`UPDATE licenses SET status='PENDING', expires_at=NULL, activated_at=NULL WHERE id='${lic.id}';`);
const pending = await signed('POST', '/launcher/payload',
  { productSlug: PRODUCT, hwid, sessionKey: randomBytes(32).toString('hex') },
  userToken, apiKey, secret);
check('PENDING с привязкой НЕ даёт бессрочную выдачу (Д1)', pending.code === 403,
  `HTTP ${pending.code} — срок бы не начался никогда, крон её не трогает`);
check('код НЕ HWID_MISMATCH', pending.body?.code !== 'HWID_MISMATCH', String(pending.body?.code));
console.log(`         код отказа: ${pending.body?.code}`);

const stillPending = sql(`SELECT status || '|' || COALESCE(expires_at::text,'NULL') FROM licenses WHERE id='${lic.id}';`);
check('payload НЕ активировал лицензию (verify-only)', stillPending.startsWith('PENDING|NULL'), stillPending);

sql(`UPDATE licenses SET status='ACTIVE', expires_at=now() + interval '30 days', activated_at=now() WHERE id='${lic.id}';`);

// ---------------------------------------------------------------------------

head('Журнал выдач');

const issues = sql(`SELECT result || ' x' || count(*) FROM payload_issues WHERE user_id='${userId}' GROUP BY result ORDER BY 1;`);
console.log(issues ? issues.split('\n').map((l) => '         ' + l).join('\n') : '         (пусто)');
check('выдачи записаны', /ISSUED/.test(issues), issues);
check('отказы тоже записаны', /DENIED/.test(issues), issues);

const rawHwid = sql(`SELECT count(*) FROM payload_issues WHERE hwid_hash = '${hwid}';`);
check('сырой Disk ID в журнал НЕ попал', rawHwid === '0', `нашлось строк: ${rawHwid}`);

const hashLen = sql(`SELECT DISTINCT length(trim(hwid_hash)) FROM payload_issues WHERE hwid_hash IS NOT NULL;`);
check('в журнале лежит хеш длиной 64', hashLen === '64', hashLen);

// ---------------------------------------------------------------------------

head('Уборка');

const keyId = sql(`SELECT id FROM api_keys WHERE prefix='${apiKey}';`);
if (keyId) await plain('DELETE', `/auth/api-keys/${keyId}`, undefined, adminToken);
await plain('POST', `/products/payloads/${buildId}/unpublish`, undefined, adminToken);
console.log('         ключ сборки отозван, сборка снята с публикации');

console.log('');
if (failed === 0) {
  console.log('\x1b[32mВСЕ ПРОВЕРКИ ПРОЙДЕНЫ\x1b[0m');
  process.exit(0);
}
console.log(`\x1b[31mПРОВАЛЕНО ПРОВЕРОК: ${failed}\x1b[0m`);
process.exit(1);
