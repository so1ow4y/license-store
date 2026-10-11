import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ChevronRight, Plus, Search } from 'lucide-react'
import { z } from 'zod'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ACTIVE_ROW, CURSOR_ROW } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import {
  RESELLER_STATUSES,
  adminResellersQueryOptions,
  formatMoney,
  type ResellerStatus,
} from '@/features/resellers/api'
import { AdminTopupsPanel } from '@/features/resellers/admin-topups'
import { CreateResellerDialog } from '@/features/resellers/create-reseller-dialog'
import { ResellerPanel } from '@/features/resellers/reseller-panel'

const PAGE = 50
const ANY = 'ANY'
const TABS = ['resellers', 'topups'] as const

/**
 * Реселлеры: кто продаёт, на каких условиях, сколько на балансе и сколько
 * продал. Клик по строке открывает реселлера в панели справа — там условия,
 * баланс с историей, реквизиты пополнения и заявки. Открытый реселлер — в
 * адресе (`?open=`), ссылку на него можно отправить коллеге.
 */
export const Route = createFileRoute('/_app/admin/resellers')({
  validateSearch: z.object({
    tab: z.enum(TABS).optional(),
    open: z.string().uuid().optional(),
  }),
  beforeLoad: ({ context }) => {
    const allowed = hasAny(context.me.permissions, [
      PERMISSIONS.RESELLERS_READ,
      PERMISSIONS.RESELLERS_MANAGE,
      PERMISSIONS.RESELLERS_TOPUPS_CONFIRM,
    ])
    if (!allowed) throw redirect({ to: '/403' })
  },
  component: AdminResellersPage,
})

const STATUS_VARIANT: Record<ResellerStatus, 'default' | 'secondary' | 'outline'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  CLOSED: 'outline',
}

function AdminResellersPage() {
  const t = useT()
  const { can } = useSession()
  const { tab, open } = Route.useSearch()
  const navigate = Route.useNavigate()
  const visible = TABS.filter((name) =>
    name === 'resellers'
      ? can(PERMISSIONS.RESELLERS_READ) || can(PERMISSIONS.RESELLERS_MANAGE)
      : can(PERMISSIONS.RESELLERS_READ) || can(PERMISSIONS.RESELLERS_TOPUPS_CONFIRM)
  )
  const current = tab && visible.includes(tab) ? tab : visible[0]
  const canSeeResellers = visible.includes('resellers')

  function openReseller(id: string | null) {
    void navigate({ search: (prev) => ({ ...prev, open: id ?? undefined }), replace: true })
  }

  return (
    <div className='space-y-6'>
      <AdminPageHeader title={t('resellers.admin.title')} description={t('resellers.admin.description')} />
      <Tabs
        value={current}
        onValueChange={(value) => void navigate({ search: (prev) => ({ ...prev, tab: value as (typeof TABS)[number] }) })}
      >
        <TabsList>
          {visible.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`resellers.admin.tab.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {canSeeResellers && (
          <TabsContent value='resellers' className='mt-4'>
            <ResellersTab selected={open ?? null} onSelect={openReseller} />
          </TabsContent>
        )}
        {visible.includes('topups') && (
          <TabsContent value='topups' className='mt-4'>
            <AdminTopupsPanel onOpenReseller={canSeeResellers ? (id) => openReseller(id) : undefined} />
          </TabsContent>
        )}
      </Tabs>

      {canSeeResellers && <ResellerPanel resellerId={open ?? null} onClose={() => openReseller(null)} />}
    </div>
  )
}

function ResellersTab({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.RESELLERS_MANAGE)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ResellerStatus | typeof ANY>(ANY)
  const [skip, setSkip] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => setSkip(0), [search, status])

  const query = useQuery(
    adminResellersQueryOptions({ search: search || undefined, status: status === ANY ? undefined : status, skip, take: PAGE })
  )

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const cursor = useListHotkeys({
    ids: items.map((r) => r.id),
    openedId: selected,
    onOpen: onSelect,
    onClose: () => onSelect(null),
  })

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <form
          className='flex min-w-72 flex-1 gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(draft.trim())
          }}
        >
          <div className='relative flex-1'>
            <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input value={draft} placeholder={t('resellers.admin.searchPlaceholder')} className='pl-8' onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Button type='submit' variant='outline'>
            {t('common.action.search')}
          </Button>
        </form>
        <Select value={status} onValueChange={(v) => setStatus(v as ResellerStatus | typeof ANY)}>
          <SelectTrigger className='w-48'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('resellers.status.any')}</SelectItem>
            {RESELLER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`resellers.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus className='size-4' />
            {t('resellers.admin.create')}
          </Button>
        )}
      </div>

      {query.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : items.length === 0 ? (
        <Alert>
          <AlertDescription>{search || status !== ANY ? t('resellers.admin.nothingFound') : t('resellers.admin.empty')}</AlertDescription>
        </Alert>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('resellers.admin.column.reseller')}</TableHead>
                <TableHead>{t('resellers.admin.column.status')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.balance')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.discount')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.credit')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.sales30d')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.clients')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.licenses')}</TableHead>
                <TableHead className='text-right'>{t('resellers.admin.column.keys')}</TableHead>
                <TableHead className='w-8' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow
                  key={r.id}
                  data-row-id={r.id}
                  className={cn('cursor-pointer', selected === r.id && ACTIVE_ROW, cursor === r.id && CURSOR_ROW)}
                  onClick={() => onSelect(selected === r.id ? null : r.id)}
                >
                  <TableCell>
                    <span className='font-medium'>{r.displayName}</span>
                    <span className='block text-xs text-muted-foreground'>
                      {r.user.username}
                      {r.user.email ? ` · ${r.user.email}` : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{t(`resellers.status.${r.status}`)}</Badge>
                  </TableCell>
                  <TableCell className={cn('text-right font-medium whitespace-nowrap', Number(r.balance) < 0 && 'text-destructive')}>
                    {formatMoney(r.balance, r.currency)}
                  </TableCell>
                  <TableCell className='text-right'>{Number(r.discountPercent)}%</TableCell>
                  <TableCell className='text-right whitespace-nowrap'>{formatMoney(r.creditLimit, r.currency)}</TableCell>
                  <TableCell className='text-right whitespace-nowrap'>{formatMoney(r.sales30d ?? 0, r.currency)}</TableCell>
                  <TableCell className='text-right'>{r.clients}</TableCell>
                  <TableCell className='text-right'>{r.licenses}</TableCell>
                  <TableCell className='text-right'>{r.keys}</TableCell>
                  <TableCell>
                    <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', selected === r.id && 'text-primary')} />
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

      <CreateResellerDialog open={creating} onOpenChange={setCreating} onCreated={(id) => onSelect(id)} />
    </div>
  )
}
