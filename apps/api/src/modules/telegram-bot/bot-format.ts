import { LicenseStatus } from '@prisma/client';

import { containsLicenseKey, maskLicenseKey } from '@common/utils/license-key';

import { t, type Locale } from './i18n';

/**
 * Форматирование значений для экранов бота.
 *
 * Всё, что превращает данные в текст, живёт здесь, а не в экранах: иначе
 * дата истечения на карточке и та же дата в списке начинают отличаться
 * форматом, а маска ключа появляется в трёх видах — и один из них однажды
 * оказывается не маской.
 *
 * Маска ключа НЕ переопределяется: берётся `maskLicenseKey` из
 * `@common/utils/license-key`. Своя копия здесь разошлась бы с цензором
 * логов, и разошлась бы молча.
 */

/** Часовой пояс показа. Решение A3: поля таймзоны у пользователя нет, считаем всех по Москве. */
const DISPLAY_TIME_ZONE = 'Europe/Moscow';

/** Соответствие локали боту и локали Intl. */
const INTL_LOCALE: Record<Locale, string> = { ru: 'ru-RU', en: 'en-GB' };

const DATE_FORMATTERS: Record<Locale, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat('ru-RU', {
    timeZone: DISPLAY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }),
};

const TIME_FORMATTERS: Record<Locale, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat('ru-RU', {
    timeZone: DISPLAY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
};

/** Иконка статуса лицензии (§4.4 E-03 ТЗ). */
export function statusIcon(status: LicenseStatus): string {
  switch (status) {
    case LicenseStatus.ACTIVE:
      return '🟢';
    case LicenseStatus.PENDING:
      return '⚪️';
    case LicenseStatus.EXPIRED:
      return '🔴';
    case LicenseStatus.BLOCKED:
      return '⛔️';
    case LicenseStatus.REVOKED:
      return '⚫️';
    default:
      return '⚪️';
  }
}

/** Название статуса словами. */
export function statusText(locale: Locale, status: LicenseStatus): string {
  switch (status) {
    case LicenseStatus.ACTIVE:
      return t(locale, 'fmt.status.ACTIVE');
    case LicenseStatus.PENDING:
      return t(locale, 'fmt.status.PENDING');
    case LicenseStatus.EXPIRED:
      return t(locale, 'fmt.status.EXPIRED');
    case LicenseStatus.BLOCKED:
      return t(locale, 'fmt.status.BLOCKED');
    case LicenseStatus.REVOKED:
      return t(locale, 'fmt.status.REVOKED');
    default:
      return t(locale, 'fmt.none');
  }
}

/**
 * Строка срока для списка: «до 12.09.2026», «бессрочная», «истекла …».
 *
 * Статус важнее даты: у заблокированной лицензии срок может быть в будущем,
 * и показывать «до 12.09.2026» рядом с ⛔️ значит обещать работу продукта,
 * которой не будет.
 */
export function expiryLine(
  locale: Locale,
  license: { status: LicenseStatus; expiresAt: Date | null },
): string {
  switch (license.status) {
    case LicenseStatus.BLOCKED:
      return t(locale, 'fmt.expiry.blocked');
    case LicenseStatus.REVOKED:
      return t(locale, 'fmt.expiry.revoked');
    case LicenseStatus.PENDING:
      return t(locale, 'fmt.expiry.not_activated');
    case LicenseStatus.EXPIRED:
      return t(locale, 'fmt.expiry.expired', { date: formatDate(locale, license.expiresAt) });
    case LicenseStatus.ACTIVE:
    default:
      return license.expiresAt
        ? t(locale, 'fmt.expiry.until', { date: formatDate(locale, license.expiresAt) })
        : t(locale, 'fmt.expiry.lifetime');
  }
}

/** Значение поля «Действует до» на карточке. */
export function validUntil(
  locale: Locale,
  license: { status: LicenseStatus; expiresAt: Date | null },
): string {
  if (license.status === LicenseStatus.PENDING) return t(locale, 'fmt.expiry.not_activated');
  if (!license.expiresAt) return t(locale, 'fmt.expiry.lifetime');
  return formatDateTime(locale, license.expiresAt);
}

/** Дата без времени, по Москве. */
export function formatDate(locale: Locale, date: Date | null | undefined): string {
  if (!date) return t(locale, 'fmt.none');
  return DATE_FORMATTERS[locale].format(date);
}

/**
 * Дата со временем и подписью пояса.
 *
 * Пояс подписывается всегда. «Следующий сброс будет доступен 11.08.2026
 * 09:00» без пояса — это обещание, которое для человека в Калининграде
 * не выполнится, и он придёт в поддержку раньше срока.
 */
export function formatDateTime(locale: Locale, date: Date | null | undefined): string {
  if (!date) return t(locale, 'fmt.none');
  return `${DATE_FORMATTERS[locale].format(date)} ${TIME_FORMATTERS[locale].format(date)} ${t(locale, 'fmt.tz')}`;
}

/** Срок тарифа: «30 дней» или «бессрочно». */
export function durationText(locale: Locale, durationDays: number | null | undefined): string {
  if (durationDays === null || durationDays === undefined) return t(locale, 'fmt.duration.lifetime');
  return t(locale, 'fmt.duration.days', {
    days: durationDays,
    unit: pluralUnit(locale, durationDays, 'day'),
  });
}

/** «24 часа» / «24 hours» с правильной формой числа. */
export function hoursText(locale: Locale, hours: number): string {
  return `${hours} ${pluralUnit(locale, hours, 'hour')}`;
}

/**
 * Форма существительного по числу.
 *
 * Через `Intl.PluralRules`, а не через «если оканчивается на 1»: своя
 * таблица правил однажды разойдётся с языком, а этот класс уже знает
 * и про 11-14, и про то, что в английском форм две.
 */
function pluralUnit(locale: Locale, value: number, base: 'day' | 'hour'): string {
  const category = new Intl.PluralRules(INTL_LOCALE[locale]).select(Math.abs(value));

  if (base === 'day') {
    if (category === 'one') return t(locale, 'fmt.plural.day_one');
    if (category === 'few') return t(locale, 'fmt.plural.day_few');
    return t(locale, 'fmt.plural.day_many');
  }

  if (category === 'one') return t(locale, 'fmt.plural.hour_one');
  if (category === 'few') return t(locale, 'fmt.plural.hour_few');
  return t(locale, 'fmt.plural.hour_many');
}

/**
 * Маска почты: `g***j@gmail.com`.
 *
 * Домен остаётся целиком намеренно: он подсказывает владельцу, ЧТО
 * за адрес привязан («а, это старый gmail»), и при этом не позволяет
 * написать на него тому, кто заглянул через плечо.
 *
 * Локальная часть короче трёх символов маскируется целиком: у двухбуквенной
 * первая и последняя буквы — это весь адрес.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—';

  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';

  const local = email.slice(0, at);
  const domain = email.slice(at);

  if (local.length < 3) return `***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

/**
 * Похож ли ввод на ключ лицензии.
 *
 * Нужна ровно в одном месте — перед отправкой кода в Digiseller (§5.4).
 * Без проверки ключ лицензии, введённый вместо кода покупки, уезжает
 * в чужой сервис как «неудачная попытка активации» и оседает в ИХ логах,
 * откуда отозвать его нечем.
 *
 * Реализация не своя: `containsLicenseKey` из `@common/utils/license-key`
 * ровно та же, что стоит в цензоре логов. Две разные регулярки под одну
 * задачу означали бы, что цензор ловит то, чего не ловит эта проверка.
 */
export function looksLikeLicenseKey(input: string): boolean {
  return containsLicenseKey(input.trim().toUpperCase());
}

/**
 * Денежное значение из Prisma.Decimal в строку.
 *
 * Принимает `unknown`, потому что Decimal — класс библиотеки, и тянуть его
 * тип в модуль бота незачем: нам нужна строка, а не арифметика. Хвост
 * «.00» убирается — «1490 ₽» читается, «1490.00 ₽» выглядит выгрузкой.
 */
export function formatMoney(value: unknown): string {
  if (value === null || value === undefined) return '';

  const asText = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(asText)) return asText;

  return asText.includes('.') ? asText.replace(/\.?0+$/, '') : asText;
}

