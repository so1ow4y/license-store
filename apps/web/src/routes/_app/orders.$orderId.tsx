import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, ExternalLink, Hourglass, RotateCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { CopyButton } from '@/components/copy-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPrice } from '@/features/catalog/api'
import {
  explorerLink,
  orderQueryOptions,
  useCancelOrder,
  useRefreshOrder,
  useSubmitCryptoTx,
  type CryptoInstructions,
  type Order,
} from '@/features/orders/api'
import { OrderStatusBadge, isAwaitingReview, providerLabel } from '@/features/orders/status-badge'
import { QrCode } from '@/features/security/qr-code'
import { formatDateTime } from '@/lib/format/date'

export const Route = createFileRoute('/_app/orders/$orderId')({
  component: OrderPage,
})

function OrderPage() {
  const { orderId } = Route.useParams()
  const t = useT()
  const query = useQuery({
    ...orderQueryOptions(orderId),
    // Пока заказ не закрыт, перечитываем: ЮKassa подтверждает вебхуком,
    // крипту — администратор.
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 15_000 : false),
  })

  return (
    <div className='mx-auto w-full max-w-3xl space-y-6'>
      <Button asChild variant='ghost' size='sm' className='-ml-2'>
        <Link to='/orders'>
          <ArrowLeft className='size-4' />
          {t('orders.back')}
        </Link>
      </Button>

      {query.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : query.isError ? (
        <ApiErrorText error={query.error} />
      ) : (
        <OrderView order={query.data} />
      )}
    </div>
  )
}

