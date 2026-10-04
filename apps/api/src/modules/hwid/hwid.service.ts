import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HwidEventReason, LicenseStatus, Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { CryptoService } from '@common/crypto/crypto.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { resolveScope } from '@common/rbac/scope';
import { SettingsService } from '@common/settings/settings.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';
import { LicensesService } from '@modules/licenses/licenses.service';
import { NotificationService } from '@modules/notifications/notification.service';

/**
 * Привязка лицензии к устройству (ТЗ п.7).
 *
 * Загрузчик присылает нормализованный Disk ID, всё остальное решает сервер:
 * клиент не знает, какой хеш привязан к лицензии, и сравнения не делает.
 *
 * СЧЁТЧИК СБРОСОВ ОБЩИЙ — решение заказчика (уточнение У-7). Сброс
 * расходует лимит независимо от того, кто его сделал: сам пользователь,
 * или поддержка. Раздельные счётчики превращали бы поддержку
 * в канал безлимитных сбросов.
 *
 * Компенсация — право hwid.counter.adjust: сбросив привязку по вине
 * системы, саппорт возвращает счётчик назад, и это попадает в аудит.
 */
export interface HwidCheckResult {
  ok: boolean;
  /**
   * NOT_BOUND отделён от MISMATCH намеренно: на клиенте RequiresReLogin()
   * на HWID_MISMATCH стирает сохранённые секреты и предлагает сброс
   * привязки. Для «привязки ещё нет» это вредный совет — человек сожжёт
   * лимит сбросов (по умолчанию 3), гоняясь за проблемой, которую сброс
   * не решает.
   */
  reason?: 'MISMATCH' | 'DEVICE_BLOCKED' | 'NOT_BOUND';
  deviceId?: string;
  /** Устройство привязано этим вызовом. */
  firstBind?: boolean;
  /**
   * Лицензия переведена в ACTIVE этим вызовом — вызывающий обязан
   * перечитать срок, иначе отдаст клиенту expiresAt, устаревший на один
   * запрос.
   */
  activated?: boolean;
}

/**
 * Режим проверки привязки.
 *
 * Умолчания повторяют историческое поведение bindOrVerify, поэтому
 * вызывающий, которому нужен обычный путь, параметр не передаёт вовсе.
 */
export interface HwidBindOptions {
  /**
   * false — verify-only: отсутствие привязки это ОТКАЗ, а не повод
   * её создать.
   */
  allowFirstBind?: boolean;
  /** false — не обновлять следы присутствия устройства (статистику). */
  touch?: boolean;
}

@Injectable()
export class HwidService {
  private readonly logger = new Logger(HwidService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly licenses: LicensesService,
  ) {}

  // =========================================================================
  //  ПРИВЯЗКА И ПРОВЕРКА
  // =========================================================================

