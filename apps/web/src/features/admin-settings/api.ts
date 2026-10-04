import { queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'

/** Настройки платформы (`admin.controller.ts`). Значения секретов сервер не отдаёт. */

export type AdminSetting = {
  key: string
  category: string
  description: string | null
  isSecret: boolean
  value: unknown
  isSet: boolean
  updatedAt: string
}

export const adminSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ['admin', 'settings'],
    queryFn: () => apiFetch<AdminSetting[]>('/admin/settings'),
  })

export function useUpdateSetting() {
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      apiFetch<AdminSetting>(`/admin/settings/${encodeURIComponent(key)}`, { method: 'PATCH', body: { value } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
  })
}
