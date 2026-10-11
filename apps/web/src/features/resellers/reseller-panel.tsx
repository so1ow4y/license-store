import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { formatDateTime } from '@/lib/format/date'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PanelFacts, PanelSection, SidePanel } from '@/components/side-panel'
import { AdminErrorText } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { paymentProfilesQueryOptions } from '@/features/admin-payments/api'
import {
  adminResellerQueryOptions,
  formatMoney,
  resellerPaymentOptionsQueryOptions,
  useChangeResellerBalance,
  useResellerPaymentOptionMutations,
  useUpdateReseller,
  type AdminReseller,
  type ResellerStatus,
} from './api'
import { AdminTopupsPanel } from './admin-topups'
import { TermsFields, termsInput, termsProblems, useTermsState } from './terms-fields'
import { TransactionsTable } from './transactions-table'

const STATUS_VARIANT: Record<ResellerStatus, 'default' | 'secondary' | 'outline'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  CLOSED: 'outline',
}

const TABS = ['terms', 'balance', 'requisites', 'topups'] as const
type Tab = (typeof TABS)[number]

/**
 * Реселлер в правой панели: сводка, условия, баланс с историей операций,
 * личные реквизиты для пополнения и его заявки — всё настраивается здесь,
 * не уходя из списка.
 */
