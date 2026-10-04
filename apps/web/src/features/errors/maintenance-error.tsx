import { useT } from '@/lib/i18n'
import { ErrorPage } from './error-page'

export function MaintenanceError() {
  const t = useT()

  return (
    <ErrorPage
      code='503'
      title={t('errors.maintenance.title')}
      description={t('errors.maintenance.description')}
    />
  )
}
