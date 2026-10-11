import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/lib/api/query-client'
import { Link } from '@tanstack/react-router'
import { Ban, ChevronRight, Filter, Minus, Plus, Search, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { ACTIVE_ROW, CURSOR_ROW, PanelFacts, PanelSection, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { TimeRangePicker, useTimeRange, zoomRange } from '@/features/admin/time-range'
import { useBulkUsers } from '@/features/admin-users/api'
import {
  SEARCH_FIELDS,
  logSearchQueryOptions,
  logStatsQueryOptions,
  useBulkIpBlock,
  useCreateIpBlock,
  withTerm,
  type AuditEvent,
  type LogKind,
  type LogStats,
  type LoginEvent,
} from './api'
import { TimeHistogram } from './histogram'
import { IpContextSection, UserAgentFacts } from './ip-context'

const PAGE = 50

/** Колонки с фильтром по полю: что вводится в шапке таблицы, уходит условием `поле:значение`. */
const COLUMN_FILTERS: Record<LogKind, string[]> = {
  audit: ['actor', 'action', 'entity', 'ip'],
  logins: ['user', 'result', 'reason', 'ip'],
}

/**
 * Обозреватель журнала в духе SIEM: строка запроса «поле:значение», диапазон
 * времени, гистограмма, топ значений по полям (клик — добавить условие,
 * минус — исключить), фильтры в шапке колонок. Клик по строке открывает
 * событие в панели справа: все поля, изменения и быстрые действия.
 */
export function LogExplorer({ kind, initial }: { kind: LogKind; initial?: { q?: string; from?: string; to?: string } }) {
  const t = useT()
  const [opened, setOpened] = useState<AuditEvent | LoginEvent | null>(null)
  const [draft, setDraft] = useState(initial?.q ?? '')
  const [q, setQ] = useState(initial?.q ?? '')
  // Переход со сработки или дашборда приносит точный период; иначе — сутки.
  const time = useTimeRange(initial?.from ? { kind: 'absolute', from: initial.from, to: initial.to } : { kind: 'relative', amount: 24, unit: 'h' }, () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'security', kind] })
  })
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

  const items = useQuery(logSearchQueryOptions(kind, { q: fullQ, ...time.resolved, skip, take: PAGE }))
  const stats = useQuery(logStatsQueryOptions(kind, { q: fullQ, ...time.resolved }))

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

  const cursor = useListHotkeys({
    ids: (rows ?? []).map((r) => r.id),
    openedId: opened?.id ?? null,
    onOpen: (id) => setOpened((rows ?? []).find((r) => r.id === id) ?? null),
    onClose: () => setOpened(null),
  })

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

  function apply(nextQ: string) {
    setDraft(nextQ)
    setQ(nextQ)
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
          <TimeRangePicker state={time} onChange={() => setSkip(0)} />
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
          <TimeHistogram
            buckets={stats.data?.histogram}
            intervalMs={stats.data?.intervalMs}
            range={time.resolved}
            loading={stats.isPending}
            withFailures={kind === 'logins'}
            onZoom={(from, to) => {
              time.setRange(zoomRange(from, to))
              setSkip(0)
            }}
          />

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
                          active={opened?.id === event.id}
                          cursor={cursor === event.id}
                          onOpen={() => setOpened(opened?.id === event.id ? null : event)}
                        />
                      ))
                    : (items.data?.items as LoginEvent[] | undefined)?.map((event) => (
                        <LoginRow
                          key={event.id}
                          event={event}
                          onFilter={addTerm}
                          select={canSelect ? <RowCheckbox selection={selection} id={event.id} /> : null}
                          selected={selection.has(event.id)}
                          active={opened?.id === event.id}
                          cursor={cursor === event.id}
                          onOpen={() => setOpened(opened?.id === event.id ? null : event)}
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

      {opened && (
        <EventPanel
          kind={kind}
          event={opened}
          onClose={() => setOpened(null)}
          onFilter={(field, value, negate) => addTerm(field, value, negate)}
        />
      )}
    </div>
  )
}

/**
 * Событие журнала в панели справа — как карточка сработки в SIEM: все поля,
 * что изменилось, и действия по нему: отфильтровать по значению, исключить
 * его, заблокировать адрес, открыть пользователя.
 */
