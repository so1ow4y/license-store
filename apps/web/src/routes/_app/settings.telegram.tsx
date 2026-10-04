import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import {
  BellRing,
  ExternalLink,
  Info,
  Send,
  ShieldAlert,
  Unlink,
} from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { useT } from '@/lib/i18n'
import { formatDate, formatDateTime } from '@/lib/format/date'
import {
  TELEGRAM_LINK_QUERY_KEY,
  initTelegramLink,
  revokeTelegramLink,
  telegramLinkQueryOptions,
  type TelegramLinkInit,
} from '@/features/telegram/api'
import { ApiErrorText } from '@/components/api-error-text'
import { CopyButton } from '@/components/copy-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Подключение Telegram-бота. Привязка идёт только в направлении сайт → бот:
 * человек получает здесь одноразовый токен и нажимает Start у бота.
 *
 * ПОЧЕМУ ТОКЕН НЕ ХРАНИТСЯ. Ответ `init` держится в состоянии компонента
 * и исчезает при уходе со страницы: он живёт десять минут, он одноразовый
 * и он — предъявительский документ на аккаунт. Класть его в кеш react-query
 * значило бы оставить действующую отмычку в памяти вкладки после того, как
 * человек уже подключился.
 *
 * ПОЧЕМУ КОД ВТОРОГО ФАКТОРА СПРАШИВАЕТСЯ ЗДЕСЬ, А НЕ ЗАРАНЕЕ. Сервер решает
 * сам, нужен ли step-up: при выключенной 2FA он не нужен, при включённой —
 * обязателен. Спрашивать заранее значит показывать поле тем, у кого второго
 * фактора нет. Поэтому порядок такой: жмём «Подключить» → ловим
 * `TWO_FACTOR_REQUIRED` → показываем поле → повторяем с кодом.
 */
export const Route = createFileRoute('/_app/settings/telegram')({
  component: TelegramLinkPage,
})

