import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useT } from '@/lib/i18n'
import { AdminPageHeader } from '@/features/admin/page-header'
import { LogExplorer } from '@/features/admin-security/log-explorer'

/** Журнал событий. q/from/to — переход со сработки или виджета дашборда. */
export const Route = createFileRoute('/_app/admin/security/events')({
  validateSearch: z.object({ q: z.string().optional(), from: z.string().optional(), to: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (!hasAny(context.me.permissions, [PERMISSIONS.AUDIT_READ])) throw redirect({ to: '/403' })
  },
  component: EventsPage,
})

function EventsPage() {
  const t = useT()
  const search = Route.useSearch()
  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('sec.page.events')} description={t('sec.page.events.hint')} />
      <LogExplorer key={JSON.stringify(search)} kind='audit' initial={search} />
    </div>
  )
}