function OrderView({ order }: { order: Order }) {
  const t = useT()
  const payment = order.payment
  const instructions = payment?.instructions

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <CardTitle className='font-mono text-lg'>{order.number}</CardTitle>
            <OrderStatusBadge order={order} />
          </div>
          <CardDescription>
            {order.product.name} · {order.plan.name} · {formatPrice(order.amount, order.currency)}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-2 text-sm sm:grid-cols-2'>
          <Field label={t('orders.field.method')} value={payment ? providerLabel(payment.provider) : '—'} />
          <Field label={t('orders.field.created')} value={formatDateTime(order.createdAt)} />
          {order.paidAt && <Field label={t('orders.field.paid')} value={formatDateTime(order.paidAt)} />}
          {order.cancelledAt && (
            <Field label={t('orders.field.cancelled')} value={formatDateTime(order.cancelledAt)} />
          )}
        </CardContent>
      </Card>

      {order.status === 'DELIVERED' && (
        <Alert>
          <CheckCircle2 className='size-4' />
          <AlertTitle>{t('orders.delivered.title')}</AlertTitle>
          <AlertDescription className='space-y-3'>
            <p>{t('orders.delivered.description')}</p>
            <div className='flex flex-wrap gap-2'>
              {order.licenseIds.map((licenseId) => (
                <Button key={licenseId} asChild size='sm'>
                  <Link to='/licenses/$licenseId' params={{ licenseId }}>
                    {t('orders.delivered.action')}
                  </Link>
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {order.status === 'CANCELLED' && (
        <Alert variant='destructive'>
          <XCircle className='size-4' />
          <AlertTitle>{t('orders.cancelled.title')}</AlertTitle>
          <AlertDescription>{order.comment ?? t('orders.cancelled.noReason')}</AlertDescription>
        </Alert>
      )}

      {order.status === 'PENDING' && payment?.provider === 'YOOKASSA' && (
        <YookassaPending order={order} url={instructions?.kind === 'redirect' ? instructions.url : null} />
      )}

      {order.status === 'PENDING' && payment?.provider === 'CRYPTO' && instructions?.kind === 'crypto' && (
        <CryptoPending order={order} instructions={instructions} />
      )}
    </div>
  )
}

function YookassaPending({ order, url }: { order: Order; url: string | null }) {
  const t = useT()
  const refresh = useRefreshOrder(order.id)

  // Вернулись со страницы оплаты — сразу спрашиваем ЮKassa, не ждём вебхука.
  useEffect(() => {
    refresh.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Hourglass className='size-4' />
          {t('orders.yookassa.title')}
        </CardTitle>
        <CardDescription>{t('orders.yookassa.description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        {url && (
          <Button asChild>
            <a href={url}>
              {t('orders.yookassa.pay')}
              <ExternalLink className='size-3.5' />
            </a>
          </Button>
        )}
        <Button variant='outline' disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          <RotateCw className='size-4' />
          {t('orders.yookassa.check')}
        </Button>
        <ApiErrorText error={refresh.error} />
      </CardContent>
    </Card>
  )
}

function CryptoPending({ order, instructions }: { order: Order; instructions: CryptoInstructions }) {
  const t = useT()
  const submit = useSubmitCryptoTx(order.id)
  const cancel = useCancelOrder(order.id)
  const [txHash, setTxHash] = useState(order.payment?.externalId ?? '')
  const awaiting = isAwaitingReview(order)
  const txLink = explorerLink(instructions.explorerTxUrl, order.payment?.externalId)

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!txHash.trim()) return
    submit.mutate(txHash.trim(), {
      onSuccess: () => toast.success(t('orders.crypto.submitted')),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>
          {awaiting ? t('orders.crypto.awaiting.title') : t('orders.crypto.title')}
        </CardTitle>
        <CardDescription>
          {awaiting
            ? t('orders.crypto.awaiting.description')
            : t('orders.crypto.description', { expires: formatDateTime(instructions.expiresAt) })}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-5'>
        <div className='flex flex-col gap-5 sm:flex-row'>
          <QrCode value={instructions.address} size={168} alt={t('orders.crypto.qrAlt')} />
          <div className='min-w-0 flex-1 space-y-3 text-sm'>
            <div>
              <p className='text-muted-foreground'>{t('orders.crypto.amount')}</p>
              <p className='flex items-center gap-1 text-lg font-semibold'>
                {instructions.amount} {instructions.currency}
                <CopyButton value={instructions.amount} label={t('orders.crypto.amount')} />
              </p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('orders.crypto.network')}</p>
              <p className='font-medium'>{instructions.network}</p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('orders.crypto.address')}</p>
              <p className='flex items-start gap-1 font-mono text-xs break-all'>
                {instructions.address}
                <CopyButton value={instructions.address} label={t('orders.crypto.address')} />
              </p>
            </div>
          </div>
        </div>

        <Alert>
          <AlertDescription>{t('orders.crypto.warning', { network: instructions.network, currency: instructions.currency })}</AlertDescription>
        </Alert>
        {instructions.note && <p className='text-sm whitespace-pre-line text-muted-foreground'>{instructions.note}</p>}

        <form onSubmit={onSubmit} className='space-y-2'>
          <Label htmlFor='tx-hash'>{t('orders.crypto.tx.label')}</Label>
          <div className='flex gap-2'>
            <Input
              id='tx-hash'
              value={txHash}
              className='font-mono text-xs'
              placeholder={t('orders.crypto.tx.placeholder')}
              onChange={(event) => setTxHash(event.target.value)}
            />
            <Button type='submit' disabled={submit.isPending || !txHash.trim()}>
              {awaiting ? t('orders.crypto.tx.update') : t('orders.crypto.tx.submit')}
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>{t('orders.crypto.tx.hint')}</p>
          {txLink && (
            <a href={txLink} target='_blank' rel='noopener noreferrer' className='text-xs underline'>
              {t('orders.crypto.tx.explorer')}
            </a>
          )}
          <ApiErrorText error={submit.error} />
        </form>

        {!awaiting && (
          <div className='border-t pt-4'>
            <Button variant='ghost' size='sm' disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('orders.crypto.cancel')}
            </Button>
            <ApiErrorText error={cancel.error} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className='text-muted-foreground'>{label}</p>
      <p className='font-medium'>{value}</p>
    </div>
  )
}
