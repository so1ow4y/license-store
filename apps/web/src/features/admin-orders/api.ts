import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'
import type { Order } from '@/features/orders/api'

/** Ручная проверка оплаты (`orders.manage`). Список — общий `ordersQueryOptions`. */

function invalidate(): void {
  void queryClient.invalidateQueries({ queryKey: ['orders'] })
}

export function useConfirmOrder() {
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      apiFetch<Order>(`/billing/orders/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        body: note ? { note } : {},
      }),
    onSuccess: invalidate,
  })
}

export function useRejectOrder() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch<Order>(`/billing/orders/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: invalidate,
  })
}
