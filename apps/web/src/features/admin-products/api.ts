import { keepPreviousData, queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'

/**
 * Товары, тарифы и сборки payload в панели (`products.controller.ts`,
 * `payloads.controller.ts`). Сборка заливается в хранилище напрямую из
 * браузера по presigned-ссылке; SHA-256 считает сервер при подтверждении.
 */

/** Код товара: 3–32 символа, строчная латиница, цифры и дефис (как `SLUG_RE` на сервере). */
export const PRODUCT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

export type ProductStatus = 'ACTIVE' | 'HIDDEN' | 'ARCHIVED'
export const PRODUCT_STATUSES: ProductStatus[] = ['ACTIVE', 'HIDDEN', 'ARCHIVED']

export type AdminPlan = {
  id: string
  productId: string
  slug: string
  name: string
  durationDays: number | null
  price: string
  currency: string
  digisellerProductId: number | null
  isActive: boolean
  sortOrder: number
  /** Сборки тарифа; пусто — тариф получает новейшую опубликованную сборку товара. */
  builds?: { build: BuildRef }[]
}

export type BuildRef = { id: string; name: string; version: string; isPublished: boolean }

export type AdminProduct = {
  id: string
  slug: string
  name: string
  description: string | null
  status: ProductStatus
  sortOrder: number
  maxHwidResets: number | null
  hwidResetCooldownHours: number | null
  createdAt: string
  plans: AdminPlan[]
  _count: { versions: number; licenses: number }
}

export type BuildStatus = 'draft' | 'ready' | 'published' | 'unpublished'
export const BUILD_STATUSES: BuildStatus[] = ['draft', 'ready', 'published', 'unpublished']

export type PayloadBuild = {
  id: string
  version: string
  /** Название в хранилище (по умолчанию — версия). */
  name: string
  status: BuildStatus
  channel: string
  sha256: string | null
  size: string | number | null
  isPublished: boolean
  publishedAt: string | null
  createdAt: string
  file: { id: string; objectKey: string; deletedAt: string | null } | null
  plans: { id: string; name: string; slug: string }[]
  pinnedLicenses: number
}

/** Название сборки: латиница и цифры, сегменты через точку, в конце буква или цифра. */
export const BUILD_NAME_RE = /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/
export const BUILD_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/

/** Следующая свободная версия: patch + 1 от самой новой. */
export function nextBuildVersion(builds: Pick<PayloadBuild, 'version'>[]): string {
  const parsed = builds
    .map((b) => b.version.split('.').map(Number))
    .filter((p) => p.length === 3 && p.every((n) => Number.isFinite(n)))
    .sort((a, b) => b[0]! - a[0]! || b[1]! - a[1]! || b[2]! - a[2]!)
  const top = parsed[0]
  return top ? `${top[0]}.${top[1]}.${top[2]! + 1}` : '1.0.0'
}

export type BuildFilters = { q?: string; from?: string; to?: string }

/** Поля строки поиска по хранилищу сборок. */
export const BUILD_SEARCH_FIELDS = ['name', 'version', 'status', 'plan', 'id'] as const

const enc = encodeURIComponent

export const adminProductsQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'products'],
    queryFn: () => apiFetch<AdminProduct[]>('/products/admin/all'),
  })

export const adminProductQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'products', id],
    queryFn: () => apiFetch<AdminProduct>(`/products/admin/${enc(id)}`),
  })

