import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { RulesPage } from '@/features/admin-security/rules-page'

/** Правила корреляции. open — id правила или «new» для нового. */
export const Route = createFileRoute('/_app/admin/security/rules')({
  validateSearch: z.object({ open: z.string().optional() }),
  beforeLoad: ({ context }) => {
    const allowed = hasAny(context.me.permissions, [PERMISSIONS.AUDIT_READ, PERMISSIONS.LOGINS_READ, PERMISSIONS.SECURITY_RULES_MANAGE])
    if (!allowed) throw redirect({ to: '/403' })
  },
  component: RulesRoute,
})

function RulesRoute() {
  const { open } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <RulesPage openId={open ?? null} onOpen={(id) => void navigate({ search: { open: id ?? undefined }, replace: true })} />
}
