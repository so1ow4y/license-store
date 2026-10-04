import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminErrorText } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import {
  DEFAULT_PROFILE_CONFIG,
  PROFILE_SECRET_FIELDS,
  useSaveProfile,
  type MethodConfig,
  type PaymentProfile,
  type ProfileProvider,
} from './api'
import { CryptoFields, YookassaFields, newWallet } from './method-card'

/** Новые крипто-реквизиты сразу со строкой кошелька: поле адреса видно без лишнего клика. */
function initialConfig(provider: ProfileProvider): MethodConfig[ProfileProvider] {
  if (provider === 'CRYPTO') {
    return { ...DEFAULT_PROFILE_CONFIG.CRYPTO, wallets: [newWallet()] }
  }
  return DEFAULT_PROFILE_CONFIG[provider]
}

/**
 * Форма реквизитов: название, ключи магазина (ЮKassa) или кошельки (крипта).
 * Без `profile` создаёт новые — шаблон или, с `productId`, личные реквизиты товара.
 * Поля ключей всегда пустые: введённое значение заменяет ключ, пустое не трогает.
 */
export function ProfileEditor({
  profile,
  provider,
  productId,
  onSaved,
  onCancel,
}: {
  profile?: PaymentProfile
  provider: ProfileProvider
  productId?: string
  onSaved?: (profile: PaymentProfile) => void
  onCancel?: () => void
}) {
  const t = useT()
  const save = useSaveProfile(profile?.id)
  const [name, setName] = useState(profile?.name ?? '')
  const [config, setConfig] = useState<MethodConfig[ProfileProvider]>(() => profile?.config ?? initialConfig(provider))
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const fields = profile?.secretFields ?? PROFILE_SECRET_FIELDS[provider]
  const wallets = provider === 'CRYPTO' ? (config as MethodConfig['CRYPTO']).wallets : []
  // Сервер требует адрес от 10 символов: незаполненная строка кошелька дала бы
  // невнятную ошибку проверки — останавливаем раньше и говорим, что не так.
  const walletsValid = wallets.every((w) => w.address.trim().length >= 10 && w.rate > 0)

  function submit(extraSecrets: Record<string, string> = {}) {
    const changed = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim() !== ''))
    save.mutate(
      {
        ...(profile ? {} : { provider, productId: productId ?? null }),
        name: name.trim(),
        config,
        secrets: { ...changed, ...extraSecrets },
      },
      {
        onSuccess: (saved) => {
          setSecrets({})
          toast.success(t('admin.saved'))
          onSaved?.(saved)
        },
      }
    )
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    submit()
  }

  return (
    <form onSubmit={onSubmit} className='space-y-4 rounded-lg border bg-muted/20 p-4'>
      <div className='space-y-2'>
        <Label>
          {t('admin.profiles.field.name')} <span className='text-destructive'>*</span>
        </Label>
        <Input
          value={name}
          maxLength={128}
          aria-invalid={!name.trim() || undefined}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('admin.profiles.field.namePlaceholder')}
        />
      </div>

      {fields.length > 0 && (
        <div className='grid gap-4 sm:grid-cols-2'>
          {fields.map((field) => (
            <div key={field} className='space-y-2'>
              <Label>{t(`admin.payments.secret.${field}` as 'admin.payments.secret.apiKey')}</Label>
              <div className='flex gap-2'>
                <Input
                  type='password'
                  autoComplete='off'
                  value={secrets[field] ?? ''}
                  placeholder={profile?.secretsSet[field] ? t('admin.payments.secret.set') : t('admin.payments.secret.empty')}
                  onChange={(e) => setSecrets({ ...secrets, [field]: e.target.value })}
                />
                {profile?.secretsSet[field] && (
                  <Button type='button' variant='outline' onClick={() => submit({ [field]: '' })}>
                    {t('admin.payments.secret.clear')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {provider === 'YOOKASSA' ? (
        <YookassaFields config={config as MethodConfig['YOOKASSA']} webhookUrl={null} onChange={setConfig} />
      ) : (
        <CryptoFields config={config as MethodConfig['CRYPTO']} onChange={setConfig} />
      )}

      {provider === 'CRYPTO' && wallets.length === 0 && (
        <p className='text-sm text-amber-600 dark:text-amber-400'>{t('admin.payments.crypto.noWalletsWarning')}</p>
      )}
      <FormProblems
        problems={[
          !name.trim() && t('admin.profiles.problem.name'),
          !walletsValid && t('admin.payments.crypto.addressRequired'),
        ]}
      />
      <AdminErrorText error={save.error} />
      <div className='flex gap-2'>
        <Button type='submit' disabled={!name.trim() || !walletsValid || save.isPending}>
          {profile ? t('common.action.save') : t('common.action.create')}
        </Button>
        {onCancel && (
          <Button type='button' variant='ghost' onClick={onCancel}>
            {t('common.action.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}
