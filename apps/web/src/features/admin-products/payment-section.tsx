import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Pencil, Plus, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText, adminErrorMessage } from '@/features/admin/error-text'
import {
  paymentProfilesQueryOptions,
  productPaymentOptionsQueryOptions,
  useProductOptionMutations,
  type MethodConfig,
  type PaymentProfile,
  type ProductPaymentOption,
} from '@/features/admin-payments/api'
import { ProfileEditor } from '@/features/admin-payments/profile-editor'

/**
 * Оплата товара: для каждого способа — все реквизиты, куда могут идти деньги.
 * Реквизитов одного способа может быть сколько угодно: два крипто-кошелька —
 * и покупатель сам выбирает, куда платить. Шаблон привязывает и поддержка;
 * свои реквизиты создаёт админ товаров.
 */
export function PaymentSection({ productId }: { productId: string }) {
  const t = useT()
  const options = useQuery(productPaymentOptionsQueryOptions(productId))
  const profiles = useQuery(paymentProfilesQueryOptions(productId))

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.productPayments.title')}</CardTitle>
        <CardDescription>{t('admin.productPayments.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {options.isPending || profiles.isPending ? (
          <Skeleton className='h-32 w-full' />
        ) : options.isError || profiles.isError ? (
          <AdminErrorText error={options.error ?? profiles.error} />
        ) : (
          options.data.map((option) => (
            <ProviderBlock key={option.provider} productId={productId} option={option} profiles={profiles.data} />
          ))
        )}
      </CardContent>
    </Card>
  )
}

/** Кратко, что внутри реквизитов: кошельки или «ключи заданы». */
function profileSummary(profile: PaymentProfile, t: ReturnType<typeof useT>): string {
  if (profile.provider === 'CRYPTO') {
    const wallets = (profile.config as MethodConfig['CRYPTO']).wallets
    if (wallets.length === 0) return t('admin.profiles.noWallets')
    return wallets
      .map((w) => `${w.currency} · ${w.network} · ${w.address.length > 14 ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : w.address || '—'}`)
      .join('; ')
  }
  return profile.secretsSet.shopId ? t('admin.profiles.shopConnected') : t('admin.profiles.shopNotConnected')
}

