/**
 * Перевод по ключу: подстановки и формы числа.
 *
 * Весь механизм — этот файл. Множественное число считает `Intl.PluralRules`
 * из платформы: он знает правила CLDR для обоих языков (у русского one/few/many,
 * у английского one/other) и не требует ни байта в бандле.
 */
import { useMemo } from 'react'
import type { Locale } from './config'
import { getLocale, useLocale } from './locale'
import { en, type CountKey, type MessageKey, type Messages, type PlainKey } from './messages/en'
import { ru } from './messages/ru'
import type { MessageParams, PluralForms } from './types'

const CATALOGS: Record<Locale, Messages> = { en, ru }

/**
 * Экземпляры `Intl.PluralRules` дороги в создании и не имеют состояния —
 * создаём по одному на язык и держим.
 */
const pluralRules = new Map<Locale, Intl.PluralRules>()

function rulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return rules
}

/**
 * Форма по числу. `other` — страховка: если у языка есть категория, которую
 * словарь не заполнил, лучше показать общую форму, чем пустоту.
 */
function selectForm(locale: Locale, forms: PluralForms, count: number): string {
  return forms[rulesFor(locale).select(count)] ?? forms.other
}

/**
 * Подстановка `{имя}` из параметров.
 *
 * Неизвестный placeholder остаётся в тексте как есть, а не превращается
 * в пустоту: `Показать ещё ({loaded} из 5)` — заметная ошибка, которую
 * поймают на первом же просмотре; `Показать ещё ( из 5)` выглядит как
 * «данные не пришли» и живёт месяцами.
 */
function interpolate(raw: string, params?: MessageParams): string {
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (whole: string, name: string) =>
    name in params ? String(params[name]) : whole
  )
}

function translate(
  locale: Locale,
  key: MessageKey,
  params?: MessageParams
): string {
  // Падение на отсутствующий ключ невозможно по типам, но словарь могут
  // подменить в рантайме сборкой постарше — тогда лучше английский текст,
  // чем голый ключ на экране.
  const entry: string | PluralForms = CATALOGS[locale][key] ?? en[key]
  if (typeof entry === 'string') return interpolate(entry, params)

  const count = Number(params?.count ?? 0)
  return interpolate(selectForm(locale, entry, count), params)
}

/**
 * Сигнатура функции перевода.
 *
 * Две перегрузки, а не одна: ключ с формами числа БЕЗ `count` — ошибка сборки,
 * а не молчаливое «0 сбросов» на экране.
 */
export interface TFunction {
  (key: PlainKey, params?: MessageParams): string
  (key: CountKey, params: MessageParams & { count: number }): string
}

function makeT(locale: Locale): TFunction {
  return ((key: MessageKey, params?: MessageParams) =>
    translate(locale, key, params)) as TFunction
}

/**
 * Перевод ВНЕ компонента: словарь ошибок, форматтеры, модульные хелперы.
 *
 * Читает язык в момент вызова. Этого достаточно, потому что при переключении
 * языка `__root.tsx` перемонтирует дерево целиком (см. комментарий там):
 * ни один текст, посчитанный старым языком, до экрана не доживает.
 */
export const t: TFunction = ((key: MessageKey, params?: MessageParams) =>
  translate(getLocale(), key, params)) as TFunction

/**
 * Перевод В КОМПОНЕНТЕ — обычный способ. Подписан на язык, поэтому компонент
 * честно объявляет свою зависимость и перерисуется даже без перемонтирования.
 */
export function useT(): TFunction {
  const locale = useLocale()
  return useMemo(() => makeT(locale), [locale])
}
