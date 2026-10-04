import { useEffect, useState, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Склеить условия через AND. Часть с OR берётся в скобки: иначе
 * «a OR b» + «status:x» прочиталось бы как «a OR (b AND status:x)».
 */
export function andQuery(...parts: (string | null | undefined | false)[]): string {
  const kept = parts.map((p) => (p || '').trim()).filter(Boolean)
  if (kept.length < 2) return kept[0] ?? ''
  return kept.map((p) => (/(^|\s)or(\s|$)|\|/i.test(p) ? `(${p})` : p)).join(' ')
}

/**
 * Строка поиска в духе SIEM: «поле:значение», AND/OR/NOT, скобки, кавычки.
 * Разбирает сервер (`common/search/query.ts`); здесь только ввод, кнопки
 * полей и подсказка по синтаксису.
 */
export function QueryInput({
  value,
  onSubmit,
  fields,
  placeholder,
  children,
}: {
  value: string
  onSubmit: (q: string) => void
  fields: readonly string[]
  placeholder?: string
  /** Фильтры справа от строки (статус, даты). */
  children?: ReactNode
}) {
  const t = useT()
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <form
          className='flex min-w-72 flex-1 gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(draft.trim())
          }}
        >
          <div className='relative flex-1'>
            <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={draft}
              placeholder={placeholder}
              className='pl-8 font-mono text-sm'
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <Button type='submit' variant='outline'>
            {t('common.action.search')}
          </Button>
          {value && (
            <Button type='button' variant='ghost' onClick={() => onSubmit('')}>
              <X className='size-4' />
              <span className='sr-only'>{t('common.action.resetFilters')}</span>
            </Button>
          )}
        </form>
        {children}
      </div>
      <div className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
        <span>{t('siem.fields')}</span>
        {fields.map((field) => (
          <button
            key={field}
            type='button'
            onClick={() => setDraft((d) => `${d.trim()} ${field}:`.trim())}
            className='rounded-md border px-1.5 py-0.5 font-mono hover:bg-accent hover:text-foreground'
          >
            {field}:
          </button>
        ))}
        <span className='ms-1'>{t('siem.syntax')}</span>
      </div>
    </div>
  )
}
