import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api/client'
import { useT, type TFunction } from '@/lib/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/copy-button'
import { AdminErrorText, adminErrorMessage } from '@/features/admin/error-text'
import { formatDateTime, formatWaiting, waitingHours } from '@/lib/format/date'
import { formatAmount } from '@/lib/format/number'
import {
  isTwoFactorSetupRequired,
  TwoFactorSetupRequired,
} from '@/features/admin/two-factor-gate'
import {
  useCompletePendingDeal,
  type CompletedDeal,
  type PendingDeal,
  pendingDealsQueryOptions,
} from './api'

/** Сделка, провисевшая дольше суток, — уже жалоба в поддержку. */
const ALARM_HOURS = 24

export function PendingDealsTable() {
  const t = useT()
  const query = useQuery(pendingDealsQueryOptions())
  const complete = useCompletePendingDeal()

  /** Выданные за текущий сеанс: ключ лицензии показывается ровно один раз. */
  const [issued, setIssued] = useState<CompletedDeal[]>([])
  /** Ошибка на конкретной строке: она объясняет, что делать именно с ней. */
  const [rowError, setRowError] = useState<Record<string, unknown>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  // Второй фактор требуется и на чтение списка, и на выдачу: гейт на сервере
  // общий для всех административных действий.
  if (
    isTwoFactorSetupRequired(query.error) ||
    isTwoFactorSetupRequired(complete.error)
  ) {
    return <TwoFactorSetupRequired />
  }

  function onComplete(deal: PendingDeal) {
    setBusyId(deal.id)
    setRowError((prev) => {
      const next = { ...prev }
      delete next[deal.id]
      return next
    })

    complete.mutate(deal.id, {
      onSuccess: (result) => {
        setIssued((prev) => [result, ...prev])
        toast.success(
          t('admin.pending.toast.issued', { order: result.orderNumber })
        )
      },
      onError: (error) => {
        setRowError((prev) => ({ ...prev, [deal.id]: error }))
        // ALREADY_REDEEMED — не провал операции, а гонка: кто-то выдал раньше.
        // Строка исчезнет сама, список уже перечитывается в onSettled.
        if (error instanceof ApiError && error.code === 'ALREADY_REDEEMED') {
          toast.info(adminErrorMessage(error))
        }
      },
      onSettled: () => setBusyId(null),
    })
  }

  if (query.isPending) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className='space-y-3'>
        <AdminErrorText error={query.error} />
        <Button variant='outline' size='sm' onClick={() => void query.refetch()}>
          <RefreshCw className='size-4' />
          {t('common.action.retry')}
        </Button>
      </div>
    )
  }

  const deals = query.data ?? []

  return (
    <div className='space-y-4'>
      {issued.length > 0 && <IssuedPanel issued={issued} t={t} />}

      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm text-muted-foreground'>
          {deals.length === 0
            ? t('admin.pending.summary.empty')
            : t('admin.pending.summary.count', { count: deals.length })}
        </p>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className='size-4' />
          {t('common.action.refresh')}
        </Button>
      </div>

      {deals.length === 0 ? (
        <Alert>
          <CheckCircle2 className='size-4' />
          <AlertTitle>{t('admin.pending.empty.title')}</AlertTitle>
          <AlertDescription>
            {t('admin.pending.empty.description')}
          </AlertDescription>
        </Alert>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.pending.column.waiting')}</TableHead>
                <TableHead>{t('admin.pending.column.code')}</TableHead>
                <TableHead>{t('admin.pending.column.invoice')}</TableHead>
                <TableHead>{t('admin.pending.column.product')}</TableHead>
                <TableHead>{t('admin.pending.column.amount')}</TableHead>
                <TableHead>{t('admin.pending.column.buyer')}</TableHead>
                <TableHead>{t('admin.pending.column.paidAt')}</TableHead>
                <TableHead className='text-right'>
                  {t('admin.pending.column.action')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((deal) => {
                const error = rowError[deal.id]
                const overdue = waitingHours(deal.createdAt) >= ALARM_HOURS

                return (
                  <Fragment key={deal.id}>
                    <TableRow className={error ? 'border-b-0' : ''}>
                      <TableCell>
                        <Badge variant={overdue ? 'destructive' : 'secondary'}>
                          {formatWaiting(deal.createdAt)}
                        </Badge>
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        <span className='inline-flex items-center gap-1'>
                          {deal.uniqueCode}
                          <CopyButton
                            value={deal.uniqueCode}
                            label={t('admin.pending.copy.code')}
                          />
                        </span>
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {deal.invId ?? '—'}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {deal.digisellerProductId ?? '—'}
                      </TableCell>
                      <TableCell className='whitespace-nowrap'>
                        {formatAmount(deal.amount, deal.currency)}
                      </TableCell>
                      <TableCell className='max-w-56 truncate'>
                        {deal.buyerEmail ?? '—'}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-muted-foreground'>
                        {formatDateTime(deal.createdAt)}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          size='sm'
                          onClick={() => onComplete(deal)}
                          disabled={busyId === deal.id}
                        >
                          {busyId === deal.id
                            ? t('admin.pending.action.issuing')
                            : t('admin.pending.action.issue')}
                        </Button>
                      </TableCell>
                    </TableRow>

                    {/* Ошибка живёт под своей строкой: администратору важно,
                        с какой именно сделкой не получилось и что делать. */}
                    {error != null && (
                      <TableRow>
                        <TableCell colSpan={8} className='pt-0'>
                          <RowFailure deal={deal} error={error} t={t} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/**
 * Разбор отказа по конкретной сделке.
 *
 * Каждый код — отдельный сценарий действий, поэтому общий текст ошибки здесь
 * недостаточен: «не привязан тариф» чинится админом за минуту, «покупатель не
 * определён» не чинится вовсе и требует ожидания.
 */
function RowFailure({
  deal,
  error,
  t,
}: {
  deal: PendingDeal
  error: unknown
  t: TFunction
}) {
  const code = error instanceof ApiError ? error.code : ''

  return (
    <div className='rounded-md bg-muted/50 p-3'>
      <AdminErrorText error={error} />

      {/* Номер товара и код покупки подставляются в текст, а не склеиваются
          из кусков разметки: в другом языке они стоят в другом месте фразы,
          и разрезанное на части предложение собралось бы задом наперёд. */}
      {code === 'PRODUCT_NOT_MAPPED' && (
        <p className='mt-2 text-sm text-muted-foreground'>
          {t('admin.pending.failure.productNotMapped', {
            product: deal.digisellerProductId ?? '—',
          })}
        </p>
      )}

      {code === 'NO_CLAIMANT' && (
        <p className='mt-2 text-sm text-muted-foreground'>
          {t('admin.pending.failure.noClaimant', { code: deal.uniqueCode })}
        </p>
      )}
    </div>
  )
}

/** Выданные лицензии за текущий сеанс: ключ надо успеть передать покупателю. */
function IssuedPanel({
  issued,
  t,
}: {
  issued: CompletedDeal[]
  t: TFunction
}) {
  return (
    <Alert>
      <CheckCircle2 className='size-4' />
      <AlertTitle>{t('admin.pending.issued.title')}</AlertTitle>
      <AlertDescription className='space-y-2'>
        <p className='text-muted-foreground'>
          {t('admin.pending.issued.description')}
        </p>
        <ul className='space-y-1'>
          {issued.map((item) => (
            <li key={item.licenseId} className='flex items-center gap-2 text-sm'>
              <span className='text-muted-foreground'>
                {t('admin.pending.issued.order', { order: item.orderNumber })}
              </span>
              <span className='font-mono'>{item.licenseKey}</span>
              <CopyButton
                value={item.licenseKey}
                label={t('admin.copy.licenseKey')}
              />
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
