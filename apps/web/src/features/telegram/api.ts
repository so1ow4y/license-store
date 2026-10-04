/**
 * Подключение Telegram-бота к аккаунту (только в направлении сайт → бот).
 * Контракт: apps/api/src/modules/telegram-bot/telegram-link.controller.ts.
 */
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'

/** Область привязки. ADMIN живёт 30 дней вместо 90 и требует TOTP всегда. */
export type TelegramLinkScope = 'USER' | 'ADMIN'

export type TelegramLinkState = {
  linked: boolean
  /**
   * Кэш @username ТОЛЬКО для показа. Идентификатором связи он не является:
   * человек может сменить его в Telegram в любой момент, а привязка держится
   * на числовом id, который сервер наружу не отдаёт вовсе.
   */
  username: string | null
  linkedAt: string | null
  /** Молчаливого продления нет: по истечении срока привязка отзывается. */
  expiresAt: string | null
  scope: TelegramLinkScope | null
  /**
   * Человек заблокировал бота в самом Telegram. Связь цела, но доставка
   * не работает; снимается первым же сообщением боту.
   */
  chatBlocked: boolean
}

export type TelegramLinkInit = {
  /**
   * Одноразовый токен. В базе лежит только его SHA-256, поэтому повторно
   * узнать значение нельзя — потерянный код выпускается заново.
   */
  token: string
  /** Готовая ссылка t.me/<bot>?start=<token>. */
  deepLink: string
  expiresAt: string
}

export const TELEGRAM_LINK_QUERY_KEY = ['telegram', 'link'] as const

export function telegramLinkQueryOptions() {
  return queryOptions({
    queryKey: TELEGRAM_LINK_QUERY_KEY,
    queryFn: () => apiFetch<TelegramLinkState>('/auth/telegram/link'),
    // Состояние меняется в другом приложении (человек жмёт Start в Telegram),
    // и наш кеш об этом не узнает. Короткий срок жизни — единственный способ
    // показать «подключено» без ручного обновления страницы.
    staleTime: 0,
  })
}

/**
 * `POST /auth/telegram/link/init` — выпустить одноразовый код.
 *
 * Тело собирается поштучно и БЕЗ пустых полей: сервер валидирует с
 * `forbidNonWhitelisted`, а `totpCode: ''` не пройдёт `@Matches` и вернёт 400
 * вместо честного `TWO_FACTOR_REQUIRED`.
 *
 * Возможные отказы, которые обязан различать экран:
 *   401 TWO_FACTOR_REQUIRED — нужен код прямо сейчас (step-up);
 *   401 TWO_FACTOR_INVALID  — код не подошёл;
 *   429 RATE_LIMITED        — пять выпусков в час исчерпаны;
 *   503 TELEGRAM_DISABLED   — бот выключен рубильником.
 */
export function initTelegramLink(input: {
  totpCode?: string
  scope?: TelegramLinkScope
}): Promise<TelegramLinkInit> {
  const body: Record<string, string> = {}
  if (input.totpCode) body.totpCode = input.totpCode
  if (input.scope) body.scope = input.scope

  return apiFetch<TelegramLinkInit>('/auth/telegram/link/init', {
    method: 'POST',
    body,
  })
}

/**
 * `DELETE /auth/telegram/link` — отключить бота.
 *
 * Вход через Telegram (OAuth) НЕ трогается: это другая сущность, и её
 * удаление выбросило бы человека из аккаунта, а иногда и навсегда.
 * Отвечает 404 `TELEGRAM_NOT_LINKED`, если подключения нет.
 */
export function revokeTelegramLink(): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/telegram/link', { method: 'DELETE' })
}
