import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

type QrCodeProps = {
  /** Содержимое кода. Здесь — `otpauth://`-ссылка из `POST /auth/2fa/setup`. */
  value: string
  /** Сторона картинки в пикселях. */
  size?: number
  className?: string
  /** Подпись картинки; по умолчанию — для QR второго фактора. */
  alt?: string
}

/**
 * QR-код, нарисованный на фронте.
 *
 * Сервер отдаёт только `otpauth`-URI, картинки у него нет — и это правильно:
 * секрет второго фактора не должен лишний раз путешествовать в виде
 * изображения через логи и кеши прокси.
 *
 * Рисуем в data:URL, а не через сторонний генератор картинок по сети: URI
 * содержит секрет целиком, и отправлять его на чужой сервис ради красивого
 * квадратика — прямая утечка второго фактора.
 */
export function QrCode({ value, size = 208, className, alt }: QrCodeProps) {
  const t = useT()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setFailed(false)

    toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      // Цвета зашиты намеренно и не следуют теме: сканеры ждут тёмный код на
      // светлом фоне, а «QR в тёмной теме» многие камеры просто не читают.
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [value, size])

  if (failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground',
          className
        )}
        style={{ width: size, height: size }}
        role='status'
      >
        {t('security.twoFactor.qr.failed')}
      </div>
    )
  }

  if (!src) {
    return (
      <Skeleton
        className={cn('rounded-md', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div className={cn('inline-block rounded-md bg-white p-2', className)}>
      <img
        src={src}
        width={size}
        height={size}
        alt={alt ?? t('security.twoFactor.qr.alt')}
        className='block'
      />
    </div>
  )
}
