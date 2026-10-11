import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRightLeft, ChevronRight, Plus, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ACTIVE_ROW, CURSOR_ROW, PanelFacts, PanelSection, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
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
import { adminResellersQueryOptions, useProfileResellerAccess } from '@/features/resellers/api'
import {
  PROFILE_PROVIDERS,
  PROFILE_SEARCH_FIELDS,
  RESELLER_PROVIDERS,
  profilesSearchQueryOptions,
  useArchiveProfile,
  useBulkDeleteProfiles,
  useMoveProfile,
  type MethodConfig,
  type PaymentProfile,
  type ProfileProvider,
  type ProfileScope,
} from './api'
import { ProfileEditor } from './profile-editor'

const PAGE = 50
const ANY = 'ANY'

/**
 * Реестр реквизитов одного раздела: для товаров (шаблоны и личные реквизиты
 * товаров) или для реселлеров (кошельки для пополнения баланса). Кто создал,
 * когда, к чему привязаны. Клик по строке — панель справа: правка, привязки,
 * перенос в другой раздел, удаление.
 */
export function ProfilesRegistry({ scope }: { scope: ProfileScope }) {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.PAYMENT_PROFILES_MANAGE)
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState<ProfileProvider | typeof ANY>(ANY)
  const [kind, setKind] = useState<'TEMPLATE' | 'PERSONAL' | typeof ANY>(ANY)
  const [range, setRange] = useState<DateRange>(ALL_TIME)
  const [skip, setSkip] = useState(0)
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<ProfileProvider | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const providers = scope === 'RESELLERS' ? RESELLER_PROVIDERS : PROFILE_PROVIDERS

  useEffect(() => setSkip(0), [q, provider, kind, range])

  const query = useQuery(
    profilesSearchQueryOptions({
      q: q || undefined,
      scope,
      provider: provider === ANY ? undefined : provider,
      kind: kind === ANY ? undefined : kind,
      from: range.from,
      to: range.to,
      skip,
      take: PAGE,
    })
  )
  const bulkDelete = useBulkDeleteProfiles()
  const selection = useSelection()

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const opened = items.find((p) => p.id === openedId) ?? null
  const cursor = useListHotkeys({
    ids: items.map((p) => p.id),
    openedId,
    onOpen: (id) => {
      setCreating(null)
      setOpenedId(id)
    },
    onClose: () => setOpenedId(null),
  })
  const filter = (field: string, value: string) => setQ(withTerm(q, field, value))

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <CardTitle className='text-base'>{t(`admin.profiles.scope.${scope}.title`)}</CardTitle>
          <CardDescription>{t(`admin.profiles.scope.${scope}.description`)}</CardDescription>
        </div>
        {canManage && (
          <div className='flex flex-wrap gap-2'>
            {providers.map((p) => (
              <Button
                key={p}
                size='sm'
                variant='outline'
                onClick={() => {
                  setOpenedId(null)
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
          <ProfileEditor
            key={`${scope}-${creating}`}
            provider={creating}
            scope={scope}
            onSaved={(saved) => {
              setCreating(null)
              setOpenedId(saved.id)
            }}
            onCancel={() => setCreating(null)}
          />
        )}

        <QueryInput value={q} onSubmit={setQ} fields={PROFILE_SEARCH_FIELDS} placeholder={t('admin.profiles.registry.queryPlaceholder')}>
          {providers.length > 1 && (
            <Select value={provider} onValueChange={(v) => setProvider(v as ProfileProvider | typeof ANY)}>
              <SelectTrigger className='w-44'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('admin.profiles.registry.anyProvider')}</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`admin.payments.provider.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {scope === 'PRODUCTS' && (
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
          )}
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
          <p className='text-sm text-muted-foreground'>{t(`admin.profiles.scope.${scope}.empty`)}</p>
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
                  <TableHead>
                    {scope === 'PRODUCTS' ? t('admin.profiles.registry.column.products') : t('admin.profiles.registry.column.resellers')}
                  </TableHead>
                  <TableHead>{t('admin.profiles.registry.column.state')}</TableHead>
                  <TableHead>{t('admin.profiles.registry.column.creator')}</TableHead>
                  <TableHead>{t('admin.profiles.registry.column.created')}</TableHead>
                  <TableHead className='w-8' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((profile) => (
                  <TableRow
                    key={profile.id}
                    data-row-id={profile.id}
                    data-state={selection.has(profile.id) ? 'selected' : undefined}
                    className={cn('cursor-pointer', openedId === profile.id && ACTIVE_ROW, cursor === profile.id && CURSOR_ROW)}
                    onClick={() => {
                      setCreating(null)
                      setOpenedId(openedId === profile.id ? null : profile.id)
                    }}
                  >
                    {canManage && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <RowCheckbox selection={selection} id={profile.id} />
                      </TableCell>
                    )}
                    <TableCell>
                      <span className='font-medium'>{profile.name}</span>
                      <span className='mt-1 flex flex-wrap gap-1' onClick={(e) => e.stopPropagation()}>
                        <button type='button' onClick={() => filter('provider', profile.provider)}>
                          <Badge variant='outline'>{t(`admin.payments.provider.${profile.provider}`)}</Badge>
                        </button>
                        {scope === 'PRODUCTS' && (
                          <button type='button' onClick={() => filter('kind', profile.kind === 'TEMPLATE' ? 'template' : 'personal')}>
                            <Badge variant='secondary'>{t(`admin.profiles.kind.${profile.kind}`)}</Badge>
                          </button>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className='max-w-72'>
                      <Contents profile={profile} />
                    </TableCell>
                    <TableCell>
                      <Attachments profile={profile} />
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
                    <TableCell>
                      <ChevronRight className={cn('size-4 text-muted-foreground', openedId === profile.id && 'text-primary')} />
                    </TableCell>
                  </TableRow>
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

      {opened && <ProfilePanel profile={opened} canManage={canManage} onClose={() => setOpenedId(null)} />}

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

/**
 * Реквизиты в панели: правка, к чему привязаны, перенос в другой раздел
 * (с подтверждением — привязки прежнего раздела снимаются) и удаление.
 */
function ProfilePanel({ profile, canManage, onClose }: { profile: PaymentProfile; canManage: boolean; onClose: () => void }) {
  const t = useT()
  const move = useMoveProfile()
  const archive = useArchiveProfile()
  const [confirm, setConfirm] = useState<'move' | 'delete' | null>(null)
  const target: ProfileScope = profile.scope === 'PRODUCTS' ? 'RESELLERS' : 'PRODUCTS'
  const movable = target === 'PRODUCTS' || RESELLER_PROVIDERS.includes(profile.provider)
  const attachedHere = profile.scope === 'PRODUCTS' ? profile.products.length : profile.resellers.length

  return (
    <SidePanel
      open
      onClose={onClose}
      title={profile.name}
      subtitle={t(`admin.profiles.scope.${profile.scope}.title`)}
      badges={
        <>
          <Badge variant='outline'>{t(`admin.payments.provider.${profile.provider}`)}</Badge>
          {profile.ready ? (
            <Badge>{t('admin.profiles.ready')}</Badge>
          ) : (
            <Badge variant='destructive' title={profile.notReadyReason ?? undefined}>
              {t('admin.profiles.notReady')}
            </Badge>
          )}
        </>
      }
    >
      {canManage && (
        <div className='flex flex-wrap gap-2'>
          <Button variant='outline' disabled={!movable || move.isPending} onClick={() => setConfirm('move')} title={movable ? undefined : t('admin.profiles.move.cryptoOnly')}>
            <ArrowRightLeft className='size-4' />
            {t(`admin.profiles.move.to.${target}`)}
          </Button>
          <Button variant='outline' className='text-destructive' onClick={() => setConfirm('delete')}>
            <Trash2 className='size-4' />
            {t('admin.profiles.delete')}
          </Button>
        </div>
      )}
      {!movable && canManage && <p className='text-xs text-muted-foreground'>{t('admin.profiles.move.cryptoOnly')}</p>}
      <AdminErrorText error={move.error ?? archive.error} />

      <PanelSection title={t('admin.profiles.panel.summary')}>
        <PanelFacts
          rows={[
            [t('admin.profiles.registry.column.contents'), <Contents profile={profile} />],
            // Доступ реселлеров — отдельной секцией ниже, с правкой.
            ...(profile.scope === 'PRODUCTS'
              ? [[t('admin.profiles.registry.column.products'), <Attachments profile={profile} />] as [string, React.ReactNode]]
              : []),
            [t('admin.profiles.registry.column.creator'), profile.createdByUsername ?? '—'],
            [t('admin.profiles.registry.column.created'), formatDateTime(profile.createdAt)],
            [t('admin.profiles.panel.updated'), formatDateTime(profile.updatedAt)],
          ]}
        />
      </PanelSection>

      {profile.scope === 'RESELLERS' && <ResellerAccess profile={profile} />}

      {canManage && (
        <PanelSection title={t('admin.profiles.panel.edit')}>
          <ProfileEditor key={profile.id + profile.updatedAt} profile={profile} provider={profile.provider} />
        </PanelSection>
      )}

      <BulkConfirmDialog
        open={confirm === 'move'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t(`admin.profiles.move.to.${target}`)}
        description={
          attachedHere > 0
            ? t(`admin.profiles.move.detach.${profile.scope}`, { count: attachedHere })
            : t('admin.profiles.move.hint')
        }
        count={1}
        pending={move.isPending}
        error={move.error}
        onConfirm={() =>
          move.mutate(
            { id: profile.id, scope: target },
            {
              onSuccess: () => {
                toast.success(t('admin.profiles.move.done'))
                setConfirm(null)
                onClose()
              },
            }
          )
        }
      />
      <BulkConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('admin.profiles.registry.deleteTitle', { name: profile.name })}
        description={
          profile.usedBy > 0
            ? t('admin.profiles.registry.deleteAttached', {
                products: [...profile.products.map((p) => p.name), ...profile.resellers.map((r) => r.displayName)].join(', '),
              })
            : t('admin.profiles.registry.deleteHint')
        }
        count={1}
        destructive
        pending={archive.isPending}
        error={archive.error}
        onConfirm={() =>
          archive.mutate(profile.id, {
            onSuccess: () => {
              toast.success(t('admin.profiles.deleted'))
              setConfirm(null)
              onClose()
            },
          })
        }
      />
    </SidePanel>
  )
}

/**
 * Кому из реселлеров выданы реквизиты. Новые реквизиты не выданы никому:
 * доступ выдаётся здесь или из карточки реселлера.
 */
function ResellerAccess({ profile }: { profile: PaymentProfile }) {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.RESELLERS_MANAGE)
  const resellers = useQuery({
    ...adminResellersQueryOptions({ skip: 0, take: 200 }),
    enabled: canManage,
  })
  const { grant, toggle, revoke, grantAll } = useProfileResellerAccess(profile.id)
  const [picked, setPicked] = useState('')
  const granted = new Set(profile.resellers.map((r) => r.id))
  const candidates = (resellers.data?.items ?? []).filter((r) => !granted.has(r.id) && r.status !== 'CLOSED')

  return (
    <PanelSection title={t('admin.profiles.access.title')} description={t('admin.profiles.access.hint')}>
      {profile.resellers.length === 0 ? (
        <p className='rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300'>
          {t('admin.profiles.access.nobody')}
        </p>
      ) : (
        <ul className='space-y-1.5'>
          {profile.resellers.map((r) => (
            <li key={r.id} className='flex items-center gap-3 rounded-md border px-3 py-2'>
              <Checkbox
                checked={r.enabled}
                disabled={!canManage || toggle.isPending}
                onCheckedChange={(v) => toggle.mutate({ resellerId: r.id, enabled: v === true })}
                aria-label={t('resellers.requisites.enabled')}
              />
              <Link
                to='/admin/resellers'
                search={{ open: r.id }}
                className={cn('min-w-0 flex-1 truncate underline-offset-4 hover:underline', !r.enabled && 'text-muted-foreground line-through')}
              >
                {r.displayName}
              </Link>
              {canManage && (
                <Button
                  size='icon'
                  variant='ghost'
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(r.id)}
                  title={t('admin.profiles.access.revoke')}
                >
                  <X className='size-4' />
                  <span className='sr-only'>{t('admin.profiles.access.revoke')}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className='flex flex-wrap gap-2'>
          <Select value={picked} onValueChange={setPicked} disabled={candidates.length === 0}>
            <SelectTrigger className='min-w-48 flex-1'>
              <SelectValue
                placeholder={candidates.length === 0 ? t('admin.profiles.access.noneLeft') : t('admin.profiles.access.pick')}
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.displayName}
                  <span className='ms-2 text-xs text-muted-foreground'>{r.user.username}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!picked || grant.isPending}
            onClick={() => grant.mutate(picked, { onSuccess: () => setPicked('') })}
          >
            <Plus className='size-4' />
            {t('admin.profiles.access.grant')}
          </Button>
          <Button
            variant='outline'
            disabled={grantAll.isPending}
            onClick={() => grantAll.mutate(undefined, { onSuccess: () => toast.success(t('admin.profiles.access.grantedAll')) })}
          >
            <Users className='size-4' />
            {t('admin.profiles.access.grantAll')}
          </Button>
        </div>
      )}
      <AdminErrorText error={grant.error ?? toggle.error ?? revoke.error ?? grantAll.error ?? resellers.error} />
    </PanelSection>
  )
}

/** К чему привязаны: товары (раздел товаров) или реселлеры (раздел реселлеров). */
function Attachments({ profile }: { profile: PaymentProfile }) {
  const t = useT()
  if (profile.scope === 'RESELLERS') {
    return (
      <div className='flex max-w-60 flex-wrap gap-1'>
        {profile.resellers.length === 0 ? (
          <span className='text-xs text-amber-700 dark:text-amber-400'>{t('admin.profiles.registry.nobody')}</span>
        ) : (
          profile.resellers.map((r) => (
            <Link key={r.id} to='/admin/resellers' search={{ open: r.id }} onClick={(e) => e.stopPropagation()}>
              <Badge variant={r.enabled ? 'outline' : 'secondary'} className='hover:border-primary'>
                {r.displayName}
              </Badge>
            </Link>
          ))
        )}
      </div>
    )
  }
  return (
    <div className='flex max-w-60 flex-wrap gap-1'>
      {profile.products.length === 0 ? (
        <span className='text-xs text-muted-foreground'>{t('admin.profiles.registry.unattached')}</span>
      ) : (
        profile.products.map((product) => (
          <Link key={product.id} to='/admin/products/$productId' params={{ productId: product.id }} onClick={(e) => e.stopPropagation()}>
            <Badge variant={product.enabled ? 'outline' : 'secondary'} className='hover:border-primary'>
              {product.name}
            </Badge>
          </Link>
        ))
      )}
    </div>
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
