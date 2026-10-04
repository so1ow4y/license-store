/**
 * Запросы публичной авторизации.
 *
 * Все они помечены `anonymous: true`. Это не косметика: без флага `apiFetch`
 * перед каждым заходом полез бы обновлять токен и подставлять `Bearer`.
 * На экране входа обновляться нечем, а протухший заголовок у гостя даёт
 * лишний 401 и сжигает лимит частоты на `/auth/*` (10 запросов в минуту).
 *
 * Тела запросов собираются пополям, а не спредом состояния формы: сервер
 * валидирует с `forbidNonWhitelisted` (`main.ts:155`), и любой лишний ключ —
 * например, `passwordConfirm` из формы — превращается в 400.
 */
import { apiFetch } from '@/lib/api/client'
import { setProfileHint } from '@/lib/auth/session'
import { setTokens } from '@/lib/auth/token-store'

/** `PublicUserDto`. Почта может быть null: регистрация по ключу её не требует. */
export type PublicUser = {
  id: string
  username: string
  email: string | null
  locale: string
}

/** Успешный вход: `LoginResult` с `twoFactorRequired: false`. */
export type LoginSuccess = {
  twoFactorRequired: false
  accessToken: string
  refreshToken: string
  /** Время жизни access в секундах. */
  expiresIn: number
  sessionId: string
  user: PublicUser
}

/** Вход остановлен на втором факторе: `LoginResult` с `twoFactorRequired: true`. */
export type LoginChallenge = {
  twoFactorRequired: true
  challengeToken: string
  /** Время жизни challenge в секундах; сервер отдаёт 900. */
  expiresIn: number
}

export type LoginResult = LoginSuccess | LoginChallenge

/** Разбор объединения. Ветвиться по наличию `accessToken` нельзя — поле опционально только в типе. */
export function isTwoFactorChallenge(
  result: LoginResult
): result is LoginChallenge {
  return result.twoFactorRequired === true
}

/* ------------------------------------------------------------------ */
/* Вход                                                                 */
/* ------------------------------------------------------------------ */

/**
 * `POST /auth/login`.
 *
 * Поле называется `login` и принимает и имя, и почту: сервер сам делает `OR`.
 * `hwid` из DTO из браузера не отправляется — его шлёт только загрузчик.
 */
export function login(body: {
  login: string
  password: string
}): Promise<LoginResult> {
  return apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    anonymous: true,
    body: { login: body.login, password: body.password },
  })
}

/**
 * `POST /auth/2fa/verify`.
 *
 * Второй фактор — единственный путь, который может вернуть только успех:
 * `verifyTwoFactor` на сервере обходит гейт 2FA осознанно, иначе выдал бы
 * новый challenge и человек ходил бы по кругу.
 */
export function verifyTwoFactor(body: {
  challengeToken: string
  code: string
}): Promise<LoginSuccess> {
  return apiFetch<LoginSuccess>('/auth/2fa/verify', {
    method: 'POST',
    anonymous: true,
    body: { challengeToken: body.challengeToken, code: body.code },
  })
}

/* ------------------------------------------------------------------ */
/* Регистрация                                                          */
/* ------------------------------------------------------------------ */

export type RegisterResponse = { userId: string; message: string }

/**
 * `POST /auth/register` → 201.
 *
 * Токенов не выдаёт принципиально: ссылка подтверждения уходит только письмом,
 * иначе регистрация на чужой адрес сразу давала бы рабочий аккаунт
 * (`auth.controller.ts:76-78`). Поэтому автологина после регистрации нет и
 * быть не может — экран обязан вести на «письмо отправлено».
 */
export function register(body: {
  username: string
  email: string
  password: string
  locale?: string
}): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>('/auth/register', {
    method: 'POST',
    anonymous: true,
    body: {
      username: body.username,
      email: body.email,
      password: body.password,
      ...(body.locale ? { locale: body.locale } : {}),
    },
  })
}

/**
 * `POST /auth/register-with-key`.
 *
 * Возвращает сразу пару токенов: ключ выдан администратором,
 * это и есть подтверждение права на доступ, отдельного подтверждения почты
 * не требуется.
 *
 * Почта необязательна — и если её не ввели, ключ `email` в тело НЕ кладём.
 * Пустая строка провалила бы `@IsEmail`, а `null` — `@IsOptional` не спасает
 * от неверного типа.
 */
export function registerWithKey(body: {
  code: string
  username: string
  password: string
  email?: string
}): Promise<LoginResult> {
  const email = body.email?.trim()

  return apiFetch<LoginResult>('/auth/register-with-key', {
    method: 'POST',
    anonymous: true,
    body: {
      code: body.code,
      username: body.username,
      password: body.password,
      ...(email ? { email } : {}),
    },
  })
}

/* ------------------------------------------------------------------ */
/* Почта и пароль                                                       */
/* ------------------------------------------------------------------ */

/** `POST /auth/verify-email`. Повторный заход по той же ссылке → 401 TOKEN_INVALID. */
export function verifyEmail(token: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/verify-email', {
    method: 'POST',
    anonymous: true,
    body: { token },
  })
}

/**
 * `POST /auth/password-reset/request`.
 *
 * Всегда 200 с обезличенным текстом, существует адрес или нет. Экран обязан
 * вести себя так же: любое различие в поведении превратило бы форму
 * в проверялку «зарегистрирован ли этот человек».
 */
export function requestPasswordReset(
  email: string
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/auth/password-reset/request', {
    method: 'POST',
    anonymous: true,
    body: { email },
  })
}

/**
 * `POST /auth/password-reset/confirm`.
 *
 * Поле пароля называется `newPassword`, а не `password`.
 * `twoFactorCode` добавляется только когда сервер его потребовал: у аккаунта
 * без второго фактора лишнее поле даст 400 по `forbidNonWhitelisted`.
 */
export function confirmPasswordReset(body: {
  token: string
  newPassword: string
  twoFactorCode?: string
}): Promise<{ message: string }> {
  const code = body.twoFactorCode?.trim()

  return apiFetch<{ message: string }>('/auth/password-reset/confirm', {
    method: 'POST',
    anonymous: true,
    body: {
      token: body.token,
      newPassword: body.newPassword,
      ...(code ? { twoFactorCode: code } : {}),
    },
  })
}

/* ------------------------------------------------------------------ */
/* Приём сессии                                                         */
/* ------------------------------------------------------------------ */

/**
 * Единственное место, где результат входа превращается в сессию приложения.
 *
 * Порядок важен: сначала токены, потом подсказка профиля. `setTokens`
 * оповещает подписчиков `useSession`, и к моменту их пробуждения имя
 * пользователя уже должно быть на месте — иначе шапка мигнёт пустотой.
 *
 * Имя и почта берутся ИМЕННО отсюда: `GET /auth/me` их не отдаёт, и другого
 * шанса их узнать у фронта нет.
 */
export function acceptSession(result: LoginSuccess): void {
  setTokens({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
  })

  setProfileHint({
    username: result.user.username,
    email: result.user.email ?? '',
    locale: result.user.locale,
  })
}
