import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '@common/redis/redis.service';

import { parseUpdateJson, readUpdateId, type TgUpdate } from './dto/telegram-update.types';

/**
 * Очередь входящих апдейтов.
 *
 * ПОЧЕМУ REDIS-СПИСОК, А НЕ ТАБЛИЦА. Потерянный апдейт Telegram пришлёт
 * повторно — он повторяет доставку, пока не получит 200, и делает это
 * часами. Потерянное уведомление не пришлёт никто, поэтому уведомления
 * и живут в БД, а апдейты — нет. Платить транзакцией и вакуумом за данные
 * со сроком жизни в секунду незачем.
 *
 * ЗАЧЕМ ОЧЕРЕДЬ ВООБЩЕ. Telegram ждёт ответ на вебхук считаные секунды
 * и при таймауте шлёт апдейт заново — то есть медленный обработчик
 * превращается в дубликаты, а дубликат сброса HWID стоит человеку
 * одной из трёх попыток. Контроллер обязан отвечать 200 сразу.
 *
 * НАПРАВЛЕНИЕ. LPUSH кладёт в голову, RPOP забирает из хвоста — это FIFO.
 * Возврат апдейта (чат занят) идёт тем же LPUSH, то есть в конец очереди:
 * иначе занятый чат крутился бы в цикле, вытесняя всех остальных.
 */

const QUEUE_KEY = 'tg:queue';
/**
 * Список целиком живёт час. Страховка от «очередь набилась при аварии,
 * авария кончилась, и бот час отвечает на вопросы позавчерашней давности».
 * Отвечать на протухший апдейт хуже, чем не отвечать.
 */
const QUEUE_TTL_SEC = 3600;

/**
 * Ключ идемпотентности. Час — с запасом перекрывает окно повторов Telegram.
 */
const DEDUP_PREFIX = 'tg:upd:';
const DEDUP_TTL_SEC = 3600;

/**
 * Потолок длины очереди, чтобы зависший обработчик не съел память Redis.
 * Сверх него push возвращает `unavailable` и снимает ключ идемпотентности,
 * контроллер отвечает 503 — Telegram повторит апдейт позже.
 */
const MAX_QUEUE_LEN = 10_000;

/**
 * Апдейт вместе с сырым телом.
 *
 * Сырое тело хранится и возвращается намеренно: только оно позволяет
 * вернуть апдейт в очередь без пересборки через JSON.stringify. Пересборка
 * прогоняет bigint-идентификаторы через toJSON и способна отдать их
 * числом с потерей точности — молча и однажды.
 */
export interface QueuedUpdate {
  update: TgUpdate;
  raw: string;
}

/**
 * Исход постановки в очередь.
 *
 *   queued      — принято;
 *   duplicate   — уже видели этот update_id, повторять нечего;
 *   invalid     — тело не разбирается или в нём нет update_id. Повтор не
 *                 поможет: придёт тот же мусор. Контроллер отвечает 200;
 *   unavailable — принять не смогли (очередь полна, Redis недоступен).
 *                 Контроллер обязан ответить ошибкой, чтобы Telegram
 *                 прислал апдейт снова.
 */
export type PushOutcome = 'queued' | 'duplicate' | 'invalid' | 'unavailable';