  /**
   * Основной путь: привязать при первом запуске либо сверить привязку.
   *
   * Вызывается из Launcher API на каждой проверке лицензии, поэтому всё
   * здесь считается по хешу и одному индексу.
   *
   * Режим задаётся ЗДЕСЬ, а не предпроверкой у вызывающего: между чтением
   * лицензии вызывающим и входом сюда возможен конкурентный сброс
   * привязки, и предпроверка «привязка есть» пропустила бы запрос в ветку
   * первой привязки — то есть запрос за данными запустил бы отсчёт
   * оплаченного срока. Гарантия обязана быть структурной.
   */
  async bindOrVerify(
    licenseId: string,
    diskId: string,
    ctx: { ip?: string; country?: string; clientVersion?: string; osInfo?: string },
    opts?: HwidBindOptions,
  ): Promise<HwidCheckResult> {
    const allowFirstBind = opts?.allowFirstBind ?? true;
    const touch = opts?.touch ?? true;

    const hwidHash = this.crypto.hashHwid(diskId);

    const license = await this.prisma.license.findUniqueOrThrow({
      where: { id: licenseId },
      include: { currentDevice: true },
    });

    // --- Первая привязка --------------------------------------------------
    if (!license.currentDeviceId) {
      // Отказ ДО любой записи: ни устройства, ни строки в истории, ни
      // активации. Иначе verify-only путь оказывается способом стартовать
      // чужой срок в удобный противнику момент.
      if (!allowFirstBind) {
        return { ok: false, reason: 'NOT_BOUND' };
      }

      const device = await this.prisma.$transaction(async (tx) => {
        // Устройство могло уже заводиться для этой лицензии раньше —
        // например, человек вернулся на прежнюю машину после сброса.
        // Тогда переиспользуем запись, а не плодим дубли.
        const existing = await tx.device.findUnique({
          where: { licenseId_hwidHash: { licenseId, hwidHash } },
        });

        const created =
          existing ??
          (await tx.device.create({
            data: {
              id: uuidv7(),
              userId: license.userId,
              licenseId,
              hwidHash,
              hwidEnc: this.crypto.encrypt(this.crypto.normalizeDiskId(diskId), {
                table: 'devices',
                column: 'hwid_enc',
                rowId: licenseId,
              }),
              hwidEncKeyVer: this.crypto.keyVersion,
              osInfo: ctx.osInfo ?? null,
              lastIp: ctx.ip ?? null,
              lastCountry: ctx.country ?? null,
              lastClientVersion: ctx.clientVersion ?? null,
            },
          }));

        await tx.license.update({
          where: { id: licenseId },
          data: { currentDeviceId: created.id },
        });

        await this.writeHistory(tx, {
          licenseId,
          reason: HwidEventReason.FIRST_BIND,
          newHwidHash: hwidHash,
          newDeviceId: created.id,
          actorId: license.userId,
          actorType: 'USER',
          actorLabel: 'launcher',
          ip: ctx.ip,
        });

        // Срок начинается здесь и только здесь.
        await this.licenses.activate(licenseId, tx);

        return created;
      });

      // id, а не key: ключ лицензии — предъявительский документ, кто его
      // увидел, тот и владелец. Доступ к архиву логов и к сборщику логов
      // почти всегда шире доступа к базе, а pino вырезает секреты по путям
      // структурированных полей и текст сообщения не смотрит — то есть
      // интерполяция ключа в строку проезжает мимо цензора целиком.
      this.logger.log(`первая привязка лицензии ${license.id}`);
      return { ok: true, deviceId: device.id, firstBind: true, activated: true };
    }

    // --- Сверка -----------------------------------------------------------
    if (license.currentDevice?.isBlocked) {
      return { ok: false, reason: 'DEVICE_BLOCKED', deviceId: license.currentDeviceId };
    }

    if (license.currentDevice?.hwidHash !== hwidHash) {
      return { ok: false, reason: 'MISMATCH', deviceId: license.currentDeviceId };
    }

    // Привязка есть, а лицензия всё ещё PENDING — состояние, которого быть
    // не должно (дефект Д1). Срок в PENDING не начат и expiresAt = NULL,
    // а проверка срока пропускает NULL как «бессрочная»: лицензия работает
    // вечно, крон EXPIRED её не видит, в отчётах по истекающим её нет.
    // Достижимо через block → unblock (unblock возвращает PENDING при
    // activatedAt = NULL, привязку при блокировке не снимают) и через
    // старые строки, привязанные вручную до этой правки.
    //
    // Лечим при первой же сверке, а не молча выдаём бессрочный доступ:
    // привязка означает, что продуктом пользуются, значит срок идёт.
    // Только на пути, которому разрешена первая привязка — verify-only
    // не имеет права трогать срок вообще.
    let activated = false;
    if (allowFirstBind && license.status === LicenseStatus.PENDING) {
      await this.licenses.activate(licenseId);
      activated = true;
      this.logger.warn(`лицензия ${license.id}: привязка была, активации не было — активирована`);
    }

    // Совпало — обновляем следы присутствия. Это статистика, а не условие
    // доступа, поэтому verify-only путь её пропускает: второй UPDATE той
    // же строки devices за один запуск ничего не добавляет.
    if (touch) {
      await this.prisma.device.update({
        where: { id: license.currentDeviceId },
        data: {
          lastSeenAt: new Date(),
          lastIp: ctx.ip ?? null,
          lastCountry: ctx.country ?? null,
          lastClientVersion: ctx.clientVersion ?? null,
        },
      });
    }

    return { ok: true, deviceId: license.currentDeviceId, activated };
  }

  // =========================================================================
  //  СБРОСЫ
  // =========================================================================

