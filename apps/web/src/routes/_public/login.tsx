import { useEffect, useState, useSyncExternalStore } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Loader2, LogIn, ShieldCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '@/lib/api/client'
import { messageForCode } from '@/lib/api/error-codes'
import { useT, type TFunction } from '@/lib/i18n'
import {
  acceptSession,
  isTwoFactorChallenge,
  login as loginRequest,
  verifyTwoFactor,
} from '@/features/auth/api'
import {
  MAX_TWO_FACTOR_ATTEMPTS,
  clearChallenge,
  consumeAttempt,
  getChallengeSnapshot,
  setChallenge,
  subscribeChallenge,
} from '@/features/auth/challenge-store'
import {
  loginSchema,
  twoFactorSchema,
  type LoginFormValues,
  type TwoFactorFormValues,
} from '@/features/auth/schemas'
import { ApiErrorText } from '@/components/api-error-text'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Separator } from '@/components/ui/separator'

/**
 * Схема поиска задана каркасом: на неё типизированно ссылаются
 * `_app.beforeLoad` и `hardLogout()`. МЕНЯТЬ НЕЛЬЗЯ.
 */
const loginSearchSchema = z.object({
  /** Куда вернуть после входа. */
  redirect: z.string().optional(),
  /** Почему пользователь здесь оказался: expired | reused | revoked | forbidden. */
  reason: z.string().optional(),
})

export const Route = createFileRoute('/_public/login')({
  validateSearch: loginSearchSchema,
  component: LoginPage,
})

/**
 * Причина выхода в человеческом виде.
 *
 * Функция, а не константа модуля. Раньше здесь был объект, и он считался ОДИН
 * РАЗ при загрузке файла — то есть навсегда фиксировал язык, активный в тот
 * момент. После переключения языка тексты остались бы старыми, причём именно
 * на экране входа, куда человека выкинуло не по своей воле.
 */
function reasonText(reason: string): string | null {
  switch (reason) {
    case 'expired':
      return messageForCode('TOKEN_EXPIRED')
    case 'reused':
      return messageForCode('TOKEN_REUSED')
    case 'revoked':
      return messageForCode('SESSION_REVOKED')
    case 'forbidden':
      return messageForCode('FORBIDDEN')
    default:
      return null
  }
}

/**
 * Куда вернуть после входа.
 *
 * `redirect` приходит из адресной строки, то есть управляется кем угодно, кто
 * пришлёт ссылку. Пускаем только относительные пути: `//evil.example` браузер
 * считает адресом с другим хостом, и без этой проверки экран входа стал бы
 * готовым инструментом увода пользователя на чужой сайт сразу после ввода
 * пароля.
 */
function safeRedirect(target: string | undefined): string {
  if (!target) return '/'
  if (!target.startsWith('/')) return '/'
  if (target.startsWith('//')) return '/'
  return target
}

