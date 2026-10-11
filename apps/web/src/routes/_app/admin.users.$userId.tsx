import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { has, PERMISSIONS } from '@/lib/auth/permissions'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText } from '@/features/admin/error-text'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { adminUserQueryOptions } from '@/features/admin-users/api'
import { UserStatusBadge } from '@/features/admin-users/status-badge'
import { UserDetails } from '@/features/admin-users/user-details'

/**
 * Карточка пользователя отдельной страницей — для прямых ссылок. Из списка
 * пользователей она же открывается панелью справа.
 */
export const Route = createFileRoute('/_app/admin/users/$userId')({
  beforeLoad: ({ context }) => {
    if (!has(context.me.permissions, PERMISSIONS.USERS_READ_ANY)) throw redirect({ to: '/403' })
  },
  component: AdminUserPage,
})

function AdminUserPage() {
  const { userId } = Route.useParams()
  const t = useT()
  const query = useQuery(adminUserQueryOptions(userId))

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='mx-auto w-full max-w-5xl space-y-6'>
      <Button asChild variant='ghost' size='sm' className='-ml-2'>
        <Link to='/admin/users'>
          <ArrowLeft className='size-4' />
          {t('admin.users.back')}
        </Link>
      </Button>

      {query.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : (
        <>
          <header className='flex flex-wrap items-center gap-3'>
            <h1 className='text-xl font-semibold'>{query.data.username}</h1>
            <UserStatusBadge status={query.data.status} />
          </header>
          <UserDetails user={query.data} />
        </>
      )}
    </div>
  )
}
