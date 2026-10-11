import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { TrafficPage } from '@/features/admin-security/traffic-page'

/** Приоритет трафика: нагрузка, очередь, режим атаки, доверенные адреса и пользователи, веса ролей. */
export const Route = createFileRoute('/_app/admin/security/traffic')({
  beforeLoad: ({ context }) => {
    const allowed = hasAny(context.me.permissions, [PERMISSIONS.SECURITY_TRAFFIC_MANAGE, PERMISSIONS.SECURITY_IP_BLOCK])
    if (!allowed) throw redirect({ to: '/403' })
  },
  component: TrafficPage,
})
