/**
 * Даты и сроки — единая реализация на всё приложение.
 *
 * Сведено из двух независимых копий: `features/licenses/format.ts` (K3,
 * date-fns с русской локалью) и `features/admin/format.ts` (K6, Intl). Обе
 * решали одну задачу и давали разный вид одной и той же даты на соседних
 * экранах. Оставлен вариант на date-fns: «5 августа 2026, 17:04» читается
 * лучше, чем «5 авг. 2026 г., 17:04», а библиотека и так в зависимостях.
 *
 * Все даты сервер отдаёт строками ISO (Timestamptz), поэтому на вход
 * принимаем именно строку. NULL — законное значение почти во всех полях
 * (лицензия без срока, привязки ещё не было), и рисовать его нужно прочерком,
 * а не «Invalid Date».
 */
import { format, formatDistanceToNowStrict } from 'date-fns'
import { enGB, ru } from 'date-fns/locale'
import { getLocale, t } from '@/lib/i18n'

/**
 * Локаль date-fns под текущий язык интерфейса.
 *
 * Взят `enGB`, а не `enUS`: у британского формата порядок «день месяц год»
 * тот же, что у русского, поэтому карточка лицензии не переставляет числа
 * местами при переключении языка. `5 August 2026` и `5 августа 2026` читаются
 * одинаково, `August 5, 2026` — уже иначе.
 *
 * Функция, а не константа: язык меняется в рантайме.
 */
function dateLocale() {
  return getLocale() === 'ru' ? ru : enGB
}

/** Прочерк вместо пустоты: пустая ячейка читается как «данные не загрузились». */
export const EMPTY_VALUE = '—'

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** «5 августа 2026, 17:04» — для событий, где важен час (привязки, сбросы). */
export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value)
  return date
    ? format(date, 'd MMMM yyyy, HH:mm', { locale: dateLocale() })
    : EMPTY_VALUE
}

/** «5 августа 2026» — для дат выдачи и окончания, час там шума не стоит. */
export function formatDate(value: string | null | undefined): string {
  const date = toDate(value)
  return date ? format(date, 'd MMMM yyyy', { locale: dateLocale() }) : EMPTY_VALUE
}

/** «через 12 дней» / «3 дня назад» — относительное время без «около». */
export function formatRelative(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY_VALUE
  return formatDistanceToNowStrict(date, { locale: dateLocale(), addSuffix: true })
}

/**
 * Сколько осталось до даты в миллисекундах. Отрицательное значение
 * приравниваем к нулю: «минус два часа» на экране бессмысленно.
 */
export function millisUntil(value: string | null | undefined): number {
  const date = toDate(value)
  if (!date) return 0
  return Math.max(0, date.getTime() - Date.now())
}

/**
 * Обратный отсчёт вида «23 ч 14 мин» или «14 мин 03 с».
 *
 * Секунды показываем только на последнем часе: сутки, тикающие посекундно,
 * создают ложное ощущение, что ждать осталось чуть-чуть.
 *
 * Единицы берутся из словаря, а не склеиваются здесь: пока они были вшиты
 * строками, английский интерфейс показывал «23 ч 14 мин».
 */
export function formatCountdown(millis: number): string {
  const total = Math.max(0, Math.floor(millis / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) return t('common.duration.hoursMinutes', { hours, minutes })
  if (minutes > 0) {
    // Секунды с ведущим нулём: без него «14 мин 3 с» дёргает ширину строки
    // на каждом тике таймера.
    return t('common.duration.minutesSeconds', {
      minutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('common.duration.seconds', { seconds })
}

/** Целых дней до даты; null — если даты нет (бессрочная лицензия). */
export function daysUntil(value: string | null | undefined): number | null {
  const date = toDate(value)
  if (!date) return null
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000)
}

/**
 * Сколько сделка уже ждёт выдачи.
 *
 * Это главный столбец экрана зависших сделок: деньги у площадки, а лицензии
 * у покупателя нет, и возраст строки прямо показывает, насколько всё плохо.
 */
export function formatWaiting(createdAt: string | null | undefined): string {
  const started = toDate(createdAt)
  if (!started) return EMPTY_VALUE

  const minutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60_000))
  if (minutes < 60) return t('common.duration.minutes', { count: minutes })

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('common.duration.hours', { count: hours })

  const days = Math.floor(hours / 24)
  return t('common.duration.days', { count: days })
}

/** Сколько часов сделка ждёт — по этому порогу строка подсвечивается. */
export function waitingHours(createdAt: string | null | undefined): number {
  const started = toDate(createdAt)
  if (!started) return 0
  return Math.max(0, (Date.now() - started.getTime()) / 3_600_000)
}
