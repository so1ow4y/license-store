// ============================================================================
//  Проверка связи с Digiseller: вход по ключу и список прав токена.
//
//  Запускается ДО написания модуля оплаты и после каждой смены ключа.
//  Отвечает на три вопроса, каждый из которых иначе выяснился бы на первой
//  реальной покупке:
//    1. Подходят ли seller_id и api_key вообще.
//    2. Какие права реально выданы токену (галочки в кабинете продавца).
//    3. Хватает ли их для нашего сценария.
//
//  Секреты не печатаются: ни ключ, ни токен, ни подпись.
//
//  Запуск:  node scripts/digiseller-probe.mjs
// ============================================================================

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const cfg = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
};

const SELLER_ID = cfg('DIGISELLER_SELLER_ID');
const API_KEY = cfg('DIGISELLER_API_KEY');
const BASE = cfg('DIGISELLER_API_BASE') || 'https://api.digiseller.com';

if (!SELLER_ID || !API_KEY) {
  console.log('DIGISELLER_SELLER_ID или DIGISELLER_API_KEY не заданы в .env');
  process.exit(2);
}

const ok = (s) => console.log(`  \x1b[32m[OK]\x1b[0m   ${s}`);
const bad = (s) => console.log(`  \x1b[31m[FAIL]\x1b[0m ${s}`);
const info = (s) => console.log(`         ${s}`);

// --- Вход --------------------------------------------------------------------

console.log(`\n\x1b[36m=== Вход (${BASE}/api/apilogin) ===\x1b[0m`);

// timestamp обязан быть НАСТОЯЩИМ временем и уникальным в каждом запросе:
// повтор значения площадка отвергает с retval -4.
const timestamp = Math.floor(Date.now() / 1000);
const sign = createHash('sha256').update(API_KEY + timestamp, 'utf8').digest('hex');

let login;
try {
  const res = await fetch(`${BASE}/api/apilogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ seller_id: Number(SELLER_ID), timestamp, sign }),
  });
  const text = await res.text();
  info(`HTTP ${res.status}`);
  try {
    login = JSON.parse(text);
  } catch {
    // DDoS-Guard отдаёт HTML вместо JSON — это штатный режим отказа, и
    // распознать его надо по телу, а не по статусу.
    bad('ответ не JSON — вероятно, страница защиты вместо API');
    info(text.slice(0, 200).replace(/\s+/g, ' '));
    process.exit(1);
  }
} catch (e) {
  bad(`сеть: ${e.message}`);
  process.exit(1);
}

// Бизнес-ошибка приходит с HTTP 200 — смотреть надо retval.
if (login.retval !== 0) {
  bad(`вход отклонён: retval=${login.retval}`);
  info(`${login.desc ?? ''} ${login.endesc ? '/ ' + login.endesc : ''}`.trim());
  const hint = {
    '-1': 'неверный seller_id или подпись — сверь ID продавца и API-ключ',
    '-2': 'аккаунт временно заблокирован площадкой',
    '-3': 'ошибка на стороне площадки, повтори позже',
    '-4': 'timestamp не уникален — повтори запуск',
  }[String(login.retval)];
  if (hint) info(`→ ${hint}`);
  process.exit(1);
}

ok('вход выполнен, токен получен');
info(`seller_id: ${login.seller_id}`);
if (login.valid_thru) {
  const left = Math.round((new Date(login.valid_thru).getTime() - Date.now()) / 60000);
  info(`токен действует до ${login.valid_thru} (≈${left} мин)`);
  // Кэшировать надо по valid_thru, а не по константе в конфиге: срок задаёт
  // площадка и может его поменять, не спросив нас.
  if (left < 100 || left > 140) info(`⚠ фактический срок ${left} мин расходится с ожидаемыми ~120`);
}

const token = login.token;

// --- Права -------------------------------------------------------------------

console.log(`\n\x1b[36m=== Права токена (/api/token/perms) ===\x1b[0m`);

let perms = null;
try {
  const res = await fetch(`${BASE}/api/token/perms?token=${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    bad(`HTTP ${res.status} — у ключа нет права «Токены API → Список разрешений»`);
    info('без него сервер не сможет сказать на старте, чего ему не хватает');
  } else {
    perms = JSON.parse(text);
    if (Array.isArray(perms) && perms.length === 0) {
      bad('пустой список — по документации это означает отсутствие доступа');
    } else {
      ok(`выдано разрешений: ${perms.length}`);
      perms.forEach((p) => info(`• ${typeof p === 'string' ? p : JSON.stringify(p)}`));
    }
  }
} catch (e) {
  bad(`не удалось прочитать права: ${e.message}`);
}

// --- Что нужно нам -----------------------------------------------------------

console.log(`\n\x1b[36m=== Достаточно ли для выдачи лицензий ===\x1b[0m`);

const NEEDED = [
  { perm: 'view_invoice', why: 'проверка кода покупки и статуса сделки — БЕЗ НЕЁ НЕ РАБОТАЕТ НИЧЕГО', hard: true },
  { perm: 'sales_statistics_view', why: 'дешёвый поллинг возвратов пачкой; без неё опрашиваем по одному счёту', hard: false },
  { perm: 'content_change', why: 'подтверждение доставки через PUT unique-code', hard: false },
];

const flat = Array.isArray(perms) ? perms.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))) : null;

