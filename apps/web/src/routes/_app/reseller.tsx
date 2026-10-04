import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { AlertTriangle, KeyRound, RotateCcw, Search, Timer, X } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { has, PERMISSIONS } from '@/lib/auth/permissions'
import { formatDate, formatDateTime } from '@/lib/format/date'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CopyButton } from '@/components/copy-button'
import { AdminErrorText, adminErrorMessage } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { LicenseStatusBadge } from '@/features/licenses/status-badge'
import {
  formatMoney,
  resellerKeysQueryOptions,
  resellerLicensesQueryOptions,
  resellerOverviewQueryOptions,
  useCancelKey,
  useExtendClientLicense,
  useIssueKeys,
  useResetClientHwid,
  type ClientLicense,
  type KeyState,
  type ResellerOverview,
} from '@/features/resellers/api'
import { TopupsPanel } from '@/features/resellers/topups-panel'

const TABS = ['keys', 'licenses', 'balance'] as const

/**
 * Панель реселлера: баланс и условия, выпуск ключей активации со своего
 * баланса, свои ключи, клиенты и их лицензии, пополнение и операции.
 * Вкладка — в адресе (`?tab=`), на неё ведут пункты ветки меню.
 */
export const Route = createFileRoute('/_app/reseller')({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  beforeLoad: ({ context }) => {
    if (!has(context.me.permissions, PERMISSIONS.RESELLER_PANEL)) throw redirect({ to: '/403' })
  },
  component: ResellerPage,
})

