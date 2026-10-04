import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Info } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiErrorText } from '@/components/api-error-text'
import { NEUTRAL_ERROR_CODES } from '@/lib/api/error-codes'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useT } from '@/lib/i18n'

/**
 * Активация покупки по НОМЕРУ ЗАКАЗА — запасной путь к уникальному коду.
 *
 * КОГДА НУЖЕН. Уникальный код Digiseller выдаёт, только если эта функция
 * включена на карточке товара. Если она выключена, покупателю приходит
 * произвольный текст продавца, и активировать нечем. Номер заказа есть
 * всегда — он в письме площадки и в кабинете покупателя.
 *
 * ПОЧЕМУ ЗАПРАШИВАЕТСЯ ПОЧТА. Номер заказа секретом не является: он идёт
 * подряд, и соседние номера принадлежат чужим людям. Право на покупку
 * доказывает совпадение с адресом, который площадка вернула в buyer_info.
 * Если почта аккаунта подтверждена и совпадает — сервер принимает покупку
 * без ввода, поле остаётся на случай покупки с другого адреса.
 *
 * Контракт снят с сервера: `POST /billing/digiseller/redeem-order`,
 * тело строго `{ orderNumber, email }` (`dto/billing.dto.ts:32`), номер —
 * от 6 до 12 цифр, лишнее поле даст 400 из-за forbidNonWhitelisted.
 */

const ORDER_RE = /^[0-9]{6,12}$/

type OrderResult = {
  status: 'ISSUED' | 'ALREADY_YOURS'
  orderNumber?: string
  licenseKey?: string | null
}

/** Убираем всё, кроме цифр: номер копируют вместе с «№», пробелами и точкой. */
function normalizeOrder(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function DigisellerOrderForm() {
  const t = useT()
  const [rawOrder, setRawOrder] = useState('')
  const [email, setEmail] = useState('')
  const queryClient = useQueryClient()

  const orderNumber = normalizeOrder(rawOrder)
  const isComplete = ORDER_RE.test(orderNumber) && email.trim().length > 0

  const mutation = useMutation({
    mutationFn: (body: { orderNumber: string; email: string }) =>
      apiFetch<OrderResult>('/billing/digiseller/redeem-order', { method: 'POST', body }),
    onSuccess: () => {
      // Список лицензий устарел: появилась новая. Ключ раздела принадлежит
      // другому куску кода, поэтому не зашиваем его строкой. Сессию не
      // трогаем — права от покупки не меняются.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'auth',
      })
    },
  })

  function reset() {
    // Прошлый результат относится к прошлому заказу. Оставить его под новым
    // вводом — способ заставить человека заплатить дважды: он увидит старое
    // «уже активировано» и решит, что делать ничего не надо.
    if (mutation.data || mutation.error) mutation.reset()
  }

  const result = mutation.data

  if (result != null) {
    return (
      <div className='space-y-4'>
        <Alert>
          <CircleCheck className='size-4 text-emerald-600' />
          <AlertTitle>
            {result.status === 'ISSUED'
              ? t('billing.order.issued.title')
              : t('billing.order.alreadyYours.title')}
          </AlertTitle>
          <AlertDescription>
            {result.status === 'ISSUED'
              ? t('billing.order.issued.description')
              : t('billing.order.alreadyYours.description')}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const neutral =
    mutation.error instanceof ApiError && NEUTRAL_ERROR_CODES.has(mutation.error.code ?? '')

  return (
    <form
      className='space-y-4'
      onSubmit={(event) => {
        event.preventDefault()
        if (!isComplete || mutation.isPending) return
        mutation.mutate({ orderNumber, email: email.trim() })
      }}
    >
      <div className='space-y-1.5'>
        <Label htmlFor='order-number'>
          {t('billing.order.field.number.label')}
        </Label>
        <Input
          id='order-number'
          inputMode='numeric'
          placeholder='298114896'
          value={rawOrder}
          onChange={(event) => {
            setRawOrder(event.target.value)
            reset()
          }}
          disabled={mutation.isPending}
          className='font-mono'
        />
        <p className='text-xs text-muted-foreground'>
          {t('billing.order.field.number.hint')}
        </p>
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='order-email'>
          {t('billing.order.field.email.label')}
        </Label>
        <Input
          id='order-email'
          type='email'
          autoComplete='email'
          placeholder={t('billing.order.field.email.placeholder')}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            reset()
          }}
          disabled={mutation.isPending}
        />
        <p className='text-xs text-muted-foreground'>
          {t('billing.order.field.email.hint')}
        </p>
      </div>

      {mutation.error != null && (
        <Alert variant={neutral ? 'default' : 'destructive'}>
          {neutral && <Info className='size-4' />}
          <AlertDescription>
            <ApiErrorText error={mutation.error} />
          </AlertDescription>
        </Alert>
      )}

      <Button type='submit' className='w-full' disabled={!isComplete || mutation.isPending}>
        {mutation.isPending
          ? t('billing.order.action.pending')
          : t('billing.order.action.submit')}
      </Button>

      <p className='text-xs text-muted-foreground'>
        {t('billing.order.note')}
      </p>
    </form>
  )
}
