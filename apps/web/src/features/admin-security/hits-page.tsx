import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Ban, Check, CheckCheck, ChevronRight, CircleSlash, FileSearch, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime, formatRelative } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { ACTIVE_ROW, CURSOR_ROW, PanelFacts, PanelSection, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { BulkBar, PageCheckbox, RowCheckbox, useSelection } from '@/features/admin/bulk'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { withTerm } from './api'
import {
  HIT_STATUSES,
  hitsQueryOptions,
  hitsSummaryQueryOptions,
  rulesQueryOptions,
  SEVERITIES,
  useUpdateHits,
  type Hit,
  type HitStatus,
  type Severity,
} from './center-api'
import { Segmented } from './controls'
import { IpContextSection } from './ip-context'
import { HitStatusBadge, LevelBadge, outcomeLabel, SeverityBadge, windowLabel } from './labels'

const PAGE = 50

/** Журнал, где искать события сработки, по источнику правила. */
export const EXPLORER: Record<Hit['rule']['source'], '/admin/security/logins' | '/admin/security/events'> = {
  LOGINS: '/admin/security/logins',
  AUDIT: '/admin/security/events',
}

/**
 * Сработки правил корреляции — очередь разбора, как в SIEM: новые сверху,
 * клик открывает карточку справа. В карточке — что за правило, что нашлось
 * в окне, что система сделала, контекст адреса и переход к самим событиям.
 */
export function HitsPage({
  openId,
  ruleId,
  onOpen,
  onRule,
}: {
  openId: string | null
  ruleId?: string
  onOpen: (id: string | null) => void
  onRule: (id: string | undefined) => void
}) {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.SECURITY_RULES_MANAGE)
  // Ссылка на конкретную сработку может вести на уже разобранную — тогда все статусы.
  const [status, setStatus] = useState<HitStatus | 'ALL'>(openId ? 'ALL' : 'NEW')
  const [severity, setSeverity] = useState<Severity | 'ALL'>('ALL')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [skip, setSkip] = useState(0)

  const hits = useQuery(
    hitsQueryOptions({
      status: status === 'ALL' ? undefined : status,
      severity: severity === 'ALL' ? undefined : severity,
      ruleId,
      q: q || undefined,
      skip,
      take: PAGE,
    })
  )
  const summary = useQuery(hitsSummaryQueryOptions())
  const rules = useQuery(rulesQueryOptions())
  const update = useUpdateHits()
  const selection = useSelection()
  const items = hits.data?.items ?? []
  const opened = items.find((h) => h.id === openId) ?? null

  const cursor = useListHotkeys({
    ids: items.map((h) => h.id),
    openedId: openId,
    onOpen,
    onClose: () => onOpen(null),
  })

  useEffect(() => setSkip(0), [status, severity, ruleId, q])

  function setMany(next: HitStatus) {
    update.mutate(
      { ids: selection.ids, status: next },
      {
        onSuccess: (result) => {
          toast.success(t('sec.hits.updated', { n: result.updated }))
          selection.clear()
        },
      }
    )
  }

  const total = hits.data?.total ?? 0

  return (
    <div className='space-y-6'>
      <AdminPageHeader
        title={t('sec.page.hits')}
        description={t('sec.page.hits.hint')}
        actions={
          <Button asChild variant='outline'>
            <Link to='/admin/security/rules'>
              <SlidersHorizontal className='size-4' />
              {t('sec.hits.toRules')}
            </Link>
          </Button>
        }
      />

      <div className='grid gap-3 sm:grid-cols-3'>
        <Stat label={t('sec.hits.open')} value={summary.data?.open} tone={summary.data?.open ? 'primary' : undefined} onClick={() => setStatus('NEW')} />
        <Stat label={t('sec.hits.critical')} value={summary.data?.critical} tone={summary.data?.critical ? 'danger' : undefined} onClick={() => {
          setStatus('NEW')
          setSeverity('CRITICAL')
        }} />
        <Stat label={t('sec.hits.day')} value={summary.data?.day} onClick={() => setStatus('ALL')} />
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[...HIT_STATUSES.map((s) => ({ value: s as HitStatus | 'ALL', label: t(`sec.hitStatus.${s}`) })), { value: 'ALL', label: t('sec.hits.all') }]}
        />
        <Select value={severity} onValueChange={(v) => setSeverity(v as Severity | 'ALL')}>
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='ALL'>{t('sec.hits.anySeverity')}</SelectItem>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`sec.severity.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ruleId ?? 'ALL'} onValueChange={(v) => onRule(v === 'ALL' ? undefined : v)}>
          <SelectTrigger className='w-64'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='ALL'>{t('sec.hits.anyRule')}</SelectItem>
            {rules.data?.rules.map((rule) => (
              <SelectItem key={rule.id} value={rule.id}>
                {rule.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className='relative min-w-48 flex-1'
          onSubmit={(e) => {
            e.preventDefault()
            setQ(draft.trim())
          }}
        >
          <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setQ(draft.trim())} placeholder={t('sec.hits.search')} className='pl-8 font-mono text-sm' />
        </form>
      </div>

      {canManage && (
        <BulkBar selection={selection}>
          <Button size='sm' variant='outline' disabled={update.isPending} onClick={() => setMany('ACKNOWLEDGED')}>
            <Check className='size-4' />
            {t('sec.hits.do.ACKNOWLEDGED')}
          </Button>
          <Button size='sm' variant='outline' disabled={update.isPending} onClick={() => setMany('RESOLVED')}>
            <CheckCheck className='size-4' />
            {t('sec.hits.do.RESOLVED')}
          </Button>
          <Button size='sm' variant='outline' disabled={update.isPending} onClick={() => setMany('FALSE_POSITIVE')}>
            <CircleSlash className='size-4' />
            {t('sec.hits.do.FALSE_POSITIVE')}
          </Button>
        </BulkBar>
      )}

      <AdminErrorText error={hits.error ?? update.error} />

      {hits.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                {canManage && (
                  <TableHead className='w-8'>
                    <PageCheckbox selection={selection} pageIds={items.map((h) => h.id)} />
                  </TableHead>
                )}
                <TableHead className='w-8' />
                <TableHead>{t('sec.hits.column.severity')}</TableHead>
                <TableHead>{t('sec.hits.column.when')}</TableHead>
                <TableHead>{t('sec.hits.column.rule')}</TableHead>
                <TableHead>{t('sec.hits.column.key')}</TableHead>
                <TableHead className='text-end'>{t('sec.hits.column.count')}</TableHead>
                <TableHead>{t('sec.hits.column.outcome')}</TableHead>
                <TableHead>{t('sec.hits.column.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className='py-10 text-center text-muted-foreground'>
                    {status === 'NEW' ? t('sec.hits.emptyNew') : t('siem.empty')}
                  </TableCell>
                </TableRow>
              )}
              {items.map((hit) => (
                <TableRow
                  key={hit.id}
                  data-row-id={hit.id}
                  data-state={selection.has(hit.id) ? 'selected' : undefined}
                  className={cn('cursor-pointer', openId === hit.id && ACTIVE_ROW, cursor === hit.id && CURSOR_ROW)}
                  onClick={() => onOpen(openId === hit.id ? null : hit.id)}
                >
                  {canManage && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <RowCheckbox selection={selection} id={hit.id} />
                    </TableCell>
                  )}
                  <TableCell>
                    <ChevronRight className={cn('size-4 text-muted-foreground', openId === hit.id && 'text-primary')} />
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={hit.severity} />
                  </TableCell>
                  <TableCell className='whitespace-nowrap text-muted-foreground' title={formatDateTime(hit.createdAt)}>
                    {formatRelative(hit.createdAt)}
                  </TableCell>
                  <TableCell className='max-w-64 truncate'>{hit.rule.name}</TableCell>
                  <TableCell className='font-mono text-xs'>{hit.groupKey}</TableCell>
                  <TableCell className='text-end tabular-nums'>
                    {hit.count}
                    {hit.distinctCount !== null && <span className='text-muted-foreground'> / {hit.distinctCount}</span>}
                  </TableCell>
                  <TableCell className={cn('text-xs', hit.outcome === 'blocked' && 'font-medium text-destructive')}>{outcomeLabel(t, hit.outcome)}</TableCell>
                  <TableCell>
                    <HitStatusBadge status={hit.status} />
                  </TableCell>
                </TableRow>
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

      {opened && <HitPanel key={opened.id} hit={opened} canManage={canManage} onClose={() => onOpen(null)} />}
    </div>
  )
}

function Stat({ label, value, tone, onClick }: { label: string; value?: number; tone?: 'primary' | 'danger'; onClick?: () => void }) {
  return (
    <button type='button' onClick={onClick} className='rounded-lg border p-3 text-start transition-colors hover:bg-accent/50'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'primary' && 'text-primary', tone === 'danger' && 'text-destructive')}>
        {value ?? '—'}
      </p>
    </button>
  )
}

/** Карточка сработки: что за правило, что нашлось, что сделано, разбор и переходы. */
function HitPanel({ hit, canManage, onClose }: { hit: Hit; canManage: boolean; onClose: () => void }) {
  const t = useT()
  const update = useUpdateHits()
  const [note, setNote] = useState(hit.note ?? '')
  const eventsQuery = withTerm(hit.rule.query, hit.rule.groupBy, hit.groupKey)

  function setStatus(status: HitStatus, withNote = false) {
    update.mutate(
      { ids: [hit.id], status, ...(withNote ? { note } : {}) },
      { onSuccess: () => toast.success(t(`sec.hitStatus.${status}`)) }
    )
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      title={<span className='font-mono'>{hit.groupKey}</span>}
      subtitle={hit.rule.name}
      badges={
        <>
          <SeverityBadge severity={hit.severity} />
          <HitStatusBadge status={hit.status} />
        </>
      }
    >
      <div className='flex flex-wrap gap-2'>
        {canManage &&
          (hit.status === 'NEW' ? (
            <>
              <Button size='sm' disabled={update.isPending} onClick={() => setStatus('ACKNOWLEDGED')}>
                <Check className='size-4' />
                {t('sec.hits.do.ACKNOWLEDGED')}
              </Button>
              <Button size='sm' variant='outline' disabled={update.isPending} onClick={() => setStatus('RESOLVED')}>
                <CheckCheck className='size-4' />
                {t('sec.hits.do.RESOLVED')}
              </Button>
              <Button size='sm' variant='outline' disabled={update.isPending} onClick={() => setStatus('FALSE_POSITIVE')}>
                <CircleSlash className='size-4' />
                {t('sec.hits.do.FALSE_POSITIVE')}
              </Button>
            </>
          ) : (
            <Button size='sm' variant='outline' disabled={update.isPending} onClick={() => setStatus('NEW')}>
              <RotateCcw className='size-4' />
              {t('sec.hits.reopen')}
            </Button>
          ))}
        <Button asChild size='sm' variant='outline'>
          <Link to={EXPLORER[hit.rule.source]} search={{ q: eventsQuery, from: hit.windowFrom, to: hit.windowTo }}>
            <FileSearch className='size-4' />
            {t('sec.hits.events')}
          </Link>
        </Button>
        <Button asChild size='sm' variant='outline'>
          <Link to='/admin/security/rules' search={{ open: hit.ruleId }}>
            <SlidersHorizontal className='size-4' />
            {t('sec.hits.rule')}
          </Link>
        </Button>
        {hit.blockId && (
          <Button asChild size='sm' variant='outline'>
            <Link to='/admin/security/blocks'>
              <Ban className='size-4' />
              {t('sec.hits.block')}
            </Link>
          </Button>
        )}
      </div>
      <AdminErrorText error={update.error} />

      <PanelSection title={t('sec.hits.what')}>
        <PanelFacts
          rows={[
            [t('sec.hits.column.rule'), hit.rule.name],
            [t('sec.rules.source'), t(`sec.source.${hit.rule.source}`)],
            [t('sec.rules.query'), hit.rule.query ? <span className='font-mono text-xs break-all'>{hit.rule.query}</span> : '—'],
            [
              t('sec.hits.column.count'),
              hit.distinctCount !== null ? t('sec.hits.countDistinct', { n: hit.count, d: hit.distinctCount, field: hit.rule.distinctField ?? '' }) : String(hit.count),
            ],
            [t('sec.hits.window'), `${formatDateTime(hit.windowFrom)} — ${formatDateTime(hit.windowTo)} (${windowLabel(t, Math.round((new Date(hit.windowTo).getTime() - new Date(hit.windowFrom).getTime()) / 60_000))})`],
            [
              t('sec.hits.span'),
              hit.firstEventAt ? `${formatDateTime(hit.firstEventAt)} — ${formatDateTime(hit.lastEventAt)}` : '—',
            ],
            [t('sec.hits.column.outcome'), <span className={cn(hit.outcome === 'blocked' && 'font-medium text-destructive')}>{outcomeLabel(t, hit.outcome)}</span>],
            ...(hit.action === 'BLOCK_IP' ? [[t('sec.level.column'), <LevelBadge level={hit.rule.blockLevel} />] as [string, ReactNode]] : []),
            [t('sec.hits.handled'), hit.handledByUsername ? `${hit.handledByUsername} · ${formatDateTime(hit.handledAt)}` : '—'],
          ]}
        />
      </PanelSection>

      {hit.sample && hit.sample.some((facet) => facet.values.length > 0) && (
        <PanelSection title={t('sec.hits.inside')}>
          <div className='grid gap-3 sm:grid-cols-2'>
            {hit.sample
              .filter((facet) => facet.values.length > 0)
              .map((facet) => {
                const max = Math.max(1, ...facet.values.map((v) => v.count))
                return (
                  <div key={facet.field} className='space-y-1'>
                    <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{facet.field}</p>
                    <ul className='space-y-0.5'>
                      {facet.values.map((v) => (
                        <li key={v.value} className='relative flex items-center justify-between gap-2 rounded px-1.5 py-0.5 text-xs'>
                          <span className='absolute inset-y-0 left-0 rounded bg-primary/10' style={{ width: `${(v.count / max) * 100}%` }} />
                          <span className='relative truncate font-mono'>{v.value}</span>
                          <span className='relative tabular-nums text-muted-foreground'>{v.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
          </div>
        </PanelSection>
      )}

      {canManage && (
        <PanelSection title={t('sec.hits.note')}>
          <div className='space-y-2'>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} placeholder={t('sec.hits.notePlaceholder')} />
            <Button size='sm' variant='secondary' disabled={update.isPending || note === (hit.note ?? '')} onClick={() => setStatus(hit.status, true)}>
              {t('common.action.save')}
            </Button>
          </div>
        </PanelSection>
      )}

      {hit.rule.groupBy === 'ip' && <IpContextSection ip={hit.groupKey} />}
    </SidePanel>
  )
}
