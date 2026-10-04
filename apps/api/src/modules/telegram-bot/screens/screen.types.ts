import { HttpException } from '@nestjs/common';

import type { BotActor } from '../bot-actor.service';
import type { InlineKeyboard } from '../bot-keyboard';
import type { Locale } from '../i18n';

/**
 * Общий контракт экранов.
 *
 * Экран НЕ отправляет сообщение сам — он возвращает текст и клавиатуру,
 * а доставкой занят маршрутизатор. Причина в §4.1 ТЗ: один экран — одно
 * сообщение, навигация построена на `editMessageText`. Если бы каждый экран
 * отправлял себя сам, выбор «править существующее или слать новое» пришлось
 * бы повторять девять раз, и на девятый он оказался бы другим — а для
 * пользователя это разница между меню и лентой из тридцати сообщений.
 *
 * Исключения, где сообщение всегда новое (показ ключа, ответ поддержки),
 * отправляют его явно и в дополнение к возвращённому экрану.
 */
export interface ScreenView {
  text: string;
  keyboard: InlineKeyboard;
  /**
   * Текст всплывающего ответа на нажатие кнопки.
   *
   * Нужен там, где экран не меняется, а сказать пользователю что-то надо:
   * попытка снять галочку с уведомлений безопасности перерисовывает тот же
   * экран, и без всплывающего ответа нажатие выглядит как «кнопка не
   * работает».
   */
  alert?: string;
}

/** Что известно экрану о том, кому он рисуется. */
export interface ScreenCtx {
  actor: BotActor;
  locale: Locale;
  chatId: bigint;
}

/**
 * Разрешённые значения `callback_data` (§4.4 ТЗ).
 *
 * Собраны в одном месте, чтобы у маршрутизатора и у экранов была одна и та
 * же грамматика. Разъехавшийся здесь префикс даёт кнопку, на которую бот
 * отвечает «действие устарело», — и виноватым выглядит пользователь.
 */
export const CB = {
  root: 'cb:root',
  licenses: 'cb:licenses',
  license: (id: string) => `cb:lic:${id}`,
  hwid: (id: string) => `cb:hwid:${id}`,
  hwidGo: (id: string, nonce: string) => `cb:hwid_go:${id}:${nonce}`,
  key: (id: string) => `cb:key:${id}`,
  keyGo: (id: string, nonce: string) => `cb:key_go:${id}:${nonce}`,
  activate: 'cb:activate',
  actCode: 'cb:act_code',
  actOrder: 'cb:act_order',
  actRegKey: 'cb:act_regkey',
  products: 'cb:products',
  product: (id: string) => `cb:prod:${id}`,
  account: 'cb:account',
  notify: 'cb:notify',
  notifyToggle: (category: string) => `cb:notify_toggle:${category}`,
  lang: 'cb:lang',
  langSet: (locale: Locale) => `cb:lang_set:${locale}`,
  unlink: 'cb:unlink',
  unlinkGo: (nonce: string) => `cb:unlink_go:${nonce}`,
  support: 'cb:support',
  help: 'cb:help',
} as const;

/**
 * Машинный код ошибки из конверта платформы.
 *
 * Сервисы бросают `HttpException` с объектом `{ code, message }`
 * (all-exceptions.filter.ts). Боту нужен именно `code`: `message` написан
 * для кабинета, он длиннее, чем помещается в экран, и локализован только
 * по-русски. Ветвиться по тексту — это ломаться при первой же правке
 * формулировки.
 */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;

  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) return null;

  const code = (response as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Дополнительные поля конверта ошибки (например, `nextAllowedAt` у кулдауна). */
export function apiErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof HttpException)) return {};

  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) return {};

  return response as Record<string, unknown>;
}
