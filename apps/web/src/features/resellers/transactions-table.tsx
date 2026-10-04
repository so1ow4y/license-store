import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDateTime } from '@/lib/format/date'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminErrorText } from '@/features/admin/error-text'
import {
  adminResellerTransactionsQueryOptions,
  formatMoney,
  resellerTransactionsQueryOptions,
  type ResellerTxType,
} from './api'

const PAGE = 25

const TYPE_VARIANT: Record<ResellerTxType, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  TOPUP: 'default',
  COMMISSION: 'default',
  SALE: 'secondary',
  REFUND: 'outline',
  ADJUSTMENT: 'outline',
}

/** Операции по балансу: в админке — выбранного реселлера, в панели — свои. */
export function TransactionsTable({ resellerId }: { resellerId?: string }) {
  const t = useT()
  const [skip, setSkip] = useState(0)
  const page = { skip, take: PAGE }
  const query = useQuery(
    resellerId ? adminResellerTransactionsQueryOptions(resellerId, page) : resellerTransactionsQueryOptions(page)
  )

  if (query.isPending) return <Skeleton className='h-32 w-full' />
  if (query.isError) return <AdminErrorText error={query.error} />

  const { items, total } = query.data
  if (items.length === 0) return <p className='text-sm text-muted-foreground'>{t('resellers.tx.empty')}</p>

  return (
    <div className='space-y-3'>
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('resellers.tx.column.date')}</TableHead>
              <TableHead>{t('resellers.tx.column.type')}</TableHead>
              <TableHead className='text-right'>{t('resellers.tx.column.amount')}</TableHead>
              <TableHead className='text-right'>{t('resellers.tx.column.balanceAfter')}</TableHead>
              <TableHead>{t('resellers.tx.column.what')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(tx.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant={TYPE_VARIANT[tx.type]}>{t(`resellers.tx.${tx.type}`)}</Badge>
                </TableCell>
                <TableCell className={cn('text-right font-medium whitespace-nowrap', Number(tx.amount) < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400')}>
                  {Number(tx.amount) > 0 ? '+' : ''}
                  {formatMoney(tx.amount, tx.currency)}
                </TableCell>
                <TableCell className='text-right whitespace-nowrap text-muted-foreground'>{formatMoney(tx.balanceAfter, tx.currency)}</TableCell>
                <TableCell className='text-sm'>
                  {tx.planLabel && (
                    <span>
                      {tx.planLabel}
                      {tx.quantity && tx.quantity > 1 ? ` × ${tx.quantity}` : ''}
                    </span>
                  )}
                  {tx.comment && <span className='block text-xs text-muted-foreground'>{tx.comment}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className='flex items-center justify-between text-sm text-muted-foreground'>
        <span>{t('siem.total', { total })}</span>
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>
            {t('common.action.prevPage')}
          </Button>
          <Button variant='outline' size='sm' disabled={skip + PAGE >= total} onClick={() => setSkip(skip + PAGE)}>
            {t('common.action.nextPage')}
          </Button>
        </div>
      </div>
    </div>
  )
}