  /**
   * Самостоятельный сброс пользователем.
   *
   * Единственный путь, где проверяются кулдаун и лимит. Всё остальное —
   * сбросы персоналом — идут через reset() с явным указанием причины.
   */
  async resetBySelf(licenseId: string, userId: string, ip?: string) {
    const license = await this.loadLicense(licenseId);

    if (license.userId !== userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Это не ваша лицензия' });
    }

    // Проверка «есть ли что сбрасывать» идёт ПЕРВОЙ.
    //
    // Иначе пользователь, у которого привязки нет, получает «ждите сутки»
    // вместо «нечего сбрасывать» — прождёт день и обнаружит, что причина
    // была другая.
    if (!license.currentDeviceId) {
      throw new ConflictException({
        code: 'NOT_BOUND',
        message: 'Лицензия не привязана ни к одному устройству',
      });
    }

    const limits = await this.limitsFor(license.productId);

    if (license.hwidResetCount >= limits.maxResets) {
      throw new ConflictException({
        code: 'HWID_RESET_LIMIT',
        message: `Исчерпан лимит самостоятельных сбросов (${limits.maxResets}). Обратитесь в поддержку.`,
      });
    }

    if (license.lastHwidResetAt) {
      const nextAllowed = new Date(
        license.lastHwidResetAt.getTime() + limits.cooldownHours * 3_600_000,
      );

      if (nextAllowed.getTime() > Date.now()) {
        throw new ConflictException({
          code: 'HWID_RESET_COOLDOWN',
          message: `Следующий сброс будет доступен ${nextAllowed.toISOString()}`,
          // Дату отдаём отдельным полем: клиенту нужно показать её
          // в своём формате, а не разбирать из текста сообщения.
          nextAllowedAt: nextAllowed.toISOString(),
        });
      }
    }

    return this.reset(licenseId, {
      reason: HwidEventReason.USER_RESET,
      actorId: userId,
      actorType: 'USER',
      actorLabel: `user:${userId}`,
      countsAgainstLimit: true,
      ip,
    });
  }

  /**
   * Сброс администратором или поддержкой (право hwid.reset.any проверяет
   * guard). Кулдаун и лимит не проверяются, но счётчик общий: сброс силами
   * поддержки расходует лимит пользователя наравне с его собственными (У-7).
   */
  async resetByStaff(licenseId: string, actor: AuthenticatedUser, ip?: string) {
    await this.loadLicense(licenseId);

    return this.reset(licenseId, {
      reason: HwidEventReason.ADMIN_RESET,
      actorId: actor.id,
      actorType: 'USER',
      actorLabel: `admin:${actor.id}`,
      countsAgainstLimit: true,
      ip,
    });
  }

  /**
   * Сброс реселлером своему клиенту. Принадлежность лицензии реселлеру и его
   * суточный лимит проверяет ResellersService; кулдаун пользователя не
   * проверяется (как у поддержки), но счётчик сбросов общий.
   */
  async resetByReseller(licenseId: string, actor: AuthenticatedUser, ip?: string) {
    return this.reset(licenseId, {
      reason: HwidEventReason.RESELLER_RESET,
      actorId: actor.id,
      actorType: 'USER',
      actorLabel: `reseller:${actor.id}`,
      countsAgainstLimit: true,
      ip,
    });
  }

  /**
   * Ручная установка привязки администратором (ТЗ п.7).
   *
   * Нужна, когда человек сменил железо и не может запустить продукт,
   * а лимит исчерпан: админ вписывает новый Disk ID напрямую.
   *
   * Активирует лицензию так же, как первая привязка из загрузчика: иначе
   * штатная операция поддержки оставляет лицензию в PENDING с expiresAt =
   * NULL, и человек получает бессрочный доступ вместо оплаченных 30 дней
   * (дефект Д1). Разница между «привязал загрузчик» и «привязал саппорт»
   * не должна означать разницу в сроке.
   */
  async setManually(licenseId: string, diskId: string, actor: AuthenticatedUser, ip?: string) {
    const license = await this.loadLicense(licenseId);
    const hwidHash = this.crypto.hashHwid(diskId);

    return this.prisma.$transaction(async (tx) => {
      const device = await tx.device.upsert({
        where: { licenseId_hwidHash: { licenseId, hwidHash } },
        update: { isBlocked: false },
        create: {
          id: uuidv7(),
          userId: license.userId,
          licenseId,
          hwidHash,
          hwidEnc: this.crypto.encrypt(this.crypto.normalizeDiskId(diskId), {
            table: 'devices',
            column: 'hwid_enc',
            rowId: licenseId,
          }),
          hwidEncKeyVer: this.crypto.keyVersion,
        },
      });

      // Срок начинается здесь ровно так же, как при первой привязке из
      // загрузчика. В ТОЙ ЖЕ транзакции: иначе между привязкой и
      // активацией существует окно, в котором лицензия — PENDING с уже
      // проставленным устройством, то есть ровно то состояние, ради
      // недостижимости которого правка и делается.
      //
      // Повторный вызов для уже активной лицензии безвреден: activate()
      // выходит сразу, если статус не PENDING.
      await this.licenses.activate(licenseId, tx);

      const updated = await tx.license.update({
        where: { id: licenseId },
        data: { currentDeviceId: device.id },
      });

      await this.writeHistory(tx, {
        licenseId,
        reason: HwidEventReason.ADMIN_MANUAL_SET,
        oldHwidHash: license.currentDevice?.hwidHash ?? null,
        oldDeviceId: license.currentDeviceId,
        newHwidHash: hwidHash,
        newDeviceId: device.id,
        actorId: actor.id,
        actorType: 'USER',
        actorLabel: `admin:${actor.id}`,
        ip,
      });

      await this.audit.record({
        action: 'hwid.set_manual',
        actorId: actor.id,
        actorType: 'USER',
        entityType: 'license',
        entityId: licenseId,
        // Сам Disk ID в аудит НЕ пишем: по ТЗ п.7 он не показывается
        // даже владельцу, а журнал читают люди.
        after: { deviceId: device.id },
      });

      return updated;
    });
  }

