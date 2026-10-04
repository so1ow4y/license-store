import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { KeyRound, Receipt, Ticket } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/lib/i18n'
import { DigisellerRedeemForm } from '@/features/billing/digiseller-form'
import { DigisellerOrderForm } from '@/features/billing/order-form'
import { RegistrationKeyRedeemForm } from '@/features/keys/redeem-form'

/**
 * Активация покупки (п. 3.13–3.14 плана) — единственный денежный путь.
 *
 * Два способа получить лицензию живут на одном экране намеренно: человек
 * с оплатой в руках не обязан знать, чем «код покупки» отличается от
 * «регистрационного ключа». Различие подписано прямо в интерфейсе, а не
 * оставлено на догадку.
 *
 * Вкладка держится в адресе (`?tab=key`), чтобы поддержка могла прислать
 * ссылку прямо на нужную форму, а перезагрузка не сбрасывала выбор.
 */
const activateSearchSchema = z.object({
  // `.default` и `.catch` вместе, и это не избыточность:
  //   default — адрес без ?tab (ссылка из меню и с пустого кабинета) законен,
  //             иначе типизированный `Link to='/activate'` требует search.tab;
  //   catch   — ?tab=мусор из письма или закладки открывает первую вкладку,
  //             а не роняет экран в 500.
  tab: z.enum(['code', 'order', 'key']).default('code').catch('code'),
})

export const Route = createFileRoute('/_app/activate')({
  validateSearch: activateSearchSchema,
  component: ActivatePage,
})

function ActivatePage() {
  const t = useT()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className='mx-auto w-full max-w-2xl space-y-6'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>
          {t('activate.title')}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {t('activate.description')}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            search: {
              tab: value === 'key' ? 'key' : value === 'order' ? 'order' : 'code',
            },
            // replace: выбор вкладки не событие в истории, иначе кнопка
            // «назад» будет щёлкать по вкладкам вместо возврата в кабинет.
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value='code'>
            <Ticket className='size-4' />
            {t('activate.tab.code')}
          </TabsTrigger>
          <TabsTrigger value='order'>
            <Receipt className='size-4' />
            {t('activate.tab.order')}
          </TabsTrigger>
          <TabsTrigger value='key'>
            <KeyRound className='size-4' />
            {t('activate.tab.key')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value='code'>
          <Card>
            <CardHeader>
              <CardTitle>{t('activate.code.title')}</CardTitle>
              <CardDescription>{t('activate.code.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <DigisellerRedeemForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='order'>
          <Card>
            <CardHeader>
              <CardTitle>{t('activate.order.title')}</CardTitle>
              <CardDescription>
                {t('activate.order.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DigisellerOrderForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='key'>
          <Card>
            <CardHeader>
              <CardTitle>{t('activate.key.title')}</CardTitle>
              <CardDescription>{t('activate.key.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <RegistrationKeyRedeemForm />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className='text-xs text-muted-foreground'>{t('activate.note')}</p>
    </div>
  )
}
