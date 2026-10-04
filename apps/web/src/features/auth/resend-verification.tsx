import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { MailPlus } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiErrorText } from '@/components/api-error-text'
import { apiFetch } from '@/lib/api/client'
import { useT } from '@/lib/i18n'

/**
 * Повторная отправка письма подтверждения.
 *
 * ЗАЧЕМ. Без этой формы потерянное письмо означало тупик: войти нельзя —
 * почта не подтверждена, зарегистрироваться заново нельзя — логин и адрес
 * заняты тем же человеком. Аккаунт оставался мёртвым навсегда.
 *
 * АДРЕС СПРАШИВАЕМ ЗАНОВО, хотя пользователь только что его вводил. Хранить
 * его между экранами значило бы положить чужие персональные данные в адресную
 * строку или в localStorage, откуда они уезжают в историю браузера и в чужие
 * руки. Ввести адрес второй раз дешевле, чем объяснять утечку.
 *
 * ОТВЕТ СЕРВЕРА ОДИНАКОВ всегда — отправил он письмо или нет. Поэтому здесь
 * нельзя показать «адрес не найден»: сервер этого не сообщает намеренно, иначе
 * форма стала бы бесплатной проверялкой чужих адресов. Текст успеха написан
 * так, чтобы не обещать письмо тому, кому его не отправят.
 */
export function ResendVerification() {
  const [email, setEmail] = useState('')
  const t = useT()

  const mutation = useMutation({
    mutationFn: (value: string) =>
      apiFetch<{ message: string }>('/auth/verify-email/resend', {
        method: 'POST',
        body: { email: value },
      }),
  })

  if (mutation.isSuccess) {
    return (
      <Alert>
        <MailPlus className='size-4' />
        <AlertDescription>{t('register.resend.success')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <form
      className='space-y-3'
      onSubmit={(event) => {
        event.preventDefault()
        const value = email.trim()
        if (value.length === 0 || mutation.isPending) return
        mutation.mutate(value)
      }}
    >
      <div className='space-y-1.5'>
        <Label htmlFor='resend-email'>{t('register.resend.label')}</Label>
        <Input
          id='resend-email'
          type='email'
          autoComplete='email'
          placeholder={t('register.resend.placeholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={mutation.isPending}
        />
      </div>

      {mutation.error != null && (
        <Alert variant='destructive'>
          <AlertDescription>
            <ApiErrorText error={mutation.error} />
          </AlertDescription>
        </Alert>
      )}

      <Button
        type='submit'
        variant='outline'
        className='w-full'
        disabled={email.trim().length === 0 || mutation.isPending}
      >
        {mutation.isPending
          ? t('register.resend.action.pending')
          : t('register.resend.action.submit')}
      </Button>
    </form>
  )
}