function LoginPage() {
  const search = Route.useSearch()
  const router = useRouter()

  // Challenge живёт в памяти модуля: см. комментарий в challenge-store.ts.
  const challenge = useSyncExternalStore(
    subscribeChallenge,
    getChallengeSnapshot,
    () => null
  )

  /** Сообщение о том, почему шаг второго фактора прервался. */
  const [challengeNotice, setChallengeNotice] = useState<string | null>(null)

  /** Общий финал обеих веток: сессия принята, уходим в кабинет. */
  const finish = () => {
    clearChallenge()
    // `history.replace`, а не `navigate({to})`: адрес возврата — произвольная
    // строка, типы маршрутов её не знают. Экран входа при этом не должен
    // остаться в истории, иначе «назад» вернёт на форму уже вошедшего.
    router.history.replace(safeRedirect(search.redirect))
  }

  if (challenge) {
    return (
      <TwoFactorStep
        challengeToken={challenge.challengeToken}
        expiresAt={challenge.expiresAt}
        attemptsLeft={challenge.attemptsLeft}
        onSuccess={finish}
        onReset={(notice) => {
          clearChallenge()
          setChallengeNotice(notice)
        }}
      />
    )
  }

  return (
    <PasswordStep
      reason={search.reason}
      notice={challengeNotice}
      onChallenge={(token, expiresIn, loginValue) => {
        setChallengeNotice(null)
        setChallenge({
          challengeToken: token,
          expiresIn,
          login: loginValue,
        })
      }}
      onSuccess={finish}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Шаг 1 — логин и пароль                                               */
/* ------------------------------------------------------------------ */

function PasswordStep({
  reason,
  notice,
  onChallenge,
  onSuccess,
}: {
  reason?: string
  notice: string | null
  onChallenge: (token: string, expiresIn: number, login: string) => void
  onSuccess: () => void
}) {
  const t = useT()
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: '', password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) => loginRequest(values),
    onSuccess: (result, values) => {
      if (isTwoFactorChallenge(result)) {
        onChallenge(result.challengeToken, result.expiresIn, values.login)
        return
      }
      acceptSession(result)
      onSuccess()
    },
  })

  const apiError = mutation.error instanceof ApiError ? mutation.error : null

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          <LogIn className='size-6 text-muted-foreground' />
        </div>
        {/* Подзаголовок убран по решению владельца: подпись поля и так
            говорит «Login or email», и повторять это отдельной строкой
            значит объяснять очевидное. */}
        <CardTitle>{t('login.title')}</CardTitle>
      </CardHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <CardContent className='space-y-4'>
            {notice && (
              <Alert>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}

            {reason && !notice && (
              <Alert>
                <AlertDescription>
                  {reasonText(reason) ?? t('login.reason.fallback')}
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name='login'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('login.field.login.label')}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete='username'
                      autoFocus
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between'>
                    <FormLabel>{t('login.field.password.label')}</FormLabel>
                    <Link
                      to='/forgot-password'
                      className='text-sm text-muted-foreground underline-offset-4 hover:underline'
                    >
                      {t('login.action.forgotPassword')}
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      autoComplete='current-password'
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <LoginFailure error={apiError} t={t} />
          </CardContent>

          <CardFooter className='flex-col gap-4 pt-6'>
            <Button
              type='submit'
              className='w-full'
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className='animate-spin' />}
              {t('login.action.submit')}
            </Button>

            <Separator />

            <div className='flex w-full flex-col items-center gap-2 text-sm'>
              <Link
                to='/register'
                className='font-medium text-primary underline-offset-4 hover:underline'
              >
                {t('login.action.register')}
              </Link>
              <Link
                to='/register/key'
                className='text-muted-foreground underline-offset-4 hover:underline'
              >
                {t('login.action.registerWithKey')}
              </Link>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  )
}

/**
 * Разбор отказа входа.
 *
 * `EMAIL_NOT_VERIFIED` и `ACCOUNT_BLOCKED` — не «неверный пароль»: пароль как
 * раз верен, и человеку нужно сказать другое. `INVALID_CREDENTIALS` наоборот
 * намеренно не уточняет, какая половина неверна.
 */
function LoginFailure({
  error,
  t,
}: {
  error: ApiError | null
  t: TFunction
}) {
  if (!error) return null

  if (error.code === 'EMAIL_NOT_VERIFIED') {
    return (
      <Alert>
        <AlertTitle>{t('login.error.emailNotVerified.title')}</AlertTitle>
        <AlertDescription>
          <p>{t('login.error.emailNotVerified.body')}</p>
          <p>{t('login.error.emailNotVerified.resend')}</p>
          <Link
            to='/forgot-password'
            className='font-medium text-primary underline-offset-4 hover:underline'
          >
            {t('login.error.emailNotVerified.action')}
          </Link>
        </AlertDescription>
      </Alert>
    )
  }

  if (error.code === 'ACCOUNT_BLOCKED') {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('login.error.accountBlocked.title')}</AlertTitle>
        <AlertDescription>
          {t('login.error.accountBlocked.body')}
        </AlertDescription>
      </Alert>
    )
  }

  if (error.status === 429) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('login.error.rateLimited.title')}</AlertTitle>
        <AlertDescription>{t('login.error.rateLimited.body')}</AlertDescription>
      </Alert>
    )
  }

  return <ApiErrorText error={error} />
}

/* ------------------------------------------------------------------ */
/* Шаг 2 — второй фактор                                                */
/* ------------------------------------------------------------------ */

/** Секунды до момента `deadline`, обновляются раз в секунду. */
function useSecondsLeft(deadline: number): number {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  )

  useEffect(() => {
    const tick = () =>
      setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [deadline])

  return left
}

