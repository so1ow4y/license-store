/**
 * Лицензии пользователя (план п. 3.9–3.10).
 *
 * Маршруты и форма ответов сверены по `apps/api/src/modules/licenses`:
 * `licenses.controller.ts` (пути и права) и `licenses.service.ts`
 * (`list` — `{items,total,skip,take}` с include product/plan/user,
 *  `findById` — та же лицензия плюс полный тариф и последние 20 записей
 *  истории привязок).
 *
 * Область видимости выбирает сервер по правам: обычный пользователь с
 * `licenses.read.own` видит только свои лицензии, отдельного «моего» маршрута
 * не существует.
 */
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { t } from '@/lib/i18n'
import type { HwidHistoryEntry } from '@/features/hwid/api'

export const LICENSE_STATUSES = [
  'PENDING',
  'ACTIVE',
  'EXPIRED',
  'BLOCKED',
  'REVOKED',
] as const

export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

export function isLicenseStatus(value: unknown): value is LicenseStatus {
  return (
    typeof value === 'string' &&
    (LICENSE_STATUSES as readonly string[]).includes(value)
  )
}

/** Продукт в ответе списка: `select: { slug, name }`. */
export type LicenseProduct = { slug: string; name: string }

/** Тариф. `durationDays === null` означает Lifetime, а не «ошибка данных». */
export type LicensePlan = {
  slug: string
  name: string
  durationDays: number | null
}

export type LicenseListItem = {
  id: string
  /**
   * Маска вида `FC26-****-****-****-QRTU`. Полный ключ выдаёт только
   * GET /licenses/:id/key — по явному нажатию и с записью в аудит
   * (см. `fetchLicenseKey`).
   */
  maskedKey: string
  status: LicenseStatus
  issuedAt: string
  /** NULL, пока лицензию не запускали: срок ещё не начат. */
  activatedAt: string | null
  /** NULL — либо ещё не активирована, либо бессрочная. Различает статус. */
  expiresAt: string | null
  blockedReason: string | null
  revokedReason: string | null
  /** NULL — привязки к устройству нет. */
  currentDeviceId: string | null
  hwidResetCount: number
  lastHwidResetAt: string | null
  lastCheckAt: string | null
  lastClientVersion: string | null
  createdAt: string
  product: LicenseProduct
  plan: LicensePlan
}

export type LicenseListResponse = {
  items: LicenseListItem[]
  total: number
  skip: number
  take: number
}

/**
 * Карточка лицензии. Отличается от строки списка полным тарифом и вложенной
 * историей привязок — её сервер отдаёт владельцу без права `hwid.history.read`.
 */
export type LicenseDetail = LicenseListItem & {
  /**
   * Здесь тариф приходит целиком (`plan: true`). Цену в тип не выносим:
   * Prisma отдаёт Decimal, форма его сериализации в JSON не гарантирована,
   * а кабинету цена не нужна — за деньги отвечает экран активации.
   */
  plan: LicensePlan & { id: string }
  notes: string | null
  /** Последние 20 событий привязки — приходят владельцу без отдельного права. */
  hwidHistory: HwidHistoryEntry[]
}

export type LicenseFilters = {
  status?: LicenseStatus
  search?: string
}

/** Сервер режет `take` до 200; берём страницами поменьше — список карточек. */
export const LICENSES_PAGE_SIZE = 25

export const licenseKeys = {
  all: ['licenses'] as const,
  lists: () => ['licenses', 'list'] as const,
  list: (filters: LicenseFilters) =>
    ['licenses', 'list', filters.status ?? null, filters.search ?? null] as const,
  detail: (licenseId: string) => ['licenses', 'detail', licenseId] as const,
}

/**
 * Строка запроса строго из заданных фильтров.
 *
 * Пустые значения не отправляем: `ListLicensesDto` валидирует `search` как
 * непустую строку по длине, а `status` — по перечислению, и пустой параметр
 * вернул бы 400 вместо «фильтр не выбран».
 */
function buildListQuery(filters: LicenseFilters, skip: number): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.search) params.set('search', filters.search)
  params.set('skip', String(skip))
  params.set('take', String(LICENSES_PAGE_SIZE))
  return params.toString()
}

/**
 * Постраничный список с кнопкой «показать ещё».
 *
 * Именно постраничный, а не «увеличиваем take»: сервер ограничивает take
 * двумястами, и на 201-й лицензии рост параметра упёрся бы в 400.
 */
export function licensesInfiniteQueryOptions(filters: LicenseFilters) {
  return infiniteQueryOptions({
    queryKey: licenseKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      apiFetch<LicenseListResponse>(
        `/licenses?${buildListQuery(filters, pageParam)}`,
        { signal }
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.skip + lastPage.items.length
      return loaded < lastPage.total ? loaded : undefined
    },
  })
}

export function licenseQueryOptions(licenseId: string) {
  return queryOptions({
    queryKey: licenseKeys.detail(licenseId),
    queryFn: ({ signal }) =>
      apiFetch<LicenseDetail>(`/licenses/${encodeURIComponent(licenseId)}`, {
        signal,
      }),
  })
}

/**
 * Полный ключ лицензии — по одному, по явному действию владельца.
 *
 * НАМЕРЕННО НЕ queryOptions И НЕ useQuery: результат не должен попасть
 * в кеш react-query. Кеш переживает уход со страницы, отдаётся из памяти
 * повторным потребителям и виден в devtools целиком — то есть кешированный
 * ключ ровно тем и плох, чем плох был ключ в списке.
 *
 * Каждый вызов пишется на сервере в журнал аудита как `license.key.reveal`.
 * Поэтому дёргать функцию «на всякий случай», заранее или в цикле нельзя:
 * шум в журнале сделает его бесполезным именно тогда, когда по нему будут
 * разбирать настоящую утечку.
 */
export function fetchLicenseKey(licenseId: string): Promise<string> {
  return apiFetch<{ key: string }>(
    `/licenses/${encodeURIComponent(licenseId)}/key`
  ).then((response) => response.key)
}

/**
 * Человеческое описание срока тарифа. NULL — бессрочный.
 *
 * Числительное больше не склеивается из числа и хвоста руками: форму выбирает
 * словарь через `Intl.PluralRules`. Английскому нужны две формы, русскому три,
 * и правило «какая когда» — свойство языка, а не этого файла.
 */
export function planDurationText(durationDays: number | null): string {
  if (durationDays === null) return t('licenses.plan.lifetime')
  if (durationDays % 365 === 0) {
    return t('licenses.plan.years', { count: durationDays / 365 })
  }
  if (durationDays % 30 === 0) {
    return t('licenses.plan.months', { count: durationDays / 30 })
  }
  return t('licenses.plan.days', { count: durationDays })
}
