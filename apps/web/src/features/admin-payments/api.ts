import { keepPreviousData, queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'
import type { BulkResult } from '@/features/admin/bulk'

/** Способы оплаты в панели (`payment-methods.controller.ts`). Значения ключей сервер не отдаёт. */

export type CryptoWallet = {
  id: string
  currency: string
  network: string
  address: string
  rate: number
  decimals: number
  explorerTxUrl?: string
}

export type MethodConfig = {
  DIGISELLER: { minAmountRatio: number; pollWindowHours: number }
  YOOKASSA: { sendReceipt: boolean; vatCode: number }
  CRYPTO: { wallets: CryptoWallet[]; instructions?: string; expireHours: number }
}

export type ConfigurableProvider = keyof MethodConfig

export type AdminPaymentMethod<P extends ConfigurableProvider = ConfigurableProvider> = {
  provider: P
  enabled: boolean
  title: string
  description: string | null
  sortOrder: number
  config: MethodConfig[P]
  secretFields: string[]
  secretsSet: Record<string, boolean>
  ready: boolean
  notReadyReason: string | null
  webhookUrl: string | null
  updatedAt: string | null
}

export type UpdatePaymentMethodInput = {
  enabled?: boolean
  title?: string
  description?: string | null
  sortOrder?: number
  config?: object
  secrets?: Record<string, string>
}

export const adminPaymentMethodsQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'payment-methods'],
    queryFn: () => apiFetch<AdminPaymentMethod[]>('/admin/payment-methods'),
  })

export function useUpdatePaymentMethod(provider: ConfigurableProvider) {
  return useMutation({
    mutationFn: (body: UpdatePaymentMethodInput) =>
      apiFetch<AdminPaymentMethod>(`/admin/payment-methods/${provider}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'payment-methods'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'product-payment-options'] })
      void queryClient.invalidateQueries({ queryKey: ['billing', 'methods'] })
    },
  })
}

// ------------------------------------------------------------ реквизиты

/**
 * Реквизиты оплаты (`payment-profiles.controller.ts`): шаблоны и личные
 * реквизиты товара. Значения ключей сервер не отдаёт — только «задан/нет».
 */
export type ProfileProvider = 'YOOKASSA' | 'CRYPTO'
export const PROFILE_PROVIDERS: ProfileProvider[] = ['YOOKASSA', 'CRYPTO']

export const DEFAULT_PROFILE_CONFIG: { [P in ProfileProvider]: MethodConfig[P] } = {
  YOOKASSA: { sendReceipt: false, vatCode: 1 },
  CRYPTO: { wallets: [], expireHours: 24 },
}

export const PROFILE_SECRET_FIELDS: Record<ProfileProvider, string[]> = {
  YOOKASSA: ['shopId', 'secretKey'],
  CRYPTO: [],
}

export type PaymentProfile = {
  id: string
  provider: ProfileProvider
  name: string
  kind: 'TEMPLATE' | 'PERSONAL'
  productId: string | null
  productName: string | null
  config: MethodConfig[ProfileProvider]
  secretFields: string[]
  secretsSet: Record<string, boolean>
  ready: boolean
  notReadyReason: string | null
  usedBy: number
  /** Товары, к которым привязаны реквизиты. */
  products: { id: string; name: string; slug: string; enabled: boolean }[]
  createdById: string | null
  createdByUsername: string | null
  createdAt: string
  updatedAt: string
}

/** Поля строки поиска по реестру реквизитов (`PROFILE_FIELDS` на сервере). */
export const PROFILE_SEARCH_FIELDS = ['name', 'provider', 'kind', 'product', 'creator', 'wallet', 'id'] as const

export type ProfileSearch = {
  q?: string
  provider?: ProfileProvider
  kind?: 'TEMPLATE' | 'PERSONAL'
  from?: string
  to?: string
  skip: number
  take: number
}

export const profilesSearchQueryOptions = (search: ProfileSearch) =>
  queryOptions({
    queryKey: ['admin', 'payment-profiles', 'search', search],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams()
      if (search.q?.trim()) params.set('q', search.q.trim())
      if (search.provider) params.set('provider', search.provider)
      if (search.kind) params.set('kind', search.kind)
      if (search.from) params.set('from', search.from)
      if (search.to) params.set('to', search.to)
      if (search.skip) params.set('skip', String(search.skip))
      params.set('take', String(search.take))
      return apiFetch<{ items: PaymentProfile[]; total: number }>(`/admin/payment-profiles/search?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
  })

export type ProfileInput = {
  provider?: ProfileProvider
  name?: string
  productId?: string | null
  config?: object
  secrets?: Record<string, string>
}

/** Способ оплаты товара: канал и все привязанные к товару реквизиты этого способа. */
export type ProductPaymentOption = {
  provider: ProfileProvider
  channelEnabled: boolean
  channelTitle: string
  options: { enabled: boolean; sortOrder: number; profile: PaymentProfile }[]
}

export const paymentProfilesQueryOptions = (productId?: string) =>
  queryOptions({
    queryKey: ['admin', 'payment-profiles', productId ?? 'templates'],
    queryFn: () =>
      apiFetch<PaymentProfile[]>(
        `/admin/payment-profiles${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`
      ),
  })

export const productPaymentOptionsQueryOptions = (productId: string) =>
  queryOptions({
    queryKey: ['admin', 'product-payment-options', productId],
    queryFn: () => apiFetch<ProductPaymentOption[]>(`/products/${encodeURIComponent(productId)}/payment-options`),
  })

function invalidateProfiles() {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'payment-profiles'] })
  void queryClient.invalidateQueries({ queryKey: ['admin', 'product-payment-options'] })
  void queryClient.invalidateQueries({ queryKey: ['billing', 'methods'] })
}

