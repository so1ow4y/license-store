import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Grip, LogOut, Palette, Settings } from 'lucide-react'
import {
  LOCALES,
  LOCALE_NAMES,
  LOCALE_SHORT,
  setLocale,
  useLocale,
  useT,
} from '@/lib/i18n'
import {
  THEME_LETTER,
  getUiPreferences,
  hotkeyAction,
  type DockGrow,
  type DockPosition,
  type DockSizeMode,
  type DockSubMode,
  type ThemeName,
} from '@/lib/ui/preferences'
import { cn } from '@/lib/utils'
import { isTyping, overlayOpen } from '@/hooks/use-list-hotkeys'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { NavCollapsible, NavGroup, NavLink, NavTarget } from './types'

/**
 * Панель навигации в духе дока Ubuntu: плавающая плашка по центру выбранного
 * края. Всё вокруг неё прозрачно и не перехватывает клики.
 *
 * Три вида: `icon` — свёрнута, только значки с подсказками; `row` —
 * развёрнута у бокового края (значки с подписями и группами); `tile` —
 * развёрнута сверху или снизу (подписи под значками). Буква бренда прячет
 * док целиком (остаётся висеть одна буква), автоскрытие убирает его за край
 * до наведения мыши.
 *
 * Ветка (например, «Кабинет» или «Настройки») в свёрнутом доке раскрывается
 * подветкой из таких же квадратиков: отдельной колонкой рядом с доком, вниз
 * от значка ветки (`side`), или прямо внутри дока под значком (`inline`).
 * Клик по ветке только раскрывает и сворачивает подветку — страницу он не
 * открывает. Клики по квадратикам подветку не закрывают; открытая ветка
 * сменяется другой веткой или переходом на страницу из другой ветки.
 *
 * Куда растёт док при раскрытии ветки внутри него, задаётся настройкой
 * `grow`: по умолчанию только вниз — верх дока закреплён там, где стоял бы
 * свёрнутый док, и пункт под мышью не уезжает. Не влезает — док не растёт
 * дальше, а прокручивается внутри. Длина дока бывает по содержимому или своей.
 *
 * С клавиатуры (клавиши настраиваются, по умолчанию Q/E и Enter/Пробел):
 * вверх и вниз по пунктам, включая раскрытую подветку; Enter открывает пункт,
 * у ветки — раскрывает или сворачивает её. Мышью пункт открывается сразу.
 */

/** Отступ плашки от края экрана — p-3 обёртки. */
export const DOCK_EDGE_GAP = 12

/** Зазор подсказок и меню от пункта: пункт сидит внутри плашки на 7px от её края. */
const POPUP_OFFSET = 14

/** Зазор между доком и колонкой подветки. */
const STRIP_GAP = 8

type Mode = 'icon' | 'row' | 'tile'
type Side = 'left' | 'right' | 'top' | 'bottom'

/** Подсказки и меню раскрываются от края внутрь экрана. */
const INWARD: Record<DockPosition, Side> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
}

const WRAPPER: Record<DockPosition, string> = {
  left: 'inset-y-0 left-0',
  right: 'inset-y-0 right-0',
  top: 'inset-x-0 top-0',
  bottom: 'inset-x-0 bottom-0',
}

/** Где закреплён док вдоль края: сверху (растёт вниз), снизу (вверх) или по центру. */
const ALIGN: Record<'vertical' | 'horizontal', Record<DockGrow, string>> = {
  vertical: { down: 'items-start', up: 'items-end', both: 'items-center' },
  horizontal: { down: 'justify-start', up: 'justify-end', both: 'justify-center' },
}

/** Метка активного раздела — на стороне, обращённой к краю экрана. */
const INDICATOR: Record<DockPosition, string> = {
  left: '-left-1 top-1/2 h-5 w-1 -translate-y-1/2',
  right: '-right-1 top-1/2 h-5 w-1 -translate-y-1/2',
  top: '-top-1 left-1/2 h-1 w-5 -translate-x-1/2',
  bottom: '-bottom-1 left-1/2 h-1 w-5 -translate-x-1/2',
}

