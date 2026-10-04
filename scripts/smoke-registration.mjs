// ============================================================================
//  Сквозная проверка регистрации: от пустого места до рабочего входа.
//
//  ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ. Фронтенда нет, а ссылка из письма ведёт на его
//  маршрут — кликнуть по ней некуда, проверить регистрацию руками нельзя.
//  Скрипт делает ровно то, что сделал бы человек в браузере: регистрируется,
//  ЧИТАЕТ ПИСЬМО в mailpit, достаёт токен из ссылки и подтверждает почту
//  через API, после чего проверяет вход, жизнь сессии и сброс пароля.
//
//  Проверяется не только «получилось», но и то, что обязано НЕ получаться —
//  именно там прячутся дыры:
//    • вход до подтверждения почты отклоняется (403 EMAIL_NOT_VERIFIED);
//    • ссылка из письма ведёт на адрес развёртывания, а не на localhost:5173
//      — эта ошибка уже случалась: адрес живёт отдельной настройкой в БД,
//      и на боевом сервере письма звали пользователя на его же машину;
//    • одноразовые токены не срабатывают дважды;
//    • после выхода refresh-токен мёртв, а не «доживает свои 30 дней»;
//    • сброс пароля на чужой адрес отвечает ровно так же, как на свой,
//      иначе форма превращается в проверялку «а есть ли такой аккаунт».
//
//  Запуск:
//    node scripts/smoke-registration.mjs                 — локально
//    node scripts/smoke-registration.mjs 77.221.154.85   — на сервере
//
//  Переменные окружения (если нужно отойти от умолчаний):
//    LP_BASE     адрес API с /api/v1 на конце
//    LP_SSH      user@host для доступа к mailpit и psql на сервере
//    LP_MAILPIT  адрес mailpit при локальном запуске
//    LP_PG       имя контейнера с Postgres
// ============================================================================

import { execFileSync } from 'node:child_process';

// --- Куда стучаться ---------------------------------------------------------
//
// Позиционный аргумент — отступление от остальных смоуков, где адрес задаётся
// только через окружение. Здесь он оправдан: скрипт написан, чтобы его звали
// руками для проверки живого сервера, и «node ... 77.221.154.85» короче трёх
// переменных. Окружение при этом сильнее аргумента и всё ещё работает.

