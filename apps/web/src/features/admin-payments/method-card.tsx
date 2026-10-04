import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/copy-button'
import { AdminErrorText } from '@/features/admin/error-text'
import {
  useUpdatePaymentMethod,
  type AdminPaymentMethod,
  type CryptoWallet,
  type MethodConfig,
} from './api'

/**
 * Карточка способа оплаты. Поля ключей пустые всегда: сервер их значения не
 * отдаёт. Введённое значение заменяет ключ, «Очистить» удаляет, пустое поле
 * ничего не меняет.
 */
export function PaymentMethodCard({ method }: { method: AdminPaymentMethod }) {
  const t = useT()
  const update = useUpdatePaymentMethod(method.provider)
  const [enabled, setEnabled] = useState(method.enabled)
  const [title, setTitle] = useState(method.title)
  const [description, setDescription] = useState(method.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(method.sortOrder))
  const [config, setConfig] = useState<MethodConfig[keyof MethodConfig]>(method.config)
  const [secrets, setSecrets] = useState<Record<string, string>>({})

  useEffect(() => {
    setEnabled(method.enabled)
    setTitle(method.title)
    setDescription(method.description ?? '')
    setSortOrder(String(method.sortOrder))
    setConfig(method.config)
    setSecrets({})
  }, [method])

  function save(extra: { secrets?: Record<string, string> } = {}) {
    const changedSecrets = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim() !== ''))
    update.mutate(
      {
        enabled,
        title: title.trim(),
        description: description.trim() || null,
        sortOrder: Number(sortOrder) || 0,
        config,
        secrets: { ...changedSecrets, ...extra.secrets },
      },
      { onSuccess: () => toast.success(t('admin.saved')) }
    )
  }

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <CardTitle className='flex items-center gap-2 text-base'>
            {t(`admin.payments.provider.${method.provider}`)}
            {method.enabled ? (
              <Badge>{t('admin.payments.enabled')}</Badge>
            ) : (
              <Badge variant='outline'>{t('admin.payments.disabled')}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {method.ready ? t(`admin.payments.hint.${method.provider}`) : method.notReadyReason}
          </CardDescription>
        </div>
        <label className='flex items-center gap-2 text-sm font-medium'>
          <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
          {t('admin.payments.enable')}
        </label>
      </CardHeader>

      <CardContent className='space-y-5'>
        <div className='grid gap-4 sm:grid-cols-3'>
          <div className='space-y-2 sm:col-span-2'>
            <Label>{t('admin.payments.field.title')}</Label>
            <Input value={title} maxLength={64} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label>{t('admin.products.field.sortOrder')}</Label>
            <Input type='number' value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <div className='space-y-2 sm:col-span-3'>
            <Label>{t('admin.payments.field.description')}</Label>
            <Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        {method.secretFields.length > 0 && (
          <div className='grid gap-4 sm:grid-cols-2'>
            {method.secretFields.map((field) => (
              <div key={field} className='space-y-2'>
                <Label>{t(`admin.payments.secret.${field}` as 'admin.payments.secret.apiKey')}</Label>
                <div className='flex gap-2'>
                  <Input
                    type='password'
                    autoComplete='off'
                    value={secrets[field] ?? ''}
                    placeholder={method.secretsSet[field] ? t('admin.payments.secret.set') : t('admin.payments.secret.empty')}
                    onChange={(e) => setSecrets({ ...secrets, [field]: e.target.value })}
                  />
                  {method.secretsSet[field] && (
                    <Button type='button' variant='outline' onClick={() => save({ secrets: { [field]: '' } })}>
                      {t('admin.payments.secret.clear')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {method.provider === 'DIGISELLER' && (
          <DigisellerFields config={config as MethodConfig['DIGISELLER']} onChange={setConfig} />
        )}
        {/* Реквизиты ЮKassa и крипты — в шаблонах и у товаров; здесь только канал. */}
        {method.provider === 'YOOKASSA' && method.webhookUrl && (
          <div className='space-y-1 rounded-md bg-muted/50 p-3 text-sm'>
            <p className='font-medium'>{t('admin.payments.yookassa.webhook')}</p>
            <p className='flex items-center gap-1 font-mono text-xs break-all'>
              {method.webhookUrl}
              <CopyButton value={method.webhookUrl} label={t('admin.payments.yookassa.webhook')} />
            </p>
            <p className='text-xs text-muted-foreground'>{t('admin.payments.yookassa.webhookHint')}</p>
          </div>
        )}

        <AdminErrorText error={update.error} />
        <Button onClick={() => save()} disabled={update.isPending || !title.trim()}>
          {t('common.action.save')}
        </Button>
      </CardContent>
    </Card>
  )
}

function DigisellerFields({
  config,
  onChange,
}: {
  config: MethodConfig['DIGISELLER']
  onChange: (c: MethodConfig['DIGISELLER']) => void
}) {
  const t = useT()
  return (
    <div className='grid gap-4 sm:grid-cols-2'>
      <div className='space-y-2'>
        <Label>{t('admin.payments.digiseller.minRatio')}</Label>
        <Input
          type='number'
          step='0.05'
          min={0}
          max={1}
          value={config.minAmountRatio}
          onChange={(e) => onChange({ ...config, minAmountRatio: Number(e.target.value) })}
        />
        <p className='text-xs text-muted-foreground'>{t('admin.payments.digiseller.minRatioHint')}</p>
      </div>
      <div className='space-y-2'>
        <Label>{t('admin.payments.digiseller.pollWindow')}</Label>
        <Input
          type='number'
          min={120}
          max={2160}
          value={config.pollWindowHours}
          onChange={(e) => onChange({ ...config, pollWindowHours: Number(e.target.value) })}
        />
      </div>
    </div>
  )
}

export function YookassaFields({
  config,
  webhookUrl,
  onChange,
}: {
  config: MethodConfig['YOOKASSA']
  webhookUrl: string | null
  onChange: (c: MethodConfig['YOOKASSA']) => void
}) {
  const t = useT()
  return (
    <div className='space-y-4'>
      {webhookUrl && (
        <div className='space-y-1 rounded-md bg-muted/50 p-3 text-sm'>
          <p className='font-medium'>{t('admin.payments.yookassa.webhook')}</p>
          <p className='flex items-center gap-1 font-mono text-xs break-all'>
            {webhookUrl}
            <CopyButton value={webhookUrl} label={t('admin.payments.yookassa.webhook')} />
          </p>
          <p className='text-xs text-muted-foreground'>{t('admin.payments.yookassa.webhookHint')}</p>
        </div>
      )}
      <div className='grid gap-4 sm:grid-cols-2'>
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={config.sendReceipt}
            onCheckedChange={(v) => onChange({ ...config, sendReceipt: v === true })}
          />
          {t('admin.payments.yookassa.receipt')}
        </label>
        <div className='space-y-2'>
          <Label>{t('admin.payments.yookassa.vatCode')}</Label>
          <Input
            type='number'
            min={1}
            max={12}
            disabled={!config.sendReceipt}
            value={config.vatCode}
            onChange={(e) => onChange({ ...config, vatCode: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  )
}

/** Пустая строка кошелька: USDT в сети TRC20 — самый частый случай. */
export function newWallet(): CryptoWallet {
  return {
    id: `wallet-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    currency: 'USDT',
    network: 'TRC20',
    address: '',
    rate: 100,
    decimals: 2,
  }
}

export function CryptoFields({
  config,
  onChange,
}: {
  config: MethodConfig['CRYPTO']
  onChange: (c: MethodConfig['CRYPTO']) => void
}) {
  const t = useT()

  function setWallet(index: number, patch: Partial<CryptoWallet>) {
    const wallets = config.wallets.map((w, i) => (i === index ? { ...w, ...patch } : w))
    onChange({ ...config, wallets })
  }

  function addWallet() {
    onChange({ ...config, wallets: [...config.wallets, newWallet()] })
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-3'>
        <div className='flex items-center justify-between'>
          <Label>{t('admin.payments.crypto.wallets')}</Label>
          <Button type='button' size='sm' variant='outline' onClick={addWallet}>
            <Plus className='size-4' />
            {t('admin.payments.crypto.addWallet')}
          </Button>
        </div>
        {config.wallets.length === 0 && (
          <p className='text-sm text-muted-foreground'>{t('admin.payments.crypto.noWallets')}</p>
        )}
        {config.wallets.map((wallet, index) => (
          <div key={wallet.id} className='grid gap-2 rounded-md border p-3 sm:grid-cols-6'>
            <div className='space-y-1'>
              <span className='text-xs text-muted-foreground'>{t('admin.payments.crypto.currency')}</span>
              <Input value={wallet.currency} onChange={(e) => setWallet(index, { currency: e.target.value.toUpperCase() })} />
            </div>
            <div className='space-y-1'>
              <span className='text-xs text-muted-foreground'>{t('admin.payments.crypto.network')}</span>
              <Input value={wallet.network} onChange={(e) => setWallet(index, { network: e.target.value })} />
            </div>
            <div className='space-y-1 sm:col-span-4'>
              <span className='text-xs text-muted-foreground'>{t('admin.payments.crypto.address')}</span>
              <Input
                className='font-mono text-xs'
                value={wallet.address}
                placeholder={t('admin.payments.crypto.addressPlaceholder')}
                aria-invalid={wallet.address.trim().length < 10 || undefined}
                onChange={(e) => setWallet(index, { address: e.target.value.trim() })}
              />
            </div>
            <div className='space-y-1'>
              <span className='text-xs text-muted-foreground'>{t('admin.payments.crypto.rate')}</span>
              <Input type='number' step='any' min={0} value={wallet.rate} onChange={(e) => setWallet(index, { rate: Number(e.target.value) })} />
            </div>
            <div className='space-y-1'>
              <span className='text-xs text-muted-foreground'>{t('admin.payments.crypto.decimals')}</span>
              <Input type='number' min={0} max={8} value={wallet.decimals} onChange={(e) => setWallet(index, { decimals: Number(e.target.value) })} />
            </div>
            <div className='space-y-1 sm:col-span-3'>
              <span className='text-xs text-muted-foreground'>{t('admin.payments.crypto.explorer')}</span>
              <Input
                className='font-mono text-xs'
                value={wallet.explorerTxUrl ?? ''}
                placeholder='https://tronscan.org/#/transaction/{tx}'
                onChange={(e) => setWallet(index, { explorerTxUrl: e.target.value.trim() || undefined })}
              />
            </div>
            <div className='flex items-end justify-end'>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => onChange({ ...config, wallets: config.wallets.filter((_, i) => i !== index) })}
              >
                <Trash2 className='size-4' />
                <span className='sr-only'>{t('admin.payments.crypto.removeWallet')}</span>
              </Button>
            </div>
          </div>
        ))}
        <p className='text-xs text-muted-foreground'>{t('admin.payments.crypto.rateHint')}</p>
      </div>
      <div className='grid gap-4 sm:grid-cols-3'>
        <div className='space-y-2 sm:col-span-2'>
          <Label>{t('admin.payments.crypto.instructions')}</Label>
          <Textarea
            rows={3}
            maxLength={1000}
            value={config.instructions ?? ''}
            onChange={(e) => onChange({ ...config, instructions: e.target.value || undefined })}
          />
        </div>
        <div className='space-y-2'>
          <Label>{t('admin.payments.crypto.expireHours')}</Label>
          <Input
            type='number'
            min={1}
            max={168}
            value={config.expireHours}
            onChange={(e) => onChange({ ...config, expireHours: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  )
}
