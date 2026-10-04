import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Trash2, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format/date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminErrorText } from '@/features/admin/error-text'
import { ipBlocksQueryOptions, useBlockByUsername, useCreateIpBlock, useRemoveIpBlock } from './api'

/** Срок блокировки адреса в часах; 0 — бессрочно. */
const DURATIONS = ['1', '24', '168', '720', '0'] as const

/** Блокировки: адреса и подсети, а также блокировка аккаунта по логину. */
export function BlocksPanel() {
  const { can } = useSession()
  return (
    <div className='space-y-6'>
      {can(PERMISSIONS.SECURITY_IP_BLOCK) && <IpBlocksCard />}
      {can(PERMISSIONS.USERS_BLOCK) && <BlockUserCard />}
    </div>
  )
}

function IpBlocksCard() {
  const t = useT()
  const list = useQuery(ipBlocksQueryOptions())
  const create = useCreateIpBlock()
  const remove = useRemoveIpBlock()
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>('24')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate(
      { value: value.trim(), reason: reason.trim() || undefined, expiresInHours: Number(duration) || undefined },
      {
        onSuccess: () => {
          toast.success(t('security.blocks.ipDone'))
          setValue('')
          setReason('')
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Ban className='size-4' />
          {t('security.blocks.ipTitle')}
        </CardTitle>
        <CardDescription>{t('security.blocks.ipHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <form onSubmit={onSubmit} className='flex flex-wrap gap-2'>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='203.0.113.7 / 203.0.113.0/24'
            className='w-56 font-mono'
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('security.blocks.reason')}
            maxLength={500}
            className='min-w-48 flex-1'
          />
          <Select value={duration} onValueChange={(v) => setDuration(v as (typeof DURATIONS)[number])}>
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {t(`security.blocks.duration.${d}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type='submit' variant='destructive' disabled={!value.trim() || create.isPending}>
            {t('security.blocks.block')}
          </Button>
        </form>
        <AdminErrorText error={create.error ?? remove.error} />

        {list.isPending ? (
          <Skeleton className='h-24 w-full' />
        ) : list.isError ? (
          <AdminErrorText error={list.error} />
        ) : list.data.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('security.blocks.ipEmpty')}</p>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('security.blocks.column.cidr')}</TableHead>
                  <TableHead>{t('security.blocks.reason')}</TableHead>
                  <TableHead>{t('security.blocks.column.by')}</TableHead>
                  <TableHead>{t('security.blocks.column.until')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((block) => (
                  <TableRow key={block.id}>
                    <TableCell className='font-mono text-xs'>
                      {block.cidr}
                      {!block.active && (
                        <Badge variant='outline' className='ms-2'>
                          {t('security.blocks.expired')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-sm'>{block.reason ?? '—'}</TableCell>
                    <TableCell className='text-sm'>
                      {block.createdByUsername ?? '—'}
                      <span className='block text-xs text-muted-foreground'>{formatDateTime(block.createdAt)}</span>
                    </TableCell>
                    <TableCell className='text-sm whitespace-nowrap'>
                      {block.expiresAt ? formatDateTime(block.expiresAt) : t('security.blocks.forever')}
                    </TableCell>
                    <TableCell className='text-end'>
                      <Button
                        variant='ghost'
                        size='icon'
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(block.id, { onSuccess: () => toast.success(t('security.blocks.removed')) })}
                      >
                        <Trash2 className='size-4' />
                        <span className='sr-only'>{t('security.blocks.unblock')}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BlockUserCard() {
  const t = useT()
  const block = useBlockByUsername()
  const [username, setUsername] = useState('')
  const [reason, setReason] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    block.mutate(
      { username: username.trim(), reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(t('security.blocks.userDone', { username: username.trim() }))
          setUsername('')
          setReason('')
        },
      }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          <UserX className='size-4' />
          {t('security.blocks.userTitle')}
        </CardTitle>
        <CardDescription>{t('security.blocks.userHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <form onSubmit={onSubmit} className='flex flex-wrap gap-2'>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('security.blocks.username')}
            className='w-56'
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('security.blocks.reason')}
            maxLength={500}
            className='min-w-48 flex-1'
          />
          <Button type='submit' variant='destructive' disabled={!username.trim() || !reason.trim() || block.isPending}>
            {t('security.blocks.block')}
          </Button>
        </form>
        <AdminErrorText error={block.error} />
      </CardContent>
    </Card>
  )
}