@Injectable()
export class TelegramUpdateQueue {
  private readonly logger = new Logger(TelegramUpdateQueue.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Положить тело вебхука в очередь.
   *
   * Принимает СЫРУЮ строку тела (как пришла) либо уже разобранный объект.
   * Строка предпочтительна: она не проходила через JSON.parse и хранит
   * идентификаторы посимвольно.
   *
   * Никогда не бросает: контроллер обязан ответить Telegram 200 в любом
   * случае. Отказ — это возвращаемое значение, а не исключение.
   */
  async push(raw: unknown): Promise<PushOutcome> {
    const json = this.serialize(raw);
    if (json === null) {
      this.logger.warn('тело вебхука не сериализуется — отброшено');
      return 'invalid';
    }

    const updateId = readUpdateId(json);
    if (updateId === null) {
      // Без update_id идемпотентность недостижима, а обрабатывать такое
      // всё равно нечего: это не апдейт. Повтор пришлёт тот же мусор.
      this.logger.warn('тело вебхука без update_id — отброшено');
      return 'invalid';
    }

    const dedupKey = `${DEDUP_PREFIX}${updateId}`;

    try {
      const fresh = await this.redis.client.set(dedupKey, '1', 'EX', DEDUP_TTL_SEC, 'NX');
      if (fresh === null) return 'duplicate';

      const length = await this.redis.client.llen(QUEUE_KEY);
      if (length >= MAX_QUEUE_LEN) {
        this.logger.warn(`очередь апдейтов переполнена (${length}) — апдейт ${updateId} не принят`);
        // Ключ идемпотентности снимается обязательно: иначе повтор от
        // Telegram будет отброшен как дубль апдейта, которого мы никогда
        // не обрабатывали, и защита от потери превратится в её причину.
        await this.releaseDedup(dedupKey);
        return 'unavailable';
      }

      await this.redis.client.lpush(QUEUE_KEY, json);
      await this.redis.client.expire(QUEUE_KEY, QUEUE_TTL_SEC);
      return 'queued';
    } catch (error) {
      this.logger.warn(
        `очередь недоступна, апдейт ${updateId} не принят: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Ключ мог успеть встать до сбоя (упасть мог как раз lpush) — снимаем
      // и его, по тому же доводу, что и при переполнении.
      await this.releaseDedup(dedupKey);
      return 'unavailable';
    }
  }

  /** Снять ключ идемпотентности: апдейт в очередь не попал, повтор нужен. */
  private async releaseDedup(dedupKey: string): Promise<void> {
    await this.redis.client.del(dedupKey).catch(() => undefined);
  }

  /**
   * Забрать до max апдейтов.
   *
   * Неразбираемые строки выбрасываются здесь же: вернуть их в очередь
   * значит зациклить обработчик на мусоре.
   */
  async pop(max: number): Promise<QueuedUpdate[]> {
    if (max <= 0) return [];

    let rows: string[] | null;
    try {
      rows = await this.redis.client.rpop(QUEUE_KEY, max);
    } catch (error) {
      this.logger.warn(
        `очередь недоступна при чтении: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }

    if (!rows || rows.length === 0) return [];

    const batch: QueuedUpdate[] = [];
    for (const raw of rows) {
      const update = parseUpdateJson(raw);
      if (!update) {
        this.logger.warn('апдейт не разобран — отброшен');
        continue;
      }
      batch.push({ update, raw });
    }

    return batch;
  }

  /**
   * Вернуть апдейт в конец очереди — чат сейчас занят другим апдейтом.
   *
   * Именно сырое тело, а не пересобранный объект: см. комментарий
   * к QueuedUpdate.
   */
  async requeue(raw: string): Promise<void> {
    try {
      await this.redis.client.lpush(QUEUE_KEY, raw);
      await this.redis.client.expire(QUEUE_KEY, QUEUE_TTL_SEC);
    } catch (error) {
      this.logger.warn(
        `апдейт не возвращён в очередь: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Длина очереди — для проб и диагностики. */
  async size(): Promise<number> {
    try {
      return await this.redis.client.llen(QUEUE_KEY);
    } catch {
      return 0;
    }
  }

  /**
   * Приведение тела к строке.
   *
   * Строка возвращается как есть — это главный путь. Объект сериализуется
   * с заменой bigint на строку: без replacer'а JSON.stringify на bigint
   * бросает TypeError, а глобальный BigInt.prototype.toJSON из main.ts
   * отдал бы число, то есть потерю точности.
   */
  private serialize(raw: unknown): string | null {
    if (typeof raw === 'string') return raw;
    if (raw === null || raw === undefined) return null;

    try {
      return JSON.stringify(raw, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
    } catch {
      return null;
    }
  }
}