  /**
   * Корректировка счётчика сбросов.
   *
   * Компенсация за общий счётчик: сбросив привязку по вине системы,
   * поддержка возвращает значение назад. Без этого человек, которому
   * трижды сбрасывали привязку из-за нашей же ошибки, навсегда уходит
   * на ручное обслуживание.
   */
  async adjustCounter(
    licenseId: string,
    newCount: number,
    actor: AuthenticatedUser,
    comment: string,
  ) {
    const license = await this.loadLicense(licenseId);

    if (newCount < 0 || newCount > 1000) {
      throw new BadRequestException({
        code: 'INVALID_COUNT',
        message: 'Счётчик должен быть от 0 до 1000',
      });
    }

    const updated = await this.prisma.license.update({
      where: { id: licenseId },
      data: { hwidResetCount: newCount },
    });

    await this.audit.record({
      action: 'hwid.counter_adjust',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'license',
      entityId: licenseId,
      before: { hwidResetCount: license.hwidResetCount },
      after: { hwidResetCount: newCount, comment },
    });

    this.logger.log(
      `счётчик сбросов лицензии ${license.id}: ${license.hwidResetCount} → ${newCount}`,
    );

    return updated;
  }

  // =========================================================================
  //  ЧТЕНИЕ
  // =========================================================================

  /**
   * Состояние привязки для кабинета.
   *
   * Состав HWID НЕ отдаётся — ни хеш, ни исходный идентификатор
   * (ТЗ п.7). Пользователь видит только факт привязки и остаток сбросов.
   */
  async statusFor(licenseId: string, userId: string) {
    const license = await this.loadLicense(licenseId);

    if (license.userId !== userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Это не ваша лицензия' });
    }

    const limits = await this.limitsFor(license.productId);
    const nextAllowed = license.lastHwidResetAt
      ? new Date(license.lastHwidResetAt.getTime() + limits.cooldownHours * 3_600_000)
      : null;

    return {
      bound: license.currentDeviceId !== null,
      boundAt: license.currentDevice?.firstSeenAt ?? null,
      lastSeenAt: license.currentDevice?.lastSeenAt ?? null,
      resetsUsed: license.hwidResetCount,
      resetsLeft: Math.max(0, limits.maxResets - license.hwidResetCount),
      lastResetAt: license.lastHwidResetAt,
      nextResetAvailableAt:
        nextAllowed && nextAllowed.getTime() > Date.now() ? nextAllowed : null,
      // Те же лимиты, по которым посчитаны поля выше (с учётом продукта).
      maxResets: limits.maxResets,
      cooldownHours: limits.cooldownHours,
    };
  }

  /** История привязок. Для админки и поддержки. */
  async history(licenseId: string, actor: AuthenticatedUser) {
    const license = await this.loadLicense(licenseId);

    if (resolveScope(actor, 'licenses.read') !== 'any' && license.userId !== actor.id) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Недостаточно прав' });
    }

