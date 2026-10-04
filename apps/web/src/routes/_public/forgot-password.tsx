import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Loader2, MailQuestion, Send } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { ApiError } from '@/lib/api/client'
import { useT } from '@/lib/i18n'
import { requestPasswordReset } from '@/features/auth/api'
import {
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from '@/features/auth/schemas'
import { ApiErrorText } from '@/components/api-error-text'
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/**
 * Запрос ссылки на сброс пароля.
 *
 * Сервер отвечает успехом ВСЕГДА — зарегистрирован адрес или нет. Экран
 * обязан вести себя так же: любое различие (другой текст, другая задержка,
 * подсказка «адрес не найден») превратило бы форму в бесплатную проверялку
 * «есть ли у вас аккаунт на этой платформе».
 */
export const Route = createFileRoute('/_public/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const t = useT()
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: ForgotPasswordFormValues) =>
      requestPasswordReset(values.email),
  })

  if (mutation.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <div className='pb-2'>
            <Send className='size-6 text-primary' />
          </div>
          <CardTitle>{t('forgotPassword.sent.title')}</CardTitle>
          <CardDescription>
            {t('forgotPassword.sent.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <ul className='list-inside list-disc space-y-1 text-sm text-muted-foreground'>
            <li>{t('forgotPassword.sent.note.expiry')}</li>
            <li>{t('forgotPassword.sent.note.delay')}</li>
            <li>{t('forgotPassword.sent.note.twoFactor')}</li>
          </ul>
          <p className='text-sm text-muted-foreground'>
            {t('forgotPassword.sent.privacy')}
          </p>
        </CardContent>
        <CardFooter className='flex-col gap-3'>
          <Button asChild variant='outline' className='w-full'>
            <Link to='/login'>{t('auth.action.backToLogin')}</Link>
          </Button>
          <button
            type='button'
            className='text-sm text-muted-foreground underline-offset-4 hover:underline'
            onClick={() => mutation.reset()}
          >
            {t('forgotPassword.sent.action.another')}
          </button>
        </CardFooter>
      </Card>
    )
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error : null

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          <MailQuestion className='size-6 text-muted-foreground' />
        </div>
        <CardTitle>{t('forgotPassword.title')}</CardTitle>
        <CardDescription>{t('forgotPassword.description')}</CardDescription>
      </CardHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <CardContent className='space-y-4'>
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.field.email.label')}</FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      autoComplete='email'
                      autoFocus
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {apiError?.status === 429 ? (
              <Alert variant='destructive'>
                <AlertTitle>
                  {t('forgotPassword.error.rateLimited.title')}
                </AlertTitle>
                <AlertDescription>
                  {t('forgotPassword.error.rateLimited.body')}
                </AlertDescription>
              </Alert>
            ) : (
              <ApiErrorText error={apiError} />
            )}
          </CardContent>

          <CardFooter className='flex-col gap-3 pt-6'>
            <Button
              type='submit'
              className='w-full'
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className='animate-spin' />}
              {t('forgotPassword.action.submit')}
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
