import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { ApiErrorText } from '@/components/api-error-text'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useChangeEmail, useChangeUsername } from '@/features/profile/api'

/** Профиль: логин и почта. Обе смены подтверждаются текущим паролем, почта — ещё и письмом. */
export const Route = createFileRoute('/_app/settings/profile')({
  component: ProfilePage,
})

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/

function ProfilePage() {
  const t = useT()
  const { me } = useSession()

  if (!me) return <Skeleton className='h-64 w-full max-w-2xl' />

  if (!me.hasPassword) {
    return (
      <Alert className='max-w-2xl'>
        <AlertDescription className='space-y-2'>
          <p>{t('profile.needPassword')}</p>
          <Button asChild size='sm'>
            <Link to='/settings/security/password'>{t('shell.passwordRequired.action')}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='max-w-2xl space-y-6'>
      <UsernameCard current={me.username} />
      <EmailCard current={me.email} verified={me.emailVerified} pending={me.pendingEmail} />
    </div>
  )
}

function UsernameCard({ current }: { current: string }) {
  const t = useT()
  const change = useChangeUsername()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const valid = USERNAME_RE.test(username.trim())

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    change.mutate(
      { username: username.trim(), password },
      {
        onSuccess: () => {
          toast.success(t('profile.username.done'))
          setUsername('')
          setPassword('')
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.username.title')}</CardTitle>
        <CardDescription>{t('profile.username.current', { username: current })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='new-username'>{t('profile.username.new')}</Label>
            <Input
              id='new-username'
              value={username}
              maxLength={32}
              autoComplete='username'
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>{t('profile.username.rules')}</p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='username-password'>{t('profile.currentPassword')}</Label>
            <PasswordInput
              id='username-password'
              value={password}
              autoComplete='current-password'
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <ApiErrorText error={change.error} />
          <Button type='submit' disabled={!valid || !password || change.isPending}>
            {t('profile.username.action')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function EmailCard({ current, verified, pending }: { current: string | null; verified: boolean; pending: string | null }) {
  const t = useT()
  const change = useChangeEmail()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const target = email.trim()
    change.mutate(
      { email: target, password },
      {
        onSuccess: () => {
          setSentTo(target)
          setEmail('')
          setPassword('')
        },
      }
    )
  }

  const waiting = sentTo ?? pending

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.email.title')}</CardTitle>
        <CardDescription className='flex flex-wrap items-center gap-2'>
          {current ? (
            <>
              <span>{current}</span>
              {verified ? (
                <Badge variant='outline' className='gap-1'>
                  <CheckCircle2 className='size-3' />
                  {t('profile.email.verified')}
                </Badge>
              ) : (
                <Badge variant='outline'>{t('profile.email.unverified')}</Badge>
              )}
            </>
          ) : (
            t('profile.email.none')
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {waiting && (
          <Alert>
            <MailWarning className='size-4' />
            <AlertDescription>{t('profile.email.pending', { email: waiting })}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={onSubmit} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='new-email'>{t('profile.email.new')}</Label>
            <Input
              id='new-email'
              type='email'
              value={email}
              maxLength={255}
              autoComplete='email'
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>{t('profile.email.hint')}</p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='email-password'>{t('profile.currentPassword')}</Label>
            <PasswordInput
              id='email-password'
              value={password}
              autoComplete='current-password'
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <ApiErrorText error={change.error} />
          <Button type='submit' disabled={!email.includes('@') || !password || change.isPending}>
            {t('profile.email.action')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
