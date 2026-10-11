import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ExternalLink, Search, ShieldCheck, X } from 'lucide-react'
import { z } from 'zod'
import { has, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ACTIVE_ROW, CURSOR_ROW, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  BulkBar,
  BulkConfirmDialog,
  PageCheckbox,
  RowCheckbox,
  toastBulkResult,
  useSelection,
  type BulkResult,
} from '@/features/admin/bulk'
import { ALL_TIME, DateRangeFilter, type DateRange } from '@/features/admin/date-range'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { withTerm } from '@/features/admin-security/api'
import {
  USER_SEARCH_FIELDS,
  USER_STATUSES,
  adminRolesQueryOptions,
  adminUserQueryOptions,
  adminUsersQueryOptions,
  useBlockUsersIps,
  useBulkUsers,
  type UserStatus,
} from '@/features/admin-users/api'
import { UserStatusBadge } from '@/features/admin-users/status-badge'
import { UserDetails } from '@/features/admin-users/user-details'
import { formatDateTime } from '@/lib/format/date'

const PAGE = 25
const ANY = 'ANY'

/**
 * Пользователи: поиск «поле:значение» (в том числе по IP), фильтры статуса и
 * роли. Клик по строке открывает карточку в панели справа (`?open=`): правка,
 * блокировка, роли, адреса — не уходя из списка.
 */
export const Route = createFileRoute('/_app/admin/users/')({
  validateSearch: z.object({ q: z.string().max(1000).optional(), open: z.string().uuid().optional() }),
  beforeLoad: ({ context }) => {
    if (!has(context.me.permissions, PERMISSIONS.USERS_READ_ANY)) throw redirect({ to: '/403' })
  },
  component: AdminUsersPage,
})

