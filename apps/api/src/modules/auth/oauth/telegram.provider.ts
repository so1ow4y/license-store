import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { ENV, type Env } from '@common/config/env.schema';

/**
 * Вход через Telegram Login Widget.
 *
 * Устроен принципиально иначе, чем OAuth: обмена кодом нет. Виджет отдаёт
 * данные профиля прямо в браузер, подписанные ключом, производным
 * от токена бота. Наша задача — проверить подпись и свежесть.
 *
 * Telegram НЕ отдаёт адрес электронной почты вообще. Поэтому коллизий
 * по почте здесь не бывает по построению, и вопрос автопривязки
 * к существующему аккаунту не возникает.
 */

/**
 * Допустимый возраст данных авторизации.
 *
 * Подпись бессрочна, поэтому единственное, что мешает переиграть
 * перехваченный payload через месяц, — эта проверка. Сутки в примерах
 * Telegram слишком много: пять минут покрывают реальный вход.
 */
const MAX_AUTH_AGE_SEC = 300;

export interface TelegramAuthPayload {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

export interface TelegramProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  raw: Record<string, unknown>;
}

@Injectable()
export class TelegramProvider {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get isConfigured(): boolean {
    return Boolean(this.env.TELEGRAM_BOT_TOKEN);
  }

  /**
   * Проверка подписи виджета.
   *
   * Алгоритм из документации Telegram:
   *   secret = SHA256(bot_token)                       — бинарно, не hex
   *   check  = "key=value\n..." по всем полям кроме hash, ключи по алфавиту
   *   hash   = HMAC-SHA256(check, secret)
   */
  verify(payload: TelegramAuthPayload): TelegramProfile {
    if (!this.isConfigured) {
      throw new UnauthorizedException({
        code: 'OAUTH_NOT_CONFIGURED',
        message: 'Вход через Telegram не настроен',
      });
    }

    const { hash, ...fields } = payload;

    if (!hash || !fields.id || !fields.auth_date) {
      throw new UnauthorizedException({
        code: 'OAUTH_INVALID_PAYLOAD',
        message: 'Некорректные данные авторизации Telegram',
      });
    }

    const checkString = Object.keys(fields)
      .filter((key) => fields[key as keyof typeof fields] !== undefined)
      .sort()
      .map((key) => `${key}=${String(fields[key as keyof typeof fields])}`)
      .join('\n');

    // Секрет — именно бинарный SHA-256 от токена, а не его hex-представление.
    // Ошибка здесь даёт подпись, которая никогда не сойдётся, и выглядит
    // как «Telegram присылает мусор».
    const secret = createHash('sha256').update(this.env.TELEGRAM_BOT_TOKEN!, 'utf8').digest();
    const expected = createHmac('sha256', secret).update(checkString, 'utf8').digest('hex');

    if (!this.constantTimeEquals(expected, hash)) {
      throw new UnauthorizedException({
        code: 'OAUTH_SIGNATURE_INVALID',
        message: 'Подпись данных Telegram неверна',
      });
    }

    const authDate = Number(payload.auth_date);
    const age = Math.floor(Date.now() / 1000) - authDate;

    if (!Number.isFinite(authDate) || age > MAX_AUTH_AGE_SEC || age < -MAX_AUTH_AGE_SEC) {
      throw new UnauthorizedException({
        code: 'OAUTH_PAYLOAD_EXPIRED',
        message: 'Данные авторизации устарели, попробуйте снова',
      });
    }

    // username в Telegram необязателен — если его нет, собираем
    // из идентификатора, иначе аккаунт останется без логина.
    const username =
      payload.username ??
      [payload.first_name, payload.last_name].filter(Boolean).join('_') ??
      `tg_${payload.id}`;

    return {
      id: String(payload.id),
      username,
      avatarUrl: payload.photo_url ?? null,
      raw: payload as unknown as Record<string, unknown>,
    };
  }

  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }
}
