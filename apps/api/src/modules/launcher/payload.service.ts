import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AntiFraudSeverity, AntiFraudType, PayloadIssueResult } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { v7 as uuidv7 } from 'uuid';

import { ENV, type Env } from '@common/config/env.schema';
import { CryptoService } from '@common/crypto/crypto.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';
import { PayloadsService } from '@modules/products/payloads.service';

import type { PayloadRequestDto } from './dto/payload.dto';
import { LauncherService } from './launcher.service';
import { PayloadAdmissionService } from './payload-admission.service';
import { PayloadCacheService } from './payload-cache.service';
import { PayloadIssuesService } from './payload-issues.service';

/**
 * POST /api/v1/launcher/payload — выдача зашифрованного payload'а (ТЗ §7).
 *
 * Три свойства, ради которых этот файл выглядит сложнее «прочитать и отдать»:
 *
 * 1. VERIFY-ONLY. Запрос за ДАННЫМИ не имеет права привязывать устройство и
 *    запускать оплаченный срок лицензии. Резолвер зовётся с allowFirstBind:
 *    false и touchDevice: false, и это не оптимизация, а граница: иначе
 *    противник управляет порядком собственных запросов и активирует лицензию,
 *    которую человек ещё не собирался начинать.
 *
 * 2. ПАМЯТЬ. Стриминг невозможен по контракту (GCM-тег уезжает ЗАГОЛОВКОМ,
 *    а он известен только после final()), значит тело обязано целиком лежать
 *    в памяти. Отсюда контроль допуска по байтам, single-flight и LRU.
 *
 * 3. СЛЕД. До этой таблицы после выдачи самого ценного актива системы в базе
 *    не оставалось ни строки, и антифрод по шарингу лицензии строить было
 *    не на чем.
 *
 * Чего схема НЕ делает — записано честно, потому что приукрашенное обоснование
 * становится основанием не чинить настоящую дыру: лицензиат получает открытый
 * payload всегда (он сам сгенерировал sessionKey и выводит тот же ключ), а
 * противник, терминирующий TLS, видит sessionKey в теле запроса. Шифрование
 * лишает удобства — пересылаемой ссылки и открытых байт на промежуточных
 * узлах, — но защитой контента не является.
 */

/** Ответ, готовый к отправке. Заголовки ставятся ровно как есть, без второго форматирования. */
export interface SealedPayloadResponse {
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Сборка в том виде, в каком её использует горячий путь.
 *
 * Плоская структура, собранная явно, а не строка Prisma как есть: всё, чего
 * не хватает для выдачи (нет файла, нет sha256, размер выше потолка), обязано
 * быть отсеяно ОДНИМ местом и превращено в код ошибки там же. Дальше по коду
 * не должно оставаться ни одного nullable-поля, про которое надо помнить.
 */
interface IssuableBuild {
  id: string;
  version: string;
  sha256: string;
  size: bigint;
  minLauncherVersionCode: number | null;
  bucket: string;
  objectKey: string;
}

/** Ключ однократности sessionKey. Хранится ХЕШ: сам ключ открывает содержимое ответа. */
const SESSION_KEY_PREFIX = 'payload:sk:';
/**
 * Окно, в котором повторный sessionKey считается повтором.
 *
 * Ловит не противника (он тривиально рандомизирует), а НАШ собственный отказ:
 * если в сборке загрузчика sessionKey окажется статическим — забыли вызвать
 * GenRandom, закешировали, отладочная константа уехала в релиз, — один
 * перехваченный ключ расшифровывает все будущие ответы этой сборки. Катастрофа,
 * которую иначе не заметит никто, потому что всё продолжает работать.
 */
const SESSION_KEY_WINDOW_SEC = 3600;

/** Счётчик выдач на лицензию. Окно — час, как и пороги. */
const RATE_PREFIX = 'payload:rate:';
const RATE_WINDOW_SEC = 3600;

/** Сколько просить подождать при отказе по перегрузке. */
const RETRY_AFTER_BUSY_SEC = 5;

const CLIENT_VERSION_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,4})$/;

