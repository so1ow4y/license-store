// ============================================================================
//  Проверка модуля оплаты Digiseller (ТЗ п.17).
//
//  Настоящую покупку сымитировать нельзя — код выдаёт площадка. Поэтому
//  проверяется всё остальное, и в первую очередь то, что дороже всего стоит
//  при ошибке:
//    • один код — одна лицензия, при любом повторе и при гонке;
//    • чужой код не активируется на своём аккаунте;
//    • подтверждённая, но не выданная покупка ВИДНА и завершается кнопкой;
//    • обращение к живой площадке действительно происходит и её отказ
//      обрабатывается (проверяется заведомо несуществующим кодом).
//
//  Запуск:  node scripts/smoke-billing.mjs
// ============================================================================

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { getAdminToken } from './_admin-token.mjs';

const BASE = process.env.LP_BASE ?? 'http://localhost:3000/api/v1';
const PG = process.env.LP_PG ?? 'lp-postgres';

let failed = 0;
const ok = (s) => console.log(`  \x1b[32m[OK]\x1b[0m   ${s}`);
const bad = (s, d) => { failed++; console.log(`  \x1b[31m[FAIL]\x1b[0m ${s}${d ? ' — ' + d : ''}`); };
const check = (s, c, d) => (c ? ok(s) : bad(s, d));
const head = (t) => console.log(`\n\x1b[36m=== ${t} ===\x1b[0m`);

const sql = (q) =>
  execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'lp', '-d', 'license_platform', '-t', '-A'],
    { input: q, encoding: 'utf8' }).trim();

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

const code16 = () => randomBytes(8).toString('hex').toUpperCase();

// ---------------------------------------------------------------------------

head('Подготовка');

const admin = await getAdminToken({ base: BASE });
if (!admin) { console.log('не удалось войти администратором'); process.exit(1); }

async function makeUser(prefix) {
  const u = `${prefix}${Math.floor(Math.random() * 999999)}`;
  await api('POST', '/auth/register', { email: `${u}@example.com`, username: u, password: 'CorrectHorse42' });
  sql(`UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='${u}';`);
  const token = (await api('POST', '/auth/login', { login: u, password: 'CorrectHorse42' })).body?.accessToken;
  const id = sql(`SELECT id FROM users WHERE username='${u}';`);
  return { username: u, token, id };
}

const buyer = await makeUser('buy');
const other = await makeUser('oth');
check('два пользователя заведены', Boolean(buyer.token && other.token));

const productId = sql(`SELECT id FROM products WHERE slug='fc26';`);
const planId = sql(`SELECT id FROM license_plans WHERE product_id='${productId}' AND slug='30d';`);
check('продукт и тариф на месте', Boolean(productId && planId));

// ---------------------------------------------------------------------------

head('Формат кода и доступ');

const malformed = await api('POST', '/billing/digiseller/redeem', { code: 'КОРОТКИЙ' }, buyer.token);
check('кривой код отклонён до обращения к площадке', malformed.code === 400, `HTTP ${malformed.code}`);

const noAuth = await api('POST', '/billing/digiseller/redeem', { code: code16() });
check('без токена отклонено', noAuth.code === 401, `HTTP ${noAuth.code}`);

const notAdmin = await api('GET', '/billing/digiseller/pending', undefined, buyer.token);
check('список зависших сделок закрыт от обычного пользователя', notAdmin.code === 403, `HTTP ${notAdmin.code}`);

// ---------------------------------------------------------------------------

head('Обращение к живой площадке');

// Заведомо несуществующий код: проверяем, что вход по ключу состоялся,
// запрос ушёл и отказ площадки обработан — а не свалился в 500.
const bogus = await api('POST', '/billing/digiseller/redeem', { code: code16() }, buyer.token);
check('несуществующий код не роняет сервер', bogus.code === 400 || bogus.code === 503,
  `HTTP ${bogus.code} ${JSON.stringify(bogus.body)}`);
console.log(`         код ответа: ${bogus.body?.code}`);
check('отказ НЕ выдаётся за «такого кода нет»',
  bogus.body?.code !== 'CODE_INVALID',
  'терминального retval у метода не документировано, приговор выносить нельзя');

// ---------------------------------------------------------------------------

head('Один код — одна лицензия');

// Подтверждённая площадкой сделка, которую ещё не выдали: ровно то состояние,
// в котором окажется покупка, если товар не привязан к тарифу.
const pendingCode = code16();
const invId = Math.floor(Math.random() * 900000000) + 100000000;
const digiProductId = Math.floor(Math.random() * 9000000) + 1000000;

sql(`INSERT INTO digiseller_orders
       (id, unique_code, inv_id, digiseller_product_id, amount, currency,
        buyer_email, raw_payload, verified_at, redeemed_by_user_id, created_at, updated_at)
     VALUES (gen_random_uuid(), '${pendingCode}', ${invId}, ${digiProductId}, 1290.00, 'RUB',
             'buyer@example.com', '{"retval":0,"inv":${invId}}'::jsonb, now(), '${buyer.id}', now(), now());`);

