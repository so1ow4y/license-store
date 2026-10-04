import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api/client'
import { useT } from '@/lib/i18n'
import { apiErrorMessage } from '@/components/api-error-text'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { licenseKeys } from '@/features/licenses/api'
import {
  formatCountdown,
  formatDateTime,
  millisUntil,
} from '@/lib/format/date'
import {
  cooldownEndsAt,
  hwidKeys,
  resetHwid,
  type HwidStatus,
} from './api'

/**
 * Кнопка самостоятельного сброса привязки.
 *
 * Три причины, по которым сброс невозможен, — три РАЗНЫХ текста, потому что
 * действия человека в них противоположны:
 *   • привязки нет           → ждать первого запуска, сбрасывать нечего;
 *   • не вышли сутки         → подождать до конкретного времени;
 *   • лимит за всё время     → писать в поддержку, ожидание не поможет.
 * Одна общая «кнопка недоступна» отправила бы человека ждать сутки там, где
 * ждать бессмысленно.
 */
type HwidResetButtonProps = {
  licenseId: string
  status: HwidStatus
  /** Есть ли право `hwid.reset.self`; без него сервер ответит 403. */
  canReset: boolean
}

/** Тик раз в секунду: таймер обязан дойти до нуля сам, без перезагрузки. */
function useCountdown(target: string | null): number {
  const [remaining, setRemaining] = useState(() => millisUntil(target))

  useEffect(() => {
    setRemaining(millisUntil(target))
    if (!target) return

    const timer = window.setInterval(() => {
      const left = millisUntil(target)
      setRemaining(left)
      // Досчитали — прекращаем будить React каждую секунду.
      if (left <= 0) window.clearInterval(timer)
    }, 1000)

    return () => window.clearInterval(timer)
  }, [target])

  return remaining
}

export function HwidResetButton({
  licenseId,
  status,
  canReset,
}: HwidResetButtonProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // Тосты собираются в обработчиках мутации, а не в разметке. Объект опций
  // пересобирается на каждый рендер, поэтому обработчики видят актуальный `t`
  // и после переключения языка.
  const t = useT()

  /**
   * Дата из ответа сервера — источник правды, но у неё есть гонка: пока
   * страница открыта, сброс мог сделать саппорт. Тогда наш `POST` вернёт
   * `HWID_RESET_COOLDOWN` с полем `details.nextAllowedAt`, и таймер должен
   * перестроиться по нему, не дожидаясь перезапроса.
   */
  const [cooldownOverride, setCooldownOverride] = useState<string | null>(null)
  const cooldownUntil = cooldownOverride ?? status.nextResetAvailableAt
  const remaining = useCountdown(cooldownUntil)

  const limitReached = status.resetsLeft <= 0
  const onCooldown = remaining > 0

  const mutation = useMutation({
    mutationFn: () => resetHwid(licenseId),
    onSuccess: async () => {
      setOpen(false)
      setCooldownOverride(null)
      toast.success(t('hwid.reset.toast.success'))
      // Перечитываем всё, что показывает привязку и счётчик: статус, историю
      // и саму лицензию (в списке карточка тоже пишет «привязана»).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hwidKeys.status(licenseId) }),
        queryClient.invalidateQueries({ queryKey: hwidKeys.history(licenseId) }),
        queryClient.invalidateQueries({
          queryKey: licenseKeys.detail(licenseId),
        }),
        queryClient.invalidateQueries({ queryKey: licenseKeys.lists() }),
      ])
    },
    onError: (error) => {
      const nextAllowed = cooldownEndsAt(error)
      if (nextAllowed) {
        // Сервер отказал по кулдауну — перестраиваем таймер по его дате.
        setCooldownOverride(nextAllowed)
        setOpen(false)
        toast.error(
          t('hwid.reset.toast.cooldown', { date: formatDateTime(nextAllowed) })
        )
        return
      }

      if (error instanceof ApiError && error.code === 'NOT_BOUND') {
        setOpen(false)
        toast.error(t('hwid.reset.toast.notBound'))
        void queryClient.invalidateQueries({
          queryKey: hwidKeys.status(licenseId),
        })
        return
      }

      if (error instanceof ApiError && error.code === 'HWID_RESET_LIMIT') {
        setOpen(false)
        toast.error(t('hwid.reset.toast.limit'))
        void queryClient.invalidateQueries({
          queryKey: hwidKeys.status(licenseId),
        })
        return
      }

      toast.error(apiErrorMessage(error, t('hwid.reset.toast.error')))
    },
  })

  // --- Состояния, в которых кнопки быть не должно -------------------------

  // Сервер отвечает NOT_BOUND (hwid.service.ts:256) — сброс здесь не действие,
  // а трата лимита впустую.
  if (!status.bound) {
    return (
      <p className='text-sm text-muted-foreground'>{t('hwid.reset.notBound')}</p>
    )
  }

  if (!canReset) {
    return (
      <p className='text-sm text-muted-foreground'>
        {t('hwid.reset.notAllowed')}
      </p>
    )
  }

  const disabled = limitReached || onCooldown || mutation.isPending

  return (
    <div className='space-y-2'>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant='outline' disabled={disabled}>
            {mutation.isPending ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Unlink className='size-4' />
            )}
            {t('hwid.reset.action')}
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('hwid.reset.confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className='space-y-2 text-sm'>
                <p>{t('hwid.reset.confirm.body')}</p>
                {/* Число подставляется в текст, а не склеивается вокруг
                    выделения: в английской фразе оно стоит в другом месте. */}
                <p>
                  {t('hwid.reset.confirm.cost', { left: status.resetsLeft })}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              {t('common.action.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              // Диалог закрываем сами в onSuccess/onError: закрытие по клику
              // спрятало бы отказ сервера от глаз.
              onClick={(event) => {
                event.preventDefault()
                mutation.mutate()
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? t('hwid.reset.confirm.submitting')
                : t('hwid.reset.confirm.submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Почему кнопка неактивна — обязательно текстом рядом. */}
      {limitReached ? (
        <p className='text-sm text-destructive'>
          {/* Общего лимита сервер отдельным полем не отдаёт: он равен сумме
              израсходованных и оставшихся сбросов. */}
          {t('hwid.reset.limitReached', {
            used: status.resetsUsed,
            total: status.resetsUsed + status.resetsLeft,
          })}
        </p>
      ) : onCooldown ? (
        <p className='text-sm text-muted-foreground'>
          {t('hwid.reset.cooldown', {
            time: formatCountdown(remaining),
            date: formatDateTime(cooldownUntil),
          })}
        </p>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('hwid.reset.left', { left: status.resetsLeft })}
        </p>
      )}
    </div>
  )
}
