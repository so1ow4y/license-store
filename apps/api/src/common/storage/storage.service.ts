import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { ENV, type Env } from '../config/env.schema';

/**
 * Объектное хранилище по протоколу S3: локально RustFS, на проде любое
 * S3-совместимое (RustFS, Cloudflare R2, Backblaze B2).
 *
 * Загрузка идёт НАПРЯМУЮ в хранилище по presigned URL, минуя API. Причина
 * простая: дистрибутивы весят десятки мегабайт, и гонять их через
 * приложение значит занимать его воркер на всё время передачи и держать
 * файл в памяти процесса.
 *
 * А вот SHA-256 считает СЕРВЕР, скачав объект после загрузки. Доверять
 * хешу от клиента нельзя: загрузчик проверяет им целостность перед
 * установкой, и подставленный хеш превращает проверку в фикцию.
 *
 * Исключение из правила «наружу отдаём только ссылки» — payload по §7:
 * ссылку на него выдавать запрещено, поэтому байты обязаны пройти через
 * процесс (см. getObjectBuffer).
 */

/** TTL ссылки на загрузку. Хватает на передачу, но не на раздачу другим. */
const UPLOAD_URL_TTL_SEC = 900;

/**
 * Потолок для серверного хеширования.
 *
 * Больше этого объекта не скачиваем: хеширование гигабайтного файла
 * займёт воркер надолго. Для дистрибутивов запас многократный.
 */
const MAX_HASHABLE_BYTES = 512 * 1024 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UploadTarget {
  bucket: string;
  objectKey: string;
  url: string;
  expiresInSec: number;
}

export interface ObjectMetadata {
  size: number;
  contentType: string | null;
  etag: string | null;
}

/** Результат чтения объекта целиком в память. */
export interface ObjectBuffer {
  body: Buffer;
  size: number;
  /** SHA-256 прочитанных байт, посчитанный ТЕМ ЖЕ проходом — второй обход не нужен. */
  sha256: string;
  contentType: string | null;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;

  readonly bucketReleases: string;
  /**
   * Бакет payload'а §7. Отдельный от releases: payload нельзя ни кэшировать,
   * ни отдавать по ссылке, а на releases presigned-ссылки выдаются.
   */
  readonly bucketPayloads: string;

