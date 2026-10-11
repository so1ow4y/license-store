import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { DashboardsPage } from '@/features/admin-security/dashboards'

/** Старые адреса вкладок (?tab=events) ведут на свои страницы. */
const LEGACY_TABS = { events: '/admin/security/events', logins: '/admin/security/logins', blocks: '/admin/security/blocks' } as const

export const Route = createFileRoute('/_app/admin/security/')({
  validateSearch: z.object({ tab: z.enum(['events', 'logins', 'blocks']).optional(), d: z.string().optional() }),
  beforeLoad: ({ context, search }) => {
    if (search.tab) throw redirect({ to: LEGACY_TABS[search.tab], replace: true })
    // Дашборды строятся на журналах: без них — сразу в доступный раздел.
    if (!hasAny(context.me.permissions, [PERMISSIONS.AUDIT_READ, PERMISSIONS.LOGINS_READ])) {
      throw redirect({
        to: hasAny(context.me.permissions, [PERMISSIONS.SECURITY_IP_BLOCK]) ? '/admin/security/blocks' : '/admin/security/traffic',
        replace: true,
      })
    }
  },
  component: DashboardsRoute,
})

function DashboardsRoute() {
  const { d } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <DashboardsPage selectedId={d} onSelect={(id) => void navigate({ search: { d: id }, replace: true })} />
}
