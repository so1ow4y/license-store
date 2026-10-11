import { queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'
import { SESSION_QUERY_KEY } from '@/lib/auth/session'
import type { BulkResult } from '@/features/admin/bulk'

/** Пользователи и роли в панели (`admin.controller.ts`). */

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'BLOCKED' | 'DELETED'
export const USER_STATUSES: UserStatus[] = ['ACTIVE', 'PENDING_VERIFICATION', 'BLOCKED']

export type RoleRef = { slug: string; name: string; priority: number }

export type AdminUser = {
  id: string
  username: string
  email: string | null
  status: UserStatus
  emailVerifiedAt: string | null
  twoFactorEnabled: boolean
  createdAt: string
  lastLoginAt: string | null
  roles: RoleRef[]
  licenses: number
  orders: number
  /** Последние адреса — только при праве security.ips.read. */
  ips?: { recent: string[]; count: number; lastSeenAt: string | null }
}

/** Поля строки поиска пользователей — те же, что разбирает сервер. */
export const USER_SEARCH_FIELDS = ['username', 'email', 'role', 'status', 'ip', '2fa', 'id'] as const

export type AdminUserDetail = AdminUser & {
  locale: string
  blockedAt: string | null
  blockedReason: string | null
  lastLoginIp: string | null
  hasPassword: boolean
  oauth: { provider: string; providerUsername: string | null; createdAt: string }[]
  /** Карточка реселлера, если аккаунт продаёт оптом. */
  reseller: { id: string; displayName: string; status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' } | null
}

export type AdminRole = RoleRef & {
  id: string
  description: string | null
  /** Системные роли принадлежат сиду и в панели только читаются. */
  isSystem: boolean
  permissions: string[]
  users: number
}

export type PermissionInfo = { slug: string; group: string; description: string | null }

export type UserFilters = {
  q?: string
  status?: UserStatus
  role?: string
  /** Дата регистрации: не раньше / не позже (ISO). */
  from?: string
  to?: string
  skip: number
  take: number
}

const enc = encodeURIComponent

export const adminUsersQueryOptions = (filters: UserFilters) =>
  queryOptions({
    queryKey: ['admin', 'users', filters],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams()
      if (filters.q?.trim()) params.set('q', filters.q.trim())
      if (filters.status) params.set('status', filters.status)
      if (filters.role) params.set('role', filters.role)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.skip) params.set('skip', String(filters.skip))
      params.set('take', String(filters.take))
      return apiFetch<{ items: AdminUser[]; total: number }>(`/admin/users?${params}`, { signal })
    },
    staleTime: 10_000,
  })

export const adminUserQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'users', 'one', id],
    queryFn: () => apiFetch<AdminUserDetail>(`/admin/users/${enc(id)}`),
  })

export const adminRolesQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiFetch<AdminRole[]>('/admin/roles'),
    staleTime: 5 * 60_000,
  })

export const permissionsQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'permissions'],
    queryFn: () => apiFetch<PermissionInfo[]>('/admin/permissions'),
    staleTime: 10 * 60_000,
  })

export type RoleInput = {
  slug?: string
  name?: string
  description?: string | null
  priority?: number
  permissions?: string[]
}

function invalidateRoles(): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
  void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  // Изменённая роль может быть и у самого администратора — меню перечитает права.
  void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
}

/** Создать (без id) или изменить свою роль. */
export function useSaveRole(id?: string) {
  return useMutation({
    mutationFn: (body: RoleInput) =>
      id
        ? apiFetch<AdminRole>(`/admin/roles/${enc(id)}`, { method: 'PATCH', body })
        : apiFetch<AdminRole>('/admin/roles', { method: 'POST', body }),
    onSuccess: invalidateRoles,
  })
}

export function useDeleteRole() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ users: number }>(`/admin/roles/${enc(id)}`, { method: 'DELETE' }),
    onSuccess: invalidateRoles,
  })
}

function store(user: AdminUserDetail): void {
  queryClient.setQueryData(adminUserQueryOptions(user.id).queryKey, user)
  void queryClient.invalidateQueries({ queryKey: ['admin', 'users'], refetchType: 'none' })
}

export function useUpdateUser(id: string) {
  return useMutation({
    mutationFn: (body: { username?: string; email?: string | null; emailVerified?: boolean }) =>
      apiFetch<AdminUserDetail>(`/admin/users/${enc(id)}`, { method: 'PATCH', body }),
    onSuccess: store,
  })
}

export function useBlockUser(id: string) {
  return useMutation({
    mutationFn: (reason: string) =>
      apiFetch<AdminUserDetail>(`/admin/users/${enc(id)}/block`, { method: 'POST', body: { reason } }),
    onSuccess: store,
  })
}

export function useUnblockUser(id: string) {
  return useMutation({
    mutationFn: () => apiFetch<AdminUserDetail>(`/admin/users/${enc(id)}/unblock`, { method: 'POST' }),
    onSuccess: store,
  })
}

export function useSetRoles(id: string) {
  return useMutation({
    mutationFn: (roles: string[]) =>
      apiFetch<AdminUserDetail>(`/admin/users/${enc(id)}/roles`, { method: 'PUT', body: { roles } }),
    onSuccess: store,
  })
}

function invalidateUsers(): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
}

/** Массовая блокировка или разблокировка пользователей (до 500 за раз). */
export function useBulkUsers() {
  return useMutation({
    mutationFn: (body: { action: 'block' | 'unblock'; ids: string[]; reason?: string }) =>
      apiFetch<BulkResult>('/admin/users/bulk', { method: 'POST', body }),
    onSuccess: invalidateUsers,
  })
}

/** Заблокировать все известные адреса выбранных пользователей. */
export function useBlockUsersIps() {
  return useMutation({
    mutationFn: (body: { ids: string[]; reason?: string; expiresInHours?: number }) =>
      apiFetch<BulkResult>('/admin/users/block-ips', { method: 'POST', body }),
    onSuccess: () => {
      invalidateUsers()
      void queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'ip-blocks'] })
    },
  })
}

/** Ручная выдача лицензии пользователю (POST /licenses). */
export function useIssueLicense(userId: string) {
  return useMutation({
    mutationFn: (body: { productId: string; planId: string; notes?: string }) =>
      apiFetch<{ id: string }>('/licenses', { method: 'POST', body: { ...body, userId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'licenses'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'one', userId] })
    },
  })
}