function EventPanel({
  kind,
  event,
  onClose,
  onFilter,
}: {
  kind: LogKind
  event: AuditEvent | LoginEvent
  onClose: () => void
  onFilter: (field: string, value: string, negate?: boolean) => void
}) {
  const t = useT()
  const { can } = useSession()
  const blockIp = useCreateIpBlock()
  const audit = kind === 'audit' ? (event as AuditEvent) : null
  const login = kind === 'logins' ? (event as LoginEvent) : null
  const userId = audit ? audit.actorId : login!.userId
  const userLabel = audit ? (audit.actorUsername ?? audit.actorLabel) : (login!.username ?? login!.identifierUsed)

  const filterable = (field: string, value: string | null, children?: ReactNode) =>
    value ? (
      <span className='group inline-flex items-center gap-1'>
        <span className='font-mono text-xs break-all'>{children ?? value}</span>
        <button type='button' onClick={() => onFilter(field, value)} title={t('siem.include')} className='text-muted-foreground opacity-60 hover:text-primary hover:opacity-100'>
          <Plus className='size-3.5' />
        </button>
        <button type='button' onClick={() => onFilter(field, value, true)} title={t('siem.exclude')} className='text-muted-foreground opacity-60 hover:text-destructive hover:opacity-100'>
          <Minus className='size-3.5' />
        </button>
      </span>
    ) : (
      '—'
    )

  return (
    <SidePanel
      open
      onClose={onClose}
      title={audit ? audit.action : login!.success ? t('siem.success') : t('siem.failed')}
      subtitle={formatDateTime(event.createdAt)}
      badges={
        audit ? (
          <Badge variant='outline'>{audit.actorType}</Badge>
        ) : (
          <Badge variant={login!.success ? 'outline' : 'destructive'}>{login!.method}</Badge>
        )
      }
    >
      <div className='flex flex-wrap gap-2'>
        {event.ip && (
          <Button size='sm' variant='outline' onClick={() => onFilter('ip', event.ip!)}>
            <Filter className='size-4' />
            {t('siem.panel.sameIp')}
          </Button>
        )}
        {userLabel && (
          <Button size='sm' variant='outline' onClick={() => onFilter(audit ? 'actor' : 'user', userLabel)}>
            <Filter className='size-4' />
            {t('siem.panel.sameUser')}
          </Button>
        )}
        {userId && can(PERMISSIONS.USERS_READ_ANY) && (
          <Button asChild size='sm' variant='outline'>
            <Link to='/admin/users' search={{ open: userId }}>
              <UserRound className='size-4' />
              {t('siem.panel.openUser')}
            </Link>
          </Button>
        )}
        {event.ip && can(PERMISSIONS.SECURITY_IP_BLOCK) && (
          <Button
            size='sm'
            variant='destructive'
            disabled={blockIp.isPending}
            onClick={() =>
              blockIp.mutate(
                { value: event.ip!, reason: t('siem.panel.blockReason', { what: audit ? audit.action : (login!.failureReason ?? 'login') }) },
                { onSuccess: () => toast.success(t('security.blocks.ipDone')) }
              )
            }
          >
            <Ban className='size-4' />
            {t('siem.panel.blockIp')}
          </Button>
        )}
      </div>
      <AdminErrorText error={blockIp.error} />

      <PanelSection title={t('siem.panel.fields')}>
        {audit ? (
          <PanelFacts
            rows={[
              [t('siem.column.actor'), filterable('actor', userLabel)],
              [t('siem.column.action'), filterable('action', audit.action)],
              [t('siem.column.entity'), filterable('entity', audit.entityType)],
              ['entityId', filterable('entityid', audit.entityId)],
              [t('siem.column.ip'), filterable('ip', audit.ip)],
              ['request', filterable('request', audit.requestId)],
              [t('sec.ua.title'), <UserAgentFacts ua={audit.userAgent} />],
            ]}
          />
        ) : (
          <PanelFacts
            rows={[
              [t('siem.column.user'), filterable('user', userLabel)],
              [t('siem.column.result'), filterable('result', login!.success ? 'success' : 'failed', login!.success ? t('siem.success') : t('siem.failed'))],
              [t('siem.column.reason'), filterable('reason', login!.failureReason)],
              [t('siem.column.ip'), filterable('ip', login!.ip, `${login!.ip ?? ''}${login!.country ? ` · ${login!.country}` : ''}`)],
              [t('siem.column.method'), filterable('method', login!.method)],
              ['identifier', login!.identifierUsed ?? '—'],
              ['client', login!.clientVersion ?? '—'],
              [t('sec.ua.title'), <UserAgentFacts ua={login!.userAgent} />],
            ]}
          />
        )}
      </PanelSection>

      {event.ip && <IpContextSection ip={event.ip} />}

      {audit && (audit.before !== null || audit.after !== null) && (
        <PanelSection title={t('siem.panel.changes')}>
          <div className='grid gap-2'>
            <Json label='before' value={audit.before} />
            <Json label='after' value={audit.after} />
          </div>
        </PanelSection>
      )}
    </SidePanel>
  )
}

/* ------------------------------------------------------------------ */

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
  active,
  cursor,
  onOpen,
}: {
  event: AuditEvent
  onFilter: (f: string, v: string) => void
  select: ReactNode
  selected: boolean
  active: boolean
  cursor: boolean
  onOpen: () => void
}) {
  const actor = event.actorUsername ?? event.actorLabel
  return (
    <TableRow
      data-row-id={event.id}
      className={cn('cursor-pointer', active && ACTIVE_ROW, cursor && CURSOR_ROW)}
      data-state={selected ? 'selected' : undefined}
      onClick={onOpen}
    >
        {select && <TableCell onClick={(e) => e.stopPropagation()}>{select}</TableCell>}
        <TableCell>
          <ChevronRight className={cn('size-4 text-muted-foreground', active && 'text-primary')} />
        </TableCell>
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
  active,
  cursor,
  onOpen,
}: {
  event: LoginEvent
  onFilter: (f: string, v: string) => void
  select: ReactNode
  selected: boolean
  active: boolean
  cursor: boolean
  onOpen: () => void
}) {
  const t = useT()
  return (
    <TableRow
      data-row-id={event.id}
      className={cn('cursor-pointer', active && ACTIVE_ROW, cursor && CURSOR_ROW)}
      data-state={selected ? 'selected' : undefined}
      onClick={onOpen}
    >
        {select && <TableCell onClick={(e) => e.stopPropagation()}>{select}</TableCell>}
        <TableCell>
          <ChevronRight className={cn('size-4 text-muted-foreground', active && 'text-primary')} />
        </TableCell>
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
