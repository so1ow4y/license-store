import { keepPreviousData, queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'
import type { BulkResult } from '@/features/admin/bulk'

/**
 * Лицензии глазами администратора: список, блокировка, разблокировка.
 *
 * Маршруты и права — по `licenses.controller.ts`:
 *   GET  /licenses                 → licenses.read.any | licenses.read.own (:29)
 *   POST /licenses/:id/block       → licenses.block (:100)
 *   POST /licenses/:id/unblock     → licenses.block (:114)
 *
 * Область видимости выбирает сервер (`resolveScope`), а не мы: с правом
 * `licenses.read.any` придут все лицензии, с `.own` — только свои. Поэтому
 * административный экран гейтится именно по `.any`: иначе он молча превратился
 * бы в дубль пользовательского списка.
 *
 * Отзыв (`/revoke`) намеренно не выведен: он закрыт другим правом
 * (`orders.refund`) и означает возврат средств, а не наказание за нарушение.
 * Смешивать их в одной кнопке — прямой путь к отзыву вместо блокировки.
 */

/**
 * Статусы лицензии — общий словарь кабинета (`features/licenses`).
 *
 * Свой список был бы вторым источником правды: K6 писал «Не активирована»
 * там, где кабинет пишет «Ожидает запуска», и один и тот же статус читался
 * администратором и покупателем по-разному — при разборе обращения это прямая
 * дорога к неверному выводу.
 */
export {
  LICENSE_STATUSES,
  type LicenseStatus,
} from '@/features/licenses/api'
export { licenseStatusLabel } from '@/features/licenses/status-badge'
import type { LicenseStatus } from '@/features/licenses/api'

/**
 * Строка списка: сервер собирает её явным `select` (`LICENSE_PUBLIC_SELECT`
 * в `licenses.service.ts`) и прогоняет через `toPublic`, который заменяет
 * `key` на `maskedKey`. Перечислены только те поля, которые экран
 * действительно показывает.
 *
 * Тот же тип описывает результат мутаций block/unblock/extend/revoke —
 * они возвращают лицензию через тот же `toPublic`, то есть тоже с маской.
 */
export type AdminLicense = {
  id: string
  /**
   * Маска. Полного ключа администратор в списке НЕ получает — и это
   * не недосмотр: админский список показывает ЧУЖИЕ лицензии пачками
   * по двадцать пять, и раздавать в нём предъявительские документы
   * нельзя тем более. Полное значение — по кнопке, через
   * GET /licenses/:id/key, с записью в журнал аудита.
   */
  maskedKey: string
  status: LicenseStatus
  userId: string | null
  issuedAt: string
  activatedAt: string | null
  /** NULL = бессрочная (тариф без `durationDays`). */
  expiresAt: string | null
  blockedAt: string | null
  blockedReason: string | null
  revokedAt: string | null
  revokedReason: string | null
  notes: string | null
  createdAt: string
  productId: string
  /** Закреплённая сборка; null — загрузчик берёт сборку тарифа. */
  buildId: string | null
  product: { slug: string; name: string }
  plan: { slug: string; name: string; durationDays: number | null }
  user: { id: string; username: string } | null
  build: { id: string; name: string; version: string } | null
  /** Реселлер, чьим ключом выдана лицензия. */
  reseller?: { id: string; displayName: string } | null
  /** Откуда лицензия и кто её активировал (только в списке для админа). */
  origin?: LicenseOrigin | null
}

export type LicenseOrigin = {
  source:
    | { kind: 'reseller'; name: string }
    | { kind: 'order'; number: string; channel: 'WEBSITE' | 'DIGISELLER' | 'MANUAL' | 'REGISTRATION_KEY' }
    | { kind: 'admin'; by: string | null }
    | { kind: 'key'; by: string | null }
    | { kind: 'unknown' }
  /** Кто погасил ключ (или кому выдана) и когда. */
  activatedBy: { username: string | null; at: string | null } | null
}

/** Поля строки поиска — те же, что разбирает сервер (`LICENSE_FIELDS`). */
export const LICENSE_SEARCH_FIELDS = ['key', 'user', 'product', 'plan', 'status', 'build', 'reseller', 'id'] as const

export type AdminLicenseList = {
  items: AdminLicense[]
  total: number
  skip: number
  take: number
}

export type LicenseFilters = {
  status?: LicenseStatus
  search?: string
  /** Строка «поле:значение» с AND/OR/NOT и скобками. */
  q?: string
  /** Дата выдачи: не раньше / не позже (ISO). */
  from?: string
  to?: string
  /** Лицензии одного пользователя (карточка пользователя в панели). */
  userId?: string
  skip: number
  take: number
}

/** Размер страницы. Сервер разрешает до 200 (`ListLicensesDto`, @Max(200)). */
export const LICENSES_PAGE_SIZE = 25

/**
 * Сборка query-строки.
 *
 * Пустые значения не отправляем вовсе: `search=''` сервер примет, но фильтр
 * `contains: ''` вернёт всё и создаст ложное впечатление работающего поиска,
 * а лишние ключи в query отвергаются валидацией с `forbidNonWhitelisted`.
 */
function buildQuery(filters: LicenseFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  if (filters.q?.trim()) params.set('q', filters.q.trim())
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.skip > 0) params.set('skip', String(filters.skip))
  params.set('take', String(filters.take))
  return params.toString()
}

export const licensesQueryKey = (filters: LicenseFilters) =>
  ['admin', 'licenses', filters] as const

export const adminLicensesQueryOptions = (filters: LicenseFilters) =>
  queryOptions({
    queryKey: licensesQueryKey(filters),
    queryFn: ({ signal }) =>
      apiFetch<AdminLicenseList>(`/licenses?${buildQuery(filters)}`, { signal }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  })

/** Любая правка лицензии обесценивает все страницы списка сразу. */
function invalidateLicenses(): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'licenses'] })
}

/**
 * Блокировка. Причина обязательна и попадает в аудит и в карточку лицензии:
 * `BlockLicenseDto` требует непустую строку до 1000 символов.
 */
export function useBlockLicense() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch<AdminLicense>(
        `/licenses/${encodeURIComponent(id)}/block`,
        { method: 'POST', body: { reason } }
      ),
    onSuccess: invalidateLicenses,
  })
}

/**
 * Разблокировка. Тела нет — лишнее поле дало бы 400.
 *
 * Возвращает лицензию в состояние, соответствующее сроку: истёкшая станет
 * EXPIRED, а не ACTIVE (`licenses.service.ts:256-263`). Это нужно объяснить
 * в UI, иначе снятие блокировки выглядит как несработавшее.
 */
export function useUnblockLicense() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<AdminLicense>(`/licenses/${encodeURIComponent(id)}/unblock`, {
        method: 'POST',
      }),
    onSuccess: invalidateLicenses,
  })
}

/** Массовая блокировка или разблокировка (POST /licenses/bulk, до 500 за раз). */
export function useBulkLicenses() {
  return useMutation({
    mutationFn: (body: { action: 'block' | 'unblock'; ids: string[]; reason?: string }) =>
      apiFetch<BulkResult>('/licenses/bulk', { method: 'POST', body }),
    onSuccess: invalidateLicenses,
  })
}

/** Закрепить сборку из хранилища товара за лицензией (null — снять). */
export function useSetLicenseBuild() {
  return useMutation({
    mutationFn: ({ id, buildId }: { id: string; buildId: string | null }) =>
      apiFetch<AdminLicense>(`/licenses/${encodeURIComponent(id)}/build`, { method: 'PATCH', body: { buildId } }),
    onSuccess: invalidateLicenses,
  })
}
