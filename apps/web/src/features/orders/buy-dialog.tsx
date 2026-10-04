import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bitcoin, CreditCard, ExternalLink, Store } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPrice, purchaseUrl, type CatalogPlan } from '@/features/catalog/api'
import { paymentMethodsQueryOptions, useCreateOrder, type PublicPaymentMethod } from './api'

/**
 * Выбор способа оплаты для тарифа. Digiseller ведёт на площадку (код потом
 * активируется на /activate), ЮKassa — на свою страницу оплаты, крипта —
 * на страницу заказа с адресом и суммой.
 */
export function BuyDialog({
  plan,
  productId,
  productName,
  open,
  onOpenChange,
}: {
  plan: CatalogPlan | null
  productId: string
  productName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const methods = useQuery({ ...paymentMethodsQueryOptions(productId), enabled: open })
  const createOrder = useCreateOrder()
  const [walletId, setWalletId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      createOrder.reset()
      setWalletId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id])

  if (!plan) return null

  const available = (methods.data ?? []).filter(
    (m) => m.provider !== 'DIGISELLER' || plan.digisellerProductId != null
  )

  function payYookassa() {
    if (!plan) return
    createOrder.mutate(
      { planId: plan.id, provider: 'YOOKASSA' },
      {
        onSuccess: (order) => {
          const instructions = order.payment?.instructions
          if (instructions?.kind === 'redirect' && instructions.url) {
            window.location.assign(instructions.url)
          } else {
            void navigate({ to: '/orders/$orderId', params: { orderId: order.id } })
          }
        },
      }
    )
  }

  function payCrypto(method: PublicPaymentMethod) {
    if (!plan) return
    const wallet = walletId ?? method.wallets?.[0]?.id
    createOrder.mutate(
      { planId: plan.id, provider: 'CRYPTO', walletId: wallet },
      {
        onSuccess: (order) => {
          onOpenChange(false)
          void navigate({ to: '/orders/$orderId', params: { orderId: order.id } })
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('buy.title', { product: productName })}</DialogTitle>
          <DialogDescription>
            {t('buy.summary', { plan: plan.name, price: formatPrice(plan.price, plan.currency) })}
          </DialogDescription>
        </DialogHeader>

        {methods.isPending ? (
          <div className='space-y-2'>
            <Skeleton className='h-16 w-full' />
            <Skeleton className='h-16 w-full' />
          </div>
        ) : methods.isError ? (
          <ApiErrorText error={methods.error} />
        ) : available.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('buy.none')}</p>
        ) : (
          <div className='space-y-3'>
            {available.map((method) => (
              <div key={method.provider} className='space-y-3 rounded-lg border p-4'>
                <div className='flex items-start gap-3'>
                  <MethodIcon provider={method.provider} />
                  <div className='min-w-0 flex-1'>
                    <p className='font-medium'>{method.title}</p>
                    {method.description && (
                      <p className='text-sm text-muted-foreground'>{method.description}</p>
                    )}
                  </div>
                </div>

                {method.provider === 'DIGISELLER' && plan.digisellerProductId != null && (
                  <Button asChild className='w-full' variant='outline'>
                    <a href={purchaseUrl(plan.digisellerProductId)} target='_blank' rel='noopener noreferrer'>
                      {t('buy.digiseller.action')}
                      <ExternalLink className='size-3.5' />
                    </a>
                  </Button>
                )}

                {method.provider === 'YOOKASSA' && (
                  <Button className='w-full' disabled={createOrder.isPending} onClick={payYookassa}>
                    {createOrder.isPending ? t('buy.pending') : t('buy.yookassa.action')}
                  </Button>
                )}

                {method.provider === 'CRYPTO' && (
                  <div className='space-y-2'>
                    {(method.wallets?.length ?? 0) > 1 && (
                      <div className='space-y-1'>
                        <p className='text-xs text-muted-foreground'>{t('buy.crypto.pickWallet')}</p>
                        <div className='flex flex-wrap gap-2'>
                          {walletLabels(method.wallets!).map(({ wallet, label }) => {
                            const selected = (walletId ?? method.wallets![0]!.id) === wallet.id
                            return (
                              <Button
                                key={wallet.id}
                                size='sm'
                                variant={selected ? 'default' : 'outline'}
                                onClick={() => setWalletId(wallet.id)}
                              >
                                {label}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <Button className='w-full' disabled={createOrder.isPending} onClick={() => payCrypto(method)}>
                      {createOrder.isPending ? t('buy.pending') : t('buy.crypto.action')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <ApiErrorText error={createOrder.error} />
        {available.some((m) => m.provider === 'DIGISELLER') && (
          <p className='text-xs text-muted-foreground'>{t('buy.digiseller.hint')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Подписи кошельков: «USDT · TRC20». Кошельков одной монеты и сети может
 * быть несколько (разные реквизиты) — тогда к подписи добавляется номер.
 */
function walletLabels(wallets: NonNullable<PublicPaymentMethod['wallets']>) {
  const base = wallets.map((w) => `${w.currency} · ${w.network}`)
  const seen = new Map<string, number>()
  return wallets.map((wallet, i) => {
    const label = base[i]!
    const duplicates = base.filter((b) => b === label).length
    const n = (seen.get(label) ?? 0) + 1
    seen.set(label, n)
    return { wallet, label: duplicates > 1 ? `${label} (${n})` : label }
  })
}

function MethodIcon({ provider }: { provider: PublicPaymentMethod['provider'] }) {
  const className = 'mt-0.5 size-5 shrink-0 text-muted-foreground'
  if (provider === 'YOOKASSA') return <CreditCard className={className} />
  if (provider === 'CRYPTO') return <Bitcoin className={className} />
  return <Store className={className} />
}
