import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Loader2, RotateCw, Search, Ticket } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '@/lib/api/client'
import { useT, type TFunction } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  LICENSE_STATUSES,
  licensesInfiniteQueryOptions,
  type LicenseStatus,
} from '@/features/licenses/api'
import { LicenseCard } from '@/features/licenses/license-card'
import { licenseStatusLabel } from '@/features/licenses/status-badge'

/**
 * Мои лицензии (план п. 3.9).
 *
 * `GET /licenses` — единственный маршрут списка: область видимости выбирает
 * сервер по правам, отдельного «моего» списка не существует. Пользователь с
 * `licenses.read.own` получает только свои строки.
 *
 * Фильтры живут в адресной строке, а не в состоянии компонента: ссылку на
 * «мои истёкшие» человек отправляет в поддержку как есть.
 */
const listSearchSchema = z.object({
  // .catch(undefined) обязателен: адрес правят руками и присылают ссылками,
  // а падение экрана из-за опечатки в параметре — худший из исходов.
  status: z.enum(LICENSE_STATUSES).optional().catch(undefined),
  /** Поиск по ключу лицензии (сервер ищет ещё и по логину владельца). */
  q: z.string().trim().min(1).max(128).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/')({
  validateSearch: listSearchSchema,
  component: LicensesPage,
})

const STATUS_ALL = 'ALL'

function LicensesPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [searchDraft, setSearchDraft] = useState(search.q ?? '')
  // ОБРАЗЕЦ ДЛЯ ОСТАЛЬНЫХ ЭКРАНОВ: один вызов `useT()` на компонент,
  // дальше `t('ключ')` вместо строкового литерала. Ничего больше не нужно —
  // ни провайдера, ни namespace, ни асинхронной загрузки словаря.
  const t = useT()

  const query = useInfiniteQuery(
    licensesInfiniteQueryOptions({ status: search.status, search: search.q })
  )

  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const total = query.data?.pages[0]?.total ?? 0
  const hasFilters = Boolean(search.status || search.q)

  function applySearch(value: string) {
    const next = value.trim()
    void navigate({
      search: (prev) => ({ ...prev, q: next.length > 0 ? next : undefined }),
    })
  }

  function applyStatus(value: string) {
    void navigate({
      search: (prev) => ({
        ...prev,
        status: value === STATUS_ALL ? undefined : (value as LicenseStatus),
      }),
    })
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {t('licenses.list.title')}
          </h1>
          <p className='text-sm text-muted-foreground'>
            {/*
              Текст с числом. `count` обязателен по типам, форму выбирает
              `Intl.PluralRules`: «1 лицензия» / «2 лицензии» / «5 лицензий»
              по-русски и «1 licence» / «2 licences» по-английски. Склеивать
              число со словом в коде экрана больше не нужно.
            */}
            {query.isSuccess
              ? t('licenses.list.count', { count: total })
              : t('licenses.list.loading')}
          </p>
        </div>

        <form
          className='flex flex-wrap items-center gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            applySearch(searchDraft)
          }}
        >
          <div className='relative'>
            <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t('licenses.list.search.placeholder')}
              className='w-56 pl-8'
              maxLength={128}
              // Подписи для скринридера переводятся ровно так же, как видимый
              // текст: их «видит» тот, кто читает экран не глазами.
              aria-label={t('licenses.list.search.aria')}
            />
          </div>

          <Select
            value={search.status ?? STATUS_ALL}
            onValueChange={applyStatus}
          >
            <SelectTrigger
              className='w-48'
              aria-label={t('licenses.list.status.aria')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STATUS_ALL}>
                {t('licenses.list.status.all')}
              </SelectItem>
              {LICENSE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {/* Значение остаётся машинным (`ACTIVE`), переводится только
                      подпись: фильтр в адресной строке обязан работать
                      одинаково на обоих языках. */}
                  {licenseStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button type='submit' variant='secondary'>
            {t('common.action.search')}
          </Button>
        </form>
      </div>

      {query.isPending && <ListSkeleton />}

      {query.isError && (
        <ListError error={query.error} onRetry={query.refetch} t={t} />
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState
          t={t}
          hasFilters={hasFilters}
          onReset={() => {
            setSearchDraft('')
            void navigate({ search: {} })
          }}
        />
      )}

      {items.length > 0 && (
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          {items.map((license) => (
            <LicenseCard key={license.id} license={license} />
          ))}
        </div>
      )}

      {/* «Показать ещё» считается по total с сервера, а не по длине страницы:
          последняя страница может оказаться ровно полной. */}
      {query.hasNextPage && (
        <div className='flex justify-center'>
          <Button
            variant='outline'
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage && (
              <Loader2 className='size-4 animate-spin' />
            )}
            {/* Числа подставляются, а не склеиваются в JSX: в другом языке
                порядок слов вокруг них другой. */}
            {t('common.action.showMore', { loaded: items.length, total })}
          </Button>
        </div>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className='h-64 w-full' />
      ))}
    </div>
  )
}