/**
 * Строка лицензии в том виде, в каком её отдают сервисы.
 *
 * Поля `key` и `maskedKey` ОБА необязательны намеренно: до правки C1
 * (пакет 5) `LicensesService.list` отдаёт полный `key`, после — только
 * `maskedKey`. Экраны бота обязаны рисовать маску в обоих случаях, поэтому
 * тип описывает оба состояния, а `toLicenseView` сводит их к одному.
 */
export interface LicenseRowLike {
  id: string;
  status: LicenseStatus;
  expiresAt: Date | null;
  key?: string | null;
  maskedKey?: string | null;
  product?: { name: string } | null;
  plan?: { name: string; durationDays?: number | null } | null;
}

/** Лицензия в том виде, в каком её рисуют экраны. Полного ключа тут нет и быть не может. */
export interface LicenseView {
  id: string;
  status: LicenseStatus;
  expiresAt: Date | null;
  maskedKey: string;
  productName: string;
  planName: string;
  durationDays: number | null;
}

/**
 * Приведение строки лицензии к виду экрана.
 *
 * Маска считается ЗДЕСЬ, даже если сервис уже прислал `maskedKey`: бот —
 * последняя инстанция перед чужим экраном, и гарантия «полный ключ не
 * печатается по инициативе бота» (решение 0.3 ТЗ) не должна зависеть от
 * того, применил ли вызывающий свою маску. Стоит это одну строку.
 */
export function toLicenseView(row: LicenseRowLike): LicenseView {
  return {
    id: row.id,
    status: row.status,
    expiresAt: row.expiresAt,
    maskedKey: row.maskedKey ?? maskLicenseKey(row.key),
    productName: row.product?.name ?? '—',
    planName: row.plan?.name ?? '—',
    durationDays: row.plan?.durationDays ?? null,
  };
}
