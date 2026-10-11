import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/format/date'
import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/copy-button'
import { AdminErrorText, adminErrorMessage } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import {
  formatMoney,
  myTopupsQueryOptions,
  topupOptionsQueryOptions,
  useCancelTopup,
  useCreateTopup,
  useSubmitTopupTx,
  type ResellerTopup,
  type TopupStatus,
  type TopupWallet,
} from './api'
import { TransactionsTable } from './transactions-table'

export const TOPUP_VARIANT: Record<TopupStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PENDING: 'outline',
  SUBMITTED: 'secondary',
  CONFIRMED: 'default',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
}

/**
 * Вкладка «Баланс» реселлера: пополнение криптой (как покупка на сайте —
 * адрес, сумма в монетах, хеш, подтверждение администратором) и история.
 */
export function TopupsPanel({ disabled }: { disabled: boolean }) {
  const t = useT()
  const options = useQuery(topupOptionsQueryOptions())
  const topups = useQuery(myTopupsQueryOptions({ skip: 0, take: 20 }))
  const create = useCreateTopup()
  const [amount, setAmount] = useState('')
  const [walletId, setWalletId] = useState('')
  const [note, setNote] = useState('')

  const wallets = options.data?.wallets ?? []
  const currency = options.data?.currency ?? 'RUB'
  const value = Number(amount)
  const problems = [
    amount.trim() !== '' && !(value >= 1) && t('resellers.topup.problem.amount'),
    wallets.length > 0 && !walletId && amount.trim() !== '' && t('resellers.topup.problem.wallet'),
  ]
  const valid = value >= 1 && Boolean(walletId)

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Wallet className='size-4' />
            {t('resellers.topup.title')}
          </CardTitle>
          <CardDescription>{t('resellers.topup.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {options.isPending ? (
            <Skeleton className='h-20 w-full' />
          ) : wallets.length === 0 ? (
            <p className='text-sm text-muted-foreground'>{t('resellers.topup.noWallets')}</p>
          ) : (
            <form
              className='space-y-4'
              onSubmit={(e) => {
                e.preventDefault()
                if (!valid) return
                create.mutate(
                  { amount: value, walletId, note: note.trim() || undefined },
                  {
                    onSuccess: () => {
                      setAmount('')
                      setNote('')
                      toast.success(t('resellers.topup.created'))
                    },
                  }
                )
              }}
            >
              <div className='grid gap-4 md:grid-cols-[1fr_1fr_2fr]'>
                <div className='space-y-2'>
                  <Label htmlFor='tp-amount'>{t('resellers.topup.amount', { currency })}</Label>
                  <Input id='tp-amount' type='number' min={1} step='0.01' value={amount} disabled={disabled} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label>{t('resellers.topup.wallet')}</Label>
                  <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} disabled={disabled} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='tp-note'>{t('resellers.topup.note')}</Label>
                  <Input id='tp-note' value={note} maxLength={500} disabled={disabled} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <FormProblems problems={problems} />
              <AdminErrorText error={create.error} />
              <Button type='submit' disabled={disabled || !valid || create.isPending}>
                {t('resellers.topup.submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <section className='space-y-3'>
        <h3 className='text-sm font-semibold'>{t('resellers.topup.requests')}</h3>
        {topups.isPending ? (
          <Skeleton className='h-24 w-full' />
        ) : topups.isError ? (
          <AdminErrorText error={topups.error} />
        ) : topups.data.items.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('resellers.topup.none')}</p>
        ) : (
          <div className='space-y-3'>
            {topups.data.items.map((topup) => (
              <TopupCard key={topup.id} topup={topup} />
            ))}
          </div>
        )}
      </section>

      <section className='space-y-3'>
        <h3 className='text-sm font-semibold'>{t('resellers.panel.tab.transactions')}</h3>
        <TransactionsTable />
      </section>
    </div>
  )
}

/**
 * Выбор кошелька: кошельки сгруппированы по реквизитам (у двух реквизитов
 * может быть одинаковый USDT · TRC20), монета — отдельной меткой. В закрытом
 * поле видно и реквизиты, и монету.
 */