/** Колонка подветки стоит со стороны экрана, вплотную к доку. */
const STRIP_POSITION: Record<DockPosition, string> = {
  left: 'left-full ml-2 flex-col slide-in-from-left-2',
  right: 'right-full mr-2 flex-col slide-in-from-right-2',
  top: 'top-full mt-2 flex-row slide-in-from-top-2',
  bottom: 'bottom-full mb-2 flex-row slide-in-from-bottom-2',
}

const ITEM_BASE =
  'relative flex shrink-0 items-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-primary/15 data-[active=true]:text-primary'

/** Боковой свёрнутый док на невысоком экране чуть плотнее, чтобы админский набор влез без прокрутки. */
const DENSE_ON_SHORT_SCREENS = '[@media(781px<=height<=860px)]:size-9 [@media(height<781px)]:size-8'

/**
 * Квадратик подпункта внутри дока. Группа подпунктов добавляет 2px отступа и
 * рамку с каждой стороны, поэтому квадратик ровно на 4px меньше значка
 * основной ветки на том же экране — иначе раскрытая ветка распирала бы док
 * вширь (на невысоком экране значки ужимаются, а подпункты — нет).
 */
const COMPACT_ITEM = 'size-9 [@media(781px<=height<=860px)]:size-8 [@media(height<781px)]:size-7'

const ITEM: Record<Mode, string> = {
  icon: 'size-10 justify-center',
  row: 'h-10 w-full gap-3 px-3 text-sm',
  tile: 'h-[4.5rem] w-20 flex-col justify-center gap-1 px-1 text-[11px] leading-tight',
}

const ICON: Record<Mode, string> = {
  icon: 'size-[22px]',
  row: 'size-5',
  tile: 'size-[22px]',
}

const LABEL: Record<Mode, string> = {
  icon: 'sr-only',
  row: 'min-w-0 flex-1 truncate text-start',
  tile: 'line-clamp-2 max-w-full text-center break-words',
}

type Ctx = {
  mode: Mode
  /** Классы размера пункта для текущего вида. */
  item: string
  position: DockPosition
  side: Side
  vertical: boolean
  pathname: string
  /** Открытая вкладка страницы (`?tab=`), чтобы подсветить нужный пункт ветки. */
  tab: string | undefined
  subMode: DockSubMode
  /** Ветка, чья подветка сейчас раскрыта. */
  openBranch: string | null
  onNavigate: () => void
  toggleBranch: (item: NavCollapsible) => void
  setOpenBranch: (title: string | null) => void
  registerBranch: (title: string, el: HTMLElement | null) => void
}

export type DockProps = {
  position: DockPosition
  expanded: boolean
  /** Спрятан целиком: на краю висит только буква. */
  hidden: boolean
  /** Выезжает, только когда мышь подходит к краю экрана. */
  autoHide: boolean
  subMode: DockSubMode
  /** Куда растёт док при раскрытии ветки внутри него. */
  grow: DockGrow
  sizeMode: DockSizeMode
  /** Своя длина вдоль края, px (при sizeMode = fixed). */
  size: number
  /** Своя ширина поперёк края, px; null — по содержимому. */
  thickness: number | null
  theme: ThemeName
  groups: NavGroup[]
  username: string
  onToggle: () => void
  onToggleHidden: () => void
  onNavigate: () => void
  onLogout: () => void
  /**
   * Толщина дока вместе с отступом от края и толщина открытой колонки
   * подпунктов (0, если её нет): каркас решает, сколько из этого отдать
   * под отступ страницы.
   */
  onSize: (dock: number, strip: number) => void
}

/** Пункт дока для навигации с клавиатуры — в том порядке, в каком виден. */
type DockEntry =
  | { key: string; kind: 'branch'; branch: NavCollapsible; active: boolean }
  | { key: string; kind: 'link'; target: NavTarget; active: boolean }

/** Куда уезжает спрятанный док в режиме автоскрытия. */
const SLIDE_AWAY: Record<DockPosition, string> = {
  left: '-translate-x-[calc(100%+4px)]',
  right: 'translate-x-[calc(100%+4px)]',
  top: '-translate-y-[calc(100%+4px)]',
  bottom: 'translate-y-[calc(100%+4px)]',
}

/** Полоска у края, на которую реагирует автоскрытие. */
const HOT_ZONE: Record<DockPosition, string> = {
  left: 'inset-y-0 left-0 w-2',
  right: 'inset-y-0 right-0 w-2',
  top: 'inset-x-0 top-0 h-2',
  bottom: 'inset-x-0 bottom-0 h-2',
}

