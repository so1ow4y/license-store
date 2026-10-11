import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Ban,
  Check,
  Hash,
  LayoutDashboard,
  ListOrdered,
  Maximize2,
  Pencil,
  Plus,
  ScrollText,
  Siren,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { queryClient } from '@/lib/api/query-client'
import { useT } from '@/lib/i18n'
import { formatRelative, formatShortDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { PanelSection, SidePanel } from '@/components/side-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { TimeRangePicker, useTimeRange, zoomRange, type ResolvedRange } from '@/features/admin/time-range'
import { ipBlocksQueryOptions, logSearchQueryOptions, logStatsQueryOptions, withTerm, type AuditEvent, type LoginEvent } from './api'
import {
  BLOCK_LEVELS,
  dashboardsQueryOptions,
  hitsQueryOptions,
  trafficQueryOptions,
  useCreateDashboard,
  useDeleteDashboard,
  useUpdateDashboard,
  WIDGET_SIZES,
  WIDGET_TYPES,
  type Dashboard,
  type Widget,
  type WidgetType,
} from './center-api'
import { FieldRow, Segmented } from './controls'
import { TimeHistogram } from './histogram'
import { LevelBadge, SeverityBadge } from './labels'

/** Поля «топа» — те, по которым сервер считает фасеты журнала. */
const TOP_FIELDS = { audit: ['action', 'actor', 'ip', 'entity'], logins: ['user', 'ip', 'reason', 'method'] } as const

const SIZE_CLASS: Record<Widget['size'], string> = {
  s: 'col-span-12 sm:col-span-6 xl:col-span-3',
  m: 'col-span-12 xl:col-span-6',
  l: 'col-span-12 xl:col-span-8',
  full: 'col-span-12',
}

const TYPE_ICON: Record<WidgetType, typeof Hash> = {
  counter: Hash,
  histogram: BarChart3,
  top: ListOrdered,
  events: ScrollText,
  hits: Siren,
  traffic: Activity,
  blocks: Ban,
}

/** Виджеты, которые читают журнал и поэтому имеют источник и строку поиска. */
const LOG_WIDGETS: WidgetType[] = ['counter', 'histogram', 'top', 'events']

const EXPLORER = { audit: '/admin/security/events', logins: '/admin/security/logins' } as const

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w${Date.now()}${Math.random().toString(36).slice(2)}`
}

/**
 * Дашборды безопасности: каждый собирает себе экран из виджетов и делится
 * им с коллегами. Период общий для всех виджетов; выделение на любой
 * гистограмме приближает весь дашборд, как в SIEM.
 */
export function DashboardsPage({ selectedId, onSelect }: { selectedId?: string; onSelect: (id: string) => void }) {
  const t = useT()
  const list = useQuery(dashboardsQueryOptions())
  const create = useCreateDashboard()
  const update = useUpdateDashboard()
  const remove = useDeleteDashboard()
  const time = useTimeRange({ kind: 'relative', amount: 24, unit: 'h' }, () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'security'] })
  })
  const [editing, setEditing] = useState(false)
  const [editor, setEditor] = useState<Widget | 'new' | null>(null)

  const dashboards = list.data ?? []
  const current = dashboards.find((d) => d.id === selectedId) ?? dashboards[0]
  const canEdit = Boolean(current?.mine)
  const widgets = current?.widgets ?? []

  function saveWidgets(next: Widget[]) {
    if (current) update.mutate({ id: current.id, widgets: next })
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= widgets.length) return
    const next = [...widgets]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item!)
    saveWidgets(next)
  }

  function upsert(widget: Widget) {
    const exists = widgets.some((w) => w.id === widget.id)
    saveWidgets(exists ? widgets.map((w) => (w.id === widget.id ? widget : w)) : [...widgets, widget])
    setEditor(null)
  }

  function createDashboard() {
    create.mutate(
      { name: t('sec.dash.newName'), widgets: [] },
      {
        onSuccess: (dashboard) => {
          onSelect(dashboard.id)
          setEditing(true)
        },
      }
    )
  }

  return (
    <div className='space-y-5'>
      <AdminPageHeader
        title={t('sec.page.dashboards')}
        description={t('sec.page.dashboards.hint')}
        actions={
          <>
            <TimeRangePicker state={time} />
            {canEdit && (
              <Button variant={editing ? 'default' : 'outline'} onClick={() => setEditing(!editing)}>
                {editing ? <Check className='size-4' /> : <Pencil className='size-4' />}
                {editing ? t('sec.dash.done') : t('sec.dash.edit')}
              </Button>
            )}
            <Button variant='outline' disabled={create.isPending} onClick={createDashboard}>
              <Plus className='size-4' />
              {t('sec.dash.new')}
            </Button>
          </>
        }
      />

      <AdminErrorText error={list.error ?? create.error ?? update.error ?? remove.error} />

      {list.isPending ? (
        <Skeleton className='h-96 w-full' />
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-1.5'>
            {dashboards.map((dashboard) => (
              <button
                key={dashboard.id}
                type='button'
                onClick={() => {
                  onSelect(dashboard.id)
                  setEditing(false)
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                  dashboard.id === current?.id ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent'
                )}
              >
                <LayoutDashboard className='size-3.5' />
                {dashboard.name}
                {dashboard.shared && <Users className='size-3.5 text-muted-foreground' aria-label={t('sec.dash.shared')} />}
                {!dashboard.mine && <span className='text-xs text-muted-foreground'>· {dashboard.ownerUsername}</span>}
              </button>
            ))}
          </div>

          {current && editing && canEdit && (
            <DashboardBar
              key={current.id}
              dashboard={current}
              onRename={(name) => update.mutate({ id: current.id, name })}
              onShare={(shared) => update.mutate({ id: current.id, shared })}
              onAdd={() => setEditor('new')}
              onDelete={() => {
                if (!window.confirm(t('sec.dash.deleteConfirm', { name: current.name }))) return
                remove.mutate(current.id, {
                  onSuccess: () => {
                    toast.success(t('sec.dash.deleted'))
                    setEditing(false)
                  },
                })
              }}
            />
          )}

          {widgets.length === 0 ? (
            <div className='rounded-lg border border-dashed p-10 text-center'>
              <p className='text-sm text-muted-foreground'>{t('sec.dash.empty')}</p>
              {canEdit && (
                <Button className='mt-3' onClick={() => {
                  setEditing(true)
                  setEditor('new')
                }}>
                  <Plus className='size-4' />
                  {t('sec.dash.addWidget')}
                </Button>
              )}
            </div>
          ) : (
            <div className='grid grid-cols-12 gap-4'>
              {widgets.map((widget, index) => (
                <WidgetCard
                  key={widget.id}
                  widget={widget}
                  editing={editing && canEdit}
                  first={index === 0}
                  last={index === widgets.length - 1}
                  onMove={(delta) => move(index, delta)}
                  onResize={() => {
                    const nextSize = WIDGET_SIZES[(WIDGET_SIZES.indexOf(widget.size) + 1) % WIDGET_SIZES.length]!
                    saveWidgets(widgets.map((w) => (w.id === widget.id ? { ...w, size: nextSize } : w)))
                  }}
                  onEdit={() => setEditor(widget)}
                  onRemove={() => saveWidgets(widgets.filter((w) => w.id !== widget.id))}
                >
                  <WidgetBody widget={widget} range={time.resolved} onZoom={(from, to) => time.setRange(zoomRange(from, to))} />
                </WidgetCard>
              ))}
            </div>
          )}
        </>
      )}

      {editor && <WidgetEditor key={editor === 'new' ? 'new' : editor.id} widget={editor === 'new' ? null : editor} onSave={upsert} onClose={() => setEditor(null)} />}
    </div>
  )
}

function DashboardBar({
  dashboard,
  onRename,
  onShare,
  onAdd,
  onDelete,
}: {
  dashboard: Dashboard
  onRename: (name: string) => void
  onShare: (shared: boolean) => void
  onAdd: () => void
  onDelete: () => void
}) {
  const t = useT()
  const [name, setName] = useState(dashboard.name)
  return (
    <div className='flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3'>
      <Input
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== dashboard.name && onRename(name.trim())}
        className='h-8 w-64'
        aria-label={t('sec.dash.name')}
      />
      <label className='flex items-center gap-2 text-sm'>
        <Checkbox checked={dashboard.shared} onCheckedChange={(c) => onShare(c === true)} />
        {t('sec.dash.shareLabel')}
      </label>
      <Button size='sm' onClick={onAdd}>
        <Plus className='size-4' />
        {t('sec.dash.addWidget')}
      </Button>
      <Button size='sm' variant='ghost' className='ms-auto text-destructive' onClick={onDelete}>
        <Trash2 className='size-4' />
        {t('sec.dash.delete')}
      </Button>
    </div>
  )
}

function WidgetCard({
  widget,
  editing,
  first,
  last,
  onMove,
  onResize,
  onEdit,
  onRemove,
  children,
}: {
  widget: Widget
  editing: boolean
  first: boolean
  last: boolean
  onMove: (delta: number) => void
  onResize: () => void
  onEdit: () => void
  onRemove: () => void
  children: ReactNode
}) {
  const t = useT()
  const Icon = TYPE_ICON[widget.type]
  return (
    <div className={cn(SIZE_CLASS[widget.size], 'min-w-0')}>
      <Card className={cn('flex h-full flex-col gap-0 py-0', editing && 'ring-1 ring-primary/30')}>
        <div className='flex items-center gap-2 border-b px-3 py-2'>
          <Icon className='size-4 shrink-0 text-muted-foreground' />
          <span className='min-w-0 flex-1 truncate text-sm font-medium'>{widget.title || t(`sec.widget.type.${widget.type}`)}</span>
          {widget.q && !editing && <span className='hidden max-w-40 truncate font-mono text-[11px] text-muted-foreground md:inline'>{widget.q}</span>}
          {editing && (
            <span className='flex shrink-0 items-center gap-0.5'>
              <IconButton label={t('sec.dash.moveLeft')} disabled={first} onClick={() => onMove(-1)}>
                <ArrowLeft />
              </IconButton>
              <IconButton label={t('sec.dash.moveRight')} disabled={last} onClick={() => onMove(1)}>
                <ArrowRight />
              </IconButton>
              <IconButton label={t('sec.dash.resize', { size: t(`sec.widget.size.${widget.size}`) })} onClick={onResize}>
                <Maximize2 />
              </IconButton>
              <IconButton label={t('sec.dash.editWidget')} onClick={onEdit}>
                <Pencil />
              </IconButton>
              <IconButton label={t('sec.dash.removeWidget')} onClick={onRemove} danger>
                <Trash2 />
              </IconButton>
            </span>
          )}
        </div>
        <div className='min-h-0 flex-1 p-3'>{children}</div>
      </Card>
    </div>
  )
}

function IconButton({ label, disabled, danger, onClick, children }: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type='button'
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 [&>svg]:size-3.5',
        danger && 'hover:text-destructive'
      )}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------ данные виджетов

function WidgetBody({ widget, range, onZoom }: { widget: Widget; range: ResolvedRange; onZoom: (from: number, to: number) => void }) {
  switch (widget.type) {
    case 'counter':
      return <CounterWidget widget={widget} range={range} />
    case 'histogram':
      return <HistogramWidget widget={widget} range={range} onZoom={onZoom} />
    case 'top':
      return <TopWidget widget={widget} range={range} />
    case 'events':
      return <EventsWidget widget={widget} range={range} />
    case 'hits':
      return <HitsWidget />
    case 'traffic':
      return <TrafficWidget />
    case 'blocks':
      return <BlocksWidget />
  }
}

function sourceOf(widget: Widget) {
  return widget.source ?? 'audit'
}

function ExplorerLink({ widget, range, q, children, className }: { widget: Widget; range: ResolvedRange; q?: string; children: ReactNode; className?: string }) {
  return (
    <Link to={EXPLORER[sourceOf(widget)]} search={{ q: q ?? widget.q ?? '', from: range.from, to: range.to }} className={className}>
      {children}
    </Link>
  )
}

function CounterWidget({ widget, range }: { widget: Widget; range: ResolvedRange }) {
  const t = useT()
  const source = sourceOf(widget)
  const total = useQuery(logSearchQueryOptions(source, { q: widget.q ?? '', ...range, skip: 0, take: 1 }))
  const stats = useQuery(logStatsQueryOptions(source, { q: widget.q ?? '', ...range }))
  if (total.isError) return <AdminErrorText error={total.error} />
  const bars = stats.data?.histogram ?? []
  const max = Math.max(1, ...bars.map((b) => b.count))
  return (
    <ExplorerLink widget={widget} range={range} className='block space-y-2'>
      <p className='text-3xl font-semibold tabular-nums'>{total.data ? total.data.total.toLocaleString() : '…'}</p>
      <div className='flex h-8 items-end gap-px' aria-hidden>
        {bars.slice(-40).map((bar) => (
          <div key={bar.bucket} className='min-w-px flex-1 rounded-t-sm bg-primary/40' style={{ height: `${Math.max(4, (bar.count / max) * 100)}%` }} />
        ))}
      </div>
      <p className='text-xs text-muted-foreground'>{t(`sec.source.${source === 'logins' ? 'LOGINS' : 'AUDIT'}`)}</p>
    </ExplorerLink>
  )
}

function HistogramWidget({ widget, range, onZoom }: { widget: Widget; range: ResolvedRange; onZoom: (from: number, to: number) => void }) {
  const source = sourceOf(widget)
  const stats = useQuery(logStatsQueryOptions(source, { q: widget.q ?? '', ...range }))
  if (stats.isError) return <AdminErrorText error={stats.error} />
  return (
    <TimeHistogram
      className='border-0 p-0'
      buckets={stats.data?.histogram}
      intervalMs={stats.data?.intervalMs}
      range={range}
      loading={stats.isPending}
      withFailures={source === 'logins'}
      onZoom={onZoom}
    />
  )
}

function TopWidget({ widget, range }: { widget: Widget; range: ResolvedRange }) {
  const t = useT()
  const source = sourceOf(widget)
  const stats = useQuery(logStatsQueryOptions(source, { q: widget.q ?? '', ...range }))
  if (stats.isError) return <AdminErrorText error={stats.error} />
  if (!stats.data) return <Skeleton className='h-32 w-full' />
  const field = widget.field ?? TOP_FIELDS[source][0]
  const values = stats.data.facets.find((f) => f.field === field)?.values ?? []
  if (values.length === 0) return <p className='py-6 text-center text-sm text-muted-foreground'>{t('siem.empty')}</p>
  const max = Math.max(1, ...values.map((v) => v.count))
  return (
    <ul className='space-y-1'>
      {values.map((v) => (
        <li key={v.value}>
          <ExplorerLink widget={widget} range={range} q={withTerm(widget.q ?? '', field, v.value)} className='relative flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-accent/60'>
            <span className='absolute inset-y-0 left-0 rounded bg-primary/10' style={{ width: `${(v.count / max) * 100}%` }} />
            <span className='relative truncate font-mono text-xs'>{v.value}</span>
            <span className='relative tabular-nums text-muted-foreground'>{v.count}</span>
          </ExplorerLink>
        </li>
      ))}
    </ul>
  )
}

function EventsWidget({ widget, range }: { widget: Widget; range: ResolvedRange }) {
  const t = useT()
  const source = sourceOf(widget)
  const items = useQuery(logSearchQueryOptions(source, { q: widget.q ?? '', ...range, skip: 0, take: 8 }))
  if (items.isError) return <AdminErrorText error={items.error} />
  if (!items.data) return <Skeleton className='h-40 w-full' />
  if (items.data.items.length === 0) return <p className='py-6 text-center text-sm text-muted-foreground'>{t('siem.empty')}</p>
  return (
    <div className='space-y-1'>
      <ul className='divide-y text-sm'>
        {items.data.items.map((event) => {
          const audit = source === 'audit' ? (event as AuditEvent) : null
          const login = source === 'logins' ? (event as LoginEvent) : null
          return (
            <li key={event.id} className='flex items-center gap-2 py-1.5'>
              <span className='w-28 shrink-0 text-xs text-muted-foreground tabular-nums'>{formatShortDateTime(event.createdAt, { seconds: true })}</span>
              {audit ? (
                <>
                  <span className='truncate font-mono text-xs'>{audit.action}</span>
                  <span className='truncate text-xs text-muted-foreground'>{audit.actorUsername ?? audit.actorLabel ?? audit.actorType}</span>
                </>
              ) : (
                <>
                  <Badge variant={login!.success ? 'outline' : 'destructive'}>{login!.success ? t('siem.success') : t('siem.failed')}</Badge>
                  <span className='truncate text-xs'>{login!.username ?? login!.identifierUsed}</span>
                  {login!.failureReason && <span className='truncate text-xs text-muted-foreground'>{login!.failureReason}</span>}
                </>
              )}
              <span className='ms-auto shrink-0 font-mono text-[11px] text-muted-foreground'>{event.ip}</span>
            </li>
          )
        })}
      </ul>
      <ExplorerLink widget={widget} range={range} className='inline-block text-xs text-primary hover:underline'>
        {t('sec.widget.openAll', { n: items.data.total })}
      </ExplorerLink>
    </div>
  )
}

function HitsWidget() {
  const t = useT()
  const hits = useQuery(hitsQueryOptions({ status: 'NEW', take: 6 }))
  if (hits.isError) return <AdminErrorText error={hits.error} />
  if (!hits.data) return <Skeleton className='h-32 w-full' />
  return (
    <div className='space-y-2'>
      <Link to='/admin/security/hits' className='block'>
        <p className={cn('text-3xl font-semibold tabular-nums', hits.data.open > 0 && 'text-primary')}>{hits.data.open}</p>
        <p className='text-xs text-muted-foreground'>{t('sec.hits.open')}</p>
      </Link>
      <ul className='space-y-1'>
        {hits.data.items.map((hit) => (
          <li key={hit.id}>
            <Link to='/admin/security/hits' search={{ open: hit.id }} className='flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/60'>
              <SeverityBadge severity={hit.severity} />
              <span className='truncate font-mono'>{hit.groupKey}</span>
              <span className='ms-auto shrink-0 text-muted-foreground'>{formatRelative(hit.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TrafficWidget() {
  const t = useT()
  const state = useQuery(trafficQueryOptions())
  if (state.isError) return <AdminErrorText error={state.error} />
  if (!state.data) return <Skeleton className='h-32 w-full' />
  const { live } = state.data
  const slots = live.slots.slice(-30)
  const max = Math.max(1, ...slots.map((s) => s.admitted + s.bypass + s.queued + s.shed))
  return (
    <Link to='/admin/security/traffic' className='block space-y-2'>
      {live.config.attackMode && (
        <Badge variant='destructive'>
          <Siren />
          {t('sec.traffic.attackOn')}
        </Badge>
      )}
      <div className='grid grid-cols-3 gap-2 text-center'>
        <Metric label={t('sec.traffic.inFlight')} value={`${live.inFlight}/${live.limit}`} />
        <Metric label={t('sec.traffic.queued')} value={String(live.queued)} warn={live.queued > 0} />
        <Metric label={t('sec.traffic.lag')} value={t('sec.traffic.ms', { n: live.lagMs })} warn={live.lagMs > live.config.lagThresholdMs} />
      </div>
      <div className='flex h-12 items-end gap-px' aria-hidden>
        {slots.map((slot) => (
          <div key={slot.at} className='flex h-full min-w-px flex-1 flex-col-reverse'>
            <div className='bg-primary/60' style={{ height: `${((slot.admitted + slot.bypass + slot.queued - slot.timedOut) / max) * 100}%` }} />
            <div className='bg-destructive/80' style={{ height: `${((slot.shed + slot.timedOut) / max) * 100}%` }} />
          </div>
        ))}
      </div>
    </Link>
  )
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className={cn('text-lg font-semibold tabular-nums', warn && 'text-amber-600 dark:text-amber-400')}>{value}</p>
      <p className='text-[11px] text-muted-foreground'>{label}</p>
    </div>
  )
}

function BlocksWidget() {
  const t = useT()
  const blocks = useQuery(ipBlocksQueryOptions())
  if (blocks.isError) return <AdminErrorText error={blocks.error} />
  if (!blocks.data) return <Skeleton className='h-32 w-full' />
  const active = blocks.data.filter((b) => b.active)
  return (
    <Link to='/admin/security/blocks' className='block space-y-3'>
      <div className='grid grid-cols-3 gap-2'>
        {BLOCK_LEVELS.map((level) => (
          <div key={level} className='space-y-1 text-center'>
            <p className='text-xl font-semibold tabular-nums'>{active.filter((b) => b.level === level).length}</p>
            <LevelBadge level={level} />
          </div>
        ))}
      </div>
      <ul className='space-y-0.5 text-xs'>
        {active.slice(0, 4).map((block) => (
          <li key={block.id} className='flex items-center gap-2'>
            <span className='truncate font-mono'>{block.cidr}</span>
            <span className='ms-auto shrink-0 text-muted-foreground'>{formatRelative(block.createdAt)}</span>
          </li>
        ))}
        {active.length === 0 && <li className='text-muted-foreground'>{t('security.blocks.ipEmpty')}</li>}
      </ul>
    </Link>
  )
}

// ------------------------------------------------------------ редактор виджета

function WidgetEditor({ widget, onSave, onClose }: { widget: Widget | null; onSave: (widget: Widget) => void; onClose: () => void }) {
  const t = useT()
  const [form, setForm] = useState<Widget>(() => widget ?? { id: newId(), type: 'counter', title: '', size: 's', source: 'logins', q: 'result:failed' })
  const logWidget = LOG_WIDGETS.includes(form.type)
  const source = form.source ?? 'audit'

  return (
    <SidePanel open onClose={onClose} title={widget ? t('sec.dash.editWidget') : t('sec.dash.addWidget')}>
      <PanelSection title={t('sec.widget.typeTitle')}>
        <div className='grid gap-2 sm:grid-cols-2'>
          {WIDGET_TYPES.map((type) => {
            const Icon = TYPE_ICON[type]
            return (
              <button
                key={type}
                type='button'
                onClick={() =>
                  setForm({
                    ...form,
                    type,
                    size: type === 'counter' || type === 'hits' ? 's' : type === 'events' ? 'full' : form.size === 's' ? 'm' : form.size,
                  })
                }
                className={cn(
                  'flex items-start gap-2 rounded-md border p-2.5 text-start text-sm transition-colors',
                  form.type === type ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                )}
              >
                <Icon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                <span>
                  <span className='block font-medium'>{t(`sec.widget.type.${type}`)}</span>
                  <span className='block text-xs text-muted-foreground'>{t(`sec.widget.type.${type}.hint`)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </PanelSection>

      <PanelSection title={t('sec.widget.settings')}>
        <div className='space-y-3'>
          <FieldRow label={t('sec.widget.title')}>
            <Input value={form.title} maxLength={120} placeholder={t(`sec.widget.type.${form.type}`)} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </FieldRow>
          {logWidget && (
            <>
              <FieldRow label={t('sec.rules.source')}>
                <Segmented
                  value={source}
                  onChange={(next) => setForm({ ...form, source: next, field: undefined, q: '' })}
                  options={[
                    { value: 'logins', label: t('sec.source.LOGINS') },
                    { value: 'audit', label: t('sec.source.AUDIT') },
                  ]}
                />
              </FieldRow>
              <FieldRow label={t('sec.rules.query')} hint={t('sec.widget.queryHint')}>
                <Input value={form.q ?? ''} onChange={(e) => setForm({ ...form, q: e.target.value })} className='font-mono text-sm' spellCheck={false} />
              </FieldRow>
            </>
          )}
          {form.type === 'top' && (
            <FieldRow label={t('sec.widget.field')}>
              <Select value={form.field ?? TOP_FIELDS[source][0]} onValueChange={(field) => setForm({ ...form, field })}>
                <SelectTrigger className='w-48'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOP_FIELDS[source].map((field) => (
                    <SelectItem key={field} value={field}>
                      {field}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}
          <FieldRow label={t('sec.widget.size')}>
            <Segmented
              size='sm'
              value={form.size}
              onChange={(size) => setForm({ ...form, size })}
              options={WIDGET_SIZES.map((size) => ({ value: size, label: t(`sec.widget.size.${size}`) }))}
            />
          </FieldRow>
        </div>
      </PanelSection>

      <div className='flex gap-2'>
        <Button
          onClick={() =>
            onSave({
              ...form,
              title: form.title.trim(),
              ...(logWidget ? { source } : { source: undefined, q: undefined }),
              ...(form.type === 'top' ? { field: form.field ?? TOP_FIELDS[source][0] } : { field: undefined }),
            })
          }
        >
          {widget ? t('common.action.save') : t('sec.dash.addWidget')}
        </Button>
        <Button variant='ghost' onClick={onClose}>
          {t('common.action.cancel')}
        </Button>
      </div>
    </SidePanel>
  )
}
