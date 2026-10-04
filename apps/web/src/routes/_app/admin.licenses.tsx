import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { has } from '@/lib/auth/permissions'
import { useT } from '@/lib/i18n'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { AdminLicensesTable } from '@/features/admin-licenses/licenses-table'

/**
 * Все лицензии: поиск «поле:значение» с операторами, фильтры статуса и даты,
 * массовая блокировка, закрепление сборки.
 *
 * Гейт по `licenses.read.any`: право `licenses.read.own` тот же маршрут
 * пропускает, но сервер вернёт только собственные лицензии — это
 * пользовательский экран, а не административный.
 */
export const Route = createFileRoute('/_app/admin/licenses')({
  validateSearch: z.object({ q: z.string().max(1000).optional() }),
  beforeLoad: ({ context }) => {
    if (!has(context.me.permissions, PERMISSIONS.LICENSES_READ_ANY)) {
      throw redirect({ to: '/403' })
    }
  },
  component: AdminLicensesPage,
})

function AdminLicensesPage() {
  const t = useT()
  const { q } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className='space-y-6'>
      <header className='space-y-1'>
        <h1 className='text-xl font-semibold'>{t('admin.licenses.title')}</h1>
        <p className='max-w-3xl text-sm text-muted-foreground'>
          {t('admin.licenses.description')}
        </p>
      </header>

      <AdminLicensesTable q={q ?? ''} onQueryChange={(next) => void navigate({ search: { q: next || undefined } })} />
    </div>
  )
}
