import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { ENV, type Env } from '@common/config/env.schema';
import { SettingsService } from '@common/settings/settings.service';

/**
 * Контроль допуска по БАЙТАМ для выдачи payload'а.
 *
 * Потоковая отдача невозможна не из-за удобства, а из-за контракта: GCM-тег
 * уезжает заголовком X-Payload-Tag, а он известен только после final(), тогда
 * как заголовки уходят до тела. То есть §7 жёстко предписывает буферизацию,
 * и единственный оставшийся рычаг — сколько буферов живёт одновременно.
 *
 * По байтам, а не по числу запросов: 200 запросов по 600 КБ и 200 по 8 МиБ
 * различаются на порядок, и один и тот же числовой лимит означал бы совершенно
 * разное потребление памяти.
 *
 * 503, а не 429: по §2.3 и приложению Б RATE_LIMITED повторять ЗАПРЕЩЕНО, то
 * есть 429 на всплеске нагрузки превращает обычный перезапуск загрузчика
 * в тупик, из которого пользователь не выйдет сам. 503 повторяем
 * с экспоненциальной задержкой — ровно нужная семантика.
 */

/**
 * Во сколько раз резервируется больше, чем размер открытого текста.
 *
 * Дефект Д4: в момент выдачи одновременно живут ОТКРЫТЫЙ текст (запись кэша),
 * ШИФРОТЕКСТ (новый ArrayBuffer от subtle.encrypt — тег отрезается subarray,
 * но сам буфер новый) и, при промахе кэша, пик Buffer.concat, где массив
 * чанков и склеенный буфер существуют вместе. Резервировать одну копию из трёх
 * значит вести учёт, который врёт втрое ровно на пике — а это Buffer'ы, то есть
 * ВНЕШНЯЯ память: --max-old-space-size их не считает, и промах даёт не
 * управляемый OOM в V8, а убийство процесса OOM-killer'ом хоста.
 *
 * Единственная реальная граница здесь — mem_limit контейнера (задан
 * в docker-compose). Коэффициент подобран под неё, а не под красоту.
 */
const MEMORY_AMPLIFICATION = 3;

/** Сколько ждать освобождения бюджета, прежде чем отвечать 503. */
const DEFAULT_WAIT_MS = 500;

/**
 * Страховочный потолок удержания слота.
 *
 * Слот освобождается по событию 'close' на reply.raw — это правильно
 * (медленный клиент держит шифротекст в буферах сокета до своего таймаута
 * приёма), но означает, что учёт зависит от события, которого в незамеченной
 * ветке может не случиться. Каждая такая ветка съедала бы бюджет НАВСЕГДА:
 * несколько десятков утечек по 8 МиБ — и весь продукт получает 503 до
 * перезапуска процесса (Д3). Таймер не является функциональным таймаутом,
 * он существует только чтобы ошибка учёта была временной, а не вечной.
 */
const MAX_HOLD_MS = 60_000;

/** Идемпотентное освобождение слота. Звать можно сколько угодно раз. */
export type PayloadSlot = () => void;

