import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { has, PERMISSIONS } from '@/lib/auth/permissions'
import { useT } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { myAccessQueryOptions } from '@/features/profile/api'

/** Своя роль и права. Раздел есть с уровня поддержки (право roles.read). */
export const Route = createFileRoute('/_app/settings/access')({
  beforeLoad: ({ context }) => {
    if (!has(context.me.permissions, PERMISSIONS.ROLES_READ)) throw redirect({ to: '/settings/profile' })
  },
  component: AccessPage,
})

function AccessPage() {
  const t = useT()
  const query = useQuery(myAccessQueryOptions())

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />
  if (query.isPending) return <Skeleton className='h-64 w-full max-w-3xl' />
  if (query.isError) return <ApiErrorText error={query.error} />

  const groups = new Map<string, typeof query.data.permissions>()
  for (const permission of query.data.permissions) {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission])
  }

  return (
    <div className='max-w-3xl space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('access.roles.title')}</CardTitle>
          <CardDescription>{t('access.roles.description')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {query.data.roles.map((role) => (
            <div key={role.slug} className='flex items-start gap-3 rounded-lg border p-3'>
              <ShieldCheck className='mt-0.5 size-5 shrink-0 text-primary' aria-hidden />
              <div className='space-y-1'>
                <p className='flex flex-wrap items-center gap-2 font-medium'>
                  {role.name}
                  <Badge variant='outline' className='font-mono text-[11px]'>
                    {role.slug}
                  </Badge>
                </p>
                {role.description && <p className='text-sm text-muted-foreground'>{role.description}</p>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('access.permissions.title')}</CardTitle>
          <CardDescription>{t('access.permissions.count', { count: query.data.permissions.length })}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-5'>
          {[...groups.entries()].map(([group, permissions]) => (
            <div key={group} className='space-y-2'>
              <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{group}</p>
              <ul className='grid gap-1.5 sm:grid-cols-2'>
                {permissions.map((permission) => (
                  <li key={permission.slug} className='rounded-md bg-muted/50 px-3 py-2 text-sm'>
                    <span className='block'>{permission.description ?? permission.slug}</span>
                    <span className='font-mono text-[11px] text-muted-foreground'>{permission.slug}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
