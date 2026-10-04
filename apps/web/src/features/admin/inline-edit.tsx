import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { adminErrorMessage } from './error-text'

/**
 * Значение, которое правится прямо в ячейке таблицы: клик — поле ввода,
 * Enter или уход фокуса — сохранить, Escape — отменить. Пока запрос идёт,
 * поле заблокировано; ошибка показывается под ним и оставляет его открытым.
 */
export function InlineText({
  value,
  onSave,
  validate,
  mono,
  type = 'text',
  className,
  inputClassName,
  confirm,
  disabled,
  display,
}: {
  value: string
  onSave: (next: string) => Promise<unknown>
  /** Текст ошибки или null, если значение годится. */
  validate?: (next: string) => string | null
  mono?: boolean
  type?: 'text' | 'number'
  className?: string
  inputClassName?: string
  /** Вопрос перед сохранением (например, о смене кода товара). */
  confirm?: string
  disabled?: boolean
  /** Как показывать значение вне правки (по умолчанию — само значение). */
  display?: React.ReactNode
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  function cancel() {
    setEditing(false)
    setDraft(value)
    setError(null)
  }

  async function save() {
    const next = draft.trim()
    if (next === value) return cancel()
    const problem = validate?.(next) ?? null
    if (problem) return setError(problem)
    if (confirm && !window.confirm(confirm)) return cancel()
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
      setError(null)
    } catch (e) {
      setError(adminErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type='button'
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
        title={disabled ? undefined : t('admin.inline.edit')}
        className={cn(
          'group inline-flex max-w-full items-center gap-1 rounded px-1 -mx-1 text-start enabled:hover:bg-accent',
          mono && 'font-mono',
          className
        )}
      >
        <span className='truncate'>{display ?? (value || '—')}</span>
        {!disabled && <Pencil className='size-3 shrink-0 opacity-0 group-hover:opacity-60' />}
      </button>
    )
  }

  return (
    <div className='space-y-1' onClick={(e) => e.stopPropagation()}>
      <div className='flex items-center gap-1'>
        <Input
          ref={input}
          type={type}
          value={draft}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          className={cn('h-7 text-sm', mono && 'font-mono', inputClassName)}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        />
        <button type='button' disabled={saving} onClick={() => void save()} aria-label={t('common.action.save')} className='text-muted-foreground hover:text-foreground'>
          <Check className='size-4' />
        </button>
        <button type='button' disabled={saving} onClick={cancel} aria-label={t('common.action.cancel')} className='text-muted-foreground hover:text-foreground'>
          <X className='size-4' />
        </button>
      </div>
      {error && <p className='text-xs text-destructive'>{error}</p>}
    </div>
  )
}
