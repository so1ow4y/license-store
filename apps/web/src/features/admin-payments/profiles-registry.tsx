import { Fragment, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format/date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
} from '@/features/admin/bulk'
import { ALL_TIME, DateRangeFilter, type DateRange } from '@/features/admin/date-range'
import { AdminErrorText } from '@/features/admin/error-text'
import { QueryInput } from '@/features/admin/query-input'
import { withTerm } from '@/features/admin-security/api'
import {
  PROFILE_PROVIDERS,
  PROFILE_SEARCH_FIELDS,
  profilesSearchQueryOptions,
  useArchiveProfile,
  useBulkDeleteProfiles,
  type MethodConfig,
  type PaymentProfile,
  type ProfileProvider,
} from './api'
import { ProfileEditor } from './profile-editor'

const PAGE = 50
const ANY = 'ANY'

/**
 * Реестр всех реквизитов — шаблонов и личных реквизитов товаров: кто создал,
 * когда, к каким товарам привязаны. Удаление снимает реквизиты со всех
 * товаров сразу, поэтому личные реквизиты не теряются из виду.
 */
export function ProfilesRegistry() {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.PAYMENT_PROFILES_MANAGE)
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState<ProfileProvider | typeof ANY>(ANY)
  const [kind, setKind] = useState<'TEMPLATE' | 'PERSONAL' | typeof ANY>(ANY)
  const [range, setRange] = useState<DateRange>(ALL_TIME)
  const [skip, setSkip] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState<ProfileProvider | null>(null)
  const [deleting, setDeleting] = useState<PaymentProfile | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  useEffect(() => setSkip(0), [q, provider, kind, range])

  const query = useQuery(
    profilesSearchQueryOptions({
      q: q || undefined,
      provider: provider === ANY ? undefined : provider,
      kind: kind === ANY ? undefined : kind,
      from: range.from,
      to: range.to,
      skip,
      take: PAGE,
    })
  )
  const archive = useArchiveProfile()
  const bulkDelete = useBulkDeleteProfiles()
  const selection = useSelection()

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const filter = (field: string, value: string) => setQ(withTerm(q, field, value))

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <CardTitle className='text-base'>{t('admin.profiles.registry.title')}</CardTitle>
          <CardDescription>{t('admin.profiles.registry.description')}</CardDescription>
        </div>
        {canManage && (
          <div className='flex flex-wrap gap-2'>
            {PROFILE_PROVIDERS.map((p) => (
              <Button
                key={p}
                size='sm'
                variant='outline'
                onClick={() => {
                  setEditing(null)
                  setCreating(p)
                }}
              >
                <Plus className='size-4' />
                {t(`admin.profiles.create.${p}`)}
              </Button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className='space-y-4'>
        {creating && (
          <ProfileEditor key={creating} provider={creating} onSaved={() => setCreating(null)} onCancel={() => setCreating(null)} />
        )}

        <QueryInput value={q} onSubmit={setQ} fields={PROFILE_SEARCH_FIELDS} placeholder={t('admin.profiles.registry.queryPlaceholder')}>
          <Select value={provider} onValueChange={(v) => setProvider(v as ProfileProvider | typeof ANY)}>
            <SelectTrigger className='w-44'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.profiles.registry.anyProvider')}</SelectItem>
              {PROFILE_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`admin.payments.provider.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as 'TEMPLATE' | 'PERSONAL' | typeof ANY)}>
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.profiles.registry.anyKind')}</SelectItem>
              <SelectItem value='TEMPLATE'>{t('admin.profiles.kind.TEMPLATE')}</SelectItem>
              <SelectItem value='PERSONAL'>{t('admin.profiles.kind.PERSONAL')}</SelectItem>
            </SelectContent>
          </Select>
          <DateRangeFilter value={range} onChange={setRange} />
        </QueryInput>

        {canManage && (
          <BulkBar selection={selection}>
            <Button size='sm' variant='destructive' onClick={() => setBulkOpen(true)}>
              <Trash2 className='size-4' />
              {t('admin.profiles.registry.bulkDelete')}
            </Button>
          </BulkBar>
        )}

        {query.isPending ? (
          <Skeleton className='h-40 w-full' />
        ) : query.isError ? (
          <AdminErrorText error={query.error} />
        ) : items.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('admin.profiles.registry.empty')}</p>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  {canManage && (
                    <TableHead className='w-8'>
                      <PageCheckbox selection={selection} pageIds={items.map((p) => p.id)} />
                    </TableHead>
                  )}
                  <TableHead>{t('admin.profiles.registry.column.name')}</TableHead>
                  <TableHead>{t('admin.profiles.registry.column.contents')}</TableHead>
                  <TableHead>{t('admin.profiles.registry.column.products')}</TableHead>
                  <TableHead>{t('admin.profiles.registry.column.state')}</TableHead>
                  <TableHead>{t('admin.profiles.registry.column.creator')}</TableHead>
                  <TableHead>{t('admin.profiles.registry.column.created')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((profile) => (
                  <Fragment key={profile.id}>
                    <TableRow data-state={selection.has(profile.id) ? 'selected' : undefined}>
                      {canManage && (
                        <TableCell>
                          <RowCheckbox selection={selection} id={profile.id} />
                        </TableCell>
                      )}
                      <TableCell>
                        <span className='font-medium'>{profile.name}</span>
                        <span className='mt-1 flex flex-wrap gap-1'>
                          <button type='button' onClick={() => filter('provider', profile.provider)}>
                            <Badge variant='outline'>{t(`admin.payments.provider.${profile.provider}`)}</Badge>
                          </button>
                          <button type='button' onClick={() => filter('kind', profile.kind === 'TEMPLATE' ? 'template' : 'personal')}>
                            <Badge variant='secondary'>{t(`admin.profiles.kind.${profile.kind}`)}</Badge>
                          </button>
                        </span>
                      </TableCell>
                      <TableCell className='max-w-72'>
                        <Contents profile={profile} />
                      </TableCell>
                      <TableCell>
                        <div className='flex max-w-60 flex-wrap gap-1'>
                          {profile.products.length === 0 ? (
                            <span className='text-xs text-muted-foreground'>{t('admin.profiles.registry.unattached')}</span>
                          ) : (
                            profile.products.map((product) => (
                              <Link key={product.id} to='/admin/products/$productId' params={{ productId: product.id }}>
                                <Badge variant={product.enabled ? 'outline' : 'secondary'} className='hover:border-primary'>
                                  {product.name}
                                </Badge>
                              </Link>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {profile.ready ? (
                          <Badge>{t('admin.profiles.ready')}</Badge>
                        ) : (
                          <Badge variant='destructive' title={profile.notReadyReason ?? undefined}>
                            {t('admin.profiles.notReady')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {profile.createdByUsername ? (
                          <button
                            type='button'
                            className='underline-offset-4 hover:text-primary hover:underline'
                            onClick={() => filter('creator', profile.createdByUsername!)}
                          >
                            {profile.createdByUsername}
                          </button>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(profile.createdAt)}</TableCell>
                      <TableCell className='text-right whitespace-nowrap'>
                        {canManage && (
                          <>
                            <Button size='sm' variant='ghost' onClick={() => setEditing(editing === profile.id ? null : profile.id)}>
                              <Pencil className='size-4' />
                              <span className='sr-only'>{t('common.action.edit')}</span>
                            </Button>
                            <Button size='sm' variant='ghost' onClick={() => setDeleting(profile)}>
                              <Trash2 className='size-4' />
                              <span className='sr-only'>{t('admin.profiles.delete')}</span>
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                    {editing === profile.id && (
                      <TableRow className='hover:bg-transparent'>
                        <TableCell colSpan={canManage ? 8 : 7}>
                          <ProfileEditor
                            profile={profile}
                            provider={profile.provider}
                            onSaved={() => setEditing(null)}
                            onCancel={() => setEditing(null)}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className='flex items-center justify-between text-sm text-muted-foreground'>
          <span>{t('siem.total', { total })}</span>
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>
              {t('common.action.prevPage')}
            </Button>
            <Button variant='outline' size='sm' disabled={skip + PAGE >= total} onClick={() => setSkip(skip + PAGE)}>
              {t('common.action.nextPage')}
            </Button>
          </div>
        </div>
      </CardContent>

      <BulkConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null)
            archive.reset()
          }
        }}
        title={t('admin.profiles.registry.deleteTitle', { name: deleting?.name ?? '' })}
        description={
          deleting && deleting.usedBy > 0
            ? t('admin.profiles.registry.deleteAttached', { products: deleting.products.map((p) => p.name).join(', ') })
            : t('admin.profiles.registry.deleteHint')
        }
        count={1}
        destructive
        pending={archive.isPending}
        error={archive.error}
        onConfirm={() =>
          deleting &&
          archive.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(t('admin.profiles.deleted'))
              setDeleting(null)
            },
          })
        }
      />
      <BulkConfirmDialog
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBulkOpen(false)
            bulkDelete.reset()
          }
        }}
        title={t('admin.profiles.registry.bulkDeleteTitle')}
        description={t('admin.profiles.registry.deleteHint')}
        count={selection.size}
        destructive
        pending={bulkDelete.isPending}
        error={bulkDelete.error}
        onConfirm={() =>
          bulkDelete.mutate(selection.ids, {
            onSuccess: (result) => {
              toastBulkResult(result)
              setBulkOpen(false)
              selection.clear()
            },
          })
        }
      />
    </Card>
  )
}

/** Что внутри: кошельки (монета, сеть, начало и конец адреса) или магазин ЮKassa. */
function Contents({ profile }: { profile: PaymentProfile }) {
  const t = useT()
  if (profile.provider === 'CRYPTO') {
    const wallets = (profile.config as MethodConfig['CRYPTO']).wallets
    if (wallets.length === 0) return <span className='text-xs text-muted-foreground'>{t('admin.profiles.noWallets')}</span>
    return (
      <ul className='space-y-0.5 font-mono text-xs'>
        {wallets.map((w) => (
          <li key={w.id} className='truncate' title={w.address}>
            {w.currency} · {w.network} · {w.address.length > 14 ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : w.address}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <span className='text-xs text-muted-foreground'>
      {profile.secretsSet.shopId ? t('admin.profiles.shopConnected') : t('admin.profiles.shopNotConnected')}
    </span>
  )
}