  /**
   * Клиент только для подписи ссылок, отдаваемых наружу. Сам сервер ходит в
   * хранилище по внутреннему имени сети (s3:9000), а подпись считается по
   * хосту из ссылки — поэтому для браузера нужен свой адрес
   * (S3_PUBLIC_ENDPOINT). Не задан — роли совпадают, как в разработке.
   */
  private readonly signer: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.bucketReleases = env.S3_BUCKET_RELEASES;
    this.bucketPayloads = env.S3_BUCKET_PAYLOADS;

    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      // Path-style: bucket в пути, а не в поддомене. Понимают все
      // S3-совместимые хранилища, поэтому значение по умолчанию — true.
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      // Таймауты ОБЯЗАТЕЛЬНЫ. По умолчанию @smithy/node-http-handler ставит
      // requestTimeout = 0, то есть «ждать вечно»: хранилище, которое
      // принимает TCP-соединение и перестаёт отвечать (сетевой раздел,
      // переполненный диск, зависший узел), навсегда подвешивает вызывающего.
      // Для payload это особенно дорого: кэш хранит Promise, и один
      // повисший лидер single-flight убивает выдачу до перезапуска процесса,
      // причём /health/ready при этом зелёный.
      //
      // Объект передаётся простой структурой, а не экземпляром NodeHttpHandler:
      // SDK сам сконструирует свой обработчик, и @smithy/node-http-handler
      // не приходится тянуть в прямые зависимости.
      requestHandler: {
        connectionTimeout: env.S3_CONNECT_TIMEOUT_MS,
        requestTimeout: env.S3_REQUEST_TIMEOUT_MS,
      },
    });

    // Подписывающий клиент сетевых запросов не делает — таймауты ему не нужны.
    this.signer = env.S3_PUBLIC_ENDPOINT
      ? new S3Client({
          endpoint: env.S3_PUBLIC_ENDPOINT,
          region: env.S3_REGION,
          credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : this.client;
  }

  /**
   * Создаёт недостающие бакеты и разрешает браузеру сайта загрузку в них
   * (CORS только на PUT: админ заливает сборки по presigned-ссылке; читать
   * из браузера нечего). Оба бакета приватные: политик анонимного доступа
   * мы не ставим. Недоступное хранилище не роняет старт — без S3 не работают
   * лишь загрузка сборок и выдача payload.
   */
  async onModuleInit(): Promise<void> {
    for (const bucket of [this.bucketReleases, this.bucketPayloads]) {
      if (await this.ensureBucket(bucket)) await this.allowBrowserUploads(bucket);
    }
  }

  private async ensureBucket(bucket: string): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) {
        this.logger.warn(`хранилище недоступно (${bucket}): ${errorMessage(error)}`);
        return false;
      }
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      this.logger.log(`создан бакет ${bucket}`);
      return true;
    } catch (error) {
      this.logger.warn(`не удалось создать бакет ${bucket}: ${errorMessage(error)}`);
      return false;
    }
  }

  private async allowBrowserUploads(bucket: string): Promise<void> {
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [this.env.FRONTEND_URL.replace(/\/+$/, '')],
                AllowedMethods: ['PUT'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error) {
      this.logger.warn(`CORS для бакета ${bucket} не выставлен: ${errorMessage(error)}`);
    }
  }

  /** Ссылка для прямой загрузки объекта клиентом. */
  async createUploadUrl(params: {
    bucket: string;
    objectKey: string;
    contentType: string;
  }): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.objectKey,
        ContentType: params.contentType,
      }),
      { expiresIn: UPLOAD_URL_TTL_SEC },
    );

    return {
      bucket: params.bucket,
      objectKey: params.objectKey,
      url,
      expiresInSec: UPLOAD_URL_TTL_SEC,
    };
  }

  async head(
    bucket: string,
    objectKey: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ObjectMetadata | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }), {
        abortSignal: opts?.signal,
      });
      return {
        size: Number(res.ContentLength ?? 0),
        contentType: res.ContentType ?? null,
        etag: res.ETag?.replace(/"/g, '') ?? null,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotFound' || name === 'NoSuchKey') return null;
      throw error;
    }
  }

  /**
   * SHA-256 объекта, посчитанный сервером.
   *
   * Потоково, без загрузки файла целиком в память: дистрибутив в сотню
   * мегабайт не должен раздувать процесс на эту сотню.
   */
  async computeSha256(bucket: string, objectKey: string): Promise<{ sha256: string; size: number }> {
    const meta = await this.head(bucket, objectKey);
    if (!meta) {
      throw new Error(`объект ${bucket}/${objectKey} не найден`);
    }

    if (meta.size > MAX_HASHABLE_BYTES) {
      throw new Error(
        `объект ${objectKey} размером ${meta.size} байт превышает предел хеширования`,
      );
    }

    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    const stream = res.Body as Readable | undefined;

    if (!stream) {
      throw new Error(`пустой поток для ${bucket}/${objectKey}`);
    }

    const hash = createHash('sha256');
    let size = 0;

    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      size += buf.length;
      hash.update(buf);
    }

    return { sha256: hash.digest('hex'), size };
  }

  /**
   * Прочитать объект целиком в память вместе с его SHA-256.
   *
   * Единственный способ доставить payload по §7: presigned-ссылка запрещена,
   * стриминг невозможен по контракту (GCM-тег уезжает ЗАГОЛОВКОМ, а он
   * известен только после final()). Значит байты обязаны пройти через
   * процесс — и ровно поэтому у метода жёсткие рамки по времени и размеру.
   *
   * maxBytes проверяется ДВАЖДЫ: по метаданным до скачивания и бегущим
   * счётчиком во время чтения. ContentLength приходит от хранилища и сам по
   * себе не доверенный, а набирать 8 МиБ в память, чтобы потом их
   * выбросить, — ровно тот отказ в обслуживании, от которого кап и стоит.
   *
   * signal — необязательный сигнал вызывающего (обрыв соединения клиента).
   * Без него сервер продолжает читать и шифровать для того, кто уже ушёл,
   * а байтовый бюджет допуска при этом уже освобождён по 'close' — учёт
   * начинает врать ровно на пике.
   */
  async getObjectBuffer(
    bucket: string,
    objectKey: string,
    opts: { maxBytes: number; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<ObjectBuffer> {
    return this.readObject(bucket, objectKey, opts.maxBytes, opts.signal, opts.timeoutMs);
  }

  private async readObject(
    bucket: string,
    objectKey: string,
    maxBytes: number,
    external?: AbortSignal,
    timeoutMs?: number,
  ): Promise<ObjectBuffer> {
    // Общий дедлайн на ВСЮ операцию: head + get + цикл чтения тела.
    // requestTimeout у smithy закрывает только обмен с сокетом до получения
    // ответа и не покрывает вычитывание стрима — то есть хранилище, отдающее
    // по байту в минуту, проходит мимо него незамеченным.
    const timeout = AbortSignal.timeout(timeoutMs ?? this.env.S3_READ_DEADLINE_MS);
    const signal = external ? AbortSignal.any([timeout, external]) : timeout;

    try {
      const meta = await this.head(bucket, objectKey, { signal });
      if (!meta) {
        throw new NotFoundException({
          code: 'OBJECT_NOT_FOUND',
          message: `Объект ${bucket}/${objectKey} не найден`,
        });
      }

      if (meta.size > maxBytes) {
        throw this.tooLarge(bucket, objectKey, meta.size, maxBytes);
      }

      const res = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
        { abortSignal: signal },
      );
      const stream = res.Body as Readable | undefined;
      if (!stream) {
        throw new Error(`пустой поток для ${bucket}/${objectKey}`);
      }

      // Между HEAD и GET объект могли перезалить, поэтому длину берём из
      // ответа GET, а не из метаданных, прочитанных раньше.
      const declared = Number(res.ContentLength ?? meta.size);
      if (declared > maxBytes) {
        stream.destroy();
        throw this.tooLarge(bucket, objectKey, declared, maxBytes);
      }

      const hash = createHash('sha256');
      const chunks: Buffer[] = [];
      let total = 0;

      // Сам по себе for await об отмене ничего не знает: сигнал обязан
      // РАЗРУШИТЬ поток, иначе дедлайн истечёт, а чтение продолжится.
      const onAbort = () => stream.destroy(this.abortError(signal));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });

      try {
        for await (const chunk of stream) {
          const buf = chunk as Buffer;
          total += buf.length;
          if (total > maxBytes) {
            // Рвём соединение прямо здесь, а не дочитываем до конца:
            // смысл капа в том, чтобы лишние байты не оказались в памяти.
            stream.destroy();
            throw this.tooLarge(bucket, objectKey, total, maxBytes);
          }
          chunks.push(buf);
          hash.update(buf);
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }

      // Обрыв в середине отдачи выглядит как нормально завершившийся поток
      // с коротким телом. Без этой сверки недочитанный объект уехал бы
      // дальше как «не сошёлся SHA-256», то есть транспортный сбой
      // диагностировался бы как порча данных в хранилище.
      if (total !== declared) {
        throw new Error(
          `объект ${bucket}/${objectKey} прочитан не полностью: ${total} из ${declared} байт`,
        );
      }

      return {
        body: Buffer.concat(chunks, total),
        size: total,
        sha256: hash.digest('hex'),
        contentType: res.ContentType ?? null,
      };
    } catch (error) {
      throw this.translateReadFailure(error, bucket, objectKey, external);
    }
  }

  /**
   * 503, а не 500: объект больше потолка §12 — это ошибка публикации,
   * которую чинит человек, но клиент по §2.3 повторяет только 5xx из
   * списка 502/503/504, а неизвестный 500 показывает как терминальную
   * «неизвестную ошибку» и не повторяет вообще.
   */
  private tooLarge(
    bucket: string,
    objectKey: string,
    size: number,
    maxBytes: number,
  ): ServiceUnavailableException {
    this.logger.error(
      `объект ${bucket}/${objectKey}: ${size} байт при потолке ${maxBytes} — выдача остановлена`,
    );
    return new ServiceUnavailableException({
      code: 'OBJECT_TOO_LARGE',
      message: 'Объект превышает допустимый размер',
    });
  }

  /** Причина отмены в виде Error — DOMException от AbortSignal.timeout сохраняется как есть. */
  private abortError(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    return reason instanceof Error ? reason : new Error('чтение объекта прервано');
  }

  /**
   * Любой отказ чтения превращается в код, который клиент умеет обработать.
   *
   * Без этого недоступность хранилища прилетает в AllExceptionsFilter как
   * неизвестное исключение и становится 500 — терминальным для загрузчика,
   * хотя авария транзиентная и повтор через секунду сработал бы.
   */
  private translateReadFailure(
    error: unknown,
    bucket: string,
    objectKey: string,
    external?: AbortSignal,
  ): Error {
    // Наши собственные 404/503 уже несут нужный код.
    if (error instanceof NotFoundException || error instanceof ServiceUnavailableException) {
      return error;
    }

    // Отмена вызывающим — это ушедший клиент, а не наша авария: ответ уже
    // никто не читает, поэтому в ERROR-лог это писать нельзя, иначе обрывы
    // на мобильном интернете превращаются в поток ложных алертов.
    if (external?.aborted) {
      this.logger.warn(`чтение ${bucket}/${objectKey} прервано вызывающим`);
      return new RequestTimeoutException({
        code: 'CLIENT_ABORTED',
        message: 'Запрос прерван клиентом',
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`чтение ${bucket}/${objectKey} не удалось: ${message}`);
    return new ServiceUnavailableException({
      code: 'STORAGE_UNAVAILABLE',
      message: 'Хранилище временно недоступно',
    });
  }

  async delete(bucket: string, objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  }

  /**
   * Ключ объекта для релиза.
   *
   * Версия входит в путь, поэтому перезалить файл поверх существующего
   * релиза случайно нельзя — а именно так ломается проверка целостности
   * у тех, кто уже скачал.
   */
  buildReleaseKey(productSlug: string, version: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
    return `releases/${productSlug}/${version}/${safe}`;
  }

  /**
   * Ключ объекта для payload'а §7.
   *
   * Отдельное пространство имён в отдельном бакете, поэтому спутать payload
   * с дистрибутивом §8 нельзя даже по ключу.
   *
   * Санируются ВСЕ три сегмента, а не только filename, как в
   * buildReleaseKey: version у PayloadBuild — свободная строка из админки,
   * и '..' или '/' в ней уехали бы прямо в ключ объекта. Проверка префикса
   * в confirm-upload это не поймает — она считает ожидаемый префикс из той
   * же версии и совпадёт сама с собой.
   */
  buildPayloadKey(productSlug: string, version: string, filename: string): string {
    const slug = this.safeSegment(productSlug, 'productSlug');
    const ver = this.safeSegment(version, 'version');
    const safe = this.safeSegment(filename, 'filename', 128);
    return `payloads/${slug}/${ver}/${safe}`;
  }

  /**
   * Пустой сегмент — это отказ, а не «payloads//1.2.0/файл»: ключ с пустым
   * сегментом валиден для S3 и молча создаёт вторую форму записи того же
   * пути, по которой потом не находится объект.
   */
  private safeSegment(value: string, field: string, maxLength = 64): string {
    const safe = value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, maxLength);
    if (safe.length === 0 || safe === '.' || safe === '..') {
      throw new InternalServerErrorException({
        code: 'INVALID_OBJECT_KEY',
        message: `Недопустимое значение ${field} для ключа объекта`,
      });
    }
    return safe;
  }
}
