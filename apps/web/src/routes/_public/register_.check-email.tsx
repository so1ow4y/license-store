import { createFileRoute, Link } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { ResendVerification } from '@/features/auth/resend-verification'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/**
 * Терминальный экран регистрации: «письмо отправлено».
 *
 * Отдельный маршрут, а не состояние формы, чтобы перезагрузка страницы после
 * успешной регистрации не возвращала пустую форму и не провоцировала вторую
 * попытку — она упёрлась бы в `ALREADY_EXISTS` и выглядела бы как отказ.
 *
 * Адрес, на который ушло письмо, здесь НЕ показывается. Он не передаётся ни
 * в адресной строке, ни в хранилище: это персональные данные, а ссылка на
 * такой экран легко уходит в историю браузера и в чужие руки. Пользователь
 * только что ввёл адрес сам и помнит его.
 *
 * ПОЧЕМУ ИМЯ ФАЙЛА С ПОДЧЁРКИВАНИЕМ. В файловом роутинге TanStack точка
 * означает вложенность: файл `register.check-email.tsx` сделал бы этот экран
 * дочерним для `/register`, а саму форму регистрации — layout'ом. Форма
 * `<Outlet/>` не рисует, поэтому по адресу `/register/check-email` человек
 * видел бы пустую форму регистрации. Подчёркивание отключает вложенность;
 * адрес при этом остаётся ровно тем, что задан планом, — `/register/check-email`.
 */
export const Route = createFileRoute('/_public/register_/check-email')({
  component: CheckEmailPage,
})

function CheckEmailPage() {
  const t = useT()

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          <MailCheck className='size-6 text-primary' />
        </div>
        <CardTitle>{t('register.checkEmail.title')}</CardTitle>
        <CardDescription>
          {t('register.checkEmail.description')}
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-3'>
        <p className='text-sm text-muted-foreground'>
          {t('register.checkEmail.body')}
        </p>
        <ul className='list-inside list-disc space-y-1 text-sm text-muted-foreground'>
          <li>{t('register.checkEmail.note.expiry')}</li>
          <li>{t('register.checkEmail.note.delay')}</li>
          <li>{t('register.checkEmail.note.spam')}</li>
        </ul>

        {/*
          Раньше здесь стояло «отправить письмо ещё раз нельзя» и предлагалось
          восстановление пароля как обходной путь — маршрута повторной отправки
          на сервере действительно не существовало, и потерянное письмо
          означало мёртвый аккаунт. Теперь маршрут есть.
        */}
        <ResendVerification />
      </CardContent>

      <CardFooter>
        <Button asChild variant='outline' className='w-full'>
          <Link to='/login'>{t('register.checkEmail.action.login')}</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
