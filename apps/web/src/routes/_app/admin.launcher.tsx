import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { AdminLauncherPage } from '@/features/launcher/admin-launcher'

/** Релизы загрузчика: версии, файлы, кому доступны, описание страницы. open — id или «new». */
export const Route = createFileRoute('/_app/admin/launcher')({
  validateSearch: z.object({ open: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (!hasAny(context.me.permissions, [PERMISSIONS.LAUNCHER_MANAGE])) throw redirect({ to: '/403' })
  },
  component: LauncherRoute,
})

function LauncherRoute() {
  const { open } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <AdminLauncherPage openId={open ?? null} onOpen={(id) => void navigate({ search: { open: id ?? undefined }, replace: true })} />
}
