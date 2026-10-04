import { Logger } from '@nestjs/common';

import { escapeHtml } from '../telegram-html';
import { en, type MessageKey } from './en';
import { ru } from './ru';

/**
 * Словари бота и подстановка значений.
 *
 * Здесь же живёт единственное правило, ради которого стоило заводить свой
 * `t()` вместо конкатенации строк по местам: КАЖДОЕ подставляемое значение
 * экранируется. Экраны рисуются с `parse_mode: HTML`, а в подстановки
 * попадают @username, названия продуктов и текст ошибок площадки — то есть
 * строки, которые пишем не мы. Один `<` в названии продукта без экранирования
 * ломает разметку всего сообщения, а Telegram отвечает на это `400` и молчанием
 * в чате: экран просто не приходит, и понять почему по логу нечем.
 *
 * Обратное направление (нужен готовый HTML) делается явно через `raw()`.
 * Умолчание безопасное, отступление от него — заметное в коде.
 */
const logger = new Logger('BotI18n');

export type Locale = 'ru' | 'en';

const DICTIONARIES: Record<Locale, Record<string, string>> = { en, ru };

/**
 * Языки, аудитория которых читает по-русски (§4.2 ТЗ).
 *
 * Украинской и белорусской локалей у нас нет и не планируется, а отправлять
 * этих людей в английский текст было бы хуже, чем в русский.
 */
const RU_LANGUAGE_CODES = new Set(['ru', 'uk', 'be', 'kk']);

/** Метка «это уже готовая разметка, экранировать не надо». */
const RAW_MARKER = Symbol('telegram-raw-html');

export interface RawHtml {
  readonly [RAW_MARKER]: true;
  readonly value: string;
}

/**
 * Пометить строку как готовый HTML.
 *
 * Применяется только к тому, что собрано этим же модулем из уже экранированных
 * кусков: список лицензий, список тарифов, суффикс ближайшего истечения.
 * Передавать сюда пользовательский ввод нельзя ни при каких обстоятельствах —
 * это ровно та дыра, от которой защищает экранирование по умолчанию.
 */
export function raw(value: string): RawHtml {
  return { [RAW_MARKER]: true, value };
}

function isRaw(value: unknown): value is RawHtml {
  return typeof value === 'object' && value !== null && RAW_MARKER in value;
}

export type TemplateVars = Record<string, string | number | RawHtml | null | undefined>;

/**
 * Текст по ключу с подстановкой.
 *
 * Промах по ключу возвращает сам ключ и пишет `error`: пустая строка выглядела
 * бы как «экран без текста», а Telegram на пустой `text` отвечает `400` —
 * то есть отсутствие перевода превратилось бы в молчащего бота вместо
 * заметной строки в чате. Ключ на экране некрасив, но чинится за минуту.
 */
export function t(locale: Locale, key: MessageKey, vars?: TemplateVars): string {
  const dictionary = DICTIONARIES[locale];
  const fallback = DICTIONARIES.en;
  const template = dictionary[key] ?? fallback[key];

  if (template === undefined) {
    logger.error(`нет строки ${key} ни в ${locale}, ни в en`);
    return key;
  }

  return substitute(template, vars);
}

/** Подстановка `{{name}}`. Вынесена отдельно: её же зовёт рендер собранных строк. */
export function substitute(template: string, vars?: TemplateVars): string {
  if (!vars) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    if (!(name in vars)) {
      // Не подставленный плейсхолдер оставляем как есть: так дефект видно
      // в чате и в скриншоте от пользователя, а не только в логе.
      logger.warn(`не передано значение ${name} для шаблона`);
      return match;
    }

    const value = vars[name];
    if (value === null || value === undefined) return '';
    if (isRaw(value)) return value.value;

    return escapeHtml(value);
  });
}

/**
 * Локаль по коду языка Telegram или по сохранённому значению.
 *
 * `ru-RU`, `RU`, `ru` — одно и то же; всё, что не в списке «читают
 * по-русски», уходит в английский.
 */
export function pickLocale(rawValue: string | null | undefined): Locale {
  if (!rawValue) return 'en';

  const base = rawValue.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return RU_LANGUAGE_CODES.has(base) ? 'ru' : 'en';
}

export { en, ru };
export type { MessageKey };
