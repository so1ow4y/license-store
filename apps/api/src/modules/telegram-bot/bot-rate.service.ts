import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '@common/redis/redis.service';

/**
 * Общий счётчик частоты для всех лимитов бота (§7.5 ТЗ).
 *
 * Один сервис на все ключи, а не по счётчику в каждом экране: лимитов
 * семь, и семь копий одной арифметики разошлись бы при первой же правке —
 * например, при переходе на fail-open. Ключ и порог передаёт вызывающий,
 * потому что смысл лимита знает он:
 *
 *   tg:linkfail:<chatId>   5/ч    перебор токенов привязки
 *   tg:linkcode:<userId>   5/ч    выпуск кодов привязки
 *   tg:keyreveal:<chatId>  3/ч    показ полного ключа
 *   tg:activate:<userId>  10/ч    попытки активации покупки
 *   tg:support:<userId>    3/ч    обращения в поддержку
 *   tg:msg:<chatId>       20/мин  входящие сообщения
 *   tg:notify:<userId>    10/ч    потолок уведомлений
 *
 * Окно фиксированное (INCR + EXPIRE), как у счётчика попыток Digiseller
 * (digiseller.service.ts:1316-1337), а не скользящее на sorted set.
 * Разница проявляется только на стыке окон — там пропускается до двух
 * порогов подряд. Для лимитов, которые гасят перебор и флуд, это
 * приемлемо, а ZSET на каждое нажатие кнопки — нет.
 */
@Injectable()
export class BotRateService {
  private readonly logger = new Logger(BotRateService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Учесть событие. true — разрешено, false — порог превышен.
   *
   * Redis недоступен → true. Fail-open здесь осознан: счётчик — инструмент
   * наблюдения, а не рубеж безопасности (тот же выбор, что в
   * payload.service.ts:485-515). Остановить бота целиком из-за упавшего
   * кэша значит превратить деградацию в отказ.
   */
  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    try {
      const count = await this.redis.client.incr(key);

      // TTL ставится на первом инкременте. Проверка ttl < 0 нужна для
      // ключа, переживившего рестарт Redis без TTL: без неё счётчик
      // застревает над порогом навсегда и лимит становится вечным баном.
      if (count === 1) {
        await this.redis.client.expire(key, windowSec);
      } else if ((await this.redis.client.ttl(key)) < 0) {
        await this.redis.client.expire(key, windowSec);
      }

      return count <= limit;
    } catch (error) {
      this.logger.warn(
        `счётчик ${key} недоступен, лимит не проверен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }

  /** Текущее значение без учёта события. Нужно, чтобы показать «осталось N». */
  async peek(key: string): Promise<number> {
    try {
      const raw = await this.redis.client.get(key);
      const value = Number(raw ?? 0);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  /** Сброс счётчика: успешное действие снимает штраф за неудачные попытки. */
  async reset(key: string): Promise<void> {
    try {
      await this.redis.client.del(key);
    } catch {
      // Не сбросили — счётчик истечёт сам по TTL.
    }
  }
}
