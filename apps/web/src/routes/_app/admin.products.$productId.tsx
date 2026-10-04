import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText } from '@/features/admin/error-text'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { adminProductQueryOptions } from '@/features/admin-products/api'
import { BuildsSection } from '@/features/admin-products/builds-section'
import { PaymentSection } from '@/features/admin-products/payment-section'
import { PlansSection } from '@/features/admin-products/plans-section'
import { ProductForm } from '@/features/admin-products/product-form'
import { ProductStatusBadge } from '@/features/admin-products/status-badge'

export const Route = createFileRoute('/_app/admin/products/$productId')({
  beforeLoad: ({ context }) => {
    // Поддержка заходит сюда только привязать к товару шаблон оплаты.
    if (!hasAny(context.me.permissions, [PERMISSIONS.PRODUCTS_MANAGE, PERMISSIONS.PRODUCTS_PAYMENTS_ASSIGN])) {
      throw redirect({ to: '/403' })
    }
  },
  component: AdminProductPage,
})

function AdminProductPage() {
  const { productId } = Route.useParams()
  const t = useT()
  const { can } = useSession()
  const query = useQuery(adminProductQueryOptions(productId))

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='mx-auto w-full max-w-6xl space-y-6'>
      <Button asChild variant='ghost' size='sm' className='-ml-2'>
        <Link to='/admin/products'>
          <ArrowLeft className='size-4' />
          {t('admin.products.back')}
        </Link>
      </Button>

      {query.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : (
        <>
          <header className='flex flex-wrap items-center gap-3'>
            <h1 className='text-xl font-semibold'>{query.data.name}</h1>
            <ProductStatusBadge status={query.data.status} />
          </header>
          {can(PERMISSIONS.PRODUCTS_MANAGE) && <ProductForm product={query.data} />}
          {(can(PERMISSIONS.PRODUCTS_PAYMENTS_ASSIGN) || can(PERMISSIONS.PAYMENT_PROFILES_MANAGE)) && (
            <PaymentSection productId={query.data.id} />
          )}
          {can(PERMISSIONS.PLANS_MANAGE) && <PlansSection product={query.data} />}
          {can(PERMISSIONS.VERSIONS_MANAGE) && <BuildsSection productId={query.data.id} />}
        </>
      )}
    </div>
  )
}