    return this.prisma.hwidHistory.findMany({
      where: { licenseId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      // Хеши не отдаём даже админу: они не несут смысла глазами,
      // а утечка журнала не должна давать материал для перебора.
      select: {
        id: true,
        reason: true,
        actorId: true,
        actorType: true,
        actorLabel: true,
        ip: true,
        comment: true,
        createdAt: true,
      },
    });
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /** Общая механика сброса. Все пути сходятся сюда. */
  private async reset(
    licenseId: string,
    params: {
      reason: HwidEventReason;
      actorId: string;
      actorType: 'USER' | 'SYSTEM';
      actorLabel: string;
      countsAgainstLimit: boolean;
      ip?: string;
      comment?: string;
    },
  ) {
    const license = await this.loadLicense(licenseId);

    if (!license.currentDeviceId) {
      throw new ConflictException({
        code: 'NOT_BOUND',
        message: 'Лицензия не привязана ни к одному устройству',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.license.update({
        where: { id: licenseId },
        data: {
          // Старая запись devices НЕ удаляется: по ней видно, возвращался ли
          // человек на прежнюю машину, и «шесть машин за месяц» выглядит
          // совсем иначе, чем «одна, переустановил Windows».
          currentDeviceId: null,
          ...(params.countsAgainstLimit
            ? { hwidResetCount: { increment: 1 }, lastHwidResetAt: new Date() }
            : {}),
        },
      });

      await this.writeHistory(tx, {
        licenseId,
        reason: params.reason,
        oldHwidHash: license.currentDevice?.hwidHash ?? null,
        oldDeviceId: license.currentDeviceId,
        actorId: params.actorId,
        actorType: params.actorType,
        actorLabel: params.actorLabel,
        ip: params.ip,
        comment: params.comment,
      });

      return result;
    });

    // Уведомление владельцу обязательно: если сброс сделал не он,
    // он должен об этом узнать.
    if (license.userId) {
      const limits = await this.limitsFor(license.productId);
      // enqueueMulti: сброс привязки — событие категории DEVICE, и узнать
      // о нём человек должен там, где он есть. Полный ключ в payload нужен
      // письменному шаблону; Telegram-копия получит от санитайзера маску.
      await this.notifications.enqueueMulti({
        templateKey: 'hwid.reset',
        userId: license.userId,
        payload: {
          // Ось дедупликации: два сброса по разным лицензиям в одно окно —
          // это два разных события, а не повтор одного.
          licenseId: licenseId,
          licenseKey: license.key,
          // Читаемый вид «2026-08-10 12:34 UTC», пояс назван явно.
          resetAt: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          actor: params.actorLabel,
          resetsLeft: Math.max(0, limits.maxResets - updated.hwidResetCount),
        },
      });
    }

    await this.audit.record({
      action: `hwid.reset.${params.reason.toLowerCase()}`,
      actorId: params.actorId,
      actorType: params.actorType,
      actorLabel: params.actorLabel,
      entityType: 'license',
      entityId: licenseId,
      after: { resetCount: updated.hwidResetCount },
    });

    this.logger.log(`сброс привязки ${license.id} (${params.reason})`);
    return updated;
  }

  private async writeHistory(
    tx: Prisma.TransactionClient,
    params: {
      licenseId: string;
      reason: HwidEventReason;
      oldHwidHash?: string | null;
      newHwidHash?: string | null;
      oldDeviceId?: string | null;
      newDeviceId?: string | null;
      actorId: string | null;
      actorType: 'USER' | 'SYSTEM';
      actorLabel: string;
      ip?: string;
      comment?: string;
    },
  ): Promise<void> {
    await tx.hwidHistory.create({
      data: {
        id: uuidv7(),
        licenseId: params.licenseId,
        reason: params.reason,
        oldHwidHash: params.oldHwidHash ?? null,
        newHwidHash: params.newHwidHash ?? null,
        oldDeviceId: params.oldDeviceId ?? null,
        newDeviceId: params.newDeviceId ?? null,
        actorId: params.actorId,
        actorType: params.actorType,
        // Подпись актора на момент действия: через полгода в истории
        // не должно остаться голого UUID уволенного сотрудника.
        actorLabel: params.actorLabel,
        ip: params.ip ?? null,
        comment: params.comment ?? null,
      },
    });
  }

  /**
   * Лимиты продукта с откатом к глобальным настройкам.
   *
   * NULL в продукте означает «брать общее значение», а не «без лимита» —
   * иначе забытое поле у нового продукта открывало бы безлимитные сбросы.
   */
  private async limitsFor(productId: string): Promise<{ maxResets: number; cooldownHours: number }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { maxHwidResets: true, hwidResetCooldownHours: true },
    });

    return {
      maxResets:
        product?.maxHwidResets ??
        (await this.settings.getNumber('limits.hwid.max_total_resets', 3)),
      cooldownHours:
        product?.hwidResetCooldownHours ??
        (await this.settings.getNumber('limits.hwid.reset_cooldown_hours', 24)),
    };
  }

  private async loadLicense(licenseId: string) {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      include: { currentDevice: true },
    });

    if (!license) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }

    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException({
        code: 'LICENSE_REVOKED',
        message: 'Лицензия отозвана',
      });
    }

    return license;
  }
}
