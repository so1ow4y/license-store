import { apiFetch } from '@/lib/api/client'

/**
 * Активация регистрационного ключа на УЖЕ существующем аккаунте.
 *
 * Контракт снят с сервера:
 * - маршрут `POST /auth/redeem-key` (`auth.controller.ts:140`);
 * - тело `{ code }` — именно `code`, а не `key` (`RedeemKeyDto`,
 *   `auth.dto.ts:188`). План ошибочно называет поле `key`; сервер с таким
 *   телом ответит 400 из-за `forbidNonWhitelisted`;
 * - ответ `{ licenseKey: string | null }` (`registration-key.service.ts:292`).
 */

/**
 * Алфавит кода (`registration-key.service.ts:35`). Из него намеренно убраны
 * похожие друг на друга символы: нет B, I, L, O, S и цифр 0, 1, 5.
 * Именно поэтому «исправить» опечатку автоматически нельзя — у O и 0 нет
 * допустимой замены, обе выброшены. Остаётся сказать человеку, что не так.
 */
export const KEY_ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ2346789'

/** Код вида ACDE-FGHJ-KMNP-QRTU: 4 группы по 4 символа. */
export const KEY_GROUPS = 4
export const KEY_GROUP_LENGTH = 4

const KEY_SHAPE_RE = new RegExp(
  `^[${KEY_ALPHABET}]{${KEY_GROUP_LENGTH}}(-[${KEY_ALPHABET}]{${KEY_GROUP_LENGTH}}){${KEY_GROUPS - 1}}$`
)

/**
 * Приводит ввод к виду ACDE-FGHJ-KMNP-QRTU.
 *
 * Зачем это здесь: сервер нормализует только `trim().toUpperCase()` и удаление
 * ПРОБЕЛОВ (`registration-key.service.ts:328`), а дефисы оставляет как есть и
 * ищет код точным сравнением. Значит ключ, набранный без дефисов, сервер не
 * найдёт и ответит «Ключ не найден» — человек решит, что ему продали пустышку.
 * Расстановка дефисов на клиенте закрывает этот разрыв.
 */
export function formatRegistrationKey(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const groups: string[] = []
  for (let i = 0; i < clean.length; i += KEY_GROUP_LENGTH) {
    groups.push(clean.slice(i, i + KEY_GROUP_LENGTH))
  }
  return groups.join('-')
}

/** Символы, которых в ключах не бывает. Пустой массив — вопросов нет. */
export function unexpectedKeyChars(formatted: string): string[] {
  const wrong = formatted
    .replace(/-/g, '')
    .split('')
    .filter((char) => !KEY_ALPHABET.includes(char))
  return [...new Set(wrong)]
}

/**
 * Похож ли ввод на выпускаемый нами ключ.
 *
 * Используется ТОЛЬКО как подсказка, но не как запрет отправки: единственные
 * ограничения сервера — непустая строка не длиннее 64 символов. Заблокировать
 * отправку по своей догадке значит запереть человека с настоящим ключом
 * нестандартного вида, а это дороже одного лишнего запроса.
 */
export function looksLikeRegistrationKey(formatted: string): boolean {
  return KEY_SHAPE_RE.test(formatted)
}

/** Максимальная длина по DTO (`@MaxLength(64)`). */
export const KEY_MAX_LENGTH = 64

/**
 * Ответ сервера. `licenseKey` объявлен как `string | null`, хотя на практике
 * при успехе он всегда есть: случай «ключ без лицензии» сервер отсекает
 * раньше ошибкой KEY_WITHOUT_LICENSE. UI обязан пережить и null.
 */
export type RedeemKeyResult = { licenseKey: string | null }

export function redeemRegistrationKey(
  code: string,
  signal?: AbortSignal
): Promise<RedeemKeyResult> {
  return apiFetch<RedeemKeyResult>('/auth/redeem-key', {
    method: 'POST',
    // Поле называется code. Не key — проверено по RedeemKeyDto.
    body: { code },
    signal,
  })
}
