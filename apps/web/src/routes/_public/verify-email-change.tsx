import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { messageForCode } from '@/lib/api/error-codes'
import { useT } from '@/lib/i18n'
import { linkTokenSearchSchema } from '@/features/auth/schemas'
import { confirmEmailChange } from '@/features/profile/api'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Подтверждение новой почты по ссылке из письма. Адрес маршрута зашит в
 * письмо (`auth.service.ts`, requestEmailChange) — менять нельзя.
 */
export const Route = createFileRoute('/_public/verify-email-change')({
  validateSearch: linkTokenSearchSchema,
  component: VerifyEmailChangePage,
})

function VerifyEmailChangePage() {
  const { token } = Route.useSearch()
  const t = useT()

  // Запрос, а не мутация: двойной монтаж в режиме разработки не должен слать
  // одноразовый токен дважды.
  const query = useQuery({
    queryKey: ['auth', 'email-change', token],
    queryFn: () => confirmEmailChange(token!),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const error = query.error instanceof ApiError ? query.error : null
  const state = !token ? 'noToken' : query.isPending ? 'pending' : query.isSuccess ? 'done' : 'failed'

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          {state === 'pending' ? (
            <Loader2 className='size-6 animate-spin text-muted-foreground' />
          ) : state === 'done' ? (
            <CheckCircle2 className='size-6 text-primary' />
          ) : (
            <MailWarning className='size-6 text-destructive' />
          )}
        </div>
        <CardTitle>{t(`emailChange.${state}.title`)}</CardTitle>
        <CardDescription>
          {state === 'failed' && error?.code !== 'TOKEN_INVALID'
            ? messageForCode(error?.code ?? 'UNKNOWN_ERROR', error?.message)
            : t(`emailChange.${state}.description`)}
        </CardDescription>
      </CardHeader>
      {state !== 'pending' && (
        <CardFooter>
          <Button asChild className='w-full'>
            <Link to='/settings/profile'>{t('emailChange.toProfile')}</Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
