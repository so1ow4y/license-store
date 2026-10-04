import { createFileRoute, redirect } from '@tanstack/react-router'
import { ApiError } from '@/lib/api/client'
import { meQueryOptions } from '@/lib/auth/session'
import { hasStoredSession } from '@/lib/auth/token-store'
import { AppShell } from '@/components/app-shell'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Защищённый layout.
 *
 * Сессия проверяется в `beforeLoad`, а не внутри компонента: иначе маршрут
 * успеет отрисоваться и запросить свои данные, получит пачку 401 и только
 * потом выкинет на вход — пользователь увидит мигание пустого кабинета.
 *
 * `/auth/me` кладём в кеш здесь же, чтобы дочерние экраны читали права
 * синхронно и не гоняли один и тот же запрос по разу на каждый компонент.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    // Ни access в памяти, ни refresh в хранилище — заведомо гость.
    // Сетевой заход тут только сжёг бы лимит частоты на /auth.
    if (!hasStoredSession()) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    try {
      const me = await context.queryClient.ensureQueryData(meQueryOptions())
      return { me }
    } catch (error) {
      // 401 здесь означает, что и обновление токена не помогло: apiFetch уже
      // сходил в refresh и повторил запрос ровно один раз.
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({
          to: '/login',
          search: { redirect: location.href, reason: 'expired' },
        })
      }
      // 5xx наверх: разлогинивать из-за аварии сервера нельзя.
      throw error
    }
  },
  component: AppShell,
  pendingComponent: SessionSplash,
})

/** Пока идёт «холодная» проверка сессии, защищённое содержимое не рисуем. */
function SessionSplash() {
  return (
    <div className='flex min-h-svh flex-col gap-4 p-6'>
      <Skeleton className='h-8 w-48' />
      <Skeleton className='h-40 w-full max-w-2xl' />
      <Skeleton className='h-40 w-full max-w-2xl' />
    </div>
  )
}
