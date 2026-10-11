import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { SIDE_PANEL_MIN, hotkeyLabel, setUiPreferences, useUiPreferences } from '@/lib/ui/preferences'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Панель справа в духе SIEM: клик по строке списка открывает карточку записи,
 * а сам список остаётся на месте и живым — можно щёлкать соседние строки,
 * панель просто переключается на них.
 *
 * Не модальная: фон не затемняется и не блокируется. По умолчанию ложится
 * поверх списка; в настройках интерфейса можно включить «ужимать страницу» —
 * тогда на широком экране страница отодвигается на ширину панели (переменная
 * --side-panel-width, её читает каркас). На узком экране панель всегда поверх
 * во всю ширину. Ширина задаётся в настройках и, если там не запрещено,
 * тянется мышью за левый край.
 */

function maxWidth(): number {
  return Math.max(SIDE_PANEL_MIN, Math.round(window.innerWidth * 0.85))
}

/** Открыт ли сейчас поверх какой-нибудь диалог или выпадающий список — тогда Esc его, а не панели. */
function overlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[data-slot="dialog-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"], [data-radix-popper-content-wrapper] [data-state="open"]'
    )
  )
}

export function SidePanel({
  open,
  onClose,
  title,
  subtitle,
  badges,
  actions,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /** Статусы и метки рядом с заголовком. */
  badges?: ReactNode
  /** Кнопки в шапке: «открыть страницей», быстрые действия. */
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const t = useT()
  const { hotkeys, sidePanelWidth, sidePanelResizable } = useUiPreferences()
  // Пока тянут мышью — своя ширина; отпустили — она уходит в настройки.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? sidePanelWidth
  const dragging = useRef(false)

  // Каркас отодвигает страницу на ширину панели (только на широком экране).
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.style.setProperty('--side-panel-width', `${Math.min(width, maxWidth())}px`)
    return () => {
      root.style.removeProperty('--side-panel-width')
    }
  }, [open, width])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !overlayOpen()) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function startDrag(event: React.PointerEvent) {
    event.preventDefault()
    dragging.current = true
    let last = width
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      last = Math.min(maxWidth(), Math.max(SIDE_PANEL_MIN, window.innerWidth - e.clientX))
      setDragWidth(last)
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setUiPreferences({ sidePanelWidth: Math.round(last) })
      setDragWidth(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!open) return null

  return (
    <aside
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn(
        'fixed inset-y-0 right-0 z-[45] flex w-full flex-col border-l bg-background shadow-2xl shadow-black/50',
        'animate-in duration-200 slide-in-from-right-8 fade-in-0 sm:w-[var(--panel-w)]',
        className
      )}
      style={{ ['--panel-w' as string]: `${Math.min(width, maxWidth())}px` }}
    >
      {sidePanelResizable && (
        <div
          role='separator'
          aria-orientation='vertical'
          aria-label={t('panel.resize')}
          onPointerDown={startDrag}
          className='absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize hover:bg-primary/30 sm:block'
        />
      )}
      <header className='flex items-start gap-3 border-b px-5 py-4'>
        <div className='min-w-0 flex-1 space-y-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='truncate text-lg font-semibold'>{title}</h2>
            {badges}
          </div>
          {subtitle && <div className='text-sm text-muted-foreground'>{subtitle}</div>}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {actions}
          <Button variant='ghost' size='icon' onClick={onClose} title={t('panel.close')}>
            <X className='size-4' />
            <span className='sr-only'>{t('panel.close')}</span>
          </Button>
        </div>
      </header>
      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4'>{children}</div>
      {hotkeys.enabled && (
        <footer className='flex flex-wrap gap-x-3 gap-y-1 border-t px-5 py-2 text-[11px] text-muted-foreground'>
          {(hotkeys.bindings.up.length > 0 || hotkeys.bindings.down.length > 0) && (
            <span>
              {[...hotkeys.bindings.up.slice(0, 1), ...hotkeys.bindings.down.slice(0, 1)].map((code) => (
                <Kbd key={code}>{hotkeyLabel(code)}</Kbd>
              ))}{' '}
              {t('panel.hint.move')}
            </span>
          )}
          <span>
            {hotkeys.bindings.close.slice(0, 1).map((code) => (
              <Kbd key={code}>{hotkeyLabel(code)}</Kbd>
            ))}
            {hotkeys.bindings.close.length > 0 && ' / '}
            <Kbd>Esc</Kbd> {t('panel.hint.close')}
          </span>
        </footer>
      )}
    </aside>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className='rounded border bg-muted px-1 font-mono text-[10px] text-foreground'>{children}</kbd>
}

/** Раздел внутри панели: заголовок, подсказка, содержимое. */
export function PanelSection({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className='space-y-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='space-y-0.5'>
          <h3 className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>{title}</h3>
          {description && <p className='text-xs text-muted-foreground'>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Сетка «поле — значение» для сводки в панели. */
export function PanelFacts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className='grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm'>
      {rows.map(([label, value], i) => (
        <div key={i} className='contents'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='min-w-0 break-words'>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Класс выбранной строки таблицы: подсветка той, что открыта в панели. */
export const ACTIVE_ROW = 'bg-primary/10 hover:bg-primary/15'

/** Строка под клавиатурным курсором (горячие клавиши «вверх/вниз»). */
export const CURSOR_ROW = 'outline outline-1 -outline-offset-1 outline-primary/70'
