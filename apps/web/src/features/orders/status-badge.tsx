import { t as translate, useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import type { Order, OrderStatus, PaymentProvider } from './api'

export function orderStatusLabel(status: OrderStatus): string {
  return translate(`orders.status.${status}`)
}

export function providerLabel(provider: PaymentProvider): string {
  return translate(`orders.provider.${provider}`)
}

/** Заказ, по которому покупатель прислал хеш и ждёт проверки. */
export function isAwaitingReview(order: Order): boolean {
  return (
    order.status === 'PENDING' &&
    order.payment?.provider === 'CRYPTO' &&
    order.payment.submittedAt != null
  )
}

const VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  PAID: 'default',
  DELIVERED: 'default',
  CANCELLED: 'outline',
  REFUNDED: 'outline',
  FAILED: 'destructive',
}

export function OrderStatusBadge({ order }: { order: Order }) {
  const t = useT()
  if (isAwaitingReview(order)) {
    return <Badge variant='secondary'>{t('orders.status.AWAITING_REVIEW')}</Badge>
  }
  return <Badge variant={VARIANT[order.status]}>{orderStatusLabel(order.status)}</Badge>
}
