/**
 * Публичный вход в локализацию. Импортировать следует ОТСЮДА:
 *
 *   import { useT } from '@/lib/i18n'          // в компоненте
 *   import { t } from '@/lib/i18n'             // в модульном хелпере
 *
 * Внутренние файлы (`translate.ts`, `locale.ts`, `messages/*`) — деталь
 * реализации: если словарь однажды переедет на другой движок, поменяется
 * только она, а вызовы на экранах останутся прежними.
 */
export {
  ACCEPT_LANGUAGE,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  LOCALE_SHORT,
  isLocale,
  type Locale,
} from './config'

export {
  acceptLanguageHeader,
  getLocale,
  initLocale,
  setLocale,
  subscribeLocale,
  useLocale,
} from './locale'

export { t, useT, type TFunction } from './translate'

export type { MessageKey } from './messages/en'
