import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FileStorage, Prisma, type PayloadBuild, ReleaseChannel } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { ENV, type Env } from '@common/config/env.schema';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import {
  anyContains,
  queryCondition,
  textMatch,
  timeRange,
  whereClause,
  type QueryTerm,
} from '@common/search/query';
import { StorageService } from '@common/storage/storage.service';

import { BUILD_NAME_RE, PAYLOAD_VERSION_RE } from './dto/payloads.dto';
import { VersionsService } from './versions.service';

/** Поля поиска по хранилищу сборок. */
export const BUILD_FIELDS = ['name', 'version', 'status', 'plan', 'id'] as const;

/** Состояние сборки в хранилище. */
export type BuildStatus = 'draft' | 'ready' | 'published' | 'unpublished';

const BUILD_STATUS_SQL: Record<BuildStatus, Prisma.Sql> = {
  draft: Prisma.sql`b.file_id IS NULL`,
  ready: Prisma.sql`b.file_id IS NOT NULL AND b.published_at IS NULL`,
  published: Prisma.sql`b.is_published`,
  unpublished: Prisma.sql`NOT b.is_published AND b.published_at IS NOT NULL`,
};

function buildStatus(build: Pick<PayloadBuild, 'fileId' | 'isPublished' | 'publishedAt'>): BuildStatus {
  if (build.isPublished) return 'published';
  if (build.publishedAt) return 'unpublished';
  return build.fileId ? 'ready' : 'draft';
}

/**
 * Сборки payload'а §7 — админская поверхность.
 *
 * Payload — артефакт ПРОДУКТА, поэтому живёт в ProductsModule, а не
 * в LauncherModule: границы модулей проходят по владельцу данных, а не
 * по тому, кто их читает. Читает же его горячий путь загрузчика, ради
 * которого здесь и есть единственный не-админский метод
 * getPublishedBuild().
 *
 * Отдельная сущность, а не поле у ProductVersion: слот артефакта у версии
 * ровно один и занят дистрибутивом §8, а publish() версии ТРЕБУЕТ fileId
 * релиза (versions.service.ts:329-334). На общей строке новый payload
 * нельзя выкатить, не выпустив новый exe и не заставив всех
 * переустановиться.
 *
 * Поток загрузки повторяет versions.service дословно (черновик →
 * presigned PUT → подтверждение с серверным подсчётом sha256 →
 * публикация) — с ОДНИМ содержательным отличием, ради которого этот файл
 * и написан отдельно: публикация делает запись неизменяемой. Подробности
 * в assertMutable().
 */

/**
 * Канал инвалидации кэша открытых байт в репликах.
 *
 * Тот же приём, что у settings.service.ts:25 ('settings:invalidate'):
 * pub/sub Redis доставляет at-most-once, поэтому у подписчика обязан быть
 * страховочный TTL — реплика, переподключавшаяся в момент публикации,
 * сообщение теряет молча.
 */
export const PAYLOAD_INVALIDATION_CHANNEL = 'payload:invalidate';

/** Эталонный sha256 в каноническом виде: 64 hex НИЖНЕГО регистра. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Объект хранилища под опубликованной сборкой — ровно то, что нужно выдаче. */
export interface PayloadBuildObject {
  id: string;
  bucket: string;
  objectKey: string;
}

/**
 * Сборка, которую МОЖНО выдать: файл есть, эталон есть, объект не помечен
 * удалённым.
 *
 * Гарантии вынесены в тип намеренно. Если бы метод отдавал сырую строку
 * с `sha256: string | null`, каждый вызывающий на горячем пути писал бы
 * собственную проверку — и однажды написал бы её иначе.
 */
export type PublishedPayloadBuild = Omit<PayloadBuild, 'fileId' | 'sha256' | 'size'> & {
  fileId: string;
  sha256: string;
  size: bigint;
  file: PayloadBuildObject;
};