export const payloadBuildsQueryOptions = (productId: string, filters: BuildFilters = {}) =>
  queryOptions({
    queryKey: ['admin', 'products', productId, 'builds', filters],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams()
      if (filters.q?.trim()) params.set('q', filters.q.trim())
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      return apiFetch<PayloadBuild[]>(`/products/${enc(productId)}/payloads?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
  })

function invalidateProducts(): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
  void queryClient.invalidateQueries({ queryKey: ['catalog'] })
}

export type ProductInput = {
  slug?: string
  name?: string
  description?: string
  status?: ProductStatus
  sortOrder?: number
  maxHwidResets?: number | null
  hwidResetCooldownHours?: number | null
}

export function useCreateProduct() {
  return useMutation({
    mutationFn: (body: { slug: string; name: string; description?: string }) =>
      apiFetch<AdminProduct>('/products', { method: 'POST', body }),
    onSuccess: invalidateProducts,
  })
}

export function useUpdateProduct(id: string) {
  return useMutation({
    mutationFn: (body: ProductInput) => apiFetch<AdminProduct>(`/products/${enc(id)}`, { method: 'PATCH', body }),
    onSuccess: invalidateProducts,
  })
}

/** Правка любого товара из таблицы — id приходит вместе с полями. */
export function useUpdateAnyProduct() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProductInput }) =>
      apiFetch<AdminProduct>(`/products/${enc(id)}`, { method: 'PATCH', body }),
    onSuccess: invalidateProducts,
  })
}

export type CreatePlanInput = {
  slug: string
  name: string
  durationDays: number | null
  price: number
  currency?: string
  digisellerProductId?: number
  sortOrder?: number
}

export type UpdatePlanInput = {
  name?: string
  price?: number
  digisellerProductId?: number | null
  isActive?: boolean
  sortOrder?: number
}

export function useCreatePlan(productId: string) {
  return useMutation({
    mutationFn: (body: CreatePlanInput) =>
      apiFetch<AdminPlan>(`/products/${enc(productId)}/plans`, { method: 'POST', body }),
    onSuccess: invalidateProducts,
  })
}

export function useUpdatePlan() {
  return useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: UpdatePlanInput }) =>
      apiFetch<AdminPlan>(`/products/plans/${enc(planId)}`, { method: 'PATCH', body }),
    onSuccess: invalidateProducts,
  })
}

function invalidateBuilds(productId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'products', productId, 'builds'] })
  void queryClient.invalidateQueries({ queryKey: ['admin', 'products', productId], exact: true })
}

export function useCreateBuild(productId: string) {
  return useMutation({
    mutationFn: (body: { version: string; name?: string }) =>
      apiFetch<PayloadBuild>(`/products/${enc(productId)}/payloads`, { method: 'POST', body }),
    onSuccess: () => invalidateBuilds(productId),
  })
}

export function useRenameBuild(productId: string) {
  return useMutation({
    mutationFn: ({ buildId, name }: { buildId: string; name: string }) =>
      apiFetch<PayloadBuild>(`/products/payloads/${enc(buildId)}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => invalidateBuilds(productId),
  })
}

export function useSetPlanBuilds(productId: string) {
  return useMutation({
    mutationFn: ({ planId, buildIds }: { planId: string; buildIds: string[] }) =>
      apiFetch<{ build: BuildRef }[]>(`/products/plans/${enc(planId)}/builds`, { method: 'PUT', body: { buildIds } }),
    onSuccess: () => {
      invalidateBuilds(productId)
      invalidateProducts()
    },
  })
}

/** Черновик → ссылка → PUT в хранилище → подтверждение (sha256 считает сервер). */
export function useUploadBuild(productId: string) {
  return useMutation({
    mutationFn: async ({ buildId, file }: { buildId: string; file: File }) => {
      const target = await apiFetch<{ uploadUrl: string; objectKey: string }>(
        `/products/payloads/${enc(buildId)}/upload-url`,
        { method: 'POST', body: { filename: file.name, contentType: 'application/octet-stream' } }
      )
      const put = await fetch(target.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!put.ok) throw new Error(`upload failed: HTTP ${put.status}`)
      return apiFetch<PayloadBuild>(`/products/payloads/${enc(buildId)}/confirm-upload`, {
        method: 'POST',
        body: { objectKey: target.objectKey },
      })
    },
    onSuccess: () => invalidateBuilds(productId),
  })
}

export function usePublishBuild(productId: string) {
  return useMutation({
    mutationFn: ({ buildId, publish }: { buildId: string; publish: boolean }) =>
      apiFetch<PayloadBuild>(`/products/payloads/${enc(buildId)}/${publish ? 'publish' : 'unpublish'}`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateBuilds(productId),
  })
}

export function formatBytes(value: string | number | null | undefined): string {
  const bytes = Number(value ?? 0)
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