if (!flat) {
  info('список прав получить не удалось — судить не по чему');
} else {
  let missingHard = 0;
  for (const n of NEEDED) {
    const has = flat.some((p) => p.includes(n.perm));
    if (has) ok(`${n.perm} — ${n.why}`);
    else if (n.hard) { bad(`${n.perm} ОТСУТСТВУЕТ — ${n.why}`); missingHard++; }
    else info(`○ ${n.perm} не выдано — ${n.why}`);
  }
  console.log('');
  if (missingHard === 0) console.log('\x1b[32mКлюча достаточно, чтобы выдавать лицензии\x1b[0m');
  else console.log('\x1b[31mНе хватает обязательного права — выдача работать не будет\x1b[0m');
}

// --- Товары ------------------------------------------------------------------

console.log(`\n\x1b[36m=== Товары продавца ===\x1b[0m`);

// Форма запроса в документации описана неоднозначно, поэтому пробуем
// известные варианты и печатаем, какой сработал: угадывать вслепую в
// боевом коде потом дороже, чем выяснить один раз здесь.
const ATTEMPTS = [
  {
    name: 'POST /api/products/list',
    run: () => fetch(`${BASE}/api/products/list?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        id_seller: Number(SELLER_ID), order_col: 'name', order_dir: 'asc',
        rows: 100, page: 1, currency: 'RUB', lang: 'ru-RU', show_hidden: 1,
      }),
    }),
  },
  {
    name: 'GET /api/seller-goods/v2',
    run: () => fetch(`${BASE}/api/seller-goods/v2?id_seller=${encodeURIComponent(SELLER_ID)}` +
      `&token=${encodeURIComponent(token)}&rows=100&page=1&currency=RUB&lang=ru-RU` +
      `&order_col=name&order_dir=asc&show_hidden=1`, { headers: { Accept: 'application/json' } }),
  },
];

let listed = false;
for (const a of ATTEMPTS) {
  if (listed) break;
  try {
    const res = await a.run();
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { info(`${a.name}: HTTP ${res.status}, ответ не JSON`); continue; }

    const rows = body?.product?.rows ?? body?.rows ?? body?.products ?? [];
    if (Array.isArray(rows) && rows.length) {
      ok(`${a.name} → товаров: ${rows.length}`);
      info('эти id вписываются в license_plans.digiseller_product_id:');
      rows.forEach((r) => info(
        `  ${r.id_goods ?? r.id ?? '?'}  —  ${r.name_goods ?? r.name ?? '?'}  —  ${r.price_rub ?? r.price ?? '?'}`,
      ));
      listed = true;
    } else {
      info(`${a.name}: HTTP ${res.status} — ${JSON.stringify(body).slice(0, 220)}`);
    }
  } catch (e) {
    info(`${a.name}: ${e.message}`);
  }
}

if (!listed) {
  info('список получить не удалось — id товаров придётся взять из кабинета продавца вручную');
}

console.log('');
