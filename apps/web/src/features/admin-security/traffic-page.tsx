import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Gauge, Hourglass, ShieldAlert, ShieldCheck, Siren, Timer, Trash2, UserRound, Users } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatShortDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { SidePanel } from '@/components/side-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { adminRolesQueryOptions } from '@/features/admin-users/api'
import { useCreateIpBlock } from './api'
import {
  BLOCK_LEVELS,
  trafficQueryOptions,
  useAddPriority,
  useRemovePriority,
  useUpdateTrafficConfig,
  type TrafficConfig,
  type TrafficState,
} from './center-api'
import { FieldRow, Segmented } from './controls'
import { IpContextSection } from './ip-context'
import { LevelBadge } from './labels'

/**
 * Приоритет трафика: чтобы при DDoS падал сайт для анонимов, а не панель.
 * Живая картина (раз в 5 секунд): сколько запросов в работе и в очереди,
 * задержка цикла событий, кого отсекли, кто шлёт больше всех. Ниже —
 * доверенные адреса и пользователи, веса ролей и параметры очереди.
 */
export function TrafficPage() {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.SECURITY_TRAFFIC_MANAGE)
  const state = useQuery(trafficQueryOptions())

  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('sec.page.traffic')} description={t('sec.page.traffic.hint')} />
      {state.isPending ? (
        <Skeleton className='h-96 w-full' />
      ) : state.isError ? (
        <AdminErrorText error={state.error} />
      ) : (
        <>
          <div className='grid gap-4 lg:grid-cols-[2fr_1fr]'>
            <AttackCard state={state.data} canManage={canManage} />
            <YouCard state={state.data} canManage={canManage} />
          </div>
          <LiveStats state={state.data} />
          <SlotsChart state={state.data} />
          <div className='grid gap-4 xl:grid-cols-2'>
            <TalkersCard state={state.data} canManage={canManage} />
            <PrioritiesCard state={state.data} canManage={canManage} />
          </div>
          {canManage && <SettingsCard config={state.data.live.config} />}
        </>
      )}
    </div>
  )
}

