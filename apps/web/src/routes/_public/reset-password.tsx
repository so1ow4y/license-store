import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, KeyRound, Loader2, ShieldQuestion } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { ApiError } from '@/lib/api/client'
import { useT } from '@/lib/i18n'
import { confirmPasswordReset } from '@/features/auth/api'
import {
  PASSWORD_MIN,
  linkTokenSearchSchema,
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from '@/features/auth/schemas'
import { ApiErrorText } from '@/components/api-error-text'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/**
 * Установка нового пароля по ссылке из письма.
 *
 * АДРЕС МАРШРУТА МЕНЯТЬ НЕЛЬЗЯ: письмо подставляет
 * `${frontendUrl}/reset-password?token=...` (`auth.service.ts:545`).
 * Ссылка живёт час — она даёт полный доступ к аккаунту и всё это время
 * лежит в почтовом ящике.
 */
export const Route = createFileRoute('/_public/reset-password')({
  validateSearch: linkTokenSearchSchema,
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const t = useT()

  /**
   * Поле кода второго фактора появляется не сразу, а по ответу сервера.
   *
   * Знать заранее, включена ли у владельца ссылки 2FA, фронт не может и не
   * должен: это разглашение настроек чужого аккаунта любому, кто раздобыл
   * ссылку. Поэтому первый заход идёт без кода, и только `TWO_FACTOR_REQUIRED`
   * раскрывает поле.
   */
  const [twoFactorNeeded, setTwoFactorNeeded] = useState(false)

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', passwordConfirm: '', twoFactorCode: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: ResetPasswordFormValues) =>
      confirmPasswordReset({
        token: token!,
        newPassword: values.newPassword,
        twoFactorCode: twoFactorNeeded ? values.twoFactorCode : undefined,
      }),
    onError: (error) => {
      if (!(error instanceof ApiError)) return

      // Это не отказ, а требование доследующего шага: токен сброса НЕ погашен
      // (сервер бросает исключение до `updateMany`), форму можно отправить
      // повторно с кодом.
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        setTwoFactorNeeded(true)
        form.setFocus('twoFactorCode')
        return
      }

      if (error.code === 'TWO_FACTOR_INVALID') {
        form.setError('twoFactorCode', {
          message: t('resetPassword.error.twoFactorInvalid'),
        })
      }
    },
  })

  // Ссылка без токена: восстановить его неоткуда, отправлять нечего.
  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('resetPassword.noToken.title')}</CardTitle>
          <CardDescription>
            {t('resetPassword.noToken.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <p className='text-sm text-muted-foreground'>
            {/* Хвост `?token=…` остаётся в разметке: это не текст, а образец
                адреса — он одинаков на любом языке и набран моноширинным. */}
            {t('resetPassword.noToken.body')}{' '}
            <code className='text-xs'>?token=…</code>.
          </p>
        </CardContent>
        <CardFooter>
          <Button asChild className='w-full'>
            <Link to='/forgot-password'>
              {t('resetPassword.action.requestNewLink')}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (mutation.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <div className='pb-2'>
            <CheckCircle2 className='size-6 text-primary' />
          </div>
          <CardTitle>{t('resetPassword.done.title')}</CardTitle>
          <CardDescription>
            {t('resetPassword.done.description')}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className='w-full'>
            <Link to='/login'>{t('resetPassword.done.action')}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  const error = mutation.error
  const apiError = error instanceof ApiError ? error : null
  const linkDead = apiError?.code === 'TOKEN_INVALID'
  // TWO_FACTOR_REQUIRED уже отработан раскрытием поля — как ошибку не рисуем.
  const showError =
    apiError !== null &&
    apiError.code !== 'TWO_FACTOR_REQUIRED' &&
    apiError.code !== 'TWO_FACTOR_INVALID' &&
    !linkDead

  // Ссылка мертва: истекла (час), уже использована или отозвана. Единственный
  // выполнимый шаг — запросить новую, поэтому форму убираем совсем.
  if (linkDead) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('resetPassword.linkDead.title')}</CardTitle>
          <CardDescription>
            {t('resetPassword.linkDead.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>
            {t('resetPassword.linkDead.body')}
          </p>
        </CardContent>
        <CardFooter>
          <Button asChild className='w-full'>
            <Link to='/forgot-password'>
              {t('resetPassword.action.requestNewLink')}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          <KeyRound className='size-6 text-muted-foreground' />
        </div>
        <CardTitle>{t('resetPassword.title')}</CardTitle>
        <CardDescription>{t('resetPassword.description')}</CardDescription>
      </CardHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <CardContent className='space-y-4'>
            {twoFactorNeeded && (
              <Alert>
                <ShieldQuestion />
                <AlertTitle>{t('resetPassword.twoFactor.title')}</AlertTitle>
                <AlertDescription>
                  {t('resetPassword.twoFactor.description')}
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name='newPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('resetPassword.field.newPassword.label')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete='new-password'
                      autoFocus
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('auth.field.password.hint', { min: PASSWORD_MIN })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='passwordConfirm'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.field.passwordConfirm.label')}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete='new-password'
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {twoFactorNeeded && (
              <FormField
                control={form.control}
                name='twoFactorCode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('resetPassword.field.twoFactorCode.label')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        inputMode='text'
                        autoComplete='one-time-code'
                        placeholder='123456'
                        disabled={mutation.isPending}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('resetPassword.field.twoFactorCode.hint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {showError && <ApiErrorText error={error} />}
          </CardContent>

          <CardFooter className='flex-col gap-3 pt-6'>
            <Button
              type='submit'
              className='w-full'
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className='animate-spin' />}
              {t('resetPassword.action.submit')}
            </Button>
            <Link
              to='/login'
              className='text-sm text-muted-foreground underline-offset-4 hover:underline'
            >
              {t('auth.action.backToLogin')}
            </Link>
          </CardFooter>
        </form>
      </Form>
    </Card>
  )
}
