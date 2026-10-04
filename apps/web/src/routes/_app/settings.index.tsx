import { createFileRoute, redirect } from '@tanstack/react-router'

/** /settings открывает первый раздел — профиль. */
export const Route = createFileRoute('/_app/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile', replace: true })
  },
})