function TelegramLinkPage() {
  const t = useT()
  const queryClient = useQueryClient()

  const state = useQuery(telegramLinkQueryOptions())

  /** Выпущенный код. Только в памяти компонента — см. шапку файла. */
  const [issued, setIssued] = useState<TelegramLinkInit | null>(null)
  /** Показывать ли поле кода 2FA. Ставится сервером, а не нашей догадкой. */
  const [needsTotp, setNeedsTotp] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [confirmingUnlink, setConfirmingUnlink] = useState(false)

  const init = useMutation({
    mutationFn: initTelegramLink,
    onSuccess: (result) => {
      setIssued(result)
      setNeedsTotp(false)
      setTotpCode('')
    },
    onError: (error: unknown) => {
      // Сервер сказал «нужен второй фактор» — это не ошибка, а следующий шаг.
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_REQUIRED') {
        setNeedsTotp(true)
        return
      }
      // Неверный код: поле оставляем открытым, значение чистим, чтобы
      // следующий код не дописался к предыдущему.
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_INVALID') {
        setTotpCode('')
      }
    },
  })

  const revoke = useMutation({
    mutationFn: revokeTelegramLink,
    onSuccess: () => {
      setConfirmingUnlink(false)
      setIssued(null)
      void queryClient.invalidateQueries({ queryKey: TELEGRAM_LINK_QUERY_KEY })
    },
    onError: () => setConfirmingUnlink(false),
  })

  if (state.isLoading) {
    return (
      <div className='max-w-2xl space-y-4'>
        <Skeleton className='h-8 w-56' />
        <Skeleton className='h-44 w-full' />
        <Skeleton className='h-32 w-full' />
      </div>
    )
  }

  // Рубильник бота выключен — рассказываем это прямо, а не показываем кнопку,
  // которая гарантированно ответит 503.
  const disabled =
    init.error instanceof ApiError && init.error.code === 'TELEGRAM_DISABLED'

  const linked = state.data?.linked === true

  return (
    <div className='max-w-2xl space-y-6'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>{t('telegram.title')}</h1>
        <p className='text-muted-foreground text-sm'>{t('telegram.description')}</p>
      </header>

      {state.isError && (
        <Alert variant='destructive'>
          <ShieldAlert />
          <AlertTitle>{t('telegram.state.error.title')}</AlertTitle>
          <AlertDescription>
            <ApiErrorText error={state.error} />
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Send className='size-4' />
            {linked ? t('telegram.status.linked.title') : t('telegram.status.notLinked.title')}
            {linked && state.data?.scope === 'ADMIN' && (
              <Badge variant='secondary'>{t('telegram.status.scope.admin')}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {linked
              ? t('telegram.status.linked.description')
              : t('telegram.status.notLinked.description')}
          </CardDescription>
        </CardHeader>

        {linked && state.data && (
          <CardContent className='space-y-4'>
            <dl className='grid gap-2 text-sm sm:grid-cols-[10rem_1fr]'>
              <dt className='text-muted-foreground'>{t('telegram.status.chat')}</dt>
              <dd className='font-medium'>
                {state.data.username ? `@${state.data.username}` : t('telegram.status.chat.unnamed')}
              </dd>

              <dt className='text-muted-foreground'>{t('telegram.status.linkedAt')}</dt>
              <dd>{formatDateTime(state.data.linkedAt)}</dd>

              <dt className='text-muted-foreground'>{t('telegram.status.expiresAt')}</dt>
              <dd>{formatDate(state.data.expiresAt)}</dd>
            </dl>

            {state.data.chatBlocked && (
              <Alert>
                <BellRing />
                <AlertTitle>{t('telegram.status.blocked.title')}</AlertTitle>
                <AlertDescription>{t('telegram.status.blocked.description')}</AlertDescription>
              </Alert>
            )}

            <Separator />

            <div className='flex flex-wrap items-center gap-2'>
              <Button
                variant='outline'
                onClick={() => {
                  init.reset()
                  init.mutate({})
                }}
                disabled={init.isPending}
              >
                {t('telegram.renew.action')}
              </Button>
              <Button
                variant='destructive'
                onClick={() => setConfirmingUnlink(true)}
                disabled={revoke.isPending}
              >
                <Unlink />
                {revoke.isPending ? t('telegram.unlink.action.pending') : t('telegram.unlink.action')}
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>{t('telegram.renew.description')}</p>
            {revoke.isError && <ApiErrorText error={revoke.error} />}
          </CardContent>
        )}

        {!linked && (
          <CardContent className='space-y-4'>
            <Button
              onClick={() => {
                init.reset()
                init.mutate({})
              }}
              disabled={init.isPending || disabled}
            >
              <Send />
              {init.isPending ? t('telegram.connect.action.pending') : t('telegram.connect.action')}
            </Button>
          </CardContent>
        )}
      </Card>

      {needsTotp && (
        <Card>
          <CardHeader>
            <CardTitle>{t('telegram.totp.title')}</CardTitle>
            <CardDescription>{t('telegram.totp.description')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <InputOTP
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              value={totpCode}
              onChange={setTotpCode}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>

            <Button
              onClick={() => init.mutate({ totpCode })}
              disabled={totpCode.length !== 6 || init.isPending}
            >
              {init.isPending ? t('telegram.connect.action.pending') : t('telegram.totp.submit')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/*
        Одна точка показа отказа на оба шага. `TWO_FACTOR_REQUIRED` сюда не
        доезжает по смыслу — это не отказ, а приглашение ввести код, — но
        компонент всё равно нарисовал бы его нейтрально (код в
        NEUTRAL_ERROR_CODES), а рядом с уже открытым полем это шум.
      */}
      {init.isError &&
        !(init.error instanceof ApiError && init.error.code === 'TWO_FACTOR_REQUIRED') && (
          <ApiErrorText error={init.error} />
        )}

      {issued && (
        <Card>
          <CardHeader>
            <CardTitle>{t('telegram.code.title')}</CardTitle>
            <CardDescription>
              {t('telegram.code.description', { expiresAt: formatDateTime(issued.expiresAt) })}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {/*
              Ссылка открывается в новой вкладке и с rel='noreferrer': адрес
              содержит одноразовый токен, и передавать его чужой странице
              через Referer нельзя. noopener здесь же — target='_blank' без
              него отдаёт открытой странице доступ к window.opener.
            */}
            <div className='flex flex-wrap items-center gap-2'>
              <Button asChild>
                <a href={issued.deepLink} target='_blank' rel='noopener noreferrer'>
                  <ExternalLink />
                  {t('telegram.code.open')}
                </a>
              </Button>
              <CopyButton
                value={issued.deepLink}
                label={t('telegram.code.copy')}
                withLabel
              />
              <Button
                variant='ghost'
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: TELEGRAM_LINK_QUERY_KEY })
                }}
              >
                {t('telegram.code.check')}
              </Button>
            </div>

            <Alert>
              <Info />
              <AlertTitle>{t('telegram.code.hint.title')}</AlertTitle>
              <AlertDescription>{t('telegram.code.hint.description')}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      <Alert>
        <ShieldAlert />
        <AlertTitle>{t('telegram.scope.title')}</AlertTitle>
        <AlertDescription>{t('telegram.scope.description')}</AlertDescription>
      </Alert>

      <AlertDialog open={confirmingUnlink} onOpenChange={setConfirmingUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('telegram.unlink.confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('telegram.unlink.confirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.action.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => revoke.mutate()}>
              {t('telegram.unlink.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
