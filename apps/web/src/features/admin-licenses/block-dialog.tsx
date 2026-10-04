import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText } from '@/features/admin/error-text'
import { useBlockLicense, type AdminLicense } from './api'

/** Сервер режет причину на 1000 символах (`BlockLicenseDto`, @MaxLength). */
const REASON_MAX = 1000

/**
 * Блокировка лицензии.
 *
 * Причина спрашивается не для галочки: она уходит в аудит и остаётся
 * единственным объяснением, почему у покупателя перестал запускаться продукт.
 * Поэтому поле обязательное — так же, как на сервере.
 */
export function BlockLicenseDialog({
  license,
  open,
  onOpenChange,
}: {
  license: AdminLicense | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const block = useBlockLicense()
  const t = useT()

  // Каждое открытие — чистая форма: чужая причина в поле привела бы
  // к блокировке с чужим обоснованием в аудите.
  useEffect(() => {
    if (open) {
      setReason('')
      block.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, license?.id])

  if (!license) return null

  const trimmed = reason.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= REASON_MAX

  function onSubmit() {
    if (!license || !canSubmit) return
    block.mutate(
      { id: license.id, reason: trimmed },
      {
        onSuccess: () => {
          toast.success(t('admin.block.toast.done'))
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.block.title')}</DialogTitle>
          <DialogDescription>{t('admin.block.description')}</DialogDescription>
        </DialogHeader>

        <div className='space-y-2 text-sm'>
          <p className='text-muted-foreground'>
            {t('admin.block.summary', {
              product: license.product.name,
              plan: license.plan.name,
            })}
          </p>
          {/* Маска: чтобы подтвердить блокировку, ключ целиком не нужен —
              достаточно узнать лицензию среди соседних. */}
          <p className='font-mono text-xs break-all'>{license.maskedKey}</p>
          <p className='text-muted-foreground'>
            {t('admin.block.owner', {
              owner:
                license.user?.username ?? t('admin.licenses.owner.unassigned'),
            })}
          </p>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='block-reason'>{t('admin.block.reason.label')}</Label>
          <Textarea
            id='block-reason'
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            placeholder={t('admin.block.reason.placeholder')}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className='text-xs text-muted-foreground'>
            {t('admin.block.reason.hint', {
              left: REASON_MAX - reason.length,
            })}
          </p>
        </div>

        <AdminErrorText error={block.error} />

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={block.isPending}
          >
            {t('common.action.cancel')}
          </Button>
          <Button
            variant='destructive'
            onClick={onSubmit}
            disabled={!canSubmit || block.isPending}
          >
            {block.isPending
              ? t('admin.block.action.pending')
              : t('admin.block.action.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
