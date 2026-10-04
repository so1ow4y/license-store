import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Loader2, UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { ApiError } from '@/lib/api/client'
import { getLocale, useT, type TFunction } from '@/lib/i18n'
import { register as registerRequest } from '@/features/auth/api'
import {
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  registerSchema,
  type RegisterFormValues,
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
 * Регистрация по логину и паролю.
 *
 * Автологина после успеха НЕТ и быть не может: сервер намеренно не выдаёт
 * токены, ссылка подтверждения уходит только письмом. Поэтому финал —
 * терминальный экран `/register/check-email`.
 */
export const Route = createFileRoute('/_public/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const t = useT()

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      passwordConfirm: '',
    },
  })

  const mutation = useMutation({
    mutationFn: (values: RegisterFormValues) =>
      registerRequest({
        username: values.username,
        email: values.email,
        password: values.password,
        // Язык интерфейса сообщаем серверу явно, иначе письмо уйдёт на языке
        // по умолчанию из настроек платформы. Берём текущий, а не константу:
        // письмо подтверждения должно прийти на том языке, на котором человек
        // только что заполнял форму.
        locale: getLocale(),
      }),
    onSuccess: () => {
      void navigate({ to: '/register/check-email', replace: true })
    },
  })

  const apiError = mutation.error instanceof ApiError ? mutation.error : null

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          <UserPlus className='size-6 text-muted-foreground' />
        </div>
        <CardTitle>{t('register.title')}</CardTitle>
        <CardDescription>{t('register.description')}</CardDescription>
      </CardHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <CardContent className='space-y-4'>
            <FormField
              control={form.control}
              name='username'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.field.username.label')}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete='username'
                      autoFocus
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {/* Числа подставляются, а не склеиваются в JSX: порядок
                        слов вокруг них в другом языке свой. */}
                    {t('register.field.username.hint', {
                      min: USERNAME_MIN,
                      max: USERNAME_MAX,
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('register.field.email.hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.field.password.label')}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete='new-password'
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

            <RegisterFailure error={apiError} t={t} />
          </CardContent>

          <CardFooter className='flex-col gap-3 pt-6'>
            <Button
              type='submit'
              className='w-full'
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className='animate-spin' />}
              {t('register.action.submit')}
            </Button>
            <div className='flex flex-col items-center gap-2 text-sm'>
              <Link
                to='/login'
                className='text-muted-foreground underline-offset-4 hover:underline'
              >
                {t('auth.action.haveAccount')}
              </Link>
              <Link
                to='/register/key'
                className='text-muted-foreground underline-offset-4 hover:underline'
              >
                {t('register.action.withKey')}
              </Link>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  )
}

/**
 * `ALREADY_EXISTS` намеренно не говорит, что именно занято — логин или почта.
 * Иначе форма регистрации превращается в перечислитель существующих адресов.
 * Поэтому текст обязан предложить оба действия сразу.
 */
function RegisterFailure({
  error,
  t,
}: {
  error: ApiError | null
  t: TFunction
}) {
  if (!error) return null

  if (error.code === 'ALREADY_EXISTS') {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('register.error.alreadyExists.title')}</AlertTitle>
        <AlertDescription>
          <p>{t('register.error.alreadyExists.body')}</p>
          <div className='flex flex-wrap gap-3 pt-1'>
            <Link
              to='/login'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              {t('auth.action.signIn')}
            </Link>
            <Link
              to='/forgot-password'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              {t('register.error.alreadyExists.action.reset')}
            </Link>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (error.status === 429) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('register.error.rateLimited.title')}</AlertTitle>
        <AlertDescription>
          {t('register.error.rateLimited.body')}
        </AlertDescription>
      </Alert>
    )
  }

  return <ApiErrorText error={error} />
}
