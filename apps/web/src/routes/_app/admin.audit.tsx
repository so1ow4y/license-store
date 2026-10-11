import { createFileRoute, redirect } from '@tanstack/react-router'

/** Прежний адрес журнала: теперь это вкладка раздела «Безопасность». */
export const Route = createFileRoute('/_app/admin/audit')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/security/events', replace: true })
  },
})
