import { useCallback, useSyncExternalStore } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { ApiError } from '@/lib/api/http'
import { setPriorityPass } from '@/lib/api/priority-pass'
import { queryClient } from '@/lib/api/query-client'
import { has } from './permissions'
import { bootstrapTokens, setRefreshFailureHandler } from './refresh'
import { clearTokens, hasStoredSession, rememberSessionUser, subscribeTokens } from './token-store'

/**
 * Ответ `GET /auth/me` — единственный источник правды о текущем пользователе.
 * Почты и роли здесь нет: меню гейтится по `permissions`.
 */
export type Me = {
  id: string
  username: string
  email: string | null
  emailVerified: boolean
  /** Новая почта, ждущая перехода по ссылке из письма. */
  pendingEmail: string | null
  sessionId: string
  permissions: string[]
  hasPassword: boolean
  /**
   * true — у аккаунта нет пароля, а он обязателен: без него лицензия не
   * выдаётся и загрузчик не стартует. Показывается блокирующим баннером.
   */
  requiresPassword: boolean
  providers: string[]
  twoFactorEnabled: boolean
}

export const SESSION_QUERY_KEY = ['auth', 'me'] as const

export const meQueryOptions = () =>
  queryOptions({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const me = await apiFetch<Me>('/auth/me', { signal })
      rememberSessionUser(me.id)
      refreshPriorityPass(me.sessionId)
      return me
    },
    // Права меняются редко, но после смены пароля или 2FA данные обязаны
    // перечитаться — за этим следят экраны безопасности через invalidate.
    // Возврат на вкладку тоже перечитывает: роль могли поменять в другой
    // вкладке или другой администратор, и меню должно это увидеть.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  })

/** Сессия, для которой пропуск приоритета уже запрошен: раз на вход, а не на каждый refetch. */
let passSession: string | null = null

/**
 * Пропуск приоритета для доверенного пользователя (priority-pass.ts). У
 * обычного сервер вернёт null — тогда чужой пропуск в этом браузере стирается.
 * Ошибка не мешает сессии: без пропуска просто нет места в очереди.
 */
function refreshPriorityPass(sessionId: string): void {
  if (passSession === sessionId) return
  passSession = sessionId
  apiFetch<{ pass: string | null; expiresAt?: string }>('/security/priority-pass')
    .then((result) => setPriorityPass(result.pass && result.expiresAt ? { pass: result.pass, expiresAt: result.expiresAt } : null))
    .catch(() => {
      passSession = null
    })
}

/* ------------------------------------------------------------------ */
/* Подсказка профиля                                                    */
/* ------------------------------------------------------------------ */

/**
 * Имя и почта приходят ровно один раз — в ответе `POST /auth/login`.
 * Держим их в памяти как подсказку для приветствия. Намеренно НЕ сохраняем
 * в storage: это персональные данные, а после перезагрузки взять их неоткуда,
 * и UI обязан уметь жить без них.
 */
export type ProfileHint = { username: string; email: string; locale?: string }

let profileHint: ProfileHint | null = null
const hintListeners = new Set<() => void>()

export function setProfileHint(hint: ProfileHint | null): void {
  profileHint = hint
  for (const listener of hintListeners) listener()
}

export function useProfileHint(): ProfileHint | null {
  return useSyncExternalStore(
    (listener) => {
      hintListeners.add(listener)
      return () => hintListeners.delete(listener)
    },
    () => profileHint,
    () => null
  )
}

/* ------------------------------------------------------------------ */
/* Выход                                                                */
/* ------------------------------------------------------------------ */

export type LogoutReason =
  | 'expired'
  | 'reused'
  | 'revoked'
  | 'manual'
  | 'forbidden'

/**
 * Полный сброс сессии: токены, кеш запросов, подсказка профиля — и переход
 * на вход. Уходим именно перезагрузкой страницы, а не router.navigate:
 * это гарантирует, что в памяти не осталось ни одного объекта с чужими
 * данными, что важнее плавности перехода на экране выхода.
 */
export function hardLogout(reason: LogoutReason = 'manual'): void {
  clearTokens()
  setProfileHint(null)
  queryClient.clear()

  if (typeof window === 'undefined') return

  const target = new URL('/login', window.location.origin)
  if (reason !== 'manual') target.searchParams.set('reason', reason)

  // Уже на экране входа — второй раз никуда не гоним, иначе получим цикл
  // перезагрузок при протухшем токене на публичной странице.
  if (window.location.pathname.startsWith('/login')) {
    if (window.location.search !== target.search) {
      window.location.replace(target.toString())
    }
    return
  }
  window.location.replace(target.toString())
}

/** Коды, после которых цепочка сессии погашена сервером — только hardLogout. */
const FATAL_REFRESH_CODES: Record<string, LogoutReason> = {
  TOKEN_REUSED: 'reused',
  TOKEN_REVOKED: 'revoked',
  SESSION_REVOKED: 'revoked',
  TOKEN_INVALID: 'expired',
  UNAUTHORIZED: 'expired',
}

/* ------------------------------------------------------------------ */
/* Холодный старт                                                       */
/* ------------------------------------------------------------------ */

/**
 * Восстановление сессии до первого рендера защищённых маршрутов.
 *
 * Вызывается один раз из main.tsx ДО RouterProvider: иначе `beforeLoad`
 * защищённого layout увидит пустой token-store, решит, что перед ним гость,
 * и выкинет на вход каждого, кто просто перезагрузил вкладку.
 */
export async function bootstrapSession(): Promise<boolean> {
  // Регистрируем реакцию на смерть сессии в фоне (обновление упало на живой
  // странице) — до того, как случится первый запрос.
  setRefreshFailureHandler(({ code }) => {
    const reason = FATAL_REFRESH_CODES[code]
    if (reason) hardLogout(reason)
  })

  if (!hasStoredSession()) return false
  return bootstrapTokens()
}

/* ------------------------------------------------------------------ */
/* Хук                                                                  */
/* ------------------------------------------------------------------ */

export type Session = {
  me: Me | undefined
  isLoading: boolean
  error: ApiError | null
  /** Признак «пользователь опознан». */
  isAuthenticated: boolean
  /** Проверка права; роли в ответе сервера нет, гейтим только правами. */
  can: (permission: string) => boolean
  /** Без пароля лицензия не выдаётся — глобальный баннер. */
  requiresPassword: boolean
  refetch: () => void
}

/**
 * Данные текущей сессии. Ходит в `/auth/me` только при наличии токенов —
 * иначе публичные экраны (вход, регистрация) генерировали бы по 401 на каждом
 * заходе и засоряли счётчики частоты.
 */
export function useSession(): Session {
  // Появление токена после входа должно перерисовать зависимые компоненты.
  const hasTokens = useSyncExternalStore(
    subscribeTokens,
    hasStoredSession,
    () => false
  )

  const query = useQuery({ ...meQueryOptions(), enabled: hasTokens })

  const can = useCallback(
    (permission: string) => has(query.data?.permissions, permission),
    [query.data?.permissions]
  )

  return {
    me: query.data,
    isLoading: hasTokens && query.isPending,
    error: query.error instanceof ApiError ? query.error : null,
    isAuthenticated: Boolean(query.data),
    can,
    requiresPassword: query.data?.requiresPassword === true,
    refetch: () => void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  }
}

/** Короткая форма для условного показа пункта меню или кнопки. */
export function useHasPermission(permission: string): boolean {
  const { can } = useSession()
  return can(permission)
}
