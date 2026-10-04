import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Прежний адрес страницы бота. На него ведут кнопки «Подключить» в самом
 * Telegram-боте, поэтому маршрут остаётся и переадресует в настройки.
 */
export const Route = createFileRoute('/_app/account/telegram')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/telegram', replace: true })
  },
})
