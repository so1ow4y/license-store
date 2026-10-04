import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';

import { ENV, type Env } from '@common/config/env.schema';
import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';
import { StorageService } from '@common/storage/storage.service';

/**
 * Открытые байты payload'а в памяти ПРОЦЕССА: LRU по суммарному объёму
 * плюс single-flight.
 *
 * Почему в памяти, а не в Redis: RDB и AOF кладут самый ценный актив системы
 * на диск сервера — ровно то, что §7 и §11.3 запрещают делать на клиенте,
 * только на другом конце провода; round-trip 600 КБ–8 МиБ возвращает ту
 * латентность, ради которой кэш и заводится; а allkeys-lru (документировано
 * в redis.service.ts) делает выселение непредсказуемым.
 *
 * Почему вообще кэш, если payload запрашивается раз на ЗАПУСК (1000 онлайн ×
 * ~3 запуска ≈ 0.03 rps): стационарный режим здесь ни при чём. Считать надо
 * всплеск — вечерний пик или восстановление после аварии, когда 500 запусков
 * приходят одновременно. Без single-flight это 500 параллельных GET ОДНОГО
 * объекта и 500 живущих одновременно буферов открытого текста.
 *
 * Кэшируется ТОЛЬКО открытый текст. Шифротекст не кэшируется никогда: он
 * уникален на каждый ответ по построению (эфемерный ключ + свежий IV), и его
 * переиспользование означало бы повтор пары (ключ, IV) — не «ослабление»,
 * а полную потерю стойкости GCM.
 *
 * Ключ записи КОНТЕНТ-АДРЕСУЕМЫЙ: `${buildId}:${sha256}`. Это не украшение,
 * а закрытие дефекта Д8/Д18. Заголовки и AAD собираются из СВЕЖЕЙ строки
 * PayloadBuild на каждый запрос, а тело берётся отсюда; при ключе по одному
 * buildId устаревшая запись (потерянное сообщение об инвалидации, гонка
 * «заполнение против publish») выдавалась бы под НОВЫМ эталонным sha256:
 * GCM-тег у клиента сходится, сверка §7.2.3 падает, пользователь видит
 * «повреждённые данные», а в наших логах — чистый 200. С sha256 в ключе такая
 * запись просто недостижима, и никакой счётчик поколений не нужен.
 */

/** Байты одной сборки вместе с проверенным дайджестом. */
export interface PayloadPlaintext {
  body: Buffer;
  size: number;
  /** SHA-256 прочитанных байт. Совпадение с эталоном уже проверено. */
  sha256: string;
}

/** Что кэшу нужно знать о выдаваемой сборке. */
export interface PayloadSource {
  buildId: string;
  bucket: string;
  objectKey: string;
  /** Эталон из PayloadBuild.sha256 — тот же, что уходит в X-Payload-Sha256. */
  sha256: string;
  /** Эталонный размер открытого текста из PayloadBuild.size. */
  size: number;
}

/** Канал инвалидации. Тот же образец, что у настроек ('settings:invalidate'). */
const INVALIDATION_CHANNEL = 'payload:invalidate';

/**
 * Сколько держать отметку «байты в хранилище разошлись с эталоном».
 *
 * Дефект Д21: PAYLOAD_CORRUPT — постоянная неисправность (чинит человек),
 * но отдаётся кодом 503, который клиент по контракту ОБЯЗАН повторять.
 * Без отрицательной записи каждый повтор каждого клиента заново тянет из
 * хранилища до 8 МиБ и заново хеширует — амплификация трафика к S3 на порядки
 * поверх уже случившейся аварии. Минута выбрана как компромисс: достаточно,
 * чтобы погасить шторм, и достаточно мало, чтобы починка была видна сразу.
 */
const CORRUPT_TTL_MS = 60_000;

/** Запас к дедлайну хранилища: наш таймер — внешний backstop, а не дубль. */
const FILL_DEADLINE_SLACK_MS = 2_000;

