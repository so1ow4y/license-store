import { refreshAccessToken } from '@/lib/auth/refresh'
import {
  getAccessToken,
  isAccessTokenExpired,
  getRefreshToken,
} from '@/lib/auth/token-store'
import { ApiError, httpRequest, type HttpRequestOptions } from './http'

export { ApiError, API_BASE_URL, API_ORIGIN } from './http'
export type { ApiErrorEnvelope, HttpRequestOptions } from './http'

/**
 * Коды 401, при которых обновление токена бессмысленно: сессия уже погашена
 * сервером. Повторная попытка не просто не поможет — TOKEN_REUSED означает,
 * что цепочка сожжена, а лишний refresh только подтвердит подозрение.
 */
const UNRECOVERABLE_401 = new Set([
  'TOKEN_REUSED',
  'TOKEN_REVOKED',
  'SESSION_REVOKED',
  'TOKEN_INVALID',
])

export type ApiFetchOptions = Omit<HttpRequestOptions, 'token'> & {
  /** Запрос без Authorization: логин, регистрация, сброс пароля, health. */
  anonymous?: boolean
}

/**
 * Основная обёртка над fetch для всего приложения.
 *
 * Что делает сверх httpRequest:
 * 1. подставляет Bearer из token-store;
 * 2. если access заведомо просрочен — обновляет ДО запроса, чтобы не тратить
 *    заведомо провальный заход и не плодить 401 в логах сервера;
 * 3. на 401 обновляет токен через общую очередь и повторяет исходный запрос
 *    РОВНО ОДИН РАЗ. Повтор без ограничения дал бы бесконечный цикл на
 *    сломанном сервере.
 *
 * На 4xx не молчит никогда: любой не-2xx превращается в ApiError.
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { anonymous = false, ...rest } = options

  if (anonymous) return httpRequest<T>(path, { ...rest, token: null })

  let token = getAccessToken()

  // Токена нет, но есть refresh — типичная ситуация сразу после перезагрузки
  // вкладки: access жил в памяти и умер вместе с ней.
  if ((!token || isAccessTokenExpired()) && getRefreshToken()) {
    try {
      token = await refreshAccessToken()
    } catch {
      // Пусть запрос уйдёт как есть и получит честный 401 с кодом от сервера —
      // так UI покажет причину, а не «что-то пошло не так».
      token = getAccessToken()
    }
  }

  try {
    return await httpRequest<T>(path, { ...rest, token })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    if (UNRECOVERABLE_401.has(error.code)) throw error

    // TOKEN_EXPIRED / UNAUTHORIZED — тихо обновляемся и повторяем один раз.
    const freshToken = await refreshAccessToken()
    return httpRequest<T>(path, { ...rest, token: freshToken })
  }
}

/** GET на health-маршруты: они живут вне префикса `api` и вне версии. */
export function healthFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
  return httpRequest<T>(path, { absolute: true, signal })
}