function AttackCard({ state, canManage }: { state: TrafficState; canManage: boolean }) {
  const t = useT()
  const update = useUpdateTrafficConfig()
  const { config } = state.live
  const [minWeight, setMinWeight] = useState(config.attackMinWeight)
  const on = config.enabled && config.attackMode

  return (
    <Card className={cn(on && 'border-destructive bg-destructive/5')}>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Siren className={cn('size-4', on && 'text-destructive')} />
          {on ? t('sec.traffic.attackOn') : t('sec.traffic.attackOff')}
        </CardTitle>
        <CardDescription>{on ? t('sec.traffic.attackOnHint', { n: config.attackMinWeight }) : t('sec.traffic.attackOffHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {!config.enabled && <p className='text-sm text-amber-600 dark:text-amber-400'>{t('sec.traffic.disabledWarn')}</p>}
        <div className='flex flex-wrap items-end gap-3'>
          <FieldRow label={t('sec.traffic.attackMinWeight')}>
            <Input
              type='number'
              min={1}
              max={100}
              value={minWeight}
              disabled={!canManage}
              onChange={(e) => setMinWeight(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              className='w-24'
            />
          </FieldRow>
          {canManage && (
            <Button
              variant={on ? 'outline' : 'destructive'}
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  { attackMode: !on, attackMinWeight: minWeight, ...(on ? {} : { enabled: true }) },
                  { onSuccess: () => toast.success(t(on ? 'sec.traffic.attackStopped' : 'sec.traffic.attackStarted')) }
                )
              }
            >
              <ShieldAlert className='size-4' />
              {on ? t('sec.traffic.attackDisable') : t('sec.traffic.attackEnable')}
            </Button>
          )}
          <span className='text-xs text-muted-foreground'>{t('sec.traffic.youWouldBe', { n: state.you.weight })}</span>
        </div>
        <AdminErrorText error={update.error} />
      </CardContent>
    </Card>
  )
}

function YouCard({ state, canManage }: { state: TrafficState; canManage: boolean }) {
  const t = useT()
  const add = useAddPriority()
  const { you, live } = state
  const safe = you.weight >= live.config.attackMinWeight
  const trusted = state.priorities.some((p) => p.kind === 'IP' && you.ip && p.value === `${you.ip}/${you.ip.includes(':') ? 128 : 32}`)

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          {safe ? <ShieldCheck className='size-4 text-emerald-500' /> : <ShieldAlert className='size-4 text-amber-500' />}
          {t('sec.traffic.you', { n: you.weight })}
        </CardTitle>
        <CardDescription>{safe ? t('sec.traffic.youSafe') : t('sec.traffic.youUnsafe')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-2 text-sm'>
        <p>
          {t('sec.traffic.yourIp')} <span className='font-mono'>{you.ip ?? '—'}</span>
        </p>
        {canManage && you.ip && !trusted && (
          <Button
            size='sm'
            variant='outline'
            disabled={add.isPending}
            onClick={() =>
              add.mutate({ kind: 'IP', value: you.ip!, weight: 100, note: t('sec.traffic.myIpNote') }, { onSuccess: () => toast.success(t('sec.traffic.trustedAdded')) })
            }
          >
            <ShieldCheck className='size-4' />
            {t('sec.traffic.trustMyIp')}
          </Button>
        )}
        <AdminErrorText error={add.error} />
      </CardContent>
    </Card>
  )
}

function LiveStats({ state }: { state: TrafficState }) {
  const t = useT()
  const { live } = state
  const lagHigh = live.lagMs > live.config.lagThresholdMs
  const items = [
    { icon: Gauge, label: t('sec.traffic.inFlight'), value: `${live.inFlight} / ${live.limit}`, warn: live.inFlight >= live.limit },
    { icon: Hourglass, label: t('sec.traffic.queued'), value: String(live.queued), warn: live.queued > 0 },
    { icon: Timer, label: t('sec.traffic.lag'), value: t('sec.traffic.ms', { n: live.lagMs }), warn: lagHigh },
    { icon: Users, label: t('sec.traffic.trustedCount'), value: t('sec.traffic.trustedValue', { ips: live.trustedIps, users: live.weightedUsers }), warn: false },
  ]
  return (
    <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
      {items.map(({ icon: Icon, label, value, warn }) => (
        <div key={label} className={cn('rounded-lg border p-3', warn && 'border-amber-500/60 bg-amber-500/5')}>
          <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <Icon className='size-3.5' />
            {label}
          </p>
          <p className='mt-1 text-xl font-semibold tabular-nums'>{value}</p>
        </div>
      ))}
    </div>
  )
}

/** Последние 10 минут по 10 секунд: кого обслужили сразу, мимо очереди, через очередь, кому отказали. */
function SlotsChart({ state }: { state: TrafficState }) {
  const t = useT()
  const slots = state.live.slots
  const total = (s: (typeof slots)[number]) => s.admitted + s.bypass + s.queued + s.shed
  const max = Math.max(1, ...slots.map(total))
  const sum = slots.reduce(
    (acc, s) => ({ admitted: acc.admitted + s.admitted, bypass: acc.bypass + s.bypass, queued: acc.queued + s.queued, shed: acc.shed + s.shed + s.timedOut }),
    { admitted: 0, bypass: 0, queued: 0, shed: 0 }
  )
  const parts = [
    { key: 'bypass', className: 'bg-emerald-500/80', value: (s: (typeof slots)[number]) => s.bypass },
    { key: 'admitted', className: 'bg-primary/70', value: (s: (typeof slots)[number]) => s.admitted },
    { key: 'queued', className: 'bg-amber-500/80', value: (s: (typeof slots)[number]) => Math.max(0, s.queued - s.timedOut) },
    { key: 'shed', className: 'bg-destructive/80', value: (s: (typeof slots)[number]) => s.shed + s.timedOut },
  ] as const

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-base'>{t('sec.traffic.chart')}</CardTitle>
        <div className='flex flex-wrap gap-3 text-xs text-muted-foreground'>
          {parts.map((part) => (
            <span key={part.key} className='inline-flex items-center gap-1.5'>
              <span className={cn('size-2 rounded-sm', part.className)} />
              {t(`sec.traffic.part.${part.key}`)}: <span className='tabular-nums text-foreground'>{sum[part.key]}</span>
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className='flex h-28 items-end gap-px'>
          {slots.map((slot) => (
            <div
              key={slot.at}
              className='flex h-full min-w-px flex-1 flex-col-reverse'
              title={`${formatShortDateTime(slot.at, { seconds: true })}: ${t('sec.traffic.part.admitted')} ${slot.admitted}, ${t('sec.traffic.part.bypass')} ${slot.bypass}, ${t('sec.traffic.part.queued')} ${slot.queued}, ${t('sec.traffic.part.shed')} ${slot.shed + slot.timedOut}`}
            >
              {parts.map((part) => (
                <div key={part.key} className={part.className} style={{ height: `${(part.value(slot) / max) * 100}%` }} />
              ))}
            </div>
          ))}
        </div>
        <div className='mt-1 flex justify-between text-[10px] text-muted-foreground'>
          <span>{formatShortDateTime(slots[0]?.at)}</span>
          <span>{t('timeRange.now')}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function TalkersCard({ state, canManage }: { state: TrafficState; canManage: boolean }) {
  const t = useT()
  const { can } = useSession()
  const block = useCreateIpBlock()
  const add = useAddPriority()
  const [opened, setOpened] = useState<string | null>(null)
  const anonymous = state.live.config.anonymousWeight

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('sec.traffic.talkers')}</CardTitle>
        <CardDescription>{t('sec.traffic.talkersHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-2'>
        <AdminErrorText error={block.error ?? add.error} />
        {state.live.talkers.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('sec.traffic.talkersEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP</TableHead>
                <TableHead className='text-end'>{t('sec.traffic.perMinute')}</TableHead>
                <TableHead>{t('sec.traffic.weight')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.live.talkers.map((talker) => (
                <TableRow key={talker.ip} className='cursor-pointer' onClick={() => setOpened(talker.ip)}>
                  <TableCell className='font-mono text-xs'>{talker.ip}</TableCell>
                  <TableCell className='text-end tabular-nums'>{talker.perMinute}</TableCell>
                  <TableCell>
                    {talker.weight > anonymous ? (
                      <Badge className='border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'>{talker.weight}</Badge>
                    ) : (
                      <span className='text-muted-foreground'>{talker.weight}</span>
                    )}
                  </TableCell>
                  <TableCell className='text-end' onClick={(e) => e.stopPropagation()}>
                    <div className='flex justify-end gap-1'>
                      {canManage && talker.weight <= anonymous && (
                        <Button
                          size='sm'
                          variant='ghost'
                          disabled={add.isPending}
                          title={t('sec.traffic.trust')}
                          onClick={() => add.mutate({ kind: 'IP', value: talker.ip, weight: 100 }, { onSuccess: () => toast.success(t('sec.traffic.trustedAdded')) })}
                        >
                          <ShieldCheck className='size-4' />
                        </Button>
                      )}
                      {can(PERMISSIONS.SECURITY_IP_BLOCK) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size='sm' variant='ghost' title={t('sec.traffic.block')}>
                              <Ban className='size-4 text-destructive' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            {BLOCK_LEVELS.map((level) => (
                              <DropdownMenuItem
                                key={level}
                                onSelect={() =>
                                  block.mutate(
                                    { value: talker.ip, level, expiresInHours: 24, reason: t('sec.traffic.blockReason', { n: talker.perMinute }) },
                                    { onSuccess: () => toast.success(t('security.blocks.ipDone')) }
                                  )
                                }
                              >
                                <LevelBadge level={level} />
                                <span className='text-xs text-muted-foreground'>24 ч</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {opened && (
        <SidePanel open onClose={() => setOpened(null)} title={<span className='font-mono'>{opened}</span>} subtitle={t('sec.traffic.talkers')}>
          <IpContextSection ip={opened} />
        </SidePanel>
      )}
    </Card>
  )
}

function PrioritiesCard({ state, canManage }: { state: TrafficState; canManage: boolean }) {
  const t = useT()
  const add = useAddPriority()
  const remove = useRemovePriority()
  const [kind, setKind] = useState<'IP' | 'USER'>('IP')
  const [value, setValue] = useState('')
  const [weight, setWeight] = useState(100)
  const [note, setNote] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    add.mutate(
      { kind, value: value.trim(), weight, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(t('sec.traffic.trustedAdded'))
          setValue('')
          setNote('')
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('sec.traffic.priorities')}</CardTitle>
        <CardDescription>{t('sec.traffic.prioritiesHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {canManage && (
          <form onSubmit={onSubmit} className='flex flex-wrap items-center gap-2'>
            <Segmented
              size='sm'
              value={kind}
              onChange={setKind}
              options={[
                { value: 'IP', label: t('sec.traffic.kind.IP') },
                { value: 'USER', label: t('sec.traffic.kind.USER') },
              ]}
            />
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'IP' ? '203.0.113.7 / 203.0.113.0/24' : t('sec.traffic.loginPlaceholder')}
              className={cn('h-8 w-52', kind === 'IP' && 'font-mono')}
            />
            <Input
              type='number'
              min={1}
              max={100}
              value={weight}
              onChange={(e) => setWeight(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              className='h-8 w-20'
              aria-label={t('sec.traffic.weight')}
            />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('sec.traffic.note')} maxLength={300} className='h-8 min-w-32 flex-1' />
            <Button type='submit' size='sm' disabled={!value.trim() || add.isPending}>
              {t('sec.traffic.add')}
            </Button>
          </form>
        )}
        <AdminErrorText error={add.error ?? remove.error} />
        {state.priorities.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('sec.traffic.prioritiesEmpty')}</p>
        ) : (
          <ul className='divide-y rounded-md border'>
            {state.priorities.map((entry) => (
              <li key={entry.id} className='flex items-center gap-2 px-3 py-2 text-sm'>
                {entry.kind === 'IP' ? <Gauge className='size-4 text-muted-foreground' /> : <UserRound className='size-4 text-muted-foreground' />}
                <span className={cn('min-w-0 flex-1 truncate', entry.kind === 'IP' && 'font-mono text-xs')}>
                  {entry.kind === 'USER' ? (entry.username ?? entry.value) : entry.value}
                  {entry.note && <span className='ms-2 text-xs text-muted-foreground'>{entry.note}</span>}
                </span>
                <Badge variant='outline' className='tabular-nums'>
                  {entry.weight}
                </Badge>
                {canManage && (
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7'
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(entry.id)}
                    aria-label={t('sec.traffic.remove')}
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

type NumberKey = 'maxConcurrent' | 'queueMax' | 'queueTimeoutMs' | 'lagThresholdMs' | 'bypassWeight' | 'anonymousWeight' | 'authenticatedWeight'

const NUMBER_FIELDS: { key: NumberKey; min: number; max: number }[] = [
  { key: 'maxConcurrent', min: 4, max: 10_000 },
  { key: 'queueMax', min: 0, max: 100_000 },
  { key: 'queueTimeoutMs', min: 100, max: 60_000 },
  { key: 'lagThresholdMs', min: 10, max: 10_000 },
  { key: 'bypassWeight', min: 1, max: 101 },
  { key: 'anonymousWeight', min: 0, max: 100 },
  { key: 'authenticatedWeight', min: 0, max: 100 },
]

function SettingsCard({ config }: { config: TrafficConfig }) {
  const t = useT()
  const update = useUpdateTrafficConfig()
  const roles = useQuery(adminRolesQueryOptions())
  const [form, setForm] = useState<TrafficConfig>(config)
  const roleSlugs = [...new Set([...(roles.data ?? []).map((r) => r.slug), ...Object.keys(form.roleWeights)])]
  const roleName = (slug: string) => roles.data?.find((r) => r.slug === slug)?.name ?? slug

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('sec.traffic.settings')}</CardTitle>
        <CardDescription>{t('sec.traffic.settingsHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-5'>
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox checked={form.enabled} onCheckedChange={(c) => setForm({ ...form, enabled: c === true })} />
          {t('sec.traffic.enabled')}
        </label>
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          {NUMBER_FIELDS.map(({ key, min, max }) => (
            <FieldRow key={key} label={t(`sec.traffic.field.${key}`)} hint={t(`sec.traffic.field.${key}.hint`)}>
              <Input
                type='number'
                min={min}
                max={max}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: Math.min(max, Math.max(min, Number(e.target.value) || min)) })}
              />
            </FieldRow>
          ))}
        </div>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('sec.traffic.roleWeights')}</p>
          <p className='text-xs text-muted-foreground'>{t('sec.traffic.roleWeightsHint')}</p>
          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-3'>
            {roleSlugs.map((slug) => (
              <label key={slug} className='flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm'>
                <span className='truncate'>
                  {roleName(slug)}
                  <span className='ms-1 font-mono text-xs text-muted-foreground'>{slug}</span>
                </span>
                <Input
                  type='number'
                  min={0}
                  max={100}
                  value={form.roleWeights[slug] ?? ''}
                  placeholder={String(form.authenticatedWeight)}
                  onChange={(e) => {
                    const next = { ...form.roleWeights }
                    if (e.target.value === '') delete next[slug]
                    else next[slug] = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                    setForm({ ...form, roleWeights: next })
                  }}
                  className='h-8 w-20'
                />
              </label>
            ))}
          </div>
        </div>
        <AdminErrorText error={update.error} />
        <div className='flex gap-2'>
          <Button disabled={update.isPending} onClick={() => update.mutate(form, { onSuccess: () => toast.success(t('sec.traffic.saved')) })}>
            {t('common.action.save')}
          </Button>
          <Button variant='ghost' onClick={() => setForm(config)}>
            {t('sec.traffic.reset')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
