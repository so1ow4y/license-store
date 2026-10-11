import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { KeySquare, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { ApiError } from '@/lib/api/client'
import { useT, type TFunction } from '@/lib/i18n'
import {
  acceptSession,
  isTwoFactorChallenge,
  registerWithKey,
} from '@/features/auth/api'
import { setChallenge } from '@/features/auth/challenge-store'
import {
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  registerWithKeySchema,
  type RegisterWithKeyFormValues,
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
 * Регистрация по ключу.
 *
 * Отличия от обычной регистрации, все три — следствие того, что ключ уже
 * выдан администратором и сам по себе подтверждает право
 * на доступ:
 * 1. почта необязательна;
 * 2. подтверждать адрес не требуется — аккаунт сразу ACTIVE;
 * 3. сервер отвечает парой токенов, то есть вход выполняется немедленно.
 *
 * ПОЧЕМУ ИМЯ ФАЙЛА С ПОДЧЁРКИВАНИЕМ: точка в файловом роутинге TanStack
 * означает вложенность, и `register.key.tsx` сделал бы этот экран дочерним
 * для формы регистрации, которая `<Outlet/>` не рисует. Подчёркивание
 * отключает вложенность, адрес остаётся `/register/key`.
 */
export const Route = createFileRoute('/_public/register_/key')({
  component: RegisterWithKeyPage,
})

function RegisterWithKeyPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const t = useT()

  const form = useForm<RegisterWithKeyFormValues>({
    resolver: zodResolver(registerWithKeySchema),
    defaultValues: {
      code: '',
      username: '',
      password: '',
      passwordConfirm: '',
      email: '',
    },
  })

  const mutation = useMutation({
    mutationFn: (values: RegisterWithKeyFormValues) =>
      registerWithKey({
        code: values.code,
        username: values.username,
        password: values.password,
        email: values.email,
      }),
    onSuccess: (result, values) => {
      // Ветка теоретическая, но обрабатываем её честно: сервер зовёт общий
      // completeLogin, а тот выдаёт challenge всякому, у кого включён второй
      // фактор. Отдаём challenge экрану входа — он умеет второй шаг.
      if (isTwoFactorChallenge(result)) {
        setChallenge({
          challengeToken: result.challengeToken,
          expiresIn: result.expiresIn,
          login: values.username,
        })
        void navigate({ to: '/login' })
        return
      }

      acceptSession(result)
      // Кабинет — обычный маршрут, но уходим заменой: форма регистрации
      // в истории уже бесполезна, а ключ в ней погашен.
      router.history.replace('/licenses')
    },
  })

  const apiError = mutation.error instanceof ApiError ? mutation.error : null

  return (
    <Card>
      <CardHeader>
        <div className='pb-2'>
          <KeySquare className='size-6 text-muted-foreground' />
        </div>
        <CardTitle>{t('registerKey.title')}</CardTitle>
        <CardDescription>{t('registerKey.description')}</CardDescription>
      </CardHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <CardContent className='space-y-4'>
            <FormField
              control={form.control}
              name='code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('registerKey.field.code.label')}</FormLabel>
                  <FormControl>
                    <Input
                      autoFocus
                      autoComplete='off'
                      spellCheck={false}
                      placeholder='ACDE-FGHJ-KMNP-QRTU'
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('registerKey.field.code.hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='username'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.field.username.label')}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete='username'
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('registerKey.field.username.hint', {
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

            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('auth.field.email.label')}{' '}
                    <span className='font-normal text-muted-foreground'>
                      {t('registerKey.field.email.optional')}
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      autoComplete='email'
                      disabled={mutation.isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('registerKey.field.email.hint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <KeyFailure error={apiError} t={t} />
          </CardContent>

          <CardFooter className='flex-col gap-3 pt-6'>
            <Button
              type='submit'
              className='w-full'
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className='animate-spin' />}
              {t('registerKey.action.submit')}
            </Button>
            <div className='flex flex-col items-center gap-2 text-sm'>
              <Link
                to='/register'
                className='text-muted-foreground underline-offset-4 hover:underline'
              >
                {t('registerKey.action.regular')}
              </Link>
              <Link
                to='/login'
                className='text-muted-foreground underline-offset-4 hover:underline'
              >
                {t('auth.action.haveAccount')}
              </Link>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  )
}

/**
 * Три разных отказа по ключу — три разных действия, поэтому и текста три.
 * Свести их в «ключ не подошёл» значит заставить человека гадать, идти ему
 * к продавцу, в поддержку или просто перепечатать код.
 */
function KeyFailure({
  error,
  t,
}: {
  error: ApiError | null
  t: TFunction
}) {
  if (!error) return null

  if (error.code === 'KEY_INVALID') {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('registerKey.error.keyInvalid.title')}</AlertTitle>
        <AlertDescription>
          {t('registerKey.error.keyInvalid.body')}
        </AlertDescription>
      </Alert>
    )
  }

  if (error.code === 'KEY_ALREADY_USED') {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('registerKey.error.keyUsed.title')}</AlertTitle>
        <AlertDescription>
          {t('registerKey.error.keyUsed.body')}
        </AlertDescription>
      </Alert>
    )
  }

  if (error.code === 'KEY_EXPIRED') {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('registerKey.error.keyExpired.title')}</AlertTitle>
        <AlertDescription>
          {t('registerKey.error.keyExpired.body')}
        </AlertDescription>
      </Alert>
    )
  }

  if (error.code === 'ALREADY_EXISTS') {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('registerKey.error.alreadyExists.title')}</AlertTitle>
        <AlertDescription>
          {t('registerKey.error.alreadyExists.body')}
        </AlertDescription>
      </Alert>
    )
  }

  return <ApiErrorText error={error} />
}
