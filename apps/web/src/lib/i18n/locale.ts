/**
 * Текущий язык интерфейса.
 *
 * Хранилище — модульное, как `features/auth/challenge-store.ts`, а не React
 * Context. Причина конкретная: язык нужен НЕ ТОЛЬКО в компонентах. Его читают
 * нижний слой запросов (`lib/api/http.ts` — заголовок `Accept-Language`),
 * словарь ошибок и форматтеры дат. Context из функции, не являющейся
 * компонентом, не прочитать, а прокидывать язык параметром через каждый вызов
 * `formatDate` — это тот же глобальный доступ, только вручную и с опечатками.
 */
import { useSyncExternalStore } from 'react'
import {
  ACCEPT_LANGUAGE,
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
} from './config'

/**
 * Ключ с префиксом приложения: localStorage общий на весь origin, и голое
 * `locale` рано или поздно столкнётся с чужим значением.
 */
const STORAGE_KEY = 'lp.locale'

let current: Locale = DEFAULT_LOCALE

type Listener = () => void
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * Выбор человека из хранилища.
 *
 * Обёрнуто в try: в приватном режиме Safari и при запрете сторонних данных
 * само обращение к localStorage бросает исключение. Упасть на старте
 * приложения из-за настройки приватности — цена, которой язык не стоит.
 */
function storedLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isLocale(raw) ? raw : null
  } catch {
    return null
  }
}

/**
 * Язык браузера. Учитываем — и вот почему.
 *
 * Английский по умолчанию значит «на что опереться, когда не знаем ничего».
 * Но язык браузера человек уже выбрал сам, один раз и осознанно; показать ему
 * вместо этого умолчание — значит сознательно проигнорировать известное
 * предпочтение. Цена ошибки несимметрична: русскоязычный покупатель, который
 * только что заплатил и упёрся в ошибку, обязан её прочитать.
 *
 * Совпадение только по базовому тегу: `ru-RU`, `ru-BY`, `ru` — русский; всё
 * остальное, включая неизвестное, — английский. Никакого угадывания по стране.
 */
function browserLocale(): Locale | null {
  const tags =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language]

  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return null
}

/**
 * Отметить язык в разметке.
 *
 * `<html lang>` — это не косметика: по нему скринридер выбирает голос и
 * произношение, а браузер решает, предлагать ли автоперевод. Страница с
 * русским текстом под `lang="en"` будет читаться синтезатором как английская
 * абракадабра.
 */
function applyDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

/**
 * Стартовый выбор языка. Вызывается ОДИН РАЗ до первого рендера — иначе
 * интерфейс успеет мигнуть английским и перерисоваться русским.
 *
 * Приоритет: выбор человека → язык браузера → английский.
 */
export function initLocale(): Locale {
  current = storedLocale() ?? browserLocale() ?? DEFAULT_LOCALE
  applyDocumentLang(current)
  return current
}

export function getLocale(): Locale {
  return current
}

/**
 * Переключение языка. Выбор запоминается навсегда: человек, нажавший «RU»,
 * не должен нажимать её ещё раз на следующей вкладке.
 */
export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Запись недоступна — язык всё равно сменится, просто не переживёт вкладку.
  }
  applyDocumentLang(next)
  emit()
}

export function subscribeLocale(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Реактивный доступ к языку. Перерисовывает компонент при переключении. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

/**
 * Значение заголовка `Accept-Language` для запросов к API.
 *
 * Сервер по нему выбирает язык ПИСЬМА. Тексты интерфейса он не отдаёт и
 * не должен: коды ошибок языка не имеют, текст к ним подбирает фронт.
 */
export function acceptLanguageHeader(): string {
  return ACCEPT_LANGUAGE[current]
}
