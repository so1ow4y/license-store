import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, RotateCw } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { useSession } from '@/lib/auth/session'
import { useT, type TFunction } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  fetchLicenseKey,
  licenseQueryOptions,
  planDurationText,
  type LicenseDetail,
} from '@/features/licenses/api'
import { CopyButton } from '@/components/copy-button'
import { daysUntil, formatDate, formatDateTime } from '@/lib/format/date'
import {
  licenseStatusHint,
  LicenseStatusBadge,
} from '@/features/licenses/status-badge'
import {
  HWID_HISTORY_PERMISSION,
  hwidHistoryQueryOptions,
} from '@/features/hwid/api'
import { HwidBindingPanel } from '@/features/hwid/binding-panel'
import { HwidHistoryTable } from '@/features/hwid/history-table'

/**
 * Карточка лицензии (план п. 3.10–3.12).
 *
 * `GET /licenses/:id` отдаёт реквизиты и последние 20 записей истории
 * привязок. Состояние привязки берётся отдельным запросом
 * `GET /licenses/:id/hwid` — после сброса перечитать нужно именно его.
 */
export const Route = createFileRoute('/_app/licenses/$licenseId')({
  component: LicenseDetailPage,
})

function LicenseDetailPage() {
  const { licenseId } = Route.useParams()
  const query = useQuery(licenseQueryOptions(licenseId))
  const t = useT()

  return (
    <div className='mx-auto w-full max-w-4xl space-y-6'>
      <Link
        to='/'
        className='inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'
      >
        <ArrowLeft className='size-4' />
        {t('licenses.detail.back')}
      </Link>

      {query.isPending && (
        <div className='space-y-4'>
          <Skeleton className='h-9 w-64' />
          <Skeleton className='h-56 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      )}

      {query.isError && (
        <LicenseLoadError error={query.error} onRetry={query.refetch} t={t} />
      )}

      {query.isSuccess && (
        <LicenseDetailView
          license={query.data}
          licenseId={licenseId}
          t={t}
        />
      )}
    </div>
  )
}

function LicenseDetailView({
  license,
  licenseId,
  t,
}: {
  license: LicenseDetail
  licenseId: string
  // `t` приходит параметром от экрана: подписка на язык одна на страницу.
  t: TFunction
}) {
  const { can } = useSession()
  const canReadFullHistory = can(HWID_HISTORY_PERMISSION)

  /**
   * Отдельный маршрут истории закрыт правом `hwid.history.read`, которого у
   * обычного пользователя нет. Но последние 20 записей приходят внутри самой
   * лицензии — значит вкладку можно показать всем, а расширенную выборку
   * (до 100 записей) запрашивать только тем, кому она разрешена. Запрос без
   * права дал бы гарантированный 403 на каждом открытии.
   */
  const historyQuery = useQuery(
    hwidHistoryQueryOptions(licenseId, canReadFullHistory)
  )

  const entries = canReadFullHistory
    ? (historyQuery.data ?? [])
    : license.hwidHistory

  const remaining = daysUntil(license.expiresAt)

  return (
    <>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {license.product.name}
          </h1>
          <p className='text-sm text-muted-foreground'>
            {license.plan.name} · {planDurationText(license.plan.durationDays)}
          </p>
        </div>
        <LicenseStatusBadge status={license.status} className='mt-1' />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>
            {t('licenses.detail.credentials.title')}
          </CardTitle>
          <CardDescription>
            {licenseStatusHint(license.status)}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4 text-sm'>
          <div>
            <p className='mb-1 text-xs text-muted-foreground'>
              {t('licenses.key.label')}
            </p>
            <div className='flex items-center gap-2'>
              {/*
                Даже в карточке на экране остаётся маска. Полный ключ уходит
                прямо в буфер по кнопке и на странице не появляется вовсе:
                открытая карточка живёт в соседней вкладке часами, попадает
                в скриншоты для поддержки и в демонстрацию экрана, а ключ —
                предъявительский документ, владельцем которого становится
                тот, кто его увидел.
              */}
              <code className='min-w-0 flex-1 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-sm break-all'>
                {license.maskedKey}
              </code>
              <CopyButton
                value={() => fetchLicenseKey(license.id)}
                label={t('licenses.key.label')}
              />
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>
              {t('licenses.detail.key.hint')}
            </p>
          </div>

          <dl className='grid gap-x-6 gap-y-2 sm:grid-cols-2'>
            <Field label={t('licenses.field.product')}>
              {license.product.name}{' '}
              <span className='text-muted-foreground'>
                ({license.product.slug})
              </span>
            </Field>
            <Field label={t('licenses.field.plan')}>{license.plan.name}</Field>
            <Field label={t('licenses.field.issued')}>
              {formatDate(license.issuedAt)}
            </Field>
            <Field label={t('licenses.field.activated')}>
              {license.activatedAt
                ? formatDateTime(license.activatedAt)
                : t('licenses.detail.activated.never')}
            </Field>
            <Field label={t('licenses.field.expires')}>
              {license.status === 'PENDING'
                ? t('licenses.detail.expires.notStarted')
                : license.expiresAt
                  ? formatDate(license.expiresAt)
                  : t('licenses.plan.lifetime')}
            </Field>
            <Field label={t('licenses.field.remaining')}>
              {license.status === 'PENDING'
                ? t('licenses.detail.remaining.fullTerm')
                : license.expiresAt
                  ? remaining !== null && remaining > 0
                    ? t('licenses.detail.remaining.days', { count: remaining })
                    : t('licenses.detail.remaining.ended')
                  : t('licenses.detail.remaining.unlimited')}
            </Field>
          </dl>

          {/* Причину блокировки и отзыва пишет администратор — она приходит
              с сервера как есть, переводится только заголовок над ней. */}
          {license.status === 'BLOCKED' && license.blockedReason && (
            <Alert>
              <AlertTitle>{t('licenses.detail.blocked.title')}</AlertTitle>
              <AlertDescription>{license.blockedReason}</AlertDescription>
            </Alert>
          )}

          {license.status === 'REVOKED' && license.revokedReason && (
            <Alert>
              <AlertTitle>{t('licenses.detail.revoked.title')}</AlertTitle>
              <AlertDescription>{license.revokedReason}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>
            {t('licenses.detail.device.title')}
          </CardTitle>
          <CardDescription>
            {t('licenses.detail.device.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue='binding'>
            <TabsList>
              {/* Значение вкладки остаётся машинным: переводится подпись. */}
              <TabsTrigger value='binding'>
                {t('licenses.detail.tab.binding')}
              </TabsTrigger>
              <TabsTrigger value='history'>
                {t('licenses.detail.tab.history')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value='binding' className='pt-4'>
              <HwidBindingPanel licenseId={licenseId} />
            </TabsContent>

            <TabsContent value='history' className='space-y-3 pt-4'>
              <HwidHistoryTable
                entries={entries}
                isLoading={canReadFullHistory && historyQuery.isPending}
              />
              {!canReadFullHistory && entries.length > 0 && (
                <p className='text-xs text-muted-foreground'>
                  {t('licenses.detail.history.limited')}
                </p>
              )}
              {canReadFullHistory && historyQuery.isError && (
                <ApiErrorText
                  error={historyQuery.error}
                  fallback={t('licenses.detail.history.error')}
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-wrap items-baseline gap-x-2'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='min-w-0'>{children}</dd>
    </div>
  )
}

/**
 * Чужая лицензия отвечает 403 (licenses.service.ts), несуществующая — 404.
 * Показываем ОДИН И ТОТ ЖЕ текст: подтверждать существование чужой лицензии
 * подбором идентификаторов нельзя.
 */
function LicenseLoadError({
  error,
  onRetry,
  t,
}: {
  error: unknown
  onRetry: () => void
  t: TFunction
}) {
  // Ветвление по `code` остаётся прежним: коды — контракт, переводятся только
  // тексты вокруг них.
  const code = error instanceof ApiError ? error.code : null

  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') {
    return (
      <Alert>
        <AlertTitle>{t('licenses.detail.error.missing.title')}</AlertTitle>
        <AlertDescription className='space-y-3'>
          <p>{t('licenses.detail.error.missing.description')}</p>
          <Button asChild variant='outline' size='sm'>
            <Link to='/'>{t('licenses.detail.error.missing.action')}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-3'>
      <ApiErrorText
        error={error}
        fallback={t('licenses.detail.error.load')}
      />
      <Button variant='outline' size='sm' onClick={onRetry}>
        <RotateCw className='size-4' />
        {t('common.action.retry')}
      </Button>
    </div>
  )
}
