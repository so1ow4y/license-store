import { createFileRoute, redirect } from '@tanstack/react-router'
import { has } from '@/lib/auth/permissions'
import { useT } from '@/lib/i18n'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { PendingDealsTable } from '@/features/admin-billing/pending-table'

/**
 * Зависшие сделки Digiseller (план, п. 3.19).
 *
 * Прямое продолжение экрана активации кода покупки: покупателю, чей товар не
 * привязан к тарифу, сказали «оплата принята, лицензия будет выдана в
 * ближайшее время». Выдать её обязан человек, и это единственное место, где
 * такие сделки вообще видны.
 *
 * Гейт в `beforeLoad`, а не в компоненте: иначе экран успеет отрисоваться,
 * сходить за данными и получить 403 — пользователь увидит мигание раздела,
 * которого ему не положено.
 */
export const Route = createFileRoute('/_app/admin/billing/pending')({
  beforeLoad: ({ context }) => {
    // Права берём из `/auth/me`, уже загруженного защищённым layout.
    // Роли в ответе нет — гейтить можно только правом.
    if (!has(context.me.permissions, PERMISSIONS.LICENSES_CREATE_ANY)) {
      throw redirect({ to: '/403' })
    }
  },
  component: PendingDealsPage,
})

function PendingDealsPage() {
  const t = useT()

  return (
    <div className='space-y-6'>
      <header className='space-y-1'>
        <h1 className='text-xl font-semibold'>{t('admin.pending.title')}</h1>
        <p className='max-w-3xl text-sm text-muted-foreground'>
          {t('admin.pending.description')}
        </p>
      </header>

      <PendingDealsTable />
    </div>
  )
}
