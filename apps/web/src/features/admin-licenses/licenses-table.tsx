import { Fragment, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api/client'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyButton } from '@/components/copy-button'
import {
  BulkBar,
  BulkConfirmDialog,
  PageCheckbox,
  RowCheckbox,
  toastBulkResult,
  useSelection,
} from '@/features/admin/bulk'
import { ALL_TIME, DateRangeFilter, type DateRange } from '@/features/admin/date-range'
import { AdminErrorText, adminErrorMessage } from '@/features/admin/error-text'
import { QueryInput } from '@/features/admin/query-input'
import { withTerm } from '@/features/admin-security/api'
import { payloadBuildsQueryOptions } from '@/features/admin-products/api'
import { useBlockUsersIps, useBulkUsers } from '@/features/admin-users/api'
import { fetchLicenseKey } from '@/features/licenses/api'
import { formatDate, formatDateTime } from '@/lib/format/date'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import {
  adminLicensesQueryOptions,
  LICENSES_PAGE_SIZE,
  LICENSE_SEARCH_FIELDS,
  LICENSE_STATUSES,
  licenseStatusLabel,
  useBulkLicenses,
  useSetLicenseBuild,
  useUnblockLicense,
  type AdminLicense,
  type LicenseStatus,
} from './api'
import { BlockLicenseDialog } from './block-dialog'
import { LicenseStatusBadge } from '@/features/licenses/status-badge'

/** Значение «любой статус». Пустую строку Select не принимает как value. */
const ANY_STATUS = 'ANY'

/** Значение «сборка по тарифу» в выборе сборки. */
const BY_PLAN = '__plan'

type BulkAction = 'block' | 'unblock' | 'blockOwners' | 'blockOwnerIps'

export function AdminLicensesTable({ q, onQueryChange }: { q: string; onQueryChange: (q: string) => void }) {
  const { can } = useSession()
  const t = useT()
  const canBlock = can(PERMISSIONS.LICENSES_BLOCK)
  const canBlockUsers = can(PERMISSIONS.USERS_BLOCK)
  const canBlockIps = can(PERMISSIONS.SECURITY_IP_BLOCK)
  const canAssignBuild = can(PERMISSIONS.LICENSES_BUILD_ASSIGN)
  const canSelect = canBlock || canBlockUsers || canBlockIps

  const [status, setStatus] = useState<LicenseStatus | typeof ANY_STATUS>(ANY_STATUS)
  const [range, setRange] = useState<DateRange>(ALL_TIME)
  const [skip, setSkip] = useState(0)

  useEffect(() => setSkip(0), [q, status, range])

  const query = useQuery(
    adminLicensesQueryOptions({
      status: status === ANY_STATUS ? undefined : status,
      q: q || undefined,
      from: range.from,
      to: range.to,
      skip,
      take: LICENSES_PAGE_SIZE,
    })
  )

  const unblock = useUnblockLicense()
  const [rowError, setRowError] = useState<Record<string, unknown>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [blockTarget, setBlockTarget] = useState<AdminLicense | null>(null)

  // Массовые действия: выбор живёт поверх страниц, поэтому строки, которые
  // уже видели, запоминаются — владельцев берём из них.
  const selection = useSelection()
  const seen = useRef(new Map<string, AdminLicense>())
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null)
  const bulkLicenses = useBulkLicenses()
  const bulkUsers = useBulkUsers()
  const blockIps = useBlockUsersIps()

  const items = query.data?.items ?? []
  useEffect(() => {
    for (const license of items) seen.current.set(license.id, license)
  }, [items])

  if (isTwoFactorSetupRequired(query.error) || isTwoFactorSetupRequired(unblock.error)) {
    return <TwoFactorSetupRequired />
  }

  function onUnblock(license: AdminLicense) {
    setBusyId(license.id)
    setRowError((prev) => {
      const next = { ...prev }
      delete next[license.id]
      return next
    })

    unblock.mutate(license.id, {
      onSuccess: (updated) => {
        // Разблокировка возвращает лицензию в состояние по сроку: истёкшая
        // не воскресает активной — об этом и говорит сообщение.
        toast.success(
          t('admin.licenses.toast.unblocked', {
            status: licenseStatusLabel(updated.status) || updated.status,
          })
        )
      },
      onError: (error) => {
        setRowError((prev) => ({ ...prev, [license.id]: error }))
        if (error instanceof ApiError && error.code === 'NOT_BLOCKED') {
          toast.info(adminErrorMessage(error))
        }
      },
      onSettled: () => setBusyId(null),
    })
  }

  /** Владельцы выбранных лицензий без повторов. */
  function ownerIds(): string[] {
    const ids = new Set<string>()
    for (const id of selection.ids) {
      const owner = seen.current.get(id)?.userId
      if (owner) ids.add(owner)
    }
    return [...ids]
  }

  const bulkMutation =
    bulkAction === 'blockOwners' ? bulkUsers : bulkAction === 'blockOwnerIps' ? blockIps : bulkLicenses
  const bulkCount = bulkAction === 'blockOwners' || bulkAction === 'blockOwnerIps' ? ownerIds().length : selection.size

  function runBulk(input: { reason?: string; expiresInHours?: number }) {
    const done = {
      onSuccess: (result: Parameters<typeof toastBulkResult>[0]) => {
        toastBulkResult(result)
        setBulkAction(null)
        selection.clear()
      },
    }
    if (bulkAction === 'block' || bulkAction === 'unblock') {
      bulkLicenses.mutate({ action: bulkAction, ids: selection.ids, reason: input.reason }, done)
    } else if (bulkAction === 'blockOwners') {
      bulkUsers.mutate({ action: 'block', ids: ownerIds(), reason: input.reason }, done)
    } else if (bulkAction === 'blockOwnerIps') {
      blockIps.mutate({ ids: ownerIds(), ...input }, done)
    }
  }

  const total = query.data?.total ?? 0
  const from = total === 0 ? 0 : skip + 1
  const to = skip + items.length
  const columns = 10 + (canBlock ? 1 : 0) + (canSelect ? 1 : 0)
  const filtered = Boolean(q) || status !== ANY_STATUS || range.preset !== 'all'

  return (
    <div className='space-y-4'>
      <QueryInput value={q} onSubmit={onQueryChange} fields={LICENSE_SEARCH_FIELDS} placeholder={t('admin.licenses.queryPlaceholder')}>
        <Select value={status} onValueChange={(value) => setStatus(value as LicenseStatus | typeof ANY_STATUS)}>
          <SelectTrigger className='w-48'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_STATUS}>{t('admin.licenses.status.any')}</SelectItem>
            {LICENSE_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {licenseStatusLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeFilter value={range} onChange={setRange} />
        <Button variant='outline' size='icon' onClick={() => void query.refetch()} disabled={query.isFetching} aria-label={t('common.action.refresh')}>
          <RefreshCw className='size-4' />
        </Button>
      </QueryInput>

      <BulkBar selection={selection}>
        {canBlock && (
          <>
            <Button size='sm' variant='destructive' onClick={() => setBulkAction('block')}>
              {t('admin.bulk.blockLicenses')}
            </Button>
            <Button size='sm' variant='outline' onClick={() => setBulkAction('unblock')}>
              {t('admin.bulk.unblockLicenses')}
            </Button>
          </>
        )}
        {canBlockUsers && (
          <Button size='sm' variant='outline' onClick={() => setBulkAction('blockOwners')}>
            {t('admin.bulk.blockOwners')}
          </Button>
        )}
        {canBlockIps && (
          <Button size='sm' variant='outline' onClick={() => setBulkAction('blockOwnerIps')}>
            {t('admin.bulk.blockOwnerIps')}
          </Button>
        )}
      </BulkBar>

      {query.isPending ? (
        <div className='space-y-2'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-10 w-full' />
        </div>
      ) : query.isError ? (
        <div className='space-y-3'>
          <AdminErrorText error={query.error} />
          <Button variant='outline' size='sm' onClick={() => void query.refetch()}>
            <RefreshCw className='size-4' />
            {t('common.action.retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <Alert>
          <AlertTitle>{t('admin.licenses.empty.title')}</AlertTitle>
          <AlertDescription>
            {filtered ? t('admin.licenses.empty.filtered') : t('admin.licenses.empty.none')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  {canSelect && (
                    <TableHead className='w-8'>
                      <PageCheckbox selection={selection} pageIds={items.map((l) => l.id)} />
                    </TableHead>
                  )}
                  <TableHead>{t('admin.licenses.column.key')}</TableHead>
                  <TableHead>{t('admin.licenses.column.product')}</TableHead>
                  <TableHead>{t('admin.licenses.column.plan')}</TableHead>
                  <TableHead>{t('admin.licenses.column.owner')}</TableHead>
                  <TableHead>{t('admin.licenses.column.source')}</TableHead>
                  <TableHead>{t('admin.licenses.column.activatedBy')}</TableHead>
                  <TableHead>{t('admin.licenses.column.status')}</TableHead>
                  <TableHead>{t('admin.licenses.column.build')}</TableHead>
                  <TableHead>{t('admin.licenses.column.issued')}</TableHead>
                  <TableHead>{t('admin.licenses.column.expires')}</TableHead>
                  {canBlock && <TableHead className='text-right'>{t('admin.licenses.column.action')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((license) => {
                  const error = rowError[license.id]
                  const blocked = license.status === 'BLOCKED'
                  const revoked = license.status === 'REVOKED'
                  const filter = (field: string, value: string) => onQueryChange(withTerm(q, field, value))

                  return (
                    <Fragment key={license.id}>
                      <TableRow
                        data-state={selection.has(license.id) ? 'selected' : undefined}
                        className={error || blocked || revoked ? 'border-b-0' : ''}
                      >
                        {canSelect && (
                          <TableCell>
                            <RowCheckbox selection={selection} id={license.id} />
                          </TableCell>
                        )}
                        <TableCell className='font-mono text-xs'>
                          <span className='inline-flex items-center gap-1'>
                            {license.maskedKey}
                            <CopyButton value={() => fetchLicenseKey(license.id)} label={t('admin.copy.licenseKey')} />
                          </span>
                        </TableCell>
                        <TableCell>
                          <FilterValue onClick={() => filter('product', license.product.slug)}>{license.product.name}</FilterValue>
                        </TableCell>
                        <TableCell className='whitespace-nowrap'>
                          <FilterValue onClick={() => filter('plan', license.plan.slug)}>{license.plan.name}</FilterValue>
                          <span className='block text-xs text-muted-foreground'>
                            {license.plan.durationDays
                              ? t('licenses.plan.days', { count: license.plan.durationDays })
                              : t('licenses.plan.lifetime')}
                          </span>
                        </TableCell>
                        <TableCell>
                          {license.user ? (
                            <FilterValue onClick={() => filter('user', license.user!.username)}>{license.user.username}</FilterValue>
                          ) : (
                            <span className='text-muted-foreground'>{t('admin.licenses.owner.unassigned')}</span>
                          )}
                        </TableCell>
                        <TableCell className='text-sm'>
                          <OriginSource license={license} onFilter={filter} />
                        </TableCell>
                        <TableCell className='text-sm whitespace-nowrap'>
                          {license.origin?.activatedBy ? (
                            <>
                              {license.origin.activatedBy.username ? (
                                <FilterValue onClick={() => filter('user', license.origin!.activatedBy!.username!)}>
                                  {license.origin.activatedBy.username}
                                </FilterValue>
                              ) : (
                                <span className='text-muted-foreground'>—</span>
                              )}
                              {license.origin.activatedBy.at && (
                                <span className='block text-xs text-muted-foreground'>{formatDateTime(license.origin.activatedBy.at)}</span>
                              )}
                            </>
                          ) : (
                            <span className='text-muted-foreground'>{t('admin.licenses.origin.notActivated')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <button type='button' onClick={() => filter('status', license.status)}>
                            <LicenseStatusBadge compact status={license.status} />
                          </button>
                        </TableCell>
                        <TableCell>
                          <BuildCell license={license} editable={canAssignBuild} />
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-muted-foreground'>
                          {formatDate(license.issuedAt)}
                          <span className='block text-xs'>
                            {license.activatedAt
                              ? t('admin.licenses.activatedAt', { date: formatDate(license.activatedAt) })
                              : t('admin.licenses.activated.never')}
                          </span>
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-muted-foreground'>
                          {license.expiresAt ? formatDate(license.expiresAt) : t('licenses.plan.lifetime')}
                        </TableCell>
                        {canBlock && (
                          <TableCell className='text-right'>
                            {blocked ? (
                              <Button size='sm' variant='outline' disabled={busyId === license.id} onClick={() => onUnblock(license)}>
                                {busyId === license.id ? t('admin.licenses.action.unblocking') : t('admin.licenses.action.unblock')}
                              </Button>
                            ) : (
                              <Button
                                size='sm'
                                variant='destructive'
                                disabled={revoked}
                                title={revoked ? t('admin.licenses.action.blockRevoked') : undefined}
                                onClick={() => setBlockTarget(license)}
                              >
                                {t('admin.licenses.action.block')}
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>

                      {/* Причина блокировки и отзыва — единственное объяснение
                          для поддержки, почему у покупателя ничего не работает. */}
                      {(blocked || revoked || error != null) && (
                        <TableRow>
                          <TableCell colSpan={columns} className='pt-0'>
                            <div className='space-y-1 rounded-md bg-muted/50 p-3 text-sm'>
                              {blocked && (
                                <p>
                                  <span className='text-muted-foreground'>
                                    {t('admin.licenses.blocked.at', { date: formatDateTime(license.blockedAt) })}{' '}
                                  </span>
                                  {license.blockedReason ?? t('admin.licenses.reason.none')}
                                </p>
                              )}
                              {revoked && (
                                <p>
                                  <span className='text-muted-foreground'>
                                    {t('admin.licenses.revoked.at', { date: formatDateTime(license.revokedAt) })}{' '}
                                  </span>
                                  {license.revokedReason ?? t('admin.licenses.reason.none')}
                                </p>
                              )}
                              {error != null && <AdminErrorText error={error} />}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className='flex items-center justify-between gap-3 text-sm text-muted-foreground'>
            <span>{t('admin.licenses.range', { from, to, total })}</span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={skip === 0 || query.isFetching}
                onClick={() => setSkip(Math.max(0, skip - LICENSES_PAGE_SIZE))}
              >
                {t('common.action.prevPage')}
              </Button>
              <Button variant='outline' size='sm' disabled={to >= total || query.isFetching} onClick={() => setSkip(skip + LICENSES_PAGE_SIZE)}>
                {t('common.action.nextPage')}
              </Button>
            </div>
          </div>
        </>
      )}

      <BlockLicenseDialog
        license={blockTarget}
        open={blockTarget !== null}
        onOpenChange={(open) => {
          if (!open) setBlockTarget(null)
        }}
      />

      <BulkConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBulkAction(null)
            bulkMutation.reset()
          }
        }}
        title={bulkAction ? t(`admin.bulk.title.${bulkAction}`) : ''}
        description={bulkAction === 'blockOwnerIps' ? t('admin.bulk.ipsHint') : undefined}
        count={bulkCount}
        reason={bulkAction === 'unblock' ? undefined : bulkAction === 'blockOwnerIps' ? 'optional' : 'required'}
        duration={bulkAction === 'blockOwnerIps'}
        destructive={bulkAction !== 'unblock'}
        pending={bulkMutation.isPending}
        error={bulkMutation.error}
        onConfirm={runBulk}
      />
    </div>
  )
}

/** Значение-фильтр: клик добавляет условие в строку поиска. */
function FilterValue({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type='button' onClick={onClick} className='text-start underline-offset-4 hover:text-primary hover:underline'>
      {children}
    </button>
  )
}

/**
 * Кто продал или выдал лицензию: реселлер (своим ключом), заказ на сайте или
 * Digiseller, администратор вручную или ключом регистрации.
 */
function OriginSource({ license, onFilter }: { license: AdminLicense; onFilter: (field: string, value: string) => void }) {
  const t = useT()
  const source = license.origin?.source
  if (!source || source.kind === 'unknown') return <span className='text-muted-foreground'>—</span>

  switch (source.kind) {
    case 'reseller':
      return (
        <>
          <span className='block text-xs text-muted-foreground'>{t('admin.licenses.origin.reseller')}</span>
          <FilterValue onClick={() => onFilter('reseller', source.name)}>{source.name}</FilterValue>
        </>
      )
    case 'order':
      return (
        <>
          <span className='block text-xs text-muted-foreground'>{t(`admin.licenses.origin.channel.${source.channel}`)}</span>
          <span className='font-mono text-xs'>{source.number}</span>
        </>
      )
    case 'admin':
    case 'key':
      return (
        <>
          <span className='block text-xs text-muted-foreground'>{t(`admin.licenses.origin.${source.kind}`)}</span>
          {source.by ?? <span className='text-muted-foreground'>—</span>}
        </>
      )
  }
}

/**
 * Сборка лицензии. Пусто — загрузчик берёт сборку тарифа (или самую новую
 * опубликованную сборку товара); закреплённая сборка важнее тарифной.
 * Список сборок грузится при открытии.
 */
function BuildCell({ license, editable }: { license: AdminLicense; editable: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const builds = useQuery({ ...payloadBuildsQueryOptions(license.productId), enabled: open })
  const setBuild = useSetLicenseBuild()
  const label = license.build ? license.build.name : t('admin.licenses.build.byPlan')

  if (!editable) {
    return <span className={license.build ? 'font-mono text-xs' : 'text-xs text-muted-foreground'}>{label}</span>
  }

  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={license.buildId ?? BY_PLAN}
      disabled={setBuild.isPending}
      onValueChange={(value) =>
        setBuild.mutate(
          { id: license.id, buildId: value === BY_PLAN ? null : value },
          {
            onSuccess: () => toast.success(t('admin.licenses.build.saved')),
            onError: (error) => toast.error(adminErrorMessage(error)),
          }
        )
      }
    >
      <SelectTrigger className={license.build ? 'h-8 w-40 font-mono text-xs' : 'h-8 w-40 text-xs text-muted-foreground'}>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={BY_PLAN}>{t('admin.licenses.build.byPlan')}</SelectItem>
        {license.build && !builds.data && <SelectItem value={license.build.id}>{license.build.name}</SelectItem>}
        {(builds.data ?? []).map((build) => (
          <SelectItem key={build.id} value={build.id} disabled={!build.isPublished && build.id !== license.buildId}>
            <span className='font-mono'>{build.name}</span>
            <span className='ms-2 text-xs text-muted-foreground'>
              {build.isPublished ? `v${build.version}` : t(`admin.builds.status.${build.status}`)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
