import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { has, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { adminSettingsQueryOptions, useUpdateSetting, type AdminSetting } from '@/features/admin-settings/api'

export const Route = createFileRoute('/_app/admin/settings')({
  beforeLoad: ({ context }) => {
    const p = context.me.permissions
    if (!has(p, PERMISSIONS.SETTINGS_READ) && !has(p, PERMISSIONS.SETTINGS_MANAGE)) throw redirect({ to: '/403' })
  },
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const t = useT()
  const { can } = useSession()
  const query = useQuery(adminSettingsQueryOptions())

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  const groups = new Map<string, AdminSetting[]>()
  for (const setting of query.data ?? []) {
    groups.set(setting.category, [...(groups.get(setting.category) ?? []), setting])
  }

  return (
    <div className='mx-auto w-full max-w-5xl space-y-6'>
      <AdminPageHeader title={t('admin.settings.title')} description={t('admin.settings.description')} />
      {query.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : (
        [...groups.entries()].map(([category, settings]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className='text-base capitalize'>{category}</CardTitle>
            </CardHeader>
            <CardContent className='divide-y'>
              {settings.map((setting) => (
                <SettingRow key={setting.key} setting={setting} editable={can(PERMISSIONS.SETTINGS_MANAGE)} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function SettingRow({ setting, editable }: { setting: AdminSetting; editable: boolean }) {
  const t = useT()
  const update = useUpdateSetting()
  const kind = setting.isSecret ? 'secret' : typeof setting.value
  const [draft, setDraft] = useState(kind === 'secret' ? '' : String(setting.value ?? ''))

  function save(value: unknown) {
    update.mutate({ key: setting.key, value }, { onSuccess: () => toast.success(t('admin.saved')) })
  }

  return (
    <div className='flex flex-wrap items-center justify-between gap-3 py-3'>
      <div className='min-w-0 flex-1'>
        <p className='font-mono text-xs'>{setting.key}</p>
        {setting.description && <p className='text-sm text-muted-foreground'>{setting.description}</p>}
        <AdminErrorText error={update.error} />
      </div>
      {kind === 'boolean' ? (
        <Checkbox
          checked={setting.value === true}
          disabled={!editable || update.isPending}
          onCheckedChange={(v) => save(v === true)}
        />
      ) : (
        <form
          className='flex gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            save(kind === 'number' ? Number(draft) : draft)
          }}
        >
          <Input
            className='w-56'
            type={kind === 'number' ? 'number' : kind === 'secret' ? 'password' : 'text'}
            step='any'
            value={draft}
            disabled={!editable}
            placeholder={kind === 'secret' ? (setting.isSet ? t('admin.payments.secret.set') : t('admin.payments.secret.empty')) : undefined}
            onChange={(e) => setDraft(e.target.value)}
          />
          {editable && (
            <Button type='submit' variant='outline' disabled={update.isPending || (kind === 'number' && !Number.isFinite(Number(draft)))}>
              {t('common.action.save')}
            </Button>
          )}
        </form>
      )}
    </div>
  )
}