function AdminUsersPage() {
  const t = useT()
  const { can } = useSession()
  const { q: urlQ, open } = Route.useSearch()
  const navigate = Route.useNavigate()
  const q = urlQ ?? ''

  function openUser(id: string | null) {
    void navigate({ search: (prev) => ({ ...prev, open: id ?? undefined }), replace: true })
  }
  const [draft, setDraft] = useState(q)
  const [status, setStatus] = useState<UserStatus | typeof ANY>(ANY)
  const [role, setRole] = useState<string>(ANY)
  const [range, setRange] = useState<DateRange>(ALL_TIME)
  const [skip, setSkip] = useState(0)
  const canSeeIps = can(PERMISSIONS.SECURITY_IPS_READ)
  const canBlock = can(PERMISSIONS.USERS_BLOCK)
  const canBlockIps = can(PERMISSIONS.SECURITY_IP_BLOCK)
  const canSelect = canBlock || canBlockIps

  useEffect(() => setDraft(q), [q])
  useEffect(() => setSkip(0), [q, status, role, range])

  const fields = USER_SEARCH_FIELDS.filter((f) => f !== 'ip' || canSeeIps)
  const roles = useQuery(adminRolesQueryOptions())
  const query = useQuery({
    ...adminUsersQueryOptions({
      q: q || undefined,
      status: status === ANY ? undefined : status,
      role: role === ANY ? undefined : role,
      from: range.from,
      to: range.to,
      skip,
      take: PAGE,
    }),
    placeholderData: keepPreviousData,
  })

  const selection = useSelection()
  const [bulkAction, setBulkAction] = useState<'blockUsers' | 'unblockUsers' | 'blockUserIps' | null>(null)
  const bulkUsers = useBulkUsers()
  const blockIps = useBlockUsersIps()
  const bulkMutation = bulkAction === 'blockUserIps' ? blockIps : bulkUsers

  function runBulk(input: { reason?: string; expiresInHours?: number }) {
    const done = {
      onSuccess: (result: BulkResult) => {
        toastBulkResult(result)
        setBulkAction(null)
        selection.clear()
      },
    }
    if (bulkAction === 'blockUserIps') blockIps.mutate({ ids: selection.ids, ...input }, done)
    else if (bulkAction) bulkUsers.mutate({ action: bulkAction === 'blockUsers' ? 'block' : 'unblock', ids: selection.ids, reason: input.reason }, done)
  }

  function search(next: string) {
    void navigate({ search: (prev) => ({ ...prev, q: next.trim() || undefined }) })
  }

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const cursor = useListHotkeys({
    ids: items.map((u) => u.id),
    openedId: open ?? null,
    onOpen: openUser,
    onClose: () => openUser(null),
  })

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('admin.users.title')} description={t('admin.users.description')} />

      <div className='space-y-2'>
        <div className='flex flex-wrap items-end gap-2'>
          <form
            className='flex min-w-72 flex-1 gap-2'
            onSubmit={(e) => {
              e.preventDefault()
              search(draft)
            }}
          >
            <div className='relative flex-1'>
              <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={draft}
                placeholder={canSeeIps ? t('admin.users.queryPlaceholderIp') : t('admin.users.queryPlaceholder')}
                className='pl-8 font-mono text-sm'
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <Button type='submit' variant='outline'>
              {t('common.action.search')}
            </Button>
            {q && (
              <Button type='button' variant='ghost' onClick={() => search('')}>
                <X className='size-4' />
                <span className='sr-only'>{t('common.action.resetFilters')}</span>
              </Button>
            )}
          </form>
          <Select value={status} onValueChange={(v) => setStatus(v as UserStatus | typeof ANY)}>
            <SelectTrigger className='w-48'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.users.anyStatus')}</SelectItem>
              {USER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`admin.users.status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className='w-52'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.users.anyRole')}</SelectItem>
              {(roles.data ?? []).map((r) => (
                <SelectItem key={r.slug} value={r.slug}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        <div className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
          <span>{t('siem.fields')}</span>
          {fields.map((field) => (
            <button
              key={field}
              type='button'
              onClick={() => setDraft((d) => `${d.trim()} ${field}:`.trim())}
              className='rounded-md border px-1.5 py-0.5 font-mono hover:bg-accent hover:text-foreground'
            >
              {field}:
            </button>
          ))}
          <span className='ms-1'>{t('siem.syntax')}</span>
        </div>
      </div>

      <BulkBar selection={selection}>
        {canBlock && (
          <>
            <Button size='sm' variant='destructive' onClick={() => setBulkAction('blockUsers')}>
              {t('admin.bulk.blockUsers')}
            </Button>
            <Button size='sm' variant='outline' onClick={() => setBulkAction('unblockUsers')}>
              {t('admin.bulk.unblockUsers')}
            </Button>
          </>
        )}
        {canBlockIps && (
          <Button size='sm' variant='outline' onClick={() => setBulkAction('blockUserIps')}>
            {t('admin.bulk.blockUserIps')}
          </Button>
        )}
      </BulkBar>

      {query.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : items.length === 0 ? (
        <Alert>
          <AlertDescription>{t('admin.users.empty')}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  {canSelect && (
                    <TableHead className='w-8'>
                      <PageCheckbox selection={selection} pageIds={items.map((u) => u.id)} />
                    </TableHead>
                  )}
                  <TableHead>{t('admin.users.column.user')}</TableHead>
                  <TableHead>{t('admin.users.column.roles')}</TableHead>
                  <TableHead>{t('admin.users.column.status')}</TableHead>
                  {canSeeIps && <TableHead>{t('admin.users.column.ips')}</TableHead>}
                  <TableHead>{t('admin.users.column.licenses')}</TableHead>
                  <TableHead>{t('admin.users.column.lastLogin')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((user) => (
                  <TableRow
                    key={user.id}
                    data-row-id={user.id}
                    data-state={selection.has(user.id) ? 'selected' : undefined}
                    className={cn('cursor-pointer', open === user.id && ACTIVE_ROW, cursor === user.id && CURSOR_ROW)}
                    onClick={() => openUser(open === user.id ? null : user.id)}
                  >
                    {canSelect && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <RowCheckbox selection={selection} id={user.id} />
                      </TableCell>
                    )}
                    <TableCell>
                      <span className='inline-flex items-center gap-1 font-medium'>
                        {user.username}
                        {user.twoFactorEnabled && <ShieldCheck className='size-3.5 text-muted-foreground' />}
                      </span>
                      <span className='block text-xs text-muted-foreground'>{user.email ?? '—'}</span>
                    </TableCell>
                    <TableCell className='space-x-1' onClick={(e) => e.stopPropagation()}>
                      {user.roles.map((r) => (
                        <button key={r.slug} type='button' onClick={() => search(withTerm(q, 'role', r.slug))}>
                          <Badge variant='outline'>{r.name}</Badge>
                        </button>
                      ))}
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={user.status} />
                    </TableCell>
                    {canSeeIps && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className='flex max-w-64 flex-wrap gap-1'>
                          {(user.ips?.recent ?? []).map((ip) => (
                            <button
                              key={ip}
                              type='button'
                              onClick={() => search(withTerm(q, 'ip', ip))}
                              className='rounded border px-1.5 py-0.5 font-mono text-[11px] hover:border-primary hover:text-primary'
                              title={t('admin.users.searchByIp')}
                            >
                              {ip}
                            </button>
                          ))}
                          {(user.ips?.count ?? 0) > (user.ips?.recent.length ?? 0) && (
                            <span className='text-xs text-muted-foreground'>
                              +{(user.ips?.count ?? 0) - (user.ips?.recent.length ?? 0)}
                            </span>
                          )}
                          {!user.ips?.count && <span className='text-xs text-muted-foreground'>—</span>}
                        </div>
                      </TableCell>
                    )}
                    <TableCell>{user.licenses}</TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className='flex items-center justify-between text-sm text-muted-foreground'>
            <span>{t('admin.users.total', { total })}</span>
            <div className='flex gap-2'>
              <Button variant='outline' size='sm' disabled={skip === 0} onClick={() => setSkip(skip - PAGE)}>
                {t('common.action.prevPage')}
              </Button>
              <Button variant='outline' size='sm' disabled={skip + PAGE >= total} onClick={() => setSkip(skip + PAGE)}>
                {t('common.action.nextPage')}
              </Button>
            </div>
          </div>
        </>
      )}

      <BulkConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBulkAction(null)
            bulkMutation.reset()
          }
        }}
        title={bulkAction ? t(`admin.bulk.title.${bulkAction}`) : ''}
        description={bulkAction === 'blockUserIps' ? t('admin.bulk.ipsHint') : undefined}
        count={selection.size}
        reason={bulkAction === 'unblockUsers' ? undefined : bulkAction === 'blockUserIps' ? 'optional' : 'required'}
        duration={bulkAction === 'blockUserIps'}
        destructive={bulkAction !== 'unblockUsers'}
        pending={bulkMutation.isPending}
        error={bulkMutation.error}
        onConfirm={runBulk}
      />

      <UserPanel userId={open ?? null} onClose={() => openUser(null)} />
    </div>
  )
}

/** Карточка пользователя в панели справа; «открыть страницей» — для прямой ссылки. */
function UserPanel({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const t = useT()
  const query = useQuery({ ...adminUserQueryOptions(userId ?? ''), enabled: Boolean(userId) })
  if (!userId) return null
  return (
    <SidePanel
      open
      onClose={onClose}
      title={query.data?.username ?? t('common.state.loading')}
      subtitle={query.data?.email ?? undefined}
      badges={query.data && <UserStatusBadge status={query.data.status} />}
      actions={
        <Button asChild variant='ghost' size='icon' title={t('panel.openPage')}>
          <Link to='/admin/users/$userId' params={{ userId }}>
            <ExternalLink className='size-4' />
            <span className='sr-only'>{t('panel.openPage')}</span>
          </Link>
        </Button>
      }
    >
      {query.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : (
        <UserDetails user={query.data} />
      )}
    </SidePanel>
  )
}
