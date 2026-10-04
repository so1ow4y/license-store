import { useT } from '@/lib/i18n'
import { ErrorPage } from './error-page'

/**
 * 403. Разлогинивать при этом коде НЕЛЬЗЯ: сессия жива, не хватает прав.
 * Выброс на вход выглядел бы для пользователя как случайный сбой.
 */
export function ForbiddenError() {
  const t = useT()

  return (
    <ErrorPage
      code='403'
      title={t('errors.forbidden.title')}
      description={t('errors.forbidden.description')}
    />
  )
}
