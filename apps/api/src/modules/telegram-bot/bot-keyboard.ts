import { Logger } from '@nestjs/common';

/**
 * Инлайн-клавиатуры бота.
 *
 * Отдельный файл, а не сборка объекта по местам, ради двух ограничений
 * из §4.1 ТЗ, которые иначе соблюдаются «по памяти» и разъезжаются на третьем
 * экране: не больше двух кнопок в ряд и не больше шести кнопок на экран.
 * На узком телефоне длинная подпись переносится и ломает вёрстку, а экран
 * из десяти кнопок перестаёт быть выбором и становится списком.
 *
 * Типы здесь же, потому что их импортирует пакет 1 (`telegram.api.ts`):
 * клавиатура — часть исходящего сообщения, а не часть транспорта.
 */
const logger = new Logger('BotKeyboard');

/** Кнопок в ряд. Больше двух не помещается в подпись на узком экране. */
const MAX_PER_ROW = 2;
/** Кнопок на экран по умолчанию (§4.1 ТЗ). */
const MAX_BUTTONS_DEFAULT = 6;

/**
 * Потолок длины `callback_data` — ограничение Bot API, 64 БАЙТА.
 *
 * Превышение Telegram отвергает при ОТПРАВКЕ сообщения целиком: не приходит
 * весь экран, а не одна кнопка. Поэтому проверка стоит здесь, на сборке,
 * а не где-то у отправки — тут ещё видно, какая именно кнопка виновата.
 */
const MAX_CALLBACK_BYTES = 64;

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

/** Кнопка в терминах экранов: `cb` — данные обратного вызова, `url` — внешняя ссылка. */
export interface KbButton {
  text: string;
  cb?: string;
  url?: string;
}

export interface KbOptions {
  /**
   * Свой потолок кнопок. Поднимается ТОЛЬКО там, где часть кнопок —
   * навигация, а не действия: список лицензий это строки данных плюс
   * «назад/далее/меню», и обрезать их до шести значит отрезать выход
   * с экрана.
   */
  max?: number;
}

/**
 * Сборка клавиатуры с соблюдением ограничений.
 *
 * Ряд длиннее двух кнопок РАЗБИВАЕТСЯ, а не обрезается: потеря кнопки — это
 * потеря функции, а перенос — только вёрстка. Превышение общего потолка,
 * наоборот, обрезает: это признак ошибки в экране, и лучше увидеть её как
 * недостающую кнопку с `warn` в логе, чем как отвергнутое Telegram сообщение.
 */
export function kb(rows: KbButton[][], opts?: KbOptions): InlineKeyboard {
  const max = opts?.max ?? MAX_BUTTONS_DEFAULT;
  const result: InlineKeyboardButton[][] = [];
  let count = 0;

  for (const row of rows) {
    const usable = row.filter((button) => isUsable(button));

    for (let i = 0; i < usable.length; i += MAX_PER_ROW) {
      const chunk = usable.slice(i, i + MAX_PER_ROW);
      if (chunk.length === 0) continue;

      if (count + chunk.length > max) {
        logger.warn(`клавиатура превысила ${max} кнопок, лишние отброшены`);
        return { inline_keyboard: result };
      }

      result.push(chunk.map(toTelegram));
      count += chunk.length;
    }
  }

  return { inline_keyboard: result };
}

/**
 * Ряд пагинации.
 *
 * Номер страницы в подписи не показывается: он занимает третью кнопку в ряду
 * и при этом ничего не делает. Страницы нумеруются с нуля — так же, как
 * приходят в `callback_data` вида `page:<screen>:<n>`.
 */
export function paginate(page: number, pages: number, prefix: string): KbButton[] {
  return paginateLabeled(page, pages, prefix, { prev: '‹', next: '›' });
}

/** Ряд пагинации с локализованными подписями. */
export function paginateLabeled(
  page: number,
  pages: number,
  prefix: string,
  labels: { prev: string; next: string },
): KbButton[] {
  if (pages <= 1) return [];

  const row: KbButton[] = [];
  if (page > 0) row.push({ text: labels.prev, cb: `cb:page:${prefix}:${page - 1}` });
  if (page < pages - 1) row.push({ text: labels.next, cb: `cb:page:${prefix}:${page + 1}` });

  return row;
}

function isUsable(button: KbButton): boolean {
  if (!button.cb && !button.url) {
    logger.warn(`кнопка «${button.text}» без cb и url — отброшена`);
    return false;
  }

  if (button.cb && Buffer.byteLength(button.cb, 'utf8') > MAX_CALLBACK_BYTES) {
    // Отбрасываем именно кнопку: сообщение с такой кнопкой Telegram
    // не примет целиком, и пользователь не увидит вообще ничего.
    logger.warn(`callback_data длиннее ${MAX_CALLBACK_BYTES} байт: ${button.cb.slice(0, 24)}…`);
    return false;
  }

  return true;
}

function toTelegram(button: KbButton): InlineKeyboardButton {
  return button.url ? { text: button.text, url: button.url } : { text: button.text, callback_data: button.cb };
}
