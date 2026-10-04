/**
 * Настройки интерфейса: где стоит панель навигации, развёрнута ли она и какая
 * цветовая схема. Личное удобство одного браузера — поэтому localStorage,
 * а не сервер. Хранилище модульное, как у языка (`lib/i18n/locale.ts`).
 */
import { useSyncExternalStore } from 'react'

export const DOCK_POSITIONS = ['left', 'bottom', 'right', 'top'] as const
export type DockPosition = (typeof DOCK_POSITIONS)[number]

export const THEMES = ['lime', 'lavender'] as const
export type ThemeName = (typeof THEMES)[number]

export type UiPreferences = {
  dock: DockPosition
  dockExpanded: boolean
  /** Док спрятан целиком — висит только буква. */
  dockHidden: boolean
  /** Док появляется, только когда мышь подходит к его краю. */
  dockAutoHide: boolean
  theme: ThemeName
}

/** Буква в логотипе меняется вместе со схемой. */
export const THEME_LETTER: Record<ThemeName, string> = { lime: 'L', lavender: 'S' }

/** Совпадает с --background схемы: цвет панели браузера на телефоне. */
const THEME_BACKGROUND: Record<ThemeName, string> = { lime: '#08090c', lavender: '#0e0c15' }

/** Ключ читает и встроенный скрипт в index.html — менять в двух местах. */
const STORAGE_KEY = 'lp.ui'

const DEFAULTS: UiPreferences = {
  dock: 'left',
  dockExpanded: false,
  dockHidden: false,
  dockAutoHide: false,
  theme: 'lime',
}

const KEYS = Object.keys(DEFAULTS) as (keyof UiPreferences)[]

let current: UiPreferences = DEFAULTS
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

/** Разбор с откатом к умолчаниям: в хранилище может лежать что угодно. */
function parse(raw: string | null): UiPreferences {
  if (!raw) return DEFAULTS
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const flag = (key: 'dockExpanded' | 'dockHidden' | 'dockAutoHide') =>
      typeof value[key] === 'boolean' ? (value[key] as boolean) : DEFAULTS[key]
    return {
      dock: oneOf(DOCK_POSITIONS, value.dock, DEFAULTS.dock),
      dockExpanded: flag('dockExpanded'),
      dockHidden: flag('dockHidden'),
      dockAutoHide: flag('dockAutoHide'),
      theme: oneOf(THEMES, value.theme, DEFAULTS.theme),
    }
  } catch {
    return DEFAULTS
  }
}

/** В приватном режиме обращение к localStorage бросает исключение. */
function readStored(): UiPreferences {
  try {
    return parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULTS
  }
}

function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_BACKGROUND[theme])
}

/** Вызывается один раз до первого рендера. */
export function initUiPreferences(): void {
  current = readStored()
  applyTheme(current.theme)

  // Настройки поменяли в другой вкладке — подхватываем без перезагрузки.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    current = parse(event.newValue)
    applyTheme(current.theme)
    emit()
  })
}

export function setUiPreferences(patch: Partial<UiPreferences>): void {
  const next = { ...current, ...patch }
  if (KEYS.every((key) => next[key] === current[key])) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Запись недоступна — настройка действует до закрытия вкладки.
  }
  applyTheme(next.theme)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): UiPreferences {
  return current
}

export function useUiPreferences(): UiPreferences {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
