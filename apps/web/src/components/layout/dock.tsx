import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight, Grip, LogOut, Palette, Settings } from 'lucide-react'
import {
  LOCALES,
  LOCALE_NAMES,
  LOCALE_SHORT,
  setLocale,
  useLocale,
  useT,
} from '@/lib/i18n'
import { THEME_LETTER, type DockPosition, type ThemeName } from '@/lib/ui/preferences'
import { cn } from '@/lib/utils'
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
 */

/** Отступ плашки от края экрана — p-3 обёртки. */
export const DOCK_EDGE_GAP = 12

/** Зазор подсказок и меню от пункта: пункт сидит внутри плашки на 7px от её края. */
const POPUP_OFFSET = 14

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
  left: 'inset-y-0 left-0 items-center',
  right: 'inset-y-0 right-0 items-center',
  top: 'inset-x-0 top-0 justify-center',
  bottom: 'inset-x-0 bottom-0 justify-center',
}

/** Метка активного раздела — на стороне, обращённой к краю экрана. */
const INDICATOR: Record<DockPosition, string> = {
  left: '-left-1 top-1/2 h-5 w-1 -translate-y-1/2',
  right: '-right-1 top-1/2 h-5 w-1 -translate-y-1/2',
  top: '-top-1 left-1/2 h-1 w-5 -translate-x-1/2',
  bottom: '-bottom-1 left-1/2 h-1 w-5 -translate-x-1/2',
}

const ITEM_BASE =
  'relative flex shrink-0 items-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-primary/15 data-[active=true]:text-primary'

/** Боковой свёрнутый док на невысоком экране чуть плотнее, чтобы админский набор влез без прокрутки. */
const DENSE_ON_SHORT_SCREENS = '[@media(781px<=height<=860px)]:size-9 [@media(height<781px)]:size-8'

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
  pathname: string
  /** Открытая вкладка страницы (`?tab=`), чтобы подсветить нужный пункт ветки. */
  tab: string | undefined
  onNavigate: () => void
}

