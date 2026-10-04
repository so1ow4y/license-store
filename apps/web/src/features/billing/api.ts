import { apiFetch } from '@/lib/api/client'

/**
 * Активация кода покупки Digiseller — единственный денежный путь платформы.
 *
 * Контракт снят с сервера, а не с плана:
 * - маршрут `POST /billing/digiseller/redeem` (`billing.controller.ts:25`);
 * - тело строго `{ code }` (`dto/billing.dto.ts`), лишнее поле даст 400
 *   из-за `forbidNonWhitelisted`;
 * - ответ — не «успех/ошибка», а два разных успеха: `ISSUED` и `ALREADY_YOURS`
 *   (`digiseller.service.ts:235,510`).
 */

/** Ровно 16 символов — так документирует площадка, так проверяют DTO и сервис. */
export const DIGISELLER_CODE_LENGTH = 16

/** Тот же шаблон, что и на сервере (`digiseller.service.ts:62`). */
export const DIGISELLER_CODE_RE = /^[A-Za-z0-9]{16}$/

/**
 * Убирает разделители, которыми обрастает код при копировании из письма
 * площадки: пробелы, переносы строк, дефисы, неразрывные пробелы.
 *
 * Регистр НЕ трогаем. Сервер ищет код точным сравнением по `unique_code`
 * (`findUnique({ where: { uniqueCode: code } })`), поэтому приведение к
 * верхнему регистру сломало бы коды со строчными буквами — а шаблон
 * `[A-Za-z0-9]` их прямо допускает.
 *
 * Длину здесь тоже НЕ режем: молча выбросить лишние символы значит превратить
 * ошибку копирования в валидный с виду, но чужой код. Пусть длина не сойдётся
 * и человек это увидит.
 */
export function normalizeDigisellerCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '')
}

/** Лицензия выдана прямо сейчас: есть и ключ, и номер заказа для поддержки. */
export type DigisellerIssued = {
  status: 'ISSUED'
  orderId: string
  orderNumber: string
  licenseId: string
  licenseKey: string
}

/**
 * Код уже погашен этим же пользователем. Сервер отвечает так намеренно —
 * повторная отправка формы обязана дать тот же результат, а не ошибку.
 * Ключа лицензии здесь НЕТ, только `orderId`: показывать нечего, нужно вести
 * человека в список лицензий.
 */
export type DigisellerAlreadyYours = {
  status: 'ALREADY_YOURS'
  orderId: string | null
}

export type DigisellerRedeemResult = DigisellerIssued | DigisellerAlreadyYours

export function redeemDigisellerCode(
  code: string,
  signal?: AbortSignal
): Promise<DigisellerRedeemResult> {
  return apiFetch<DigisellerRedeemResult>('/billing/digiseller/redeem', {
    method: 'POST',
    // Ровно одно поле: сервер валидирует с forbidNonWhitelisted.
    body: { code },
    signal,
  })
}
