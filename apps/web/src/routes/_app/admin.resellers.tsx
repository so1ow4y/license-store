import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { History, Plus, Search, Settings2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { adminProductsQueryOptions } from '@/features/admin-products/api'
import {
  RESELLER_STATUSES,
  adminResellersQueryOptions,
  formatMoney,
  useChangeResellerBalance,
  useCreateReseller,
  useUpdateReseller,
  type AdminReseller,
  type ResellerStatus,
} from '@/features/resellers/api'
import { AdminTopupsPanel } from '@/features/resellers/admin-topups'
import { TransactionsTable } from '@/features/resellers/transactions-table'

const PAGE = 50
const ANY = 'ANY'
const TABS = ['resellers', 'topups'] as const

/**
 * Реселлеры: кто продаёт, на каких условиях, сколько на балансе и сколько
 * продал. Пополнение баланса — это деньги, которые реселлер уже заплатил
 * платформе: либо заявка с переводом криптой (вкладка «Пополнения»), либо
 * ручное зачисление.
 */
export const Route = createFileRoute('/_app/admin/resellers')({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  beforeLoad: ({ context }) => {
    const allowed = hasAny(context.me.permissions, [
      PERMISSIONS.RESELLERS_READ,
      PERMISSIONS.RESELLERS_MANAGE,
      PERMISSIONS.RESELLERS_TOPUPS_CONFIRM,
    ])
    if (!allowed) throw redirect({ to: '/403' })
  },
  component: AdminResellersPage,
})

const STATUS_VARIANT: Record<ResellerStatus, 'default' | 'secondary' | 'outline'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  CLOSED: 'outline',
}

