import { queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'

/**
 * Покупка на сайте: способы оплаты и заказы (`orders.controller.ts`).
 *   GET  /billing/methods                 — включённые способы для витрины
 *   POST /billing/orders                  — создать заказ
 *   GET  /billing/orders, /billing/orders/:id
 *   POST /billing/orders/:id/crypto-tx    — хеш транзакции
 *   POST /billing/orders/:id/cancel       — отмена (крипта до отправки хеша)
 *   POST /billing/orders/:id/refresh      — перепроверить ЮKassa
 */

export type CheckoutProvider = 'YOOKASSA' | 'CRYPTO'
export type PaymentProvider = 'DIGISELLER' | 'MANUAL' | CheckoutProvider
export type OrderStatus = 'PENDING' | 'PAID' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED' | 'FAILED'
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED'

export const ORDER_STATUSES: OrderStatus[] = ['PENDING', 'PAID', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED']

export type PublicPaymentMethod = {
  provider: 'DIGISELLER' | CheckoutProvider
  title: string
  description: string | null
  wallets?: { id: string; currency: string; network: string }[]
}

export type CryptoInstructions = {
  kind: 'crypto'
  walletId: string
  currency: string
  network: string
  address: string
  amount: string
  explorerTxUrl: string | null
  note: string | null
  expiresAt: string
}

export type RedirectInstructions = { kind: 'redirect'; url: string | null }

export type Order = {
  id: string
  number: string
  status: OrderStatus
  source: string
  amount: string
  currency: string
  comment: string | null
  createdAt: string
  paidAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  product: { id: string; name: string }
  plan: { id: string; name: string; durationDays: number | null }
  user: { id: string; username: string } | null
  licenseIds: string[]
  payment: {
    id: string
    provider: PaymentProvider
    method: string
    status: PaymentStatus
    externalId: string | null
    instructions: CryptoInstructions | RedirectInstructions | null
    submittedAt: string | null
    confirmedAt: string | null
    failedAt: string | null
    errorMessage: string | null
  } | null
}

export type OrderList = { items: Order[]; total: number; skip: number; take: number }

export type OrderFilters = {
  status?: OrderStatus
  provider?: PaymentProvider
  awaiting?: boolean
  userId?: string
  search?: string
  skip?: number
  take?: number
}

export function buildOrderQuery(filters: OrderFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.provider) params.set('provider', filters.provider)
  if (filters.awaiting) params.set('awaiting', 'true')
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  if (filters.skip) params.set('skip', String(filters.skip))
  params.set('take', String(filters.take ?? 25))
  return params.toString()
}

/** Способы оплаты конкретного товара: у каждого товара свои реквизиты. */
export const paymentMethodsQueryOptions = (productId: string) =>
  queryOptions({
    queryKey: ['billing', 'methods', productId],
    queryFn: () => apiFetch<PublicPaymentMethod[]>(`/billing/methods?productId=${encodeURIComponent(productId)}`),
    staleTime: 60_000,
  })

export const ordersQueryOptions = (filters: OrderFilters) =>
  queryOptions({
    queryKey: ['orders', filters],
    queryFn: ({ signal }) => apiFetch<OrderList>(`/billing/orders?${buildOrderQuery(filters)}`, { signal }),
    staleTime: 10_000,
  })

export const orderQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['orders', 'one', id],
    queryFn: ({ signal }) => apiFetch<Order>(`/billing/orders/${encodeURIComponent(id)}`, { signal }),
  })

function storeOrder(order: Order): void {
  queryClient.setQueryData(orderQueryOptions(order.id).queryKey, order)
  void queryClient.invalidateQueries({ queryKey: ['orders'], exact: false, refetchType: 'none' })
}

export function useCreateOrder() {
  return useMutation({
    mutationFn: (body: { planId: string; provider: CheckoutProvider; walletId?: string }) =>
      apiFetch<Order>('/billing/orders', { method: 'POST', body }),
    onSuccess: storeOrder,
  })
}

export function useSubmitCryptoTx(orderId: string) {
  return useMutation({
    mutationFn: (txHash: string) =>
      apiFetch<Order>(`/billing/orders/${encodeURIComponent(orderId)}/crypto-tx`, {
        method: 'POST',
        body: { txHash },
      }),
    onSuccess: storeOrder,
  })
}

export function useCancelOrder(orderId: string) {
  return useMutation({
    mutationFn: () => apiFetch<Order>(`/billing/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' }),
    onSuccess: storeOrder,
  })
}

export function useRefreshOrder(orderId: string) {
  return useMutation({
    mutationFn: () => apiFetch<Order>(`/billing/orders/${encodeURIComponent(orderId)}/refresh`, { method: 'POST' }),
    onSuccess: storeOrder,
  })
}

/** Ссылка на транзакцию в обозревателе, если админ задал шаблон. */
export function explorerLink(template: string | null | undefined, txHash: string | null | undefined): string | null {
  if (!template || !txHash) return null
  return template.replace('{tx}', encodeURIComponent(txHash))
}
