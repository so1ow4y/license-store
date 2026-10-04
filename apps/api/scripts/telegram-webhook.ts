/**
 * Управление вебхуком бота: разовая операция деплоя.
 *
 * ПОЧЕМУ НЕ ПРИ СТАРТЕ ПРОЦЕССА. setWebhook — глобальная настройка бота,
 * одна на всех. Вызов из каждой реплики при выкатке означает гонку: три
 * контейнера по очереди переустанавливают один и тот же адрес, и любой
 * апдейт, пришедший между удалением и установкой, теряется. Плюс
 * drop_pending_updates при перезапуске выбросил бы очередь, которую
 * Telegram копил, пока сервис лежал.
 *
 * Запуск (из apps/api):
 *   npx tsx scripts/telegram-webhook.ts set
 *   npx tsx scripts/telegram-webhook.ts info
 *   npx tsx scripts/telegram-webhook.ts delete
 *
 * ТОКЕН И СЕКРЕТ ЧИТАЮТСЯ ТОЛЬКО ИЗ ОКРУЖЕНИЯ и в аргументы командной
 * строки не принимаются: аргументы видны в `ps` любому пользователю
 * машины и оседают в истории оболочки — то есть секрет, переданный
 * «на один раз», остаётся в ~/.bash_history навсегда.
 *
 * Каталог scripts/ не входит в tsconfig include (там src/test/prisma) —
 * файл гоняется через tsx и в сборку не попадает.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// .env лежит в корне монорепы, как и для приложения (app.module.ts:34).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'];

/**
 * Потолок одновременных соединений от Telegram. 40 при одном контейнере —
 * запас: больше означает, что площадка будет держать столько параллельных
 * запросов к нам, сколько мы не разберём, и упрётся в таймауты.
 */
const MAX_CONNECTIONS = 40;

interface TgEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface WebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`ОШИБКА: переменная окружения ${name} пуста`);
    process.exit(1);
  }
  return value;
}

/**
 * Прячет секрет в адресе перед выводом. Скрипт запускают в CI, а вывод CI
 * хранится и доступен шире, чем .env.
 */
function maskUrl(url: string | undefined): string {
  if (!url) return '(не установлен)';
  return url.replace(/\/telegram\/webhook\/.+$/, '/telegram/webhook/***');
}

async function call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let envelope: TgEnvelope<T>;
  try {
    envelope = JSON.parse(text) as TgEnvelope<T>;
  } catch {
    throw new Error(`не JSON от Bot API (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!envelope.ok) {
    // Описание ошибки Telegram токена не содержит — выводить безопасно.
    throw new Error(`${method}: ${envelope.description ?? `HTTP ${res.status}`}`);
  }

  return envelope.result as T;
}

async function main(): Promise<void> {
  const command = process.argv[2];

  // Подсказка по использованию печатается ДО проверки окружения: иначе
  // забытый аргумент выглядит как ненастроенный токен, и человек идёт
  // чинить .env вместо того, чтобы дописать слово.
  if (command !== 'set' && command !== 'delete' && command !== 'info') {
    console.error('использование: tsx scripts/telegram-webhook.ts set|delete|info');
    process.exit(1);
  }

  const token = required('TELEGRAM_BOT_TOKEN');

  if (command === 'set') {
    const secret = required('TELEGRAM_WEBHOOK_SECRET');
    if (secret.length < 32) {
      console.error('ОШИБКА: TELEGRAM_WEBHOOK_SECRET короче 32 символов');
      process.exit(1);
    }

    // Отдельное значение: путь попадает в логи прокси, заголовок — нет.
    const headerSecret = required('TELEGRAM_WEBHOOK_HEADER_SECRET');
    if (headerSecret.length < 32) {
      console.error('ОШИБКА: TELEGRAM_WEBHOOK_HEADER_SECRET короче 32 символов');
      process.exit(1);
    }
    if (headerSecret === secret) {
      console.error(
        'ОШИБКА: TELEGRAM_WEBHOOK_HEADER_SECRET совпадает с TELEGRAM_WEBHOOK_SECRET — ' +
          'сгенерируйте отдельное значение',
      );
      process.exit(1);
    }

    const appUrl = required('APP_URL').replace(/\/+$/, '');
    if (!appUrl.startsWith('https://')) {
      // Telegram не устанавливает вебхук на http — отказ придёт с общей
      // формулировкой, по которой причину не найти.
      console.error(`ОШИБКА: APP_URL должен быть https, получено ${appUrl}`);
      process.exit(1);
    }

    const url = `${appUrl}/api/v1/telegram/webhook/${secret}`;

    await call(token, 'setWebhook', {
      url,
      // Второй, независимый секрет — в заголовке. Контроллер сверяет оба.
      secret_token: headerSecret,
      // Явный список: без него Telegram шлёт всё подряд, включая правки
      // сообщений и опросы, — это трафик и очередь на пустом месте.
      allowed_updates: ALLOWED_UPDATES,
      max_connections: MAX_CONNECTIONS,
      // При первой установке копившаяся очередь не нужна: она может быть
      // недельной давности, а отвечать на позавчерашнее нажатие хуже,
      // чем не отвечать.
      drop_pending_updates: true,
    });

    console.log(`вебхук установлен: ${maskUrl(url)}`);
    console.log(`  allowed_updates: ${ALLOWED_UPDATES.join(', ')}`);
    console.log(`  max_connections: ${MAX_CONNECTIONS}`);
    console.log('не забудьте TELEGRAM_BOT_ENABLED=true и рестарт API');
    return;
  }

  if (command === 'delete') {
    await call(token, 'deleteWebhook', { drop_pending_updates: true });
    console.log('вебхук удалён, накопленные апдейты сброшены');
    return;
  }

  const info = await call<WebhookInfo>(token, 'getWebhookInfo', {});
  console.log(`адрес:              ${maskUrl(info.url)}`);
  console.log(`в очереди:          ${info.pending_update_count ?? 0}`);
  console.log(`max_connections:    ${info.max_connections ?? '—'}`);
  console.log(`allowed_updates:    ${info.allowed_updates?.join(', ') ?? '(все)'}`);
  if (info.last_error_message) {
    const at = info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : '—';
    console.log(`последняя ошибка:   ${at} — ${info.last_error_message}`);
  }
}

main().catch((error: unknown) => {
  console.error(`ОШИБКА: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
