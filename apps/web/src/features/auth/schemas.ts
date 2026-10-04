/**
 * Схемы форм авторизации.
 *
 * Каждое ограничение здесь повторяет ограничение серверного DTO
 * (`apps/api/src/modules/auth/dto/auth.dto.ts`). Дублирование сознательное:
 * на проде `ValidationPipe` создан с `disableErrorMessages: true`
 * (`main.ts:160`), то есть массив `details[]` до браузера НЕ доезжает и
 * человек получил бы «Проверьте заполнение полей» без единого указания,
 * что именно не так. Клиентская проверка — единственный источник понятного
 * текста в бою.
 *
 * Схемы намеренно не строже сервера: поле, которое сервер примет, форма
 * обязана отправить. Иначе пользователь упирается в стену, которой на самом
 * деле нет.
 *
 * ТЕКСТ ОШИБКИ ЗАДАЁТСЯ ФУНКЦИЕЙ `error: () => t(...)`, а не строкой. Схемы —
 * константы модуля: они считаются ОДИН РАЗ при загрузке файла, и строка
 * навсегда зафиксировала бы язык, активный в тот момент. После переключения
 * языка все подписи на форме сменились бы, а сообщения под полями остались бы
 * на прежнем. Функция же вызывается zod'ом в момент разбора значения, то есть
 * читает язык тогда, когда текст действительно нужен.
 */
import { z } from 'zod'
import { t } from '@/lib/i18n'

/** Границы пароля из `auth.dto.ts`: PASSWORD_MIN / PASSWORD_MAX. */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

/** `@Length(3, 32)` + `@Matches(/^[a-zA-Z0-9_-]+$/)` на `username`. */
export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/** `@Length(6, 20)` на `code`: шесть цифр TOTP либо код восстановления. */
export const TWO_FACTOR_CODE_MIN = 6
export const TWO_FACTOR_CODE_MAX = 20

/**
 * `@MaxLength(255)` на адресе почты. Вынесено в константу, потому что теперь
 * число уезжает в текст ошибки подстановкой: два независимых «255» разъехались
 * бы при первом же изменении границы на сервере.
 */
export const EMAIL_MAX = 255

/** `@MaxLength(64)` на `RegisterWithKeyDto.code`. */
export const KEY_MAX = 64

/** Валидатор адреса из zod — держим одним экземпляром, а не создаём на каждый ввод. */
const emailCheck = z.email()

/**
 * Адрес почты. `trim()` обязателен: адрес почти всегда попадает в поле
 * копированием, и хвостовой пробел давал бы 400 от `@IsEmail` на пустом месте.
 */
export const emailField = z
  .string()
  .trim()
  .min(1, { error: () => t('auth.validation.email.required') })
  .max(EMAIL_MAX, {
    error: () => t('auth.validation.email.tooLong', { max: EMAIL_MAX }),
  })
  .refine((value) => emailCheck.safeParse(value).success, {
    error: () => t('auth.validation.email.invalid'),
  })

/**
 * Логин. Кириллица запрещена сервером намеренно: «а» и «a» визуально
 * неотличимы, и на этом строится подмена аккаунта при обращении в поддержку
 * (комментарий в `auth.dto.ts:38-40`). Поэтому текст ошибки прямо называет
 * допустимый набор символов, а не отсылает к «неверному формату».
 */
export const usernameField = z
  .string()
  .trim()
  .min(USERNAME_MIN, {
    error: () => t('auth.validation.username.tooShort', { min: USERNAME_MIN }),
  })
  .max(USERNAME_MAX, {
    error: () => t('auth.validation.username.tooLong', { max: USERNAME_MAX }),
  })
  .regex(USERNAME_PATTERN, {
    error: () => t('auth.validation.username.pattern'),
  })

export const passwordField = z
  .string()
  .min(PASSWORD_MIN, {
    error: () => t('auth.validation.password.tooShort', { min: PASSWORD_MIN }),
  })
  .max(PASSWORD_MAX, {
    error: () => t('auth.validation.password.tooLong', { max: PASSWORD_MAX }),
  })

/**
 * Код второго фактора. Пробелы и дефисы вырезаются здесь же: приложения
 * показывают код как «123 456», а коды восстановления — как «A1B2-C3D4».
 * Сервер их тоже вырежет (`two-factor.service.ts:213`), но проверку длины
 * `@Length(6, 20)` он делает ДО этого, по сырой строке.
 */
export const twoFactorCodeField = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .min(TWO_FACTOR_CODE_MIN, {
        error: () =>
          t('auth.validation.twoFactorCode.tooShort', {
            min: TWO_FACTOR_CODE_MIN,
          }),
      })
      .max(TWO_FACTOR_CODE_MAX, {
        error: () =>
          t('auth.validation.twoFactorCode.tooLong', {
            max: TWO_FACTOR_CODE_MAX,
          }),
      })
  )

