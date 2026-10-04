import { createFileRoute, Outlet } from '@tanstack/react-router'
import { LocaleSwitcher } from '@/components/locale-switcher'

/**
 * Публичный layout: вход, регистрация, подтверждение почты, сброс пароля.
 *
 * Сессию НЕ проверяет намеренно. Ссылки из писем (`/verify-email?token=`,
 * `/reset-password?token=`) обязаны открываться и у гостя, и у вошедшего
 * пользователя — редирект «вы уже вошли» просто сожрал бы одноразовый токен.
 */
export const Route = createFileRoute('/_public')({
  component: PublicLayout,
})

function PublicLayout() {
  return (
    <div className='flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10'>
      {/*
        Второе место переключателя — и оно обязательное.

        Здесь у человека ещё нет сессии, а значит, нет и шапки кабинета
        с первым переключателем. Экран входа — это ПЕРВОЕ, что видит новый
        посетитель; язык, недоступный до входа, недоступен ровно тогда, когда
        он нужнее всего.
      */}
      <div className='mb-4 flex w-full max-w-sm justify-end'>
        <LocaleSwitcher />
      </div>
      <div className='w-full max-w-sm'>
        <Outlet />
      </div>
    </div>
  )
}
