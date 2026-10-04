import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV, type Env } from '@common/config/env.schema';

/**
 * Конфигурация бота из окружения.
 *
 * Единственный источник правды — ENV, не таблица settings. Причина:
 * секрет вебхука и токен бота обязаны быть зашифрованы, если лежат в БД,
 * а механизма записи isSecret-значений (контроллера настроек) в проекте
 * нет вовсе. Настройка, которую нельзя задать, — это не настройка,
 * а неработающая ветка кода, о которую однажды споткнутся.
 *
 * Инжектируется токен ENV, а не ConfigService: у ConfigService.get с infer
 * условные типы на объекте такого размера разрешаются в широкое
 * объединение и ломают компиляцию (объяснение — env.schema.ts:399-408).
 */
@Injectable()
export class TelegramBotConfig {
  private readonly logger = new Logger(TelegramBotConfig.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Рубильник. Всё остальное имеет смысл спрашивать только при true:
   * схема окружения гарантирует непустые токен, секрет и username
   * ровно в этом случае (env.schema.ts, последний superRefine).
   */
  get enabled(): boolean {
    return this.env.TELEGRAM_BOT_ENABLED;
  }

  /**
   * Токен бота. Бросает при пустом значении вместо возврата пустой строки:
   * иначе запрос уйдёт на https://api.telegram.org/bot/sendMessage, вернёт
   * 404 «Not Found» и будет выглядеть как проблема сети, а не конфигурации.
   */
  get token(): string {
    const value = this.env.TELEGRAM_BOT_TOKEN;
    if (!value) throw new Error('TELEGRAM_BOT_TOKEN пуст — бот не настроен');
    return value;
  }

  get username(): string {
    const value = this.env.TELEGRAM_BOT_USERNAME;
    if (!value) throw new Error('TELEGRAM_BOT_USERNAME пуст — deep link собрать не из чего');
    return value;
  }

  /**
   * Секрет вебхука. Пустая строка возвращается намеренно, а не исключение:
   * контроллер сравнивает её с присланной и отвечает 404. Исключение здесь
   * дало бы 500 на публичном маршруте, то есть подтверждение существования
   * маршрута тому, кто его перебирает.
   */
  get webhookSecret(): string {
    return this.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  }

  /**
   * Секрет заголовка X-Telegram-Bot-Api-Secret-Token — ОТДЕЛЬНОЕ значение.
   *
   * Пустая строка по тому же доводу, что и у секрета пути: контроллер
   * сравнит её с присланной и ответит 404. Схема окружения не допускает
   * пустого и не допускает совпадения с секретом пути при enabled=true.
   */
  get webhookHeaderSecret(): string {
    return this.env.TELEGRAM_WEBHOOK_HEADER_SECRET ?? '';
  }

  /**
   * Чат владельца. Отрицательное число у групп — это нормально.
   * Мусор в переменной не роняет приложение: алерты владельцу не тот
   * механизм, ради которого стоит не поднимать API, — но и молчать
   * о неразобранном значении нельзя, иначе алерты просто исчезнут.
   */
  get adminChatId(): bigint | null {
    const raw = this.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
    if (!raw) return null;

    try {
      return BigInt(raw);
    } catch {
      this.logger.warn('TELEGRAM_ADMIN_CHAT_ID не разбирается в число — алерты владельцу отключены');
      return null;
    }
  }

  /** База для ссылок на сайт (кабинет, каталог, страница лицензии). */
  get appUrl(): string {
    // Хвостовой слэш срезается здесь один раз: иначе каждая склейка ниже
    // по коду даёт //licenses/… — рабочий, но некрасивый и ломающий
    // сравнение адресов путь.
    return this.env.APP_URL.replace(/\/+$/, '');
  }

  /** Адрес вебхука целиком — им пользуется скрипт деплоя scripts/telegram-webhook.ts. */
  get webhookUrl(): string {
    return `${this.appUrl}/api/v1/telegram/webhook/${this.webhookSecret}`;
  }

  /**
   * Ссылка привязки. Лимит payload'а у start — 64 символа, наш токен
   * занимает 43 (32 байта в base64url), запас есть.
   */
  deepLink(token: string): string {
    return `https://t.me/${this.username}?start=${token}`;
  }
}