/* ------------------------------------------------------------------ */
/* Вход                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Поле называется `login`, а не `email`: сервер ищет по `OR` из email и
 * username (`auth.service.ts:233-238`), поэтому формат здесь не проверяется
 * вовсе — иначе вход по имени пользователя оказался бы невозможен.
 */
export const loginSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1, { error: () => t('auth.validation.login.required') })
    .max(EMAIL_MAX, { error: () => t('auth.validation.login.tooLong') }),
  password: z
    .string()
    .min(1, { error: () => t('auth.validation.password.required') })
    .max(PASSWORD_MAX, {
      error: () => t('auth.validation.password.tooLong', { max: PASSWORD_MAX }),
    }),
})

export type LoginFormValues = z.infer<typeof loginSchema>

export const twoFactorSchema = z.object({
  code: twoFactorCodeField,
})

export type TwoFactorFormValues = z.infer<typeof twoFactorSchema>

/* ------------------------------------------------------------------ */
/* Регистрация                                                          */
/* ------------------------------------------------------------------ */

/**
 * Повтор пароля — поле формы, а не поле DTO. На сервер оно не уходит:
 * `forbidNonWhitelisted` превратил бы лишний ключ в 400.
 */
export const registerSchema = z
  .object({
    username: usernameField,
    email: emailField,
    password: passwordField,
    passwordConfirm: z.string(),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    path: ['passwordConfirm'],
    error: () => t('auth.validation.passwordConfirm.mismatch'),
  })

export type RegisterFormValues = z.infer<typeof registerSchema>

/**
 * Регистрация по ключу.
 *
 * Поле ключа в DTO называется `code` (`RegisterWithKeyDto.code`), а не `key`.
 * Почта необязательна: ключ уже подтверждает право на доступ
 * (`registration-key.service.ts:240-242`), поэтому пустая строка должна
 * превратиться в `undefined` и вовсе не попасть в тело запроса — пустая
 * строка провалила бы `@IsEmail`.
 */
export const registerWithKeySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, { error: () => t('auth.validation.key.required') })
      .max(KEY_MAX, {
        error: () => t('auth.validation.key.tooLong', { max: KEY_MAX }),
      }),
    username: usernameField,
    password: passwordField,
    passwordConfirm: z.string(),
    email: z
      .string()
      .trim()
      .max(EMAIL_MAX, {
        error: () => t('auth.validation.email.tooLong', { max: EMAIL_MAX }),
      })
      .refine((value) => value === '' || emailCheck.safeParse(value).success, {
        error: () => t('auth.validation.email.invalid'),
      }),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    path: ['passwordConfirm'],
    error: () => t('auth.validation.passwordConfirm.mismatch'),
  })

export type RegisterWithKeyFormValues = z.infer<typeof registerWithKeySchema>

/* ------------------------------------------------------------------ */
/* Сброс пароля                                                         */
/* ------------------------------------------------------------------ */

export const forgotPasswordSchema = z.object({
  email: emailField,
})

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

/**
 * Установка пароля по ссылке из письма.
 *
 * Поле называется `newPassword` — именно так в `PasswordResetConfirmDto`.
 * `password` дал бы 400 сразу по двум причинам: обязательное поле не пришло,
 * а лишнее пришло.
 *
 * `twoFactorCode` необязателен и появляется в форме только после ответа
 * `TWO_FACTOR_REQUIRED`: у аккаунта без второго фактора пустое поле кода
 * лишь пугает, а отправка пустой строки провалила бы `@Length(6, 20)`.
 */
export const resetPasswordSchema = z
  .object({
    newPassword: passwordField,
    passwordConfirm: z.string(),
    twoFactorCode: z.string().optional(),
  })
  .refine((values) => values.newPassword === values.passwordConfirm, {
    path: ['passwordConfirm'],
    error: () => t('auth.validation.passwordConfirm.mismatch'),
  })

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

/**
 * Разбор `?token=` в адресе письма.
 *
 * Формат токена НЕ проверяется. Фактически это 43 символа base64url, сервер
 * принимает до 512 (`VerifyEmailDto`), но жёсткая проверка на клиенте
 * сломала бы все разосланные письма при первом же изменении генератора
 * токенов на сервере, а выигрыша не даёт: подделать токен всё равно нельзя,
 * решение принимает сервер.
 *
 * `catch(undefined)` обязателен: адрес из письма приходит от почтового
 * клиента, и мусор в поиске не должен ронять маршрут ошибкой разбора —
 * экран сам объяснит, что ссылка неполная.
 */
export const linkTokenSearchSchema = z.object({
  token: z.string().optional().catch(undefined),
})