const HOST = (process.argv[2] ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const REMOTE = HOST !== '' && !/^(localhost|127\.0\.0\.1)$/.test(HOST);

const BASE = process.env.LP_BASE ?? (REMOTE ? `http://${HOST}/api/v1` : 'http://localhost:3000/api/v1');
const SSH = process.env.LP_SSH ?? (REMOTE ? `root@${HOST}` : '');
const MAILPIT = process.env.LP_MAILPIT ?? 'http://localhost:8025';
const PG = process.env.LP_PG ?? 'lp-postgres';

// Локально смоуки ходят прямо в API мимо nginx, и ограничения частоты нет.
// На сервере порт 3000 наружу не публикуется, идти можно только через nginx,
// а там на /auth/(login|register|password-reset) висит зона auth_zone:
// 10 запросов в минуту при всплеске 5 (docker/nginx/snippets/lp-locations.conf).
// Проверка делает около дюжины таких запросов и без пауз получила бы 429 —
// то есть скрипт ругался бы на собственную поспешность, а выглядело бы это
// как поломка сервера.
const THROTTLED = !/:3000(\/|$)/.test(BASE);

let failed = 0;
const ok = (s) => console.log(`  \x1b[32m[OK]\x1b[0m   ${s}`);
const bad = (s, d) => { failed++; console.log(`  \x1b[31m[FAIL]\x1b[0m ${s}${d ? ' — ' + d : ''}`); };
const check = (s, c, d) => (c ? ok(s) : bad(s, d));
const head = (t) => console.log(`\n\x1b[36m=== ${t} ===\x1b[0m`);
const note = (s) => console.log(`         ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Обращения к API --------------------------------------------------------

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { code: res.status, body: parsed };
}

// Обёртка для путей под auth_zone. Ведро отдаёт всплеск в 5 запросов, дальше
// один раз в 6 секунд. Пауза ставится ПЕРЕД запросом, начиная с пятого, а 429
// дополнительно переживается повтором: пауз может не хватить, если рядом с
// тобой сервер дёргает кто-то ещё.
let authCalls = 0;
async function auth(method, path, body, token) {
  authCalls += 1;
  if (THROTTLED && authCalls > 4) await sleep(6500);
  let r = await api(method, path, body, token);
  for (let i = 0; i < 3 && r.code === 429; i++) {
    note(`429 от ограничителя частоты, жду 8 с и повторяю (${path})`);
    await sleep(8000);
    r = await api(method, path, body, token);
  }
  return r;
}

// --- Почта и база -----------------------------------------------------------
//
// Mailpit наружу не открыт намеренно: в письмах ходят ссылки на подтверждение
// почты и сброс пароля, и публичный доступ к ящику отдал бы чужие аккаунты
// любому желающему. Поэтому на сервере к нему ходим внутрь по ssh.

function ssh(args) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', SSH, ...args], { encoding: 'utf8' });
}

async function mailpit(path) {
  if (!SSH) {
    const res = await fetch(`${MAILPIT}${path}`);
    return await res.json();
  }
  // Адрес в одинарных кавычках: он уезжает в удалённую оболочку, а '?' там
  // символ шаблона имени файла.
  const out = ssh(['docker', 'exec', 'lp-mailpit', 'wget', '-qO-', `'http://127.0.0.1:8025${path}'`]);
  return JSON.parse(out);
}

const PSQL = ['docker', 'exec', '-i', PG, 'psql', '-U', 'lp', '-d', 'license_platform', '-t', '-A'];
const sql = (q) =>
  (SSH
    ? execFileSync('ssh', ['-o', 'BatchMode=yes', SSH, ...PSQL], { input: q, encoding: 'utf8' })
    : execFileSync(PSQL[0], PSQL.slice(1), { input: q, encoding: 'utf8' })
  ).trim();

// Письмо приходит НЕ в момент запроса: NotificationService кладёт строку в
// таблицу notifications, а отдельный процессор разбирает очередь раз в пять
// секунд. Ждать приходится по-настоящему.
async function waitMail(query, subject) {
  for (let i = 0; i < 14; i++) {
    const r = await mailpit(`/api/v1/search?query=${encodeURIComponent(query)}`);
    const m = (r.messages ?? []).find((x) => x.Subject === subject);
    if (m) return m;
    await sleep(3000);
  }
  return null;
}

// Ссылка лежит в text/plain отдельной строкой; HTML-части у писем нет вовсе.
async function linkFrom(id, route) {
  const msg = await mailpit(`/api/v1/message/${id}`);
  const text = String(msg.Text ?? '');
  const m = text.match(new RegExp(`(https?://[^\\s]*?)${route}\\?token=([A-Za-z0-9_-]+)`));
  return m ? { base: m[1], token: m[2], url: m[0] } : null;
}

// ---------------------------------------------------------------------------

const U = `reg${Math.floor(Math.random() * 999999)}`;
const EMAIL = `${U}@example.com`;
const PASS = 'CorrectHorse42';
const PASS2 = 'CorrectHorse42new';

console.log(`\nАдрес API: ${BASE}`);
console.log(`Почта:     ${SSH ? `mailpit на ${SSH} (через ssh)` : MAILPIT}`);
if (THROTTLED) console.log('Запросы входа идут через nginx с ограничением частоты — проверка займёт около двух минут.');

// --- Регистрация ------------------------------------------------------------

head('Регистрация');

const reg = await auth('POST', '/auth/register', { username: U, email: EMAIL, password: PASS });
check('регистрация принята', reg.code === 201, `HTTP ${reg.code} ${JSON.stringify(reg.body)}`);
check('в ответе есть идентификатор пользователя', typeof reg.body?.userId === 'string', JSON.stringify(reg.body));
check('токены при регистрации НЕ выдаются', !reg.body?.accessToken && !reg.body?.refreshToken, JSON.stringify(reg.body));
note(`пользователь: ${U} / ${EMAIL}`);

if (reg.code !== 201) {
  console.log('\nдальше без зарегистрированного пользователя проверять нечего');
  process.exit(1);
}

const dup = await auth('POST', '/auth/register', { username: U, email: `dup${EMAIL}`, password: PASS });
check('повторная регистрация тем же логином отклонена', dup.code === 409, `HTTP ${dup.code}`);
check('код отказа ALREADY_EXISTS', dup.body?.code === 'ALREADY_EXISTS', String(dup.body?.code));

// Главная проверка раздела: незаконченная регистрация не должна давать доступ.
const early = await auth('POST', '/auth/login', { login: U, password: PASS });
check('вход ДО подтверждения почты отклонён', early.code === 403, `HTTP ${early.code}`);
check('код отказа EMAIL_NOT_VERIFIED', early.body?.code === 'EMAIL_NOT_VERIFIED', String(early.body?.code));

// --- Письмо и подтверждение -------------------------------------------------

head('Письмо и подтверждение почты');

const letter = await waitMail(U, 'Подтвердите адрес электронной почты');
check('письмо с подтверждением доставлено', letter !== null, 'за 42 секунды не пришло');

if (!letter) {
  console.log('\nбез письма подтвердить почту нечем — дальше проверять нечего');
  process.exit(1);
}

const link = await linkFrom(letter.ID, '/verify-email');
check('в письме есть ссылка вида /verify-email?token=', link !== null);
check('токен нужной длины и алфавита', /^[A-Za-z0-9_-]{43}$/.test(link?.token ?? ''), `${link?.token?.length ?? 0} символов`);

// Адрес ссылки сверяется с настройкой, а не с адресом API: у фронтенда свой
// адрес, и в разработке это законно localhost:5173. Ошибкой является не сам
// localhost, а РАСХОЖДЕНИЕ письма с настройкой — и отдельно то, что на
// удалённом сервере настройка вообще указывает на локальную машину.
let configured = '';
try {
  configured = sql(`SELECT value #>> '{}' FROM settings WHERE key = 'app.frontend_url';`);
} catch (e) {
  note(`настройку app.frontend_url прочитать не удалось: ${e.message.split('\n')[0]}`);
}
if (configured) {
  check('ссылка в письме совпадает с настройкой app.frontend_url',
    link?.base === configured.replace(/\/+$/, ''), `в письме ${link?.base}, в настройке ${configured}`);
  if (REMOTE) {
    check('настройка НЕ указывает на localhost (иначе письма зовут на машину получателя)',
      !/localhost|127\.0\.0\.1/.test(configured), configured);
  }
}
note(`ссылка: ${link?.url?.slice(0, 72)}…`);

const verified = await api('POST', '/auth/verify-email', { token: link.token });
check('почта подтверждена', verified.code === 200, `HTTP ${verified.code} ${JSON.stringify(verified.body)}`);

const again = await api('POST', '/auth/verify-email', { token: link.token });
check('тот же токен второй раз НЕ срабатывает', again.code === 401, `HTTP ${again.code}`);
check('код отказа TOKEN_INVALID', again.body?.code === 'TOKEN_INVALID', String(again.body?.code));

// --- Вход -------------------------------------------------------------------

head('Вход');

const login = await auth('POST', '/auth/login', { login: U, password: PASS });
check('вход после подтверждения разрешён', login.code === 200, `HTTP ${login.code} ${JSON.stringify(login.body)}`);
check('двухфакторная проверка не требуется у обычного пользователя', login.body?.twoFactorRequired === false,
  String(login.body?.twoFactorRequired));
check('выдан access-токен формата JWT', String(login.body?.accessToken ?? '').split('.').length === 3);
check('выдан refresh-токен (непрозрачная строка, не JWT)',
  /^[A-Za-z0-9_-]{43}$/.test(login.body?.refreshToken ?? ''), String(login.body?.refreshToken).slice(0, 12));
check('срок жизни access-токена объявлен', Number(login.body?.expiresIn) > 0, String(login.body?.expiresIn));
check('в ответе есть профиль с тем же логином', login.body?.user?.username === U, JSON.stringify(login.body?.user));

const wrong = await auth('POST', '/auth/login', { login: U, password: 'ThisIsNotThePassword' });
check('вход с неверным паролем отклонён', wrong.code === 401, `HTTP ${wrong.code}`);
check('код отказа INVALID_CREDENTIALS', wrong.body?.code === 'INVALID_CREDENTIALS', String(wrong.body?.code));

let access = login.body?.accessToken;
let refresh = login.body?.refreshToken;

// --- Сессия -----------------------------------------------------------------

head('Сессия');

const me = await api('GET', '/auth/me', undefined, access);
check('профиль отдаётся по access-токену', me.code === 200, `HTTP ${me.code}`);
check('идентификатор совпадает с выданным при регистрации', me.body?.id === reg.body?.userId,
  `${me.body?.id} против ${reg.body?.userId}`);
check('права выданы вместе с ролью', Array.isArray(me.body?.permissions) && me.body.permissions.length > 0,
  `их ${me.body?.permissions?.length ?? 0}`);
check('пароль у аккаунта есть (не OAuth-заглушка)', me.body?.hasPassword === true, String(me.body?.hasPassword));
note(`права: ${(me.body?.permissions ?? []).join(', ')}`);

const anon = await api('GET', '/auth/me');
check('без токена профиль не отдаётся', anon.code === 401, `HTTP ${anon.code}`);

const rot = await api('POST', '/auth/refresh', { refreshToken: refresh });
check('обновление токена работает', rot.code === 200, `HTTP ${rot.code} ${JSON.stringify(rot.body)}`);
check('refresh-токен РОТИРУЕТСЯ, а не переиспользуется', rot.body?.refreshToken !== refresh);
check('сессия при обновлении остаётся прежней', rot.body?.sessionId === login.body?.sessionId,
  `${rot.body?.sessionId} против ${login.body?.sessionId}`);

const spent = refresh;
access = rot.body?.accessToken;
refresh = rot.body?.refreshToken;

const out = await api('POST', '/auth/logout', undefined, access);
check('выход выполнен', out.code === 200, `HTTP ${out.code} ${JSON.stringify(out.body)}`);

const afterOut = await api('GET', '/auth/me', undefined, access);
check('access-токен умирает СРАЗУ, не дожидаясь истечения', afterOut.code === 401, `HTTP ${afterOut.code}`);
check('код отказа SESSION_REVOKED', afterOut.body?.code === 'SESSION_REVOKED', String(afterOut.body?.code));

const afterOutRefresh = await api('POST', '/auth/refresh', { refreshToken: refresh });
check('refresh-токен после выхода не работает', afterOutRefresh.code === 401, `HTTP ${afterOutRefresh.code}`);
check('код отказа TOKEN_REVOKED', afterOutRefresh.body?.code === 'TOKEN_REVOKED', String(afterOutRefresh.body?.code));

// Потраченный при ротации токен — отдельный случай со своим кодом: это признак
// кражи, и сервер обязан гасить всю семью токенов, а не только предъявленный.
const reused = await api('POST', '/auth/refresh', { refreshToken: spent });
check('потраченный при ротации токен отвергнут', reused.code === 401, `HTTP ${reused.code}`);
check('код отказа отличает кражу от выхода (TOKEN_REUSED/TOKEN_REVOKED)',
  reused.body?.code === 'TOKEN_REUSED' || reused.body?.code === 'TOKEN_REVOKED', String(reused.body?.code));

// --- Сброс пароля -----------------------------------------------------------

head('Сброс пароля');

const rr = await auth('POST', '/auth/password-reset/request', { email: EMAIL });
check('запрос сброса принят', rr.code === 200, `HTTP ${rr.code}`);

// Ответ обязан быть неотличимым: иначе форма сброса превращается в способ
// узнать, зарегистрирован ли конкретный адрес.
const rrGhost = await auth('POST', '/auth/password-reset/request', { email: `ghost${Date.now()}@example.com` });
check('на несуществующий адрес ответ такой же (нельзя перебрать аккаунты)',
  rrGhost.code === rr.code && JSON.stringify(rrGhost.body) === JSON.stringify(rr.body),
  `HTTP ${rrGhost.code} против ${rr.code}`);

const rLetter = await waitMail(U, 'Сброс пароля');
check('письмо со сбросом доставлено', rLetter !== null, 'за 42 секунды не пришло');

if (rLetter) {
  const rLink = await linkFrom(rLetter.ID, '/reset-password');
  check('в письме есть ссылка вида /reset-password?token=', rLink !== null);

  const conf = await auth('POST', '/auth/password-reset/confirm', { token: rLink?.token, newPassword: PASS2 });
  check('новый пароль установлен', conf.code === 200, `HTTP ${conf.code} ${JSON.stringify(conf.body)}`);

  const oldPw = await auth('POST', '/auth/login', { login: U, password: PASS });
  check('старый пароль больше не пускает', oldPw.code === 401, `HTTP ${oldPw.code}`);

  const newPw = await auth('POST', '/auth/login', { login: U, password: PASS2 });
  check('новый пароль пускает', newPw.code === 200, `HTTP ${newPw.code}`);

  const confAgain = await auth('POST', '/auth/password-reset/confirm', { token: rLink?.token, newPassword: PASS2 });
  check('ссылка сброса одноразовая', confAgain.code === 401, `HTTP ${confAgain.code}`);
}

// --- Уборка -----------------------------------------------------------------

head('Уборка');

try {
  const before = sql(`SELECT count(*) FROM users WHERE username = '${U}';`);
  sql(`DELETE FROM users WHERE username = '${U}';`);
  const after = sql(`SELECT count(*) FROM users WHERE username = '${U}';`);
  check('тестовый пользователь удалён', before === '1' && after === '0', `было ${before}, стало ${after}`);
} catch (e) {
  note(`удалить пользователя ${U} не удалось: ${e.message.split('\n')[0]}`);
  note('он останется в базе — удали вручную, если мешает');
}

console.log('');
if (failed === 0) { console.log('\x1b[32mВСЕ ПРОВЕРКИ ПРОЙДЕНЫ\x1b[0m'); process.exit(0); }
console.log(`\x1b[31mПРОВАЛЕНО ПРОВЕРОК: ${failed}\x1b[0m`);
process.exit(1);
