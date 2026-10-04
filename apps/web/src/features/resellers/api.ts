import { keepPreviousData, queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'

/**
 * Реселлеры (`resellers.controller.ts`): панель самого реселлера (`/reseller`)
 * и управление ими в админке (`/admin/resellers`). Деньги приходят строками
 * (Decimal) — для показа их форматирует `formatMoney`.
 */

export type Money = string | number

export type ResellerStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
export const RESELLER_STATUSES: ResellerStatus[] = ['ACTIVE', 'SUSPENDED', 'CLOSED']

export type Reseller = {
  id: string
  userId: string
  displayName: string
  status: ResellerStatus
  balance: Money
  currency: string
  discountPercent: Money
  creditLimit: Money
  allowedProductIds: string[]
  hwidResetDailyLimit: number
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type AdminReseller = Reseller & {
  user: { id: string; username: string; email: string | null }
  clients: number
  licenses: number
  keys: number
  sales30d?: Money
}

export type ResellerTxType = 'TOPUP' | 'SALE' | 'REFUND' | 'ADJUSTMENT' | 'COMMISSION'

export type ResellerTransaction = {
  id: string
  type: ResellerTxType
  amount: Money
  balanceAfter: Money
  currency: string
  planId: string | null
  planLabel: string | null
  quantity: number | null
  licenseId: string | null
  registrationKeyId: string | null
  comment: string | null
  createdAt: string
}

export type CatalogPlan = {
  id: string
  slug: string
  name: string
  durationDays: number | null
  price: Money
  currency: string
  resellerPrice: Money
}

export type ResellerOverview = {
  reseller: Reseller
  catalog: { id: string; slug: string; name: string; plans: CatalogPlan[] }[]
  stats: {
    keys: { unused: number; used: number; cancelled: number }
    licensesActive: number
    clients: number
    spent30d: Money
    operations30d: number
  }
}

export type KeyState = 'unused' | 'used' | 'cancelled' | 'expired'

export type ResellerKey = {
  id: string
  code: string
  state: KeyState
  price: Money | null
  product: string | null
  plan: string | null
  durationDays: number | null
  usedBy: string | null
  usedAt: string | null
  expiresAt: string | null
  cancelledAt: string | null
  createdAt: string
  cancellable: boolean
}

export type ClientLicense = {
  id: string
  maskedKey: string
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'BLOCKED' | 'REVOKED'
  issuedAt: string
  activatedAt: string | null
  expiresAt: string | null
  bound: boolean
  hwidResetCount: number
  lastCheckAt: string | null
  productId: string
  product: { name: string }
  plan: { name: string; durationDays: number | null }
  user: { username: string } | null
  /** Когда клиент активировал ключ. */
  claimedAt: string
}

export type Page<T> = { items: T[]; total: number; skip: number; take: number }

const enc = encodeURIComponent

function query(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

export function formatMoney(value: Money | null | undefined, currency = 'RUB'): string {
  const n = Number(value ?? 0)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

// ------------------------------------------------------------- панель реселлера

export const resellerOverviewQueryOptions = () =>
  queryOptions({
    queryKey: ['reseller', 'overview'],
    queryFn: () => apiFetch<ResellerOverview>('/reseller'),
  })

export const resellerKeysQueryOptions = (filters: { state?: KeyState; skip: number; take: number }) =>
  queryOptions({
    queryKey: ['reseller', 'keys', filters],
    queryFn: ({ signal }) => apiFetch<Page<ResellerKey>>(`/reseller/keys?${query(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  })

export const resellerLicensesQueryOptions = (filters: { search?: string; skip: number; take: number }) =>
  queryOptions({
    queryKey: ['reseller', 'licenses', filters],
    queryFn: ({ signal }) =>
      apiFetch<Page<ClientLicense> & { hwidResets: { usedToday: number; dailyLimit: number } }>(
        `/reseller/licenses?${query(filters)}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
  })

export const resellerTransactionsQueryOptions = (page: { skip: number; take: number }) =>
  queryOptions({
    queryKey: ['reseller', 'transactions', page],
    queryFn: ({ signal }) => apiFetch<Page<ResellerTransaction>>(`/reseller/transactions?${query(page)}`, { signal }),
    placeholderData: keepPreviousData,
  })

function invalidatePanel(): void {
  void queryClient.invalidateQueries({ queryKey: ['reseller'] })
}

export function useIssueKeys() {
  return useMutation({
    mutationFn: (body: { planId: string; count: number; expiresInDays?: number; note?: string }) =>
      apiFetch<{ codes: string[]; product: string; plan: string; unitPrice: Money; total: Money; balance: Money }>(
        '/reseller/keys',
        { method: 'POST', body }
      ),
    onSuccess: invalidatePanel,
  })
}

export function useCancelKey() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ balance: Money }>(`/reseller/keys/${enc(id)}/cancel`, { method: 'POST' }),
    onSuccess: invalidatePanel,
  })
}

export function useExtendClientLicense() {
  return useMutation({
    mutationFn: ({ id, planId }: { id: string; planId: string }) =>
      apiFetch<{ price: Money }>(`/reseller/licenses/${enc(id)}/extend`, { method: 'POST', body: { planId } }),
    onSuccess: invalidatePanel,
  })
}

export function useResetClientHwid() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ usedToday: number; dailyLimit: number }>(`/reseller/licenses/${enc(id)}/hwid-reset`, { method: 'POST' }),
    onSuccess: invalidatePanel,
  })
}