/** Задержка перед тем, как отпущенный мышью док уедет. */
const AUTO_HIDE_DELAY_MS = 400

export function Dock({
  position,
  expanded,
  hidden,
  autoHide,
  subMode,
  grow,
  sizeMode,
  size,
  thickness,
  theme,
  groups,
  username,
  onToggle,
  onToggleHidden,
  onNavigate,
  onLogout,
  onSize,
}: DockProps) {
  const t = useT()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const tab = useLocation({
    select: (location) => {
      const value = (location.search as Record<string, unknown>).tab
      return typeof value === 'string' ? value : undefined
    },
  })
  const innerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const branchEls = useRef(new Map<string, HTMLElement>())
  const hideTimer = useRef<number | undefined>(undefined)
  const [revealed, setRevealed] = useState(false)
  const [stripOffset, setStripOffset] = useState(0)
  /** Отступ закреплённого края дока от края экрана вдоль оси (для grow = down/up). */
  const [anchorOffset, setAnchorOffset] = useState(0)
  const vertical = position === 'left' || position === 'right'
  const mode: Mode = hidden ? 'icon' : !expanded ? 'icon' : vertical ? 'row' : 'tile'
  const item = cn(ITEM[mode], vertical && mode === 'icon' && DENSE_ON_SHORT_SCREENS)
  const slidOut = autoHide && !hidden && !revealed

  const branches = useMemo(
    () => groups.flatMap((g) => g.items.filter((i): i is NavCollapsible => Boolean(i.items))),
    [groups]
  )
  /** Состав меню строкой: меню пересобирается на каждый рендер, а меняется редко. */
  const menuKey = groups.map((g) => g.items.map((i) => i.title).join(',')).join('|')
  // Ветка открытой страницы и пункт в ней.
  const routeTarget = useMemo(() => {
    for (const branch of branches) {
      const sub = branch.items.find((s) => targetMatches(pathname, tab, s)) ?? branch.items.find((s) => pathMatches(pathname, s))
      if (sub) return { branch: branch.title, sub }
    }
    return null
  }, [branches, pathname, tab])

  const [openBranch, setOpenBranch] = useState<string | null>(routeTarget?.branch ?? null)

  // Подветка следует за страницей: перешли по ссылке в другую ветку — она и
  // раскрыта. Зависимости — строки, а не объект: меню пересобирается на каждый
  // рендер, и эффект иначе отменял бы ручное сворачивание ветки.
  const routeBranch = routeTarget?.branch ?? null
  const routeKey = routeTarget ? `${routeTarget.branch}/${routeTarget.sub.title}` : null
  useEffect(() => {
    if (routeBranch) setOpenBranch(routeBranch)
  }, [routeBranch, routeKey])

  const openItem = branches.find((b) => b.title === openBranch) ?? null
  const showStrip = !hidden && openItem !== null && (mode === 'tile' || (mode === 'icon' && subMode === 'side'))

  /** Клик по ветке: раскрыть её подветку или свернуть уже раскрытую. Страница не меняется. */
  function toggleBranch(branch: NavCollapsible) {
    setOpenBranch((current) => (current === branch.title ? null : branch.title))
  }

  const ctx: Ctx = {
    mode,
    item,
    position,
    side: INWARD[position],
    vertical,
    pathname,
    tab,
    subMode,
    openBranch,
    onNavigate,
    toggleBranch,
    setOpenBranch,
    registerBranch: (title, el) => {
      if (el) branchEls.current.set(title, el)
      else branchEls.current.delete(title)
    },
  }

  // Толщина дока и колонки подветки — каркас решает, сдвигать ли под них страницу.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const report = () => {
      const strip = showStrip ? stripRef.current : null
      const own = vertical ? panel.offsetWidth : panel.offsetHeight
      const extra = strip ? (vertical ? strip.offsetWidth : strip.offsetHeight) + STRIP_GAP : 0
      onSize(own + DOCK_EDGE_GAP, extra)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(panel)
    if (showStrip && stripRef.current) observer.observe(stripRef.current)
    return () => observer.disconnect()
  }, [vertical, onSize, hidden, showStrip, openBranch])

  // Закреплённый край. Док «по содержимому» ставится так, будто ни одна ветка
  // внутри не раскрыта и он стоит по центру; раскрытая ветка добавляет длину
  // только в сторону роста, а то, что не влезло, прокручивается внутри.
  useLayoutEffect(() => {
    if (grow === 'both' || hidden) {
      setAnchorOffset(0)
      return
    }
    const compute = () => {
      const nav = panelRef.current
      if (!nav) return
      const available = (vertical ? window.innerHeight : window.innerWidth) - 2 * DOCK_EDGE_GAP
      let base: number
      if (sizeMode === 'fixed') {
        base = Math.min(size, available)
      } else {
        const full = (vertical ? nav.scrollHeight : nav.scrollWidth) + 2
        const inline = nav.querySelector<HTMLElement>('[data-dock-inline]')
        const extra = inline ? (vertical ? inline.offsetHeight : inline.offsetWidth) + 2 : 0
        base = Math.min(full - extra, available)
      }
      setAnchorOffset(Math.max(0, Math.round((available - base) / 2)))
    }
    compute()
    const observer = new ResizeObserver(compute)
    if (panelRef.current) observer.observe(panelRef.current)
    window.addEventListener('resize', compute)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [grow, hidden, vertical, sizeMode, size, mode, subMode, openBranch, menuKey])

  // Пункты в порядке показа: ветка, за ней её раскрытые подпункты.
  const entries = useMemo(() => {
    const list: DockEntry[] = []
    for (const group of groups) {
      for (const item of group.items) {
        if (item.items) {
          list.push({
            key: `b:${item.title}`,
            kind: 'branch',
            branch: item,
            active: item.items.some((sub) => pathMatches(pathname, sub)),
          })
          if (openBranch === item.title) {
            for (const sub of item.items) {
              list.push({ key: subKey(item.title, sub.title), kind: 'link', target: sub, active: targetMatches(pathname, tab, sub) })
            }
          }
        } else {
          const active = item.search ? targetMatches(pathname, tab, item) : pathMatches(pathname, item)
          list.push({ key: `l:${item.title}`, kind: 'link', target: item, active })
        }
      }
    }
    return list
  }, [groups, openBranch, pathname, tab])
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // Клавиатура: вверх/вниз по пунктам, открыть пункт (ветку — раскрыть).
  // «Открыть» работает только когда фокус на пункте дока — иначе Enter и
  // Пробел остаются за страницей.
  useEffect(() => {
    if (hidden) return
    const focusEntry = (key: string) => {
      const apply = () => {
        const el = document.querySelector<HTMLElement>(`[data-dock-key="${CSS.escape(key)}"]`)
        if (!el) return false
        el.focus()
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        return true
      }
      // Пункт подветки мог ещё не отрисоваться — тогда со следующего такта.
      if (!apply()) window.setTimeout(apply, 0)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target) || overlayOpen()) return
      const action = hotkeyAction(getUiPreferences().hotkeys, event.code)
      if (action !== 'menuUp' && action !== 'menuDown' && action !== 'menuActivate') return
      const list = entriesRef.current
      const focusedKey =
        (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-dock-key]')?.dataset.dockKey ?? null

      if (action === 'menuActivate') {
        const entry = list.find((e) => e.key === focusedKey)
        if (!entry) return
        event.preventDefault()
        if (entry.kind === 'branch') {
          setOpenBranch((current) => (current === entry.branch.title ? null : entry.branch.title))
          focusEntry(entry.key)
        } else {
          void navigate({ to: entry.target.url as never, search: (entry.target.search ?? {}) as never })
          onNavigate()
        }
        return
      }

      if (list.length === 0) return
      event.preventDefault()
      if (autoHide) reveal()
      const index = focusedKey ? list.findIndex((e) => e.key === focusedKey) : -1
      let next: number
      if (index < 0) {
        // Первое нажатие встаёт на пункт открытой страницы.
        const active = list.findIndex((e) => e.kind === 'link' && e.active)
        next = active >= 0 ? active : action === 'menuDown' ? 0 : list.length - 1
      } else {
        next = Math.max(0, Math.min(list.length - 1, index + (action === 'menuDown' ? 1 : -1)))
      }
      focusEntry(list[next]!.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, autoHide, navigate, onNavigate])

  // Колонка подветки начинается вровень со значком ветки и уходит вниз
  // (у горизонтального дока — вправо), не вылезая за экран.
  useLayoutEffect(() => {
    if (!showStrip || !openBranch) return
    const place = () => {
      const inner = innerRef.current
      const strip = stripRef.current
      const anchor = branchEls.current.get(openBranch)
      if (!inner || !strip || !anchor) return
      const box = inner.getBoundingClientRect()
      const at = anchor.getBoundingClientRect()
      // 6px — внутренний отступ колонки: первый квадратик встаёт ровно напротив значка.
      if (vertical) {
        const max = window.innerHeight - DOCK_EDGE_GAP - box.top - strip.offsetHeight
        setStripOffset(Math.max(DOCK_EDGE_GAP - box.top, Math.min(at.top - box.top - 6, max)))
      } else {
        const max = window.innerWidth - DOCK_EDGE_GAP - box.left - strip.offsetWidth
        setStripOffset(Math.max(DOCK_EDGE_GAP - box.left, Math.min(at.left - box.left - 6, max)))
      }
    }
    place()
    const observer = new ResizeObserver(place)
    if (stripRef.current) observer.observe(stripRef.current)
    if (innerRef.current) observer.observe(innerRef.current)
    const panel = panelRef.current
    window.addEventListener('resize', place)
    panel?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      panel?.removeEventListener('scroll', place)
    }
  }, [showStrip, openBranch, vertical, position])

  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  function reveal() {
    window.clearTimeout(hideTimer.current)
    setRevealed(true)
  }

  /** Уезжаем, только если не открыто меню пользователя или подменю. */
  function scheduleHide() {
    if (!autoHide) return
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      const menuOpen = innerRef.current?.querySelector('[data-slot="dropdown-menu-trigger"][data-state="open"]')
      if (menuOpen) scheduleHide()
      else setRevealed(false)
    }, AUTO_HIDE_DELAY_MS)
  }

  const toggleLabel = expanded ? t('dock.collapse') : t('dock.expand')
  const letterLabel = hidden ? t('dock.show') : t('dock.hide')

  const letter = (
    <Hint show={mode === 'icon'} label={letterLabel} side={ctx.side}>
      <button
        type='button'
        onClick={onToggleHidden}
        aria-label={letterLabel}
        aria-pressed={hidden}
        className={cn(ITEM_BASE, item, 'hover:bg-transparent')}
      >
        <span className='flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground transition-transform hover:scale-105'>
          {THEME_LETTER[theme]}
        </span>
        <span className={cn(LABEL[mode], 'font-semibold text-foreground')}>{t('shell.brand')}</span>
      </button>
    </Hint>
  )

  if (hidden) {
    return (
      <div className={cn('pointer-events-none fixed z-40 flex p-3', WRAPPER[position], ALIGN[vertical ? 'vertical' : 'horizontal'].both)}>
        <nav
          ref={panelRef}
          aria-label={t('dock.label')}
          className='pointer-events-auto flex rounded-2xl border bg-card/70 p-1 shadow-lg shadow-black/30 backdrop-blur-md'
        >
          {letter}
        </nav>
      </div>
    )
  }

  const hoverHandlers = autoHide
    ? { onMouseEnter: reveal, onMouseLeave: scheduleHide, onFocus: reveal, onBlur: scheduleHide }
    : {}

  // Закреплённый край: отступ с нужной стороны и потолок длины на остаток экрана.
  const anchorStyle: CSSProperties =
    grow === 'both'
      ? {}
      : vertical
        ? { [grow === 'down' ? 'marginTop' : 'marginBottom']: anchorOffset, maxHeight: `calc(100% - ${anchorOffset}px)` }
        : { [grow === 'down' ? 'marginLeft' : 'marginRight']: anchorOffset, maxWidth: `calc(100% - ${anchorOffset}px)` }
  // Своя длина: плашка не короче и не длиннее заданного, лишнее прокручивается.
  // Своя ширина: не меняется ни от раскрытых веток, ни от подписей.
  const sizeStyle: CSSProperties = {
    ...(sizeMode === 'fixed' ? (vertical ? { height: size } : { width: size }) : {}),
    ...(thickness !== null ? (vertical ? { width: thickness } : { height: thickness }) : {}),
  }

  return (
    <>
      {autoHide && (
        <div aria-hidden className={cn('fixed z-40', HOT_ZONE[position])} onMouseEnter={reveal} />
      )}
      <div
        className={cn(
          'pointer-events-none fixed z-40 flex p-3 transition-transform duration-200 ease-out',
          WRAPPER[position],
          ALIGN[vertical ? 'vertical' : 'horizontal'][grow],
          slidOut && SLIDE_AWAY[position]
        )}
      >
        <div
          ref={innerRef}
          style={anchorStyle}
          className={cn('relative flex', vertical ? 'max-h-full flex-col' : 'max-w-full flex-row')}
        >
          <nav
            ref={panelRef}
            aria-label={t('dock.label')}
            {...hoverHandlers}
            style={sizeStyle}
            className={cn(
              'no-scrollbar pointer-events-auto flex rounded-2xl border bg-card/85 p-1.5 shadow-xl shadow-black/40 backdrop-blur-md',
              mode === 'icon' ? 'gap-0.5' : 'gap-1',
              vertical
                ? 'max-h-full min-h-0 flex-col overflow-y-auto'
                : 'max-w-full min-w-0 flex-row items-center overflow-x-auto',
              vertical && (mode === 'row' ? 'w-64' : 'items-center')
            )}
          >
            {letter}

            {groups.map((group) => (
              <div
                key={group.title}
                className={cn(
                  'flex',
                  mode === 'icon' ? 'gap-0.5' : 'gap-1',
                  vertical ? 'w-full flex-col' : 'flex-row items-center',
                  vertical && mode === 'icon' && 'items-center'
                )}
              >
                {mode === 'row' ? (
                  <div className='px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground/80'>
                    {group.title}
                  </div>
                ) : (
                  <Divider vertical={vertical} />
                )}
                {group.items.map((item) =>
                  item.items ? (
                    <DockBranch key={item.title} item={item} ctx={ctx} />
                  ) : (
                    <DockLink key={item.title} item={item} ctx={ctx} />
                  )
                )}
              </div>
            ))}

            <Divider vertical={vertical} />
            <LocaleItem ctx={ctx} />
            <UserMenu ctx={ctx} username={username} onLogout={onLogout} />

            <Hint show={mode === 'icon'} label={toggleLabel} side={ctx.side}>
              <button
                type='button'
                onClick={onToggle}
                aria-expanded={expanded}
                className={cn(ITEM_BASE, item)}
              >
                <Grip className={cn('shrink-0', ICON[mode])} aria-hidden />
                <span className={LABEL[mode]}>{toggleLabel}</span>
              </button>
            </Hint>
          </nav>

          {showStrip && openItem && (
            <div
              ref={stripRef}
              role='group'
              aria-label={openItem.title}
              {...hoverHandlers}
              style={vertical ? { top: stripOffset } : { left: stripOffset }}
              className={cn(
                'pointer-events-auto absolute flex animate-in items-center gap-0.5 rounded-2xl border bg-card/85 p-1.5 shadow-xl shadow-black/40 backdrop-blur-md duration-150 fade-in-0',
                STRIP_POSITION[position]
              )}
            >
              {openItem.items.map((sub) => (
                <SubLink key={sub.title} item={sub} branch={openItem.title} ctx={ctx} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Пункты                                                               */
/* ------------------------------------------------------------------ */

/** Ключ подпункта для навигации с клавиатуры (атрибут data-dock-key). */
function subKey(branch: string, title: string): string {
  return `s:${branch}:${title}`
}

function isActive(pathname: string, url: string, exact = false): boolean {
  if (url === '/' || exact) return pathname === url || pathname === `${url}/`
  return pathname === url || pathname.startsWith(`${url}/`)
}

/** Открыта страница пункта — по адресу или по префиксу `match`, без учёта вкладки. */
function pathMatches(pathname: string, target: NavTarget): boolean {
  return isActive(pathname, target.url as string, target.exact) || Boolean(target.match && isActive(pathname, target.match))
}

/**
 * Пункт ветки активен, если совпал адрес и вкладка: «Ключи» (`?tab=keys`)
 * и «Обзор» (без вкладки) ведут на одну страницу, но подсвечиваться должен
 * один из них.
 */
function targetMatches(pathname: string, tab: string | undefined, target: NavTarget): boolean {
  if (target.match && isActive(pathname, target.match)) return true
  if (!isActive(pathname, target.url as string, target.exact)) return false
  return (target.search?.tab ?? undefined) === tab
}

/** Подсказка нужна только свёрнутой панели: в развёрнутой подпись и так видна. */
function Hint({
  show,
  label,
  side,
  children,
}: {
  show: boolean
  label: string
  side: Side
  children: ReactElement
}) {
  if (!show) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={POPUP_OFFSET}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function Divider({ vertical }: { vertical: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'shrink-0 self-center bg-border',
        vertical ? 'my-1 h-px w-7' : 'mx-1 h-7 w-px'
      )}
    />
  )
}

function Indicator({ position }: { position: DockPosition }) {
  return (
    <span aria-hidden className={cn('absolute rounded-full bg-primary', INDICATOR[position])} />
  )
}

/** Пункт основной ветки без подпунктов: переход на него закрывает раскрытую подветку. */
function DockLink({ item, ctx }: { item: NavLink; ctx: Ctx }) {
  const active = item.search ? targetMatches(ctx.pathname, ctx.tab, item) : pathMatches(ctx.pathname, item)
  const Icon = item.icon
  return (
    <Hint show={ctx.mode === 'icon'} label={item.title} side={ctx.side}>
      <Link
        to={item.url}
        search={item.search as never}
        onClick={() => {
          ctx.setOpenBranch(null)
          ctx.onNavigate()
        }}
        data-dock-key={`l:${item.title}`}
        data-active={active}
        aria-current={active ? 'page' : undefined}
        className={cn(ITEM_BASE, ctx.item)}
      >
        {active && <Indicator position={ctx.position} />}
        {Icon && <Icon className={cn('shrink-0', ICON[ctx.mode])} aria-hidden />}
        <span className={LABEL[ctx.mode]}>{item.title}</span>
      </Link>
    </Hint>
  )
}

/** Квадратик подветки — в колонке рядом с доком или внутри дока под значком ветки. */
function SubLink({
  item,
  branch,
  ctx,
  compact,
}: {
  item: NavCollapsible['items'][number]
  branch: string
  ctx: Ctx
  compact?: boolean
}) {
  const active = targetMatches(ctx.pathname, ctx.tab, item)
  const Icon = item.icon
  // В колонке рядом с горизонтальным доком подписи под значками, как у самого дока.
  const mode: Mode = ctx.mode === 'tile' && !compact ? 'tile' : 'icon'
  return (
    <Hint show={mode === 'icon'} label={item.title} side={ctx.side}>
      <Link
        to={item.url}
        search={item.search as never}
        onClick={ctx.onNavigate}
        data-dock-key={subKey(branch, item.title)}
        data-active={active}
        aria-current={active ? 'page' : undefined}
        className={cn(ITEM_BASE, ITEM[mode], compact && COMPACT_ITEM)}
      >
        {Icon && <Icon className={cn('shrink-0', compact ? 'size-[18px]' : ICON[mode])} aria-hidden />}
        <span className={LABEL[mode]}>{item.title}</span>
      </Link>
    </Hint>
  )
}

/**
 * Ветка основной панели. Клик раскрывает или сворачивает её подветку —
 * квадратиками в свёрнутом доке, списком с подписями в развёрнутом боковом.
 * Сама ветка страницу не открывает.
 */
function DockBranch({ item, ctx }: { item: NavCollapsible; ctx: Ctx }) {
  // Ветка подсвечена, если открыта любая её страница (любая вкладка).
  const active = item.items.some((sub) => pathMatches(ctx.pathname, sub))
  const open = ctx.openBranch === item.title
  const Icon = item.icon
  const content = (
    <>
      {active && <Indicator position={ctx.position} />}
      {Icon && <Icon className={cn('shrink-0', ICON[ctx.mode])} aria-hidden />}
      <span className={LABEL[ctx.mode]}>{item.title}</span>
    </>
  )

  if (ctx.mode === 'row') {
    return (
      <Collapsible
        open={open}
        onOpenChange={(value) => ctx.setOpenBranch(value ? item.title : null)}
        className='group/collapsible w-full'
      >
        <CollapsibleTrigger data-dock-key={`b:${item.title}`} data-active={active} className={cn(ITEM_BASE, ITEM.row)}>
          {content}
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90' />
        </CollapsibleTrigger>
        <CollapsibleContent className='CollapsibleContent'>
          <div className='ms-5 mt-1 flex flex-col gap-0.5 border-s ps-2'>
            {item.items.map((sub) => {
              const subActive = targetMatches(ctx.pathname, ctx.tab, sub)
              const SubIcon = sub.icon
              return (
                <Link
                  key={sub.title}
                  to={sub.url}
                  search={sub.search as never}
                  onClick={ctx.onNavigate}
                  data-dock-key={subKey(item.title, sub.title)}
                  data-active={subActive}
                  aria-current={subActive ? 'page' : undefined}
                  className={cn(ITEM_BASE, 'h-9 w-full gap-2 px-3 text-sm')}
                >
                  {SubIcon && <SubIcon className='size-4 shrink-0' aria-hidden />}
                  <span className='truncate'>{sub.title}</span>
                </Link>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  const inline = ctx.mode === 'icon' && ctx.subMode === 'inline' && open
  const button = (
    <Hint show={ctx.mode === 'icon'} label={item.title} side={ctx.side}>
      <button
        ref={(el) => ctx.registerBranch(item.title, el)}
        type='button'
        data-dock-key={`b:${item.title}`}
        data-active={active || open}
        aria-expanded={open}
        onClick={() => ctx.toggleBranch(item)}
        className={cn(ITEM_BASE, ctx.item)}
      >
        {content}
      </button>
    </Hint>
  )
  if (!inline) return button

  // Раскрывающаяся панель: подпункты прямо в доке, под значком ветки.
  return (
    <>
      {button}
      <div
        role='group'
        aria-label={item.title}
        data-dock-inline
        className={cn(
          'flex shrink-0 animate-in items-center gap-0.5 rounded-xl bg-muted/60 p-0.5 ring-1 ring-border duration-150 fade-in-0',
          ctx.vertical ? 'flex-col slide-in-from-top-1' : 'flex-row slide-in-from-left-1'
        )}
      >
        {item.items.map((sub) => (
          <SubLink key={sub.title} item={sub} branch={item.title} ctx={ctx} compact />
        ))}
      </div>
    </>
  )
}

/**
 * Язык виден на любом экране, как раньше в шапке: тот, кто не читает текущий
 * язык интерфейса, должен найти выход без меню и настроек.
 */
function LocaleItem({ ctx }: { ctx: Ctx }) {
  const t = useT()
  const locale = useLocale()

  if (ctx.mode === 'row') {
    return <LocaleSwitcher className='mx-1 my-1 justify-between' />
  }

  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]
  const label = t('locale.switcher.option', { language: LOCALE_NAMES[next] })
  return (
    <Hint show={ctx.mode === 'icon'} label={label} side={ctx.side}>
      <button
        type='button'
        onClick={() => setLocale(next)}
        aria-label={label}
        className={cn(ITEM_BASE, ctx.item)}
      >
        <span
          lang={locale}
          className='flex h-[22px] min-w-[26px] shrink-0 items-center justify-center rounded-md border px-1 text-[11px] font-semibold'
        >
          {LOCALE_SHORT[locale]}
        </span>
        {ctx.mode === 'tile' && <span className={LABEL.tile}>{t('locale.switcher.label')}</span>}
      </button>
    </Hint>
  )
}

function UserMenu({
  ctx,
  username,
  onLogout,
}: {
  ctx: Ctx
  username: string
  onLogout: () => void
}) {
  const t = useT()
  return (
    <DropdownMenu>
      <Hint show={ctx.mode === 'icon'} label={username} side={ctx.side}>
        <DropdownMenuTrigger className={cn(ITEM_BASE, ctx.item)}>
          <Avatar className='size-8 shrink-0'>
            <AvatarFallback className='bg-secondary text-xs font-medium text-foreground'>
              {username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className={LABEL[ctx.mode]}>{username}</span>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side={ctx.side} align='center' sideOffset={POPUP_OFFSET} className='min-w-52'>
        <DropdownMenuLabel className='truncate'>{username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to='/settings/profile' onClick={ctx.onNavigate}>
            <Settings />
            {t('nav.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to='/settings/appearance' onClick={ctx.onNavigate}>
            <Palette />
            {t('nav.appearance')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant='destructive' onSelect={onLogout}>
          <LogOut />
          {t('shell.action.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
