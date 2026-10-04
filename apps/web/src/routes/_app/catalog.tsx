import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Ticket, ShoppingCart } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiErrorText } from '@/components/api-error-text'
import { useT, type TFunction } from '@/lib/i18n'
import {
  catalogQueryOptions,
  formatDuration,
  formatPrice,
  type CatalogPlan,
  type CatalogProduct,
} from '@/features/catalog/api'
import { BuyDialog } from '@/features/orders/buy-dialog'

/**
 * Витрина: товары и тарифы. «Купить» открывает выбор способа оплаты из тех,
 * что администратор включил в панели (ЮKassa, крипта, Digiseller).
 * Купленное на Digiseller активируется кодом на /activate — об этом блок внизу.
 */
export const Route = createFileRoute('/_app/catalog')({
  component: CatalogPage,
})

function CatalogPage() {
  const t = useT()
  const { data, isPending, error, refetch } = useQuery(catalogQueryOptions())

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>
          {t('catalog.title')}
        </h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          {t('catalog.description')}
        </p>
      </div>

      {isPending && (
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className='h-64 rounded-lg' />
          ))}
        </div>
      )}

      {error != null && (
        <Alert variant='destructive'>
          <AlertTitle>{t('catalog.error.title')}</AlertTitle>
          <AlertDescription className='space-y-3'>
            <ApiErrorText error={error} />
            <Button variant='outline' size='sm' onClick={() => void refetch()}>
              {t('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {data != null && data.length === 0 && (
        <div className='rounded-lg border border-dashed p-10 text-center'>
          <ShoppingCart className='mx-auto size-8 text-muted-foreground' />
          <p className='mt-3 font-medium'>{t('catalog.empty.title')}</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            {t('catalog.empty.description')}
          </p>
        </div>
      )}

      {data != null && data.length > 0 && (
        <div className='grid gap-4 lg:grid-cols-2 xl:grid-cols-3'>
          {data.map((product) => (
            <ProductCard key={product.id} product={product} t={t} />
          ))}
        </div>
      )}

      <Alert>
        <Ticket className='size-4' />
        <AlertTitle>{t('catalog.activate.title')}</AlertTitle>
        <AlertDescription className='flex flex-wrap items-center gap-3'>
          <span>{t('catalog.activate.description')}</span>
          <Button asChild variant='outline' size='sm'>
            <Link to='/activate'>{t('catalog.activate.action')}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

function ProductCard({
  product,
  t,
}: {
  product: CatalogProduct
  t: TFunction
}) {
  const [buying, setBuying] = useState<CatalogPlan | null>(null)
  // Lifetime (durationDays = null/0) — в конце списка.
  const plans = [...product.plans].sort(
    (a, b) => (a.durationDays || Infinity) - (b.durationDays || Infinity)
  )

  return (
    <Card className='flex flex-col'>
      <CardHeader>
        <CardTitle>{product.name}</CardTitle>
        {product.description != null && product.description !== '' && (
          <CardDescription>{product.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className='flex-1'>
        <ul className='divide-y'>
          {plans.map((plan) => (
            <li key={plan.id} className='flex items-center justify-between gap-3 py-3'>
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium'>
                  {plan.name || formatDuration(plan.durationDays)}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {formatPrice(plan.price, plan.currency)}
                </p>
              </div>
              <Button size='sm' onClick={() => setBuying(plan)}>
                {t('catalog.plan.buy')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>

      <BuyDialog
        plan={buying}
        productId={product.id}
        productName={product.name}
        open={buying !== null}
        onOpenChange={(open) => {
          if (!open) setBuying(null)
        }}
      />
    </Card>
  )
}
