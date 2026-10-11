import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, FlaskConical, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime, formatRelative } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { ACTIVE_ROW, CURSOR_ROW, PanelSection, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { SEARCH_FIELDS } from './api'
import {
  BLOCK_LEVELS,
  RULE_ACTIONS,
  rulesQueryOptions,
  SEVERITIES,
  useDeleteRule,
  usePreviewRule,
  useRunRule,
  useSaveRule,
  type Rule,
  type RuleInput,
  type RuleSource,
} from './center-api'
import { FieldRow, parsePorts, Segmented } from './controls'
import { actionText, conditionText, LevelBadge, SeverityBadge } from './labels'

/** Поле, по которому правило может блокировать пользователя (как на сервере). */
const USER_FIELD: Record<RuleSource, string> = { LOGINS: 'user', AUDIT: 'actor' }
const WINDOWS = [5, 10, 15, 30, 60, 360, 1440]
/** Сроки блокировки — те же, что в ручной блокировке адреса; 0 — бессрочно. */
const BLOCK_HOURS = ['1', '24', '168', '720', '0'] as const

const NEW_RULE: RuleInput = {
  name: '',
  description: '',
  enabled: false,
  source: 'LOGINS',
  query: 'result:failed',
  groupBy: 'ip',
  distinctField: null,
  threshold: 10,
  windowMinutes: 10,
  severity: 'MEDIUM',
  action: 'ALERT',
  blockLevel: 'EDGE',
  blockPorts: [],
  blockHours: 24,
  cooldownMinutes: 60,
}

/**
 * Правила корреляции — как в WAF: «если в журнале за окно с одного ключа
 * набралось N событий (или N разных значений поля) — сработка и действие».
 * Блок адреса ставится на выбранном уровне: в приложении, на nginx или на
 * фаерволе по портам. Перед включением правило можно проверить на данных.
 */
export function RulesPage({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.SECURITY_RULES_MANAGE)
  const rules = useQuery(rulesQueryOptions())
  const save = useSaveRule()
  const list = rules.data?.rules ?? []
  const opened = openId === 'new' ? null : (list.find((r) => r.id === openId) ?? null)

  const cursor = useListHotkeys({
    ids: list.map((r) => r.id),
    openedId: openId,
    onOpen,
    onClose: () => onOpen(null),
  })

  return (
    <div className='space-y-6'>
      <AdminPageHeader
        title={t('sec.page.rules')}
        description={t('sec.page.rules.hint')}
        actions={
          canManage && (
            <Button onClick={() => onOpen('new')}>
              <Plus className='size-4' />
              {t('sec.rules.new')}
            </Button>
          )
        }
      />

      <AdminErrorText error={rules.error ?? save.error} />

      {rules.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>{t('sec.rules.on')}</TableHead>
                <TableHead>{t('sec.rules.name')}</TableHead>
                <TableHead>{t('sec.rules.condition')}</TableHead>
                <TableHead>{t('sec.rules.action')}</TableHead>
                <TableHead className='text-end'>{t('sec.rules.hits24h')}</TableHead>
                <TableHead>{t('sec.rules.lastHit')}</TableHead>
                <TableHead className='w-8' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className='py-10 text-center text-muted-foreground'>
                    {t('sec.rules.empty')}
                  </TableCell>
                </TableRow>
              )}
              {list.map((rule) => (
                <TableRow
                  key={rule.id}
                  data-row-id={rule.id}
                  className={cn('cursor-pointer', openId === rule.id && ACTIVE_ROW, cursor === rule.id && CURSOR_ROW, !rule.enabled && 'text-muted-foreground')}
                  onClick={() => onOpen(openId === rule.id ? null : rule.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={rule.enabled}
                      disabled={!canManage || save.isPending}
                      aria-label={t('sec.rules.on')}
                      onCheckedChange={(checked) =>
                        save.mutate(
                          { id: rule.id, enabled: checked === true },
                          { onSuccess: () => toast.success(t(checked === true ? 'sec.rules.enabled' : 'sec.rules.disabled')) }
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className='max-w-72'>
                    <span className='font-medium text-foreground'>{rule.name}</span>
                    {rule.description && <span className='block truncate text-xs text-muted-foreground'>{rule.description}</span>}
                  </TableCell>
                  <TableCell className='text-sm'>
                    <Badge variant='outline' className='me-1.5'>
                      {t(`sec.source.${rule.source}`)}
                    </Badge>
                    {conditionText(t, rule)}
                    {rule.query && <span className='block font-mono text-xs text-muted-foreground'>{rule.query}</span>}
                  </TableCell>
                  <TableCell className='text-sm'>
                    <span className='flex flex-wrap items-center gap-1.5'>
                      <SeverityBadge severity={rule.severity} />
                      {actionText(t, rule)}
                    </span>
                  </TableCell>
                  <TableCell className='text-end tabular-nums' onClick={(e) => e.stopPropagation()}>
                    <Link to='/admin/security/hits' search={{ rule: rule.id }} className='hover:underline'>
                      {rule.hits24h}
                      {rule.hitsOpen > 0 && <span className='ms-1 text-primary'>({t('sec.rules.open', { n: rule.hitsOpen })})</span>}
                    </Link>
                  </TableCell>
                  <TableCell className='text-sm whitespace-nowrap' title={rule.lastHitAt ? formatDateTime(rule.lastHitAt) : undefined}>
                    {rule.lastHitAt ? formatRelative(rule.lastHitAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className={cn('size-4 text-muted-foreground', openId === rule.id && 'text-primary')} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className='flex items-start gap-2 text-xs text-muted-foreground'>
        <ShieldCheck className='mt-0.5 size-3.5 shrink-0' />
        {t('sec.rules.safety')}
      </p>

      {openId && rules.data && (openId === 'new' || opened) && (
        <RuleEditor
          key={openId}
          rule={opened}
          fields={rules.data.fields}
          canManage={canManage}
          onClose={() => onOpen(null)}
          onSaved={(id) => onOpen(id)}
        />
      )}
    </div>
  )
}

function RuleEditor({
  rule,
  fields,
  canManage,
  onClose,
  onSaved,
}: {
  rule: Rule | null
  fields: Record<RuleSource, string[]>
  canManage: boolean
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const t = useT()
  const [form, setForm] = useState<RuleInput>(() => (rule ? toInput(rule) : NEW_RULE))
  const [portsText, setPortsText] = useState(() => (rule?.blockPorts ?? []).join(', '))
  const save = useSaveRule()
  const remove = useDeleteRule()
  const run = useRunRule()
  const preview = usePreviewRule()

  const ports = parsePorts(portsText)
  const sourceFields = fields[form.source] ?? []
  const userField = USER_FIELD[form.source]
  const input: RuleInput = { ...form, blockPorts: form.blockLevel === 'FIREWALL' ? (ports ?? []) : [] }
  const valid = form.name.trim().length > 0 && form.threshold >= 1 && form.windowMinutes >= 1 && ports !== null

  function patch(next: Partial<RuleInput>) {
    setForm((prev) => {
      const merged = { ...prev, ...next }
      const available = fields[merged.source] ?? []
      if (!available.includes(merged.groupBy)) merged.groupBy = available.includes('ip') ? 'ip' : (available[0] ?? 'ip')
      if (merged.distinctField && (!available.includes(merged.distinctField) || merged.distinctField === merged.groupBy)) merged.distinctField = null
      // Действие, которое для такой группировки невозможно, сбрасывается.
      if (merged.action === 'BLOCK_IP' && merged.groupBy !== 'ip') merged.action = 'ALERT'
      if (merged.action === 'BLOCK_USER' && merged.groupBy !== USER_FIELD[merged.source]) merged.action = 'ALERT'
      return merged
    })
    preview.reset()
  }

  function onSave() {
    save.mutate(
      { ...(rule ? { id: rule.id } : {}), ...input, description: input.description?.trim() || undefined } as RuleInput & { id?: string },
      {
        onSuccess: (saved) => {
          toast.success(t('sec.rules.saved'))
          onSaved(saved.id)
        },
      }
    )
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      title={rule ? rule.name : t('sec.rules.new')}
      subtitle={rule ? t('sec.rules.created', { when: formatDateTime(rule.createdAt) }) : undefined}
      badges={rule && (rule.enabled ? <Badge>{t('sec.rules.active')}</Badge> : <Badge variant='outline'>{t('sec.rules.off')}</Badge>)}
    >
      <div className='rounded-md border bg-muted/40 p-3 text-sm'>
        <span className='text-muted-foreground'>{t('sec.rules.sentence.if')} </span>
        {conditionText(t, form)}
        <span className='text-muted-foreground'> {t('sec.rules.sentence.in', { source: t(`sec.source.${form.source}`) })}</span>
        {form.query && <span className='font-mono text-xs'> ({form.query})</span>}
        <span className='text-muted-foreground'> → </span>
        <span className='font-medium'>{actionText(t, input)}</span>
      </div>

      <fieldset disabled={!canManage} className='space-y-6'>
        <PanelSection title={t('sec.rules.section.about')}>
          <div className='space-y-3'>
            <FieldRow label={t('sec.rules.name')}>
              <Input value={form.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} />
            </FieldRow>
            <FieldRow label={t('sec.rules.description')}>
              <Textarea value={form.description ?? ''} maxLength={1000} rows={2} onChange={(e) => patch({ description: e.target.value })} />
            </FieldRow>
          </div>
        </PanelSection>

        <PanelSection title={t('sec.rules.section.count')}>
          <div className='space-y-3'>
            <FieldRow label={t('sec.rules.source')}>
              <Segmented
                value={form.source}
                onChange={(source) => patch({ source, query: '' })}
                options={(['LOGINS', 'AUDIT'] as const).map((s) => ({ value: s, label: t(`sec.source.${s}`) }))}
              />
            </FieldRow>
            <FieldRow
              label={t('sec.rules.query')}
              hint={
                <>
                  {t('sec.rules.queryHint')}{' '}
                  {SEARCH_FIELDS[form.source === 'LOGINS' ? 'logins' : 'audit'].map((f) => (
                    <code key={f} className='me-1 rounded bg-muted px-1'>
                      {f}:
                    </code>
                  ))}
                </>
              }
            >
              <Input value={form.query} onChange={(e) => patch({ query: e.target.value })} className='font-mono text-sm' spellCheck={false} />
            </FieldRow>
            <div className='grid gap-3 sm:grid-cols-2'>
              <FieldRow label={t('sec.rules.groupBy')} hint={t('sec.rules.groupByHint')}>
                <Select value={form.groupBy} onValueChange={(groupBy) => patch({ groupBy })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceFields.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label={t('sec.rules.measure')}>
                <Select value={form.distinctField ?? '__events'} onValueChange={(v) => patch({ distinctField: v === '__events' ? null : v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__events'>{t('sec.rules.measure.events')}</SelectItem>
                    {sourceFields
                      .filter((f) => f !== form.groupBy)
                      .map((f) => (
                        <SelectItem key={f} value={f}>
                          {t('sec.rules.measure.distinct', { field: f })}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <FieldRow label={t('sec.rules.threshold')}>
                <Input type='number' min={1} max={100000} value={form.threshold} onChange={(e) => patch({ threshold: Math.max(1, Number(e.target.value) || 1) })} />
              </FieldRow>
              <FieldRow label={t('sec.rules.window')}>
                <div className='flex gap-2'>
                  <Input
                    type='number'
                    min={1}
                    max={10080}
                    value={form.windowMinutes}
                    onChange={(e) => patch({ windowMinutes: Math.max(1, Number(e.target.value) || 1) })}
                    className='w-24'
                  />
                  <Select value={WINDOWS.includes(form.windowMinutes) ? String(form.windowMinutes) : ''} onValueChange={(v) => patch({ windowMinutes: Number(v) })}>
                    <SelectTrigger className='flex-1'>
                      <SelectValue placeholder={t('sec.rules.windowPreset')} />
                    </SelectTrigger>
                    <SelectContent>
                      {WINDOWS.map((w) => (
                        <SelectItem key={w} value={String(w)}>
                          {w >= 1440 ? t('timeRange.unit.d', { n: w / 1440 }) : w >= 60 ? t('timeRange.unit.h', { n: w / 60 }) : t('timeRange.unit.m', { n: w })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </FieldRow>
            </div>
          </div>
        </PanelSection>

        <PanelSection title={t('sec.rules.section.do')}>
          <div className='space-y-3'>
            <FieldRow label={t('sec.rules.severity')}>
              <Segmented
                size='sm'
                value={form.severity}
                onChange={(severity) => patch({ severity })}
                options={SEVERITIES.map((s) => ({ value: s, label: t(`sec.severity.${s}`) }))}
              />
            </FieldRow>
            <FieldRow label={t('sec.rules.action')} hint={t('sec.rules.actionHint', { field: userField })}>
              <Segmented
                value={form.action}
                onChange={(action) => patch({ action })}
                options={RULE_ACTIONS.map((a) => ({
                  value: a,
                  label: t(`sec.action.${a}`),
                  disabled: (a === 'BLOCK_IP' && form.groupBy !== 'ip') || (a === 'BLOCK_USER' && form.groupBy !== userField),
                }))}
              />
            </FieldRow>
            {form.action === 'BLOCK_IP' && (
              <div className='space-y-3 rounded-md border p-3'>
                <FieldRow label={t('sec.level.where')}>
                  <div className='grid gap-2'>
                    {BLOCK_LEVELS.map((level) => (
                      <label
                        key={level}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm',
                          form.blockLevel === level ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                        )}
                      >
                        <input type='radio' className='mt-1' checked={form.blockLevel === level} onChange={() => patch({ blockLevel: level })} />
                        <span>
                          <LevelBadge level={level} />
                          <span className='mt-1 block text-xs text-muted-foreground'>{t(`sec.level.${level}.hint`)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </FieldRow>
                {form.blockLevel === 'FIREWALL' && (
                  <FieldRow label={t('sec.level.ports')} hint={t('sec.level.portsHint')}>
                    <Input value={portsText} onChange={(e) => setPortsText(e.target.value)} placeholder='22, 80, 443' aria-invalid={ports === null} className='font-mono' />
                  </FieldRow>
                )}
                <FieldRow label={t('sec.rules.blockFor')}>
                  <Select value={String(form.blockHours ?? 0)} onValueChange={(v) => patch({ blockHours: Number(v) || null })}>
                    <SelectTrigger className='w-48'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BLOCK_HOURS.map((h) => (
                        <SelectItem key={h} value={h}>
                          {t(`security.blocks.duration.${h}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              </div>
            )}
            <FieldRow label={t('sec.rules.cooldown')} hint={t('sec.rules.cooldownHint')}>
              <Input
                type='number'
                min={1}
                max={10080}
                value={form.cooldownMinutes}
                onChange={(e) => patch({ cooldownMinutes: Math.max(1, Number(e.target.value) || 1) })}
                className='w-32'
              />
            </FieldRow>
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox checked={form.enabled} onCheckedChange={(c) => patch({ enabled: c === true })} />
              {t('sec.rules.enabledLabel')}
            </label>
          </div>
        </PanelSection>
      </fieldset>

      <AdminErrorText error={save.error ?? preview.error ?? run.error ?? remove.error} />

      {canManage && (
        <div className='flex flex-wrap gap-2'>
          <Button disabled={!valid || save.isPending} onClick={onSave}>
            {t('common.action.save')}
          </Button>
          <Button variant='outline' disabled={!valid || preview.isPending} onClick={() => preview.mutate(input)}>
            <FlaskConical className='size-4' />
            {t('sec.rules.preview')}
          </Button>
          {rule && (
            <Button
              variant='outline'
              disabled={run.isPending}
              onClick={() =>
                run.mutate(rule.id, { onSuccess: (r) => toast.success(t('sec.rules.ran', { hits: r.hits, groups: r.groups })) })
              }
            >
              <Play className='size-4' />
              {t('sec.rules.runNow')}
            </Button>
          )}
          {rule && (
            <Button
              variant='ghost'
              className='ms-auto text-destructive'
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm(t('sec.rules.deleteConfirm'))) return
                remove.mutate(rule.id, {
                  onSuccess: () => {
                    toast.success(t('sec.rules.deleted'))
                    onClose()
                  },
                })
              }}
            >
              <Trash2 className='size-4' />
              {t('sec.rules.delete')}
            </Button>
          )}
        </div>
      )}

      {preview.data && (
        <PanelSection title={t('sec.rules.previewTitle', { n: preview.data.groups.length })}>
          {preview.data.groups.length === 0 ? (
            <p className='text-sm text-muted-foreground'>{t('sec.rules.previewEmpty', { window: formatRelative(preview.data.from) })}</p>
          ) : (
            <ul className='space-y-1'>
              {preview.data.groups.map((group) => (
                <li key={group.key} className='flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm'>
                  <span className='truncate font-mono text-xs'>{group.key}</span>
                  <span className='flex shrink-0 items-center gap-2'>
                    {group.protected && <Badge variant='outline'>{t('sec.rules.protected')}</Badge>}
                    <span className='tabular-nums'>
                      {group.count}
                      {group.distinctCount !== null && <span className='text-muted-foreground'> / {group.distinctCount}</span>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
      )}
    </SidePanel>
  )
}

function toInput(rule: Rule): RuleInput {
  return {
    name: rule.name,
    description: rule.description ?? '',
    enabled: rule.enabled,
    source: rule.source,
    query: rule.query,
    groupBy: rule.groupBy,
    distinctField: rule.distinctField,
    threshold: rule.threshold,
    windowMinutes: rule.windowMinutes,
    severity: rule.severity,
    action: rule.action,
    blockLevel: rule.blockLevel,
    blockPorts: rule.blockPorts,
    blockHours: rule.blockHours,
    cooldownMinutes: rule.cooldownMinutes,
  }
}