@Injectable()
export class PayloadsService {
  private readonly logger = new Logger(PayloadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // =========================================================================
  //  СОЗДАНИЕ И ЗАГРУЗКА
  // =========================================================================

  /** Черновик сборки. Файла и публикации ещё нет. */
  async createDraft(
    params: {
      productId: string;
      version: string;
      name?: string;
      channel?: ReleaseChannel;
      minLauncherVersion?: string;
    },
    actorId: string,
  ) {
    const name = params.name?.trim() || params.version;
    this.assertName(name);
    const product = await this.prisma.product.findUnique({
      where: { id: params.productId },
      select: { id: true, slug: true },
    });

    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Продукт не найден' });
    }

    const channel = params.channel ?? ReleaseChannel.STABLE;

    // Канал, отличный от STABLE, отвергается НА СОЗДАНИИ, а не на публикации.
    //
    // Уникальность у сборки — (product_id, version) БЕЗ канала, а читающий
    // путь фильтрует STABLE жёстко (channel в теле §7 не приходит). То есть
    // черновик 1.5.0 в BETA сжигает номер 1.5.0 и в STABLE, а доставить его
    // нельзя ничем. Отказ на публикации оставил бы админа в ловушке: номер
    // уже занят, а маршрута удаления черновика нет. Когда канал войдёт
    // в уникальный ключ и в запрос загрузчика, отсюда уходит один if.
    if (channel !== ReleaseChannel.STABLE) {
      throw new BadRequestException({
        code: 'CHANNEL_NOT_SUPPORTED',
        message:
          'Сегодня выдаётся только канал STABLE: уникальность версии канал не учитывает, ' +
          'и сборка в другом канале заняла бы номер, оставшись недоставляемой',
      });
    }

    // Формула версии одна на обе оси (продукт и payload) и живёт
    // в VersionsService: две копии «major*1_000_000 + …» разошлись бы
    // ровно тогда, когда кто-то расширит формат до четырёх цифр patch.
    const versionCode = VersionsService.toVersionCode(params.version);

    const exists = await this.prisma.payloadBuild.findUnique({
      where: { productId_version: { productId: params.productId, version: params.version } },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Сборка payload с таким номером версии у этого продукта уже есть',
      });
    }
    await this.assertNameFree(params.productId, name);

    const minLauncherVersionCode = params.minLauncherVersion
      ? VersionsService.toVersionCode(params.minLauncherVersion)
      : null;

    const created = await this.prisma.payloadBuild.create({
      data: {
        id: uuidv7(),
        productId: params.productId,
        version: params.version,
        name,
        versionCode,
        channel,
        minLauncherVersionCode,
        isPublished: false,
        createdById: actorId,
      },
    });

    if (minLauncherVersionCode !== null) {
      // Не отказ, но и не молчание: порог включает 426 UPDATE_REQUIRED, а
      // выхода из него сегодня нет — /launcher/update отдаёт только номер
      // версии, без ссылки на установщик, и загрузчик по решению владельца
      // вечный. Каждый клиент ниже порога встанет намертво до правки этого
      // поля в БД.
      this.logger.warn(
        `сборка payload ${params.version}: задан порог загрузчика ${minLauncherVersionCode} — ` +
          'клиенты ниже него получат 426 без возможности обновиться',
      );
    }