export type DockProps = {
  position: DockPosition
  expanded: boolean
  /** Спрятан целиком: на краю висит только буква. */
  hidden: boolean
  /** Выезжает, только когда мышь подходит к краю экрана. */
  autoHide: boolean
  theme: ThemeName
  groups: NavGroup[]
  username: string
  onToggle: () => void
  onToggleHidden: () => void
  onNavigate: () => void
  onLogout: () => void
  /** Толщина дока вместе с отступом от края: столько места резервирует страница. */
  onSize: (size: number) => void
}

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
  const pathname = useLocation({ select: (location) => location.pathname })
  const tab = useLocation({
    select: (location) => {
      const value = (location.search as Record<string, unknown>).tab
      return typeof value === 'string' ? value : undefined
    },
  })
  const panelRef = useRef<HTMLElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const [revealed, setRevealed] = useState(false)
  const vertical = position === 'left' || position === 'right'
  const mode: Mode = hidden ? 'icon' : !expanded ? 'icon' : vertical ? 'row' : 'tile'
  const item = cn(ITEM[mode], vertical && mode === 'icon' && DENSE_ON_SHORT_SCREENS)
  const ctx: Ctx = { mode, item, position, side: INWARD[position], pathname, tab, onNavigate }
  const slidOut = autoHide && !hidden && !revealed

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const report = () =>
      onSize((vertical ? panel.offsetWidth : panel.offsetHeight) + DOCK_EDGE_GAP)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [vertical, onSize, hidden])

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
      const menuOpen = panelRef.current?.querySelector('[data-slot="dropdown-menu-trigger"][data-state="open"]')
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
      <div className={cn('pointer-events-none fixed z-40 flex p-3', WRAPPER[position])}>
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

  return (
    <>
      {autoHide && (
        <div aria-hidden className={cn('fixed z-40', HOT_ZONE[position])} onMouseEnter={reveal} />
      )}
      <div
        className={cn(
          'pointer-events-none fixed z-40 flex p-3 transition-transform duration-200 ease-out',
          WRAPPER[position],
          slidOut && SLIDE_AWAY[position]
        )}
      >
      <nav
        ref={panelRef}
        aria-label={t('dock.label')}
        onMouseEnter={autoHide ? reveal : undefined}
        onMouseLeave={autoHide ? scheduleHide : undefined}
        onFocus={autoHide ? reveal : undefined}
        onBlur={autoHide ? scheduleHide : undefined}
        className={cn(
          'no-scrollbar pointer-events-auto flex rounded-2xl border bg-card/85 p-1.5 shadow-xl shadow-black/40 backdrop-blur-md',
          mode === 'icon' ? 'gap-0.5' : 'gap-1',
          vertical
            ? 'max-h-full flex-col overflow-y-auto'
            : 'max-w-full flex-row items-center overflow-x-auto',
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
                <DockMenu key={item.title} item={item} ctx={ctx} />
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
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Пункты                                                               */
/* ------------------------------------------------------------------ */

function isActive(pathname: string, url: string): boolean {
  if (url === '/') return pathname === '/'
  return pathname === url || pathname.startsWith(`${url}/`)
}

/**
 * Пункт ветки активен, если совпал адрес и вкладка: «Ключи» (`?tab=keys`)
 * и «Обзор» (без вкладки) ведут на одну страницу, но подсвечиваться должен
 * один из них.
 */
function isTargetActive(ctx: Ctx, target: NavTarget): boolean {
  if (!isActive(ctx.pathname, target.url as string)) return false
  return (target.search?.tab ?? undefined) === ctx.tab
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

function DockLink({ item, ctx }: { item: NavLink; ctx: Ctx }) {
  const active = item.search ? isTargetActive(ctx, item) : isActive(ctx.pathname, item.url as string)
  const Icon = item.icon
  return (
    <Hint show={ctx.mode === 'icon'} label={item.title} side={ctx.side}>
      <Link
        to={item.url}
        search={item.search as never}
        onClick={ctx.onNavigate}
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

/**
 * Пункт с подменю. В боковой развёрнутой панели раскрывается на месте,
 * в остальных видах — выпадающим меню от края внутрь.
 */
function DockMenu({ item, ctx }: { item: NavCollapsible; ctx: Ctx }) {
  // Ветка подсвечена, если открыта любая её страница (любая вкладка).
  const active = item.items.some((sub) => isActive(ctx.pathname, sub.url as string))
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
      <Collapsible defaultOpen={active} className='group/collapsible w-full'>
        <CollapsibleTrigger data-active={active} className={cn(ITEM_BASE, ITEM.row)}>
          {content}
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90' />
        </CollapsibleTrigger>
        <CollapsibleContent className='CollapsibleContent'>
          <div className='ms-5 mt-1 flex flex-col gap-0.5 border-s ps-2'>
            {item.items.map((sub) => {
              const subActive = isTargetActive(ctx, sub)
              const SubIcon = sub.icon
              return (
                <Link
                  key={sub.title}
                  to={sub.url}
                  search={sub.search as never}
                  onClick={ctx.onNavigate}
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

  return (
    <DropdownMenu>
      <Hint show={ctx.mode === 'icon'} label={item.title} side={ctx.side}>
        <DropdownMenuTrigger data-active={active} className={cn(ITEM_BASE, ctx.item)}>
          {content}
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side={ctx.side} align='center' sideOffset={POPUP_OFFSET} className='min-w-48'>
        <DropdownMenuLabel>{item.title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {item.items.map((sub) => {
          const SubIcon = sub.icon
          return (
            <DropdownMenuItem key={sub.title} asChild>
              <Link
                to={sub.url}
                search={sub.search as never}
                onClick={ctx.onNavigate}
                className={cn(isTargetActive(ctx, sub) && 'text-primary')}
              >
                {SubIcon && <SubIcon aria-hidden />}
                {sub.title}
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
