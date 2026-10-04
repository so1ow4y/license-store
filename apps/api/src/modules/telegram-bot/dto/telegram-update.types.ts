/**
 * Типы апдейтов Telegram и их ручной разбор.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ НИ ОДНОГО КЛАССА DTO. Глобальный ValidationPipe поднят
 * с forbidNonWhitelisted: true (main.ts:147-162) — любое поле сверх
 * объявленных в классе даёт 400. Тело апдейта Telegram содержит десятки
 * полей, которые нам не нужны и состав которых меняется без нашего ведома:
 * объявить класс значит подписаться отвергать апдейты после каждого
 * обновления Bot API. Поэтому контроллер принимает тело как unknown
 * (нативные типы ValidationPipe пропускает), а проверка живёт здесь.
 *
 * ИМЕНА ПОЛЕЙ — как на проводе (snake_case), а не camelCase кодовой базы.
 * Это DTO чужого API: переименование завело бы второй словарь, который
 * при каждой сверке с документацией Telegram надо держать в голове рядом
 * с первым. Внутренние типы проекта переименования не касаются.
 */

/** Тип чата. private — единственный, в котором бот работает (§7 ТЗ). */
export type TgChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TgUser {
  /**
   * bigint, а не number. Telegram уже выдаёт идентификаторы за пределами
   * 2^31, а обещание «влезет в 52 бита» — обещание, а не гарантия.
   * Молчаливая потеря точности здесь означала бы привязку к чужому
   * аккаунту, и обнаружилась бы она не скоро.
   */
  id: bigint;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: bigint;
  type: TgChatType;
  username?: string;
  title?: string;
}

export interface TgMessage {
  /** Номер сообщения В ПРЕДЕЛАХ чата — небольшое число, bigint не нужен. */
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  /** Нужен поддержке: ответ администратора в админ-чате находит тред по нему. */
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  /** Строка, а не число — так объявлено в Bot API. В bigint НЕ разбирается. */
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

export interface TgChatMember {
  user: TgUser;
  status: string;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
}

/**
 * Потолок длины текста. Bot API не пришлёт больше 4096 символов, но
 * доверять этому нельзя: тело запроса приходит от того, кто представился
 * Telegram, а bodyLimit Fastify — 1 МиБ.
 */
const MAX_TEXT_LENGTH = 4096;

/**
 * Порог, за которым целое число не переживает JSON.parse.
 *
 * 2^53 = 9007199254740992 — шестнадцать знаков. Пятнадцатизначное целое
 * всегда меньше и разбирается точно; шестнадцатизначное уже может быть
 * больше, и после JSON.parse отличить его от соседнего нельзя.
 */
const LOSSY_INTEGER_DIGITS = 16;

/**
 * Заключает в кавычки целые литералы, которые не переживут JSON.parse.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. JSON.parse превращает числа в double ДО того, как
 * их увидит reviver, — то есть «разобрать в bigint через reviver» невозможно
 * в принципе — точность уже потеряна. Единственный способ сохранить её —
 * править ТЕКСТ до разбора.
 *
 * Почему сканер, а не регулярка по имени поля: `"id":123` встречается
 * и внутри текста сообщения, который пишет пользователь. Замена регуляркой
 * молча искажала бы чужой текст (в поддержке это выглядело бы как порча
 * данных без источника). Сканер знает, где строковый литерал, и внутрь
 * него не заходит.
 *
 * Ключи не различаются намеренно: правило «шестнадцать знаков и больше»
 * не требует знать состав полей Bot API и не устареет вместе с ним.
 */
export function quoteLossyIntegers(json: string): string {
  let out = '';
  let i = 0;
  let inString = false;

  while (i < json.length) {
    const ch = json[i]!;

    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Экранированный символ проглатывается целиком, иначе \" закроет
        // строку и остаток тела будет разобран как структура.
        const next = json[i + 1];
        if (next !== undefined) {
          out += next;
          i += 2;
          continue;
        }
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    const startsNumber = ch === '-' ? isDigit(json[i + 1]) : isDigit(ch);
    if (!startsNumber) {
      out += ch;
      i += 1;
      continue;
    }

    let j = ch === '-' ? i + 1 : i;
    const digitsFrom = j;
    while (isDigit(json[j])) j += 1;
    const integerDigits = j - digitsFrom;

    // Дробная часть и экспонента поглощаются здесь же: иначе цикл
    // увидит «0000000000000000» после точки как отдельное число.
    let fractional = false;
    if (json[j] === '.') {
      fractional = true;
      j += 1;
      while (isDigit(json[j])) j += 1;
    }
    if (json[j] === 'e' || json[j] === 'E') {
      fractional = true;
      j += 1;
      if (json[j] === '+' || json[j] === '-') j += 1;
      while (isDigit(json[j])) j += 1;
    }

    const literal = json.slice(i, j);
    out += !fractional && integerDigits >= LOSSY_INTEGER_DIGITS ? `"${literal}"` : literal;
    i = j;
  }

  return out;
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * Разбор апдейта из СЫРОГО тела запроса.
 *
 * Именно эту функцию зовёт очередь: тело хранится в Redis строкой ровно
 * так, как пришло, и ни разу не пересобирается через JSON.stringify.
 * Пересборка — второй способ потерять точность идентификаторов, причём
 * незаметный.
 */
export function parseUpdateJson(raw: string): TgUpdate | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(quoteLossyIntegers(raw));
  } catch {
    return null;
  }
  return parseUpdate(parsed);
}

