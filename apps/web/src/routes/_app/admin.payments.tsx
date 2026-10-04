import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { adminPaymentMethodsQueryOptions } from '@/features/admin-payments/api'
import { PaymentMethodCard } from '@/features/admin-payments/method-card'
import { ProfilesRegistry } from '@/features/admin-payments/profiles-registry'

/**
 * Способы оплаты: реестр всех реквизитов (шаблоны и личные реквизиты
 * товаров) и глобальные каналы (вкл/выкл, названия, ключи Digiseller).
 */
export const Route = createFileRoute('/_app/admin/payments')({
  beforeLoad: ({ context }) => {
    if (
      !hasAny(context.me.permissions, [
        PERMISSIONS.PAYMENTS_MANAGE,
        PERMISSIONS.PAYMENT_PROFILES_MANAGE,
        PERMISSIONS.PRODUCTS_PAYMENTS_ASSIGN,
      ])
    ) {
      throw redirect({ to: '/403' })
    }
  },
  component: AdminPaymentsPage,
})

function AdminPaymentsPage() {
  const t = useT()
  const { can } = useSession()
  const canChannels = can(PERMISSIONS.PAYMENTS_MANAGE)
  const query = useQuery({ ...adminPaymentMethodsQueryOptions(), enabled: canChannels })

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='mx-auto w-full max-w-6xl space-y-6'>
      <AdminPageHeader title={t('admin.payments.title')} description={t('admin.payments.description')} />

      <ProfilesRegistry />

      {canChannels && (
        <section className='space-y-4'>
          <div className='space-y-1'>
            <h2 className='text-lg font-semibold'>{t('admin.payments.channels.title')}</h2>
            <p className='text-sm text-muted-foreground'>{t('admin.payments.channels.description')}</p>
          </div>
          {query.isPending ? (
            <Skeleton className='h-64 w-full' />
          ) : query.isError ? (
            <AdminErrorText error={query.error} />
          ) : (
            query.data.map((method) => <PaymentMethodCard key={method.provider} method={method} />)
          )}
        </section>
      )}
    </div>
  )
}
