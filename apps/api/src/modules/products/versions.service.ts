import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FileStorage, ReleaseChannel } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { StorageService } from '@common/storage/storage.service';

/**
 * Версии продуктов и публикация обновлений (ТЗ п.8, п.12).
 *
 * Отдельной сущности «Updates» нет намеренно: обновление — это версия
 * с isPublished = true. Отдельная таблица дублировала бы все поля версии
 * и немедленно разъехалась бы с ней по содержимому.
 */

/** Semver без предрелизных суффиксов: 1.4.2 */
const SEMVER_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,4})$/;

@Injectable()
export class VersionsService {
  private readonly logger = new Logger(VersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Числовое представление версии для сравнения «новее / старее».
   *
   * Сравнивать строки нельзя: лексикографически "1.10.0" < "1.9.0",
   * и пользователи с 1.10 получали бы предложение «обновиться» до 1.9.
   */
  static toVersionCode(version: string): number {
    const match = SEMVER_RE.exec(version);
    if (!match) {
      throw new BadRequestException({
        code: 'INVALID_VERSION',
        message: 'Версия должна быть в формате major.minor.patch, например 1.4.2',
      });
    }

    const [, major, minor, patch] = match;
    return Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch);
  }

  // =========================================================================
  //  СОЗДАНИЕ И ЗАГРУЗКА
  // =========================================================================

