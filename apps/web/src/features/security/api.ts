import { apiFetch } from '@/lib/api/client'

/**
 * Запросы раздела «Безопасность аккаунта» (K5, пп. 3.15–3.17 плана).
 *
 * Тела собираются здесь поштучно, а не спредом состояния формы. Причина
 * жёсткая: сервер валидирует с `forbidNonWhitelisted`, и одно лишнее поле
 * (хоть `confirmPassword` из формы) превращает корректный запрос в 400
 * с невнятным списком в `details`. Поэтому наружу торчат узкие типы,
 * а не «что было в форме».
 */

/* ------------------------------------------------------------------ */
/* Пароль                                                               */
/* ------------------------------------------------------------------ */

/** Ограничения совпадают с DTO сервера (`auth.dto.ts`: PASSWORD_MIN/MAX). */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export type PasswordChangeResult = {
  message: string
  /**
   * Сколько ЧУЖИХ сессий погашено. Текущая сохраняется: человек только что
   * доказал знание старого пароля (`auth.service.ts:changePassword`).
   */
  revokedSessions: number
}

/** `POST /auth/password/change` — только для аккаунтов, у которых пароль есть. */
export function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<PasswordChangeResult> {
  return apiFetch<PasswordChangeResult>('/auth/password/change', {
    method: 'POST',
    body: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    },
  })
}

/**
 * `POST /auth/password/set` — первый пароль для аккаунта из OAuth.
 *
 * Поле называется `password`, а не `newPassword`: это отдельный DTO
 * (`PasswordSetDto`), и перепутать их — гарантированный 400.
 * Работает ТОЛЬКО пока пароля нет, иначе 409 `PASSWORD_ALREADY_SET`.
 */
export function setPassword(input: { password: string }): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/password/set', {
    method: 'POST',
    body: { password: input.password },
  })
}

/* ------------------------------------------------------------------ */
/* Второй фактор                                                        */
/* ------------------------------------------------------------------ */

export type TwoFactorSetup = {
  /** base32 — для ручного ввода, если камера не читает QR. */
  secret: string
  /** `otpauth://`-ссылка. Картинку сервер не отдаёт, QR рисует фронт. */
  uri: string
}

/**
 * Шаг 1. Второй фактор здесь ещё НЕ включается.
 *
 * Повторный вызов сбрасывает предыдущую незавершённую попытку и выдаёт новый
 * секрет (`two-factor.service.ts:99-105`) — то есть старый QR после этого
 * мёртв. Поэтому кнопка «начать заново» обязана честно предупреждать.
 */
export function setupTwoFactor(): Promise<TwoFactorSetup> {
  return apiFetch<TwoFactorSetup>('/auth/2fa/setup', { method: 'POST' })
}

export type TwoFactorEnableResult = {
  /** Показываются РОВНО ОДИН РАЗ. Повторно сервер их не отдаёт. */
  recoveryCodes: string[]
  message: string
}

/** Шаг 2. Код строго 6 цифр (`TwoFactorEnableDto`: `@Length(6, 6)`). */
export function enableTwoFactor(input: { code: string }): Promise<TwoFactorEnableResult> {
  return apiFetch<TwoFactorEnableResult>('/auth/2fa/enable', {
    method: 'POST',
    body: { code: input.code },
  })
}

/**
 * Отключение. Требует и пароль, и код одновременно: одной перехваченной
 * сессии не хватит, чтобы снять второй фактор.
 *
 * Гасит ВСЕ сессии пользователя, включая текущую
 * (`auth.service.ts:disableTwoFactor` → `revokeAllUserSessions`).
 * После успеха продолжать работу нечем — только повторный вход.
 *
 * `code` принимает и 6 цифр из приложения, и код восстановления:
 * DTO допускает 6–20 символов, а `TwoFactorService.verify` проверяет оба вида.
 */
export function disableTwoFactor(input: {
  password: string
  code: string
}): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/2fa/disable', {
    method: 'POST',
    body: { password: input.password, code: input.code },
  })
}

/* ------------------------------------------------------------------ */
/* Способы входа                                                        */
/* ------------------------------------------------------------------ */

/** Провайдеры, которые сервер вообще знает (`auth.controller.ts:243`). */
export const KNOWN_PROVIDERS = ['DISCORD', 'TELEGRAM'] as const
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number]

const PROVIDER_LABELS: Record<string, string> = {
  DISCORD: 'Discord',
  TELEGRAM: 'Telegram',
}

/** Человеческое название. Незнакомый код показываем как есть, а не «—». */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider.toUpperCase()] ?? provider
}

/**
 * `DELETE /auth/oauth/:provider`.
 *
 * Сервер сам приводит сегмент к верхнему регистру, но отправляем уже
 * нормализованным: `/auth/me` отдаёт провайдеров именно так, и лишнее
 * преобразование по дороге только маскировало бы расхождение.
 *
 * Откажет с 409 `LAST_LOGIN_METHOD`, если это последний способ войти.
 */
export function unlinkProvider(provider: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(
    `/auth/oauth/${encodeURIComponent(provider.toUpperCase())}`,
    { method: 'DELETE' }
  )
}