/**
 * Пустой список — два разных случая с разными действиями: «покупок ещё нет»
 * ведёт на активацию, «ничего не нашлось» — на сброс фильтров.
 */
function EmptyState({
  t,
  hasFilters,
  onReset,
}: {
  // `t` приходит параметром, а не вызывается внутри: вспомогательные
  // компоненты одного экрана берут его от родителя, чтобы подписка на язык
  // была одна на экран.
  t: TFunction
  hasFilters: boolean
  onReset: () => void
}) {
  if (hasFilters) {
    return (
      <div className='rounded-lg border border-dashed p-10 text-center'>
        <p className='font-medium'>{t('licenses.emptyFiltered.title')}</p>
        <p className='mt-1 text-sm text-muted-foreground'>
          {t('licenses.emptyFiltered.description')}
        </p>
        <Button variant='outline' className='mt-4' onClick={onReset}>
          <RotateCw className='size-4' />
          {t('common.action.resetFilters')}
        </Button>
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-dashed p-10 text-center'>
      <Ticket className='mx-auto size-8 text-muted-foreground' />
      <p className='mt-3 font-medium'>{t('licenses.empty.title')}</p>
      <p className='mt-1 text-sm text-muted-foreground'>
        {t('licenses.empty.description')}
      </p>
      {/* Две кнопки, а не одна: раньше здесь звали только активировать код,
          и человек без покупки упирался в тупик — где купить, не говорилось
          нигде. Каталог первым, потому что у пустого кабинета покупки обычно
          и нет. */}
      <div className='mt-4 flex flex-wrap justify-center gap-2'>
        <Button asChild>
          <Link to='/catalog'>{t('licenses.empty.action.catalog')}</Link>
        </Button>
        <Button asChild variant='outline'>
          <Link to='/activate'>{t('licenses.empty.action.activate')}</Link>
        </Button>
      </div>
    </div>
  )
}

/** 403 здесь означает нехватку права на чтение, а не чужие данные. */
function ListError({
  error,
  onRetry,
  t,
}: {
  error: unknown
  onRetry: () => void
  t: TFunction
}) {
  // Ветвление по `code` осталось прежним: коды — контракт, переводятся только
  // тексты вокруг них.
  if (error instanceof ApiError && error.code === 'FORBIDDEN') {
    return (
      <Alert>
        <AlertTitle>{t('licenses.error.forbidden.title')}</AlertTitle>
        <AlertDescription>
          {t('licenses.error.forbidden.description')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-3'>
      {/* Текст самой ошибки берётся из словаря кодов по `error.code`
          и приходит уже на нужном языке — здесь переводить нечего. */}
      <ApiErrorText error={error} fallback={t('licenses.error.load')} />
      <Button variant='outline' size='sm' onClick={onRetry}>
        <RotateCw className='size-4' />
        {t('common.action.retry')}
      </Button>
    </div>
  )
}
