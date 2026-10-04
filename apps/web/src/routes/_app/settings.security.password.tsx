import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { CircleCheck, Info, ShieldAlert } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '@/lib/api/client'
import { useT, type TFunction } from '@/lib/i18n'
import { SESSION_QUERY_KEY, useSession } from '@/lib/auth/session'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  changePassword,
  setPassword,
} from '@/features/security/api'
import { ApiErrorText } from '@/components/api-error-text'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Пароль аккаунта (K5, п. 3.15 плана).
 *
 * Один маршрут на две операции. Ветка выбирается по `hasPassword` из
 * `/auth/me`, а не по догадке: у аккаунта из Discord или Telegram текущего
 * пароля нет, и требовать его в форме означало бы тупик без выхода.
 */
export const Route = createFileRoute('/_app/settings/security/password')({
  component: PasswordSettingsPage,
})

/* ------------------------------------------------------------------ */
/* Схемы                                                                */
/* ------------------------------------------------------------------ */

/**
 * Границы длины повторяют DTO сервера. Проверка на клиенте не заменяет
 * серверную, а экономит заведомо провальный запрос: сервер на каждую попытку
 * тратит около 70 мс на Argon2.
 *
 * Схемы собираются функцией, а не лежат константами модуля: константа
 * посчиталась бы один раз при загрузке файла и навсегда зафиксировала язык,
 * активный в тот момент. Тексты ошибок остались бы на старом языке даже после
 * переключения — причём именно там, где человек уже ошибся и меньше всего
 * готов разбираться.
 */
function newPasswordField(t: TFunction) {
  return z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      t('security.password.validation.tooShort', { min: PASSWORD_MIN_LENGTH })
    )
    .max(
      PASSWORD_MAX_LENGTH,
      t('security.password.validation.tooLong', { max: PASSWORD_MAX_LENGTH })
    )
}

function buildChangeSchema(t: TFunction) {
  return z
    .object({
      currentPassword: z
        .string()
        .min(1, t('security.password.validation.currentRequired')),
      newPassword: newPasswordField(t),
      confirmPassword: z
        .string()
        .min(1, t('security.password.validation.confirmRequired')),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      path: ['confirmPassword'],
      message: t('security.password.validation.mismatch'),
    })
    // Сервер ответит на это кодом PASSWORD_UNCHANGED — ловим заранее,
    // чтобы человек не ждал сетевого ответа ради очевидного.
    .refine((values) => values.newPassword !== values.currentPassword, {
      path: ['newPassword'],
      message: t('security.password.validation.unchanged'),
    })
}

function buildSetSchema(t: TFunction) {
  return z
    .object({
      password: newPasswordField(t),
      confirmPassword: z
        .string()
        .min(1, t('security.password.validation.repeatRequired')),
    })
    .refine((values) => values.password === values.confirmPassword, {
      path: ['confirmPassword'],
      message: t('security.password.validation.mismatch'),
    })
}

type ChangeValues = z.infer<ReturnType<typeof buildChangeSchema>>
type SetValues = z.infer<ReturnType<typeof buildSetSchema>>

/* ------------------------------------------------------------------ */
/* Страница                                                             */
/* ------------------------------------------------------------------ */

