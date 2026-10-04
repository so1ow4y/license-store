import { queryOptions, useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryClient } from '@/lib/api/query-client'
import { SESSION_QUERY_KEY } from '@/lib/auth/session'

/**
 * Профиль (`auth.controller.ts`):
 *   POST /auth/me/username          — сменить логин (текущий пароль)
 *   POST /auth/me/email             — запросить смену почты (ссылка на новый адрес)
 *   POST /auth/email-change/confirm — переход по ссылке из письма
 *   GET  /auth/me/access            — свои роли и права (с уровня поддержки)
 */

export type MyAccess = {
  roles: { slug: string; name: string; description: string | null; priority: number }[]
  permissions: { slug: string; group: string; description: string | null }[]
}

export const myAccessQueryOptions = () =>
  queryOptions({
    queryKey: ['auth', 'me', 'access'],
    queryFn: () => apiFetch<MyAccess>('/auth/me/access'),
    staleTime: 60_000,
  })

function refreshSession() {
  void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
}

export function useChangeUsername() {
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      apiFetch<{ message: string }>('/auth/me/username', { method: 'POST', body }),
    onSuccess: refreshSession,
  })
}

export function useChangeEmail() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      apiFetch<{ message: string }>('/auth/me/email', { method: 'POST', body }),
    onSuccess: refreshSession,
  })
}

export function confirmEmailChange(token: string) {
  return apiFetch<{ message: string }>('/auth/email-change/confirm', { method: 'POST', body: { token } })
}
