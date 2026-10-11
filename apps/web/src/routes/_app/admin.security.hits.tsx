import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { HitsPage } from '@/features/admin-security/hits-page'

/** Сработки правил корреляции. open — открыть сработку в панели, rule — фильтр по правилу. */
export const Route = createFileRoute('/_app/admin/security/hits')({
  validateSearch: z.object({ open: z.string().optional(), rule: z.string().optional() }),
  beforeLoad: ({ context }) => {
    const allowed = hasAny(context.me.permissions, [PERMISSIONS.AUDIT_READ, PERMISSIONS.LOGINS_READ, PERMISSIONS.SECURITY_RULES_MANAGE])
    if (!allowed) throw redirect({ to: '/403' })
  },
  component: HitsRoute,
})

function HitsRoute() {
  const { open, rule } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <HitsPage
      openId={open ?? null}
      ruleId={rule}
      onOpen={(id) => void navigate({ search: (prev) => ({ ...prev, open: id ?? undefined }), replace: true })}
      onRule={(id) => void navigate({ search: (prev) => ({ ...prev, rule: id }), replace: true })}
    />
  )
}
