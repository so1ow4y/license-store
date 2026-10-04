import { ApiError, httpRequest } from '@/lib/api/http'
import {
  clearTokens,
  getRefreshToken,
  isAccessTokenExpired,
  setTokens,
} from './token-store'

/**
 * Обновление пары токенов с очередью на всё приложение.
 *
 * Сервер РОТИРУЕТ refresh: после успешного обновления старый токен мгновенно
 * мёртв, а его повторное предъявление трактуется как кража — 401 TOKEN_REUSED
 * и гашение ВСЕЙ цепочки сессии. Поэтому очередь здесь не оптимизация сетевых
 * заходов: два параллельных 401 (а это норма — дашборд грузит несколько
 * запросов разом) без неё отправят второй refresh со старым токеном и убьют
 * живую сессию пользователя.
 *
 * Инвариант: в любой момент времени существует не более одного промиса
 * обновления, все остальные ждут его результат.
 */

type RefreshResponse = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** Тот самый единственный промис. null — обновление сейчас не идёт. */
let inFlight: Promise<string> | null = null

/** Причина, по которой сессия окончательно погибла; читает session.tsx. */
export type RefreshFailure = { code: string; message: string }

type FailureHandler = (failure: RefreshFailure) => void
let onFailure: FailureHandler | null = null

/**
 * Регистрация реакции на безнадёжный отказ обновления. Через колбэк, а не
 * прямым импортом hardLogout: session.tsx уже зависит от этого модуля,
 * прямая ссылка обратно замкнула бы граф импортов.
 */
export function setRefreshFailureHandler(handler: FailureHandler | null): void {
  onFailure = handler
}

async function performRefresh(refreshToken: string): Promise<string> {
  try {
    // Bearer здесь не нужен и вреден: маршрут ждёт токен в теле, а протухший
    // Authorization заставил бы гвард отказать раньше, чем дело дойдёт до тела.
    const data = await httpRequest<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    })
    setTokens(data)
    return data.accessToken
  } catch (error) {
    if (error instanceof ApiError) {
      // 5xx — сервер лежит, токен при этом жив. Стирать его нельзя:
      // пользователь потеряет сессию из-за чужой аварии.
      if (error.status >= 500 || error.isNetworkError) throw error

      clearTokens()
      onFailure?.({ code: error.code, message: error.message })
    }
    throw error
  }
}

/**
 * Вернуть заведомо свежий access-токен.
 * Параллельные вызовы получают один и тот же промис.
 */
export function refreshAccessToken(): Promise<string> {
  if (inFlight) return inFlight

  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    // Нечем обновляться — это не сбой сети, а обычный гость.
    const failure = new ApiError(401, 'UNAUTHORIZED', 'Сессия не найдена')
    return Promise.reject(failure)
  }

  inFlight = performRefresh(refreshToken).finally(() => {
    inFlight = null
  })

  return inFlight
}

/** Идёт ли обновление прямо сейчас — нужно, чтобы не плодить лишние заходы. */
export function isRefreshing(): boolean {
  return inFlight !== null
}

/**
 * «Холодный» старт: восстановить сессию по сохранённому refresh-токену.
 * Возвращает true, если access получен.
 */
export async function bootstrapTokens(): Promise<boolean> {
  if (!getRefreshToken()) return false
  if (!isAccessTokenExpired()) return true
  try {
    await refreshAccessToken()
    return true
  } catch {
    // Причину уже разобрал performRefresh; здесь просто «сессии нет».
    return false
  }
}