function ProviderBlock({
  productId,
  option,
  profiles,
}: {
  productId: string
  option: ProductPaymentOption
  profiles: PaymentProfile[]
}) {
  const t = useT()
  const { can } = useSession()
  const { attach, update, detach } = useProductOptionMutations(productId)
  const [editor, setEditor] = useState<'new' | string | null>(null)
  const canManage = can(PERMISSIONS.PAYMENT_PROFILES_MANAGE)
  const canAssign = can(PERMISSIONS.PRODUCTS_PAYMENTS_ASSIGN)

  const attachedIds = new Set(option.options.map((o) => o.profile.id))
  const free = profiles.filter((p) => p.provider === option.provider && !attachedIds.has(p.id))
  const freeTemplates = free.filter((p) => p.kind === 'TEMPLATE')
  const freePersonal = free.filter((p) => p.kind === 'PERSONAL')
  const live = option.options.filter((o) => o.enabled && o.profile.ready)
  const busy = attach.isPending || update.isPending || detach.isPending
  const fail = (error: unknown) => toast.error(adminErrorMessage(error))

  return (
    <div className='space-y-3 rounded-lg border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='flex items-center gap-2 font-medium'>
          {t(`admin.payments.provider.${option.provider}`)}
          {!option.channelEnabled && (
            <Badge variant='outline' className='gap-1'>
              <AlertTriangle className='size-3' />
              {t('admin.productPayments.channelOff')}
            </Badge>
          )}
        </p>
        <span className='text-xs text-muted-foreground'>
          {t('admin.productPayments.liveCount', { count: live.length })}
        </span>
      </div>

      {option.options.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t('admin.productPayments.notAccepted')}</p>
      ) : (
        <ul className='divide-y rounded-md border'>
          {option.options.map(({ enabled, profile }) => (
            <li key={profile.id} className='space-y-2 p-3'>
              <div className='flex flex-wrap items-start gap-3'>
                <Checkbox
                  className='mt-1'
                  checked={enabled}
                  disabled={!canAssign || busy}
                  aria-label={t('admin.productPayments.accept')}
                  onCheckedChange={(v) => update.mutate({ profileId: profile.id, enabled: v === true }, { onError: fail })}
                />
                <div className='min-w-0 flex-1 space-y-1'>
                  <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                    {profile.name}
                    <Badge variant='outline'>
                      {profile.kind === 'TEMPLATE' ? t('admin.profiles.kind.TEMPLATE') : t('admin.profiles.kind.PERSONAL')}
                    </Badge>
                    {profile.ready ? (
                      <Badge>{t('admin.profiles.ready')}</Badge>
                    ) : (
                      <Badge variant='destructive'>{t('admin.profiles.notReady')}</Badge>
                    )}
                    {!enabled && <Badge variant='secondary'>{t('admin.productPayments.off')}</Badge>}
                  </p>
                  <p className='truncate font-mono text-xs text-muted-foreground'>{profileSummary(profile, t)}</p>
                  {!profile.ready && profile.notReadyReason && (
                    <p className='text-xs text-amber-600 dark:text-amber-400'>{profile.notReadyReason}</p>
                  )}
                </div>
                <div className='flex gap-1'>
                  {canManage && (
                    <Button size='sm' variant='ghost' onClick={() => setEditor(editor === profile.id ? null : profile.id)}>
                      <Pencil className='size-4' />
                      <span className='sr-only'>{t('common.action.edit')}</span>
                    </Button>
                  )}
                  {canAssign && (
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={busy}
                      title={t('admin.productPayments.detach')}
                      onClick={() => detach.mutate(profile.id, { onError: fail })}
                    >
                      <Unlink className='size-4' />
                      <span className='sr-only'>{t('admin.productPayments.detach')}</span>
                    </Button>
                  )}
                </div>
              </div>
              {editor === profile.id && (
                <ProfileEditor
                  profile={profile}
                  provider={option.provider}
                  onCancel={() => setEditor(null)}
                  onSaved={() => setEditor(null)}
                />
              )}
              {editor === profile.id && profile.kind === 'TEMPLATE' && profile.usedBy > 1 && (
                <p className='text-xs text-amber-600 dark:text-amber-400'>
                  {t('admin.productPayments.templateShared', { count: profile.usedBy })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        {canAssign && free.length > 0 && (
          <Select value='' disabled={busy} onValueChange={(id) => attach.mutate(id, { onError: fail })}>
            <SelectTrigger className='w-72 max-w-full'>
              <SelectValue placeholder={t('admin.productPayments.attachExisting')} />
            </SelectTrigger>
            <SelectContent>
              {freeTemplates.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t('admin.productPayments.templates')}</SelectLabel>
                  {freeTemplates.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {!p.ready && ` · ${t('admin.profiles.notReady')}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {freePersonal.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t('admin.productPayments.personal')}</SelectLabel>
                  {freePersonal.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {!p.ready && ` · ${t('admin.profiles.notReady')}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        )}
        {canManage && (
          <Button size='sm' variant='outline' onClick={() => setEditor(editor === 'new' ? null : 'new')}>
            <Plus className='size-4' />
            {t(option.provider === 'CRYPTO' ? 'admin.productPayments.addWallet' : 'admin.productPayments.createPersonal')}
          </Button>
        )}
      </div>

      {editor === 'new' && (
        <ProfileEditor
          provider={option.provider}
          productId={productId}
          onCancel={() => setEditor(null)}
          onSaved={(profile) => {
            setEditor(null)
            if (canAssign) attach.mutate(profile.id, { onError: fail })
          }}
        />
      )}

      {option.options.length > 1 && (
        <p className='text-xs text-muted-foreground'>{t('admin.productPayments.buyerChooses')}</p>
      )}

      {/* Почему покупатель не увидит способ: иначе товар «с реквизитами»
          молча остаётся некупленным, и непонятно, что чинить. */}
      {option.options.length > 0 && (live.length === 0 || !option.channelEnabled) && (
        <div className='flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm'>
          <AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400' />
          <div className='space-y-1'>
            <p className='font-medium'>{t('admin.productPayments.hiddenFromBuyers')}</p>
            <ul className='list-disc space-y-0.5 ps-4 text-muted-foreground'>
              {live.length === 0 && <li>{t('admin.productPayments.reasonNoLive')}</li>}
              {!option.channelEnabled && (
                <li>
                  {t('admin.productPayments.reasonChannelOff')}
                  {can(PERMISSIONS.PAYMENTS_MANAGE) && (
                    <>
                      {' '}
                      <Link to='/admin/payments' className='text-primary underline-offset-4 hover:underline'>
                        {t('admin.productPayments.enableChannel')}
                      </Link>
                    </>
                  )}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      <AdminErrorText error={attach.error ?? update.error ?? detach.error} />
    </div>
  )
}
