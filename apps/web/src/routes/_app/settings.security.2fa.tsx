import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useForm } from 'react-hook-form'
import { Check, Copy, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '@/lib/api/client'
import { useT, type TFunction } from '@/lib/i18n'
import { SESSION_QUERY_KEY, hardLogout, useSession } from '@/lib/auth/session'
import {
  type TwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  setupTwoFactor,
} from '@/features/security/api'
import { QrCode } from '@/features/security/qr-code'
import { RecoveryCodesDialog } from '@/features/security/recovery-codes-dialog'
import { ApiErrorText } from '@/components/api-error-text'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Двухфакторная аутентификация (K5, п. 3.16 плана).
 *
 * Мастер из трёх шагов: `POST /auth/2fa/setup` → QR → `POST /auth/2fa/enable`
 * → обязательный экран кодов восстановления. Разделение setup и enable — не
 * прихоть: пока код не подтверждён, второй фактор НЕ включается, и криво
 * отсканированный QR не отрезает человека от аккаунта навсегда.
 */
export const Route = createFileRoute('/_app/settings/security/2fa')({
  component: TwoFactorPage,
})

function TwoFactorPage() {
  const queryClient = useQueryClient()
  const { me, isLoading } = useSession()

  /** Не null ровно в тот единственный момент, когда коды пришли с сервера. */
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [sessionsEnded, setSessionsEnded] = useState(false)

  // Проверка стоит ПЕРЕД загрузкой намеренно: сессия уже погашена сервером,
  // и любое фоновое перечитывание `/auth/me` обнулит данные. Уступи мы ему
  // очередь — объяснение сменилось бы скелетоном, и человек так и не узнал бы,
  // почему его выкинуло.
  if (sessionsEnded) return <SessionsEndedCard />

  if (isLoading || !me) {
    return (
      <div className='max-w-xl space-y-4'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-72 w-full' />
      </div>
    )
  }

  return (
    <div className='max-w-xl space-y-6'>
      {me.twoFactorEnabled ? (
        <DisableCard onDisabled={() => setSessionsEnded(true)} />
      ) : (
        <SetupWizard hasPassword={me.hasPassword} onEnabled={setRecoveryCodes} />
      )}

      {/* Окно живёт вне ветки выше намеренно: как только `/auth/me` будет
          перечитан, ветка сменится, и вложенное окно исчезло бы вместе
          с кодами, которые сервер больше никогда не покажет. */}
      {recoveryCodes && (
        <RecoveryCodesDialog
          open
          codes={recoveryCodes}
          onConfirm={() => {
            setRecoveryCodes(null)
            // Перечитываем только сейчас: до подтверждения смена состояния
            // на «включена» перерисовала бы экран прямо под окном.
            void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Мастер подключения                                                   */
/* ------------------------------------------------------------------ */

function SetupWizard({
  hasPassword,
  onEnabled,
}: {
  hasPassword: boolean
  onEnabled: (codes: string[]) => void
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  const setupMutation = useMutation({
    mutationFn: setupTwoFactor,
    onSuccess: (data) => {
      setSetup(data)
      setCode('')
      setCodeError(null)
    },
    onError: (error) => {
      // Второй фактор успели включить в другой вкладке — данные экрана
      // устарели, перечитываем и показываем актуальное состояние.
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_ALREADY_ENABLED') {
        void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
      }
    },
  })

  const enableMutation = useMutation({
    mutationFn: enableTwoFactor,
    onSuccess: (result) => onEnabled(result.recoveryCodes),
    onError: (error) => {
      if (!(error instanceof ApiError)) return

      if (error.code === 'TWO_FACTOR_INVALID') {
        setCodeError(t('security.twoFactor.confirm.error.invalid'))
        setCode('')
      }

      // Секрет на сервере пропал (например, настройку начали заново в другой
      // вкладке). Продолжать с этим QR бессмысленно — возвращаем на шаг 1.
      if (error.code === 'TWO_FACTOR_NOT_SET_UP') {
        setSetup(null)
        setCode('')
        setCodeError(null)
      }
    },
  })

  /* --- Шаг 1 ------------------------------------------------------- */
  if (!setup) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('security.twoFactor.title')}</CardTitle>
          <CardDescription>
            {t('security.twoFactor.setup.description')}
          </CardDescription>
        </CardHeader>

        <CardContent className='space-y-4'>
          <Alert>
            <Info className='size-4' />
            <AlertTitle>
              {t('security.twoFactor.setup.requirements.title')}
            </AlertTitle>
            <AlertDescription>
              <p>{t('security.twoFactor.setup.requirements.app')}</p>
              <p>{t('security.twoFactor.setup.requirements.codes')}</p>
            </AlertDescription>
          </Alert>

          {!hasPassword && (
            <Alert>
              <ShieldAlert className='size-4' />
              <AlertTitle>
                {t('security.twoFactor.setup.needPassword.title')}
              </AlertTitle>
              <AlertDescription>
                <p>{t('security.twoFactor.setup.needPassword.description')}</p>
                <Button size='sm' variant='outline' asChild>
                  <Link to='/settings/security/password'>
                    {t('security.password.set.action.submit')}
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {setupMutation.error && <ApiErrorText error={setupMutation.error} />}

          <Button
            onClick={() => setupMutation.mutate()}
            disabled={setupMutation.isPending}
          >
            {setupMutation.isPending
              ? t('security.twoFactor.setup.action.pending')
              : t('security.twoFactor.setup.action.start')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  /* --- Шаг 2 ------------------------------------------------------- */
  const codeReady = code.length === 6

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('security.twoFactor.confirm.title')}</CardTitle>
        <CardDescription>
          {t('security.twoFactor.confirm.description')}
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-5'>
        <div className='flex flex-col items-start gap-4 sm:flex-row sm:items-center'>
          <QrCode value={setup.uri} />

          <div className='min-w-0 space-y-2'>
            <p className='text-sm font-medium'>
              {t('security.twoFactor.confirm.manual.title')}
            </p>
            <p className='text-sm text-muted-foreground'>
              {t('security.twoFactor.confirm.manual.description')}
            </p>
            <SecretRow secret={setup.secret} />
          </div>
        </div>

        <form
          className='space-y-3'
          onSubmit={(event) => {
            event.preventDefault()
            if (!codeReady || enableMutation.isPending) return
            setCodeError(null)
            enableMutation.mutate({ code })
          }}
        >
          <div className='space-y-2'>
            <p className='text-sm font-medium'>
              {t('security.twoFactor.confirm.code.label')}
            </p>
            <InputOTP
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              value={code}
              onChange={(value) => {
                setCode(value)
                // Гасим прошлую ошибку при первом же наборе: красный текст
                // рядом со свежим кодом выглядит как отказ на него.
                if (codeError) setCodeError(null)
              }}
              autoFocus
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <p className='text-sm text-muted-foreground'>
              {t('security.twoFactor.confirm.code.hint')}
            </p>
          </div>

          {codeError && (
            <p className='text-sm text-destructive' role='alert'>
              {codeError}
            </p>
          )}

          {enableMutation.error &&
            !(
              enableMutation.error instanceof ApiError &&
              enableMutation.error.code === 'TWO_FACTOR_INVALID'
            ) && <ApiErrorText error={enableMutation.error} />}

          <div className='flex flex-wrap gap-2'>
            <Button type='submit' disabled={!codeReady || enableMutation.isPending}>
              {enableMutation.isPending
                ? t('security.twoFactor.confirm.action.pending')
                : t('security.twoFactor.confirm.action.submit')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              disabled={setupMutation.isPending}
              onClick={() => setupMutation.mutate()}
              // Повторный setup выдаёт НОВЫЙ секрет и обнуляет предыдущий,
              // поэтому предупреждаем прямо на кнопке, а не после нажатия.
              title={t('security.twoFactor.confirm.action.newQr.hint')}
            >
              {t('security.twoFactor.confirm.action.newQr')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/** Секрет с кнопкой копирования: набирать base32 руками — почти гарантия опечатки. */
function SecretRow({ secret }: { secret: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function onCopy() {
    setFailed(false)
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className='space-y-1'>
      <div className='flex items-center gap-2'>
        <code className='min-w-0 rounded-md border bg-muted/50 px-2 py-1 font-mono text-xs break-all select-all'>
          {secret}
        </code>
        <Button
          type='button'
          size='icon'
          variant='outline'
          onClick={onCopy}
          title={t('security.twoFactor.secret.copy')}
        >
          {copied ? <Check className='size-4' /> : <Copy className='size-4' />}
          <span className='sr-only'>{t('security.twoFactor.secret.copy')}</span>
        </Button>
      </div>
      {failed && (
        <p className='text-sm text-destructive' role='alert'>
          {t('security.twoFactor.secret.copyFailed')}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Отключение                                                           */
/* ------------------------------------------------------------------ */

/** Границы из TwoFactorDisableDto: 6 цифр из приложения либо код восстановления. */
const DISABLE_CODE_MIN = 6
const DISABLE_CODE_MAX = 20

/**
 * Схема собирается функцией, а не константой модуля: константа посчиталась бы
 * один раз при загрузке файла и навсегда зафиксировала язык, активный в тот
 * момент, — тексты ошибок остались бы на старом языке после переключения.
 */
function buildDisableSchema(t: TFunction) {
  return z.object({
    password: z
      .string()
      .min(1, t('security.twoFactor.validation.passwordRequired')),
    // Код восстановления имеет вид A1B2C3D4-E5F6G7H8 — отсюда верхняя граница.
    code: z
      .string()
      .trim()
      .min(
        DISABLE_CODE_MIN,
        t('security.twoFactor.validation.codeTooShort', {
          min: DISABLE_CODE_MIN,
        })
      )
      .max(
        DISABLE_CODE_MAX,
        t('security.twoFactor.validation.codeTooLong', {
          max: DISABLE_CODE_MAX,
        })
      ),
  })
}

type DisableValues = z.infer<ReturnType<typeof buildDisableSchema>>

function DisableCard({ onDisabled }: { onDisabled: () => void }) {
  const t = useT()
  const queryClient = useQueryClient()

  const schema = useMemo(() => buildDisableSchema(t), [t])

  const form = useForm<DisableValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', code: '' },
  })

  const mutation = useMutation({
    mutationFn: disableTwoFactor,
    // Намеренно НЕ трогаем кеш `/auth/me`: сервер только что погасил все
    // сессии, включая текущую. Любой новый запрос вернёт 401 SESSION_REVOKED
    // и утащит человека на экран входа раньше, чем он прочтёт, что произошло.
    onSuccess: onDisabled,
    onError: (error) => {
      if (!(error instanceof ApiError)) return

      if (error.code === 'INVALID_CREDENTIALS') {
        form.setError('password', {
          message: t('security.twoFactor.error.passwordInvalid'),
        })
      }

      if (error.code === 'TWO_FACTOR_INVALID') {
        form.setError('code', {
          message: t('security.twoFactor.error.codeInvalid'),
        })
      }

      // Второй фактор уже сняли где-то ещё: показывать форму отключения
      // дальше незачем, перечитываем состояние.
      if (error.code === 'TWO_FACTOR_NOT_SET_UP') {
        void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
      }
    },
  })

  const handledByField =
    mutation.error instanceof ApiError &&
    (mutation.error.code === 'INVALID_CREDENTIALS' ||
      mutation.error.code === 'TWO_FACTOR_INVALID')

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          {t('security.twoFactor.title')}
          <Badge variant='default'>
            <ShieldCheck className='size-3' />
            {t('security.twoFactor.state.on')}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t('security.twoFactor.disable.description')}
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-4'>
        <Alert variant='destructive'>
          <ShieldAlert className='size-4' />
          <AlertTitle>{t('security.twoFactor.disable.notice.title')}</AlertTitle>
          <AlertDescription>
            <p>{t('security.twoFactor.disable.notice.sessions')}</p>
            <p>{t('security.twoFactor.disable.notice.codes')}</p>
          </AlertDescription>
        </Alert>

        <Form {...form}>
          <form
            className='space-y-4'
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({ password: values.password, code: values.code })
            )}
          >
            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('security.password.field.password.label')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='current-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('security.twoFactor.field.code.label')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      autoComplete='one-time-code'
                      placeholder='123456'
                      className='font-mono'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('security.twoFactor.field.code.hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mutation.error && !handledByField && (
              <ApiErrorText error={mutation.error} />
            )}

            <Button
              type='submit'
              variant='destructive'
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? t('security.twoFactor.disable.action.pending')
                : t('security.twoFactor.disable.action.submit')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Итог отключения                                                      */
/* ------------------------------------------------------------------ */

/** Сколько секунд дать на прочтение, прежде чем увести на вход. */
const LOGOUT_DELAY_SECONDS = 10

/**
 * Терминальный экран после отключения второго фактора.
 *
 * Сессия уже мертва на сервере, работать в кабинете нечем. Уходим не мгновенно
 * только затем, чтобы человек успел прочитать, почему его выкидывает — иначе
 * внезапный экран входа читается как поломка.
 */
function SessionsEndedCard() {
  const t = useT()
  const [seconds, setSeconds] = useState(LOGOUT_DELAY_SECONDS)

  useEffect(() => {
    if (seconds <= 0) {
      hardLogout('revoked')
      return
    }
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])

  return (
    <Card className='max-w-xl'>
      <CardHeader>
        <CardTitle>{t('security.twoFactor.disabled.title')}</CardTitle>
        <CardDescription>
          {t('security.twoFactor.disabled.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-sm text-muted-foreground'>
          {t('security.twoFactor.disabled.countdown', { count: seconds })}
        </p>
        <Button onClick={() => hardLogout('revoked')}>
          {t('security.twoFactor.disabled.action.signIn')}
        </Button>
      </CardContent>
    </Card>
  )
}
