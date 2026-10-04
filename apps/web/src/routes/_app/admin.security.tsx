import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminPageHeader } from '@/features/admin/page-header'
import { BlocksPanel } from '@/features/admin-security/blocks-panel'
import { LogExplorer } from '@/features/admin-security/log-explorer'

const TABS = ['events', 'logins', 'blocks'] as const

/** Безопасность: мини-SIEM по журналам событий и входов, блокировки. */
export const Route = createFileRoute('/_app/admin/security')({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  beforeLoad: ({ context }) => {
    const allowed = hasAny(context.me.permissions, [
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.LOGINS_READ,
      PERMISSIONS.SECURITY_IP_BLOCK,
    ])
    if (!allowed) throw redirect({ to: '/403' })
  },
  component: SecurityPage,
})

function SecurityPage() {
  const t = useT()
  const { can } = useSession()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  const visible = TABS.filter((name) =>
    name === 'events'
      ? can(PERMISSIONS.AUDIT_READ)
      : name === 'logins'
        ? can(PERMISSIONS.LOGINS_READ)
        : can(PERMISSIONS.SECURITY_IP_BLOCK) || can(PERMISSIONS.USERS_BLOCK)
  )
  const current = tab && visible.includes(tab) ? tab : visible[0]

  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('security.title')} description={t('security.description')} />
      <Tabs value={current} onValueChange={(value) => void navigate({ search: { tab: value as (typeof TABS)[number] } })}>
        <TabsList>
          {visible.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`security.tab.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {visible.includes('events') && (
          <TabsContent value='events' className='mt-4'>
            <LogExplorer kind='audit' />
          </TabsContent>
        )}
        {visible.includes('logins') && (
          <TabsContent value='logins' className='mt-4'>
            <LogExplorer kind='logins' />
          </TabsContent>
        )}
        {visible.includes('blocks') && (
          <TabsContent value='blocks' className='mt-4'>
            <BlocksPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
