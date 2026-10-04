/**
 * Форма записи словаря.
 *
 * Строка — обычный текст. Объект — текст, зависящий от числа: русскому нужны
 * три формы («1 сброс», «2 сброса», «5 сбросов»), английскому две. Ровно
 * поэтому формы не перечисляются жёстко, а берутся из категорий CLDR: их
 * набор у каждого языка свой, и `Intl.PluralRules` выбирает нужную сам.
 */

/**
 * Категории множественного числа. `other` обязательна: это единственная форма,
 * которая есть у любого языка, и именно она страхует пропуск остальных.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string
}

export type Message = string | PluralForms

/** Подстановки в тексте: `{count}`, `{total}`, `{language}`. */
export type MessageParams = Record<string, string | number>
