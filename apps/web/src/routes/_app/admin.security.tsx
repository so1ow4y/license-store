import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'

/**
 * Центр безопасности: дашборды, журналы событий и входов, сработки правил
 * корреляции, сами правила, блокировки по уровням и приоритет трафика.
 * Разделы — подпункты ветки «Безопасность» в доке; здесь только общий гейт.
 */
const SECURITY_ANY = [
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.LOGINS_READ,
  PERMISSIONS.SECURITY_IP_BLOCK,
  PERMISSIONS.SECURITY_RULES_MANAGE,
  PERMISSIONS.SECURITY_TRAFFIC_MANAGE,
]

export const Route = createFileRoute('/_app/admin/security')({
  beforeLoad: ({ context }) => {
    if (!hasAny(context.me.permissions, SECURITY_ANY)) throw redirect({ to: '/403' })
  },
  component: Outlet,
})
