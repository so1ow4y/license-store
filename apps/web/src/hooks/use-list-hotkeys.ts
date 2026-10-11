import { useEffect, useRef, useState } from 'react'
import { getUiPreferences, hotkeyAction } from '@/lib/ui/preferences'

/**
 * Клавиатура в списках с панелью справа, как в SIEM: «вниз» и «вверх»
 * двигают курсор по строкам (если панель открыта — она переключается на
 * новую строку), «открыть» открывает строку под курсором, «закрыть» убирает
 * панель. Клавиши задаются в настройках интерфейса (по умолчанию S, W, D, A).
 *
 * Клавиши не срабатывают, пока человек печатает в поле, держит модификатор
 * или поверх открыт диалог. Если на экране несколько таких списков,
 * управляет последний подключённый — например, список внутри открытой карточки.
 */

type Handler = (event: KeyboardEvent) => boolean

const handlers: Handler[] = []
let installed = false

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  if (el.isContentEditable) return true
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

/** Диалог или выпадающий список поверх — клавиши его, а не списка. Закрывающийся (анимация) не считается. */
export function overlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[data-slot="dialog-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"], [data-radix-popper-content-wrapper] [data-state="open"]'
    )
  )
}

function install(): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (isTyping(event.target) || overlayOpen()) return
    const top = handlers[handlers.length - 1]
    if (top?.(event)) event.preventDefault()
  })
}

function scrollToRow(id: string): void {
  window.setTimeout(() => {
    document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, 0)
}

/**
 * Возвращает id строки под курсором — для подсветки. Строкам списка нужен
 * атрибут `data-row-id`, чтобы курсор прокручивал их в видимую область.
 */
export function useListHotkeys({
  ids,
  openedId,
  onOpen,
  onClose,
  enabled = true,
}: {
  ids: string[]
  openedId: string | null
  onOpen: (id: string) => void
  onClose: () => void
  enabled?: boolean
}): string | null {
  const [cursor, setCursor] = useState<string | null>(null)
  const state = useRef({ ids, openedId, onOpen, onClose, cursor })
  state.current = { ids, openedId, onOpen, onClose, cursor }

  // Строку открыли мышью — курсор встаёт на неё.
  useEffect(() => {
    if (openedId) setCursor(openedId)
  }, [openedId])

  // Строка ушла из списка (фильтр, другая страница) — курсор сбрасывается.
  const key = ids.join('|')
  useEffect(() => {
    setCursor((current) => (current && !state.current.ids.includes(current) ? null : current))
  }, [key])

  useEffect(() => {
    if (!enabled) return
    install()
    const handler: Handler = (event) => {
      const action = hotkeyAction(getUiPreferences().hotkeys, event.code)
      if (!action) return false
      const s = state.current

      const move = (delta: number) => {
        if (s.ids.length === 0) return false
        const index = s.cursor ? s.ids.indexOf(s.cursor) : -1
        const nextIndex = index < 0 ? (delta > 0 ? 0 : s.ids.length - 1) : Math.max(0, Math.min(s.ids.length - 1, index + delta))
        const next = s.ids[nextIndex]!
        // Быстрые нажатия подряд не ждут перерисовки.
        s.cursor = next
        setCursor(next)
        if (s.openedId) s.onOpen(next)
        scrollToRow(next)
        return true
      }

      switch (action) {
        case 'down':
          return move(1)
        case 'up':
          return move(-1)
        case 'open': {
          const id = s.cursor ?? s.ids[0]
          if (!id) return false
          setCursor(id)
          s.onOpen(id)
          return true
        }
        case 'close':
          if (!s.openedId) return false
          s.onClose()
          return true
        default:
          return false
      }
    }
    handlers.push(handler)
    return () => {
      const index = handlers.indexOf(handler)
      if (index >= 0) handlers.splice(index, 1)
    }
  }, [enabled])

  return cursor
}
