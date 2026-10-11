import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, X } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { formatDateTime } from '@/lib/format/date'
import { useT } from '@/lib/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { CopyButton } from '@/components/copy-button'
import { ACTIVE_ROW, CURSOR_ROW, PanelFacts, PanelSection, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { AdminErrorText } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import {
  adminTopupsQueryOptions,
  formatMoney,
  useConfirmTopup,
  useRejectTopup,
  type AdminTopup,
  type TopupFilter,
} from './api'
import { TOPUP_VARIANT } from './topups-panel'

const PAGE = 50
const FILTERS: TopupFilter[] = ['SUBMITTED', 'OPEN', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ALL']

/**
 * Заявки реселлеров на пополнение. Пока оплату сверяет человек: смотрит
 * перевод по хешу в обозревателе сети и подтверждает — тогда сумма уходит на
 * баланс. Подтверждать может обладатель `resellers.topups.confirm`
 * (поддержка, супер-админ); остальным с `resellers.read` — только просмотр.
 */
export function AdminTopupsPanel({
  resellerId,
  onOpenReseller,
}: {
  /** Только заявки этого реселлера — так список встроен в панель реселлера. */
  resellerId?: string
  /** Открыть панель реселлера из панели заявки. */
  onOpenReseller?: (id: string) => void
} = {}) {
  const t = useT()
  const { can } = useSession()
  const canReview = can(PERMISSIONS.RESELLERS_TOPUPS_CONFIRM)
  const embedded = Boolean(resellerId)
  const [status, setStatus] = useState<TopupFilter>(embedded ? 'ALL' : 'SUBMITTED')
  const [skip, setSkip] = useState(0)
  const [confirming, setConfirming] = useState<AdminTopup | null>(null)
  const [rejecting, setRejecting] = useState<AdminTopup | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => setSkip(0), [status])

  const query = useQuery(adminTopupsQueryOptions({ status, skip, take: PAGE, resellerId }))
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const selected = items.find((r) => r.id === selectedId) ?? null
  // Список внутри карточки реселлера клавишами не управляется — там своя панель.
  const cursor = useListHotkeys({
    ids: items.map((r) => r.id),
    openedId: selectedId,
    onOpen: setSelectedId,
    onClose: () => setSelectedId(null),
    enabled: !embedded,
  })
  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='space-y-4'>
      {!embedded && <p className='text-sm text-muted-foreground'>{t('resellers.topups.hint')}</p>}
      <div className='flex flex-wrap items-center gap-1'>
        {FILTERS.map((f) => (
          <Button key={f} size='sm' variant={status === f ? 'default' : 'outline'} className='h-7' onClick={() => setStatus(f)}>
            {t(`resellers.topups.filter.${f}`)}
            {f === 'SUBMITTED' && (query.data?.awaiting ?? 0) > 0 && (
              <Badge variant='secondary' className='ms-1 h-4 px-1 text-[10px]'>
                {query.data?.awaiting}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {query.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : items.length === 0 ? (
        <Alert>
          <AlertDescription>{t('resellers.topups.empty')}</AlertDescription>
        </Alert>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('resellers.topups.column.created')}</TableHead>
                <TableHead>{t('resellers.topups.column.reseller')}</TableHead>
                <TableHead className='text-right'>{t('resellers.topups.column.amount')}</TableHead>
                <TableHead>{t('resellers.topups.column.payment')}</TableHead>
                <TableHead>{t('resellers.topups.column.tx')}</TableHead>
                <TableHead>{t('resellers.topups.column.status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => {
                const i = r.instructions
                const explorer = r.txHash && i.explorerTxUrl ? i.explorerTxUrl.replace('{tx}', encodeURIComponent(r.txHash)) : null
                return (
                  <TableRow
                    key={r.id}
                    data-row-id={embedded ? undefined : r.id}
                    className={cn(!embedded && 'cursor-pointer', selectedId === r.id && ACTIVE_ROW, !embedded && cursor === r.id && CURSOR_ROW)}
                    onClick={embedded ? undefined : () => setSelectedId(r.id)}
                  >
                    <TableCell className='whitespace-nowrap text-muted-foreground'>
                      {formatDateTime(r.createdAt)}
                      {r.submittedAt && (
                        <span className='block text-xs'>{t('resellers.topups.submittedAt', { date: formatDateTime(r.submittedAt) })}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className='font-medium'>{r.reseller.displayName}</span>
                      <span className='block text-xs text-muted-foreground'>{r.reseller.user.username}</span>
                      {r.note && <span className='block max-w-56 truncate text-xs text-muted-foreground' title={r.note}>«{r.note}»</span>}
                    </TableCell>
                    <TableCell className='text-right font-medium whitespace-nowrap'>
                      {formatMoney(r.amount, r.currency)}
                      {r.creditedAmount !== null && Number(r.creditedAmount) !== Number(r.amount) && (
                        <span className='block text-xs text-muted-foreground'>
                          {t('resellers.topups.creditedAs', { amount: formatMoney(r.creditedAmount, r.currency) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className='text-sm'>
                      <span className='font-mono font-semibold'>
                        {i.amount} {i.currency}
                      </span>
                      <span className='ms-1 text-xs text-muted-foreground'>{i.network}</span>
                      <span className='block max-w-56 truncate font-mono text-xs text-muted-foreground' title={i.address}>
                        {i.address}
                      </span>
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {r.txHash ? (
                        <span className='inline-flex items-center gap-1'>
                          <span className='max-w-40 truncate' title={r.txHash}>
                            {r.txHash}
                          </span>
                          <CopyButton value={r.txHash} label='TX' />
                          {explorer && (
                            <a href={explorer} target='_blank' rel='noreferrer noopener' className='text-muted-foreground hover:text-foreground'>
                              <ExternalLink className='size-3.5' />
                              <span className='sr-only'>{t('resellers.topups.explorer')}</span>
                            </a>
                          )}
                        </span>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TOPUP_VARIANT[r.status]}>
                        {r.expired ? t('resellers.topup.status.EXPIRED') : t(`resellers.topup.status.${r.status}`)}
                      </Badge>
                      {r.rejectReason && <span className='block max-w-48 text-xs text-muted-foreground'>{r.rejectReason}</span>}
                    </TableCell>
                    <TableCell className='text-right whitespace-nowrap' onClick={(e) => e.stopPropagation()}>
                      {canReview && (r.status === 'SUBMITTED' || r.status === 'PENDING') && (
                        <>
                          <Button size='sm' variant='outline' onClick={() => setConfirming(r)}>
                            <Check className='size-4' />
                            {t('resellers.topups.confirm')}
                          </Button>
                          <Button size='sm' variant='ghost' title={t('resellers.topups.reject')} onClick={() => setRejecting(r)}>
                            <X className='size-4' />
                            <span className='sr-only'>{t('resellers.topups.reject')}</span>
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {total > PAGE && (
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
      )}

      <ConfirmDialog topup={confirming} onOpenChange={(open) => !open && setConfirming(null)} />
      <RejectDialog topup={rejecting} onOpenChange={(open) => !open && setRejecting(null)} />
      {!embedded && (
        <TopupPanel
          topup={selected}
          onClose={() => setSelectedId(null)}
          canReview={canReview}
          onConfirm={setConfirming}
          onReject={setRejecting}
          onOpenReseller={
            onOpenReseller
              ? (id) => {
                  // Одна панель за раз: заявка уступает место реселлеру.
                  setSelectedId(null)
                  onOpenReseller(id)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

/** Заявка в правой панели: всё для сверки перевода и решение по ней. */
function TopupPanel({
  topup,
  onClose,
  canReview,
  onConfirm,
  onReject,
  onOpenReseller,
}: {
  topup: AdminTopup | null
  onClose: () => void
  canReview: boolean
  onConfirm: (topup: AdminTopup) => void
  onReject: (topup: AdminTopup) => void
  onOpenReseller?: (id: string) => void
}) {
  const t = useT()
  if (!topup) return null
  const i = topup.instructions
  const explorer = topup.txHash && i.explorerTxUrl ? i.explorerTxUrl.replace('{tx}', encodeURIComponent(topup.txHash)) : null
  const open = topup.status === 'SUBMITTED' || topup.status === 'PENDING'

  return (
    <SidePanel
      open
      onClose={onClose}
      title={formatMoney(topup.amount, topup.currency)}
      subtitle={t('resellers.topups.panelSubtitle', { name: topup.reseller.displayName, date: formatDateTime(topup.createdAt) })}
      badges={
        <Badge variant={TOPUP_VARIANT[topup.status]}>
          {topup.expired ? t('resellers.topup.status.EXPIRED') : t(`resellers.topup.status.${topup.status}`)}
        </Badge>
      }
    >
      {canReview && open && (
        <div className='flex flex-wrap gap-2'>
          <Button onClick={() => onConfirm(topup)}>
            <Check className='size-4' />
            {t('resellers.topups.confirm')}
          </Button>
          <Button variant='outline' onClick={() => onReject(topup)}>
            <X className='size-4' />
            {t('resellers.topups.reject')}
          </Button>
        </div>
      )}
      {topup && !topup.txHash && open && <p className='text-sm text-amber-600 dark:text-amber-400'>{t('resellers.topups.noTx')}</p>}

      <PanelSection title={t('resellers.topups.section.payment')}>
        <PanelFacts
          rows={[
            [t('resellers.topups.column.amount'), formatMoney(topup.amount, topup.currency)],
            [t('resellers.topups.field.coins'), <span className='font-mono font-semibold'>{`${i.amount} ${i.currency}`}</span>],
            [t('resellers.topups.field.network'), i.network],
            [
              t('resellers.topups.field.address'),
              <span className='inline-flex items-center gap-1 font-mono text-xs break-all'>
                {i.address}
                <CopyButton value={i.address} label={t('resellers.topups.field.address')} />
              </span>,
            ],
            [
              t('resellers.topups.column.tx'),
              topup.txHash ? (
                <span className='inline-flex items-center gap-1 font-mono text-xs break-all'>
                  {topup.txHash}
                  <CopyButton value={topup.txHash} label='TX' />
                  {explorer && (
                    <a href={explorer} target='_blank' rel='noreferrer noopener' className='text-muted-foreground hover:text-foreground'>
                      <ExternalLink className='size-3.5' />
                      <span className='sr-only'>{t('resellers.topups.explorer')}</span>
                    </a>
                  )}
                </span>
              ) : (
                '—'
              ),
            ],
            [t('resellers.topups.field.expires'), formatDateTime(topup.expiresAt)],
            [t('resellers.topups.field.submitted'), topup.submittedAt ? formatDateTime(topup.submittedAt) : '—'],
            [t('resellers.topups.field.reviewed'), topup.reviewedAt ? formatDateTime(topup.reviewedAt) : '—'],
            ...(topup.creditedAmount !== null
              ? [[t('resellers.topups.field.credited'), formatMoney(topup.creditedAmount, topup.currency)] as [string, string]]
              : []),
            ...(topup.rejectReason ? [[t('resellers.topups.reason'), topup.rejectReason] as [string, string]] : []),
            ...(topup.note ? [[t('resellers.field.comment'), topup.note] as [string, string]] : []),
          ]}
        />
      </PanelSection>

      <PanelSection title={t('resellers.topups.column.reseller')}>
        <div className='flex items-center justify-between gap-2 rounded-md border p-3'>
          <span>
            <span className='font-medium'>{topup.reseller.displayName}</span>
            <span className='block text-xs text-muted-foreground'>{topup.reseller.user.username}</span>
          </span>
          {onOpenReseller && (
            <Button size='sm' variant='outline' onClick={() => onOpenReseller(topup.reseller.id)}>
              {t('resellers.topups.openReseller')}
            </Button>
          )}
        </div>
      </PanelSection>
    </SidePanel>
  )
}

/** Подтверждение: сумму можно поправить, если пришло не столько, сколько заявлено. */
export function ConfirmDialog({ topup, onOpenChange }: { topup: AdminTopup | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const confirm = useConfirmTopup()
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!topup) return
    confirm.reset()
    setAmount(String(Number(topup.amount)))
    setComment('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topup?.id])

  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0

  return (
    <Dialog open={topup !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (!topup || !valid) return
            confirm.mutate(
              { id: topup.id, amount: value, comment: comment.trim() || undefined },
              {
                onSuccess: (r) => {
                  toast.success(t('resellers.topups.confirmed', { balance: formatMoney(r.balance, topup.currency) }))
                  onOpenChange(false)
                },
              }
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('resellers.topups.confirmTitle', { name: topup?.reseller.displayName ?? '' })}</DialogTitle>
            <DialogDescription>
              {topup &&
                t('resellers.topups.confirmHint', {
                  coins: `${topup.instructions.amount} ${topup.instructions.currency}`,
                  network: topup.instructions.network,
                })}
            </DialogDescription>
          </DialogHeader>
          {topup && !topup.txHash && <p className='text-sm text-amber-600 dark:text-amber-400'>{t('resellers.topups.noTx')}</p>}
          <div className='space-y-2'>
            <Label htmlFor='tc-amount'>{t('resellers.field.amount', { currency: topup?.currency ?? 'RUB' })}</Label>
            <Input id='tc-amount' type='number' min={0.01} step='0.01' value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='tc-comment'>{t('resellers.field.comment')}</Label>
            <Input id='tc-comment' value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
          </div>
          <FormProblems problems={[amount.trim() !== '' && !valid && t('resellers.problem.amount')]} />
          <AdminErrorText error={confirm.error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' disabled={!valid || confirm.isPending}>
              {t('resellers.topups.confirmSubmit', { amount: formatMoney(valid ? value : 0, topup?.currency) })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RejectDialog({ topup, onOpenChange }: { topup: AdminTopup | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const reject = useRejectTopup()
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!topup) return
    reject.reset()
    setReason('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topup?.id])

  const valid = reason.trim().length >= 3

  return (
    <Dialog open={topup !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (!topup || !valid) return
            reject.mutate(
              { id: topup.id, reason: reason.trim() },
              {
                onSuccess: () => {
                  toast.success(t('resellers.topups.rejectedDone'))
                  onOpenChange(false)
                },
              }
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('resellers.topups.rejectTitle', { name: topup?.reseller.displayName ?? '' })}</DialogTitle>
            <DialogDescription>{t('resellers.topups.rejectHint')}</DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='tr-reason'>{t('resellers.topups.reason')}</Label>
            <Textarea id='tr-reason' rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <AdminErrorText error={reject.error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' variant='destructive' disabled={!valid || reject.isPending}>
              {t('resellers.topups.reject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
