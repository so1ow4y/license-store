import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Кнопка «копировать» — единственная в приложении.
 *
 * Сведена из трёх независимых копий: `features/licenses/copy-button.tsx` (K3,
 * тост об отказе), `features/admin/copy-value.tsx` (K6) и локальной кнопки
 * внутри `features/activation/license-key-panel.tsx` (K4, запасной путь через
 * скрытое поле). Взято лучшее от каждой: запасной путь + внятный отказ.
 *
 * Почему запасной путь обязателен: `navigator.clipboard` существует только в
 * защищённом контексте (https или localhost) и может быть запрещён политикой
 * страницы. Без него кнопка выглядит нажатой, но ничего не делает, и человек
 * вставляет в лаунчер старое содержимое буфера — а копируют здесь ключ
 * лицензии, то есть предъявительский документ за деньги.
 */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Отказ в доступе — идём в запасной путь, а не сдаёмся.
  }

  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

type CopyButtonProps = {
  /**
   * Что копировать. Строка — когда значение уже на руках; функция — когда
   * его надо сперва запросить.
   *
   * Ленивый вариант появился вместе с маскированием ключей лицензий: сервер
   * больше не отдаёт полный ключ ни в списке, ни в карточке — только маску,
   * а полное значение выдаёт отдельная ручка GET /licenses/:id/key, и каждый
   * её вызов пишется в журнал аудита. Держать ключ в состоянии страницы
   * «на случай, если нажмут» означало бы вернуть ровно ту утечку, ради
   * которой маску и вводили: ключ уезжал бы в память вкладки, в React
   * DevTools и в кеш react-query на каждом открытии списка.
   *
   * Функция вызывается ТОЛЬКО по нажатию, и результат нигде не сохраняется.
   */
  value: string | (() => Promise<string>)
  /**
   * Что именно копируется — попадает в подсказку и в подтверждение.
   *
   * Подпись приходит от вызывающего уже переведённой: только он знает, что
   * лежит в кнопке — ключ лицензии, код покупки или номер счёта.
   */
  label?: string
  /** Показывать подпись рядом со значком, а не только иконку. */
  withLabel?: boolean
  className?: string
  size?: 'default' | 'sm' | 'icon'
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
}

export function CopyButton({
  value,
  label,
  withLabel = false,
  className,
  size = withLabel ? 'sm' : 'icon',
  variant = withLabel ? 'outline' : 'ghost',
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'busy' | 'copied'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t = useT()
  // Значение по умолчанию берём здесь, а не в параметрах: параметр посчитался
  // бы до `useT()` и не знал бы языка.
  const name = label ?? t('common.copy.value')

  // Галочку возвращаем в исходное состояние сами: без сброса кнопка навсегда
  // остаётся «уже скопировано» и перестаёт подтверждать действие.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  async function onCopy() {
    let resolved: string
    if (typeof value === 'string') {
      resolved = value
    } else {
      // Повторное нажатие во время запроса игнорируем: иначе каждый лишний
      // тап — ещё одна строка «ключ показан» в аудите.
      if (state === 'busy') return
      setState('busy')
      try {
        resolved = await value()
      } catch {
        // Причину не показываем дословно: сюда доезжают и 403 «чужая
        // лицензия», и сетевой сбой, а формулировать за сервер нечего.
        setState('idle')
        toast.error(t('common.copy.toast.failed'))
        return
      }
    }

    const ok = await copyToClipboard(resolved)
    if (!ok) {
      setState('idle')
      toast.error(t('common.copy.toast.failed'))
      return
    }
    setState('copied')
    toast.success(t('common.copy.toast.success', { label: name }))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <Button
      type='button'
      variant={variant}
      size={size}
      onClick={() => void onCopy()}
      disabled={state === 'busy'}
      className={cn('shrink-0', className)}
      title={t('common.copy.aria', { label: name.toLowerCase() })}
      aria-label={t('common.copy.aria', { label: name.toLowerCase() })}
    >
      {state === 'copied' ? (
        <Check className='size-4 text-emerald-500' />
      ) : state === 'busy' ? (
        <Loader2 className='size-4 animate-spin' />
      ) : (
        <Copy className='size-4' />
      )}
      {withLabel ? (
        <span>{state === 'copied' ? t('common.copy.done') : name}</span>
      ) : (
        <span className='sr-only'>{t('common.copy.action')}</span>
      )}
    </Button>
  )
}
