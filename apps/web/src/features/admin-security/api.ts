import { keepPreviousData, queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'
import type { BulkResult } from '@/features/admin/bulk'

/**
 * Мини-SIEM (`admin.controller.ts`): журнал событий и входов с поиском
 * «поле:значение», гистограммой и топом значений; блокировки адресов.
 */

export type LogKind = 'audit' | 'logins'

export type AuditEvent = {
  id: string
  createdAt: string
  actorId: string | null
  actorType: string
  actorLabel: string | null
  actorUsername: string | null
  action: string
  entityType: string | null
  entityId: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
  before: unknown
  after: unknown
}

export type LoginEvent = {
  id: string
  createdAt: string
  userId: string | null
  username: string | null
  identifierUsed: string | null
  success: boolean
  failureReason: string | null
  method: string
  ip: string | null
  country: string | null
  userAgent: string | null
  clientVersion: string | null
}

export type LogPage<T> = { items: T[]; total: number; skip: number; take: number }

export type LogStats = {
  interval: string
  intervalMs: number
  histogram: { bucket: string; count: number; failed?: number }[]
  facets: { field: string; values: { value: string; count: number }[] }[]
}

export type LogSearch = { q: string; from?: string; to?: string; skip: number; take: number }

/** Поля строки поиска — те же, что разбирает сервер. */
export const SEARCH_FIELDS: Record<LogKind, string[]> = {
  audit: ['action', 'actor', 'actortype', 'entity', 'entityid', 'ip', 'request'],
  logins: ['user', 'ip', 'result', 'reason', 'method', 'country'],
}

function params(search: Omit<LogSearch, 'skip' | 'take'> & { skip?: number; take?: number }) {
  const p = new URLSearchParams()
  if (search.q.trim()) p.set('q', search.q.trim())
  if (search.from) p.set('from', search.from)
  if (search.to) p.set('to', search.to)
  if (search.skip) p.set('skip', String(search.skip))
  if (search.take) p.set('take', String(search.take))
  return p.toString()
}

const PATH: Record<LogKind, string> = { audit: '/admin/audit', logins: '/admin/logins' }

export const logSearchQueryOptions = <K extends LogKind>(kind: K, search: LogSearch) =>
  queryOptions({
    queryKey: ['admin', 'security', kind, 'items', search],
    queryFn: ({ signal }) =>
      apiFetch<LogPage<K extends 'audit' ? AuditEvent : LoginEvent>>(`${PATH[kind]}?${params(search)}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  })

export const logStatsQueryOptions = (kind: LogKind, search: Omit<LogSearch, 'skip' | 'take'>) =>
  queryOptions({
    queryKey: ['admin', 'security', kind, 'stats', search],
    queryFn: ({ signal }) => apiFetch<LogStats>(`${PATH[kind]}/stats?${params(search)}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  })

// ------------------------------------------------------------ блокировки IP

export type IpBlock = {
  id: string
  cidr: string
  reason: string | null
  level: 'APP' | 'EDGE' | 'FIREWALL'
  ports: number[]
  source: 'manual' | 'rule'
  ruleId: string | null
  createdById: string | null
  createdByUsername: string | null
  createdAt: string
  expiresAt: string | null
  active: boolean
}

export const ipBlocksQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'security', 'ip-blocks'],
    queryFn: () => apiFetch<IpBlock[]>('/admin/security/ip-blocks'),
  })

function invalidateBlocks() {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'ip-blocks'] })
  void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
}

export function useCreateIpBlock() {
  return useMutation({
    mutationFn: (body: { value: string; reason?: string; expiresInHours?: number; level?: IpBlock['level']; ports?: number[] }) =>
      apiFetch<IpBlock>('/admin/security/ip-blocks', { method: 'POST', body }),
    onSuccess: invalidateBlocks,
  })
}

/** Массовая блокировка адресов (до 500 за раз): по одному отказу остальные не отменяются. */
export function useBulkIpBlock() {
  return useMutation({
    mutationFn: (body: { values: string[]; reason?: string; expiresInHours?: number; level?: IpBlock['level']; ports?: number[] }) =>
      apiFetch<BulkResult>('/admin/security/ip-blocks/bulk', { method: 'POST', body }),
    onSuccess: invalidateBlocks,
  })
}

export function useRemoveIpBlock() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/security/ip-blocks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidateBlocks,
  })
}

export function useBlockByUsername() {
  return useMutation({
    mutationFn: (body: { username: string; reason: string }) =>
      apiFetch<unknown>('/admin/users/block-by-username', { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

// ---------------------------------------------------------- адреса пользователя

export type UserIp = {
  ip: string
  firstSeenAt: string
  lastSeenAt: string
  hits: number
  lastUserAgent: string | null
  sharedWith: number
  blocked: boolean
}

export const userIpsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ['admin', 'users', 'ips', userId],
    queryFn: () => apiFetch<UserIp[]>(`/admin/users/${encodeURIComponent(userId)}/ips`),
  })

// ------------------------------------------------------------ строка запроса

/**
 * Добавить условие в строку поиска (клик по значению в таблице или фасете).
 * Положительное условие заменяет прежнее по тому же полю, исключения копятся.
 */
export function withTerm(q: string, field: string, value: string, negate = false): string {
  const quoted = /[\s()|]/.test(value) ? `"${value.replace(/"/g, '')}"` : value
  const term = `${negate ? '-' : ''}${field}:${quoted}`
  // Со скобками и OR замена «по полю» сломала бы логику запроса —
  // тогда условие просто добавляется через AND.
  if (/[()|]|(^|\s)(or|and|not)(\s|$)/i.test(q.replace(/"[^"]*"/g, ''))) {
    return /(^|\s)or(\s|$)|\|/i.test(q) ? `(${q.trim()}) ${term}` : `${q.trim()} ${term}`
  }
  const parts = q.match(/-?(?:\w+:)?(?:"[^"]*"|\S+)/g) ?? []
  const kept = parts.filter(
    (part) => part !== term && (negate || !part.toLowerCase().startsWith(`${field.toLowerCase()}:`))
  )
  return [...kept, term].join(' ')
}