function ResellerPage() {
  const t = useT()
  const { tab = 'keys' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const overview = useQuery(resellerOverviewQueryOptions())

  if (overview.isPending) return <Skeleton className='h-64 w-full' />
  if (overview.isError) return <AdminErrorText error={overview.error} />

  const { reseller, stats } = overview.data
  const currency = reseller.currency
  const canSell = reseller.status === 'ACTIVE'

  return (
    <div className='mx-auto w-full max-w-6xl space-y-6'>
      <header className='flex flex-wrap items-end justify-between gap-4'>
        <div className='space-y-1'>
          <h1 className='text-xl font-semibold'>{reseller.displayName}</h1>
          <p className='text-sm text-muted-foreground'>{t('resellers.panel.subtitle')}</p>
        </div>
        <div className='text-right'>
          <p className='text-xs text-muted-foreground'>{t('resellers.panel.balance')}</p>
          <p className={cn('text-3xl font-semibold tabular-nums', Number(reseller.balance) < 0 && 'text-destructive')}>
            {formatMoney(reseller.balance, currency)}
          </p>
          <p className='text-xs text-muted-foreground'>
            {t('resellers.panel.terms', {
              discount: Number(reseller.discountPercent),
              credit: formatMoney(reseller.creditLimit, currency),
            })}
          </p>
        </div>
      </header>

      {!canSell && (
        <div className='flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400' />
          {t(`resellers.panel.statusNotice.${reseller.status}`)}
        </div>
      )}

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        <Stat label={t('resellers.panel.stat.unused')} value={stats.keys.unused} />
        <Stat label={t('resellers.panel.stat.used')} value={stats.keys.used} />
        <Stat label={t('resellers.panel.stat.active')} value={stats.licensesActive} />
        <Stat label={t('resellers.panel.stat.clients')} value={stats.clients} />
        <Stat label={t('resellers.panel.stat.spent30d')} value={formatMoney(stats.spent30d, currency)} />
      </div>

      <IssueKeysCard overview={overview.data} disabled={!canSell} />

      <Tabs
        value={tab}
        className='space-y-4'
        onValueChange={(value) => void navigate({ search: { tab: value as (typeof TABS)[number] } })}
      >
        <TabsList>
          {TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`resellers.panel.tab.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value='keys'>
          <KeysTab currency={currency} />
        </TabsContent>
        <TabsContent value='licenses'>
          <LicensesTab overview={overview.data} canSell={canSell} />
        </TabsContent>
        <TabsContent value='balance'>
          <TopupsPanel disabled={reseller.status === 'CLOSED'} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='text-xl font-semibold tabular-nums'>{value}</p>
    </div>
  )
}

// --------------------------------------------------------------- выпуск ключей

function IssueKeysCard({ overview, disabled }: { overview: ResellerOverview; disabled: boolean }) {
  const t = useT()
  const issue = useIssueKeys()
  const currency = overview.reseller.currency
  const [planId, setPlanId] = useState('')
  const [count, setCount] = useState('1')
  const [days, setDays] = useState('')
  const [note, setNote] = useState('')
  const [issued, setIssued] = useState<{ codes: string[]; title: string } | null>(null)

  const plans = useMemo(
    () => overview.catalog.flatMap((p) => p.plans.map((plan) => ({ ...plan, product: p.name }))),
    [overview.catalog]
  )
  const plan = plans.find((p) => p.id === planId)
  const countValue = Number(count)
  const daysValue = days.trim() ? Number(days) : undefined
  const total = plan ? Number(plan.resellerPrice) * (Number.isFinite(countValue) ? countValue : 0) : 0
  const available = Number(overview.reseller.balance) + Number(overview.reseller.creditLimit)

  const problems = [
    !plan && t('resellers.problem.plan'),
    !(Number.isInteger(countValue) && countValue >= 1 && countValue <= 100) && t('resellers.problem.count'),
    daysValue !== undefined && !(Number.isInteger(daysValue) && daysValue >= 1 && daysValue <= 3650) && t('resellers.problem.days'),
    plan && total > available && t('resellers.problem.balance', { available: formatMoney(available, currency) }),
  ]
  const valid = problems.every((p) => !p)

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <KeyRound className='size-4' />
          {t('resellers.panel.issue.title')}
        </CardTitle>
        <CardDescription>{t('resellers.panel.issue.hint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid || !plan) return
            issue.mutate(
              { planId: plan.id, count: countValue, expiresInDays: daysValue, note: note.trim() || undefined },
              {
                onSuccess: (r) => {
                  setIssued({ codes: r.codes, title: `${r.product} · ${r.plan}` })
                  setCount('1')
                  setNote('')
                },
              }
            )
          }}
        >
          <div className='grid gap-4 md:grid-cols-[2fr_1fr_1fr]'>
            <div className='space-y-2'>
              <Label>{t('resellers.panel.issue.plan')}</Label>
              <Select value={planId} onValueChange={setPlanId} disabled={disabled}>
                <SelectTrigger>
                  <SelectValue placeholder={t('resellers.panel.issue.planPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {overview.catalog.map((product) => (
                    <SelectGroup key={product.id}>
                      <SelectLabel>{product.name}</SelectLabel>
                      {product.plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} — {formatMoney(p.resellerPrice, p.currency)}
                          <span className='ms-1 text-xs text-muted-foreground line-through'>{formatMoney(p.price, p.currency)}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='rk-count'>{t('resellers.panel.issue.count')}</Label>
              <Input id='rk-count' type='number' min={1} max={100} value={count} disabled={disabled} onChange={(e) => setCount(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='rk-days'>{t('resellers.panel.issue.days')}</Label>
              <Input id='rk-days' type='number' min={1} max={3650} value={days} placeholder={t('resellers.panel.issue.daysPlaceholder')} disabled={disabled} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='rk-note'>{t('resellers.panel.issue.note')}</Label>
            <Input id='rk-note' value={note} maxLength={500} disabled={disabled} placeholder={t('resellers.panel.issue.notePlaceholder')} onChange={(e) => setNote(e.target.value)} />
          </div>
          {plan && (
            <p className='text-sm'>
              {t('resellers.panel.issue.total', {
                price: formatMoney(plan.resellerPrice, currency),
                count: Number.isFinite(countValue) ? countValue : 0,
                total: formatMoney(total, currency),
              })}
            </p>
          )}
          <FormProblems problems={problems} />
          <AdminErrorText error={issue.error} />
          <Button type='submit' disabled={disabled || !valid || issue.isPending}>
            {t('resellers.panel.issue.submit')}
          </Button>
        </form>
      </CardContent>

      <Dialog open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('resellers.panel.issued.title', { count: issued?.codes.length ?? 0 })}</DialogTitle>
            <DialogDescription>{t('resellers.panel.issued.hint', { what: issued?.title ?? '' })}</DialogDescription>
          </DialogHeader>
          <pre className='max-h-72 overflow-y-auto rounded-md bg-muted p-3 font-mono text-sm'>{issued?.codes.join('\n')}</pre>
          <DialogFooter>
            <CopyButton value={issued?.codes.join('\n') ?? ''} label={t('resellers.panel.issued.copyLabel')} withLabel />
            <Button onClick={() => setIssued(null)}>{t('resellers.panel.issued.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// --------------------------------------------------------------------- ключи

const KEY_STATES: (KeyState | 'all')[] = ['all', 'unused', 'used', 'expired', 'cancelled']
const KEY_STATE_VARIANT: Record<KeyState, 'default' | 'secondary' | 'outline'> = {
  unused: 'default',
  used: 'secondary',
  expired: 'outline',
  cancelled: 'outline',
}
const PAGE = 25

function KeysTab({ currency }: { currency: string }) {
  const t = useT()
  const [state, setState] = useState<KeyState | 'all'>('unused')
  const [skip, setSkip] = useState(0)
  const cancel = useCancelKey()
  useEffect(() => setSkip(0), [state])
  const query = useQuery(resellerKeysQueryOptions({ state: state === 'all' ? undefined : state, skip, take: PAGE }))
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-1'>
        {KEY_STATES.map((s) => (
          <Button key={s} size='sm' variant={state === s ? 'default' : 'outline'} className='h-7' onClick={() => setState(s)}>
            {t(`resellers.keyState.${s}`)}
          </Button>
        ))}
      </div>
      {query.isPending ? (
        <Skeleton className='h-32 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : items.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t('resellers.panel.keys.empty')}</p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('resellers.panel.keys.column.code')}</TableHead>
                <TableHead>{t('resellers.panel.keys.column.what')}</TableHead>
                <TableHead>{t('resellers.panel.keys.column.state')}</TableHead>
                <TableHead className='text-right'>{t('resellers.panel.keys.column.price')}</TableHead>
                <TableHead>{t('resellers.panel.keys.column.client')}</TableHead>
                <TableHead>{t('resellers.panel.keys.column.created')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className='font-mono text-xs whitespace-nowrap'>
                    <span className='inline-flex items-center gap-1'>
                      {k.code}
                      {k.state === 'unused' && <CopyButton value={k.code} label={t('resellers.panel.keys.copyLabel')} />}
                    </span>
                  </TableCell>
                  <TableCell className='text-sm'>
                    {k.product} · {k.plan}
                  </TableCell>
                  <TableCell>
                    <Badge variant={KEY_STATE_VARIANT[k.state]}>{t(`resellers.keyState.${k.state}`)}</Badge>
                    {k.state === 'unused' && k.expiresAt && (
                      <span className='block text-xs text-muted-foreground'>{t('resellers.panel.keys.until', { date: formatDate(k.expiresAt) })}</span>
                    )}
                  </TableCell>
                  <TableCell className='text-right whitespace-nowrap'>{formatMoney(k.price ?? 0, currency)}</TableCell>
                  <TableCell className='text-sm'>
                    {k.usedBy ?? '—'}
                    {k.usedAt && <span className='block text-xs text-muted-foreground'>{formatDateTime(k.usedAt)}</span>}
                  </TableCell>
                  <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(k.createdAt)}</TableCell>
                  <TableCell className='text-right'>
                    {k.cancellable && (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={cancel.isPending}
                        title={t('resellers.panel.keys.cancel')}
                        onClick={() => {
                          if (!window.confirm(t('resellers.panel.keys.cancelConfirm', { price: formatMoney(k.price ?? 0, currency) }))) return
                          cancel.mutate(k.id, {
                            onSuccess: (r) => toast.success(t('resellers.panel.keys.cancelled', { balance: formatMoney(r.balance, currency) })),
                            onError: (e) => toast.error(adminErrorMessage(e)),
                          })
                        }}
                      >
                        <X className='size-4' />
                        <span className='sr-only'>{t('resellers.panel.keys.cancel')}</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager skip={skip} total={total} onChange={setSkip} />
    </div>
  )
}

// ------------------------------------------------------------ клиенты и лицензии

function LicensesTab({ overview, canSell }: { overview: ResellerOverview; canSell: boolean }) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [skip, setSkip] = useState(0)
  const [extending, setExtending] = useState<ClientLicense | null>(null)
  const reset = useResetClientHwid()
  useEffect(() => setSkip(0), [search])
  const query = useQuery(resellerLicensesQueryOptions({ search: search || undefined, skip, take: PAGE }))
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const resets = query.data?.hwidResets
  const notClosed = overview.reseller.status !== 'CLOSED'

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <form
          className='flex min-w-72 flex-1 gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(draft.trim())
          }}
        >
          <div className='relative flex-1'>
            <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input value={draft} className='pl-8' placeholder={t('resellers.panel.licenses.search')} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Button type='submit' variant='outline'>
            {t('common.action.search')}
          </Button>
        </form>
        {resets && (
          <span className='text-xs text-muted-foreground'>
            {t('resellers.panel.licenses.resets', { used: resets.usedToday, limit: resets.dailyLimit })}
          </span>
        )}
      </div>

      {query.isPending ? (
        <Skeleton className='h-32 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : items.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{search ? t('resellers.panel.licenses.nothingFound') : t('resellers.panel.licenses.empty')}</p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('resellers.panel.licenses.column.client')}</TableHead>
                <TableHead>{t('resellers.panel.licenses.column.license')}</TableHead>
                <TableHead>{t('resellers.panel.licenses.column.status')}</TableHead>
                <TableHead>{t('resellers.panel.licenses.column.expires')}</TableHead>
                <TableHead>{t('resellers.panel.licenses.column.device')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className='font-medium'>{l.user?.username ?? '—'}</TableCell>
                  <TableCell className='text-sm'>
                    {l.product.name} · {l.plan.name}
                    <span className='block font-mono text-xs text-muted-foreground'>{l.maskedKey}</span>
                  </TableCell>
                  <TableCell>
                    <LicenseStatusBadge compact status={l.status} />
                  </TableCell>
                  <TableCell className='whitespace-nowrap text-muted-foreground'>
                    {l.status === 'PENDING' ? t('resellers.panel.licenses.notStarted') : l.expiresAt ? formatDate(l.expiresAt) : t('licenses.plan.lifetime')}
                  </TableCell>
                  <TableCell className='text-sm'>
                    {l.bound ? t('resellers.panel.licenses.bound') : <span className='text-muted-foreground'>{t('resellers.panel.licenses.unbound')}</span>}
                    <span className='block text-xs text-muted-foreground'>{t('resellers.panel.licenses.resetCount', { count: l.hwidResetCount })}</span>
                  </TableCell>
                  <TableCell className='text-right whitespace-nowrap'>
                    {canSell && l.status !== 'REVOKED' && (
                      <Button size='sm' variant='outline' onClick={() => setExtending(l)}>
                        <Timer className='size-4' />
                        {t('resellers.panel.licenses.extend')}
                      </Button>
                    )}
                    {notClosed && l.bound && (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={reset.isPending}
                        title={t('resellers.panel.licenses.reset')}
                        onClick={() => {
                          if (!window.confirm(t('resellers.panel.licenses.resetConfirm', { client: l.user?.username ?? '' }))) return
                          reset.mutate(l.id, {
                            onSuccess: (r) => toast.success(t('resellers.panel.licenses.resetDone', { used: r.usedToday, limit: r.dailyLimit })),
                            onError: (e) => toast.error(adminErrorMessage(e)),
                          })
                        }}
                      >
                        <RotateCcw className='size-4' />
                        <span className='sr-only'>{t('resellers.panel.licenses.reset')}</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager skip={skip} total={total} onChange={setSkip} />
      <ExtendDialog license={extending} overview={overview} onOpenChange={(open) => !open && setExtending(null)} />
    </div>
  )
}

/** Продление лицензии клиента тарифом того же товара по цене реселлера. */
function ExtendDialog({
  license,
  overview,
  onOpenChange,
}: {
  license: ClientLicense | null
  overview: ResellerOverview
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const extend = useExtendClientLicense()
  const [planId, setPlanId] = useState('')
  const currency = overview.reseller.currency
  const plans = overview.catalog.find((p) => p.id === license?.productId)?.plans ?? []
  const plan = plans.find((p) => p.id === planId)

  useEffect(() => {
    if (!license) return
    extend.reset()
    setPlanId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license?.id])

  return (
    <Dialog open={license !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resellers.panel.extend.title', { client: license?.user?.username ?? '—' })}</DialogTitle>
          <DialogDescription>{t('resellers.panel.extend.hint')}</DialogDescription>
        </DialogHeader>
        {plans.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('resellers.panel.extend.noPlans')}</p>
        ) : (
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger>
              <SelectValue placeholder={t('resellers.panel.issue.planPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {formatMoney(p.resellerPrice, p.currency)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {license?.status === 'PENDING' && <p className='text-xs text-amber-600 dark:text-amber-400'>{t('resellers.panel.extend.pending')}</p>}
        <AdminErrorText error={extend.error} />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('common.action.cancel')}
          </Button>
          <Button
            disabled={!plan || extend.isPending}
            onClick={() =>
              license &&
              plan &&
              extend.mutate(
                { id: license.id, planId: plan.id },
                {
                  onSuccess: (r) => {
                    toast.success(t('resellers.panel.extend.done', { price: formatMoney(r.price, currency) }))
                    onOpenChange(false)
                  },
                }
              )
            }
          >
            {plan ? t('resellers.panel.extend.submit', { price: formatMoney(plan.resellerPrice, currency) }) : t('resellers.panel.licenses.extend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Pager({ skip, total, onChange }: { skip: number; total: number; onChange: (skip: number) => void }) {
  const t = useT()
  if (total <= PAGE) return null
  return (
    <div className='flex items-center justify-between text-sm text-muted-foreground'>
      <span>{t('siem.total', { total })}</span>
      <div className='flex gap-2'>
        <Button variant='outline' size='sm' disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - PAGE))}>
          {t('common.action.prevPage')}
        </Button>
        <Button variant='outline' size='sm' disabled={skip + PAGE >= total} onClick={() => onChange(skip + PAGE)}>
          {t('common.action.nextPage')}
        </Button>
      </div>
    </div>
  )
}
