import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Minus, Plus, Search, X } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  BulkBar,
  BulkConfirmDialog,
  PageCheckbox,
  RowCheckbox,
  toastBulkResult,
  useSelection,
  type BulkResult,
} from '@/features/admin/bulk'
import { AdminErrorText } from '@/features/admin/error-text'
import { useBulkUsers } from '@/features/admin-users/api'
import {
  RANGES,
  SEARCH_FIELDS,
  logSearchQueryOptions,
  logStatsQueryOptions,
  rangeFrom,
  useBulkIpBlock,
  withTerm,
  type AuditEvent,
  type LogKind,
  type LogStats,
  type LoginEvent,
  type RangeKey,
} from './api'

const PAGE = 50

/** Колонки с фильтром по полю: что вводится в шапке таблицы, уходит условием `поле:значение`. */
const COLUMN_FILTERS: Record<LogKind, string[]> = {
  audit: ['actor', 'action', 'entity', 'ip'],
  logins: ['user', 'result', 'reason', 'ip'],
}

/**
 * Обозреватель журнала в духе SIEM: строка запроса «поле:значение», диапазон
 * времени, гистограмма, топ значений по полям (клик — добавить условие,
 * минус — исключить), фильтры в шапке колонок, раскрытие строки.
 */
export function LogExplorer({ kind }: { kind: LogKind }) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [range, setRange] = useState<RangeKey>('24h')
  const [from, setFrom] = useState(() => rangeFrom('24h'))
  const [skip, setSkip] = useState(0)
  const [columns, setColumns] = useState<Record<string, string>>({})
  const [columnDraft, setColumnDraft] = useState<Record<string, string>>({})

  const fullQ = [
    q,
    ...Object.entries(columns)
      .filter(([, value]) => value.trim())
      .map(([field, value]) => `${field}:${/\s/.test(value) ? `"${value.trim()}"` : value.trim()}`),
  ]
    .filter(Boolean)
    .join(' ')

  const items = useQuery(logSearchQueryOptions(kind, { q: fullQ, from, skip, take: PAGE }))
  const stats = useQuery(logStatsQueryOptions(kind, { q: fullQ, from }))

  // Массовые действия над выбранными строками: адреса и пользователи берутся
  // из строк, которые уже видели (выбор переживает смену страницы).
  const { can } = useSession()
  const canBlockIps = can(PERMISSIONS.SECURITY_IP_BLOCK)
  const canBlockUsers = can(PERMISSIONS.USERS_BLOCK)
  const canSelect = canBlockIps || canBlockUsers
  const selection = useSelection()
  const seen = useRef(new Map<string, { ip: string | null; userId: string | null }>())
  const [bulkAction, setBulkAction] = useState<'blockIps' | 'blockActors' | null>(null)
  const bulkIps = useBulkIpBlock()
  const bulkUsers = useBulkUsers()
  const bulkMutation = bulkAction === 'blockIps' ? bulkIps : bulkUsers
  const rows = items.data?.items

  useEffect(() => {
    for (const row of rows ?? []) {
      const userId = 'actorId' in row ? row.actorId : row.userId
      seen.current.set(row.id, { ip: row.ip, userId })
    }
  }, [rows])

  function picked(key: 'ip' | 'userId'): string[] {
    const values = new Set<string>()
    for (const id of selection.ids) {
      const value = seen.current.get(id)?.[key]
      if (value) values.add(value)
    }
    return [...values]
  }

  function runBulk(input: { reason?: string; expiresInHours?: number }) {
    const done = {
      onSuccess: (result: BulkResult) => {
        toastBulkResult(result)
        setBulkAction(null)
        selection.clear()
      },
    }
    if (bulkAction === 'blockIps') bulkIps.mutate({ values: picked('ip'), ...input }, done)
    else if (bulkAction === 'blockActors') bulkUsers.mutate({ action: 'block', ids: picked('userId'), reason: input.reason }, done)
  }

  function apply(nextQ: string, nextRange: RangeKey = range) {
    setDraft(nextQ)
    setQ(nextQ)
    setRange(nextRange)
    setFrom(rangeFrom(nextRange))
    setSkip(0)
  }

  function addTerm(field: string, value: string, negate = false) {
    apply(withTerm(q, field, value, negate))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    apply(draft)
  }

  const total = items.data?.total ?? 0

  return (
    <div className='space-y-4'>
      <form onSubmit={onSubmit} className='space-y-2'>
        <div className='flex flex-wrap gap-2'>
          <div className='relative min-w-64 flex-1'>
            <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t(`siem.placeholder.${kind}`)}
              className='pl-8 font-mono text-sm'
              spellCheck={false}
            />
          </div>
          <Select value={range} onValueChange={(value) => apply(draft, value as RangeKey)}>
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`siem.range.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type='submit'>{t('common.action.search')}</Button>
          {(q || Object.values(columns).some(Boolean)) && (
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                setColumns({})
                setColumnDraft({})
                apply('')
              }}
            >
              <X className='size-4' />
              {t('common.action.resetFilters')}
            </Button>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
          <span>{t('siem.fields')}</span>
          {SEARCH_FIELDS[kind].map((field) => (
            <button
              key={field}
              type='button'
              onClick={() => setDraft((d) => `${d.trim()} ${field}:`.trim())}
              className='rounded-md border px-1.5 py-0.5 font-mono hover:bg-accent hover:text-foreground'
            >
              {field}:
            </button>
          ))}
          <span className='ms-1'>{t('siem.syntax')}</span>
        </div>
      </form>

      <AdminErrorText error={items.error ?? stats.error} />

      <div className='grid gap-4 xl:grid-cols-[1fr_18rem]'>
        <div className='min-w-0 space-y-4'>
          <Histogram stats={stats.data} loading={stats.isPending} withFailures={kind === 'logins'} />

          <BulkBar selection={selection}>
            {canBlockIps && (
              <Button size='sm' variant='destructive' onClick={() => setBulkAction('blockIps')}>
                {t('admin.bulk.blockIps')}
              </Button>
            )}
            {canBlockUsers && (
              <Button size='sm' variant='outline' onClick={() => setBulkAction('blockActors')}>
                {t(kind === 'audit' ? 'admin.bulk.blockActors' : 'admin.bulk.blockUsers')}
              </Button>
            )}
          </BulkBar>

          {items.isPending ? (
            <Skeleton className='h-64 w-full' />
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  {kind === 'audit' ? (
                    <AuditHead select={canSelect ? <PageCheckbox selection={selection} pageIds={(rows ?? []).map((r) => r.id)} /> : null} />
                  ) : (
                    <LoginsHead select={canSelect ? <PageCheckbox selection={selection} pageIds={(rows ?? []).map((r) => r.id)} /> : null} />
                  )}
                  <TableRow className='hover:bg-transparent'>
                    {canSelect && <TableHead />}
                    <TableHead />
                    {(kind === 'audit' ? ['', ...COLUMN_FILTERS.audit] : ['', ...COLUMN_FILTERS.logins, '']).map(
                      (field, i) => (
                        <TableHead key={`${field}-${i}`} className='py-1'>
                          {field && (
                            <Input
                              value={columnDraft[field] ?? ''}
                              placeholder={`${field}…`}
                              className='h-7 font-mono text-xs'
                              onChange={(e) => setColumnDraft({ ...columnDraft, [field]: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  setColumns({ ...columnDraft })
                                  setSkip(0)
                                }
                              }}
                              onBlur={() => setColumns({ ...columnDraft })}
                            />
                          )}
                        </TableHead>
                      )
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.data?.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className='py-8 text-center text-muted-foreground'>
                        {t('siem.empty')}
                      </TableCell>
                    </TableRow>
                  )}
                  {kind === 'audit'
                    ? (items.data?.items as AuditEvent[] | undefined)?.map((event) => (
                        <AuditRow
                          key={event.id}
                          event={event}
                          onFilter={addTerm}
                          select={canSelect ? <RowCheckbox selection={selection} id={event.id} /> : null}
                          selected={selection.has(event.id)}
                        />
                      ))
                    : (items.data?.items as LoginEvent[] | undefined)?.map((event) => (
                        <LoginRow
                          key={event.id}
                          event={event}
                          onFilter={addTerm}
                          select={canSelect ? <RowCheckbox selection={selection} id={event.id} /> : null}
                          selected={selection.has(event.id)}
                        />
                      ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className='flex items-center justify-between text-sm text-muted-foreground'>
            <span>{t('siem.total', { total })}</span>
            <div className='flex gap-2'>
              <Button variant='outline' size='sm' disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>
                {t('common.action.prevPage')}
              </Button>
              <Button variant='outline' size='sm' disabled={skip + PAGE >= total} onClick={() => setSkip(skip + PAGE)}>
                {t('common.action.nextPage')}
              </Button>
            </div>
          </div>
        </div>

        <Facets stats={stats.data} onFilter={addTerm} />
      </div>

      <BulkConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBulkAction(null)
            bulkMutation.reset()
          }
        }}
        title={bulkAction ? t(`admin.bulk.title.${bulkAction}`) : ''}
        count={bulkAction === 'blockIps' ? picked('ip').length : picked('userId').length}
        reason={bulkAction === 'blockIps' ? 'optional' : 'required'}
        duration={bulkAction === 'blockIps'}
        destructive
        pending={bulkMutation.isPending}
        error={bulkMutation.error}
        onConfirm={runBulk}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Histogram({ stats, loading, withFailures }: { stats?: LogStats; loading: boolean; withFailures: boolean }) {
  const t = useT()
  if (loading && !stats) return <Skeleton className='h-24 w-full' />
  const buckets = stats?.histogram ?? []
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div className='rounded-md border p-3'>
      <div className='mb-2 flex items-center justify-between text-xs text-muted-foreground'>
        <span>{t('siem.histogram')}</span>
        {stats && <span>{t('siem.interval', { interval: stats.interval })}</span>}
      </div>
      {buckets.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>{t('siem.empty')}</p>
      ) : (
        <div className='flex h-20 items-end gap-px'>
          {buckets.map((bucket) => (
            <div
              key={bucket.bucket}
              title={`${formatDateTime(bucket.bucket)} — ${bucket.count}${withFailures ? ` (${t('siem.failed')}: ${bucket.failed ?? 0})` : ''}`}
              className='flex min-w-[3px] flex-1 flex-col justify-end'
              style={{ height: '100%' }}
            >
              {withFailures && (bucket.failed ?? 0) > 0 && (
                <div className='rounded-t-sm bg-destructive/80' style={{ height: `${((bucket.failed ?? 0) / max) * 100}%` }} />
              )}
              <div
                className={cn('bg-primary/70', !(withFailures && (bucket.failed ?? 0) > 0) && 'rounded-t-sm')}
                style={{ height: `${((bucket.count - (withFailures ? (bucket.failed ?? 0) : 0)) / max) * 100}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Facets({ stats, onFilter }: { stats?: LogStats; onFilter: (field: string, value: string, negate?: boolean) => void }) {
  const t = useT()
  if (!stats) return <Skeleton className='h-64 w-full' />
  return (
    <aside className='space-y-4'>
      {stats.facets.map((facet) => {
        const max = Math.max(1, ...facet.values.map((v) => v.count))
        return (
          <div key={facet.field} className='rounded-md border p-3'>
            <p className='mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
              {t('siem.top', { field: facet.field })}
            </p>
            {facet.values.length === 0 && <p className='text-xs text-muted-foreground'>—</p>}
            <ul className='space-y-1'>
              {facet.values.map((v) => (
                <li key={v.value} className='group relative flex items-center gap-1 text-xs'>
                  <span className='absolute inset-y-0 left-0 rounded bg-primary/10' style={{ width: `${(v.count / max) * 100}%` }} />
                  <button
                    type='button'
                    onClick={() => onFilter(facet.field, v.value)}
                    className='relative min-w-0 flex-1 truncate px-1.5 py-1 text-start font-mono hover:text-primary'
                    title={v.value}
                  >
                    {v.value}
                  </button>
                  <span className='relative tabular-nums text-muted-foreground'>{v.count}</span>
                  <button
                    type='button'
                    onClick={() => onFilter(facet.field, v.value)}
                    className='relative opacity-0 group-hover:opacity-100'
                    aria-label={t('siem.include')}
                  >
                    <Plus className='size-3.5' />
                  </button>
                  <button
                    type='button'
                    onClick={() => onFilter(facet.field, v.value, true)}
                    className='relative opacity-0 group-hover:opacity-100'
                    aria-label={t('siem.exclude')}
                  >
                    <Minus className='size-3.5' />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </aside>
  )
}

/** Значение в ячейке: клик добавляет его условием в строку поиска. */
function Value({ field, value, onFilter, children }: { field: string; value: string | null; onFilter: (f: string, v: string) => void; children?: ReactNode }) {
  if (!value) return <span className='text-muted-foreground'>—</span>
  return (
    <button
      type='button'
      onClick={(e) => {
        e.stopPropagation()
        onFilter(field, value)
      }}
      className='max-w-56 truncate text-start underline-offset-4 hover:text-primary hover:underline'
      title={value}
    >
      {children ?? value}
    </button>
  )
}

function AuditHead({ select }: { select: ReactNode }) {
  const t = useT()
  return (
    <TableRow>
      {select && <TableHead className='w-8'>{select}</TableHead>}
      <TableHead className='w-8' />
      <TableHead>{t('siem.column.time')}</TableHead>
      <TableHead>{t('siem.column.actor')}</TableHead>
      <TableHead>{t('siem.column.action')}</TableHead>
      <TableHead>{t('siem.column.entity')}</TableHead>
      <TableHead>{t('siem.column.ip')}</TableHead>
    </TableRow>
  )
}

function AuditRow({
  event,
  onFilter,
  select,
  selected,
}: {
  event: AuditEvent
  onFilter: (f: string, v: string) => void
  select: ReactNode
  selected: boolean
}) {
  const [open, setOpen] = useState(false)
  const actor = event.actorUsername ?? event.actorLabel
  return (
    <Fragment>
      <TableRow className='cursor-pointer' data-state={selected ? 'selected' : undefined} onClick={() => setOpen(!open)}>
        {select && <TableCell onClick={(e) => e.stopPropagation()}>{select}</TableCell>}
        <TableCell>{open ? <ChevronDown className='size-4' /> : <ChevronRight className='size-4' />}</TableCell>
        <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(event.createdAt)}</TableCell>
        <TableCell>
          <Value field='actor' value={actor} onFilter={onFilter} />
          <span className='block text-[11px] text-muted-foreground'>{event.actorType}</span>
        </TableCell>
        <TableCell className='font-mono text-xs'>
          <Value field='action' value={event.action} onFilter={onFilter} />
        </TableCell>
        <TableCell className='text-xs'>
          <Value field='entity' value={event.entityType} onFilter={onFilter} />
        </TableCell>
        <TableCell className='font-mono text-xs'>
          <Value field='ip' value={event.ip} onFilter={onFilter} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className='hover:bg-transparent'>
          <TableCell colSpan={select ? 7 : 6} className='bg-muted/30'>
            <Details
              rows={[
                ['entityId', event.entityId],
                ['request', event.requestId],
                ['userAgent', event.userAgent],
              ]}
              onFilter={onFilter}
            />
            <div className='mt-2 grid gap-2 md:grid-cols-2'>
              <Json label='before' value={event.before} />
              <Json label='after' value={event.after} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}

function LoginsHead({ select }: { select: ReactNode }) {
  const t = useT()
  return (
    <TableRow>
      {select && <TableHead className='w-8'>{select}</TableHead>}
      <TableHead className='w-8' />
      <TableHead>{t('siem.column.time')}</TableHead>
      <TableHead>{t('siem.column.user')}</TableHead>
      <TableHead>{t('siem.column.result')}</TableHead>
      <TableHead>{t('siem.column.reason')}</TableHead>
      <TableHead>{t('siem.column.ip')}</TableHead>
      <TableHead>{t('siem.column.method')}</TableHead>
    </TableRow>
  )
}

function LoginRow({
  event,
  onFilter,
  select,
  selected,
}: {
  event: LoginEvent
  onFilter: (f: string, v: string) => void
  select: ReactNode
  selected: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Fragment>
      <TableRow className='cursor-pointer' data-state={selected ? 'selected' : undefined} onClick={() => setOpen(!open)}>
        {select && <TableCell onClick={(e) => e.stopPropagation()}>{select}</TableCell>}
        <TableCell>{open ? <ChevronDown className='size-4' /> : <ChevronRight className='size-4' />}</TableCell>
        <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(event.createdAt)}</TableCell>
        <TableCell>
          <Value field='user' value={event.username ?? event.identifierUsed} onFilter={onFilter} />
        </TableCell>
        <TableCell>
          <Badge variant={event.success ? 'outline' : 'destructive'}>
            {event.success ? t('siem.success') : t('siem.failed')}
          </Badge>
        </TableCell>
        <TableCell className='text-xs'>
          <Value field='reason' value={event.failureReason} onFilter={onFilter} />
        </TableCell>
        <TableCell className='font-mono text-xs'>
          <Value field='ip' value={event.ip} onFilter={onFilter} />
          {event.country && <span className='ms-1 text-muted-foreground'>{event.country}</span>}
        </TableCell>
        <TableCell className='text-xs'>
          <Value field='method' value={event.method} onFilter={onFilter} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className='hover:bg-transparent'>
          <TableCell colSpan={select ? 8 : 7} className='bg-muted/30'>
            <Details
              rows={[
                ['identifier', event.identifierUsed],
                ['userId', event.userId],
                ['client', event.clientVersion],
                ['userAgent', event.userAgent],
              ]}
              onFilter={onFilter}
            />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}

function Details({ rows }: { rows: [string, string | null][]; onFilter: (f: string, v: string) => void }) {
  return (
    <dl className='grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]'>
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='font-mono break-all'>{value}</dd>
          </Fragment>
        ))}
    </dl>
  )
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null
  return (
    <div className='min-w-0'>
      <p className='mb-1 text-xs text-muted-foreground'>{label}</p>
      <pre className='max-h-64 overflow-auto rounded-md bg-background p-2 font-mono text-[11px]'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