/**
 * Проверка уже разобранного объекта.
 *
 * Возвращает null на всё, что не похоже на апдейт, — без исключений:
 * на вебхуке мусор приходит регулярно (сканеры, чужие боты, повторы),
 * и превращать это в поток ошибок незачем.
 *
 * Неизвестные виды апдейтов (edited_message, inline_query, …) не ошибка:
 * возвращается апдейт с одним update_id, а роутер его игнорирует. Иначе
 * расширение allowed_updates превращалось бы в поток «мусорных» строк
 * в журнале.
 */
export function parseUpdate(raw: unknown): TgUpdate | null {
  const root = asRecord(raw);
  if (!root) return null;

  const updateId = asInt(root['update_id']);
  if (updateId === null) return null;

  const update: TgUpdate = { update_id: updateId };

  const message = parseMessage(root['message']);
  if (message) update.message = message;

  const callbackQuery = parseCallbackQuery(root['callback_query']);
  if (callbackQuery) update.callback_query = callbackQuery;

  const myChatMember = parseChatMemberUpdated(root['my_chat_member']);
  if (myChatMember) update.my_chat_member = myChatMember;

  return update;
}

/**
 * Номер апдейта без полного разбора — для ключа идемпотентности.
 *
 * Отдельная функция, потому что очередь обязана отсеять повтор ДО того,
 * как потратит время на разбор, и работает она с телом, которое ещё может
 * оказаться мусором.
 */
export function readUpdateId(raw: unknown): number | null {
  if (typeof raw === 'string') {
    try {
      return asInt(asRecord(JSON.parse(raw))?.['update_id']);
    } catch {
      return null;
    }
  }
  return asInt(asRecord(raw)?.['update_id']);
}

// ===========================================================================
//  РАЗБОР ЧАСТЕЙ
// ===========================================================================

function parseMessage(raw: unknown, depth = 0): TgMessage | null {
  const src = asRecord(raw);
  if (!src) return null;

  const messageId = asInt(src['message_id']);
  const chat = parseChat(src['chat']);
  if (messageId === null || !chat) return null;

  const message: TgMessage = {
    message_id: messageId,
    date: asInt(src['date']) ?? 0,
    chat,
  };

  const from = parseUser(src['from']);
  if (from) message.from = from;

  const text = src['text'];
  if (typeof text === 'string') message.text = text.slice(0, MAX_TEXT_LENGTH);

  // Глубина ограничена: reply_to_message ссылается на такое же сообщение,
  // и присланная вручную матрёшка из тысячи уровней иначе съела бы стек.
  // Одного уровня достаточно — поддержке нужен ровно ответ на сообщение.
  if (depth < 1) {
    const replyTo = parseMessage(src['reply_to_message'], depth + 1);
    if (replyTo) message.reply_to_message = replyTo;
  }

  return message;
}

function parseCallbackQuery(raw: unknown): TgCallbackQuery | null {
  const src = asRecord(raw);
  if (!src) return null;

  const id = src['id'];
  const from = parseUser(src['from']);
  if (typeof id !== 'string' || id.length === 0 || !from) return null;

  const query: TgCallbackQuery = { id, from };

  // callback_data ограничена Bot API 64 байтами; всё длиннее — не от Telegram.
  const data = src['data'];
  if (typeof data === 'string' && data.length <= 64) query.data = data;

  const message = parseMessage(src['message']);
  if (message) query.message = message;

  return query;
}

function parseChatMemberUpdated(raw: unknown): TgChatMemberUpdated | null {
  const src = asRecord(raw);
  if (!src) return null;

  const chat = parseChat(src['chat']);
  const from = parseUser(src['from']);
  const oldMember = parseChatMember(src['old_chat_member']);
  const newMember = parseChatMember(src['new_chat_member']);
  if (!chat || !from || !oldMember || !newMember) return null;

  return {
    chat,
    from,
    date: asInt(src['date']) ?? 0,
    old_chat_member: oldMember,
    new_chat_member: newMember,
  };
}

function parseChatMember(raw: unknown): TgChatMember | null {
  const src = asRecord(raw);
  if (!src) return null;

  const user = parseUser(src['user']);
  const status = src['status'];
  if (!user || typeof status !== 'string') return null;

  return { user, status };
}

function parseChat(raw: unknown): TgChat | null {
  const src = asRecord(raw);
  if (!src) return null;

  const id = asBigInt(src['id']);
  const type = src['type'];
  if (id === null || !isChatType(type)) return null;

  const chat: TgChat = { id, type };
  if (typeof src['username'] === 'string') chat.username = src['username'];
  if (typeof src['title'] === 'string') chat.title = src['title'];
  return chat;
}

function parseUser(raw: unknown): TgUser | null {
  const src = asRecord(raw);
  if (!src) return null;

  const id = asBigInt(src['id']);
  if (id === null) return null;

  const user: TgUser = {
    id,
    is_bot: src['is_bot'] === true,
    // first_name у Telegram обязателен, но пустая строка честнее отказа:
    // без имени апдейт по-прежнему пригоден к обработке.
    first_name: typeof src['first_name'] === 'string' ? src['first_name'] : '',
  };

  if (typeof src['last_name'] === 'string') user.last_name = src['last_name'];
  if (typeof src['username'] === 'string') user.username = src['username'];
  if (typeof src['language_code'] === 'string') user.language_code = src['language_code'];

  return user;
}

function isChatType(value: unknown): value is TgChatType {
  return value === 'private' || value === 'group' || value === 'supergroup' || value === 'channel';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Целое из number | string. Строка появляется после quoteLossyIntegers
 * и при повторном разборе уже сериализованного апдейта.
 */
function asInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function asBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}