export function ResellerPanel({ resellerId, onClose }: { resellerId: string | null; onClose: () => void }) {
  const t = useT()
  const query = useQuery({ ...adminResellerQueryOptions(resellerId ?? ''), enabled: Boolean(resellerId) })
  const [tab, setTab] = useState<Tab>('terms')
  const reseller = query.data

  if (!resellerId) return null

  return (
    <SidePanel
      open
      onClose={onClose}
      title={reseller?.displayName ?? t('common.state.loading')}
      subtitle={
        reseller && (
          <Link
            to='/admin/users'
            search={{ q: `id:${reseller.userId}` }}
            className='underline-offset-4 hover:text-foreground hover:underline'
          >
            {reseller.user.username}
            {reseller.user.email ? ` · ${reseller.user.email}` : ''}
          </Link>
        )
      }
      badges={reseller && <Badge variant={STATUS_VARIANT[reseller.status]}>{t(`resellers.status.${reseller.status}`)}</Badge>}
    >
      {query.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : (
        <>
          <Summary reseller={query.data} />
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className='w-full'>
              {TABS.map((name) => (
                <TabsTrigger key={name} value={name} className='flex-1'>
                  {t(`resellers.adminPanel.tab.${name}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value='terms' className='mt-4'>
              <TermsForm reseller={query.data} />
            </TabsContent>
            <TabsContent value='balance' className='mt-4 space-y-5'>
              <BalanceForm reseller={query.data} />
              <PanelSection title={t('resellers.history')} description={t('resellers.historyHint')}>
                <TransactionsTable resellerId={query.data.id} />
              </PanelSection>
            </TabsContent>
            <TabsContent value='requisites' className='mt-4'>
              <RequisitesSection reseller={query.data} />
            </TabsContent>
            <TabsContent value='topups' className='mt-4'>
              <AdminTopupsPanel resellerId={query.data.id} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </SidePanel>
  )
}

function Summary({ reseller }: { reseller: AdminReseller }) {
  const t = useT()
  const negative = Number(reseller.balance) < 0
  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
      <Stat label={t('resellers.admin.column.balance')} value={formatMoney(reseller.balance, reseller.currency)} tone={negative ? 'bad' : 'good'} />
      <Stat label={t('resellers.admin.column.discount')} value={`${Number(reseller.discountPercent)}%`} />
      <Stat label={t('resellers.admin.column.credit')} value={formatMoney(reseller.creditLimit, reseller.currency)} />
      <Stat label={t('resellers.admin.column.clients')} value={String(reseller.clients)} />
      <Stat label={t('resellers.admin.column.licenses')} value={String(reseller.licenses)} />
      <Stat label={t('resellers.admin.column.keys')} value={String(reseller.keys)} />
      <Stat label={t('resellers.field.resets')} value={String(reseller.hwidResetDailyLimit)} />
      <Stat label={t('resellers.panel.since')} value={formatDateTime(reseller.createdAt)} small />
    </div>
  )
}

function Stat({ label, value, tone, small }: { label: string; value: string; tone?: 'good' | 'bad'; small?: boolean }) {
  return (
    <div className='rounded-lg border bg-muted/20 px-3 py-2'>
      <p className='truncate text-[11px] text-muted-foreground'>{label}</p>
      <p
        className={cn(
          'truncate font-semibold tabular-nums',
          small ? 'text-xs' : 'text-sm',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-foreground'
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function TermsForm({ reseller }: { reseller: AdminReseller }) {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.RESELLERS_MANAGE)
  const update = useUpdateReseller()
  const terms = useTermsState(reseller)

  useEffect(() => {
    terms.reset(reseller)
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseller.id, reseller.updatedAt])

  if (!canManage) {
    return (
      <PanelFacts
        rows={[
          [t('resellers.field.displayName'), reseller.displayName],
          [t('resellers.field.status'), t(`resellers.status.${reseller.status}`)],
          [t('resellers.field.discount'), `${Number(reseller.discountPercent)}%`],
          [t('resellers.field.credit'), formatMoney(reseller.creditLimit, reseller.currency)],
          [t('resellers.field.notes'), reseller.notes ?? '—'],
        ]}
      />
    )
  }

  const problems = termsProblems(terms, t)
  const valid = problems.every((p) => !p)

  return (
    <form
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        update.mutate(
          { id: reseller.id, body: { ...termsInput(terms), status: terms.status } },
          { onSuccess: () => toast.success(t('admin.saved')) }
        )
      }}
    >
      <TermsFields state={terms} withStatus />
      <FormProblems problems={problems} />
      <AdminErrorText error={update.error} />
      <Button type='submit' disabled={!valid || update.isPending}>
        {t('common.action.save')}
      </Button>
    </form>
  )
}

/** Пополнение (реселлер заплатил), бонус или корректировка баланса. */
function BalanceForm({ reseller }: { reseller: AdminReseller }) {
  const t = useT()
  const { can } = useSession()
  const change = useChangeResellerBalance()
  const [type, setType] = useState<'TOPUP' | 'ADJUSTMENT' | 'COMMISSION'>('TOPUP')
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')

  if (!can(PERMISSIONS.RESELLERS_BALANCE)) return null

  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value !== 0 && (type === 'ADJUSTMENT' || value > 0)

  return (
    <PanelSection title={t('resellers.panel.balanceTitle')} description={t(`resellers.txHint.${type}`)}>
      <form
        className='grid gap-3 sm:grid-cols-[10rem_8rem_1fr_auto] sm:items-end'
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          change.mutate(
            { id: reseller.id, type, amount: value, comment: comment.trim() || undefined },
            {
              onSuccess: (r) => {
                toast.success(t('resellers.admin.balanceDone', { balance: formatMoney(r.balance, reseller.currency) }))
                setAmount('')
                setComment('')
              },
            }
          )
        }}
      >
        <div className='space-y-1.5'>
          <Label className='text-xs'>{t('resellers.field.txType')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['TOPUP', 'COMMISSION', 'ADJUSTMENT'] as const).map((tp) => (
                <SelectItem key={tp} value={tp}>
                  {t(`resellers.tx.${tp}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>{t('resellers.field.amount', { currency: reseller.currency })}</Label>
          <Input type='number' step='0.01' value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs'>{t('resellers.field.comment')}</Label>
          <Input value={comment} maxLength={500} placeholder={t('resellers.field.commentPlaceholder')} onChange={(e) => setComment(e.target.value)} />
        </div>
        <Button type='submit' disabled={!valid || change.isPending}>
          {t('resellers.admin.apply')}
        </Button>
      </form>
      <FormProblems problems={[amount.trim() !== '' && !valid && t('resellers.problem.amount')]} />
      <AdminErrorText error={change.error} />
    </PanelSection>
  )
}

/**
 * Реквизиты пополнения: какие кошельки видит этот реселлер — только выданные
 * ему и включённые. Ничего не выдано — пополнять баланс нечем. Как реквизиты
 * у тарифов товара; тот же доступ настраивается и из самих реквизитов.
 */
function RequisitesSection({ reseller }: { reseller: AdminReseller }) {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.RESELLERS_MANAGE)
  const options = useQuery(resellerPaymentOptionsQueryOptions(reseller.id))
  const available = useQuery({ ...paymentProfilesQueryOptions(undefined, 'RESELLERS'), enabled: canManage })
  const { attach, update, detach } = useResellerPaymentOptionMutations(reseller.id)
  const [picked, setPicked] = useState('')

  if (options.isPending) return <Skeleton className='h-32 w-full' />
  if (options.isError) return <AdminErrorText error={options.error} />

  const attachedIds = new Set(options.data.options.map((o) => o.profile.id))
  const candidates = (available.data ?? []).filter((p) => !attachedIds.has(p.id))
  const usable = options.data.options.some((o) => o.enabled && o.profile.ready)

  return (
    <div className='space-y-4'>
      <p
        className={cn(
          'rounded-md border p-3 text-sm',
          usable ? 'bg-muted/20 text-muted-foreground' : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        )}
      >
        {usable ? t('resellers.requisites.own') : t('resellers.requisites.none')}
      </p>

      {options.data.options.length > 0 && (
        <ul className='space-y-2'>
          {options.data.options.map(({ enabled, profile }) => (
            <li key={profile.id} className='flex items-center gap-3 rounded-md border p-3'>
              <Checkbox
                checked={enabled}
                disabled={!canManage || update.isPending}
                onCheckedChange={(v) => update.mutate({ profileId: profile.id, enabled: v === true })}
                aria-label={t('resellers.requisites.enabled')}
              />
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>{profile.name}</p>
                <p className='truncate font-mono text-xs text-muted-foreground'>
                  {'wallets' in profile.config
                    ? profile.config.wallets.map((w) => `${w.currency} · ${w.network}`).join(', ') || t('admin.profiles.noWallets')
                    : '—'}
                </p>
              </div>
              {profile.ready ? (
                <Badge variant='outline'>{t('admin.profiles.ready')}</Badge>
              ) : (
                <Badge variant='destructive' title={profile.notReadyReason ?? undefined}>
                  {t('admin.profiles.notReady')}
                </Badge>
              )}
              {canManage && (
                <Button
                  size='icon'
                  variant='ghost'
                  disabled={detach.isPending}
                  onClick={() => detach.mutate(profile.id)}
                  title={t('resellers.requisites.detach')}
                >
                  <Trash2 className='size-4' />
                  <span className='sr-only'>{t('resellers.requisites.detach')}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className='space-y-2'>
          <div className='flex gap-2'>
            <Select value={picked} onValueChange={setPicked} disabled={candidates.length === 0}>
              <SelectTrigger className='flex-1'>
                <SelectValue
                  placeholder={candidates.length === 0 ? t('resellers.requisites.noneLeft') : t('resellers.requisites.pick')}
                />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!picked || attach.isPending}
              onClick={() =>
                attach.mutate(picked, {
                  onSuccess: () => {
                    setPicked('')
                    toast.success(t('admin.saved'))
                  },
                })
              }
            >
              <Plus className='size-4' />
              {t('resellers.requisites.attach')}
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>
            {t('resellers.requisites.hint')}{' '}
            <Link to='/admin/payments' search={{ scope: 'RESELLERS' }} className='text-primary underline-offset-4 hover:underline'>
              {t('resellers.requisites.manage')}
            </Link>
          </p>
        </div>
      )}
      <AdminErrorText error={attach.error ?? update.error ?? detach.error} />
    </div>
  )
}