/** Создать (без id) или изменить реквизиты. */
export function useSaveProfile(id?: string) {
  return useMutation({
    mutationFn: (body: ProfileInput) =>
      id
        ? apiFetch<PaymentProfile>(`/admin/payment-profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body })
        : apiFetch<PaymentProfile>('/admin/payment-profiles', { method: 'POST', body }),
    onSuccess: invalidateProfiles,
  })
}

/** Удалить реквизиты для всех: они снимаются со всех товаров. */
export function useArchiveProfile() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/admin/payment-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidateProfiles,
  })
}

export function useBulkDeleteProfiles() {
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<BulkResult>('/admin/payment-profiles/bulk-delete', { method: 'POST', body: { ids } }),
    onSuccess: invalidateProfiles,
  })
}

function optionsPath(productId: string, profileId?: string): string {
  return `/products/${encodeURIComponent(productId)}/payment-options${profileId ? `/${encodeURIComponent(profileId)}` : ''}`
}

/** Привязка реквизитов к товару: добавить, включить/выключить, отвязать. */
export function useProductOptionMutations(productId: string) {
  const onSuccess = (options: ProductPaymentOption[]) => {
    queryClient.setQueryData(productPaymentOptionsQueryOptions(productId).queryKey, options)
    invalidateProfiles()
  }
  return {
    attach: useMutation({
      mutationFn: (profileId: string) =>
        apiFetch<ProductPaymentOption[]>(optionsPath(productId), { method: 'POST', body: { profileId } }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ profileId, ...body }: { profileId: string; enabled?: boolean; sortOrder?: number }) =>
        apiFetch<ProductPaymentOption[]>(optionsPath(productId, profileId), { method: 'PATCH', body }),
      onSuccess,
    }),
    detach: useMutation({
      mutationFn: (profileId: string) =>
        apiFetch<ProductPaymentOption[]>(optionsPath(productId, profileId), { method: 'DELETE' }),
      onSuccess,
    }),
  }
}
