import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useT } from '@/lib/i18n'
import { AdminPageHeader } from '@/features/admin/page-header'
import { LogExplorer } from '@/features/admin-security/log-explorer'

/** Журнал входов. q/from/to — переход со сработки или виджета дашборда. */
export const Route = createFileRoute('/_app/admin/security/logins')({
  validateSearch: z.object({ q: z.string().optional(), from: z.string().optional(), to: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (!hasAny(context.me.permissions, [PERMISSIONS.LOGINS_READ])) throw redirect({ to: '/403' })
  },
  component: LoginsPage,
})

function LoginsPage() {
  const t = useT()
  const search = Route.useSearch()
  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('sec.page.logins')} description={t('sec.page.logins.hint')} />
      <LogExplorer key={JSON.stringify(search)} kind='logins' initial={search} />
    </div>
  )
}
