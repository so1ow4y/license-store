/**
 * Настройки интерфейса: где стоит панель навигации и как она себя ведёт,
 * панель записи справа, горячие клавиши, цветовая схема. Личное удобство
 * одного браузера — поэтому localStorage, а не сервер. Хранилище модульное,
 * как у языка (`lib/i18n/locale.ts`).
 */
import { useSyncExternalStore } from 'react'

export const DOCK_POSITIONS = ['left', 'bottom', 'right', 'top'] as const
export type DockPosition = (typeof DOCK_POSITIONS)[number]

export const THEMES = ['lime', 'lavender'] as const
export type ThemeName = (typeof THEMES)[number]

/**
 * Как раскрываются пункты ветки в свёрнутом доке: `side` — отдельной
 * колонкой квадратиков рядом с доком, вниз от значка ветки; `inline` —
 * прямо внутри дока под значком, как раскрывающаяся панель (удобно на
 * маленьком экране).
 */
export const DOCK_SUB_MODES = ['side', 'inline'] as const
export type DockSubMode = (typeof DOCK_SUB_MODES)[number]

/**
 * Куда растёт док, когда внутри раскрывается ветка: `down` — только вниз
 * (у горизонтального — вправо), верх стоит на месте и пункт под мышью не
 * уезжает; `up` — только вверх (влево); `both` — в обе стороны от центра.
 * Не влезает — док прокручивается внутри, а не растёт дальше.
 */
export const DOCK_GROW = ['down', 'up', 'both'] as const
export type DockGrow = (typeof DOCK_GROW)[number]

/** Длина дока вдоль края: по содержимому или своя (лишнее прокручивается). */
export const DOCK_SIZE_MODES = ['auto', 'fixed'] as const
export type DockSizeMode = (typeof DOCK_SIZE_MODES)[number]
export const DOCK_SIZE_MIN = 200
export const DOCK_SIZE_MAX = 1400

/**
 * Ширина дока поперёк края (у горизонтального — высота): по содержимому или
 * своя. Своя не меняется ни при раскрытии веток, ни при подписях — значки
 * встают по центру.
 */
export const DOCK_WIDTH_MIN = 48
export const DOCK_WIDTH_MAX = 400

/**
 * Сдвигает ли док страницу: `none` — лежит поверх; `dock` — страница
 * отступает на ширину дока; `all` — и на колонку подпунктов, когда она открыта.
 */
export const DOCK_PUSH = ['none', 'dock', 'all'] as const
export type DockPush = (typeof DOCK_PUSH)[number]

export const SIDE_PANEL_MIN = 380
export const SIDE_PANEL_MAX = 1400

/**
 * Горячие клавиши. Хранятся коды клавиш (`KeyboardEvent.code`), а не символы:
 * в русской раскладке «S» печатает «ы», а код у физической клавиши один.
 * На действие можно повесить сколько угодно клавиш; одна клавиша — одно действие.
 *
 * Списки: вниз, вверх, открыть в панели, закрыть панель.
 * Меню (док): вверх и вниз по пунктам, открыть пункт (у ветки — раскрыть).
 */
export const HOTKEY_ACTIONS = ['down', 'up', 'open', 'close', 'menuUp', 'menuDown', 'menuActivate'] as const
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]
export type HotkeyBindings = Record<HotkeyAction, string[]>
export type Hotkeys = { enabled: boolean; bindings: HotkeyBindings }

export const DEFAULT_HOTKEYS: Hotkeys = {
  enabled: true,
  bindings: {
    down: ['KeyS'],
    up: ['KeyW'],
    open: ['KeyD'],
    close: ['KeyA'],
    menuUp: ['KeyQ'],
    menuDown: ['KeyE'],
    menuActivate: ['Enter', 'Space'],
  },
}

/** Какое действие висит на клавише (или null). */
export function hotkeyAction(hotkeys: Hotkeys, code: string): HotkeyAction | null {
  if (!hotkeys.enabled) return null
  return HOTKEY_ACTIONS.find((action) => hotkeys.bindings[action].includes(code)) ?? null
}

