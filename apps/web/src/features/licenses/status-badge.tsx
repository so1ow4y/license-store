import { t } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { LicenseStatus } from './api'

/**
 * Статус лицензии.
 *
 * PENDING — не «что-то не так», а нормальное состояние только что купленной
 * лицензии: срок не идёт, пока продукт не запустили. Без явного объяснения
 * человек решает, что оплаченные дни утекают впустую, и идёт в поддержку.
 *
 * Подписи стали функциями, а не константами-словарями: константа считается
 * при загрузке модуля и языка потом уже не меняет. Ключи собираются из самого
 * статуса (`licenses.status.ACTIVE.label`), поэтому новый статус сервера
 * добавляется в словарь двумя строками и здесь ничего править не нужно.
 */
export function licenseStatusLabel(status: LicenseStatus): string {
  return t(`licenses.status.${status}.label`)
}

/**
 * Ключевое объяснение статуса PENDING. Держится здесь одной функцией, чтобы
 * список и карточка говорили одно и то же слово в слово.
 */
export function pendingExplanation(): string {
  return t('licenses.status.PENDING.hint')
}

/** Что делать дальше в каждом состоянии: экран без подсказки бесполезен. */
export function licenseStatusHint(status: LicenseStatus): string {
  return t(`licenses.status.${status}.hint`)
}

const BADGE_VARIANT: Record<
  LicenseStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  // Цвет несёт смысл: активная — акцент, ожидание — нейтральный,
  // блокировка и отзыв — тревожный. Истечение срока не авария, а срок.
  PENDING: 'secondary',
  ACTIVE: 'default',
  EXPIRED: 'outline',
  BLOCKED: 'destructive',
  REVOKED: 'destructive',
}

const BADGE_EXTRA: Partial<Record<LicenseStatus, string>> = {
  ACTIVE: 'bg-emerald-600 text-white dark:bg-emerald-500',
  EXPIRED: 'border-amber-500/60 text-amber-700 dark:text-amber-400',
}

type LicenseStatusBadgeProps = {
  status: LicenseStatus
  className?: string
  /**
   * Компактный вид для административных таблиц: без цветовых надбавок и без
   * подсказки «что делать дальше». Администратору в строке таблицы нужен
   * признак, а не абзац, адресованный покупателю.
   */
  compact?: boolean
}

export function LicenseStatusBadge({
  status,
  className,
  compact = false,
}: LicenseStatusBadgeProps) {
  return (
    <Badge
      variant={BADGE_VARIANT[status] ?? 'secondary'}
      className={cn(!compact && BADGE_EXTRA[status], className)}
      // Подсказка для тех, кому цвет не помогает: скринридер и мышь
      // получают одинаковый текст.
      title={compact ? undefined : licenseStatusHint(status)}
    >
      {licenseStatusLabel(status) || status}
    </Badge>
  )
}