// ------------------------------------------------------ пополнение баланса

export type TopupStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED'

export type ResellerTopup = {
  id: string
  amount: Money
  currency: string
  status: TopupStatus
  /** PENDING, у которой вышел срок: перевод по ней уже не принимается. */
  expired: boolean
  instructions: {
    currency: string
    network: string
    address: string
    amount: string
    explorerTxUrl: string | null
    note: string | null
  }
  txHash: string | null
  creditedAmount: Money | null
  note: string | null
  rejectReason: string | null
  createdAt: string
  expiresAt: string
  submittedAt: string | null
  reviewedAt: string | null
}

export type AdminTopup = ResellerTopup & {
  reseller: { id: string; displayName: string; user: { username: string } }
}

export const topupOptionsQueryOptions = () =>
  queryOptions({
    queryKey: ['reseller', 'topups', 'options'],
    queryFn: () =>
      apiFetch<{ currency: string; wallets: { id: string; currency: string; network: string }[] }>('/reseller/topups/options'),
  })

export const myTopupsQueryOptions = (page: { skip: number; take: number }) =>
  queryOptions({
    queryKey: ['reseller', 'topups', page],
    queryFn: ({ signal }) => apiFetch<Page<ResellerTopup>>(`/reseller/topups?${query(page)}`, { signal }),
    placeholderData: keepPreviousData,
  })

export function useCreateTopup() {
  return useMutation({
    mutationFn: (body: { amount: number; walletId: string; note?: string }) =>
      apiFetch<ResellerTopup>('/reseller/topups', { method: 'POST', body }),
    onSuccess: invalidatePanel,
  })
}

export function useSubmitTopupTx() {
  return useMutation({
    mutationFn: ({ id, txHash }: { id: string; txHash: string }) =>
      apiFetch<ResellerTopup>(`/reseller/topups/${enc(id)}/tx`, { method: 'POST', body: { txHash } }),
    onSuccess: invalidatePanel,
  })
}

export function useCancelTopup() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<ResellerTopup>(`/reseller/topups/${enc(id)}/cancel`, { method: 'POST' }),
    onSuccess: invalidatePanel,
  })
}

export type TopupFilter = 'SUBMITTED' | 'OPEN' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'ALL'

export const adminTopupsQueryOptions = (filters: { status: TopupFilter; skip: number; take: number }) =>
  queryOptions({
    queryKey: ['admin', 'resellers', 'topups', filters],
    queryFn: ({ signal }) =>
      apiFetch<Page<AdminTopup> & { awaiting: number }>(
        `/admin/reseller-topups?${query({ ...filters, status: filters.status === 'ALL' ? undefined : filters.status })}`,
        { signal }
      ),
    placeholderData: keepPreviousData,
  })

export function useConfirmTopup() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; amount?: number; comment?: string }) =>
      apiFetch<{ balance: Money }>(`/admin/reseller-topups/${enc(id)}/confirm`, { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'resellers'] }),
  })
}

export function useRejectTopup() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch<{ ok: true }>(`/admin/reseller-topups/${enc(id)}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'resellers'] }),
  })
}

// ------------------------------------------------------------------ админка

export const adminResellersQueryOptions = (filters: { search?: string; status?: ResellerStatus; skip: number; take: number }) =>
  queryOptions({
    queryKey: ['admin', 'resellers', filters],
    queryFn: ({ signal }) => apiFetch<Page<AdminReseller>>(`/admin/resellers?${query(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  })

export const adminResellerTransactionsQueryOptions = (id: string, page: { skip: number; take: number }) =>
  queryOptions({
    queryKey: ['admin', 'resellers', id, 'transactions', page],
    queryFn: ({ signal }) =>
      apiFetch<Page<ResellerTransaction>>(`/admin/resellers/${enc(id)}/transactions?${query(page)}`, { signal }),
    placeholderData: keepPreviousData,
  })

export type ResellerTermsInput = {
  displayName?: string
  status?: ResellerStatus
  discountPercent?: number
  creditLimit?: number
  allowedProductIds?: string[]
  hwidResetDailyLimit?: number
  notes?: string
}

function invalidateAdmin(): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'resellers'] })
  void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
}

export function useCreateReseller() {
  return useMutation({
    mutationFn: (body: ResellerTermsInput & { username: string; displayName: string }) =>
      apiFetch<AdminReseller>('/admin/resellers', { method: 'POST', body }),
    onSuccess: invalidateAdmin,
  })
}

export function useUpdateReseller() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResellerTermsInput }) =>
      apiFetch<AdminReseller>(`/admin/resellers/${enc(id)}`, { method: 'PATCH', body }),
    onSuccess: invalidateAdmin,
  })
}

export function useChangeResellerBalance() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; type: 'TOPUP' | 'ADJUSTMENT' | 'COMMISSION'; amount: number; comment?: string }) =>
      apiFetch<{ balance: Money }>(`/admin/resellers/${enc(id)}/balance`, { method: 'POST', body }),
    onSuccess: invalidateAdmin,
  })
}
