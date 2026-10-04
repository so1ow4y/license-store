import { useEffect } from 'react'
import { ShieldAlert } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { useT } from '@/lib/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Привилегированной роли сервер запрещает АДМИНСКИЕ действия, пока не включён
 * второй фактор (`permissions.guard.ts:105-110`, настройка
 * `security.2fa.required_for_admin`). Ответ — 403 с кодом
 * `TWO_FACTOR_SETUP_REQUIRED`, а НЕ `FORBIDDEN`.
 *
 * Разница принципиальная: права у человека есть, показывать ему «недостаточно
 * прав» — это тикет в поддержку и потерянный час. Правильная реакция — увести
 * в мастер настройки 2FA, после которого раздел откроется сам.
 */
export function isTwoFactorSetupRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === 'TWO_FACTOR_SETUP_REQUIRED'
  )
}

/**
 * Адрес мастера двухфакторной аутентификации.
 *
 * Собираем строкой, а не типизированным `Link`, потому что уходим отсюда
 * полной перезагрузкой (`location.assign`), а не переходом роутера — см.
 * ниже. Сам маршрут в дереве есть.
 */
const TWO_FACTOR_SETUP_PATH = '/settings/security/2fa'

function twoFactorSetupUrl(): string {
  const url = new URL(TWO_FACTOR_SETUP_PATH, window.location.origin)
  // Куда вернуть после включения. Лишний параметр безопасен: zod-схема
  // маршрута отбросит неизвестный ключ, а не упадёт.
  url.searchParams.set('redirect', window.location.pathname)
  return url.toString()
}

/**
 * Экран-перехватчик: объясняет причину и сам уходит в мастер 2FA.
 *
 * Переход именно `location.assign`, а не `router.navigate`: экран-перехватчик
 * рисуется внутри чужого поддерева, и полная перезагрузка гарантированно
 * снимает с него все незавершённые запросы. Она безвредна — access-токен
 * восстановится из refresh-токена на старте приложения.
 *
 * Текст показываем ДО перехода, а не вместо него: если раздела безопасности
 * в сборке ещё нет, человек хотя бы понимает, что произошло, и не думает,
 * что у него отобрали доступ.
 */
export function TwoFactorSetupRequired() {
  const t = useT()

  useEffect(() => {
    // Уже в мастере — никуда не гоним, иначе получим цикл переходов.
    if (window.location.pathname.startsWith(TWO_FACTOR_SETUP_PATH)) {
      return
    }
    const timer = window.setTimeout(() => {
      window.location.assign(twoFactorSetupUrl())
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <Alert className='max-w-2xl'>
      <ShieldAlert className='size-4' />
      <AlertTitle>{t('admin.twoFactor.title')}</AlertTitle>
      <AlertDescription className='space-y-3'>
        <p>{t('admin.twoFactor.description')}</p>
        <Button
          variant='outline'
          size='sm'
          onClick={() => window.location.assign(twoFactorSetupUrl())}
        >
          {t('admin.twoFactor.action')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
