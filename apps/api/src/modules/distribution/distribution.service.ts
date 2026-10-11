import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FileStorage,
  LauncherAudience,
  LauncherPlatform,
  LicenseStatus,
  Prisma,
  ReleaseChannel,
  type LauncherRelease,
} from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { SettingsService } from '@common/settings/settings.service';
import { StorageService } from '@common/storage/storage.service';
import { VersionsService } from '@modules/products/versions.service';

/**
 * Раздача клиента-загрузчика.
 *
 * Администратор (launcher.manage) заводит релиз — версия, платформа, канал,
 * «что нового», кому доступен — заливает файл прямо в хранилище по
 * presigned-ссылке и публикует. Пользователь видит в кабинете последнюю
 * доступную ему версию и историю; публичный релиз виден и на главной.
 *
 * Скачивание — всегда через API: сервер проверяет доступ, считает загрузку
 * и выдаёт ссылку на пять минут. Постоянной ссылки на файл нет, поэтому
 * снятие релиза с публикации или смена аудитории действуют сразу.
 */

export const LAUNCHER_PAGE_SETTING = 'launcher.page';

export interface LauncherPage {
  requirements: string;
  steps: string;
}

const PAGE_DEFAULTS: LauncherPage = { requirements: '', steps: '' };
/** Сколько прошлых версий показывать пользователю. */
const HISTORY = 10;
/** Установщик больше этого — почти наверняка ошибка загрузки, а не загрузчик. */
const MAX_FILE_BYTES = 512 * 1024 * 1024;

export interface ReleaseInput {
  version: string;
  platform?: LauncherPlatform;
  channel?: ReleaseChannel;
  notes?: string | null;
  audience?: LauncherAudience;
  roles?: string[];
  isMandatory?: boolean;
}