  /** Черновик версии. Файла и публикации ещё нет. */
  async create(
    params: {
      productId: string;
      version: string;
      channel?: ReleaseChannel;
      changelog?: string;
      isMandatory?: boolean;
      minLauncherVersion?: string;
    },
    actorId: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: params.productId },
      select: { id: true, slug: true },
    });

    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Продукт не найден' });
    }

    const versionCode = VersionsService.toVersionCode(params.version);

    const exists = await this.prisma.productVersion.findUnique({
      where: { productId_version: { productId: params.productId, version: params.version } },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Такая версия у этого продукта уже есть',
      });
    }

    const created = await this.prisma.productVersion.create({
      data: {
        id: uuidv7(),
        productId: params.productId,
        version: params.version,
        versionCode,
        channel: params.channel ?? ReleaseChannel.STABLE,
        changelog: params.changelog ?? null,
        isMandatory: params.isMandatory ?? false,
        isPublished: false,
        minLauncherVersionCode: params.minLauncherVersion
          ? VersionsService.toVersionCode(params.minLauncherVersion)
          : null,
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: 'version.create',
      actorId,
      actorType: 'USER',
      entityType: 'product_version',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  /**
   * Ссылка для прямой загрузки дистрибутива в хранилище.
   *
   * Файл идёт мимо API: дистрибутив в десятки мегабайт занимал бы воркер
   * на всё время передачи. Запись в files создаётся сразу, но без хеша —
   * он появится на шаге подтверждения.
   */
  async requestUpload(
    versionId: string,
    params: { filename: string; contentType?: string },
    actorId: string,
  ) {
    const version = await this.prisma.productVersion.findUnique({
      where: { id: versionId },
      include: { product: { select: { slug: true } } },
    });

    if (!version) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Версия не найдена' });
    }

    if (version.isPublished) {
      throw new ConflictException({
        code: 'VERSION_PUBLISHED',
        message: 'Опубликованную версию менять нельзя. Выпустите новую.',
      });
    }

    const objectKey = this.storage.buildReleaseKey(
      version.product.slug,
      version.version,
      params.filename,
    );

    const target = await this.storage.createUploadUrl({
      bucket: this.storage.bucketReleases,
      objectKey,
      contentType: params.contentType ?? 'application/octet-stream',
    });

    const fileId = uuidv7();

    await this.prisma.file.upsert({
      where: { bucket_objectKey: { bucket: target.bucket, objectKey } },
      update: { uploadedById: actorId, deletedAt: null },
      create: {
        id: fileId,
        storage: FileStorage.S3,
        bucket: target.bucket,
        objectKey,
        originalName: params.filename,
        mimeType: params.contentType ?? 'application/octet-stream',
        size: 0,
        // Заглушка до подтверждения: настоящий хеш посчитает сервер.
        sha256: '0'.repeat(64),
        isPublic: false,
        uploadedById: actorId,
      },
    });

    return { uploadUrl: target.url, expiresInSec: target.expiresInSec, objectKey };
  }

  /**
   * Подтверждение загрузки.
   *
   * Сервер скачивает объект и считает SHA-256 сам. Принимать хеш от клиента
   * нельзя: именно им загрузчик проверяет целостность перед установкой,
   * и подставленный хеш превратил бы проверку в фикцию.
   */
  async confirmUpload(versionId: string, objectKey: string, actorId: string) {
    const version = await this.prisma.productVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Версия не найдена' });
    }

    const bucket = this.storage.bucketReleases;
    const meta = await this.storage.head(bucket, objectKey);

    if (!meta || meta.size === 0) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Файл не найден в хранилище или пуст',
      });
    }

    const { sha256, size } = await this.storage.computeSha256(bucket, objectKey);

    const file = await this.prisma.file.update({
      where: { bucket_objectKey: { bucket, objectKey } },
      data: { sha256, size: BigInt(size), mimeType: meta.contentType ?? 'application/octet-stream' },
    });

    const updated = await this.prisma.productVersion.update({
      where: { id: versionId },
      data: {
        fileId: file.id,
        // Хеш и размер дублируются в версии намеренно: контрольная сумма
        // конкретного релиза должна быть неизменяемой, даже если файл
        // потом перезальют. Иначе подмена файла тихо меняет и эталон,
        // и проверка целостности перестаёт что-либо проверять.
        sha256,
        fileSize: BigInt(size),
      },
    });

    this.logger.log(`версия ${version.version}: файл подтверждён, sha256=${sha256.slice(0, 12)}…`);

    await this.audit.record({
      action: 'version.upload_confirm',
      actorId,
      actorType: 'USER',
      entityType: 'product_version',
      entityId: versionId,
      after: { objectKey, sha256, size },
    });

    return updated;
  }

  /**
   * Манифест целостности: контрольная сумма каждого файла внутри релиза.
   *
   * Хеш архива отвечает на вопрос «скачалось без ошибок», но не на
   * «не подменили ли файл после установки» — для этого нужен пофайловый.
   */
  async setManifest(
    versionId: string,
    files: { path: string; sha256: string; size: number; isCritical?: boolean }[],
    actorId: string,
  ) {
    const version = await this.prisma.productVersion.findUnique({
      where: { id: versionId },
      select: { id: true, isPublished: true },
    });

    if (!version) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Версия не найдена' });
    }

    if (version.isPublished) {
      throw new ConflictException({
        code: 'VERSION_PUBLISHED',
        message: 'Манифест опубликованной версии менять нельзя',
      });
    }

    for (const f of files) {
      if (!/^[0-9a-f]{64}$/.test(f.sha256)) {
        throw new BadRequestException({
          code: 'INVALID_SHA256',
          message: `Некорректная контрольная сумма для ${f.path}`,
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.productVersionFile.deleteMany({ where: { versionId } }),
      this.prisma.productVersionFile.createMany({
        data: files.map((f) => ({
          id: uuidv7(),
          versionId,
          path: f.path,
          sha256: f.sha256,
          size: BigInt(f.size),
          isCritical: f.isCritical ?? false,
        })),
      }),
    ]);

    await this.audit.record({
      action: 'version.manifest_set',
      actorId,
      actorType: 'USER',
      entityType: 'product_version',
      entityId: versionId,
      after: { fileCount: files.length },
    });

    return { fileCount: files.length };
  }

  // =========================================================================
  //  ПУБЛИКАЦИЯ
  // =========================================================================

  /**
   * Публикация версии.
   *
   * С этого момента её видит загрузчик. Отменить публикацию можно, но файл
   * и хеш уже не меняются: у части пользователей версия установлена,
   * и правка эталона сломала бы им проверку целостности.
   */
  async publish(versionId: string, actorId: string) {
    const version = await this.prisma.productVersion.findUnique({ where: { id: versionId } });

    if (!version) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Версия не найдена' });
    }

    if (version.isPublished) {
      throw new ConflictException({ code: 'ALREADY_PUBLISHED', message: 'Версия уже опубликована' });
    }

    // Публиковать версию без файла нельзя: загрузчик получит предложение
    // обновиться и скачивать будет нечего.
    if (!version.fileId || !version.sha256) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Сначала загрузите и подтвердите файл дистрибутива',
      });
    }

    const published = await this.prisma.productVersion.update({
      where: { id: versionId },
      data: { isPublished: true, publishedAt: new Date() },
    });

    this.logger.log(`опубликована версия ${version.version}${version.isMandatory ? ' (обязательная)' : ''}`);

    await this.audit.record({
      action: 'version.publish',
      actorId,
      actorType: 'USER',
      entityType: 'product_version',
      entityId: versionId,
      before: version,
      after: published,
    });

    return published;
  }

  async unpublish(versionId: string, actorId: string) {
    const before = await this.prisma.productVersion.findUnique({ where: { id: versionId } });
    if (!before) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Версия не найдена' });
    }

    const after = await this.prisma.productVersion.update({
      where: { id: versionId },
      data: { isPublished: false },
    });

    await this.audit.record({
      action: 'version.unpublish',
      actorId,
      actorType: 'USER',
      entityType: 'product_version',
      entityId: versionId,
      before,
      after,
    });

    return after;
  }

  // =========================================================================
  //  ЧТЕНИЕ
  // =========================================================================

  async listForProduct(productId: string) {
    return this.prisma.productVersion.findMany({
      where: { productId },
      orderBy: { versionCode: 'desc' },
      include: { _count: { select: { files: true } } },
    });
  }

  /**
   * Последняя опубликованная версия канала.
   *
   * Запрос покрывается индексом (product_id, channel, is_published,
   * version_code DESC) целиком — чтения самой таблицы не происходит.
   */
  async latestPublished(productId: string, channel: ReleaseChannel = ReleaseChannel.STABLE) {
    return this.prisma.productVersion.findFirst({
      where: { productId, channel, isPublished: true },
      orderBy: { versionCode: 'desc' },
    });
  }

  /**
   * Есть ли обновление для клиента с указанной версией.
   *
   * Сравнение по versionCode, а не по строке. Возвращает null, когда
   * обновлений нет — вызывающий отличает это от ошибки.
   */
  async checkUpdate(
    productId: string,
    currentVersionCode: number,
    channel: ReleaseChannel = ReleaseChannel.STABLE,
  ) {
    const latest = await this.latestPublished(productId, channel);

    if (!latest || latest.versionCode <= currentVersionCode) return null;

    // Обязательность считается по ВСЕЙ цепочке пропущенных версий:
    // если обязательной была промежуточная, а последняя — нет, обновление
    // всё равно обязательно. Иначе пропустивший две версии обойдёт
    // обязательное обновление, просто подождав следующего релиза.
    const mandatoryInBetween = await this.prisma.productVersion.findFirst({
      where: {
        productId,
        channel,
        isPublished: true,
        isMandatory: true,
        versionCode: { gt: currentVersionCode, lte: latest.versionCode },
      },
      select: { id: true },
    });

    return {
      version: latest.version,
      versionCode: latest.versionCode,
      mandatory: mandatoryInBetween !== null,
      changelog: latest.changelog,
      sha256: latest.sha256,
      size: latest.fileSize ? Number(latest.fileSize) : null,
    };
  }
}
