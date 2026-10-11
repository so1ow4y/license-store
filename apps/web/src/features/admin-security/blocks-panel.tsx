import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Ban, Flame, Network, Server, Trash2, UserX, Users } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime, formatRelative } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { ACTIVE_ROW, CURSOR_ROW, PanelFacts, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminErrorText } from '@/features/admin/error-text'
import { ipBlocksQueryOptions, useBlockByUsername, useCreateIpBlock, useRemoveIpBlock, type IpBlock } from './api'
import { BLOCK_LEVELS, edgeStatusQueryOptions, type BlockLevel } from './center-api'
import { parsePorts, Segmented } from './controls'
import { LevelBadge } from './labels'

/** Срок блокировки адреса в часах; 0 — бессрочно. */
const DURATIONS = ['1', '24', '168', '720', '0'] as const

/** Блокировки: адреса и подсети, а также блокировка аккаунта по логину. */
export function BlocksPanel() {
  const { can } = useSession()
  return (
    <div className='space-y-6'>
      {can(PERMISSIONS.SECURITY_IP_BLOCK) && <LevelsCard />}
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
  const [level, setLevel] = useState<BlockLevel>('EDGE')
  const [portsText, setPortsText] = useState('')
  const ports = level === 'FIREWALL' ? parsePorts(portsText) : []
  const [openedId, setOpenedId] = useState<string | null>(null)
  const opened = list.data?.find((b) => b.id === openedId) ?? null
  const cursor = useListHotkeys({
    ids: (list.data ?? []).map((b) => b.id),
    openedId,
    onOpen: setOpenedId,
    onClose: () => setOpenedId(null),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate(
      { value: value.trim(), reason: reason.trim() || undefined, expiresInHours: Number(duration) || undefined, level, ports: ports ?? [] },
      {
        onSuccess: () => {
          toast.success(t('security.blocks.ipDone'))
          setValue('')
          setReason('')
          setPortsText('')
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
          <Button type='submit' variant='destructive' disabled={!value.trim() || ports === null || create.isPending}>
            {t('security.blocks.block')}
          </Button>
          <div className='flex w-full flex-wrap items-center gap-2'>
            <span className='text-sm text-muted-foreground'>{t('sec.level.where')}</span>
            <Segmented
              size='sm'
              value={level}
              onChange={setLevel}
              options={BLOCK_LEVELS.map((l) => ({ value: l, label: t(`sec.level.${l}`), hint: t(`sec.level.${l}.hint`) }))}
            />
            {level === 'FIREWALL' && (
              <Input
                value={portsText}
                onChange={(e) => setPortsText(e.target.value)}
                placeholder={t('sec.level.portsPlaceholder')}
                aria-invalid={ports === null}
                className='h-8 w-56 font-mono text-sm'
              />
            )}
          </div>
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
                  <TableHead>{t('sec.level.column')}</TableHead>
                  <TableHead>{t('security.blocks.reason')}</TableHead>
                  <TableHead>{t('security.blocks.column.by')}</TableHead>
                  <TableHead>{t('security.blocks.column.until')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((block) => (
                  <TableRow
                    key={block.id}
                    data-row-id={block.id}
                    className={cn('cursor-pointer', openedId === block.id && ACTIVE_ROW, cursor === block.id && CURSOR_ROW)}
                    onClick={() => setOpenedId(openedId === block.id ? null : block.id)}
                  >
                    <TableCell className='font-mono text-xs'>
                      {block.cidr}
                      {!block.active && (
                        <Badge variant='outline' className='ms-2'>
                          {t('security.blocks.expired')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <LevelBadge level={block.level} ports={block.ports} />
                    </TableCell>
                    <TableCell className='text-sm'>
                      {block.reason ?? '—'}
                      {block.source === 'rule' && (
                        <Badge variant='outline' className='ms-2'>
                          {t('sec.blocks.byRule')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-sm'>
                      {block.createdByUsername ?? '—'}
                      <span className='block text-xs text-muted-foreground'>{formatDateTime(block.createdAt)}</span>
                    </TableCell>
                    <TableCell className='text-sm whitespace-nowrap'>
                      {block.expiresAt ? formatDateTime(block.expiresAt) : t('security.blocks.forever')}
                    </TableCell>
                    <TableCell className='text-end' onClick={(e) => e.stopPropagation()}>
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
      {opened && (
        <IpBlockPanel
          block={opened}
          onClose={() => setOpenedId(null)}
          onRemove={() =>
            remove.mutate(opened.id, {
              onSuccess: () => {
                toast.success(t('security.blocks.removed'))
                setOpenedId(null)
              },
            })
          }
          removing={remove.isPending}
        />
      )}
    </Card>
  )
}

/** Блокировка адреса в панели: кто, когда, за что, до какого срока; снять или найти затронутых. */
function IpBlockPanel({
  block,
  onClose,
  onRemove,
  removing,
}: {
  block: IpBlock
  onClose: () => void
  onRemove: () => void
  removing: boolean
}) {
  const t = useT()
  const { can } = useSession()
  return (
    <SidePanel
      open
      onClose={onClose}
      title={<span className='font-mono'>{block.cidr}</span>}
      subtitle={block.reason ?? undefined}
      badges={
        block.active ? (
          <Badge variant='destructive'>{t('security.blocks.active')}</Badge>
        ) : (
          <Badge variant='outline'>{t('security.blocks.expired')}</Badge>
        )
      }
    >
      <div className='flex flex-wrap gap-2'>
        <Button variant='outline' disabled={removing} onClick={onRemove}>
          <Trash2 className='size-4' />
          {t('security.blocks.unblock')}
        </Button>
        {can(PERMISSIONS.SECURITY_IPS_READ) && can(PERMISSIONS.USERS_READ_ANY) && (
          <Button asChild variant='outline'>
            <Link to='/admin/users' search={{ q: `ip:${block.cidr}` }}>
              <Users className='size-4' />
              {t('security.blocks.findUsers')}
            </Link>
          </Button>
        )}
      </div>
      <PanelFacts
        rows={[
          [t('security.blocks.column.cidr'), <span className='font-mono'>{block.cidr}</span>],
          [t('sec.level.column'), <LevelBadge level={block.level} ports={block.ports} />],
          [t('security.blocks.reason'), block.reason ?? '—'],
          [t('security.blocks.column.by'), block.createdByUsername ?? (block.source === 'rule' ? t('sec.blocks.byRule') : '—')],
          [t('security.blocks.created'), formatDateTime(block.createdAt)],
          [t('security.blocks.column.until'), block.expiresAt ? formatDateTime(block.expiresAt) : t('security.blocks.forever')],
        ]}
      />
    </SidePanel>
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

const LEVEL_ICON = { FIREWALL: Flame, EDGE: Network, APP: Server } as const

/**
 * Уровни блокировки по модели OSI — путь пакета слева направо. Чем левее,
 * тем раньше отсекается трафик и тем дешевле атака для сервера. Под каждым
 * уровнем — сколько блоков на нём и жив ли агент, который его применяет.
 */
function LevelsCard() {
  const t = useT()
  const blocks = useQuery(ipBlocksQueryOptions())
  const edge = useQuery(edgeStatusQueryOptions())
  const active = (blocks.data ?? []).filter((b) => b.active)
  const agent = (name: 'nginx' | 'firewall') => edge.data?.agents.find((a) => a.agent === name)

  const status = (level: BlockLevel) => {
    if (level === 'APP') return { tone: 'ok', text: t('sec.levels.appAlways') }
    if (!edge.data) return { tone: 'muted', text: '…' }
    if (!edge.data.configured) return { tone: 'warn', text: t('sec.levels.noToken') }
    const seen = agent(level === 'EDGE' ? 'nginx' : 'firewall')
    if (seen?.online) return { tone: 'ok', text: t('sec.levels.online', { when: formatRelative(seen.lastSeenAt) }) }
    if (seen?.lastSeenAt) return { tone: 'warn', text: t('sec.levels.stale', { when: formatRelative(seen.lastSeenAt) }) }
    return { tone: 'warn', text: t(level === 'EDGE' ? 'sec.levels.nginxOff' : 'sec.levels.firewallOff') }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('sec.levels.title')}</CardTitle>
        <CardDescription>{t('sec.levels.hint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='grid gap-3 md:grid-cols-3'>
          {(['FIREWALL', 'EDGE', 'APP'] as const).map((level, index) => {
            const Icon = LEVEL_ICON[level]
            const state = status(level)
            const count = active.filter((b) => b.level === level).length
            return (
              <div key={level} className='relative rounded-lg border p-3'>
                {index < 2 && (
                  <span className='absolute top-1/2 -right-3 z-10 hidden -translate-y-1/2 text-muted-foreground md:block' aria-hidden>
                    →
                  </span>
                )}
                <div className='flex items-center gap-2'>
                  <Icon className='size-4 text-muted-foreground' />
                  <span className='font-medium'>{t(`sec.level.${level}`)}</span>
                  <Badge variant='outline' className='ms-auto font-mono'>
                    {t(`sec.levels.osi.${level}`)}
                  </Badge>
                </div>
                <p className='mt-1.5 text-xs text-muted-foreground'>{t(`sec.level.${level}.hint`)}</p>
                <div className='mt-2 flex items-center justify-between gap-2 text-xs'>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5',
                      state.tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : state.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', state.tone === 'ok' ? 'bg-emerald-500' : state.tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground')} />
                    {state.text}
                  </span>
                  <span className='text-muted-foreground'>{t('sec.levels.count', { n: count })}</span>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}