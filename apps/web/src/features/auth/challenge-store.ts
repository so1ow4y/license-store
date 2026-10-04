/**
 * Промежуточный токен второго фактора.
 *
 * ХРАНИТСЯ ТОЛЬКО В ПАМЯТИ МОДУЛЯ. Ни localStorage, ни sessionStorage, ни
 * адресной строки: `challengeToken` — это половина входа. Оставить его
 * в хранилище означает, что достаточно списать его с чужой машины и добить
 * шестью цифрами, а перезагрузка вкладки не должна давать второй попытки
 * тому, кто отошёл от компьютера.
 *
 * Побочный полезный эффект: challenge умирает вместе со вкладкой, поэтому
 * прямой заход на шаг ввода кода без прохождения шага с паролем невозможен —
 * экран сам вернётся к вводу пароля.
 *
 * Модуль отдельный, а не состояние компонента входа, потому что challenge
 * заводят ДВА экрана: `/login` и `/register/key` (регистрация по ключу тоже
 * может упереться во второй фактор, если ключ активируют на аккаунт
 * с включённой 2FA — сервер там вызывает общий `completeLogin`).
 */

/** Попыток на один challenge — ровно столько считает сервер (`MAX_TWO_FACTOR_ATTEMPTS`). */
export const MAX_TWO_FACTOR_ATTEMPTS = 5

export type TwoFactorChallenge = {
  challengeToken: string
  /** Момент истечения в миллисекундах epoch — считается из `expiresIn` при создании. */
  expiresAt: number
  /**
   * Что ввели на первом шаге. Нужно ровно для одного: вернуть человека
   * к вводу пароля с уже заполненным логином, когда challenge протух.
   */
  login: string
  /** Сколько попыток осталось по нашему счёту. Сервер считает свои — наш только для подсказки. */
  attemptsLeft: number
}

let current: TwoFactorChallenge | null = null

type Listener = () => void
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeChallenge(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Текущий challenge. Просроченный не возвращается вовсе: сервер его всё равно
 * отвергнет с `CHALLENGE_INVALID`, а показывать поле ввода кода, который
 * заведомо не примут, — это отправить человека тратить попытку впустую.
 */
export function getChallenge(): TwoFactorChallenge | null {
  if (current && current.expiresAt <= Date.now()) {
    current = null
  }
  return current
}

export function setChallenge(params: {
  challengeToken: string
  expiresIn: number
  login: string
}): void {
  current = {
    challengeToken: params.challengeToken,
    expiresAt: Date.now() + params.expiresIn * 1000,
    login: params.login,
    attemptsLeft: MAX_TWO_FACTOR_ATTEMPTS,
  }
  emit()
}

export function clearChallenge(): void {
  current = null
  emit()
}

/**
 * Уменьшить счётчик после неверного кода.
 *
 * Счётчик локальный и заведомо приблизительный: сервер инкрементирует свой
 * ДО проверки кода, поэтому оборванный запрос он засчитает, а мы нет.
 * Поэтому число показывается как ориентир, а окончательное слово — за
 * ответом `TWO_FACTOR_ATTEMPTS_EXCEEDED`.
 */
export function consumeAttempt(): number {
  if (!current) return 0
  current = { ...current, attemptsLeft: Math.max(0, current.attemptsLeft - 1) }
  emit()
  return current.attemptsLeft
}

/** Снимок для `useSyncExternalStore`; на сервере рендера нет — отдаём null. */
export function getChallengeSnapshot(): TwoFactorChallenge | null {
  return getChallenge()
}