function PasswordSettingsPage() {
  const { me, isLoading } = useSession()

  if (isLoading || !me) {
    return (
      <div className='max-w-xl space-y-4'>
        <Skeleton className='h-8 w-56' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  return (
    <div className='max-w-xl space-y-6'>
      {me.hasPassword ? <ChangePasswordCard /> : <SetPasswordCard />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Смена пароля                                                         */
/* ------------------------------------------------------------------ */

function ChangePasswordCard() {
  const t = useT()
  const queryClient = useQueryClient()
  const [revokedSessions, setRevokedSessions] = useState<number | null>(null)

  const schema = useMemo(() => buildChangeSchema(t), [t])

  const form = useForm<ChangeValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: (result) => {
      setRevokedSessions(result.revokedSessions)
      form.reset()
      // hasPassword уже true, но перечитываем: экран способов входа рядом
      // читает тот же ответ, и расхождение между вкладками сбивает с толку.
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return
      // Ошибку кладём на конкретное поле: общий красный текст под формой
      // не подсказывает, что именно перенабрать.
      if (error.code === 'INVALID_CREDENTIALS') {
        form.setError('currentPassword', {
          message: t('security.password.error.currentInvalid'),
        })
      }
      if (error.code === 'PASSWORD_UNCHANGED') {
        form.setError('newPassword', {
          message: t('security.password.validation.unchanged'),
        })
      }
    },
  })

  // Поля уже разобраны по именам формы — второй раз тем же текстом не сорим.
  const handledByField =
    mutation.error instanceof ApiError &&
    (mutation.error.code === 'INVALID_CREDENTIALS' ||
      mutation.error.code === 'PASSWORD_UNCHANGED')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('security.password.change.title')}</CardTitle>
        <CardDescription>
          {t('security.password.change.description')}
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-4'>
        <Alert>
          <ShieldAlert className='size-4' />
          <AlertTitle>{t('security.password.change.notice.title')}</AlertTitle>
          <AlertDescription>
            {t('security.password.change.notice.description')}
          </AlertDescription>
        </Alert>

        {revokedSessions !== null && (
          <Alert>
            <CircleCheck className='size-4' />
            <AlertTitle>{t('security.password.change.done.title')}</AlertTitle>
            <AlertDescription>
              {revokedSessions > 0
                ? t('security.password.change.done.revoked', {
                    count: revokedSessions,
                  })
                : t('security.password.change.done.none')}
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form
            className='space-y-4'
            onSubmit={form.handleSubmit((values) => {
              setRevokedSessions(null)
              mutation.mutate({
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
              })
            })}
          >
            <FormField
              control={form.control}
              name='currentPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('security.password.field.current.label')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='current-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='newPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('security.password.field.new.label')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('security.password.field.length.hint', {
                      min: PASSWORD_MIN_LENGTH,
                      max: PASSWORD_MAX_LENGTH,
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='confirmPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('security.password.field.confirmNew.label')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mutation.error && !handledByField && (
              <ApiErrorText error={mutation.error} />
            )}

            <Button type='submit' disabled={mutation.isPending}>
              {mutation.isPending
                ? t('security.password.change.action.pending')
                : t('security.password.change.action.submit')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Первый пароль для аккаунта из OAuth                                  */
/* ------------------------------------------------------------------ */

function SetPasswordCard() {
  const t = useT()
  const queryClient = useQueryClient()
  const [alreadySet, setAlreadySet] = useState(false)

  const schema = useMemo(() => buildSetSchema(t), [t])

  const form = useForm<SetValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  const mutation = useMutation({
    mutationFn: setPassword,
    onSuccess: () => {
      form.reset()
      // Перечитывание обязательно: именно оно уберёт глобальный баннер
      // «задайте пароль» и переключит эту карточку в режим смены.
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'PASSWORD_ALREADY_SET') {
        // Пароль появился в другой вкладке или в соседнем запросе. Данные
        // на экране устарели — перечитываем, форма сама станет формой смены.
        setAlreadySet(true)
        void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
      }
    },
  })

  const handledSeparately =
    mutation.error instanceof ApiError &&
    mutation.error.code === 'PASSWORD_ALREADY_SET'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('security.password.set.title')}</CardTitle>
        <CardDescription>
          {t('security.password.set.description')}
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-4'>
        <Alert>
          <Info className='size-4' />
          <AlertTitle>{t('security.password.set.why.title')}</AlertTitle>
          <AlertDescription>
            <p>{t('security.password.set.why.license')}</p>
            <p>{t('security.password.set.why.other')}</p>
          </AlertDescription>
        </Alert>

        {alreadySet && (
          <Alert>
            <Info className='size-4' />
            <AlertTitle>
              {t('security.password.set.alreadySet.title')}
            </AlertTitle>
            <AlertDescription>
              {t('security.password.set.alreadySet.description')}
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form
            className='space-y-4'
            onSubmit={form.handleSubmit((values) => {
              setAlreadySet(false)
              mutation.mutate({ password: values.password })
            })}
          >
            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('security.password.field.password.label')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('security.password.field.length.hint', {
                      min: PASSWORD_MIN_LENGTH,
                      max: PASSWORD_MAX_LENGTH,
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='confirmPassword'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('security.password.field.confirm.label')}
                  </FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='new-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mutation.error && !handledSeparately && (
              <ApiErrorText error={mutation.error} />
            )}

            <Button type='submit' disabled={mutation.isPending}>
              {mutation.isPending
                ? t('security.password.set.action.pending')
                : t('security.password.set.action.submit')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
