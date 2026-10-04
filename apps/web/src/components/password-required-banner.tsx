import { Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

/**
 * Глобальный блокирующий баннер для аккаунтов без пароля.
 *
 * Формулировка прямая, потому что последствие прямое: пока пароль не задан,
 * сервер не выдаёт лицензию и загрузчик не запускается. Мягкое «рекомендуем
 * задать пароль» здесь означало бы, что пользователь заплатил и не понимает,
 * почему ничего не работает.
 *
 * Показывается при `requiresPassword === true` из `GET /auth/me`.
 */
export function PasswordRequiredBanner() {
  const t = useT()

  return (
    <div
      role='alert'
      className='flex flex-wrap items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-3'
    >
      <KeyRound className='size-4 shrink-0 text-primary' />
      <p className='min-w-0 flex-1 text-sm'>
        {/* Пробел между призывом и объяснением — в разметке, а не в словаре:
            хвостовой пробел в строке перевода теряется при первой же правке. */}
        <span className='font-medium'>{t('shell.passwordRequired.title')}</span>{' '}
        {t('shell.passwordRequired.body')}
      </p>
      <Button size='sm' asChild>
        <Link to='/settings/security/password'>
          {t('shell.passwordRequired.action')}
        </Link>
      </Button>
    </div>
  )
}