/** Подпись клавиши по её коду: KeyS → S, Digit1 → 1, ArrowDown → ↓. */
export function hotkeyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`
  const named: Record<string, string> = {
    ArrowDown: '↓',
    ArrowUp: '↑',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    Enter: 'Enter',
    NumpadEnter: 'Num Enter',
    Backspace: 'Backspace',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  }
  return named[code] ?? code
}

export type UiPreferences = {
  dock: DockPosition
  /** Развёрнутый док — с подписями. */
  dockExpanded: boolean
  /** Док спрятан целиком — висит только буква. */
  dockHidden: boolean
  /** Док появляется, только когда мышь подходит к его краю. */
  dockAutoHide: boolean
  dockSubMode: DockSubMode
  dockGrow: DockGrow
  dockSizeMode: DockSizeMode
  /** Своя длина дока вдоль края, px (при dockSizeMode = fixed). */
  dockSize: number
  dockWidthMode: DockSizeMode
  /** Своя ширина дока поперёк края, px (при dockWidthMode = fixed). */
  dockWidth: number
  dockPush: DockPush
  /**
   * Открытая справа панель записи отодвигает страницу (список виден рядом
   * с ней) — или ложится поверх, как в части SIEM.
   */
  sidePanelPush: boolean
  /** Ширину панели справа можно тянуть мышью за край. */
  sidePanelResizable: boolean
  sidePanelWidth: number
  hotkeys: Hotkeys
  theme: ThemeName
}

/** Буква в логотипе меняется вместе со схемой. */
export const THEME_LETTER: Record<ThemeName, string> = { lime: 'L', lavender: 'S' }

/** Совпадает с --background схемы: цвет панели браузера на телефоне. */
const THEME_BACKGROUND: Record<ThemeName, string> = { lime: '#08090c', lavender: '#0e0c15' }

/** Ключ читает и встроенный скрипт в index.html — менять в двух местах. */
const STORAGE_KEY = 'lp.ui'

/**
 * Версия формата. С версии 2 у умолчаний «ничего не сдвигать», а клавиши
 * хранятся списками — сохранённое раньше переводится при чтении.
 */
const VERSION = 2

/** Прежнее отдельное хранилище ширины панели справа. */
const LEGACY_PANEL_WIDTH_KEY = 'lp.sidePanel.width'

const DEFAULTS: UiPreferences = {
  dock: 'left',
  dockExpanded: false,
  dockHidden: false,
  dockAutoHide: false,
  dockSubMode: 'side',
  dockGrow: 'down',
  dockSizeMode: 'auto',
  dockSize: 560,
  dockWidthMode: 'auto',
  dockWidth: 64,
  dockPush: 'none',
  sidePanelPush: false,
  sidePanelResizable: true,
  sidePanelWidth: 600,
  hotkeys: DEFAULT_HOTKEYS,
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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback
}

function legacyPanelWidth(): number | undefined {
  try {
    const value = Number(localStorage.getItem(LEGACY_PANEL_WIDTH_KEY))
    return Number.isFinite(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** Разбор с откатом к умолчаниям: в хранилище может лежать что угодно. */
function parse(raw: string | null): UiPreferences {
  if (!raw) return { ...DEFAULTS, sidePanelWidth: clampNumber(legacyPanelWidth(), SIDE_PANEL_MIN, SIDE_PANEL_MAX, DEFAULTS.sidePanelWidth) }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const fresh = value.v === VERSION
    const flag = (key: 'dockExpanded' | 'dockHidden' | 'dockAutoHide' | 'sidePanelPush' | 'sidePanelResizable') =>
      typeof value[key] === 'boolean' ? (value[key] as boolean) : DEFAULTS[key]
    return {
      dock: oneOf(DOCK_POSITIONS, value.dock, DEFAULTS.dock),
      dockExpanded: flag('dockExpanded'),
      dockHidden: flag('dockHidden'),
      dockAutoHide: flag('dockAutoHide'),
      dockSubMode: oneOf(DOCK_SUB_MODES, value.dockSubMode, DEFAULTS.dockSubMode),
      dockGrow: oneOf(DOCK_GROW, value.dockGrow, DEFAULTS.dockGrow),
      dockSizeMode: oneOf(DOCK_SIZE_MODES, value.dockSizeMode, DEFAULTS.dockSizeMode),
      dockSize: clampNumber(value.dockSize, DOCK_SIZE_MIN, DOCK_SIZE_MAX, DEFAULTS.dockSize),
      dockWidthMode: oneOf(DOCK_SIZE_MODES, value.dockWidthMode, DEFAULTS.dockWidthMode),
      dockWidth: clampNumber(value.dockWidth, DOCK_WIDTH_MIN, DOCK_WIDTH_MAX, DEFAULTS.dockWidth),
      dockPush: oneOf(DOCK_PUSH, value.dockPush, DEFAULTS.dockPush),
      // До версии 2 «сдвигать» было умолчанием и сохранялось вместе со всем
      // остальным — это не выбор человека, поэтому берём новое умолчание.
      sidePanelPush: fresh ? flag('sidePanelPush') : DEFAULTS.sidePanelPush,
      sidePanelResizable: flag('sidePanelResizable'),
      sidePanelWidth: clampNumber(value.sidePanelWidth ?? legacyPanelWidth(), SIDE_PANEL_MIN, SIDE_PANEL_MAX, DEFAULTS.sidePanelWidth),
      hotkeys: parseHotkeys(value.hotkeys),
      theme: oneOf(THEMES, value.theme, DEFAULTS.theme),
    }
  } catch {
    return DEFAULTS
  }
}

const CODE_RE = /^[A-Za-z0-9]{2,24}$/

/**
 * Клавиши из хранилища. Формат версии 1 (одна клавиша на действие строкой)
 * переводится в списки; действия, которых тогда не было, получают умолчания.
 * Клавиша, оказавшаяся у двух действий, остаётся у первого.
 */
function parseHotkeys(raw: unknown): Hotkeys {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_HOTKEYS
  const value = raw as Record<string, unknown>
  const stored = (typeof value.bindings === 'object' && value.bindings !== null ? value.bindings : value) as Record<string, unknown>
  const used = new Set<string>()
  const bindings = {} as HotkeyBindings
  for (const action of HOTKEY_ACTIONS) {
    const entry = stored[action]
    const codes = Array.isArray(entry) ? entry : typeof entry === 'string' ? [entry] : DEFAULT_HOTKEYS.bindings[action]
    bindings[action] = codes.filter((code): code is string => typeof code === 'string' && CODE_RE.test(code) && !used.has(code))
    for (const code of bindings[action]) used.add(code)
  }
  return { enabled: typeof value.enabled === 'boolean' ? value.enabled : true, bindings }
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

/** Текущие настройки вне React — для обработчиков клавиатуры. */
export function getUiPreferences(): UiPreferences {
  return current
}

export function setUiPreferences(patch: Partial<UiPreferences>): void {
  const next = { ...current, ...patch }
  if (KEYS.every((key) => next[key] === current[key])) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, v: VERSION }))
  } catch {
    // Запись недоступна — настройка действует до закрытия вкладки.
  }
  applyTheme(next.theme)
  emit()
}

/** Вернуть всё как было по умолчанию (тема и язык не трогаются). */
export function resetUiPreferences(): void {
  setUiPreferences({ ...DEFAULTS, theme: current.theme })
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
