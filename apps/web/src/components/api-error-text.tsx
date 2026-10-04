import { ApiError } from '@/lib/api/client'
import {
  NEUTRAL_ERROR_CODES,
  messageForCode,
  unknownErrorMessage,
} from '@/lib/api/error-codes'
import { cn } from '@/lib/utils'

type ApiErrorTextProps = {
  error: unknown
  /** Текст на случай, когда ошибка вообще не от API (сбой в коде экрана). */
  fallback?: string
  className?: string
  /** Показывать ли разбор `details[]` от ValidationPipe отдельным списком. */
  showValidationDetails?: boolean
  /**
   * Точечная замена текстов для конкретного раздела.
   *
   * Нужна потому, что один код значит разное для покупателя и для
   * администратора: `PRODUCT_NOT_MAPPED` покупателю — «оплата принята,
   * лицензия будет выдана», администратору — «тариф не заведён, иди и заведи».
   * Показать администратору успокаивающий текст значит оставить сделку висеть.
   * Без этого параметра разделы заводят собственные копии компонента.
   */
  overrides?: Record<string, string>
}

/**
 * Единая точка перевода ошибки в текст.
 *
 * Ветвится строго по `code`. Незнакомый код отдаёт `message` сервера — он уже
 * по-русски, и это лучше, чем «неизвестная ошибка» на глазах пользователя.
 */
export function ApiErrorText({
  error,
  // Значение по умолчанию считается вызовом, а не берётся из константы:
  // константа посчиталась бы один раз при загрузке модуля и осталась бы
  // на языке, который был активен тогда.
  fallback,
  className,
  showValidationDetails = true,
  overrides,
}: ApiErrorTextProps) {
  if (!error) return null

  if (!(error instanceof ApiError)) {
    return (
      <p className={cn('text-sm text-destructive', className)}>
        {fallback ?? unknownErrorMessage()}
      </p>
    )
  }

  // Состояния вроде «оплата принята, лицензия будет выдана» приходят кодом
  // ошибки, но ошибкой не являются: красный цвет здесь пугает без причины.
  // Переопределённый текст нейтральным не считаем: раздел заменил его именно
  // потому, что для него это работа, которую надо сделать.
  const neutral = !overrides?.[error.code] && NEUTRAL_ERROR_CODES.has(error.code)
  const details = showValidationDetails ? error.validationMessages : []

  return (
    <div
      className={cn(
        'text-sm',
        neutral ? 'text-muted-foreground' : 'text-destructive',
        className
      )}
      role={neutral ? 'status' : 'alert'}
    >
      <p>{apiErrorMessage(error, fallback ?? unknownErrorMessage(), overrides)}</p>
      {details.length > 0 && (
        <ul className='mt-1 list-inside list-disc space-y-0.5'>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Текст без разметки — для тостов и заголовков.
 *
 * Порядок разбора: словарь раздела → общий словарь → сообщение сервера.
 * Ветвление строго по `code`: тексты сервера меняются, коды нет.
 */
export function apiErrorMessage(
  error: unknown,
  fallback?: string,
  overrides?: Record<string, string>
): string {
  if (error instanceof ApiError) {
    return (
      overrides?.[error.code] ??
      // `details` передаём дальше: по нему словарь собирает тексты с числом
      // от сервера — «повторите через 47 мин».
      messageForCode(error.code, error.message, error.details)
    )
  }
  return fallback ?? unknownErrorMessage()
}
