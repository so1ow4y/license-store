/**
 * Регистрация меню команд бота (§4.3 ТЗ).
 *
 * Разовый скрипт деплоя, а не вызов при старте процесса. Причина та же,
 * что у setWebhook: setMyCommands — глобальная настройка бота, и вызывать
 * её на каждом старте каждой реплики значит тратить лимит Bot API и
 * получать гонку при выкладке нескольких экземпляров одновременно.
 *
 * Запуск:
 *   npm run tg:commands          — установить меню
 *   npm run tg:commands show     — показать, что установлено сейчас
 *   npm run tg:commands delete   — снять меню
 *
 * Токен читается ТОЛЬКО из окружения. В аргументы командной строки он
 * не принимается: аргументы видны в `ps` любому пользователю машины
 * и остаются в истории оболочки.
 */
import { config as loadEnv } from 'dotenv';
import * as path from 'node:path';

import { en } from '../src/modules/telegram-bot/i18n/en';
import { ru } from '../src/modules/telegram-bot/i18n/ru';

// Тот же путь к .env, что у приложения (app.module.ts): файл один, в корне монорепы.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const API_TIMEOUT_MS = 10_000;

/**
 * Команды меню в порядке показа.
 *
 * Здесь только семь из §4.3. `/language`, `/unlink`, `/cancel` и `/admin`
 * бот обрабатывает, но в меню не выводит: меню — это то, что человек
 * открывает каждый день, а не полный список синтаксиса.
 */
const MENU: Array<{ command: string; key: 'cmd.start' | 'cmd.licenses' | 'cmd.activate' | 'cmd.products' | 'cmd.account' | 'cmd.support' | 'cmd.help' }> = [
  { command: 'start', key: 'cmd.start' },
  { command: 'licenses', key: 'cmd.licenses' },
  { command: 'activate', key: 'cmd.activate' },
  { command: 'products', key: 'cmd.products' },
  { command: 'account', key: 'cmd.account' },
  { command: 'support', key: 'cmd.support' },
  { command: 'help', key: 'cmd.help' },
];

interface TgEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  const envelope = (await response.json()) as TgEnvelope<T>;

  if (!envelope.ok) {
    throw new Error(`${method}: ${envelope.error_code ?? response.status} ${envelope.description ?? ''}`);
  }

  return envelope.result as T;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    // Падаем с внятной причиной: пустой токен даёт от Telegram 404 без
    // объяснений, и разбирать его потом дольше, чем прочитать эту строку.
    throw new Error('TELEGRAM_BOT_TOKEN не задан в окружении');
  }

  const action = process.argv[2] ?? 'set';

  if (action === 'show') {
    const common = await call<unknown>(token, 'getMyCommands', {});
    const russian = await call<unknown>(token, 'getMyCommands', { language_code: 'ru' });
    console.log('по умолчанию (en):', JSON.stringify(common, null, 2));
    console.log('ru:', JSON.stringify(russian, null, 2));
    return;
  }

  if (action === 'delete') {
    await call(token, 'deleteMyCommands', {});
    await call(token, 'deleteMyCommands', { language_code: 'ru' });
    console.log('меню команд снято');
    return;
  }

  if (action !== 'set') {
    throw new Error(`неизвестное действие «${action}», допустимы: set | show | delete`);
  }

  // Два вызова: без language_code — язык по умолчанию для всех остальных
  // локалей, с 'ru' — для русскоязычных клиентов. Английский идёт первым
  // и он же источник истины (i18n/en.ts).
  await call(token, 'setMyCommands', {
    commands: MENU.map((item) => ({ command: item.command, description: en[item.key] })),
  });

  await call(token, 'setMyCommands', {
    language_code: 'ru',
    commands: MENU.map((item) => ({ command: item.command, description: ru[item.key] })),
  });

  console.log(`меню команд установлено: ${MENU.length} команд, локали en (по умолчанию) и ru`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
