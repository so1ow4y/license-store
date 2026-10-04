import { t } from '@/lib/i18n'
import { ApiErrorText, apiErrorMessage } from '@/components/api-error-text'

/**
 * Административные тексты ошибок.
 *
 * Здесь остался ТОЛЬКО словарь — разметку и разбор `details[]` делает общий
 * `components/api-error-text.tsx`. Раньше это была вторая копия компонента;
 * копия неизбежно отставала бы от общей (например, по нейтральным кодам).
 *
 * Зачем словарь вообще нужен. Один и тот же код значит для покупателя и для
 * администратора разное, и общий текст администратору вреден:
 *
 *   PRODUCT_NOT_MAPPED покупателю — «оплата принята, лицензия будет выдана»
 *   (успокоить: деньги дошли). Администратору ровно этот же код означает
 *   «ты не завёл тариф, иди и заведи» — и если показать ему успокаивающий
 *   текст, сделка так и останется висеть.
 *
 * Плюс здесь живут коды, которых в общем словаре нет вовсе (`NOT_BLOCKED`
 * из `licenses.service.ts:251`).
 *
 * Функция, а не константа модуля: константа посчиталась бы один раз при
 * загрузке файла и осталась бы на языке, активном в тот момент. Набор кодов
 * при этом не изменился — код по-прежнему добавляется одной строкой.
 */
export function adminErrorMessages(): Record<string, string> {
  return {
    // --- Зависшие сделки ---
    PRODUCT_NOT_MAPPED: t('admin.error.PRODUCT_NOT_MAPPED'),
    ALREADY_REDEEMED: t('admin.error.ALREADY_REDEEMED'),
    NO_CLAIMANT: t('admin.error.NO_CLAIMANT'),
    NOT_FOUND: t('admin.error.NOT_FOUND'),

    // --- Лицензии ---
    NOT_BLOCKED: t('admin.error.NOT_BLOCKED'),
    PLAN_MISMATCH: t('admin.error.PLAN_MISMATCH'),

    // --- Товары, тарифы, сборки: «занято» здесь про код, а не про логин ---
    ALREADY_EXISTS: t('admin.error.ALREADY_EXISTS'),
  }
}

/** Текст ошибки для административного экрана. */
export function adminErrorMessage(error: unknown, fallback?: string): string {
  return apiErrorMessage(error, fallback, adminErrorMessages())
}

/** Тот же текст в разметке общего компонента. */
export function AdminErrorText({
  error,
  className,
  fallback,
}: {
  error: unknown
  className?: string
  fallback?: string
}) {
  return (
    <ApiErrorText
      error={error}
      className={className}
      fallback={fallback}
      overrides={adminErrorMessages()}
    />
  )
}
