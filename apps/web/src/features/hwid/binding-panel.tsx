import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, MonitorSmartphone, RotateCw } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { useSession } from '@/lib/auth/session'
import { useT, type TFunction } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatRelative } from '@/lib/format/date'
import {
  HWID_RESET_PERMISSION,
  hwidStatusQueryOptions,
  type HwidStatus,
} from './api'
import { HwidResetButton } from './reset-button'

/**
 * Блок «Привязка к устройству» (план п. 3.11).
 *
 * Главное, что человек обязан отсюда понять: лицензия закрепляется за ПЕРВЫМ
 * устройством, на котором запустили лаунчер, и на другом железе продукт не
 * запустится — сервер ответит отказом по несовпадению устройства. Пока это не
 * сказано словами, каждое такое совпадение выглядит как «лицензия сломалась».
 *
 * Состав HWID не показываем: сервер его и не отдаёт (ТЗ п.7).
 */
type HwidBindingPanelProps = {
  licenseId: string
}

export function HwidBindingPanel({ licenseId }: HwidBindingPanelProps) {
  const { can } = useSession()
  const query = useQuery(hwidStatusQueryOptions(licenseId))
  const t = useT()

  if (query.isPending) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-5 w-56' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-9 w-48' />
      </div>
    )
  }

  if (query.error)
    return <BindingError error={query.error} onRetry={query.refetch} t={t} />

  return (
    <div className='space-y-5'>
      <BindingSummary status={query.data} t={t} />

      <Separator />

      <div className='space-y-3'>
        <h3 className='text-sm font-medium'>{t('hwid.change.title')}</h3>
        <p className='text-sm text-muted-foreground'>
          {t('hwid.change.description')}
        </p>
        <HwidResetButton
          licenseId={licenseId}
          status={query.data}
          canReset={can(HWID_RESET_PERMISSION)}
        />
        {/* Обязательная сноска: счётчик общий (уточнение У-7 на сервере).
            Без неё человек «экономит» свои сбросы, прося поддержку, и
            обнаруживает потерю лимита постфактум. */}
        <p className='text-xs text-muted-foreground'>
          {t('hwid.change.sharedLimit')}
        </p>
      </div>
    </div>
  )
}

/** Состояние привязки полями ровно из ответа сервера. */
function BindingSummary({ status, t }: { status: HwidStatus; t: TFunction }) {
  return (
    <div className='space-y-4'>
      <div className='flex items-start gap-3'>
        <MonitorSmartphone className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
        <div className='space-y-1'>
          <p className='font-medium'>
            {status.bound
              ? t('hwid.summary.bound.title')
              : t('hwid.summary.unbound.title')}
          </p>
          <p className='text-sm text-muted-foreground'>
            {status.bound
              ? t('hwid.summary.bound.description')
              : t('hwid.summary.unbound.description')}
          </p>
        </div>
      </div>

      <dl className='grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2'>
        <Field label={t('hwid.field.boundAt')}>
          {status.boundAt ? formatDateTime(status.boundAt) : '—'}
        </Field>
        <Field label={t('hwid.field.lastSeen')}>
          {status.lastSeenAt ? (
            <span title={formatDateTime(status.lastSeenAt)}>
              {formatRelative(status.lastSeenAt)}
            </span>
          ) : (
            '—'
          )}
        </Field>
        <Field label={t('hwid.field.resetsUsed')}>
          {t('hwid.field.resetsUsed.value', {
            used: status.resetsUsed,
            total: status.resetsUsed + status.resetsLeft,
          })}
        </Field>
        <Field label={t('hwid.field.resetsLeft')}>
          <span
            className={
              status.resetsLeft === 0 ? 'font-medium text-destructive' : undefined
            }
          >
            {status.resetsLeft}
          </span>
        </Field>
        <Field label={t('hwid.field.lastReset')}>
          {status.lastResetAt
            ? formatDateTime(status.lastResetAt)
            : t('hwid.field.lastReset.never')}
        </Field>
        <Field label={t('hwid.field.nextReset')}>
          {status.nextResetAvailableAt
            ? formatDateTime(status.nextResetAvailableAt)
            : t('hwid.field.nextReset.now')}
        </Field>
      </dl>

      {/* Состав HWID недоступен принципиально — говорим об этом прямо,
          иначе отсутствие «идентификатора устройства» читается как недоделка. */}
      <p className='text-xs text-muted-foreground'>{t('hwid.summary.hidden')}</p>
    </div>
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
      <dt className='text-muted-foreground'>{label}:</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * Отказы отдельного маршрута привязки.
 *
 * Разбираем по коду: `LICENSE_REVOKED` приходит с 409 из `loadLicense`
 * (hwid.service.ts) и означает не сбой, а то, что у отозванной лицензии
 * привязки больше нет и не будет.
 */
function BindingError({
  error,
  onRetry,
  t,
}: {
  error: unknown
  onRetry: () => void
  t: TFunction
}) {
  const code = error instanceof ApiError ? error.code : null

  if (code === 'LICENSE_REVOKED') {
    return (
      <Alert>
        <AlertTriangle className='size-4' />
        <AlertTitle>{t('hwid.error.revoked.title')}</AlertTitle>
        <AlertDescription>{t('hwid.error.revoked.description')}</AlertDescription>
      </Alert>
    )
  }

  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') {
    return (
      <Alert>
        <AlertTriangle className='size-4' />
        <AlertTitle>{t('hwid.error.unavailable.title')}</AlertTitle>
        <AlertDescription>
          {t('hwid.error.unavailable.description')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-3'>
      <ApiErrorText error={error} fallback={t('hwid.error.load')} />
      <Button variant='outline' size='sm' onClick={onRetry}>
        <RotateCw className='size-4' />
        {t('common.action.retry')}
      </Button>
    </div>
  )
}