/** Контекст попытки: наполняется по ходу и уходит в журнал при любом исходе. */
interface IssueContext {
  /**
   * Владелец лицензии. НЕ известен на входе: пользователь производен от
   * ключа, поэтому поле заполняет РЕЗОЛВЕР через trace вместе с licenseId
   * и может не заполнить вовсе (лицензия удалённого аккаунта — см.
   * LauncherResolveTrace.userId). Отсюда и необязательность: userId переехал
   * из «известно до всего» в тот же класс, что productId и licenseId.
   */
  userId?: string;
  diskId: string;
  clientVersion: string | null;
  apiKeyId: string | null;
  ip: string | null;
  requestId: string;
  productId?: string;
  licenseId?: string;
  deviceId?: string;
  buildId?: string;
  buildVersion?: string;
  sizeBytes?: number;
}

@Injectable()
export class PayloadService {
  private readonly logger = new Logger(PayloadService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly launcher: LauncherService,
    private readonly payloads: PayloadsService,
    private readonly cache: PayloadCacheService,
    private readonly admission: PayloadAdmissionService,
    private readonly issues: PayloadIssuesService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  async issue(params: {
    dto: PayloadRequestDto;
    req: FastifyRequest;
    reply: FastifyReply;
  }): Promise<SealedPayloadResponse> {
    const { dto, req, reply } = params;

    const ctx: IssueContext = {
      diskId: dto.hwid,
      clientVersion: this.header(req, 'x-client-version'),
      apiKeyId: req.apiKey?.id ?? null,
      // Доказательная ценность этого поля ровно такая, какой её делает nginx:
      // при trustProxy: true req.ip берётся из X-Forwarded-For, и пока прокси
      // не перезаписывает заголовок на $remote_addr, значение пишет сам
      // пользователь (Д15). Корреляция по IP работает ТОЛЬКО за нашим прокси —
      // считать иначе значит строить антифрод на данных противника.
      ip: req.ip ?? null,
      requestId: String(req.id ?? ''),
    };

    try {
      return await this.run(ctx, dto, reply);
    } catch (error) {
      this.setRetryAfter(reply, error);
      await this.recordDenial(ctx, error);
      throw error;
    }
  }

  // =========================================================================
  //  ОСНОВНОЙ ПУТЬ
  // =========================================================================

  private async run(
    ctx: IssueContext,
    dto: PayloadRequestDto,
    reply: FastifyReply,
  ): Promise<SealedPayloadResponse> {
    // --- 1. Лицензия и устройство: ПРОВЕРИТЬ, не привязывая ----------------
    const resolved = await this.launcher.resolveForLauncher({
      licenseKey: dto.licenseKey,
      productSlug: dto.productSlug,
      diskId: dto.hwid,
      clientVersion: ctx.clientVersion ?? undefined,
      ip: ctx.ip ?? undefined,
      // Оси счётчиков перебора ключа: сборка и адрес. Пользователя среди них
      // нет и быть не может — его больше не существует до разрешения ключа.
      source: { apiKeyId: ctx.apiKeyId, ip: ctx.ip },
      // Нужен ровно для Retry-After при 503 от порога источника.
      reply,
      allowFirstBind: false,
      touchDevice: false,
      // ctx уходит В резолвер приёмником, а не заполняется ПОСЛЕ await, и это
      // не стилистика. Все отказы по лицензии и привязке — LICENSE_EXPIRED,
      // BLOCKED, REVOKED, NOT_FOUND, NOT_BOUND, NOT_ACTIVATED, HWID_MISMATCH,
      // DEVICE_BLOCKED — бросаются ВНУТРИ резолвера, то есть присваивание
      // после await до них не доходит, и recordDenial писал бы undefined.
      // На живом прогоне так получилось 25 отказных строк из 25 с NULL в
      // license_id / device_id / product_id: половина журнала, ради которой
      // он и заводился, не соединялась ни с лицензией, ни с устройством.
      // Значения на успешном пути ровно те же, что были здесь: id продукта,
      // id лицензии и bind.deviceId ?? license.currentDeviceId. С переходом
      // на ключ через тот же приёмник приезжает и userId: он больше не
      // известен до резолвера, потому что владелец производен от лицензии.
      trace: ctx,
    });

    // --- 2. Опубликованная сборка ----------------------------------------
    const build = await this.publishedBuild(resolved.product.id, resolved.license.id);
    ctx.buildId = build.id;
    ctx.buildVersion = build.version;

    // --- 3. Порог совместимости ------------------------------------------
    this.assertClientVersion(build, ctx.clientVersion);

    // --- 4. Свежесть sessionKey и пороги выдач ----------------------------
    await this.assertFreshSessionKey(dto.sessionKey, ctx);
    await this.assertUnderHardLimit(resolved.license.id, reply);

    // --- 5. Заголовки и AAD из ОДНОГО выражения ---------------------------
    // Второго обращения к полям сборки при сборке AAD нет и быть не должно:
    // расхождение на один байт (хвостовой пробел в version из копипаста
    // в админке, hex в верхнем регистре) даёт провал GCM-тега у 100%
    // пользователей этой сборки при чистых 200 в наших логах.
    const binding = this.crypto.buildPayloadBinding({
      productSlug: dto.productSlug,
      sha256: build.sha256,
      size: build.size,
      version: build.version,
    });

    // --- 6. Допуск по памяти ---------------------------------------------
    const size = Number(build.size);
    ctx.sizeBytes = size;

    const slot = await this.admission.acquire(size);
    const gone = new AbortController();

    // Слушатель вешается НЕМЕДЛЕННО после acquire, до любой асинхронной
    // работы. Дефект Д3: клиент отваливается по своему 15-секундному таймауту,
    // пока мы стоим в очереди или читаем из хранилища; 'close' происходит
    // ОДИН раз, и подписка после него не сработает никогда — каждый оборванный
    // запуск съедал бы бюджет навсегда, а через несколько десятков обрывов
    // весь продукт получал бы 503 до перезапуска процесса.
    const onClose = (): void => {
      gone.abort(new Error('соединение закрыто клиентом'));
      slot();
    };
    reply.raw.once('close', onClose);
    // Сокет мог закрыться, пока мы стояли в очереди допуска.
    if (reply.raw.destroyed || reply.raw.writableEnded) onClose();

    try {
      // --- 7. Байты ------------------------------------------------------
      const plaintext = await this.cache.get(
        {
          buildId: build.id,
          bucket: build.bucket,
          objectKey: build.objectKey,
          // Эталон берётся из binding, а не из строки БД повторно: сверяем
          // байты РОВНО с той строкой, которая уедет в заголовок и в AAD.
          sha256: binding.headers['X-Payload-Sha256'],
          size,
        },
        // Сигнал доходит до чтения из хранилища: без него сервер продолжает
        // читать и шифровать для ушедшего клиента, тогда как байтовый бюджет
        // уже освобождён по 'close' — учёт начинает врать ровно на пике (Д4).
        { signal: gone.signal },
      ).catch((error: unknown) => {
        throw this.translateStorageFailure(error);
      });

      // Шифрование 8 МиБ для того, кто уже ушёл, — чистая трата пула libuv,
      // общего с Argon2 из логина.
      if (gone.signal.aborted) {
        throw new RequestTimeoutException({
          code: 'CLIENT_ABORTED',
          message: 'Запрос прерван клиентом',
        });
      }

      // --- 8. Шифрование -------------------------------------------------
      const sealed = await this.crypto.sealForSession(plaintext.body, dto.sessionKey, binding.aad);

      // --- 9. Счётчики и журнал ------------------------------------------
      // Счётчик крутится ТОЛЬКО на состоявшейся выдаче. Считать в него
      // отказы по перегрузке значит приближать невозвратный 429 ровно тогда,
      // когда сервер сам сбрасывает нагрузку и клиент повторяет по контракту.
      await this.countIssue(resolved.license.id, ctx);

      await this.issues.recordIssued({
        result: PayloadIssueResult.ISSUED,
        userId: ctx.userId,
        licenseId: ctx.licenseId,
        deviceId: ctx.deviceId,
        productId: ctx.productId,
        payloadBuildId: build.id,
        payloadVersion: build.version,
        diskId: ctx.diskId,
        clientVersion: ctx.clientVersion,
        apiKeyId: ctx.apiKeyId,
        ip: ctx.ip,
        sizeBytes: size,
        requestId: ctx.requestId,
      });

      return {
        headers: {
          // Заголовки X-Payload-Sha256 / Size / Version уходят ВЕРБАТИМ из
          // binding.headers — теми же строками, что вошли в AAD.
          ...binding.headers,
          'X-Payload-Nonce': sealed.iv.toString('hex'),
          'X-Payload-Tag': sealed.tag.toString('hex'),
          // У успешного ответа нет JSON-тела, поэтому при исходе
          // «расшифровалось, но sha256 не сошёлся» клиенту нечего указать
          // в отчёте по §9, а поддержке нечего искать. Доверенной ссылкой
          // на инцидент этот заголовок не является: в AAD он не входит
          // и подменяем посредником (Д28).
          'X-Request-Id': ctx.requestId,
        },
        body: sealed.ciphertext,
      };
    } catch (error) {
      // Слот освобождается немедленно: до send дело не дошло, ждать 'close'
      // незачем. Повторный вызов из слушателя безвреден — release идемпотентен.
      slot();
      throw error;
    }
  }

  // =========================================================================
  //  ШАГИ
  // =========================================================================

  /**
   * Опубликованная сборка канала STABLE.
   *
   * Разделение кодов здесь содержательное (Д25), и оно уже сделано ТИПОМ:
   * getPublishedBuild возвращает null РОВНО в одном случае — опубликованной
   * сборки в канале нет, то есть 409 PAYLOAD_NOT_READY, состояние публикации,
   * которое клиент по приложению Б ждёт и дождётся. Опубликованная сборка
   * с удалённым файлом или без эталона — НАША авария, и её тот же метод
   * отдаёт исключением 503 PAYLOAD_UNAVAILABLE, а не null: 409 там означал бы
   * «подожди» на состоянии, которое само не изменится никогда, и дежурный
   * не получил бы алерта. Поэтому PublishedPayloadBuild не имеет ни одного
   * nullable-поля, и повторять эти проверки здесь незачем.
   */
  private async publishedBuild(productId: string, licenseId: string): Promise<IssuableBuild> {
    // Сборка выбирается по лицензии: закреплённая → из тарифа → новейшая товара.
    const build = await this.payloads.getBuildForLicense(licenseId, productId);

    if (!build) {
      throw new ConflictException({
        code: 'PAYLOAD_NOT_READY',
        message: 'Сборка ещё не опубликована',
      });
    }

    // Потолок §12 отбивается при confirm-upload и publish, но проверяется
    // и здесь — как страховка. Ошибка публикации (залили дистрибутив вместо
    // payload'а) иначе обнаруживалась бы скачиванием объекта на каждый запуск
    // каждого пользователя, а не одной строкой в логе (Д26). Цена страховки —
    // одно сравнение BigInt на запрос.
    if (build.size > BigInt(this.env.PAYLOAD_MAX_BYTES)) {
      this.logger.error(
        `сборка ${build.id}: размер ${build.size} превышает потолок ${this.env.PAYLOAD_MAX_BYTES} — ` +
          'выдача остановлена до обращения к хранилищу',
      );
      throw this.unavailable();
    }

    return {
      id: build.id,
      version: build.version,
      sha256: build.sha256,
      size: build.size,
      minLauncherVersionCode: build.minLauncherVersionCode,
      bucket: build.file.bucket,
      objectKey: build.file.objectKey,
    };
  }

  /**
   * 426 UPDATE_REQUIRED.
   *
   * Порог берётся у ТОЙ сборки, чей payload выдаётся: он едет вместе с ней
   * в одной строке, и это единственный неарбитрарный ответ на вопрос «по какой
   * версии считать». NULL → проверки нет.
   *
   * Механизм СОВМЕСТИМОСТИ, а не мера безопасности: X-Client-Version полностью
   * контролируется противником, он пошлёт 999.999.9999 и обойдёт гейт за
   * секунду. Настоящий жёсткий рубеж — отзыв X-Api-Key сборки, и он существует
   * уже сегодня.
   *
   * Дефект Д14 остаётся ОТКРЫТЫМ и здесь его не закрыть: выхода из состояния
   * 426 у клиента нет (GET /launcher/update не отдаёт ни ссылки, ни файла),
   * а getPublishedBuild берёт последнюю опубликованную сборку без учёта версии
   * клиента, то есть старому загрузчику откатиться не на что. По решению
   * владельца загрузчик ВЕЧНЫЙ, minLauncherVersionCode по умолчанию NULL,
   * и ветка сегодня инертна. Заполнять поле до появления работающей доставки
   * установщика значит остановить весь парк без выхода.
   */
  private assertClientVersion(
    build: { minLauncherVersionCode: number | null },
    clientVersion: string | null,
  ): void {
    const threshold = build.minLauncherVersionCode;
    if (threshold === null) return;

    const code = this.versionCodeOf(clientVersion);

    // Отказ при отсутствующем или непарсящемся заголовке обязателен: гейт,
    // выключаемый удалением заголовка, — не гейт. Легальный клиент этого не
    // увидит, X-Client-Version отправляется транспортом всегда.
    if (code === null || code < threshold) {
      throw new HttpException(
        {
          code: 'UPDATE_REQUIRED',
          message: 'Версия загрузчика ниже минимально допустимой',
        },
        // В HttpStatus у Nest значения 426 нет.
        426,
      );
    }
  }

  /**
   * Однократность sessionKey.
   *
   * Redis недоступен → пропускаем с WARN (Д16). Fail-closed здесь был бы хуже
   * дефекта, который проверка ловит: перезапуск Redis на деплое превращался бы
   * в одновременный отказ у всех запускающихся, причём кодом 500, который
   * клиент по контракту НЕ повторяет. Трактовать ошибку Redis как попадание
   * нельзя тем более — это 400 SESSION_KEY_REUSED и CRITICAL-событие антифрода
   * всем подряд на ровном месте.
   */
  private async assertFreshSessionKey(sessionKey: string, ctx: IssueContext): Promise<void> {
    // В Redis уходит ХЕШ: сам sessionKey — ключ к содержимому ответа, и его
    // место не в кэше с allkeys-lru, дамп которого никем не считается секретом.
    const key = SESSION_KEY_PREFIX + createHash('sha256').update(sessionKey, 'utf8').digest('hex');

    let fresh: string | null;
    try {
      fresh = await this.redis.client.set(key, '1', 'EX', SESSION_KEY_WINDOW_SEC, 'NX');
    } catch (error) {
      this.logger.warn(
        `проверка свежести sessionKey пропущена, Redis недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (fresh !== null) return;

    // Идентифицируем ЛИЦЕНЗИЕЙ, а не пользователем: пользователь теперь
    // производен от ключа и у складской лицензии его нет вовсе, а лицензия
    // есть всегда — до этой строки резолвер уже отработал.
    this.logger.error(
      `повторный sessionKey по лицензии ${ctx.licenseId ?? '-'} (устройство ${ctx.deviceId ?? '-'}): ` +
        'сборка загрузчика не генерирует ключ заново — все её ответы расшифровываются одним ключом',
    );

    await this.recordFraud(AntiFraudType.RATE_LIMIT_EXCEEDED, AntiFraudSeverity.CRITICAL, ctx, {
      endpoint: 'payload',
      reason: 'session_key_reuse',
    });

    throw new BadRequestException({
      code: 'SESSION_KEY_REUSED',
      message: 'sessionKey уже использовался. Ключ обязан быть новым на каждый запрос.',
    });
  }

  /**
   * Жёсткий потолок выдач на лицензию.
   *
   * Проверка ЧИТАЕТ счётчик, а не увеличивает его: увеличение происходит
   * только на состоявшейся выдаче (см. countIssue). Иначе отвергнутые по
   * перегрузке попытки и повторы клиента съедали бы порог втрое быстрее
   * и приближали 429 — код, который по приложению Б повторять ЗАПРЕЩЕНО,
   * то есть терминальный экран у невиновного (Д19).
   */
  private async assertUnderHardLimit(licenseId: string, reply: FastifyReply): Promise<void> {
    const hard = await this.limit('limits.payload.hard_per_license_per_hour', 60);

    let count: number;
    let ttl: number;
    try {
      const key = RATE_PREFIX + licenseId;
      const [raw, seconds] = await Promise.all([
        this.redis.client.get(key),
        this.redis.client.ttl(key),
      ]);
      count = Number(raw ?? 0);
      ttl = seconds > 0 ? seconds : RATE_WINDOW_SEC;
    } catch (error) {
      // Fail-open с WARN: счётчик — инструмент наблюдения, а не рубеж
      // безопасности, и терять из-за него доступ у всех нельзя.
      this.logger.warn(
        `порог выдач не проверен, Redis недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (!Number.isFinite(count) || count < hard) return;

    void reply.header('Retry-After', String(ttl));
    throw new HttpException(
      { code: 'RATE_LIMITED', message: 'Превышен лимит запросов. Попробуйте позже.' },
      429,
    );
  }

  /**
   * Учёт состоявшейся выдачи и мягкий порог.
   *
   * Мягкий порог ВЫДАЁТ, но пишет событие антифрода: 20 запусков в час уже
   * выше любого нормального сценария, но ниже недвусмысленного перебора, и
   * правильная реакция там — наблюдать, а не отказывать. Событие пишется ровно
   * на пересечении порога: INCR атомарен, поэтому значение soft+1 увидит ровно
   * один запрос, и поток событий не забьёт таблицу.
   */
  private async countIssue(licenseId: string, ctx: IssueContext): Promise<void> {
    const key = RATE_PREFIX + licenseId;

    let count: number;
    try {
      count = await this.redis.client.incr(key);
      // EXPIRE только на первой единице: иначе окно ползёт вперёд с каждым
      // запросом и час никогда не истекает.
      if (count === 1) await this.redis.client.expire(key, RATE_WINDOW_SEC);
    } catch (error) {
      this.logger.warn(
        `счётчик выдач не обновлён, Redis недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    const soft = await this.limit('limits.payload.soft_per_license_per_hour', 20);
    if (count !== soft + 1) return;

    await this.recordFraud(AntiFraudType.RATE_LIMIT_EXCEEDED, AntiFraudSeverity.MEDIUM, ctx, {
      endpoint: 'payload',
      reason: 'soft_threshold',
      count,
      threshold: soft,
      windowSec: RATE_WINDOW_SEC,
    });
  }

  // =========================================================================
  //  ВСПОМОГАТЕЛЬНОЕ
  // =========================================================================

  /**
   * Журнальная строка на отказ.
   *
   * Пишется ДО того, как ответ уйдёт клиенту, и best-effort: сбой журнала не
   * имеет права превращать чистый 403 в 500.
   *
   * Не всякий отказ сюда доходит — и это записано, а не замаскировано.
   * ValidationPipe (400), SignatureGuard и ApiScopeGuard (403) отбивают запрос
   * ДО тела обработчика, поэтому строк DENIED_SCOPE и строк на кривой
   * sessionKey в таблице не будет никогда. С переходом на ключ к этому же
   * классу добавились отказы по НЕРАСПОЗНАННОМУ ключу: лицензии нет, значит
   * нет ни licenseId, ни productId, ни deviceId. Обещание «каждая попытка»
   * точнее читать как «каждая попытка, дошедшая до проверки лицензии» (Д29).
   */
  private async recordDenial(ctx: IssueContext, error: unknown): Promise<void> {
    const result = this.resultOf(error, ctx);
    if (result === null) return;

    await this.issues.record({
      result,
      userId: ctx.userId,
      licenseId: ctx.licenseId,
      deviceId: ctx.deviceId,
      productId: ctx.productId,
      payloadBuildId: ctx.buildId,
      payloadVersion: ctx.buildVersion,
      diskId: ctx.diskId,
      clientVersion: ctx.clientVersion,
      apiKeyId: ctx.apiKeyId,
      ip: ctx.ip,
      sizeBytes: ctx.sizeBytes ?? null,
      requestId: ctx.requestId,
    });
  }

  /**
   * Код отказа → значение в журнале.
   *
   * null означает «под этот исход в enum значения нет» — таких четыре класса,
   * и все они записаны явно:
   *   PRODUCT_NOT_FOUND — нет ни значения, ни productId, писать нечего;
   *   SESSION_KEY_REUSED — значения нет, но событие антифрода CRITICAL уже
   *     записано, то есть след не теряется;
   *   LICENSE_KEY_INVALID — ключ не распознан, лицензии нет: строка вышла бы
   *     с NULL в license_id, product_id и device_id, а под такой исход
   *     значения в enum нет. След остаётся в множестве промахов по источнику
   *     и, на пересечении порога, в anti_fraud_events;
   *   SERVICE_UNAVAILABLE от порога ИСТОЧНИКА (см. ниже).
   *
   * DENIED_SCOPE в этом switch НЕТ намеренно: проверка scope живёт в guard'е,
   * то есть отказ происходит ДО тела обработчика и сюда не доходит никогда.
   * Ветка «на будущее» здесь была бы кодом, который выглядит работающим и
   * не работает, — ровно то, чем было поле scopes до этой задачи (Д29).
   */
  private resultOf(error: unknown, ctx: IssueContext): PayloadIssueResult | null {
    const code = this.codeOf(error);
    if (code === null) return null;

    switch (code) {
      case 'LICENSE_EXPIRED':
      case 'LICENSE_BLOCKED':
      case 'LICENSE_REVOKED':
      // Ключ разрешился, но лицензия ничья: ещё не выданная или
      // лицензия удалённого аккаунта. Отдельного значения в enum нет, а
      // семейство отказа то же — «с лицензией что-то не так». Строка при этом
      // содержательна: licenseId и productId уже проставлены резолвером.
      case 'LICENSE_NOT_ASSIGNED':
        return PayloadIssueResult.DENIED_LICENSE;
      case 'HWID_MISMATCH':
      case 'DEVICE_BLOCKED':
        return PayloadIssueResult.DENIED_HWID;
      case 'LICENSE_NOT_BOUND':
        return PayloadIssueResult.DENIED_NOT_BOUND;
      case 'LICENSE_NOT_ACTIVATED':
        return PayloadIssueResult.DENIED_NOT_ACTIVATED;
      case 'PAYLOAD_NOT_READY':
        return PayloadIssueResult.DENIED_NOT_READY;
      case 'UPDATE_REQUIRED':
        return PayloadIssueResult.DENIED_UPDATE_REQUIRED;
      // Порог ВЫДАЧ на лицензию (payload:rate:<licenseId>) — единственный
      // оставшийся источник RATE_LIMITED на этом пути, и он всегда за
      // разрешённым ключом. Проверка на licenseId сохранена как страховка:
      // строка журнала без субъекта бесполезна.
      case 'RATE_LIMITED':
        return ctx.licenseId ? PayloadIssueResult.DENIED_RATE_LIMIT : null;
      // Источников SERVICE_UNAVAILABLE теперь два, и различает их наличие
      // лицензии. Допуск по памяти (PayloadAdmissionService) срабатывает
      // ПОСЛЕ разрешения ключа — это содержательная строка журнала. Порог
      // РАЗЛИЧНЫХ ПРОМАХОВ по источнику (lk:miss:<apiKeyId>:<ip>)
      // срабатывает ДО него, и писать его сюда значит дать сканеру гнать
      // по одному INSERT на запрос — ровно та нагрузка, ради отсечения
      // которой порог и живёт в Redis.
      case 'SERVICE_UNAVAILABLE':
        return ctx.licenseId ? PayloadIssueResult.DENIED_CAPACITY : null;
      case 'PAYLOAD_CORRUPT':
        return PayloadIssueResult.ERROR_CORRUPT;
      // Наша авария на стороне хранилища. Отдельно от ERROR_CORRUPT: там
      // байты разошлись с эталоном (подмена или порча объекта), здесь до
      // байтов вообще не дошло. Всплеск одного и всплеск другого требуют
      // разных действий, поэтому и колонка различает их, а не усредняет.
      case 'STORAGE_UNAVAILABLE':
      case 'PAYLOAD_UNAVAILABLE':
      case 'OBJECT_TOO_LARGE':
        return PayloadIssueResult.ERROR_STORAGE;
      default:
        return null;
    }
  }

  private codeOf(error: unknown): string | null {
    if (!(error instanceof HttpException)) return null;
    const response = error.getResponse();
    if (typeof response !== 'object' || response === null) return null;
    const code = (response as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : null;
  }

  /**
   * Retry-After на всех повторяемых исходах.
   *
   * По §2.3 клиент повторяет 502/503/504 с экспоненциальной задержкой, а
   * заголовок задаёт нижнюю границу паузы. Без него клиент повторяет сразу и
   * удваивает нагрузку ровно в момент, когда сервер её сбрасывает (Д19).
   * Заголовок, выставленный раньше (например, остаток окна лимита),
   * не перетирается.
   */
  private setRetryAfter(reply: FastifyReply, error: unknown): void {
    if (!(error instanceof HttpException)) return;
    if (error.getStatus() !== 503) return;
    if (reply.getHeader('retry-after') !== undefined) return;
    void reply.header('Retry-After', String(RETRY_AFTER_BUSY_SEC));
  }

  /**
   * Порог из настроек. Недоступность БД не должна ронять выдачу: у нас есть
   * значение по умолчанию, а 500 клиент не повторяет.
   */
  private async limit(key: string, fallback: number): Promise<number> {
    try {
      const value = await this.settings.getNumber(key, fallback);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch (error) {
      this.logger.warn(
        `настройка ${key} не прочитана, работаем по умолчанию ${fallback}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }

  /** Событие антифрода — всегда best-effort: оно не может быть причиной отказа. */
  private async recordFraud(
    type: AntiFraudType,
    severity: AntiFraudSeverity,
    ctx: IssueContext,
    details: Record<string, string | number | boolean>,
  ): Promise<void> {
    try {
      await this.prisma.antiFraudEvent.create({
        data: {
          id: uuidv7(),
          type,
          severity,
          userId: ctx.userId,
          licenseId: ctx.licenseId ?? null,
          deviceId: ctx.deviceId ?? null,
          // Колонка типа inet: мусор из подконтрольного клиенту заголовка
          // уронил бы запись на 22P02, то есть противник, шлющий кривой
          // X-Forwarded-For, отключал бы себе антифрод одной строкой.
          ip: ctx.ip !== null && isIP(ctx.ip) !== 0 ? ctx.ip : null,
          details: { ...details, requestId: ctx.requestId },
          actionTaken: 'logged_only',
        },
      });
    } catch (error) {
      this.logger.error(
        `не удалось записать событие антифрода: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Отказы хранилища → коды, которые клиент умеет обработать.
   *
   * OBJECT_NOT_FOUND отдаётся StorageService со статусом 404 — для НАШЕЙ
   * ситуации это неверный ответ дважды: клиенту сообщается «не найдено» про
   * его запрос, тогда как исчез объект опубликованной сборки, и 404 по §2.3
   * повторять не положено, хотя повторять тут как раз нужно. OBJECT_TOO_LARGE
   * приходит уже 503, но с кодом из словаря хранилища, которого нет ни в §7.3,
   * ни в приложении Б.
   *
   * STORAGE_UNAVAILABLE, CLIENT_ABORTED и PAYLOAD_CORRUPT переводить не надо:
   * они уже несут и правильный статус, и осмысленный для клиента код.
   */
  private translateStorageFailure(error: unknown): unknown {
    const code = this.codeOf(error);
    if (code !== 'OBJECT_NOT_FOUND' && code !== 'OBJECT_TOO_LARGE') return error;

    this.logger.error(
      `хранилище отказало кодом ${code}: объект опубликованной сборки недоступен или ` +
        'превышает потолок §12 — выдача остановлена',
    );
    return this.unavailable();
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'PAYLOAD_UNAVAILABLE',
      message: 'Сборка временно недоступна',
    });
  }

  private versionCodeOf(version: string | null): number | null {
    if (!version) return null;
    const m = CLIENT_VERSION_RE.exec(version);
    if (!m || !m[1] || !m[2] || !m[3]) return null;
    return Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]);
  }

  private header(req: FastifyRequest, name: string): string | null {
    const value = req.headers[name];
    if (typeof value === 'string') return value.trim() || null;
    if (Array.isArray(value)) {
      const first = value[0];
      return typeof first === 'string' ? first.trim() || null : null;
    }
    return null;
  }
}
