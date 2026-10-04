import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { messageForCode } from '@/lib/api/error-codes'
import { useT, type TFunction } from '@/lib/i18n'
import { linkTokenSearchSchema } from '@/features/auth/schemas'
import { verifyEmail } from '@/features/auth/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/**
 * Подтверждение адреса по ссылке из письма.
 *
 * АДРЕС МАРШРУТА МЕНЯТЬ НЕЛЬЗЯ. Он уже разослан пользователям: письмо
 * подставляет `${frontendUrl}/verify-email?token=...` (`auth.service.ts:155`).
 * Пока этого файла не было, каждая ссылка из письма упиралась в 404, и
 * регистрация физически не завершалась.
 */
export const Route = createFileRoute('/_public/verify-email')({
  validateSearch: linkTokenSearchSchema,
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { token } = Route.useSearch()
  const t = useT()

  /**
   * Запрос, а не мутация в `useEffect`, ровно по одной причине: в режиме
   * разработки React монтирует компонент дважды, и «отправить при монтировании»
   * дало бы ДВА `POST` с одним токеном. Второй получил бы `TOKEN_INVALID`
   * (токен одноразовый), и успешное подтверждение выглядело бы как ошибка.
   *
   * TanStack Query склеивает одинаковые ключи: второй монтаж получает тот же
   * промис, а результат остаётся в кеше и не перезапрашивается.
   */
  const query = useQuery({
    queryKey: ['auth', 'verify-email', token],
    queryFn: () => verifyEmail(token!),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  // Токена в адресе нет — почтовый клиент обрезал ссылку или её скопировали
  // не целиком. Отличать этот случай от недействительного токена важно:
  // действия у человека разные.
  if (!token) {
    return (
      <ResultCard
        icon={<MailWarning className='size-6 text-destructive' />}
        title={t('verifyEmail.noToken.title')}
        description={t('verifyEmail.noToken.description')}
      >
        <p className='text-sm text-muted-foreground'>
          {/* Хвост `?token=…` остаётся в разметке: это образец адреса,
              одинаковый на любом языке и набранный моноширинным. */}
          {t('verifyEmail.noToken.body')}{' '}
          <code className='text-xs'>?token=…</code>.
        </p>
        <BackupPath t={t} />
      </ResultCard>
    )
  }

  if (query.isPending) {
    return (
      <ResultCard
        icon={<Loader2 className='size-6 animate-spin text-muted-foreground' />}
        title={t('verifyEmail.pending.title')}
        description={t('verifyEmail.pending.description')}
      />
    )
  }

  if (query.isSuccess) {
    return (
      <ResultCard
        icon={<CheckCircle2 className='size-6 text-primary' />}
        title={t('verifyEmail.done.title')}
        description={t('verifyEmail.done.description')}
        footer={
          <Button asChild className='w-full'>
            <Link to='/login'>{t('auth.action.signIn')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <VerifyFailure
      error={query.error}
      onRetry={() => void query.refetch()}
      t={t}
    />
  )
}

/** Разбор отказа. Ветвление строго по `code`, как требует контракт. */
function VerifyFailure({
  error,
  onRetry,
  t,
}: {
  error: unknown
  onRetry: () => void
  t: TFunction
}) {
  const apiError = error instanceof ApiError ? error : null

  // Ссылка мертва: истекла (живёт сутки), уже использована, либо аккаунт
  // заблокирован — сервер намеренно отвечает одинаково во всех трёх случаях,
  // чтобы не подтверждать существование аккаунта.
  if (apiError?.code === 'TOKEN_INVALID') {
    return (
      <ResultCard
        icon={<MailWarning className='size-6 text-destructive' />}
        title={t('verifyEmail.linkDead.title')}
        description={t('verifyEmail.linkDead.description')}
      >
        <p className='text-sm text-muted-foreground'>
          {t('verifyEmail.linkDead.body')}
        </p>
        <BackupPath t={t} />
      </ResultCard>
    )
  }

  // Сервер жив, но перегружен или лежит — токен при этом цел, повтор осмыслен.
  const recoverable =
    apiError === null ||
    apiError.isNetworkError ||
    apiError.status >= 500 ||
    apiError.status === 429

  return (
    <ResultCard
      icon={<MailWarning className='size-6 text-destructive' />}
      title={t('verifyEmail.error.title')}
      description={
        messageForCode(apiError?.code ?? 'UNKNOWN_ERROR', apiError?.message)
      }
      footer={
        recoverable ? (
          <Button className='w-full' onClick={onRetry}>
            {t('common.action.retry')}
          </Button>
        ) : undefined
      }
    >
      {recoverable && (
        <p className='text-sm text-muted-foreground'>
          {t('verifyEmail.error.recoverable')}
        </p>
      )}
      {!recoverable && <BackupPath t={t} />}
    </ResultCard>
  )
}

/**
 * Запасной путь для того, у кого ссылка не сработала.
 *
 * Маршрута «отправить письмо повторно» на сервере НЕТ (см. раздел 4 плана),
 * поэтому единственный выход — восстановление пароля: при сбросе сервер
 * заодно переводит аккаунт из PENDING_VERIFICATION в ACTIVE и проставляет
 * `emailVerifiedAt` (`auth.service.ts:624-626`). То есть письмо сброса
 * подтверждает адрес не хуже письма регистрации.
 */
function BackupPath({ t }: { t: TFunction }) {
  return (
    <Alert>
      <AlertDescription>
        <p>{t('verifyEmail.backup.body')}</p>
        <div className='flex flex-wrap gap-3 pt-1'>
          <Link
            to='/login'
            className='text-sm font-medium text-primary underline-offset-4 hover:underline'
          >
            {t('auth.action.signIn')}
          </Link>
          <Link
            to='/forgot-password'
            className='text-sm font-medium text-primary underline-offset-4 hover:underline'
          >
            {t('verifyEmail.backup.action.recover')}
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function ResultCard({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon: ReactNode
  title: string
  description: string
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>{icon}</div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children && <CardContent className='space-y-3'>{children}</CardContent>}
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  )
}
