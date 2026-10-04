import { useEffect, useState } from 'react'
import { Check, Copy, Download, ShieldAlert } from 'lucide-react'
import { t as translate, useT } from '@/lib/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'

type RecoveryCodesDialogProps = {
  open: boolean
  codes: string[]
  /** Вызывается только после явного подтверждения «я сохранил». */
  onConfirm: () => void
}

/**
 * Текст файла: без пояснений он через полгода будет непонятным набором букв.
 *
 * Модульный `t`, а не `useT()`: функция вызывается из обработчика скачивания,
 * а не при отрисовке. Язык читается в момент нажатия — файл уезжает на диск
 * на том языке, который человек видит на экране.
 */
function buildFileContents(codes: string[]): string {
  return [
    translate('security.recoveryCodes.file.title'),
    '',
    translate('security.recoveryCodes.file.intro'),
    translate('security.recoveryCodes.file.storage'),
    '',
    ...codes,
    '',
  ].join('\r\n')
}

/**
 * Экран кодов восстановления — единственный момент, когда их можно увидеть.
 *
 * Сервер отдаёт коды ровно один раз (`RecoveryCodesDto`), повторно достать
 * их неоткуда. Поэтому окно намеренно нельзя закрыть ни крестиком, ни Esc,
 * ни щелчком мимо: случайное закрытие означает, что при потере телефона
 * человек теряет аккаунт и идёт в поддержку. Чекбокс «я сохранил» —
 * единственный выход.
 */
export function RecoveryCodesDialog({
  open,
  codes,
  onConfirm,
}: RecoveryCodesDialogProps) {
  const t = useT()
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  /**
   * Пока коды на экране, перезагрузка или закрытие вкладки уничтожает их
   * безвозвратно — сервер второй раз их не выдаст. Штатное предупреждение
   * браузера здесь дешевле, чем обращение в поддержку с потерянным аккаунтом.
   * После отметки «сохранил» смысла держать защиту нет.
   */
  useEffect(() => {
    if (!open || saved) return

    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [open, saved])

  async function onCopy() {
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      // Возвращаем подпись обратно: иначе «Скопировано» висит вечно и человек
      // не понимает, сработало ли повторное нажатие.
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер обмена недоступен без https и без жеста пользователя.
      // Молчать нельзя: человек решит, что коды у него, и закроет окно.
      setCopyFailed(true)
    }
  }

  function onDownload() {
    const blob = new Blob([buildFileContents(codes)], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        // Все три обработчика гасим: окно закрывается только кнопкой ниже.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className='sm:max-w-md'
      >
        <DialogHeader>
          <DialogTitle>{t('security.recoveryCodes.title')}</DialogTitle>
          <DialogDescription>
            {t('security.recoveryCodes.description')}
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <ShieldAlert className='size-4' />
          <AlertTitle>{t('security.recoveryCodes.why.title')}</AlertTitle>
          <AlertDescription>
            {t('security.recoveryCodes.why.description')}
          </AlertDescription>
        </Alert>

        <ul className='grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/50 p-3 font-mono text-sm'>
          {codes.map((code) => (
            <li key={code} className='select-all'>
              {code}
            </li>
          ))}
        </ul>

        <div className='flex flex-wrap gap-2'>
          <Button type='button' variant='outline' size='sm' onClick={onCopy}>
            {copied ? (
              <Check className='size-4' />
            ) : (
              <Copy className='size-4' />
            )}
            {copied
              ? t('security.recoveryCodes.action.copied')
              : t('security.recoveryCodes.action.copy')}
          </Button>
          <Button type='button' variant='outline' size='sm' onClick={onDownload}>
            <Download className='size-4' />
            {t('security.recoveryCodes.action.download')}
          </Button>
        </div>

        {copyFailed && (
          <p className='text-sm text-destructive' role='alert'>
            {t('security.recoveryCodes.copyFailed')}
          </p>
        )}

        <div className='flex items-start gap-2'>
          <Checkbox
            id='recovery-codes-saved'
            checked={saved}
            onCheckedChange={(value) => setSaved(value === true)}
          />
          <Label
            htmlFor='recovery-codes-saved'
            className='text-sm leading-snug font-normal'
          >
            {t('security.recoveryCodes.saved.label')}
          </Label>
        </div>

        <DialogFooter>
          <Button type='button' disabled={!saved} onClick={onConfirm}>
            {t('security.recoveryCodes.action.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
