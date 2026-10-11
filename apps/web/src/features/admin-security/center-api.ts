import { keepPreviousData, queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'

/**
 * Центр безопасности (`security-center.controller.ts`): дашборды, правила
 * корреляции и сработки, приоритет трафика, краевые агенты, контекст адреса.
 */

export type BlockLevel = 'APP' | 'EDGE' | 'FIREWALL'
export const BLOCK_LEVELS: BlockLevel[] = ['APP', 'EDGE', 'FIREWALL']

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export type HitStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE'
export const HIT_STATUSES: HitStatus[] = ['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE']

export type RuleSource = 'LOGINS' | 'AUDIT'
export type RuleAction = 'ALERT' | 'BLOCK_IP' | 'BLOCK_USER'
export const RULE_ACTIONS: RuleAction[] = ['ALERT', 'BLOCK_IP', 'BLOCK_USER']

// ------------------------------------------------------------- дашборды

export const WIDGET_TYPES = ['counter', 'histogram', 'top', 'events', 'hits', 'traffic', 'blocks'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]
export const WIDGET_SIZES = ['s', 'm', 'l', 'full'] as const
export type WidgetSize = (typeof WIDGET_SIZES)[number]

export type Widget = {
  id: string
  type: WidgetType
  title: string
  size: WidgetSize
  source?: 'audit' | 'logins'
  q?: string
  field?: string
}

export type Dashboard = {
  id: string
  ownerId: string
  ownerUsername: string | null
  mine: boolean
  name: string
  shared: boolean
  widgets: Widget[]
  position: number
}

const DASHBOARDS_KEY = ['admin', 'security', 'dashboards'] as const

export const dashboardsQueryOptions = () =>
  queryOptions({
    queryKey: DASHBOARDS_KEY,
    queryFn: () => apiFetch<Dashboard[]>('/admin/security/dashboards'),
  })

function invalidateDashboards() {
  void queryClient.invalidateQueries({ queryKey: DASHBOARDS_KEY })
}

export function useCreateDashboard() {
  return useMutation({
    mutationFn: (body: { name: string; widgets?: Widget[]; shared?: boolean }) =>
      apiFetch<Dashboard>('/admin/security/dashboards', { method: 'POST', body }),
    onSuccess: invalidateDashboards,
  })
}

export function useUpdateDashboard() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; widgets?: Widget[]; shared?: boolean }) =>
      apiFetch<Dashboard>(`/admin/security/dashboards/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    // Раскладку видно сразу, не дожидаясь ответа: перетаскивание и размеры
    // не должны мигать.
    onMutate: ({ id, ...patch }) => {
      queryClient.setQueryData<Dashboard[]>(DASHBOARDS_KEY, (list) => list?.map((d) => (d.id === id ? { ...d, ...patch } : d)))
    },
    onSettled: invalidateDashboards,
  })
}

export function useDeleteDashboard() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/security/dashboards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidateDashboards,
  })
}

// ------------------------------------------------------------- правила

export type Rule = {
  id: string
  name: string
  description: string | null
  enabled: boolean
  source: RuleSource
  query: string
  groupBy: string
  distinctField: string | null
  threshold: number
  windowMinutes: number
  severity: Severity
  action: RuleAction
  blockLevel: BlockLevel
  blockPorts: number[]
  blockHours: number | null
  cooldownMinutes: number
  lastRunAt: string | null
  lastHitAt: string | null
  createdAt: string
  hits24h: number
  hitsOpen: number
}

export type RuleInput = Omit<Rule, 'id' | 'lastRunAt' | 'lastHitAt' | 'createdAt' | 'hits24h' | 'hitsOpen'>

export type RulesResponse = { rules: Rule[]; fields: Record<RuleSource, string[]> }

const RULES_KEY = ['admin', 'security', 'rules'] as const

export const rulesQueryOptions = () =>
  queryOptions({
    queryKey: RULES_KEY,
    queryFn: () => apiFetch<RulesResponse>('/admin/security/rules'),
  })

function invalidateRules() {
  void queryClient.invalidateQueries({ queryKey: RULES_KEY })
  void queryClient.invalidateQueries({ queryKey: HITS_KEY })
}

export function useSaveRule() {
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<RuleInput> & { id?: string }) =>
      id
        ? apiFetch<Rule>(`/admin/security/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body })
        : apiFetch<Rule>('/admin/security/rules', { method: 'POST', body }),
    onSuccess: invalidateRules,
  })
}

export function useDeleteRule() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/security/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidateRules,
  })
}

export function useRunRule() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ hits: number; groups: number }>(`/admin/security/rules/${encodeURIComponent(id)}/run`, { method: 'POST' }),
    onSuccess: () => {
      invalidateRules()
      void queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'ip-blocks'] })
    },
  })
}

export type PreviewGroup = {
  key: string
  count: number
  distinctCount: number | null
  firstEventAt: string
  lastEventAt: string
  protected: boolean
}

export function usePreviewRule() {
  return useMutation({
    mutationFn: (body: RuleInput) =>
      apiFetch<{ from: string; to: string; groups: PreviewGroup[] }>('/admin/security/rules/preview', { method: 'POST', body }),
  })
}

// ------------------------------------------------------------- сработки