interface CacheEntry {
  plaintext: PayloadPlaintext;
  storedAt: number;
}

interface InFlight {
  promise: Promise<PayloadPlaintext>;
  /** Сколько запросов ждёт этот полёт. Нужен, чтобы не отменить чужую работу. */
  waiters: number;
  controller: AbortController;
}

@Injectable()
export class PayloadCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayloadCacheService.name);

  /**
   * Map сохраняет порядок вставки — это и есть LRU: попадание переставляет
   * запись в конец, выселение идёт с начала. Отдельная структура ради
   * нескольких десятков записей была бы лишней.
   */
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  /** Полёты по ключу записи. Хранится Promise, а не Buffer, — в этом весь смысл. */
  private readonly inFlight = new Map<string, InFlight>();

  /** Ключ записи → до какого момента считать сборку неисправной. */
  private readonly corrupt = new Map<string, number>();

  private subscriber?: Redis;

  /**
   * Последний прочитанный потолок кэша в байтах.
   *
   * Нужен как значение, с которым можно работать, когда настройка недоступна:
   * падение Postgres не должно превращать выдачу payload'а в отказ из-за
   * ручки, у которой есть разумное значение из окружения.
   */
  private maxBytesCache: number;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {
    this.maxBytesCache = env.PAYLOAD_CACHE_MAX_BYTES;
  }

  async onModuleInit(): Promise<void> {
    // Отдельное соединение: клиент ioredis в режиме подписки не может
    // выполнять обычные команды.
    this.subscriber = this.redis.client.duplicate();
    await this.subscriber.subscribe(INVALIDATION_CHANNEL);
    this.subscriber.on('message', (_channel, buildId) => this.forget(buildId));
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }

  /**
   * Открытые байты сборки.
   *
   * @param signal сигнал вызывающего (обрыв соединения клиента). Отменяет
   *        чтение из хранилища ТОЛЬКО если этого полёта больше никто не ждёт:
   *        один ушедший пользователь не имеет права обрывать работу, которую
   *        ждут ещё сотни.
   */
  async get(source: PayloadSource, opts: { signal?: AbortSignal } = {}): Promise<PayloadPlaintext> {
    const key = this.keyOf(source);

    const corruptUntil = this.corrupt.get(key);
    if (corruptUntil !== undefined) {
      if (corruptUntil > Date.now()) throw this.corruptError(source);
      this.corrupt.delete(key);
    }

    const hit = this.entries.get(key);
    if (hit) {
      if (Date.now() - hit.storedAt < this.env.PAYLOAD_CACHE_TTL_MS) {
        // Переставляем в конец: свежеиспользованное выселяется последним.
        this.entries.delete(key);
        this.entries.set(key, hit);
        return hit.plaintext;
      }
      this.drop(key);
    }

    return this.join(key, source, opts.signal);
  }

  /**
   * Забыть сборку на ВСЕХ репликах. Зовётся из publish/unpublish.
   *
   * Публиковать надо ПОСЛЕ коммита: иначе другая реплика успеет перечитать
   * старое состояние и закэшировать его заново.
   */
  async invalidate(buildId: string): Promise<void> {
    this.forget(buildId);
    await this.redis.client.publish(INVALIDATION_CHANNEL, buildId);
  }

  /** Диагностика для тестов и логов. */
  stats(): { entries: number; bytes: number; inFlight: number } {
    return { entries: this.entries.size, bytes: this.totalBytes, inFlight: this.inFlight.size };
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Присоединиться к идущему чтению или начать своё.
   *
   * Ровно здесь живёт свойство «500 одновременных запусков дают 1 GET».
   */
  private join(key: string, source: PayloadSource, signal?: AbortSignal): Promise<PayloadPlaintext> {
    let entry = this.inFlight.get(key);

    // Полёт, который уже отменён, переиспользовать нельзя: его промис
    // отклонится, и присоединившийся получил бы отказ вместо байтов.
    if (entry && entry.controller.signal.aborted) entry = undefined;

    if (!entry) {
      const controller = new AbortController();
      const created: InFlight = {
        controller,
        waiters: 0,
        promise: this.fill(key, source, controller),
      };
      // Запись удаляется ПРИ ЛЮБОМ исходе, включая успех (значение к этому
      // моменту уже лежит в LRU). Дефект Д2: если оставить в Map отклонённый
      // промис, все будущие запросы этой сборки будут получать закэшированный
      // отказ вечно; если оставить зависший — эндпоинт мёртв до перезапуска
      // процесса, причём /health/ready при этом зелёный.
      created.promise = created.promise.finally(() => {
        if (this.inFlight.get(key) === created) this.inFlight.delete(key);
      });
      this.inFlight.set(key, created);
      entry = created;
    }

    const flight = entry;
    flight.waiters += 1;

    if (!signal) return flight.promise;

    // Отмена вычитается из числа ожидающих; отменяем чтение, только когда
    // ждать его больше некому.
    let counted = true;
    const onAbort = (): void => {
      if (!counted) return;
      counted = false;
      flight.waiters -= 1;
      if (flight.waiters <= 0) {
        flight.controller.abort(signal.reason);
      }
    };

    if (signal.aborted) {
      // addEventListener на уже отменённом сигнале не сработает никогда.
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    return flight.promise.finally(() => {
      signal.removeEventListener('abort', onAbort);
      if (counted) {
        counted = false;
        flight.waiters -= 1;
      }
    });
  }

  /**
   * Одно чтение объекта: байты, сверка с эталоном, запись в LRU.
   *
   * Дедлайн стоит поверх дедлайна StorageService намеренно. Тот закрывает
   * head + get + цикл чтения; этот закрывает ВСЮ операцию, включая ветки, о
   * которых мы сегодня не думаем. Оба нужны, потому что цена ошибки —
   * не медленный ответ, а мёртвая сборка: Map хранит Promise, и один
   * повисший лидер оставляет без payload'а всех.
   */
  private async fill(
    key: string,
    source: PayloadSource,
    controller: AbortController,
  ): Promise<PayloadPlaintext> {
    const deadlineMs = this.env.S3_READ_DEADLINE_MS + FILL_DEADLINE_SLACK_MS;

    const read = this.storage
      .getObjectBuffer(source.bucket, source.objectKey, {
        maxBytes: this.env.PAYLOAD_MAX_BYTES,
        signal: controller.signal,
      })
      .then(async (object) => {
        // Сверка ЗДЕСЬ, а не на каждом запросе: хеш уже посчитан тем же
        // проходом, что и чтение, а гонять 8 МиБ на каждую выдачу незачем.
        //
        // Эталон обязан приходить из БД, а не пересчитываться по тем же
        // байтам, которые мы отдаём: иначе клиентская сверка §7.2.3 не может
        // провалиться никогда и превращается в декорацию, тогда как §11.3
        // прямо запрещает игнорировать несовпадение SHA-256.
        if (object.sha256 !== source.sha256) {
          this.logger.error(
            `сборка ${source.buildId}: объект ${source.bucket}/${source.objectKey} имеет sha256 ` +
              `${object.sha256}, эталон ${source.sha256} — выдача остановлена, тело НЕ отдано`,
          );
          this.corrupt.set(key, Date.now() + CORRUPT_TTL_MS);
          throw this.corruptError(source);
        }

        // Размер расходится при совпавшем хеше только если эталонный size
        // в БД неверен — это тоже расхождение с тем, что уедет в заголовок
        // и в AAD, то есть провал тега у клиента.
        if (object.size !== source.size) {
          this.logger.error(
            `сборка ${source.buildId}: размер объекта ${object.size} против эталона ${source.size} ` +
              'при совпавшем sha256 — расхождение метаданных публикации',
          );
          this.corrupt.set(key, Date.now() + CORRUPT_TTL_MS);
          throw this.corruptError(source);
        }

        const plaintext: PayloadPlaintext = {
          body: object.body,
          size: object.size,
          sha256: object.sha256,
        };
        // await, а не «положим потом»: присоединившиеся к этому полёту должны
        // получить байты уже ПОСЛЕ того, как запись легла в LRU, иначе
        // следующий запрос той же сборки может не увидеть кэш. Ожидание здесь
        // — чтение настройки из памяти процесса (SettingsService держит
        // значения в Map с инвалидацией через pub/sub), а не поход в БД.
        await this.store(key, plaintext);
        return plaintext;
      });

    return this.withDeadline(read, deadlineMs, controller, source);
  }

  /**
   * Внешний дедлайн: отменяет работу И перестаёт её ждать.
   *
   * Одного abort недостаточно — если нижележащий код по какой-то причине
   * сигнал не соблюдёт, ожидание всё равно должно закончиться. Одного
   * Promise.race тоже недостаточно — брошенное чтение продолжало бы
   * занимать память и соединение. Поэтому и то, и другое.
   */
  private withDeadline(
    work: Promise<PayloadPlaintext>,
    deadlineMs: number,
    controller: AbortController,
    source: PayloadSource,
  ): Promise<PayloadPlaintext> {
    let timer: NodeJS.Timeout | undefined;

    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(new Error('дедлайн чтения payload\'а'));
        this.logger.error(
          `чтение ${source.bucket}/${source.objectKey} не уложилось в ${deadlineMs} мс — ` +
            'полёт снят, запись из Map удалена',
        );
        reject(
          new ServiceUnavailableException({
            code: 'STORAGE_UNAVAILABLE',
            message: 'Хранилище временно недоступно',
          }),
        );
      }, deadlineMs);
    });

    return Promise.race([work, expiry]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Потолок кэша: настройка из БД, при её недоступности — значение окружения.
   *
   * Тот же образец, что у PayloadAdmissionService.budget() для соседней ручки
   * limits.payload.inflight_bytes_max. Настройка авторитетнее окружения: её
   * меняют в панели без передеплоя (§12/§14), и «срезать кэш» при разборе
   * инцидента с памятью — единственный доступный рычаг. Читать её на каждую
   * запись дёшево: SettingsService держит значения в памяти процесса и
   * сбрасывает кэш по сообщению 'settings:invalidate', то есть похода в
   * Postgres здесь обычно нет вовсе.
   *
   * Ноль пропускается наравне с положительными значениями: 0 — это осознанное
   * «кэш выключен» (см. env.schema.ts), а не отсутствие значения.
   */
  private async maxBytes(): Promise<number> {
    try {
      const value = await this.settings.getNumber(
        'limits.payload.cache_bytes_max',
        this.env.PAYLOAD_CACHE_MAX_BYTES,
      );
      if (Number.isFinite(value) && value >= 0) {
        this.maxBytesCache = value;
      }
    } catch (error) {
      this.logger.warn(
        `не удалось прочитать limits.payload.cache_bytes_max, работаем по умолчанию ${
          this.maxBytesCache
        }: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return this.maxBytesCache;
  }

  /**
   * Запись байтов в LRU под текущий потолок.
   *
   * Новое значение настройки применяется НА ЭТОМ обращении и на всех
   * следующих. Мгновенно, по сообщению об изменении, — нельзя: пришлось бы
   * подписываться ещё на один канал и выбрасывать уже прочитанные байты ради
   * ручки, которую трогают в лучшем случае при аварии. Уменьшение потолка при
   * этом НЕ откладывается до истечения TTL: лишнее выселяется здесь же, до
   * укладки новой записи, поэтому «срезать кэш» освобождает память на первом
   * же запросе payload'а, а не после передеплоя.
   */
  private async store(key: string, plaintext: PayloadPlaintext): Promise<void> {
    const max = await this.maxBytes();

    // 0 = кэш выключен явно. Single-flight при этом продолжает работать:
    // всплеск всё равно даёт один GET, просто следующий запуск читает заново.
    if (max <= 0 || plaintext.size > max) {
      // Потолок могли срезать (или обнулить) уже после того, как записи легли.
      // Без этой строки выключение кэша не освобождало бы ни байта до TTL.
      this.evictTo(max);
      return;
    }

    // Перезапись существующего ключа возможна (два полёта разошлись во
    // времени вокруг TTL-промаха). Без снятия старого размера счётчик байт
    // поехал бы вверх, а он — единственная граница потребления памяти кэшем.
    this.drop(key);

    this.entries.set(key, { plaintext, storedAt: Date.now() });
    this.totalBytes += plaintext.size;

    this.evictTo(max, key);
  }

  /**
   * Выселение с головы Map (самое давнее по использованию) до потолка.
   *
   * Ограничение по СУММАРНЫМ БАЙТАМ, а не по числу записей: «LRU на 100
   * записей» при потолке 8 МиБ — это 800 МБ RSS, о которых никто не думал.
   *
   * @param keep ключ, который только что положили: его выселять бессмысленно,
   *        а размер его уже проверен по потолку.
   */
  private evictTo(max: number, keep?: string): void {
    for (const oldest of this.entries.keys()) {
      if (this.totalBytes <= max) break;
      if (oldest === keep) continue;
      this.drop(oldest);
    }
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.plaintext.size;
    if (this.totalBytes < 0) this.totalBytes = 0;
    // Буфер НЕ затирается: на него может ссылаться идущее прямо сейчас
    // шифрование (subtle.encrypt читает его асинхронно), и обнуление дало бы
    // не защиту, а порчу ответа. Открытый payload в памяти воркера — записанное
    // ограничение схемы, закрывается настройкой контейнера (RLIMIT_CORE=0),
    // а не приложением.
  }

  /**
   * Локальное забывание сборки во всех её видах.
   *
   * Строго говоря, для КОРРЕКТНОСТИ инвалидация не нужна: ключ содержит
   * sha256, поэтому после перезаливки старая запись просто перестаёт
   * запрашиваться. Она нужна для ПАМЯТИ (иначе мёртвые байты живут до TTL или
   * вытеснения) и для снятия отметки «сборка неисправна» сразу после починки,
   * а не через минуту.
   *
   * '*' — забыть всё, тот же протокол, что у settings:invalidate.
   */
  private forget(buildId: string): void {
    if (buildId === '*') {
      for (const key of [...this.entries.keys()]) this.drop(key);
      this.corrupt.clear();
      return;
    }

    const prefix = `${buildId}:`;

    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.drop(key);
    }
    for (const key of [...this.corrupt.keys()]) {
      if (key.startsWith(prefix)) this.corrupt.delete(key);
    }
    // Идущие полёты не трогаем: их результат ляжет под СВОЙ ключ с sha256,
    // по которому его никто не запросит, если содержимое сменилось.
  }

  private keyOf(source: PayloadSource): string {
    return `${source.buildId}:${source.sha256}`;
  }

  /**
   * 503, а не 409: PAYLOAD_NOT_READY по §7.3 означает «версия ещё не
   * опубликована», и клиент будет ждать её появления вечно. Расхождение байтов
   * с эталоном — НАША авария, а 503 по §2.3 повторяется с экспоненциальной
   * задержкой и алертится как отказ сервиса.
   */
  private corruptError(_source: PayloadSource): ServiceUnavailableException {
    // Идентификатор сборки наружу не отдаём: клиенту он бесполезен, а в
    // тело ошибки попадает то, что видит и пересылает пользователь.
    // Для расследования есть строка ERROR в логе и запись в payload_issues.
    return new ServiceUnavailableException({
      code: 'PAYLOAD_CORRUPT',
      message: 'Данные сборки повреждены, выдача приостановлена',
    });
  }
}