function formatLeft(seconds: number): string {
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

function TwoFactorStep({
  challengeToken,
  expiresAt,
  attemptsLeft,
  onSuccess,
  onReset,
}: {
  challengeToken: string
  expiresAt: number
  attemptsLeft: number
  onSuccess: () => void
  onReset: (notice: string) => void
}) {
  /**
   * Код восстановления вводится в обычное поле, а не в ячейки: он не
   * шестизначный и не цифровой (вид `A1B2C3D4-E5F6G7H8`), в ячейки не влезет.
   */
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const secondsLeft = useSecondsLeft(expiresAt)
  const t = useT()

  const form = useForm<TwoFactorFormValues>({
    resolver: zodResolver(twoFactorSchema),
    defaultValues: { code: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: TwoFactorFormValues) =>
      verifyTwoFactor({ challengeToken, code: values.code }),
    onSuccess: (result) => {
      acceptSession(result)
      onSuccess()
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return

      // Обе ветки означают одно: challenge мёртв, вводить код больше некуда.
      // Возвращаем к паролю, объясняя разницу — иначе человек будет думать,
      // что ошибся кодом, и потратит ещё несколько попыток.
      if (error.code === 'TWO_FACTOR_ATTEMPTS_EXCEEDED') {
        onReset(t('login.twoFactor.notice.attemptsExceeded'))
        return
      }
      if (error.code === 'CHALLENGE_INVALID') {
        onReset(t('login.twoFactor.notice.challengeExpired'))
        return
      }

      if (error.code === 'TWO_FACTOR_INVALID') {
        consumeAttempt()
        form.setValue('code', '')
        form.setFocus('code')
      }
    },
  })

  // Таймер догорел: сервер уже не примет этот challenge. Не ждём, пока человек
  // введёт код и получит отказ, — возвращаем к паролю сразу.
  useEffect(() => {
    if (secondsLeft === 0) {
      onReset(t('login.twoFactor.notice.expired'))
    }
  }, [secondsLeft, onReset, t])

  const submit = form.handleSubmit((values) => mutation.mutate(values))
  const apiError = mutation.error instanceof ApiError ? mutation.error : null
  const showError =
    apiError !== null &&
    apiError.code !== 'TWO_FACTOR_ATTEMPTS_EXCEEDED' &&
    apiError.code !== 'CHALLENGE_INVALID'

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          <ShieldCheck className='size-6 text-muted-foreground' />
        </div>
        <CardTitle>{t('login.twoFactor.title')}</CardTitle>
        <CardDescription>{t('login.twoFactor.description')}</CardDescription>
      </CardHeader>

      <Form {...form}>
        <form onSubmit={submit} noValidate>
          <CardContent className='space-y-4'>
            <FormField
              control={form.control}
              name='code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {useRecoveryCode
                      ? t('login.twoFactor.field.recovery.label')
                      : t('login.twoFactor.field.app.label')}
                  </FormLabel>
                  <FormControl>
                    {useRecoveryCode ? (
                      <Input
                        autoComplete='one-time-code'
                        autoFocus
                        placeholder='A1B2C3D4-E5F6G7H8'
                        disabled={mutation.isPending}
                        {...field}
                      />
                    ) : (
                      <InputOTP
                        maxLength={6}
                        autoFocus
                        disabled={mutation.isPending}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        // Шесть цифр набраны — отправляем сами. Лишнее нажатие
                        // кнопки на шаге, где вариантов действия нет, только
                        // тормозит вход.
                        //
                        // Отправляем значение из аргумента, а не из состояния
                        // формы: onComplete срабатывает в том же такте, что и
                        // onChange, и читать состояние здесь — гонка, которая
                        // отправит пятизначный код и потратит попытку.
                        onComplete={(value: string) => {
                          if (!mutation.isPending) mutation.mutate({ code: value })
                        }}
                      >
                        <InputOTPGroup>
                          {[0, 1, 2, 3, 4, 5].map((index) => (
                            <InputOTPSlot key={index} index={index} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    )}
                  </FormControl>
                  <FormDescription>
                    {/* Три числа в одной фразе — ровно тот случай, ради
                        которого нужны подстановки: порядок слов вокруг них
                        в другом языке свой. */}
                    {t('login.twoFactor.hint', {
                      left: attemptsLeft,
                      max: MAX_TWO_FACTOR_ATTEMPTS,
                      time: formatLeft(secondsLeft),
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showError && <ApiErrorText error={apiError} />}

            {showError && apiError?.code === 'TWO_FACTOR_INVALID' && (
              <p className='text-sm text-muted-foreground'>
                {t('login.twoFactor.invalidHint')}
              </p>
            )}
          </CardContent>

          <CardFooter className='flex-col gap-3 pt-6'>
            <Button
              type='submit'
              className='w-full'
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className='animate-spin' />}
              {t('login.twoFactor.action.submit')}
            </Button>

            <Button
              type='button'
              variant='ghost'
              className='w-full'
              disabled={mutation.isPending}
              onClick={() => {
                setUseRecoveryCode((prev) => !prev)
                form.reset({ code: '' })
              }}
            >
              {useRecoveryCode
                ? t('login.twoFactor.action.useApp')
                : t('login.twoFactor.action.useRecovery')}
            </Button>

            <button
              type='button'
              className='text-sm text-muted-foreground underline-offset-4 hover:underline'
              onClick={() => onReset(t('login.twoFactor.notice.cancelled'))}
            >
              {t('login.twoFactor.action.backToPassword')}
            </button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  )
}