export type Hit = {
  id: string
  ruleId: string
  rule: {
    id: string
    name: string
    source: RuleSource
    query: string
    groupBy: string
    distinctField: string | null
    blockLevel: BlockLevel
  }
  groupKey: string
  count: number
  distinctCount: number | null
  severity: Severity
  action: RuleAction
  outcome: string
  blockId: string | null
  status: HitStatus
  windowFrom: string
  windowTo: string
  firstEventAt: string | null
  lastEventAt: string | null
  sample: { field: string; values: { value: string; count: number }[] }[] | null
  note: string | null
  handledById: string | null
  handledByUsername: string | null
  handledAt: string | null
  createdAt: string
}

export type HitsFilter = { status?: HitStatus; ruleId?: string; severity?: Severity; q?: string; skip?: number; take?: number }

const HITS_KEY = ['admin', 'security', 'hits'] as const

export const hitsQueryOptions = (filter: HitsFilter) =>
  queryOptions({
    queryKey: [...HITS_KEY, filter],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams()
      for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== '') p.set(key, String(value))
      return apiFetch<{ items: Hit[]; total: number; open: number; skip: number; take: number }>(`/admin/security/hits?${p}`, { signal })
    },
    placeholderData: keepPreviousData,
  })

export const hitsSummaryQueryOptions = () =>
  queryOptions({
    queryKey: [...HITS_KEY, 'summary'],
    queryFn: () => apiFetch<{ open: number; day: number; critical: number }>('/admin/security/hits/summary'),
    refetchInterval: 30_000,
  })

export function useUpdateHits() {
  return useMutation({
    mutationFn: (body: { ids: string[]; status: HitStatus; note?: string }) =>
      apiFetch<{ updated: number }>('/admin/security/hits/status', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HITS_KEY })
      void queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })
}

// ------------------------------------------------------------- трафик

export type TrafficConfig = {
  enabled: boolean
  maxConcurrent: number
  queueMax: number
  queueTimeoutMs: number
  bypassWeight: number
  lagThresholdMs: number
  anonymousWeight: number
  authenticatedWeight: number
  roleWeights: Record<string, number>
  attackMode: boolean
  attackMinWeight: number
}

export type TrafficSlot = {
  at: string
  admitted: number
  bypass: number
  queued: number
  shed: number
  timedOut: number
  maxInFlight: number
  maxQueue: number
}

export type TrafficPriority = {
  id: string
  kind: 'IP' | 'USER'
  value: string
  weight: number
  note: string | null
  username: string | null
  createdByUsername: string | null
  createdAt: string
}

export type TrafficState = {
  live: {
    config: TrafficConfig
    inFlight: number
    queued: number
    limit: number
    lagMs: number
    slots: TrafficSlot[]
    talkers: { ip: string; count: number; perMinute: number; weight: number }[]
    trustedIps: number
    weightedUsers: number
  }
  priorities: TrafficPriority[]
  you: { ip: string | null; weight: number }
}

const TRAFFIC_KEY = ['admin', 'security', 'traffic'] as const

export const trafficQueryOptions = (live = true) =>
  queryOptions({
    queryKey: TRAFFIC_KEY,
    queryFn: () => apiFetch<TrafficState>('/admin/security/traffic'),
    refetchInterval: live ? 5_000 : false,
  })

function invalidateTraffic() {
  void queryClient.invalidateQueries({ queryKey: TRAFFIC_KEY })
}

export function useUpdateTrafficConfig() {
  return useMutation({
    mutationFn: (body: Partial<TrafficConfig>) =>
      apiFetch<TrafficConfig>('/admin/security/traffic/config', { method: 'PATCH', body }),
    onSuccess: invalidateTraffic,
  })
}

export function useAddPriority() {
  return useMutation({
    mutationFn: (body: { kind: 'IP' | 'USER'; value: string; weight: number; note?: string }) =>
      apiFetch<TrafficPriority>('/admin/security/traffic/priorities', { method: 'POST', body }),
    onSuccess: invalidateTraffic,
  })
}

export function useRemovePriority() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/admin/security/traffic/priorities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidateTraffic,
  })
}

// ------------------------------------------------------------- край и контекст

export type EdgeStatus = {
  configured: boolean
  agents: { agent: 'nginx' | 'firewall'; online: boolean; lastSeenAt: string | null; ip: string | null }[]
}

export const edgeStatusQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'security', 'edge'],
    queryFn: () => apiFetch<EdgeStatus>('/admin/security/edge'),
    refetchInterval: 15_000,
  })

export type IpContext = {
  ip: string
  family: 'ipv4' | 'ipv6'
  scope: 'public' | 'private' | 'loopback' | 'cgnat' | 'link-local' | 'documentation' | 'multicast'
  reverseDns: string | null
  logins: {
    total: number
    failed: number
    failed24h: number
    success24h: number
    users: number
    countries: string[] | null
    firstSeen: string | null
    lastSeen: string | null
  }
  audit: { total24h: number; lastAction: string | null; lastAt: string | null }
  users: { id: string; username: string; status: string; hits: number; lastSeenAt: string; rolePriority: number }[]
  blocks: { id: string; cidr: string; level: BlockLevel; ports: number[]; reason: string | null; source: string; expiresAt: string | null }[]
  trusted: { id: string; value: string; weight: number; note: string | null }[]
  weight: number
  hits: { id: string; createdAt: string; status: HitStatus; severity: Severity; outcome: string; count: number; ruleName: string }[]
}

export const ipContextQueryOptions = (ip: string) =>
  queryOptions({
    queryKey: ['admin', 'security', 'ip', ip],
    queryFn: ({ signal }) => apiFetch<IpContext>(`/admin/security/ip/${encodeURIComponent(ip)}`, { signal }),
    staleTime: 30_000,
  })