function WalletSelect({
  wallets,
  value,
  onChange,
  disabled,
}: {
  wallets: TopupWallet[]
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const t = useT()
  const groups = new Map<string, { name: string; wallets: TopupWallet[] }>()
  for (const w of wallets) {
    const group = groups.get(w.profileId) ?? { name: w.profileName, wallets: [] }
    group.wallets.push(w)
    groups.set(w.profileId, group)
  }
  const selected = wallets.find((w) => w.id === value)

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className='w-full min-w-56'>
        <SelectValue placeholder={t('resellers.topup.walletPlaceholder')}>
          {selected && (
            <span className='flex min-w-0 items-center gap-2'>
              <Coin wallet={selected} />
              <span className='truncate text-muted-foreground'>{selected.profileName}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {[...groups.entries()].map(([profileId, group]) => (
          <SelectGroup key={profileId}>
            <SelectLabel className='font-medium text-foreground'>{group.name}</SelectLabel>
            {group.wallets.map((w) => (
              <SelectItem key={w.id} value={w.id} className='ps-4'>
                <Coin wallet={w} />
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

function Coin({ wallet }: { wallet: TopupWallet }) {
  return (
    <span className='flex items-center gap-1.5'>
      <span className='rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary'>{wallet.currency}</span>
      <span className='text-xs text-muted-foreground'>{wallet.network}</span>
    </span>
  )
}

function TopupCard({ topup }: { topup: ResellerTopup }) {
  const t = useT()
  const submit = useSubmitTopupTx()
  const cancel = useCancelTopup()
  const [txHash, setTxHash] = useState(topup.txHash ?? '')
  const i = topup.instructions
  const open = topup.status === 'PENDING' && !topup.expired
  const canFixHash = topup.status === 'SUBMITTED'

  return (
    <div className='space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='font-medium'>
          {formatMoney(topup.amount, topup.currency)}
          <span className='ms-2 text-sm text-muted-foreground'>{formatDateTime(topup.createdAt)}</span>
        </p>
        <Badge variant={TOPUP_VARIANT[topup.status]}>
          {topup.expired ? t('resellers.topup.status.EXPIRED') : t(`resellers.topup.status.${topup.status}`)}
        </Badge>
      </div>

      {(open || canFixHash) && (
        <div className='grid gap-2 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-[auto_1fr]'>
          <span className='text-muted-foreground'>{t('resellers.topup.send')}</span>
          <span className='inline-flex flex-wrap items-center gap-1 font-mono font-semibold'>
            {i.amount} {i.currency}
            <CopyButton value={i.amount} label={t('resellers.topup.coinAmount')} />
            <span className='font-sans font-normal text-muted-foreground'>({i.network})</span>
          </span>
          <span className='text-muted-foreground'>{t('resellers.topup.address')}</span>
          <span className='inline-flex min-w-0 items-center gap-1 font-mono text-xs break-all'>
            {i.address}
            <CopyButton value={i.address} label={t('resellers.topup.address')} />
          </span>
          {open && (
            <>
              <span className='text-muted-foreground'>{t('resellers.topup.until')}</span>
              <span className='inline-flex items-center gap-1'>
                <Clock className='size-3.5' />
                {formatDateTime(topup.expiresAt)}
              </span>
            </>
          )}
          {i.note && <p className='text-xs text-muted-foreground sm:col-span-2'>{i.note}</p>}
        </div>
      )}

      {(open || canFixHash) && (
        <form
          className='flex flex-wrap items-end gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            submit.mutate(
              { id: topup.id, txHash: txHash.trim() },
              { onSuccess: () => toast.success(t('resellers.topup.sent')) }
            )
          }}
        >
          <div className='min-w-72 flex-1 space-y-1'>
            <Label htmlFor={`tx-${topup.id}`} className='text-xs'>
              {t('resellers.topup.txHash')}
            </Label>
            <Input id={`tx-${topup.id}`} value={txHash} className='font-mono text-xs' onChange={(e) => setTxHash(e.target.value)} />
          </div>
          <Button type='submit' disabled={txHash.trim().length < 16 || submit.isPending}>
            {canFixHash ? t('resellers.topup.fixHash') : t('resellers.topup.paid')}
          </Button>
          {open && (
            <Button
              type='button'
              variant='ghost'
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(topup.id, { onError: (e) => toast.error(adminErrorMessage(e)) })}
            >
              {t('resellers.topup.cancel')}
            </Button>
          )}
        </form>
      )}
      <AdminErrorText error={submit.error} />

      {topup.status === 'SUBMITTED' && <p className='text-sm text-muted-foreground'>{t('resellers.topup.waiting')}</p>}
      {topup.status === 'CONFIRMED' && (
        <p className='text-sm'>{t('resellers.topup.credited', { amount: formatMoney(topup.creditedAmount ?? topup.amount, topup.currency) })}</p>
      )}
      {topup.status === 'REJECTED' && (
        <p className='text-sm text-destructive'>{t('resellers.topup.rejected', { reason: topup.rejectReason ?? '—' })}</p>
      )}
      {topup.txHash && !canFixHash && (
        <p className='font-mono text-xs break-all text-muted-foreground'>TX: {topup.txHash}</p>
      )}
    </div>
  )
}
