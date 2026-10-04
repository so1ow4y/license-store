// ============================================================================
//  Токен администратора для скриптов на Node. Тот же смысл, что и у
//  _admin-token.ps1 — см. подробности в его шапке.
//
//  Коротко: сидовый admin создаётся без 2FA, а привилегированная роль без
//  второго фактора административных действий не выполняет (ТЗ п.14).
//  Первый запуск включает 2FA и запоминает секрет, последующие входят кодом.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..', 'apps', 'api');

// Секрет 2FA хранится ОТДЕЛЬНО НА КАЖДЫЙ СЕРВЕР. Раньше файл был один, и это
// была мина: у локального и у боевого администратора базы разные, значит и
// секреты разные. Запуск скрипта против сервера включал бы там 2FA и записывал
// новый секрет поверх локального — после чего локальные смоуки перестали бы
// входить, а вернуть секрет было бы неоткуда. Ошибка выглядела бы как «сервер
// не принимает код», хотя сломал бы её предыдущий запуск совсем другого
// скрипта против совсем другого адреса.
function secretFileFor(base) {
  let host;
  try { host = new URL(base).host; } catch { host = 'local'; }
  return join(HERE, `.admin-2fa.${host.replace(/[^A-Za-z0-9.-]/g, '_')}`);
}

export async function getAdminToken({
  base = 'http://localhost:3000/api/v1',
  login = 'admin',
  password = 'ChangeMe!2026',
} = {}) {
  const SECRET_FILE = secretFileFor(base);

  // Переезд со старого общего файла: он заводился для локального сервера,
  // поэтому достаётся localhost и никому больше.
  const LEGACY = join(HERE, '.admin-2fa');
  if (!existsSync(SECRET_FILE) && existsSync(LEGACY) && /localhost|127\.0\.0\.1/.test(base)) {
    writeFileSync(SECRET_FILE, readFileSync(LEGACY, 'utf8'), 'utf8');
  }

  const post = async (path, body, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, {
      method: 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { code: res.status, body: parsed };
  };

  const totp = (secret) =>
    execFileSync('node', ['-e', 'console.log(require("otplib").generateSync({secret: process.argv[1]}))', secret],
      { cwd: API_DIR, encoding: 'utf8' }).trim();

  const res = await post('/auth/login', { login, password });
  if (res.code !== 200) {
    throw new Error(`вход администратором не прошёл: HTTP ${res.code} ${JSON.stringify(res.body)}`);
  }

  if (res.body?.twoFactorRequired === true) {
    if (!existsSync(SECRET_FILE)) {
      throw new Error(
        `у админа включена 2FA, но секрет не сохранён (${SECRET_FILE}). ` +
        'Сбрось 2FA в БД — как это сделать, написано в шапке _admin-token.ps1',
      );
    }
    const secret = readFileSync(SECRET_FILE, 'utf8').trim();
    const code = totp(secret);
    let done = await post('/auth/2fa/verify', {
      challengeToken: res.body.challengeToken,
      code,
    });

    // Код одноразовый: сервер запоминает использованный шаг TOTP и отвергает
    // повтор (защита от перехвата кода с экрана). Скрипты запускаются подряд
    // и попадают в одно 30-секундное окно, поэтому ждём следующий шаг и
    // пробуем ещё раз. Обходить защиту нельзя — тогда тесты проверяли бы
    // не тот сервер, что поедет в прод.
    if (done.code !== 200 && done.body?.code === 'TWO_FACTOR_INVALID') {
      console.log('  код уже использован, жду следующий шаг TOTP...');
      let next = code;
      for (let i = 0; i < 35 && next === code; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        next = totp(secret);
      }
      if (next !== code) {
        // Прежний challenge погашен неудачной попыткой — берём новый.
        const again = await post('/auth/login', { login, password });
        done = await post('/auth/2fa/verify', {
          challengeToken: again.body.challengeToken,
          code: next,
        });
      }
    }

    if (done.code !== 200) {
      throw new Error(`не удалось завершить вход кодом: HTTP ${done.code} ${JSON.stringify(done.body)}`);
    }
    return done.body.accessToken;
  }

  // Второго фактора ещё нет. Токен, полученный ДО включения, остаётся
  // действительным: гейт стоит на административных действиях, а не на входе.
  const token = res.body.accessToken;

  const setup = await post('/auth/2fa/setup', undefined, token);
  if (setup.code !== 200 || !setup.body?.secret) {
    throw new Error(`не удалось получить секрет 2FA: HTTP ${setup.code}`);
  }

  const enable = await post('/auth/2fa/enable', { code: totp(setup.body.secret) }, token);
  if (enable.code !== 200) {
    throw new Error(`не удалось включить 2FA: HTTP ${enable.code} ${JSON.stringify(enable.body)}`);
  }

  writeFileSync(SECRET_FILE, setup.body.secret, 'utf8');
  console.log(`  2FA администратора включена, секрет сохранён в ${SECRET_FILE}`);

  return token;
}
