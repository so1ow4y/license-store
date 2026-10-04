import { queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'

/**
 * Зависшие сделки Digiseller (план, п. 3.19).
 *
 * Маршруты и их права — по исходникам сервера:
 *   GET  /billing/digiseller/pending              (billing.controller.ts:54-66)
 *   POST /billing/digiseller/pending/:id/complete (billing.controller.ts:68-84)
 * Оба закрыты `@RequirePermissions('licenses.create.any')`.
 *
 * Почему раздел вообще существует: покупатель, чей товар не привязан к тарифу,
 * получает при активации кода нейтральное «оплата принята, лицензия будет
 * выдана в ближайшее время». Деньги у площадки, лицензии нет, и выдать её
 * обязан человек. Пока этот список не пуст — кто-то ждёт оплаченный товар.
 */

/** Строка ответа `listPending` (digiseller.service.ts:365-375) — select точный. */
export type PendingDeal = {
  id: string
  /** Код покупки, который вводит покупатель. */
  uniqueCode: string
  /**
   * Номер счёта площадки. В схеме BigInt; сервер сериализует его числом,
   * а за пределами безопасного диапазона — строкой (main.ts:18-24).
   */
  invId: number | string | null
  /** Номер товара Digiseller — именно его нужно привязать к тарифу. */
  digisellerProductId: number | null
  /** Decimal(12,2) приходит строкой: перевод в number терял бы копейки. */
  amount: string | null
  currency: string | null
  buyerEmail: string | null
  createdAt: string
}

/** Ответ `completePending` (digiseller.service.ts:467). */
export type CompletedDeal = {
  status: 'ISSUED'
  orderId: string
  orderNumber: string
  licenseId: string
  licenseKey: string
}

export const PENDING_DEALS_QUERY_KEY = [
  'admin',
  'billing',
  'digiseller',
  'pending',
] as const

export const pendingDealsQueryOptions = () =>
  queryOptions({
    queryKey: PENDING_DEALS_QUERY_KEY,
    queryFn: ({ signal }) =>
      apiFetch<PendingDeal[]>('/billing/digiseller/pending', { signal }),
    // Список меняется от действий людей, а не сам по себе: короткий staleTime
    // нужен, чтобы после выдачи и после привязки тарифа данные подтянулись.
    staleTime: 15_000,
  })

/**
 * Довыдача лицензии по сделке.
 *
 * Тела нет: сервер берёт всё из сохранённого ответа площадки и не спрашивает
 * код повторно. Лишнее поле в теле дало бы 400 — валидация с
 * `forbidNonWhitelisted`.
 */
export function useCompletePendingDeal() {
  return useMutation({
    mutationFn: (dealId: string) =>
      apiFetch<CompletedDeal>(
        `/billing/digiseller/pending/${encodeURIComponent(dealId)}/complete`,
        { method: 'POST' }
      ),
    // Список перечитываем в любом исходе. При ALREADY_REDEEMED это не
    // косметика, а единственный способ убрать строку, которой уже нет.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: PENDING_DEALS_QUERY_KEY }),
  })
}
