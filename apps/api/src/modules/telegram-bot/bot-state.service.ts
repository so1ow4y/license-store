import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { RedisService } from '@common/redis/redis.service';

/**
 * Состояние диалога (§5.0 ТЗ).
 *
 * ТОЛЬКО Redis, ни строки в БД. Причина не в скорости: состояние обязано
 * протухать САМО. Строка в таблице «ожидаем код Digiseller» живёт до тех
 * пор, пока её кто-нибудь не уберёт, и человек, вернувшийся в чат через
 * неделю, отправляет «привет» прямо в активатор покупок. TTL решает это
 * без крона и без единой строки кода очистки.
 *
 * Второе следствие: по таймауту бот НИЧЕГО не пишет. Написать «время
 * вышло» через пять минут молчания — значит разбудить уведомлением того,
 * кто уже ушёл.
 */
const STATE_PREFIX = 'tg:state:';

/**
 * Срок жизни каждого состояния. Разный намеренно: подтверждение
 * необратимого действия живёт две минуты (за это время человек либо жмёт,
 * либо передумал), а текст обращения в поддержку — пятнадцать, потому что
 * его пишут, а не выбирают.
 */
const STATE_TTL_SEC: Record<BotStateName, number> = {
  idle: 60,
  awaiting_digiseller_code: 300,
  awaiting_order_data: 300,
  awaiting_registration_key: 300,
  awaiting_support_text: 900,
  awaiting_hwid_confirm: 120,
  awaiting_key_confirm: 120,
  // Состояния нет в перечне §5.0 ТЗ, но метка подтверждения для отвязки
  // там же требуется (`cb:unlink_go:<nonce>`), а метка живёт только внутри
  // состояния. Реюз чужого состояния дал бы кнопку «отключить бота»,
  // гасящую метку сброса привязки, — и наоборот.
  awaiting_unlink_confirm: 120,
};

/** Длина одноразовой метки подтверждения. */
const NONCE_LENGTH = 8;

/**
 * Алфавит метки: без похожих символов.
 *
 * Метка не вводится руками, но попадает в `callback_data` и в логи, где её
 * читают глазами при разборе инцидента. I/1 и O/0 в такой строке стоят
 * получаса на сверку.
 */
const NONCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type BotStateName =
  | 'idle'
  | 'awaiting_digiseller_code'
  | 'awaiting_order_data'
  | 'awaiting_registration_key'
  | 'awaiting_support_text'
  | 'awaiting_hwid_confirm'
  | 'awaiting_key_confirm'
  | 'awaiting_unlink_confirm';

export interface BotState {
  s: BotStateName;
  /** Момент установки, unix-секунды. Нужен для логов: «застрял на 4 минуты». */
  since: number;
  ctx?: Record<string, string>;
}

const IDLE: BotState = { s: 'idle', since: 0 };

@Injectable()
export class BotStateService {
  private readonly logger = new Logger(BotStateService.name);

  constructor(private readonly redis: RedisService) {}

  /** Текущее состояние чата. Отсутствие ключа и любой сбой — это `idle`. */
  async get(chatId: bigint): Promise<BotState> {
    try {
      const raw = await this.redis.client.get(this.key(chatId));
      if (!raw) return IDLE;

      const parsed: unknown = JSON.parse(raw);
      if (!this.isState(parsed)) {
        // Мусор в ключе — не повод падать: чат просто начинает с чистого листа.
        this.logger.warn(`нечитаемое состояние чата, сброшено`);
        await this.clear(chatId);
        return IDLE;
      }

      return parsed;
    } catch (error) {
      this.logger.warn(
        `состояние недоступно, считаем idle: ${error instanceof Error ? error.message : String(error)}`,
      );
      return IDLE;
    }
  }

  /** Установка состояния с TTL по его типу. */
  async set(chatId: bigint, state: BotStateName, ctx?: Record<string, string>): Promise<void> {
    if (state === 'idle') {
      await this.clear(chatId);
      return;
    }

    const value: BotState = { s: state, since: Math.floor(Date.now() / 1000), ...(ctx ? { ctx } : {}) };

    try {
      await this.redis.client.set(
        this.key(chatId),
        JSON.stringify(value),
        'EX',
        STATE_TTL_SEC[state],
      );
    } catch (error) {
      // Диалог без состояния деградирует до «бот не понял» — это хуже,
      // чем работающий бот, но лучше, чем упавший обработчик апдейта.
      this.logger.warn(
        `не удалось сохранить состояние ${state}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async clear(chatId: bigint): Promise<void> {
    try {
      await this.redis.client.del(this.key(chatId));
    } catch {
      // Не удалили — состояние истечёт само по TTL.
    }
  }

  /**
   * Метка одноразового подтверждения.
   *
   * Без неё кнопка «Да, сбросить», нажатая из истории чата через неделю,
   * выполнит сброс: `callback_data` живёт ровно столько, сколько живёт
   * сообщение. С меткой такая кнопка получает «действие устарело», потому
   * что состояние, в котором метка лежала, давно истекло.
   */
  async newNonce(
    chatId: bigint,
    state: BotStateName,
    ctx: Record<string, string> = {},
  ): Promise<string> {
    const nonce = this.generateNonce();
    await this.set(chatId, state, { ...ctx, nonce });
    return nonce;
  }

  /**
   * Проверить и погасить метку.
   *
   * Гашение атомарное (`GETDEL`): без него два быстрых нажатия одной кнопки
   * успевают прочитать состояние оба и выполнить действие дважды. Для
   * сброса привязки это стоит человеку одного сброса из трёх.
   *
   * Возвращает контекст состояния при совпадении и `null` при любом
   * расхождении — истёкшем состоянии, чужой метке, другом состоянии.
   * Все три случая для пользователя выглядят одинаково («действие
   * устарело»), и различать их наружу незачем.
   */
  async consumeNonce(
    chatId: bigint,
    expected: BotStateName,
    nonce: string,
  ): Promise<Record<string, string> | null> {
    let raw: string | null;

    try {
      raw = await this.redis.client.getdel(this.key(chatId));
    } catch (error) {
      // ЗДЕСЬ fail-open НЕДОПУСТИМ: метка защищает необратимое действие,
      // и «Redis недоступен — так и быть, выполняем» означает выполнение
      // сброса по кнопке недельной давности.
      this.logger.warn(
        `не удалось погасить метку: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!this.isState(parsed) || parsed.s !== expected) return null;
    if (!parsed.ctx || parsed.ctx.nonce !== nonce) return null;

    return parsed.ctx;
  }

  private generateNonce(): string {
    const bytes = randomBytes(NONCE_LENGTH);
    let result = '';
    for (const byte of bytes) {
      result += NONCE_ALPHABET[byte % NONCE_ALPHABET.length];
    }
    return result;
  }

  private key(chatId: bigint): string {
    return `${STATE_PREFIX}${chatId}`;
  }

  private isState(value: unknown): value is BotState {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { s?: unknown; since?: unknown; ctx?: unknown };

    if (typeof candidate.s !== 'string' || !(candidate.s in STATE_TTL_SEC)) return false;
    if (typeof candidate.since !== 'number') return false;
    if (candidate.ctx !== undefined && (typeof candidate.ctx !== 'object' || candidate.ctx === null)) {
      return false;
    }

    return true;
  }
}
