/**
 * Нижний слой запросов: базовый адрес, разбор конверта ошибки, класс ApiError.
 *
 * Вынесен отдельно от `client.ts` намеренно. `client.ts` при 401 обращается к
 * `auth/refresh.ts`, а тому самому нужно сходить в сеть. Если бы оба ходили
 * через `apiFetch`, получился бы цикл импорта и, что хуже, рекурсия:
 * неудачный refresh снова попал бы в обработчик 401 и породил второй refresh —
 * то есть ровно тот повтор токена, которого мы избегаем.
 */

import { acceptLanguageHeader } from '@/lib/i18n'
import { getPriorityPass } from './priority-pass'

/** Базовый URL из окружения. В деве — localhost:3000, в бою — относительный /api/v1. */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1'

/**
 * Корень API без версии — для health-маршрутов.
 * Сервер исключил `/health/*` из глобального префикса и версионирования,
 * поэтому из `/api/v1` нужно срезать всё, а не только версию.
 */
export const API_ORIGIN: string = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '')

/** Конверт ошибки сервера: `{ statusCode, code, message, details? }`. */
export type ApiErrorEnvelope = {
  statusCode: number
  code: string
  message: string
  details?: unknown
}

/**
 * Ошибка API. Ветвиться в UI следует ТОЛЬКО по `code`: тексты сервера
 * меняются и локализуются, коды — часть контракта.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Ошибки валидации ValidationPipe приходят массивом строк в `details`. */
  get validationMessages(): string[] {
    return Array.isArray(this.details)
      ? this.details.filter((d): d is string => typeof d === 'string')
      : []
  }

  /** Сеть/CORS/оффлайн — ответа не было вовсе. */
  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR'
  }
}

export type HttpRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /**
   * Тело запроса. Сервер валидирует с `forbidNonWhitelisted`: любое лишнее
   * поле даёт 400, поэтому объекты собираются точно по контракту, без спреда
   * состояния формы целиком.
   */
  body?: unknown
  /** Access-токен; подставляется вызывающим слоем, а не читается отсюда. */
  token?: string | null
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Абсолютный путь мимо базы с версией (для `/health/*`). */
  absolute?: boolean
}

function buildUrl(path: string, absolute: boolean): string {
  if (/^https?:\/\//.test(path)) return path
  const base = absolute ? API_ORIGIN : API_BASE_URL
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

/**
 * Один сетевой заход без какой-либо логики авторизации.
 * Любой не-2xx превращается в `ApiError` — молчаливых 4xx быть не должно.
 */
export async function httpRequest<T>(
  path: string,
  options: HttpRequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, token, headers, signal, absolute = false } = options

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    // Язык интерфейса едет с КАЖДЫМ запросом, включая анонимные: письмо
    // о подтверждении почты уходит до того, как появится сессия, и других
    // способов узнать язык у сервера нет. Заголовок разрешён в CORS
    // (`main.ts:129`), поэтому предварительный запрос он не ломает.
    //
    // Стоит ДО `...headers`: точечный заголовок вызывающего должен побеждать,
    // а не наоборот.
    'Accept-Language': acceptLanguageHeader(),
    ...headers,
  }
  // Место в очереди при перегрузке — см. priority-pass.ts.
  const pass = getPriorityPass()
  if (pass) requestHeaders['X-Priority-Pass'] = pass
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  if (token) requestHeaders.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(buildUrl(path, absolute), {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    // Прерывание запроса — не ошибка сети, его ждут выше как AbortError.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'NETWORK_ERROR', 'Не удалось связаться с сервером', cause)
  }

  // 204 и пустое тело: JSON парсить нечего.
  const raw = await response.text()
  let payload: unknown = null
  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as Partial<ApiErrorEnvelope>
    throw new ApiError(
      envelope.statusCode ?? response.status,
      // Код обязателен для ветвления. Если сервер его не дал (прокси, 502
      // от nginx), подставляем синтетический, чтобы UI не разбирал текст.
      envelope.code ?? (response.status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN_ERROR'),
      envelope.message ?? `Ошибка ${response.status}`,
      envelope.details
    )
  }

  return payload as T
}
