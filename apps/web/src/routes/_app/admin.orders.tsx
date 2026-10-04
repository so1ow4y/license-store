import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { has, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/copy-button'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { useConfirmOrder, useRejectOrder } from '@/features/admin-orders/api'
import { formatPrice } from '@/features/catalog/api'
import {
  explorerLink,
  ORDER_STATUSES,
  ordersQueryOptions,
  type Order,
  type OrderStatus,
  type PaymentProvider,
} from '@/features/orders/api'
import { isAwaitingReview, OrderStatusBadge, orderStatusLabel, providerLabel } from '@/features/orders/status-badge'
import { formatDateTime } from '@/lib/format/date'

const PAGE = 25
const ANY = 'ANY'
const PROVIDERS: PaymentProvider[] = ['YOOKASSA', 'CRYPTO', 'DIGISELLER', 'MANUAL']

const searchSchema = z.object({
  status: z.enum(['awaiting', 'all']).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/admin/orders')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!has(context.me.permissions, PERMISSIONS.ORDERS_READ_ANY)) throw redirect({ to: '/403' })
  },
  component: AdminOrdersPage,
})

function AdminOrdersPage() {
  const t = useT()
  const { can } = useSession()
  const navigate = useNavigate({ from: Route.fullPath })
  const { status: tab = 'awaiting' } = Route.useSearch()
  const [status, setStatus] = useState<OrderStatus | typeof ANY>(ANY)
  const [provider, setProvider] = useState<PaymentProvider | typeof ANY>(ANY)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [skip, setSkip] = useState(0)
  const [confirming, setConfirming] = useState<Order | null>(null)
  const [rejecting, setRejecting] = useState<Order | null>(null)

  useEffect(() => setSkip(0), [tab, status, provider, search])

  const query = useQuery(
    ordersQueryOptions(
      tab === 'awaiting'
        ? { awaiting: true, skip, take: PAGE }
        : {
            status: status === ANY ? undefined : status,
            provider: provider === ANY ? undefined : provider,
            search: search || undefined,
            skip,
            take: PAGE,
          }
    )
  )

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const canManage = can(PERMISSIONS.ORDERS_MANAGE)

  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('admin.orders.title')} description={t('admin.orders.description')} />

      <Tabs value={tab} onValueChange={(value) => void navigate({ search: { status: value as 'awaiting' | 'all' } })}>
        <TabsList>
          <TabsTrigger value='awaiting'>{t('admin.orders.tab.awaiting')}</TabsTrigger>
          <TabsTrigger value='all'>{t('admin.orders.tab.all')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'all' && (
        <div className='flex flex-wrap items-end gap-2'>
          <form
            className='flex items-end gap-2'
            onSubmit={(e) => {
              e.preventDefault()
              setSearch(searchDraft.trim())
            }}
          >
            <Input
              value={searchDraft}
              placeholder={t('admin.orders.search')}
              className='w-64'
              onChange={(e) => setSearchDraft(e.target.value)}
            />
            <Button type='submit' variant='outline'>
              <Search className='size-4' />
              {t('common.action.search')}
            </Button>
          </form>
          <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus | typeof ANY)}>
            <SelectTrigger className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.orders.anyStatus')}</SelectItem>
              {ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {orderStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={provider} onValueChange={(v) => setProvider(v as PaymentProvider | typeof ANY)}>
            <SelectTrigger className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.orders.anyProvider')}</SelectItem>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {providerLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant='outline' onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className='size-4' />
            {t('common.action.refresh')}
          </Button>
        </div>
      )}

      {query.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : items.length === 0 ? (
        <Alert>
          <AlertDescription>
            {tab === 'awaiting' ? t('admin.orders.empty.awaiting') : t('admin.orders.empty.all')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('orders.column.number')}</TableHead>
                  <TableHead>{t('admin.orders.column.buyer')}</TableHead>
                  <TableHead>{t('orders.column.product')}</TableHead>
                  <TableHead>{t('orders.column.amount')}</TableHead>
                  <TableHead>{t('admin.orders.column.payment')}</TableHead>
                  <TableHead>{t('orders.column.status')}</TableHead>
                  <TableHead>{t('orders.column.created')}</TableHead>
                  {canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    canManage={canManage}
                    onConfirm={() => setConfirming(order)}
                    onReject={() => setRejecting(order)}
                  />
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

      <ConfirmDialog order={confirming} onClose={() => setConfirming(null)} />
      <RejectDialog order={rejecting} onClose={() => setRejecting(null)} />
    </div>
  )
}

function OrderRow({
  order,
  canManage,
  onConfirm,
  onReject,
}: {
  order: Order
  canManage: boolean
  onConfirm: () => void
  onReject: () => void
}) {
  const t = useT()
  const payment = order.payment
  const crypto = payment?.instructions?.kind === 'crypto' ? payment.instructions : null
  const txLink = explorerLink(crypto?.explorerTxUrl, payment?.externalId)
  const manual = order.status === 'PENDING' && payment?.provider === 'CRYPTO'

  return (
    <TableRow>
      <TableCell className='font-mono text-xs'>{order.number}</TableCell>
      <TableCell>
        {order.user ? (
          <Link to='/admin/users/$userId' params={{ userId: order.user.id }} className='underline-offset-4 hover:underline'>
            {order.user.username}
          </Link>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        {order.product.name}
        <span className='block text-xs text-muted-foreground'>{order.plan.name}</span>
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {formatPrice(order.amount, order.currency)}
        {crypto && (
          <span className='block text-xs text-muted-foreground'>
            {crypto.amount} {crypto.currency} · {crypto.network}
          </span>
        )}
      </TableCell>
      <TableCell className='max-w-56'>
        {payment ? providerLabel(payment.provider) : '—'}
        {payment?.externalId && payment.provider === 'CRYPTO' && (
          <span className='flex items-center gap-1 font-mono text-xs text-muted-foreground'>
            <span className='truncate'>{payment.externalId}</span>
            <CopyButton value={payment.externalId} label='TX' />
          </span>
        )}
        {txLink && (
          <a href={txLink} target='_blank' rel='noopener noreferrer' className='text-xs underline'>
            {t('admin.orders.explorer')}
          </a>
        )}
        {payment?.errorMessage && <span className='block text-xs text-destructive'>{payment.errorMessage}</span>}
      </TableCell>
      <TableCell>
        <OrderStatusBadge order={order} />
      </TableCell>
      <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(order.createdAt)}</TableCell>
      {canManage && (
        <TableCell className='space-x-2 text-right whitespace-nowrap'>
          {manual && (
            <>
              {/* Без хеша тоже можно: покупатель мог оплатить и не прислать его. */}
              <Button size='sm' onClick={onConfirm} title={isAwaitingReview(order) ? undefined : t('admin.orders.noTx')}>
                {t('admin.orders.confirm')}
              </Button>
              <Button size='sm' variant='outline' onClick={onReject}>
                {t('admin.orders.reject')}
              </Button>
            </>
          )}
        </TableCell>
      )}
    </TableRow>
  )
}

function ConfirmDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const t = useT()
  const confirm = useConfirmOrder()
  const [note, setNote] = useState('')

  useEffect(() => {
    setNote('')
    confirm.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id])

  if (!order) return null
  const crypto = order.payment?.instructions?.kind === 'crypto' ? order.payment.instructions : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.orders.confirmTitle', { number: order.number })}</DialogTitle>
          <DialogDescription>{t('admin.orders.confirmHint')}</DialogDescription>
        </DialogHeader>
        {crypto && (
          <div className='space-y-1 rounded-md bg-muted/50 p-3 text-sm'>
            <p>
              {crypto.amount} {crypto.currency} · {crypto.network}
            </p>
            <p className='font-mono text-xs break-all'>{crypto.address}</p>
            <p className='font-mono text-xs break-all text-muted-foreground'>TX: {order.payment?.externalId}</p>
          </div>
        )}
        <div className='space-y-2'>
          <Label>{t('admin.orders.note')}</Label>
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
        <AdminErrorText error={confirm.error} />
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            disabled={confirm.isPending}
            onClick={() =>
              confirm.mutate(
                { id: order.id, note: note.trim() || undefined },
                { onSuccess: () => { toast.success(t('admin.orders.confirmed')); onClose() } }
              )
            }
          >
            {t('admin.orders.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const t = useT()
  const reject = useRejectOrder()
  const [reason, setReason] = useState('')

  useEffect(() => {
    setReason('')
    reject.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id])

  if (!order) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.orders.rejectTitle', { number: order.number })}</DialogTitle>
          <DialogDescription>{t('admin.orders.rejectHint')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label>{t('admin.orders.reason')}</Label>
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <AdminErrorText error={reject.error} />
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant='destructive'
            disabled={!reason.trim() || reject.isPending}
            onClick={() =>
              reject.mutate(
                { id: order.id, reason: reason.trim() },
                { onSuccess: () => { toast.success(t('admin.orders.rejected')); onClose() } }
              )
            }
          >
            {t('admin.orders.reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