function AdminResellersPage() {
  const t = useT()
  const { can } = useSession()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const visible = TABS.filter((name) =>
    name === 'resellers'
      ? can(PERMISSIONS.RESELLERS_READ) || can(PERMISSIONS.RESELLERS_MANAGE)
      : can(PERMISSIONS.RESELLERS_READ) || can(PERMISSIONS.RESELLERS_TOPUPS_CONFIRM)
  )
  const current = tab && visible.includes(tab) ? tab : visible[0]

  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('resellers.admin.title')} description={t('resellers.admin.description')} />
      <Tabs value={current} onValueChange={(value) => void navigate({ search: { tab: value as (typeof TABS)[number] } })}>
        <TabsList>
          {visible.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`resellers.admin.tab.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {visible.includes('resellers') && (
          <TabsContent value='resellers' className='mt-4'>
            <ResellersTab />
          </TabsContent>
        )}
        {visible.includes('topups') && (
          <TabsContent value='topups' className='mt-4'>
            <AdminTopupsPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function ResellersTab() {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.RESELLERS_MANAGE)
  const canBalance = can(PERMISSIONS.RESELLERS_BALANCE)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ResellerStatus | typeof ANY>(ANY)
  const [skip, setSkip] = useState(0)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AdminReseller | null>(null)
  const [funding, setFunding] = useState<AdminReseller | null>(null)
  const [history, setHistory] = useState<AdminReseller | null>(null)

  useEffect(() => setSkip(0), [search, status])

  const query = useQuery(
    adminResellersQueryOptions({ search: search || undefined, status: status === ANY ? undefined : status, skip, take: PAGE })
  )

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0

  return (
    <div className='space-y-4'>
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
            <Input value={draft} placeholder={t('resellers.admin.searchPlaceholder')} className='pl-8' onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Button type='submit' variant='outline'>
            {t('common.action.search')}
          </Button>
        </form>
        <Select value={status} onValueChange={(v) => setStatus(v as ResellerStatus | typeof ANY)}>
          <SelectTrigger className='w-48'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('resellers.status.any')}</SelectItem>
            {RESELLER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`resellers.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus className='size-4' />
            {t('resellers.admin.create')}
          </Button>
        )}
      </div>

      {query.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : items.length === 0 ? (
        <Alert>
          <AlertDescription>{search || status !== ANY ? t('resellers.admin.nothingFound') : t('resellers.admin.empty')}</AlertDescription>
        </Alert>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('resellers.admin.column.reseller')}</TableHead>
                <TableHead>{t('resellers.admin.column.status')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.balance')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.discount')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.credit')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.sales30d')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.clients')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.licenses')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.keys')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className='font-medium'>{r.displayName}</span>
                    <span className='block text-xs text-muted-foreground'>
                      {r.user.username}
                      {r.user.email ? ` · ${r.user.email}` : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{t(`resellers.status.${r.status}`)}</Badge>
                  </TableCell>
                  <TableCell className={cn('text-right font-medium whitespace-nowrap', Number(r.balance) < 0 && 'text-destructive')}>
                    {formatMoney(r.balance, r.currency)}
                  </TableCell>
                  <TableCell className='text-right'>{Number(r.discountPercent)}%</TableCell>
                  <TableCell className='text-right whitespace-nowrap'>{formatMoney(r.creditLimit, r.currency)}</TableCell>
                  <TableCell className='text-right whitespace-nowrap'>{formatMoney(r.sales30d ?? 0, r.currency)}</TableCell>
                  <TableCell className='text-right'>{r.clients}</TableCell>
                  <TableCell className='text-right'>{r.licenses}</TableCell>
                  <TableCell className='text-right'>{r.keys}</TableCell>
                  <TableCell className='text-right whitespace-nowrap'>
                    {canBalance && (
                      <Button size='sm' variant='outline' onClick={() => setFunding(r)}>
                        <Wallet className='size-4' />
                        {t('resellers.admin.topup')}
                      </Button>
                    )}
                    {canManage && (
                      <Button size='sm' variant='ghost' onClick={() => setEditing(r)} title={t('resellers.admin.edit')}>
                        <Settings2 className='size-4' />
                        <span className='sr-only'>{t('resellers.admin.edit')}</span>
                      </Button>
                    )}
                    <Button size='sm' variant='ghost' onClick={() => setHistory(r)} title={t('resellers.history')}>
                      <History className='size-4' />
                      <span className='sr-only'>{t('resellers.history')}</span>
                    </Button>
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

      <ResellerDialog
        open={creating || editing !== null}
        reseller={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
      <BalanceDialog reseller={funding} onOpenChange={(open) => !open && setFunding(null)} />
      <Dialog open={history !== null} onOpenChange={(open) => !open && setHistory(null)}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-4xl'>
          <DialogHeader>
            <DialogTitle>{t('resellers.historyOf', { name: history?.displayName ?? '' })}</DialogTitle>
            <DialogDescription>{t('resellers.historyHint')}</DialogDescription>
          </DialogHeader>
          {history && <TransactionsTable resellerId={history.id} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Новый реселлер (по логину существующего аккаунта) или правка условий. */
function ResellerDialog({
  open,
  reseller,
  onOpenChange,
}: {
  open: boolean
  reseller: AdminReseller | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const create = useCreateReseller()
  const update = useUpdateReseller()
  const products = useQuery({ ...adminProductsQueryOptions(), enabled: open })
  const mutation = reseller ? update : create

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [status, setStatus] = useState<ResellerStatus>('ACTIVE')
  const [discount, setDiscount] = useState('0')
  const [credit, setCredit] = useState('0')
  const [resets, setResets] = useState('10')
  const [allowed, setAllowed] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    create.reset()
    update.reset()
    setUsername(reseller?.user.username ?? '')
    setDisplayName(reseller?.displayName ?? '')
    setStatus(reseller?.status ?? 'ACTIVE')
    setDiscount(String(Number(reseller?.discountPercent ?? 0)))
    setCredit(String(Number(reseller?.creditLimit ?? 0)))
    setResets(String(reseller?.hwidResetDailyLimit ?? 10))
    setAllowed(new Set(reseller?.allowedProductIds ?? []))
    setNotes(reseller?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reseller?.id])

  const discountValue = Number(discount)
  const creditValue = Number(credit)
  const resetsValue = Number(resets)
  const problems = [
    !reseller && !username.trim() && t('resellers.problem.username'),
    !displayName.trim() && t('resellers.problem.displayName'),
    !(discount.trim() !== '' && discountValue >= 0 && discountValue <= 100) && t('resellers.problem.discount'),
    !(credit.trim() !== '' && creditValue >= 0) && t('resellers.problem.credit'),
    !(Number.isInteger(resetsValue) && resetsValue >= 0 && resetsValue <= 1000) && t('resellers.problem.resets'),
  ]
  const valid = problems.every((p) => !p)

  function toggle(id: string) {
    const next = new Set(allowed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setAllowed(next)
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    const terms = {
      displayName: displayName.trim(),
      discountPercent: discountValue,
      creditLimit: creditValue,
      hwidResetDailyLimit: resetsValue,
      allowedProductIds: [...allowed],
      notes: notes.trim(),
    }
    const done = {
      onSuccess: () => {
        toast.success(t('admin.saved'))
        onOpenChange(false)
      },
    }
    if (reseller) update.mutate({ id: reseller.id, body: { ...terms, status } }, done)
    else create.mutate({ ...terms, username: username.trim() }, done)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <form onSubmit={onSubmit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>{reseller ? t('resellers.admin.edit') : t('resellers.admin.create')}</DialogTitle>
            <DialogDescription>{reseller ? t('resellers.admin.editHint') : t('resellers.admin.createHint')}</DialogDescription>
          </DialogHeader>

          <div className='grid gap-4 sm:grid-cols-2'>
            {!reseller && (
              <div className='space-y-2 sm:col-span-2'>
                <Label htmlFor='rs-user'>{t('resellers.field.username')}</Label>
                <Input id='rs-user' value={username} placeholder='partner42' onChange={(e) => setUsername(e.target.value)} />
                <p className='text-xs text-muted-foreground'>{t('resellers.field.usernameHint')}</p>
              </div>
            )}
            <div className='space-y-2 sm:col-span-2'>
              <Label htmlFor='rs-name'>{t('resellers.field.displayName')}</Label>
              <Input id='rs-name' value={displayName} maxLength={128} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='rs-discount'>{t('resellers.field.discount')}</Label>
              <Input id='rs-discount' type='number' min={0} max={100} step='0.01' value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <p className='text-xs text-muted-foreground'>{t('resellers.field.discountHint')}</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='rs-credit'>{t('resellers.field.credit')}</Label>
              <Input id='rs-credit' type='number' min={0} step='0.01' value={credit} onChange={(e) => setCredit(e.target.value)} />
              <p className='text-xs text-muted-foreground'>{t('resellers.field.creditHint')}</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='rs-resets'>{t('resellers.field.resets')}</Label>
              <Input id='rs-resets' type='number' min={0} max={1000} value={resets} onChange={(e) => setResets(e.target.value)} />
            </div>
            {reseller && (
              <div className='space-y-2'>
                <Label>{t('resellers.field.status')}</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as ResellerStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESELLER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`resellers.status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className='text-xs text-muted-foreground'>{t(`resellers.statusHint.${status}`)}</p>
              </div>
            )}
            <div className='space-y-2 sm:col-span-2'>
              <Label>{t('resellers.field.products')}</Label>
              <div className='max-h-44 space-y-1 overflow-y-auto rounded-md border p-2'>
                {(products.data ?? []).map((p) => (
                  <label key={p.id} className='flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent'>
                    <Checkbox checked={allowed.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    {p.name}
                    <span className='font-mono text-xs text-muted-foreground'>{p.slug}</span>
                  </label>
                ))}
              </div>
              <p className='text-xs text-muted-foreground'>{t('resellers.field.productsHint')}</p>
            </div>
            <div className='space-y-2 sm:col-span-2'>
              <Label htmlFor='rs-notes'>{t('resellers.field.notes')}</Label>
              <Textarea id='rs-notes' rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <FormProblems problems={problems} />
          <AdminErrorText error={mutation.error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' disabled={!valid || mutation.isPending}>
              {t('common.action.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Пополнение (реселлер заплатил), бонус или корректировка баланса. */
function BalanceDialog({ reseller, onOpenChange }: { reseller: AdminReseller | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const change = useChangeResellerBalance()
  const [type, setType] = useState<'TOPUP' | 'ADJUSTMENT' | 'COMMISSION'>('TOPUP')
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!reseller) return
    change.reset()
    setType('TOPUP')
    setAmount('')
    setComment('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseller?.id])

  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value !== 0 && (type === 'ADJUSTMENT' || value > 0)

  return (
    <Dialog open={reseller !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (!reseller || !valid) return
            change.mutate(
              { id: reseller.id, type, amount: value, comment: comment.trim() || undefined },
              {
                onSuccess: (r) => {
                  toast.success(t('resellers.admin.balanceDone', { balance: formatMoney(r.balance, reseller.currency) }))
                  onOpenChange(false)
                },
              }
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('resellers.admin.balanceTitle', { name: reseller?.displayName ?? '' })}</DialogTitle>
            <DialogDescription>
              {t('resellers.admin.balanceNow', { balance: formatMoney(reseller?.balance ?? 0, reseller?.currency) })}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label>{t('resellers.field.txType')}</Label>
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
            <p className='text-xs text-muted-foreground'>{t(`resellers.txHint.${type}`)}</p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='rs-amount'>{t('resellers.field.amount', { currency: reseller?.currency ?? 'RUB' })}</Label>
            <Input id='rs-amount' type='number' step='0.01' value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='rs-comment'>{t('resellers.field.comment')}</Label>
            <Input id='rs-comment' value={comment} maxLength={500} placeholder={t('resellers.field.commentPlaceholder')} onChange={(e) => setComment(e.target.value)} />
          </div>
          <FormProblems problems={[amount.trim() !== '' && !valid && t('resellers.problem.amount')]} />
          <AdminErrorText error={change.error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' disabled={!valid || change.isPending}>
              {t('resellers.admin.apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
