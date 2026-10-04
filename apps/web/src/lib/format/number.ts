/**
 * Числа и денежные суммы — единая реализация на всё приложение.
 *
 * Здесь был ещё и `plural` с русскими окончаниями, собранный из двух копий
 * (K3 и K6). Он удалён: окончания он подставлял русские ВСЕГДА, независимо от
 * языка интерфейса. Тексты с числом заводятся ключом с формами в словаре и
 * вызываются как `t('licenses.plan.days', { count })` — форму там выбирает
 * `Intl.PluralRules` по правилам того языка, который сейчас на экране.
 */

import { getLocale } from '@/lib/i18n'

/**
 * Сумма сделки. `amount` приходит строкой: в БД это Decimal(12,2), и Prisma
 * сериализует его строкой намеренно — перевод в number терял бы копейки.
 * Показываем ровно то, что пришло, если валюта неизвестна или нестандартна.
 */
export function formatAmount(
  amount: string | number | null | undefined,
  currency: string | null | undefined
): string {
  if (amount === null || amount === undefined || amount === '') return '—'

  const numeric = typeof amount === 'number' ? amount : Number(amount)
  const code = (currency ?? '').toUpperCase()

  if (!Number.isFinite(numeric) || !/^[A-Z]{3}$/.test(code)) {
    return currency ? `${amount} ${currency}` : String(amount)
  }

  try {
    // Локаль берётся из интерфейса: она задаёт разделитель разрядов и место
    // символа валюты («1 234,56 ₽» против «₽1,234.56»). Сама валюта при этом
    // приходит с сервера и не подменяется — курс мы не пересчитываем.
    return new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
    }).format(numeric)
  } catch {
    // Валюта из трёх букв, но не из списка ISO — Intl бросает RangeError.
    return `${amount} ${code}`
  }
}
