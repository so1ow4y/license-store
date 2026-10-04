import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { messageForCode } from '@/lib/api/error-codes'
import { t as translate, useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText } from './error-text'

/**
 * Массовые операции в духе SIEM: галочки в строках, панель действий над
 * выбранным, итог «сколько прошло, сколько нет и почему» (`common/bulk/bulk.ts`).
 */

export type BulkResult = {
  total: number
  succeeded: number
  failed: { id: string; ok: false; code?: string }[]
}

/** Сервер принимает до 500 элементов за раз (`BULK_MAX`). */
export const BULK_MAX = 500

/** Выбранные строки. Смена страницы или фильтра выбор не сбрасывает — как в SIEM. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  return useMemo(
    () => ({
      selected,
      size: selected.size,
      ids: [...selected],
      has: (id: string) => selected.has(id),
      toggle: (id: string) =>
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        }),
      /** Отметить или снять всю страницу. */
      togglePage: (pageIds: string[]) =>
        setSelected((prev) => {
          const next = new Set(prev)
          const all = pageIds.length > 0 && pageIds.every((id) => next.has(id))
          for (const id of pageIds) {
            if (all) next.delete(id)
            else if (next.size < BULK_MAX) next.add(id)
          }
          return next
        }),
      clear: () => setSelected(new Set()),
    }),
    [selected]
  )
}

export type Selection = ReturnType<typeof useSelection>

/** Галочка «вся страница» в шапке таблицы. */
export function PageCheckbox({ selection, pageIds }: { selection: Selection; pageIds: string[] }) {
  const t = useT()
  const picked = pageIds.filter((id) => selection.has(id)).length
  return (
    <Checkbox
      aria-label={t('admin.bulk.selectPage')}
      checked={picked > 0 && picked === pageIds.length ? true : picked > 0 ? 'indeterminate' : false}
      onCheckedChange={() => selection.togglePage(pageIds)}
    />
  )
}

export function RowCheckbox({ selection, id }: { selection: Selection; id: string }) {
  const t = useT()
  return (
    <Checkbox
      aria-label={t('admin.bulk.selectRow')}
      checked={selection.has(id)}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={() => selection.toggle(id)}
    />
  )
}

/** Полоса над таблицей: «выбрано N» и кнопки действий. */
export function BulkBar({ selection, children }: { selection: Selection; children: ReactNode }) {
  const t = useT()
  if (selection.size === 0) return null
  return (
    <div className='sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm'>
      <span className='text-sm font-medium'>{t('admin.bulk.selected', { count: selection.size })}</span>
      <div className='flex flex-wrap gap-2'>{children}</div>
      <Button size='sm' variant='ghost' className='ms-auto' onClick={selection.clear}>
        <X className='size-4' />
        {t('admin.bulk.clear')}
      </Button>
    </div>
  )
}

/** Итог операции во всплывающем сообщении: успехи и разбивка отказов по кодам. */
export function toastBulkResult(result: BulkResult): void {
  if (result.failed.length === 0) {
    toast.success(translate('admin.bulk.done', { count: result.succeeded }))
    return
  }
  const byCode = new Map<string, number>()
  for (const item of result.failed) {
    const code = item.code ?? 'UNKNOWN_ERROR'
    byCode.set(code, (byCode.get(code) ?? 0) + 1)
  }
  const reasons = [...byCode].map(([code, n]) => `${messageForCode(code)} (${n})`).join('\n')
  toast.warning(translate('admin.bulk.partial', { ok: result.succeeded, failed: result.failed.length, count: result.total }), {
    description: reasons,
    duration: 10_000,
  })
}

/**
 * Подтверждение массового действия: причина (если нужна) и срок (для
 * блокировок адресов). Причина уходит в аудит каждого элемента.
 */
export function BulkConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  count,
  reason,
  duration,
  destructive,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  count: number
  /** 'required' — без причины кнопка неактивна; 'optional' — поле есть, но можно пустым. */
  reason?: 'required' | 'optional'
  /** Поле срока в часах (пусто — бессрочно). */
  duration?: boolean
  destructive?: boolean
  pending?: boolean
  error?: unknown
  onConfirm: (input: { reason?: string; expiresInHours?: number }) => void
}) {
  const t = useT()
  const [text, setText] = useState('')
  const [hours, setHours] = useState('')

  useEffect(() => {
    if (open) {
      setText('')
      setHours('')
    }
  }, [open])

  const hoursValue = hours.trim() ? Number(hours) : undefined
  const hoursValid = hoursValue === undefined || (Number.isInteger(hoursValue) && hoursValue >= 1 && hoursValue <= 24 * 365)
  const valid = (reason !== 'required' || text.trim().length > 0) && hoursValid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            onConfirm({ reason: text.trim() || undefined, expiresInHours: hoursValue })
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {description ? `${description} ` : ''}
              {t('admin.bulk.affects', { count })}
            </DialogDescription>
          </DialogHeader>
          {reason && (
            <div className='space-y-2'>
              <Label htmlFor='bulk-reason'>
                {t('admin.bulk.reason')}
                {reason === 'optional' && <span className='text-muted-foreground'> ({t('admin.bulk.optional')})</span>}
              </Label>
              <Textarea id='bulk-reason' rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
          )}
          {duration && (
            <div className='space-y-2'>
              <Label htmlFor='bulk-hours'>{t('admin.bulk.hours')}</Label>
              <Input
                id='bulk-hours'
                type='number'
                min={1}
                max={24 * 365}
                placeholder={t('admin.bulk.forever')}
                value={hours}
                className='w-40'
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
          )}
          <AdminErrorText error={error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' variant={destructive ? 'destructive' : 'default'} disabled={!valid || pending}>
              {t('admin.bulk.apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