/** Что видит пользователь: без внутренних полей файла и автора. */
function publicView(release: LauncherRelease) {
  return {
    id: release.id,
    version: release.version,
    platform: release.platform,
    channel: release.channel,
    notes: release.notes,
    audience: release.audience,
    isMandatory: release.isMandatory,
    publishedAt: release.publishedAt,
    fileName: release.fileName,
    sha256: release.sha256,
    fileSize: release.fileSize,
  };
}

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------- для посетителей

  /** Главная: последний опубликованный публичный стабильный релиз по каждой платформе. */
  async publicReleases() {
    const rows = await this.prisma.launcherRelease.findMany({
      where: { isPublished: true, audience: LauncherAudience.PUBLIC, channel: ReleaseChannel.STABLE, fileId: { not: null } },
      orderBy: { versionCode: 'desc' },
    });
    return { releases: this.latestPerPlatform(rows).map(publicView), page: await this.page() };
  }

  async publicDownload(id: string, ip?: string) {
    const release = await this.published(id);
    if (release.audience !== LauncherAudience.PUBLIC) {
      throw new ForbiddenException({ code: 'LAUNCHER_LOGIN_REQUIRED', message: 'Эта версия доступна после входа в кабинет' });
    }
    return this.download(release, null, ip);
  }

  // ---------------------------------------------------------- для пользователя

  /** Кабинет: последняя доступная версия по платформам и каналам плюс история. */
  async forUser(user: { id: string; permissions: Set<string> }) {
    const access = await this.accessOf(user);
    const rows = await this.prisma.launcherRelease.findMany({
      where: { isPublished: true, fileId: { not: null } },
      orderBy: { versionCode: 'desc' },
    });
    const visible = rows.filter((r) => this.allowed(r, access));
    const latest = this.latestPerPlatform(visible, true);
    return {
      latest: latest.map(publicView),
      history: visible.filter((r) => !latest.includes(r)).slice(0, HISTORY).map(publicView),
      page: await this.page(),
      licensed: access.licensed,
    };
  }

  async userDownload(id: string, user: { id: string; permissions: Set<string> }, ip?: string) {
    const release = await this.published(id);
    if (!this.allowed(release, await this.accessOf(user))) {
      throw new ForbiddenException({
        code: release.audience === LauncherAudience.LICENSED ? 'LAUNCHER_LICENSE_REQUIRED' : 'LAUNCHER_FORBIDDEN',
        message:
          release.audience === LauncherAudience.LICENSED
            ? 'Загрузчик доступен владельцам действующей лицензии'
            : 'Эта версия вам недоступна',
      });
    }
    return this.download(release, user.id, ip);
  }

  private async accessOf(user: { id: string; permissions: Set<string> }) {
    const [licenses, roles] = await Promise.all([
      this.prisma.license.count({
        where: {
          userId: user.id,
          status: LicenseStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
      this.prisma.userRole.findMany({ where: { userId: user.id }, select: { role: { select: { slug: true } } } }),
    ]);
    return {
      licensed: licenses > 0,
      roles: new Set(roles.map((r) => r.role.slug)),
      // Тот, кто выпускает релизы, видит любой — иначе бету не проверить.
      manager: user.permissions.has('launcher.manage'),
    };
  }

  private allowed(release: LauncherRelease, access: { licensed: boolean; roles: Set<string>; manager: boolean }): boolean {
    if (access.manager) return true;
    switch (release.audience) {
      case LauncherAudience.PUBLIC:
      case LauncherAudience.USERS:
        return true;
      case LauncherAudience.LICENSED:
        return access.licensed;
      case LauncherAudience.ROLES:
        return release.roles.some((slug) => access.roles.has(slug));
    }
  }

  private async download(release: LauncherRelease, userId: string | null, ip?: string) {
    const file = release.fileId ? await this.prisma.file.findUnique({ where: { id: release.fileId } }) : null;
    if (!file || file.deletedAt) {
      throw new NotFoundException({ code: 'LAUNCHER_FILE_MISSING', message: 'Файл релиза недоступен' });
    }
    const link = await this.storage.createDownloadUrl({
      bucket: file.bucket,
      objectKey: file.objectKey,
      filename: release.fileName ?? file.originalName,
    });
    await this.prisma.launcherRelease.update({ where: { id: release.id }, data: { downloads: { increment: 1 } } });
    await this.audit.record({
      action: 'launcher.download',
      actorId: userId,
      actorType: userId ? 'USER' : 'SYSTEM',
      actorLabel: userId ? null : 'guest',
      entityType: 'launcher_release',
      entityId: release.id,
      after: { version: release.version, platform: release.platform, ip: ip ?? null },
    });
    return { ...link, fileName: release.fileName ?? file.originalName, sha256: release.sha256, size: release.fileSize };
  }

  private async published(id: string): Promise<LauncherRelease> {
    const release = await this.prisma.launcherRelease.findUnique({ where: { id } });
    if (!release || !release.isPublished || !release.fileId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Релиз не найден' });
    }
    return release;
  }

  /** Последний по версии релиз на каждую платформу (и канал, если просили). */
  private latestPerPlatform(rows: LauncherRelease[], byChannel = false): LauncherRelease[] {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const key = byChannel ? `${r.platform}:${r.channel}` : r.platform;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ---------------------------------------------------------- админка

  async list() {
    const rows = await this.prisma.launcherRelease.findMany({ orderBy: [{ platform: 'asc' }, { versionCode: 'desc' }] });
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } },
      select: { id: true, username: true },
    });
    const names = new Map(authors.map((a) => [a.id, a.username]));
    return { releases: rows.map((r) => ({ ...r, createdByUsername: names.get(r.createdById) ?? null })), page: await this.page() };
  }

  async create(input: ReleaseInput, actorId: string) {
    const versionCode = VersionsService.toVersionCode(input.version.trim());
    const roles = this.normalizeRoles(input.audience, input.roles);
    try {
      const release = await this.prisma.launcherRelease.create({
        data: {
          id: uuidv7(),
          version: input.version.trim(),
          versionCode,
          platform: input.platform ?? LauncherPlatform.WINDOWS,
          channel: input.channel ?? ReleaseChannel.STABLE,
          notes: input.notes?.trim() || null,
          audience: input.audience ?? LauncherAudience.USERS,
          roles,
          isMandatory: input.isMandatory ?? false,
          createdById: actorId,
        },
      });
      await this.record('launcher.release_create', release.id, actorId, { version: release.version, platform: release.platform, channel: release.channel });
      return release;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'LAUNCHER_VERSION_EXISTS', message: 'Такая версия для этой платформы и канала уже есть' });
      }
      throw error;
    }
  }

  /** Описание, аудитория и обязательность меняются и после публикации; версия и файл — нет. */
  async update(id: string, input: Partial<ReleaseInput>, actorId: string) {
    const release = await this.get(id);
    if (release.isPublished && (input.version !== undefined || input.platform !== undefined || input.channel !== undefined)) {
      throw new ConflictException({ code: 'LAUNCHER_PUBLISHED', message: 'У опубликованного релиза версию и платформу не меняют — выпустите новый' });
    }
    const audience = input.audience ?? release.audience;
    const updated = await this.prisma.launcherRelease.update({
      where: { id },
      data: {
        ...(input.version !== undefined ? { version: input.version.trim(), versionCode: VersionsService.toVersionCode(input.version.trim()) } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
        audience,
        roles: this.normalizeRoles(audience, input.roles ?? release.roles),
      },
    });
    await this.record('launcher.release_update', id, actorId, { audience: updated.audience, roles: updated.roles, isMandatory: updated.isMandatory });
    return updated;
  }

  async requestUpload(id: string, params: { filename: string; contentType?: string }, actorId: string) {
    const release = await this.get(id);
    if (release.isPublished) {
      throw new ConflictException({ code: 'LAUNCHER_PUBLISHED', message: 'Файл опубликованного релиза не меняют — выпустите новый' });
    }
    const objectKey = this.storage.buildLauncherKey(release.platform, release.channel, release.version, params.filename);
    const contentType = params.contentType || 'application/octet-stream';
    const target = await this.storage.createUploadUrl({ bucket: this.storage.bucketReleases, objectKey, contentType });
    await this.prisma.file.upsert({
      where: { bucket_objectKey: { bucket: target.bucket, objectKey } },
      update: { uploadedById: actorId, deletedAt: null, originalName: params.filename },
      create: {
        id: uuidv7(),
        storage: FileStorage.S3,
        bucket: target.bucket,
        objectKey,
        originalName: params.filename,
        mimeType: contentType,
        size: 0,
        // Заглушка до подтверждения: настоящий хеш посчитает сервер.
        sha256: '0'.repeat(64),
        isPublic: false,
        uploadedById: actorId,
      },
    });
    return { uploadUrl: target.url, expiresInSec: target.expiresInSec, objectKey };
  }

  /** Сервер сам скачивает объект и считает SHA-256: хешу от клиента верить нельзя. */
  async confirmUpload(id: string, objectKey: string, actorId: string) {
    const release = await this.get(id);
    const expected = this.storage.buildLauncherKey(release.platform, release.channel, release.version, 'x').replace(/x$/, '');
    if (!objectKey.startsWith(expected)) {
      throw new BadRequestException({ code: 'UPLOAD_KEY_MISMATCH', message: 'Файл загружен не для этого релиза' });
    }
    const bucket = this.storage.bucketReleases;
    const meta = await this.storage.head(bucket, objectKey);
    if (!meta || meta.size === 0) {
      throw new BadRequestException({ code: 'UPLOAD_NOT_FOUND', message: 'Файл не найден в хранилище или пуст' });
    }
    if (meta.size > MAX_FILE_BYTES) {
      throw new BadRequestException({ code: 'UPLOAD_TOO_LARGE', message: 'Файл больше 512 МБ' });
    }
    const { sha256, size } = await this.storage.computeSha256(bucket, objectKey);
    const file = await this.prisma.file.update({
      where: { bucket_objectKey: { bucket, objectKey } },
      data: { sha256, size: BigInt(size), mimeType: meta.contentType ?? 'application/octet-stream' },
    });
    const updated = await this.prisma.launcherRelease.update({
      where: { id },
      data: { fileId: file.id, fileName: file.originalName, sha256, fileSize: BigInt(size) },
    });
    this.logger.log(`загрузчик ${release.version} (${release.platform}): файл подтверждён, sha256=${sha256.slice(0, 12)}…`);
    await this.record('launcher.upload_confirm', id, actorId, { objectKey, sha256, size });
    return updated;
  }

  async publish(id: string, published: boolean, actorId: string) {
    const release = await this.get(id);
    if (published && !release.fileId) {
      throw new ConflictException({ code: 'LAUNCHER_NO_FILE', message: 'Сначала загрузите файл релиза' });
    }
    const updated = await this.prisma.launcherRelease.update({
      where: { id },
      data: { isPublished: published, publishedAt: published ? (release.publishedAt ?? new Date()) : release.publishedAt },
    });
    await this.record(published ? 'launcher.publish' : 'launcher.unpublish', id, actorId, { version: release.version, platform: release.platform });
    return updated;
  }

  async remove(id: string, actorId: string): Promise<void> {
    const release = await this.get(id);
    if (release.isPublished) {
      throw new ConflictException({ code: 'LAUNCHER_PUBLISHED', message: 'Снимите релиз с публикации, прежде чем удалять' });
    }
    await this.prisma.launcherRelease.delete({ where: { id } });
    await this.record('launcher.release_delete', id, actorId, { version: release.version, platform: release.platform });
  }

  async page(): Promise<LauncherPage> {
    const raw = await this.settings.get<Partial<LauncherPage>>(LAUNCHER_PAGE_SETTING, PAGE_DEFAULTS);
    return {
      requirements: typeof raw?.requirements === 'string' ? raw.requirements : '',
      steps: typeof raw?.steps === 'string' ? raw.steps : '',
    };
  }

  async updatePage(input: Partial<LauncherPage>, actorId: string): Promise<LauncherPage> {
    const next = { ...(await this.page()), ...input };
    await this.settings.set(LAUNCHER_PAGE_SETTING, next, actorId);
    await this.record('launcher.page_update', null, actorId, next);
    return next;
  }

  private async get(id: string): Promise<LauncherRelease> {
    const release = await this.prisma.launcherRelease.findUnique({ where: { id } });
    if (!release) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Релиз не найден' });
    return release;
  }

  private normalizeRoles(audience: LauncherAudience | undefined, roles: string[] | undefined): string[] {
    if (audience !== LauncherAudience.ROLES) return [];
    const unique = [...new Set((roles ?? []).map((r) => r.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new BadRequestException({ code: 'LAUNCHER_ROLES_REQUIRED', message: 'Для доступа по ролям выберите хотя бы одну роль' });
    }
    return unique;
  }

  private async record(action: string, id: string | null, actorId: string, after: unknown) {
    await this.audit.record({ action, actorId, actorType: 'USER', entityType: 'launcher_release', entityId: id, after });
  }
}