interface Waiter {
  bytes: number;
  grant: (slot: PayloadSlot) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class PayloadAdmissionService {
  private readonly logger = new Logger(PayloadAdmissionService.name);

  /** Зарезервировано сейчас, в байтах (уже с учётом MEMORY_AMPLIFICATION). */
  private reserved = 0;
  /** Последний прочитанный бюджет. Нужен для синхронного разбора очереди. */
  private budgetCache: number;
  private readonly queue: Waiter[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
  ) {
    this.budgetCache = env.PAYLOAD_INFLIGHT_MAX_BYTES;
  }

  /**
   * Занять место под выдачу размером plaintextBytes.
   *
   * Резервация делается ПОСЛЕ чтения строки PayloadBuild (размер известен из
   * БД, хранилище трогать не надо) и ПЕРЕД чтением и шифрованием.
   *
   * ВАЖНО для вызывающего: вернувшийся release обязан быть привязан
   * к событию 'close' на reply.raw НЕМЕДЛЕННО, до любой асинхронной работы,
   * и сразу после подписки надо проверить reply.raw.destroyed — иначе клиент,
   * отвалившийся по своему 15-секундному таймауту раньше, чем мы подписались,
   * заберёт слот навсегда (Д3).
   */
  async acquire(plaintextBytes: number, waitMs = DEFAULT_WAIT_MS): Promise<PayloadSlot> {
    const need = Math.max(1, Math.ceil(plaintextBytes)) * MEMORY_AMPLIFICATION;
    const budget = await this.budget();

    // Одна выдача больше всего бюджета — это ошибка сайзинга, а не
    // перегрузка: ждать нечего, очередь никогда не разойдётся. Отвечаем
    // сразу и пишем ERROR, потому что чинит это человек, а не время.
    if (need > budget) {
      this.logger.error(
        `выдача требует ${need} байт при бюджете ${budget} — ` +
          'PAYLOAD_INFLIGHT_MAX_BYTES меньше, чем k×размер сборки',
      );
      throw this.busy();
    }

    if (this.reserved + need <= budget) {
      this.reserved += need;
      return this.slot(need);
    }

    return new Promise<PayloadSlot>((resolve, reject) => {
      const waiter: Waiter = {
        bytes: need,
        grant: resolve,
        reject,
        timer: setTimeout(() => {
          const at = this.queue.indexOf(waiter);
          if (at !== -1) this.queue.splice(at, 1);
          reject(this.busy());
        }, waitMs),
      };

      this.queue.push(waiter);
    });
  }

  /** Диагностика: сколько байт зарезервировано и сколько запросов ждёт. */
  stats(): { reservedBytes: number; queued: number; budgetBytes: number } {
    return { reservedBytes: this.reserved, queued: this.queue.length, budgetBytes: this.budgetCache };
  }

  /**
   * Бюджет: настройка из БД, при её недоступности — умолчание из окружения.
   *
   * Настройка авторитетнее (её меняют без передеплоя, §12/§14), но падение
   * Postgres не должно превращать выдачу в 500: у нас есть значение, с которым
   * можно работать, и терминальный отказ вместо транзиентного здесь не нужен.
   */
  private async budget(): Promise<number> {
    try {
      const value = await this.settings.getNumber(
        'limits.payload.inflight_bytes_max',
        this.env.PAYLOAD_INFLIGHT_MAX_BYTES,
      );
      if (Number.isFinite(value) && value > 0) {
        this.budgetCache = value;
      }
    } catch (error) {
      this.logger.warn(
        `не удалось прочитать limits.payload.inflight_bytes_max, работаем по умолчанию ${
          this.budgetCache
        }: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return this.budgetCache;
  }

  /**
   * Освобождение слота.
   *
   * Идемпотентность — не защита от небрежности вызывающего, а требование
   * схемы: release зовётся и из слушателя 'close', и из ветки отказа
   * обработчика, и из страховочного таймера. Двойной вызов без флага вернул бы
   * в бюджет чужие байты, и учёт поехал бы в другую сторону — а бесплатный
   * бюджет обнаруживается только по OOM.
   */
  private slot(bytes: number): PayloadSlot {
    let released = false;
    let guard: NodeJS.Timeout | undefined;

    const release: PayloadSlot = () => {
      if (released) return;
      released = true;
      if (guard) clearTimeout(guard);
      this.reserved -= bytes;
      // Отрицательный остаток означал бы двойное освобождение, то есть
      // бесплатный бюджет — а он обнаруживается только по OOM.
      if (this.reserved < 0) this.reserved = 0;
      this.drain();
    };

    guard = setTimeout(() => {
      if (released) return;
      this.logger.warn(
        `слот на ${bytes} байт удерживался дольше ${MAX_HOLD_MS} мс — освобождён страховкой; ` +
          'значит, release не был вызван ни из close, ни из ветки отказа обработчика',
      );
      release();
    }, MAX_HOLD_MS);
    // Таймер не должен удерживать процесс при остановке.
    guard.unref();

    return release;
  }

  /**
   * Выдача мест ожидающим — строго FIFO.
   *
   * Голова очереди не пропускается вперёд более мелкими запросами намеренно:
   * пропуск давал бы бесконечное голодание крупной сборки на потоке мелких,
   * а разброс размеров тут по определению небольшой (одна опубликованная
   * сборка на продукт).
   */
  private drain(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!next) return;
      if (this.reserved + next.bytes > this.budgetCache) return;

      this.queue.shift();
      clearTimeout(next.timer);
      this.reserved += next.bytes;
      next.grant(this.slot(next.bytes));
    }
  }

  private busy(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Сервер временно перегружен, повторите запрос',
    });
  }
}