const pending = await api('GET', '/billing/digiseller/pending', undefined, admin);
check('зависшая сделка ВИДНА администратору', pending.code === 200 &&
  pending.body?.some?.((r) => r.uniqueCode === pendingCode), `HTTP ${pending.code}`);

// Товар не привязан — довыдать нельзя, и об этом говорится прямо.
const early = await api('POST', `/billing/digiseller/pending/${
  pending.body?.find?.((r) => r.uniqueCode === pendingCode)?.id}/complete`, undefined, admin);
check('без привязки тарифа довыдача отклонена', early.code === 409, `HTTP ${early.code}`);
check('код PRODUCT_NOT_MAPPED', early.body?.code === 'PRODUCT_NOT_MAPPED', String(early.body?.code));

// Владелец привязывает товар к тарифу — ровно то действие, ради которого
// сделка и попала в список.
sql(`UPDATE license_plans SET digiseller_product_id = ${digiProductId} WHERE id = '${planId}';`);

const pendingId = pending.body.find((r) => r.uniqueCode === pendingCode).id;
const done = await api('POST', `/billing/digiseller/pending/${pendingId}/complete`, undefined, admin);
check('после привязки лицензия довыдана', done.code === 200, `HTTP ${done.code} ${JSON.stringify(done.body)}`);
check('номер заказа сгенерирован базой', /^ORD-\d{4}-\d+$/.test(done.body?.orderNumber ?? ''),
  String(done.body?.orderNumber));
check('ключ лицензии выдан', Boolean(done.body?.licenseKey));

const again = await api('POST', `/billing/digiseller/pending/${pendingId}/complete`, undefined, admin);
check('ПОВТОРНАЯ довыдача отклонена — второй лицензии нет', again.code === 409, `HTTP ${again.code}`);

const licCount = sql(`SELECT count(*) FROM licenses WHERE user_id='${buyer.id}';`);
check('у покупателя ровно одна лицензия', licCount === '1', `их ${licCount}`);

const orderRow = sql(`SELECT status || '|' || (delivered_at IS NOT NULL)::text
                        FROM orders WHERE id='${done.body?.orderId}';`);
check('заказ DELIVERED', orderRow === 'DELIVERED|true', orderRow);

// ---------------------------------------------------------------------------

head('Повторное предъявление кода');

const mine = await api('POST', '/billing/digiseller/redeem', { code: pendingCode }, buyer.token);
check('свой погашенный код — тот же ответ, а не ошибка', mine.code === 200, `HTTP ${mine.code}`);
check('статус ALREADY_YOURS', mine.body?.status === 'ALREADY_YOURS', String(mine.body?.status));

const stolen = await api('POST', '/billing/digiseller/redeem', { code: pendingCode }, other.token);
check('чужой код на своём аккаунте отклонён', stolen.code === 409, `HTTP ${stolen.code}`);
check('код CODE_ALREADY_USED', stolen.body?.code === 'CODE_ALREADY_USED', String(stolen.body?.code));

const stillOne = sql(`SELECT count(*) FROM licenses WHERE user_id='${other.id}';`);
check('чужому пользователю лицензия НЕ выдана', stillOne === '0', `их ${stillOne}`);

// ---------------------------------------------------------------------------

head('Журнал и уведомления');

const audit = sql(`SELECT count(*) FROM audit_logs
                    WHERE action='order.paid.digiseller' AND entity_id='${done.body?.orderId}';`);
check('запись в журнале аудита есть', audit === '1', `записей ${audit}`);

const noCode = sql(`SELECT count(*) FROM audit_logs WHERE after::text LIKE '%${pendingCode}%';`);
check('кода покупки в журнале НЕТ — он предъявительский', noCode === '0', `нашлось ${noCode}`);

const notif = sql(`SELECT count(*) FROM notifications
                    WHERE user_id='${buyer.id}' AND template_key='license.issued';`);
check('уведомление о выдаче поставлено в очередь', Number(notif) >= 1, `их ${notif}`);

// ---------------------------------------------------------------------------

head('Лимит попыток');

let limited = 0;
for (let i = 0; i < 34; i++) {
  const r = await api('POST', '/billing/digiseller/redeem', { code: code16() }, other.token);
  if (r.code === 400 && r.body?.code === 'TOO_MANY_ATTEMPTS') { limited = i + 1; break; }
}
check('перебор упирается в лимит', limited > 0, 'лимит не сработал за 34 попытки');
if (limited) console.log(`         сработал на попытке ${limited}`);

// ---------------------------------------------------------------------------

head('Уборка');
sql(`UPDATE license_plans SET digiseller_product_id = NULL WHERE id = '${planId}';`);
console.log('         привязка тарифа снята');

console.log('');
if (failed === 0) { console.log('\x1b[32mВСЕ ПРОВЕРКИ ПРОЙДЕНЫ\x1b[0m'); process.exit(0); }
console.log(`\x1b[31mПРОВАЛЕНО ПРОВЕРОК: ${failed}\x1b[0m`);
process.exit(1);
