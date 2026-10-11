import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { adminPaymentMethodsQueryOptions } from '@/features/admin-payments/api'
import { PaymentMethodCard } from '@/features/admin-payments/method-card'
import { ProfilesRegistry } from '@/features/admin-payments/profiles-registry'

const SECTIONS = ['PRODUCTS', 'RESELLERS', 'CHANNELS'] as const
type Section = (typeof SECTIONS)[number]

/**
 * Способы оплаты тремя разделами: реквизиты для товаров (платят покупатели),
 * реквизиты для реселлеров (пополнение баланса) и глобальные каналы
 * (вкл/выкл, названия, ключи Digiseller). Реквизиты переносятся между
 * первыми двумя разделами из их панели.
 */
export const Route = createFileRoute('/_app/admin/payments')({
  validateSearch: z.object({ scope: z.enum(SECTIONS).optional() }),
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
  const { scope } = Route.useSearch()
  const navigate = Route.useNavigate()
  const canChannels = can(PERMISSIONS.PAYMENTS_MANAGE)
  const query = useQuery({ ...adminPaymentMethodsQueryOptions(), enabled: canChannels })
  const visible = SECTIONS.filter((s) => s !== 'CHANNELS' || canChannels)
  const current: Section = scope && visible.includes(scope) ? scope : 'PRODUCTS'

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='mx-auto w-full max-w-6xl space-y-6'>
      <AdminPageHeader title={t('admin.payments.title')} description={t('admin.payments.description')} />

      <Tabs value={current} onValueChange={(v) => void navigate({ search: { scope: v as Section } })}>
        <TabsList>
          {visible.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`admin.payments.section.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value='PRODUCTS' className='mt-4'>
          <ProfilesRegistry scope='PRODUCTS' />
        </TabsContent>
        <TabsContent value='RESELLERS' className='mt-4'>
          <ProfilesRegistry scope='RESELLERS' />
        </TabsContent>
        {canChannels && (
          <TabsContent value='CHANNELS' className='mt-4 space-y-4'>
            <p className='text-sm text-muted-foreground'>{t('admin.payments.channels.description')}</p>
            {query.isPending ? (
              <Skeleton className='h-64 w-full' />
            ) : query.isError ? (
              <AdminErrorText error={query.error} />
            ) : (
              query.data.map((method) => <PaymentMethodCard key={method.provider} method={method} />)
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