    await this.audit.record({
      action: 'payload.create',
      actorId,
      actorType: 'USER',
      entityType: 'payload_build',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  /**
   * Ссылка для прямой загрузки payload'а в хранилище — только на ЗАГРУЗКУ:
   * ссылки на скачивание payload запрещены §7.1, и метода для них нет.
   */
  async requestUpload(
    buildId: string,
    params: { filename: string; contentType?: string },
    actorId: string,
  ) {
    const build = await this.prisma.payloadBuild.findUnique({
      where: { id: buildId },
      include: { product: { select: { slug: true } } },
    });

    if (!build) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Сборка payload не найдена' });
    }

    this.assertMutable(build);

    const bucket = this.storage.bucketPayloads;
    const objectKey = this.storage.buildPayloadKey(
      build.product.slug,
      build.version,
      params.filename,
    );

    await this.prisma.$transaction(async (tx) => {
      // Эталон сборки снимается ВМЕСТЕ с выдачей ссылки, а не при
      // подтверждении. Иначе между «запросил ссылку» и «подтвердил» строка
      // сборки ссылается на sha256 от предыдущего содержимого того же
      // ключа, и publish в этом окне выпустил бы сборку, которую горячий
      // путь отвергнет как 503 PAYLOAD_CORRUPT — то есть ошибка админа
      // превратилась бы в аварию у пользователей.
      //
      // Условие publishedAt: null стоит в WHERE, а не только в проверке
      // выше: параллельный publish успевает пройти между чтением строки
      // и записью, и тогда ссылка на перезапись объекта была бы выдана
      // уже опубликованной сборке.
      const applied = await tx.payloadBuild.updateMany({
        where: { id: buildId, publishedAt: null },
        data: { fileId: null, sha256: null, size: null },
      });

      if (applied.count === 0) {
        throw this.alreadyPublished();
      }

      await tx.file.upsert({
        where: { bucket_objectKey: { bucket, objectKey } },
        // Повторный запрос ссылки на тот же ключ означает перезалив: старые
        // размер и хеш относятся к байтам, которых сейчас уже нет.
        update: {
          uploadedById: actorId,
          deletedAt: null,
          size: 0,
          sha256: '0'.repeat(64),
          isPublic: false,
        },
        create: {
          id: uuidv7(),
          storage: FileStorage.S3,
          bucket,
          objectKey,
          originalName: params.filename,
          mimeType: params.contentType ?? 'application/octet-stream',
          size: 0,
          // Заглушка до подтверждения: настоящий хеш посчитает сервер.
          sha256: '0'.repeat(64),
          // Для payload — всегда приватный, независимо от бакета: публичный
          // объект раздаётся напрямую с CDN, что §7.1 запрещает прямо.
          isPublic: false,
          uploadedById: actorId,
        },
      });
    });

    // Подпись ссылки — после транзакции и намеренно: createUploadUrl не
    // ходит в сеть, зато выданная ссылка живёт 15 минут и позволяет
    // перезаписать объект. Выдавать её раньше, чем состояние в БД
    // согласовано, значит выдать право на перезапись при откате.
    const target = await this.storage.createUploadUrl({
      bucket,
      objectKey,
      contentType: params.contentType ?? 'application/octet-stream',
    });

    return {
      uploadUrl: target.url,
      expiresInSec: target.expiresInSec,
      bucket: target.bucket,
      objectKey,
    };
  }

  /**
   * Подтверждение загрузки: сервер сам читает объект, считает SHA-256
   * и размер и записывает их в сборку.
   *
   * Хеш от клиента не принимается ни в каком виде — именно им загрузчик
   * проверяет целостность расшифрованного payload'а по §7.2.3, и
   * подставленный эталон превратил бы проверку в фикцию.
   */
  async confirmUpload(buildId: string, objectKey: string, actorId: string) {
    const build = await this.prisma.payloadBuild.findUnique({
      where: { id: buildId },
      include: { product: { select: { slug: true } } },
    });

    if (!build) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Сборка payload не найдена' });
    }

    this.assertMutable(build);

    const bucket = this.storage.bucketPayloads;

    // Ключ из тела сверяется с ожидаемым префиксом. Без этого подтвердить
    // можно ЛЮБОЙ объект бакета — ровно то, что делает сегодня
    // versions.confirmUpload (versions.service.ts:193-214), принимающий
    // objectKey как есть.
    const prefix = this.expectedKeyPrefix(build.product.slug, build.version);
    const filename = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : null;
    if (filename === null || filename.length === 0 || filename.includes('/')) {
      throw new BadRequestException({
        code: 'INVALID_OBJECT_KEY',
        message: `Ключ объекта должен иметь вид ${prefix}<имя файла>`,
      });
    }

    const maxBytes = this.env.PAYLOAD_MAX_BYTES;

    const meta = await this.storage.head(bucket, objectKey);
    if (!meta || meta.size === 0) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Файл не найден в хранилище или пуст',
      });
    }

    // Потолок §12 проверяется ЗДЕСЬ, до чтения объекта, а не только на
    // горячем пути (Д26). Иначе перепутанный бакетом дистрибутив на 40 МБ
    // проходит подтверждение и публикацию, а падает у КАЖДОГО пользователя
    // при каждом запуске — ошибка администратора, которую видит не
    // администратор. Заодно это защищает и сам этот запрос: хешировать
    // 500 МБ, чтобы потом их отвергнуть, незачем.
    if (meta.size > maxBytes) {
      throw this.tooLarge(meta.size, maxBytes);
    }

    // Строки files может не быть, если ключ подтверждают, не запросив
    // ссылку. Явный 400 вместо P2025 из update: 500 на действие
    // администратора не сообщает ему, что делать.
    const file = await this.prisma.file.findUnique({
      where: { bucket_objectKey: { bucket, objectKey } },
      select: { id: true },
    });

    if (!file) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Загрузка по этому ключу не запрашивалась — сначала получите ссылку',
      });
    }

    const { sha256, size } = await this.storage.computeSha256(bucket, objectKey);

    // Объект мог вырасти между HEAD и чтением: проверка по метаданным
    // и проверка по фактически прочитанным байтам — разные проверки.
    if (size > maxBytes) {
      throw this.tooLarge(size, maxBytes);
    }
    if (size === 0) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Файл в хранилище пуст',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.file.update({
        where: { id: file.id },
        data: {
          sha256,
          size: BigInt(size),
          mimeType: meta.contentType ?? 'application/octet-stream',
          isPublic: false,
          deletedAt: null,
        },
      });

      // Условие publishedAt: null стоит в WHERE, а не только в проверке
      // выше: между чтением строки и записью параллельный publish успевает
      // пройти, и тогда подмена файла у опубликованной сборки прошла бы
      // мимо всех наших отказов. Транзакция откатывает и правку files.
      const applied = await tx.payloadBuild.updateMany({
        where: { id: buildId, publishedAt: null },
        data: { fileId: file.id, sha256, size: BigInt(size) },
      });

      if (applied.count === 0) {
        throw this.alreadyPublished();
      }

      return tx.payloadBuild.findUniqueOrThrow({ where: { id: buildId } });
    });

    this.logger.log(
      `payload ${build.version}: файл подтверждён, ${size} байт, sha256=${sha256.slice(0, 12)}…`,
    );

    await this.audit.record({
      action: 'payload.upload_confirm',
      actorId,
      actorType: 'USER',
      entityType: 'payload_build',
      entityId: buildId,
      after: { bucket, objectKey, sha256, size },
    });

    return updated;
  }

  // =========================================================================
  //  ПУБЛИКАЦИЯ
  // =========================================================================

  /**
   * Публикация сборки: с этого момента её выдаёт загрузчик.
   *
   * Здесь же — последний рубеж перед горячим путём. Всё, что можно
   * проверить один раз у администратора, проверяется один раз
   * у администратора, а не миллион раз у пользователей.
   */
  async publish(buildId: string, actorId: string) {
    const build = await this.prisma.payloadBuild.findUnique({
      where: { id: buildId },
      include: {
        file: { select: { id: true, bucket: true, objectKey: true, deletedAt: true } },
      },
    });

    if (!build) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Сборка payload не найдена' });
    }

    if (build.isPublished) {
      throw new ConflictException({
        code: 'ALREADY_PUBLISHED',
        message: 'Сборка уже опубликована',
      });
    }

    // Дубль проверки из createDraft: строка могла появиться до неё или
    // мимо API (сид, ручной SQL). Опубликованная сборка в недоставляемом
    // канале не даёт ни одной диагностики — эндпоинт отвечает
    // 409 PAYLOAD_NOT_READY, как будто ничего не публиковали.
    if (build.channel !== ReleaseChannel.STABLE) {
      throw new ConflictException({
        code: 'CHANNEL_NOT_SUPPORTED',
        message: `Канал ${build.channel} сегодня не доставляется загрузчику`,
      });
    }

    if (!build.fileId || !build.sha256 || build.size === null) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Сначала загрузите и подтвердите файл payload’а',
      });
    }

    // Канонический вид эталона проверяется на публикации, а не на выдаче.
    // sha256 и version уходят в заголовки X-Payload-* И в AAD; значение,
    // отличающееся от канонического хотя бы регистром, ломает GCM-тег
    // у всех пользователей сборки и не оставляет на сервере ни следа.
    // Своим confirmUpload мы кладём канон всегда — но строку могли
    // отредактировать SQL-ом, а цена ошибки здесь несопоставима с ценой
    // двух регулярок.
    if (!SHA256_HEX_RE.test(build.sha256)) {
      throw new ConflictException({
        code: 'INVALID_SHA256',
        message: 'Эталонный sha256 не в каноническом виде (64 hex нижнего регистра)',
      });
    }

    if (!PAYLOAD_VERSION_RE.test(build.version)) {
      throw new ConflictException({
        code: 'INVALID_VERSION',
        message: 'Номер версии не в каноническом виде major.minor.patch',
      });
    }

    if (build.size <= 0n) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'У сборки нулевой размер — подтвердите загрузку заново',
      });
    }

    // Потолок §12 повторяется на публикации: между confirm и publish поле
    // могли поправить, а порог мог опуститься настройкой окружения.
    const maxBytes = this.env.PAYLOAD_MAX_BYTES;
    if (build.size > BigInt(maxBytes)) {
      throw this.tooLarge(Number(build.size), maxBytes);
    }

    if (!build.file || build.file.deletedAt !== null) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Файл сборки удалён — загрузите и подтвердите его заново',
      });
    }

    // Один HEAD в хранилище: он ловит ровно тот случай, который иначе
    // становится 503 у каждого пользователя, — объект удалили или
    // перезалили другим содержимым после подтверждения. Сверять хеш
    // повторно незачем: расхождение размера уже означает другие байты,
    // а совпадение размера при других байтах поймает сверка на выдаче.
    const meta = await this.storage.head(build.file.bucket, build.file.objectKey);
    if (!meta) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Объект сборки отсутствует в хранилище',
      });
    }
    if (BigInt(meta.size) !== build.size) {
      throw new ConflictException({
        code: 'PAYLOAD_OBJECT_MISMATCH',
        message: `Объект в хранилище (${meta.size} байт) не совпадает с подтверждённым (${build.size}) — подтвердите загрузку заново`,
      });
    }

    const applied = await this.prisma.payloadBuild.updateMany({
      where: { id: buildId, isPublished: false },
      data: {
        isPublished: true,
        // publishedAt ставится ОДИН раз и дальше не меняется: это маркер
        // неизменяемости записи (см. assertMutable), и unpublish его не
        // снимает. Повторная публикация той же строки — это возврат в строй
        // того же содержимого, а не новый выпуск.
        publishedAt: build.publishedAt ?? new Date(),
      },
    });

    if (applied.count === 0) {
      throw new ConflictException({
        code: 'ALREADY_PUBLISHED',
        message: 'Сборка уже опубликована',
      });
    }

    const published = await this.prisma.payloadBuild.findUniqueOrThrow({ where: { id: buildId } });

    if (published.minLauncherVersionCode !== null) {
      this.logger.warn(
        `payload ${published.version} опубликован с порогом загрузчика ` +
          `${published.minLauncherVersionCode}: клиенты ниже порога встанут на 426`,
      );
    }

    this.logger.log(`опубликован payload ${published.version} (${published.size} байт)`);

    await this.invalidate(buildId);

    await this.audit.record({
      action: 'payload.publish',
      actorId,
      actorType: 'USER',
      entityType: 'payload_build',
      entityId: buildId,
      before: build,
      after: published,
    });

    return published;
  }

  /**
   * Снятие с публикации.
   *
   * Файл и эталон при этом НЕ становятся изменяемыми обратно — см.
   * assertMutable. Снять с публикации значит «перестать выдавать», а не
   * «открыть запись на правку».
   */
  async unpublish(buildId: string, actorId: string) {
    const before = await this.prisma.payloadBuild.findUnique({ where: { id: buildId } });

    if (!before) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Сборка payload не найдена' });
    }

    const after = await this.prisma.payloadBuild.update({
      where: { id: buildId },
      data: { isPublished: false },
    });

    this.logger.log(`payload ${after.version} снят с публикации`);

    await this.invalidate(buildId);

    await this.audit.record({
      action: 'payload.unpublish',
      actorId,
      actorType: 'USER',
      entityType: 'payload_build',
      entityId: buildId,
      before,
      after,
    });

    return after;
  }

  /**
   * Переименование. Название — только для людей (в контракт загрузчика уходит
   * version), поэтому менять его можно и у опубликованной сборки.
   */
  async rename(buildId: string, rawName: string, actorId: string) {
    const name = rawName.trim();
    this.assertName(name);
    const build = await this.prisma.payloadBuild.findUnique({ where: { id: buildId } });
    if (!build) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Сборка payload не найдена' });
    if (build.name === name) return build;
    await this.assertNameFree(build.productId, name, buildId);

    const after = await this.prisma.payloadBuild.update({ where: { id: buildId }, data: { name } });
    await this.audit.record({
      action: 'payload.rename',
      actorId,
      actorType: 'USER',
      entityType: 'payload_build',
      entityId: buildId,
      before: { name: build.name },
      after: { name },
    });
    return after;
  }

  // =========================================================================
  //  ТАРИФЫ И ЛИЦЕНЗИИ
  // =========================================================================

  /** Заменить набор сборок тарифа. Все сборки — того же товара. */
  async setPlanBuilds(planId: string, buildIds: string[], actorId: string) {
    const plan = await this.prisma.licensePlan.findUnique({
      where: { id: planId },
      select: { id: true, productId: true, builds: { select: { buildId: true } } },
    });
    if (!plan) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Тариф не найден' });

    const unique = [...new Set(buildIds)];
    const found = await this.prisma.payloadBuild.count({ where: { id: { in: unique }, productId: plan.productId } });
    if (found !== unique.length) {
      throw new BadRequestException({ code: 'BUILD_OF_OTHER_PRODUCT', message: 'Сборки должны быть из хранилища этого товара' });
    }

    await this.prisma.$transaction([
      this.prisma.planBuild.deleteMany({ where: { planId } }),
      this.prisma.planBuild.createMany({ data: unique.map((buildId) => ({ planId, buildId })) }),
    ]);
    await this.audit.record({
      action: 'plan.builds',
      actorId,
      actorType: 'USER',
      entityType: 'license_plan',
      entityId: planId,
      before: { buildIds: plan.builds.map((b) => b.buildId) },
      after: { buildIds: unique },
    });
    return this.prisma.planBuild.findMany({
      where: { planId },
      select: { build: { select: { id: true, name: true, version: true, isPublished: true } } },
    });
  }

  /**
   * Какую сборку получает лицензия (горячий путь загрузчика):
   *   1. закреплённая за лицензией, если опубликована;
   *   2. самая новая опубликованная из сборок тарифа;
   *   3. самая новая опубликованная сборка товара.
   */
  async getBuildForLicense(licenseId: string, productId: string): Promise<PublishedPayloadBuild | null> {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: {
        buildId: true,
        plan: { select: { builds: { select: { buildId: true } } } },
      },
    });

    if (license?.buildId) {
      const pinned = await this.findIssuable({ id: license.buildId, productId });
      if (pinned) return pinned;
      this.logger.warn(`лицензия ${licenseId}: закреплённая сборка не опубликована — выдаю по тарифу`);
    }

    const planBuildIds = license?.plan.builds.map((b) => b.buildId) ?? [];
    if (planBuildIds.length) {
      const fromPlan = await this.findIssuable({ id: { in: planBuildIds }, productId });
      if (fromPlan) return fromPlan;
    }
    return this.getPublishedBuild(productId);
  }

  // =========================================================================
  //  ЧТЕНИЕ
  // =========================================================================

  /**
   * Хранилище сборок товара с поиском («поле:значение», AND/OR/NOT, скобки)
   * и диапазоном даты создания. Свежие сверху.
   */
  async listForProduct(productId: string, filters: { q?: string; from?: Date; to?: Date } = {}) {
    const conditions = [
      Prisma.sql`b.product_id = ${productId}::uuid`,
      ...timeRange(Prisma.raw('b.created_at'), filters),
      queryCondition(filters.q, BUILD_FIELDS, (term) => this.buildTerm(term)),
    ];
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT b.id FROM payload_builds b ${whereClause(conditions)} ORDER BY b.created_at DESC LIMIT 500`);
    const rows = await this.prisma.payloadBuild.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: {
        file: { select: { id: true, bucket: true, objectKey: true, deletedAt: true } },
        plans: { select: { plan: { select: { id: true, name: true, slug: true } } } },
        _count: { select: { licenses: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((r) => byId.get(r.id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(({ plans, _count, ...build }) => ({
        ...build,
        status: buildStatus(build),
        plans: plans.map((p) => p.plan),
        pinnedLicenses: _count.licenses,
      }));
  }

  private buildTerm({ field, value }: QueryTerm): Prisma.Sql {
    const raw = Prisma.raw;
    switch (field) {
      case 'name':
        return textMatch(raw('b.name'), value);
      case 'version':
        return textMatch(raw('b.version'), value);
      case 'status': {
        const condition = BUILD_STATUS_SQL[value.toLowerCase() as BuildStatus];
        if (!condition) {
          throw new BadRequestException({
            code: 'SEARCH_VALUE_INVALID',
            message: 'status: draft, ready, published или unpublished',
          });
        }
        return condition;
      }
      case 'plan':
        return Prisma.sql`EXISTS (SELECT 1 FROM plan_builds pb JOIN license_plans p ON p.id = pb.plan_id
                                  WHERE pb.build_id = b.id AND (${textMatch(raw('p.slug'), value)} OR ${textMatch(raw('p.name'), value)}))`;
      case 'id':
        return Prisma.sql`b.id::text = ${value}`;
      default:
        return anyContains(['b.name', 'b.version'], value);
    }
  }

  /**
   * Сборка, которую выдаёт горячий путь. ЕДИНСТВЕННЫЙ метод этого сервиса,
   * работающий под нагрузкой.
   *
   * Запрос целиком покрывается индексом
   * (product_id, channel, is_published, version_code DESC) — он построен
   * ровно под него.
   *
   * null означает РОВНО одно: опубликованной сборки в канале нет, то есть
   * 409 PAYLOAD_NOT_READY у вызывающего. Всё остальное — исключение, и это
   * не придирка к форме: 409 по контракту клиент повторяет с задержкой,
   * ожидая, что состояние изменится само. Опубликованная сборка со ссылкой
   * на удалённый файл сама не починится никогда, и клиент, которому
   * ответили 409, будет ждать вечно, а дежурный не получит алерта, потому
   * что 409 — штатный код окна выкатки (Д25).
   */
  async getPublishedBuild(
    productId: string,
    channel: ReleaseChannel = ReleaseChannel.STABLE,
  ): Promise<PublishedPayloadBuild | null> {
    return this.findIssuable({ productId }, channel);
  }

  /** Самая новая выдаваемая сборка среди подходящих под условие. */
  private async findIssuable(
    where: Prisma.PayloadBuildWhereInput,
    channel: ReleaseChannel = ReleaseChannel.STABLE,
  ): Promise<PublishedPayloadBuild | null> {
    const build = await this.prisma.payloadBuild.findFirst({
      where: { ...where, channel, isPublished: true, fileId: { not: null } },
      orderBy: { versionCode: 'desc' },
      include: {
        file: { select: { id: true, bucket: true, objectKey: true, deletedAt: true } },
      },
    });

    if (!build) return null;

    if (!build.file || build.file.deletedAt !== null) {
      // ERROR, а не WARN: опубликованная сборка без пригодного файла —
      // авария выдачи. Тот же класс, что PAYLOAD_CORRUPT.
      this.logger.error(
        `payload ${build.version} (${build.id}) опубликован, но файл недоступен: ` +
          (build.file ? 'помечен удалённым' : 'ссылка отсутствует'),
      );
      throw this.unavailable();
    }

    if (!build.sha256 || build.size === null) {
      this.logger.error(
        `payload ${build.version} (${build.id}) опубликован без эталона sha256/size`,
      );
      throw this.unavailable();
    }

    return {
      ...build,
      fileId: build.file.id,
      sha256: build.sha256,
      size: build.size,
      file: { id: build.file.id, bucket: build.file.bucket, objectKey: build.file.objectKey },
    };
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Публикация делает запись НЕИЗМЕНЯЕМОЙ — навсегда, а не «пока
   * isPublished = true».
   *
   * Это то самое место, где новый путь расходится со старым. В versions
   * requestUpload смотрит isPublished, а confirmUpload НЕ смотрит вовсе
   * (versions.service.ts:193-214): у опубликованной версии одним запросом
   * подменяются и файл, и эталонный sha256 — после чего проверка
   * целостности на клиенте честно сверяет подменённый файл с подменённым
   * же хешем и всегда сходится.
   *
   * Маркером служит publishedAt, а НЕ isPublished, и unpublish его не
   * снимает. Проверка isPublished была бы дырой ровно на один шаг длиннее:
   * unpublish → confirm-upload других байт → publish той же строки даёт
   * сборку, у которой при НЕИЗМЕННОМ payloadBuildId поменялось
   * содержимое. Это сценарий Д8/Д18: реплика с прогретым кэшем (ключ —
   * buildId) шифрует СТАРЫЕ байты, а заголовки и AAD берёт из свежей
   * строки БД. GCM-тег у клиента сходится, сверка sha256 по §7.2.3 падает,
   * пользователь видит «повреждённые данные» — а на сервере при этом
   * чистые 200 и ни одной ошибки. С неизменяемой записью пара
   * (buildId → байты) неизменна по построению, и кэш устареть не может.
   *
   * Цена названа прямо: перевыпуск payload'а — это НОВАЯ сборка с новым
   * номером версии, а не правка старой. Ровно так же устроен релиз §8
   * («Опубликованную версию менять нельзя. Выпустите новую.»), просто
   * здесь это ещё и выполняется.
   */
  private assertName(name: string): void {
    if (name.length > 64 || !BUILD_NAME_RE.test(name)) {
      throw new BadRequestException({
        code: 'BUILD_NAME_INVALID',
        message: 'Название: латиница и цифры, можно через точку, в конце буква или цифра',
      });
    }
  }

  private async assertNameFree(productId: string, name: string, exceptId?: string): Promise<void> {
    const taken = await this.prisma.payloadBuild.findFirst({
      where: { productId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException({ code: 'BUILD_NAME_TAKEN', message: 'Сборка с таким названием у товара уже есть' });
    }
  }

  private assertMutable(build: Pick<PayloadBuild, 'publishedAt'>): void {
    if (build.publishedAt !== null) {
      throw this.alreadyPublished();
    }
  }

  private alreadyPublished(): ConflictException {
    return new ConflictException({
      code: 'PAYLOAD_PUBLISHED',
      message:
        'Опубликованную сборку payload’а менять нельзя, в том числе после снятия ' +
        'с публикации. Создайте новую сборку.',
    });
  }

  /**
   * Ожидаемый префикс ключа объекта.
   *
   * Считается ТОЙ ЖЕ функцией, что строит ключ при выдаче ссылки:
   * buildPayloadKey санирует все три сегмента, и повторять его санитайз
   * здесь вручную значило бы завести второй источник правды, который
   * разойдётся с первым при первой же правке.
   */
  private expectedKeyPrefix(productSlug: string, version: string): string {
    const probe = this.storage.buildPayloadKey(productSlug, version, 'probe');
    return probe.slice(0, probe.lastIndexOf('/') + 1);
  }

  private tooLarge(size: number, maxBytes: number): ConflictException {
    return new ConflictException({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Payload ${size} байт превышает потолок ${maxBytes} байт (ТЗ §12)`,
    });
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'PAYLOAD_UNAVAILABLE',
      message: 'Payload временно недоступен',
    });
  }

  /**
   * Оповещение реплик о том, что кэш открытых байт по этой сборке
   * больше не действителен.
   *
   * Отказ Redis НЕ отменяет админскую операцию: источник правды — строка
   * в Postgres, она уже записана, а у подписчика есть страховочный TTL
   * (PAYLOAD_CACHE_TTL_MS, 60 с по прецеденту settings.service). Ронять
   * успешную публикацию из-за недоступного кэша значит добавить режим
   * отказа там, где его не было.
   */
  private async invalidate(buildId: string): Promise<void> {
    try {
      await this.redis.client.publish(PAYLOAD_INVALIDATION_CHANNEL, buildId);
    } catch (error) {
      this.logger.warn(
        `не удалось разослать инвалидацию кэша payload ${buildId}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}
