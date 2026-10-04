import { useT } from '@/lib/i18n'
import { ErrorPage } from './error-page'

export function NotFoundError() {
  const t = useT()

  return (
    <ErrorPage
      code='404'
      title={t('errors.notFound.title')}
      description={t('errors.notFound.description')}
    />
  )
}
