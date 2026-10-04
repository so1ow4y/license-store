import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { has, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText } from '@/features/admin/error-text'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import { adminLicensesQueryOptions } from '@/features/admin-licenses/api'
import { useCreateIpBlock, userIpsQueryOptions } from '@/features/admin-security/api'
import { adminProductsQueryOptions } from '@/features/admin-products/api'
import {
  adminRolesQueryOptions,
  adminUserQueryOptions,
  useBlockUser,
  useIssueLicense,
  useSetRoles,
  useUnblockUser,
  useUpdateUser,
  type AdminUserDetail,
} from '@/features/admin-users/api'
import { UserStatusBadge } from '@/features/admin-users/status-badge'
import { formatPrice } from '@/features/catalog/api'
import { LicenseStatusBadge } from '@/features/licenses/status-badge'
import { ordersQueryOptions } from '@/features/orders/api'
import { OrderStatusBadge, providerLabel } from '@/features/orders/status-badge'
import { formatDate, formatDateTime } from '@/lib/format/date'

export const Route = createFileRoute('/_app/admin/users/$userId')({
  beforeLoad: ({ context }) => {
    if (!has(context.me.permissions, PERMISSIONS.USERS_READ_ANY)) throw redirect({ to: '/403' })
  },
  component: AdminUserPage,
})

function AdminUserPage() {
  const { userId } = Route.useParams()
  const t = useT()
  const { can } = useSession()
  const query = useQuery(adminUserQueryOptions(userId))

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='mx-auto w-full max-w-5xl space-y-6'>
      <Button asChild variant='ghost' size='sm' className='-ml-2'>
        <Link to='/admin/users'>
          <ArrowLeft className='size-4' />
          {t('admin.users.back')}
        </Link>
      </Button>

      {query.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : (
        <>
          <header className='flex flex-wrap items-center gap-3'>
            <h1 className='text-xl font-semibold'>{query.data.username}</h1>
            <UserStatusBadge status={query.data.status} />
          </header>
          <ProfileCard user={query.data} canEdit={can(PERMISSIONS.USERS_UPDATE_ANY)} />
          {can(PERMISSIONS.USERS_BLOCK) && <BlockCard user={query.data} />}
          {can(PERMISSIONS.SECURITY_IPS_READ) && (
            <IpsCard user={query.data} canBlock={can(PERMISSIONS.SECURITY_IP_BLOCK)} />
          )}
          {can(PERMISSIONS.ROLES_ASSIGN) && <RolesCard user={query.data} />}
          {can(PERMISSIONS.LICENSES_READ_ANY) && (
            <LicensesCard userId={query.data.id} canIssue={can(PERMISSIONS.LICENSES_CREATE_ANY)} />
          )}
          {can(PERMISSIONS.ORDERS_READ_ANY) && <OrdersCard userId={query.data.id} />}
        </>
      )}
    </div>
  )
}

