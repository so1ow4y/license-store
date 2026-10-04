import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Receipt } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatPrice } from '@/features/catalog/api'
import { ordersQueryOptions } from '@/features/orders/api'
import { OrderStatusBadge, providerLabel } from '@/features/orders/status-badge'
import { formatDateTime } from '@/lib/format/date'

const PAGE = 25

export const Route = createFileRoute('/_app/orders/')({
  component: MyOrdersPage,
})

function MyOrdersPage() {
  const t = useT()
  const [skip, setSkip] = useState(0)
  const query = useQuery(ordersQueryOptions({ skip, take: PAGE }))
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0

  return (
    <div className='space-y-6'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>{t('orders.title')}</h1>
        <p className='text-sm text-muted-foreground'>{t('orders.description')}</p>
      </header>

      {query.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : query.isError ? (
        <ApiErrorText error={query.error} />
      ) : items.length === 0 ? (
        <div className='rounded-lg border border-dashed p-10 text-center'>
          <Receipt className='mx-auto size-8 text-muted-foreground' />
          <p className='mt-3 font-medium'>{t('orders.empty.title')}</p>
          <Button asChild variant='outline' size='sm' className='mt-4'>
            <Link to='/catalog'>{t('orders.empty.action')}</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('orders.column.number')}</TableHead>
                  <TableHead>{t('orders.column.product')}</TableHead>
                  <TableHead>{t('orders.column.amount')}</TableHead>
                  <TableHead>{t('orders.column.method')}</TableHead>
                  <TableHead>{t('orders.column.status')}</TableHead>
                  <TableHead>{t('orders.column.created')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className='font-mono text-xs'>
                      <Link
                        to='/orders/$orderId'
                        params={{ orderId: order.id }}
                        className='underline-offset-4 hover:underline'
                      >
                        {order.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {order.product.name}
                      <span className='block text-xs text-muted-foreground'>{order.plan.name}</span>
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      {formatPrice(order.amount, order.currency)}
                    </TableCell>
                    <TableCell>{order.payment ? providerLabel(order.payment.provider) : '—'}</TableCell>
                    <TableCell>
                      <OrderStatusBadge order={order} />
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>
                      {formatDateTime(order.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {total > PAGE && (
            <div className='flex justify-end gap-2'>
              <Button variant='outline' size='sm' disabled={skip === 0} onClick={() => setSkip(skip - PAGE)}>
                {t('common.action.prevPage')}
              </Button>
              <Button variant='outline' size='sm' disabled={skip + PAGE >= total} onClick={() => setSkip(skip + PAGE)}>
                {t('common.action.nextPage')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
