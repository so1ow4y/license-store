import { useState, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Info,
  KeyRound,
  Link2,
  MessageCircle,
  Send,
  ShieldCheck,
  Unlink,
  type LucideIcon,
} from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { useT } from '@/lib/i18n'
import { SESSION_QUERY_KEY, useSession } from '@/lib/auth/session'
import { providerLabel, unlinkProvider } from '@/features/security/api'
import { ApiErrorText } from '@/components/api-error-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Способы входа (K5, п. 3.17 плана).
 *
 * Кнопки «Привязать» здесь нет и быть не может: маршрута привязки на сервере
 * не существует (метод `OAuthService.linkToCurrentUser` не вызывается ниоткуда).
 * Рисовать кнопку, которой некуда сходить, — хуже, чем честно объяснить.
 */
export const Route = createFileRoute('/_app/settings/security/logins')({
  component: LoginMethodsPage,
})

/** Иконка провайдера. Фирменных знаков в наборе нет — берём близкие по смыслу. */
const PROVIDER_ICONS: Record<string, LucideIcon> = {
  DISCORD: MessageCircle,
  TELEGRAM: Send,
}

function LoginMethodsPage() {
  const t = useT()
  const queryClient = useQueryClient()
  const { me, isLoading } = useSession()

  /** Провайдер, для которого открыто окно подтверждения. */
  const [confirming, setConfirming] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: unlinkProvider,
    onSuccess: () => {
      setConfirming(null)
      // Список провайдеров живёт в ответе `/auth/me` — других источников нет.
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
    onError: () => setConfirming(null),
  })

  if (isLoading || !me) {
    return (
      <div className='max-w-xl space-y-4'>
        <Skeleton className='h-8 w-56' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  const providers = me.providers
  /** Пароль тоже способ входа — считаем вместе с провайдерами. */
  const methodsTotal = (me.hasPassword ? 1 : 0) + providers.length

  /**
   * Сервер откажет с `LAST_LOGIN_METHOD`, если после отвязки войти будет нечем
   * (`oauth.service.ts:131`). Повторяем условие на клиенте, чтобы человек
   * увидел причину до нажатия, а не поймал отказ на ровном месте.
   */
  const isLastMethod = methodsTotal <= 1

  const lastMethodRefusal =
    mutation.error instanceof ApiError &&
    mutation.error.code === 'LAST_LOGIN_METHOD'

  return (
    <div className='max-w-xl space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('security.logins.title')}</CardTitle>
          <CardDescription>{t('security.logins.description')}</CardDescription>
        </CardHeader>

        <CardContent className='space-y-4'>
          {/* --- Пароль --- */}
          <MethodRow
            icon={KeyRound}
            title={t('security.logins.password.title')}
            description={
              me.hasPassword
                ? t('security.logins.password.description.set')
                : t('security.logins.password.description.unset')
            }
            badge={
              me.hasPassword ? (
                <Badge variant='secondary'>
                  {t('security.logins.password.badge.set')}
                </Badge>
              ) : (
                <Badge variant='outline'>
                  {t('security.logins.password.badge.unset')}
                </Badge>
              )
            }
            action={
              <Button size='sm' variant='outline' asChild>
                <Link to='/settings/security/password'>
                  {me.hasPassword
                    ? t('security.logins.password.action.change')
                    : t('security.password.set.action.submit')}
                </Link>
              </Button>
            }
          />

          {/* --- Внешние сервисы --- */}
          {providers.length > 0 && <Separator />}

          {providers.map((provider) => (
            <MethodRow
              key={provider}
              icon={PROVIDER_ICONS[provider.toUpperCase()] ?? Link2}
              title={providerLabel(provider)}
              description={t('security.logins.provider.description')}
              badge={
                <Badge variant='secondary'>
                  {t('security.logins.provider.badge.linked')}
                </Badge>
              }
              action={
                <Button
                  size='sm'
                  variant='outline'
                  disabled={isLastMethod || mutation.isPending}
                  onClick={() => setConfirming(provider)}
                  title={
                    isLastMethod
                      ? t('security.logins.provider.action.unlink.blocked')
                      : undefined
                  }
                >
                  <Unlink className='size-4' />
                  {t('security.logins.provider.action.unlink')}
                </Button>
              }
            />
          ))}

          {providers.length === 0 && (
            <p className='text-sm text-muted-foreground'>
              {t('security.logins.provider.empty')}
            </p>
          )}

          {/* Отказ сервера — не ошибка пользователя, а объяснение с выходом. */}
          {lastMethodRefusal && (
            <Alert>
              <Info className='size-4' />
              <AlertTitle>{t('security.logins.lastMethod.title')}</AlertTitle>
              <AlertDescription>
                <p>{t('security.logins.lastMethod.description')}</p>
                <Button size='sm' asChild>
                  <Link to='/settings/security/password'>
                    {t('security.password.set.action.submit')}
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {mutation.error && !lastMethodRefusal && (
            <ApiErrorText error={mutation.error} />
          )}

          {isLastMethod && !me.hasPassword && providers.length === 1 && (
            <Alert>
              <Info className='size-4' />
              <AlertTitle>{t('security.logins.backup.title')}</AlertTitle>
              <AlertDescription>
                {t('security.logins.backup.description')}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center gap-2'>
            {t('security.twoFactor.title')}
            {me.twoFactorEnabled ? (
              <Badge>
                <ShieldCheck className='size-3' />
                {t('security.twoFactor.state.on')}
              </Badge>
            ) : (
              <Badge variant='outline'>
                {t('security.twoFactor.state.off')}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {me.twoFactorEnabled
              ? t('security.logins.twoFactor.description.on')
              : t('security.logins.twoFactor.description.off')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size='sm' variant='outline' asChild>
            <Link to='/settings/security/2fa'>
              {me.twoFactorEnabled
                ? t('security.logins.twoFactor.action.manage')
                : t('security.logins.twoFactor.action.enable')}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Alert>
        <Info className='size-4' />
        <AlertTitle>{t('security.logins.linking.title')}</AlertTitle>
        <AlertDescription>
          {t('security.logins.linking.description')}
        </AlertDescription>
      </Alert>

      {/* Подтверждение вынесено в окно: отвязка необратима из кабинета —
          обратно привязать нечем, маршрута привязки не существует. */}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('security.logins.unlink.title', {
                provider: confirming ? providerLabel(confirming) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('security.logins.unlink.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              {t('common.action.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(event) => {
                // Radix закрывает окно по клику сам; нам нужно дождаться ответа
                // сервера, иначе отказ LAST_LOGIN_METHOD покажется в пустоту.
                event.preventDefault()
                if (confirming) mutation.mutate(confirming)
              }}
            >
              {mutation.isPending
                ? t('security.logins.unlink.action.pending')
                : t('security.logins.provider.action.unlink')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Строка списка                                                        */
/* ------------------------------------------------------------------ */

function MethodRow({
  icon: Icon,
  title,
  description,
  badge,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  badge: ReactNode
  action: ReactNode
}) {
  return (
    <div className='flex flex-wrap items-start gap-3'>
      <Icon className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
      <div className='min-w-0 flex-1 space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium'>{title}</span>
          {badge}
        </div>
        <p className='text-sm text-muted-foreground'>{description}</p>
      </div>
      <div className='shrink-0'>{action}</div>
    </div>
  )
}