function ProfileCard({ user, canEdit }: { user: AdminUserDetail; canEdit: boolean }) {
  const t = useT()
  const update = useUpdateUser(user.id)
  const [username, setUsername] = useState(user.username)
  const [email, setEmail] = useState(user.email ?? '')
  const [verified, setVerified] = useState(Boolean(user.emailVerifiedAt))

  useEffect(() => {
    setUsername(user.username)
    setEmail(user.email ?? '')
    setVerified(Boolean(user.emailVerifiedAt))
  }, [user])

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    update.mutate(
      {
        ...(username !== user.username ? { username } : {}),
        ...(email !== (user.email ?? '') ? { email: email.trim() || null } : {}),
        ...(verified !== Boolean(user.emailVerifiedAt) ? { emailVerified: verified } : {}),
      },
      { onSuccess: () => toast.success(t('admin.saved')) }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.users.section.profile')}</CardTitle>
        <CardDescription>
          {t('admin.users.meta', {
            created: formatDate(user.createdAt),
            login: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—',
          })}
          {' · '}
          {user.twoFactorEnabled ? t('admin.users.twoFactorOn') : t('admin.users.twoFactorOff')}
          {user.oauth.length > 0 && ` · ${user.oauth.map((o) => o.provider).join(', ')}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label>{t('admin.users.field.username')}</Label>
            <Input value={username} disabled={!canEdit} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label>{t('admin.users.field.email')}</Label>
            <Input type='email' value={email} disabled={!canEdit} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox checked={verified} disabled={!canEdit} onCheckedChange={(v) => setVerified(v === true)} />
            {t('admin.users.field.emailVerified')}
          </label>
          {canEdit && (
            <div className='space-y-2 sm:col-span-2'>
              <AdminErrorText error={update.error} />
              <Button type='submit' disabled={update.isPending}>
                {t('common.action.save')}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

function BlockCard({ user }: { user: AdminUserDetail }) {
  const t = useT()
  const block = useBlockUser(user.id)
  const unblock = useUnblockUser(user.id)
  const [reason, setReason] = useState('')
  const blocked = user.status === 'BLOCKED'

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.users.section.access')}</CardTitle>
        <CardDescription>
          {blocked
            ? t('admin.users.blockedAt', {
                date: formatDateTime(user.blockedAt),
                reason: user.blockedReason ?? '—',
              })
            : t('admin.users.blockHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {blocked ? (
          <Button
            variant='outline'
            disabled={unblock.isPending}
            onClick={() => unblock.mutate(undefined, { onSuccess: () => toast.success(t('admin.saved')) })}
          >
            {t('admin.users.unblock')}
          </Button>
        ) : (
          <>
            <Textarea
              rows={2}
              maxLength={500}
              value={reason}
              placeholder={t('admin.users.blockReason')}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant='destructive'
              disabled={!reason.trim() || block.isPending}
              onClick={() =>
                block.mutate(reason.trim(), {
                  onSuccess: () => {
                    setReason('')
                    toast.success(t('admin.saved'))
                  },
                })
              }
            >
              {t('admin.users.block')}
            </Button>
          </>
        )}
        <AdminErrorText error={block.error ?? unblock.error} />
      </CardContent>
    </Card>
  )
}

/** Адреса пользователя: когда и сколько раз, кто ещё с них заходил, блокировка IP. */
function IpsCard({ user, canBlock }: { user: AdminUserDetail; canBlock: boolean }) {
  const t = useT()
  const ips = useQuery(userIpsQueryOptions(user.id))
  const block = useCreateIpBlock()

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.users.section.ips')}</CardTitle>
        <CardDescription>{t('admin.users.ipsHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {ips.isPending ? (
          <Skeleton className='h-20 w-full' />
        ) : ips.isError ? (
          <AdminErrorText error={ips.error} />
        ) : ips.data.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('admin.users.noIps')}</p>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP</TableHead>
                  <TableHead>{t('admin.users.ip.lastSeen')}</TableHead>
                  <TableHead>{t('admin.users.ip.firstSeen')}</TableHead>
                  <TableHead>{t('admin.users.ip.hits')}</TableHead>
                  <TableHead>{t('admin.users.ip.shared')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ips.data.map((row) => (
                  <TableRow key={row.ip}>
                    <TableCell className='font-mono text-xs' title={row.lastUserAgent ?? undefined}>
                      {row.ip}
                      {row.blocked && (
                        <Badge variant='destructive' className='ms-2'>
                          {t('admin.users.ip.blocked')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(row.lastSeenAt)}</TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(row.firstSeenAt)}</TableCell>
                    <TableCell>{row.hits}</TableCell>
                    <TableCell>
                      {row.sharedWith > 0 ? (
                        <Link
                          to='/admin/users'
                          search={{ q: `ip:${row.ip} -id:${user.id}` }}
                          className='text-primary underline-offset-4 hover:underline'
                        >
                          {t('admin.users.ip.sharedLink', { count: row.sharedWith })}
                        </Link>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                    <TableCell className='text-end'>
                      {canBlock && !row.blocked && (
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={block.isPending}
                          onClick={() =>
                            block.mutate(
                              { value: row.ip, reason: t('admin.users.ip.blockReason', { username: user.username }) },
                              {
                                onSuccess: () => {
                                  toast.success(t('security.blocks.ipDone'))
                                  void ips.refetch()
                                },
                              }
                            )
                          }
                        >
                          {t('security.blocks.block')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <AdminErrorText error={block.error} />
      </CardContent>
    </Card>
  )
}

function RolesCard({ user }: { user: AdminUserDetail }) {
  const t = useT()
  const roles = useQuery(adminRolesQueryOptions())
  const setRoles = useSetRoles(user.id)
  const [selected, setSelected] = useState<string[]>(user.roles.map((r) => r.slug))

  useEffect(() => setSelected(user.roles.map((r) => r.slug)), [user])

  function toggle(slug: string, on: boolean) {
    setSelected((prev) => (on ? [...prev, slug] : prev.filter((s) => s !== slug)))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.users.section.roles')}</CardTitle>
        <CardDescription>{t('admin.users.rolesHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex flex-wrap gap-4'>
          {(roles.data ?? []).map((role) => (
            <label key={role.slug} className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={selected.includes(role.slug)}
                onCheckedChange={(v) => toggle(role.slug, v === true)}
              />
              {role.name}
            </label>
          ))}
        </div>
        <AdminErrorText error={setRoles.error} />
        <Button
          disabled={setRoles.isPending || selected.length === 0}
          onClick={() => setRoles.mutate(selected, { onSuccess: () => toast.success(t('admin.saved')) })}
        >
          {t('common.action.save')}
        </Button>
      </CardContent>
    </Card>
  )
}

function LicensesCard({ userId, canIssue }: { userId: string; canIssue: boolean }) {
  const t = useT()
  const licenses = useQuery(adminLicensesQueryOptions({ userId, skip: 0, take: 50 }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.users.section.licenses')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {licenses.isPending ? (
          <Skeleton className='h-20 w-full' />
        ) : licenses.isError ? (
          <AdminErrorText error={licenses.error} />
        ) : licenses.data.items.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('admin.users.noLicenses')}</p>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.licenses.column.key')}</TableHead>
                  <TableHead>{t('admin.licenses.column.product')}</TableHead>
                  <TableHead>{t('admin.licenses.column.status')}</TableHead>
                  <TableHead>{t('admin.licenses.column.expires')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licenses.data.items.map((license) => (
                  <TableRow key={license.id}>
                    <TableCell className='font-mono text-xs'>{license.maskedKey}</TableCell>
                    <TableCell>
                      {license.product.name}
                      <span className='block text-xs text-muted-foreground'>{license.plan.name}</span>
                    </TableCell>
                    <TableCell>
                      <LicenseStatusBadge compact status={license.status} />
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>
                      {license.expiresAt ? formatDate(license.expiresAt) : t('licenses.plan.lifetime')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {canIssue && <IssueLicenseForm userId={userId} />}
      </CardContent>
    </Card>
  )
}

function IssueLicenseForm({ userId }: { userId: string }) {
  const t = useT()
  const products = useQuery(adminProductsQueryOptions())
  const issue = useIssueLicense(userId)
  const [productId, setProductId] = useState('')
  const [planId, setPlanId] = useState('')

  const product = products.data?.find((p) => p.id === productId)

  return (
    <div className='space-y-2 rounded-md border p-3'>
      <p className='text-sm font-medium'>{t('admin.users.issue.title')}</p>
      <div className='flex flex-wrap gap-2'>
        <Select
          value={productId}
          onValueChange={(v) => {
            setProductId(v)
            setPlanId('')
          }}
        >
          <SelectTrigger className='w-56'>
            <SelectValue placeholder={t('admin.users.issue.product')} />
          </SelectTrigger>
          <SelectContent>
            {(products.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={planId} onValueChange={setPlanId} disabled={!product}>
          <SelectTrigger className='w-56'>
            <SelectValue placeholder={t('admin.users.issue.plan')} />
          </SelectTrigger>
          <SelectContent>
            {(product?.plans ?? []).map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!productId || !planId || issue.isPending}
          onClick={() =>
            issue.mutate(
              { productId, planId },
              {
                onSuccess: () => {
                  toast.success(t('admin.users.issue.done'))
                  setPlanId('')
                },
              }
            )
          }
        >
          {t('admin.users.issue.action')}
        </Button>
      </div>
      <p className='text-xs text-muted-foreground'>{t('admin.users.issue.hint')}</p>
      <AdminErrorText error={issue.error} />
    </div>
  )
}

function OrdersCard({ userId }: { userId: string }) {
  const t = useT()
  const orders = useQuery(ordersQueryOptions({ userId, take: 20 }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.users.section.orders')}</CardTitle>
      </CardHeader>
      <CardContent>
        {orders.isPending ? (
          <Skeleton className='h-20 w-full' />
        ) : orders.isError ? (
          <AdminErrorText error={orders.error} />
        ) : orders.data.items.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('admin.users.noOrders')}</p>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableBody>
                {orders.data.items.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className='font-mono text-xs'>{order.number}</TableCell>
                    <TableCell>{order.product.name}</TableCell>
                    <TableCell className='whitespace-nowrap'>{formatPrice(order.amount, order.currency)}</TableCell>
                    <TableCell>{order.payment ? providerLabel(order.payment.provider) : '—'}</TableCell>
                    <TableCell>
                      <OrderStatusBadge order={order} />
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(order.createdAt)}</TableCell>
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
