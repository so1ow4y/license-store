import { useT } from '@/lib/i18n'
import { ErrorPage } from './error-page'

type GeneralErrorProps = { minimal?: boolean }

/**
 * Экран необработанного сбоя. Ставится в errorComponent корневого маршрута:
 * без него падение любого компонента даёт белый экран без объяснений.
 */
export function GeneralError({ minimal = false }: GeneralErrorProps) {
  const t = useT()

  return (
    <ErrorPage
      code='500'
      minimal={minimal}
      title={t('errors.general.title')}
      description={t('errors.general.description')}
    />
  )
}
