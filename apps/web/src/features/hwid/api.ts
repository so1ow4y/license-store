/**
 * Привязка лицензии к устройству (ТЗ п.7, план п. 3.11–3.12).
 *
 * Смысл, который обязан быть виден в UI: лицензия привязывается к ПЕРВОМУ
 * устройству, с которого запустили лаунчер. С другого железа сервер отвечает
 * 403 HWID_MISMATCH, и единственный самостоятельный выход — сброс привязки.
 * Сброс жёстко ограничен: не больше `maxResets` за всё время (по умолчанию 3)
 * и не чаще раза в 24 часа. Поэтому экран обязан показывать остаток и таймер —
 * иначе неактивная кнопка выглядит сломанной.
 *
 * Пути и поля сверены по `apps/api/src/modules/hwid/hwid.controller.ts`
 * и `hwid.service.ts` (`statusFor`, `resetBySelf`, `history`).
 */
import { queryOptions } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/lib/api/client'
import { PERMISSIONS } from '@/lib/auth/permissions'

/**
 * Право на самостоятельный сброс (`@RequirePermissions('hwid.reset.self')`,
 * hwid.controller.ts:58). Есть у обычного пользователя по сиду, но не у всех
 * ролей — без него кнопка обречена на 403, поэтому её не рисуем вовсе.
 */
export const HWID_RESET_PERMISSION = PERMISSIONS.HWID_RESET_SELF

/**
 * Право на чтение истории отдельным маршрутом (hwid.controller.ts:128).
 * Расхождение с ТЗ описано в плане: маршрут закрыт правом, а не владельцем.
 * Владельцу последние 20 записей всё равно приходят внутри карточки лицензии.
 */
export const HWID_HISTORY_PERMISSION = PERMISSIONS.HWID_HISTORY_READ

/**
 * Состояние привязки. Ровно то, что отдаёт `statusFor` — ни хеша, ни Disk ID
 * сервер не возвращает принципиально, и запрашивать их неоткуда.
 */
export type HwidStatus = {
  bound: boolean
  /** Когда устройство увидели впервые. */
  boundAt: string | null
  /** Последняя проверка лицензии этим устройством. */
  lastSeenAt: string | null
  resetsUsed: number
  /** Остаток от лимита продукта; 0 означает «только через поддержку». */
  resetsLeft: number
  lastResetAt: string | null
  /** NULL, если кулдаун уже истёк — сервер отдаёт только будущую дату. */
  nextResetAvailableAt: string | null
}

export const HWID_EVENT_REASONS = [
  'FIRST_BIND',
  'USER_RESET',
  'ADMIN_RESET',
  'ADMIN_MANUAL_SET',
  'SYSTEM_REVOKE',
] as const

export type HwidEventReason = (typeof HWID_EVENT_REASONS)[number]

/** ActorType из схемы Prisma. */
export type HwidActorType = 'USER' | 'ADMIN' | 'SYSTEM' | 'API_KEY'

/**
 * Запись истории привязок.
 *
 * Хешей здесь нет намеренно: маршрут истории их не отдаёт даже администратору.
 * Внутри карточки лицензии (`GET /licenses/:id`) в записях есть поля
 * `oldHwidHash`/`newHwidHash`, но показывать их запрещено ТЗ, поэтому в тип
 * они не попадают — так их нельзя вывести случайно.
 */
export type HwidHistoryEntry = {
  id: string
  reason: HwidEventReason
  actorId: string | null
  actorType: HwidActorType
  /** Подпись актора на момент действия: `launcher`, `admin:<id>`, `user:<id>`. */
  actorLabel: string | null
  /** Заполняется только при привязке из лаунчера — у остальных NULL. */
  ip: string | null
  comment: string | null
  createdAt: string
}

export const hwidKeys = {
  all: ['hwid'] as const,
  status: (licenseId: string) => ['hwid', 'status', licenseId] as const,
  history: (licenseId: string) => ['hwid', 'history', licenseId] as const,
}

/**
 * `GET /licenses/:licenseId/hwid`.
 *
 * Отдельный запрос, а не поле карточки: после сброса перечитать нужно именно
 * его, и счётчик обязан обновиться, даже если карточка лежит в кеше.
 */
export function hwidStatusQueryOptions(licenseId: string) {
  return queryOptions({
    queryKey: hwidKeys.status(licenseId),
    queryFn: ({ signal }) =>
      apiFetch<HwidStatus>(
        `/licenses/${encodeURIComponent(licenseId)}/hwid`,
        { signal }
      ),
    // Кулдаун истекает по часам, а не по секундам: держать данные свежими
    // поминутно достаточно, таймер тикает на клиенте.
    staleTime: 30_000,
  })
}

/**
 * `GET /licenses/:licenseId/hwid/history` — до 100 записей.
 *
 * Вызывать только при наличии права `hwid.history.read`: иначе гарантированный
 * 403 на каждом открытии вкладки.
 */
export function hwidHistoryQueryOptions(licenseId: string, enabled: boolean) {
  return queryOptions({
    queryKey: hwidKeys.history(licenseId),
    queryFn: ({ signal }) =>
      apiFetch<HwidHistoryEntry[]>(
        `/licenses/${encodeURIComponent(licenseId)}/hwid/history`,
        { signal }
      ),
    enabled,
  })
}

/**
 * `POST /licenses/:licenseId/hwid/reset` — самостоятельный сброс.
 *
 * Тело НЕ отправляем: маршрут его не принимает, а валидация сервера с
 * `forbidNonWhitelisted` ответила бы 400 на любое лишнее поле.
 *
 * Ответ — обновлённая лицензия; она нам не нужна, состояние перечитываем
 * запросом статуса, чтобы не собирать вид из двух источников.
 */
export async function resetHwid(licenseId: string): Promise<void> {
  await apiFetch<unknown>(
    `/licenses/${encodeURIComponent(licenseId)}/hwid/reset`,
    { method: 'POST' }
  )
}

/**
 * Дата следующего разрешённого сброса из ошибки `HWID_RESET_COOLDOWN`.
 *
 * Сервер кладёт её отдельным полем `nextAllowedAt`, а фильтр исключений
 * заворачивает «лишние» поля в `details` (`all-exceptions.filter.ts`). Разбор
 * даты из текста сообщения сломался бы при первой правке формулировки.
 */
export function cooldownEndsAt(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.code !== 'HWID_RESET_COOLDOWN') return null

  const details = error.details
  if (typeof details !== 'object' || details === null) return null

  const value = (details as { nextAllowedAt?: unknown }).nextAllowedAt
  return typeof value === 'string' ? value : null
}
