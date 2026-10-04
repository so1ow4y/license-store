import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LicenseStatus, Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { errorCode, summarize, type BulkItemResult } from '@common/bulk/bulk';
import { PrismaService } from '@common/prisma/prisma.service';
import { resolveScope } from '@common/rbac/scope';
import {
  anyContains,
  enumMatch,
  queryCondition,
  textContains,
  textMatch,
  timeRange,
  whereClause,
  type QueryTerm,
} from '@common/search/query';
import { maskLicenseKey } from '@common/utils/license-key';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';
import { NotificationService } from '@modules/notifications/notification.service';

/**
 * Лицензии: выдача, продление, блокировка, отзыв (ТЗ п.4, п.8).
 *
 * Единственное место, где создаются строки licenses: оплата, регистрация по
 * ключу и ручная выдача приходят сюда, чтобы правила срока не разъехались.
 */

/** Тот же алфавит, что у регистрационных ключей: без 0/O, 1/I/L, B, S. */
const KEY_ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ2346789';

/** За сколько дней до истечения предупреждать пользователя. */
const EXPIRY_WARNING_DAYS = [7, 3, 1];

/**
 * Поля лицензии, которые разрешено отдавать наружу. Перечисление явное:
 * новое поле схемы не публикуется само. `key` выбирается только для маски —
 * наружу его не пускает `toPublic()`. Не включать `lastCheckIp` и
 * идентификаторы сотрудников (`blockedById`, `issuedById`).
 */
const LICENSE_PUBLIC_SELECT = {
  id: true,
  key: true,
  userId: true,
  productId: true,
  planId: true,
  status: true,
  issuedAt: true,
  activatedAt: true,
  expiresAt: true,
  blockedAt: true,
  blockedReason: true,
  revokedAt: true,
  revokedReason: true,
  currentDeviceId: true,
  hwidResetCount: true,
  lastHwidResetAt: true,
  lastCheckAt: true,
  lastCheckCountry: true,
  lastClientVersion: true,
  orderId: true,
  notes: true,
  buildId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LicenseSelect;

/** Поля поиска по лицензиям (только для права .any). */
export const LICENSE_FIELDS = ['key', 'user', 'product', 'plan', 'status', 'build', 'reseller', 'id'] as const;

/** История привязок без хешей HWID — тот же набор, что в `HwidService.history`. */
const HWID_HISTORY_PUBLIC_SELECT = {
  id: true,
  reason: true,
  actorId: true,
  actorType: true,
  actorLabel: true,
  ip: true,
  comment: true,
  createdAt: true,
} satisfies Prisma.HwidHistorySelect;

@Injectable()
export class LicensesService {
  private readonly logger = new Logger(LicensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------- выдача

  /**
   * Выдача лицензии. Срок здесь НЕ начинается (PENDING, expiresAt = NULL):
   * отсчёт идёт от первого запуска, чтобы ключ в резерве не протухал.
   *
   * @param tx транзакция вызывающего, если выдача — часть большей операции
   */
  async issue(
    params: {
      userId: string | null;
      productId: string;
      planId: string;
      orderId?: string | null;
      issuedById?: string | null;
      /** Реселлер, чьим ключом выдана лицензия. */
      resellerId?: string | null;
      /** Ключ активации, которым получена лицензия. */
      registrationKeyId?: string | null;
      notes?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const plan = await db.licensePlan.findUnique({
      where: { id: params.planId },
      select: { id: true, productId: true, isActive: true, product: { select: { slug: true } } },
    });

    if (!plan || plan.productId !== params.productId) {
      throw new BadRequestException({
        code: 'PLAN_MISMATCH',
        message: 'Тариф не принадлежит указанному продукту',
      });
    }

    return db.license.create({
      data: {
        id: uuidv7(),
        key: this.generateLicenseKey(plan.product.slug),
        userId: params.userId,
        productId: params.productId,
        planId: params.planId,
        orderId: params.orderId ?? null,
        issuedById: params.issuedById ?? null,
        resellerId: params.resellerId ?? null,
        registrationKeyId: params.registrationKeyId ?? null,
        status: LicenseStatus.PENDING,
        expiresAt: null,
        notes: params.notes ?? null,
      },
    });
  }

  /** Активация при первом запуске — единственное место, где начинается срок. */
  async activate(licenseId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;

    const license = await db.license.findUniqueOrThrow({
      where: { id: licenseId },
      include: { plan: { select: { durationDays: true } } },
    });

    // Повторная активация не ошибка: лицензия уже работает.
    if (license.status !== LicenseStatus.PENDING) return license;

    const now = new Date();
    // durationDays = NULL — Lifetime, срок не проставляется.
    const expiresAt = license.plan.durationDays
      ? new Date(now.getTime() + license.plan.durationDays * 86_400_000)
      : null;

    return db.license.update({
      where: { id: licenseId },
      data: { status: LicenseStatus.ACTIVE, activatedAt: now, expiresAt },
    });
  }

  // ------------------------------------------------------------- продление

  /**
   * Продление на срок тарифа — от БОЛЬШЕЙ из дат «текущий срок» и «сейчас»:
   * продливший заранее не теряет остаток, опоздавший получает полный срок.
   */
  async extend(licenseId: string, actor: AuthenticatedUser, planId?: string) {
    const license = await this.loadForExtension(licenseId);
    this.assertCanTouch(license, actor, 'licenses.read');
    return this.applyExtension(license, actor, planId);
  }

  /**
   * Продление реселлером — только лицензии, проданные им самим. Право на это
   * не выражается парой .any/.own: владелец лицензии — покупатель, а
   * реселлер — продавец, поэтому проверка здесь по resellerId.
   */
  async extendForReseller(licenseId: string, resellerId: string, actor: AuthenticatedUser, planId: string) {
    const license = await this.loadForExtension(licenseId);
    if (license.resellerId !== resellerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }
    return this.applyExtension(license, actor, planId);
  }

  private async loadForExtension(licenseId: string) {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      include: { plan: true },
    });
    if (!license) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }
    return license;
  }

  private async applyExtension(
    license: Prisma.LicenseGetPayload<{ include: { plan: true } }>,
    actor: AuthenticatedUser,
    planId?: string,
  ) {
    const licenseId = license.id;

    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException({
        code: 'LICENSE_REVOKED',
        message: 'Отозванную лицензию продлить нельзя',
      });
    }

    const plan = planId
      ? await this.prisma.licensePlan.findUnique({ where: { id: planId } })
      : license.plan;

    if (!plan || plan.productId !== license.productId) {
      throw new BadRequestException({
        code: 'PLAN_MISMATCH',
        message: 'Тариф не принадлежит продукту лицензии',
      });
    }

    // Продление бессрочным тарифом снимает срок совсем.
    if (plan.durationDays === null) {
      const updated = await this.prisma.license.update({
        where: { id: licenseId },
        data: { expiresAt: null, planId: plan.id, status: LicenseStatus.ACTIVE },
      });

      await this.recordChange('license.extend', license, updated, actor);
      return this.toPublic(updated);
    }

    if (license.status === LicenseStatus.PENDING) {
      throw new ConflictException({
        code: 'LICENSE_NOT_ACTIVATED',
        message: 'Лицензия ещё не активирована. Срок начнётся с первого запуска.',
      });
    }

    const base =
      license.expiresAt && license.expiresAt.getTime() > Date.now()
        ? license.expiresAt
        : new Date();

    const updated = await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        expiresAt: new Date(base.getTime() + plan.durationDays * 86_400_000),
        planId: plan.id,
        // Истёкшая лицензия при продлении оживает.
        status: license.status === LicenseStatus.EXPIRED ? LicenseStatus.ACTIVE : license.status,
      },
    });

    await this.recordChange('license.extend', license, updated, actor);
    return this.toPublic(updated);
  }

  // ------------------------------------------------------- блокировка, отзыв

  async block(licenseId: string, reason: string, actor: AuthenticatedUser) {
    const license = await this.prisma.license.findUnique({ where: { id: licenseId } });
    if (!license) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }

    const updated = await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        status: LicenseStatus.BLOCKED,
        blockedAt: new Date(),
        blockedReason: reason,
        blockedById: actor.id,
      },
    });

    await this.recordChange('license.block', license, updated, actor);
    return this.toPublic(updated);
  }

  async unblock(licenseId: string, actor: AuthenticatedUser) {
    const license = await this.prisma.license.findUnique({ where: { id: licenseId } });
    if (!license) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }

    if (license.status !== LicenseStatus.BLOCKED) {
      throw new ConflictException({ code: 'NOT_BLOCKED', message: 'Лицензия не заблокирована' });
    }

    // Статус по сроку, а не безусловно ACTIVE: разблокировка не воскрешает истёкшую.
    const restored =
      license.expiresAt && license.expiresAt.getTime() < Date.now()
        ? LicenseStatus.EXPIRED
        : license.activatedAt
          ? LicenseStatus.ACTIVE
          : LicenseStatus.PENDING;

    const updated = await this.prisma.license.update({
      where: { id: licenseId },
      data: { status: restored, blockedAt: null, blockedReason: null, blockedById: null },
    });

    await this.recordChange('license.unblock', license, updated, actor);
    return this.toPublic(updated);
  }

  /**
   * Отзыв — когда за лицензию не заплатили (возврат, отмена сделки).
   * Блокирует администратор за нарушение; отзывает система или админ.
   */
  async revoke(licenseId: string, reason: string, actor?: AuthenticatedUser) {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      include: {
        product: { select: { name: true } },
        user: { select: { username: true, locale: true } },
      },
    });
    if (!license) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }

    const updated = await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        status: LicenseStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
        // Устройство больше не должно проходить проверку.
        currentDeviceId: null,
      },
    });

    await this.audit.record({
      action: 'license.revoke',
      actorId: actor?.id ?? null,
      actorType: actor ? 'USER' : 'SYSTEM',
      entityType: 'license',
      entityId: licenseId,
      before: this.toPublic(license),
      after: this.toPublic(updated),
    });

    // Письмо всегда, копия в Telegram — если бот включён. Лицензия в резерве
    // (без владельца) уведомлений не порождает.
    if (license.userId) {
      await this.notifications.enqueueMulti({
        templateKey: 'license.revoked',
        userId: license.userId,
        locale: license.user?.locale,
        payload: {
          username: license.user?.username ?? '',
          productName: license.product.name,
          reason,
          maskedKey: maskLicenseKey(license.key),
        },
      });
    }

    // В лог — id, не ключ: redact pino не трогает текст сообщения.
    this.logger.warn(`отозвана лицензия ${license.id}: ${reason}`);
    return this.toPublic(updated);
  }

  // ---------------------------------------------------------------- чтение

  /** Список с учётом области видимости: .any — все, .own — свои. */
  /**
   * Список с учётом области видимости: .any — все, .own — свои. Для .any есть
   * поиск «поле:значение» (key, user, product, plan, status, build, id) с
   * AND/OR/NOT и скобками и диапазон даты выдачи.
   */
  async list(
    actor: AuthenticatedUser,
    filters: {
      status?: LicenseStatus;
      productId?: string;
      userId?: string;
      search?: string;
      q?: string;
      from?: Date;
      to?: Date;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const scope = resolveScope(actor, 'licenses.read');
    const sql = Prisma.sql;
    const raw = Prisma.raw;

    // Фильтр по владельцу из запроса уступает области видимости: .own
    // видит только себя, что бы ни прислал клиент.
    const ownerId = scope === 'own' ? actor.id : filters.userId;
    const conditions = [
      ownerId ? sql`l.user_id = ${ownerId}::uuid` : null,
      filters.status ? sql`l.status::text = ${filters.status}` : null,
      filters.productId ? sql`l.product_id = ${filters.productId}::uuid` : null,
      filters.search
        ? sql`(${textContains(raw('l.key'), filters.search)} OR ${textContains(raw('u.username::text'), filters.search)})`
        : null,
      ...(scope === 'any' ? timeRange(raw('l.created_at'), filters) : []),
      scope === 'any' ? queryCondition(filters.q, LICENSE_FIELDS, (term) => this.licenseTerm(term)) : null,
    ];

    const from = sql`FROM licenses l
      LEFT JOIN users u ON u.id = l.user_id
      JOIN products p ON p.id = l.product_id
      JOIN license_plans pl ON pl.id = l.plan_id
      LEFT JOIN payload_builds b ON b.id = l.build_id
      LEFT JOIN resellers r ON r.id = l.reseller_id`;
    const where = whereClause(conditions);
    const take = Math.min(filters.take ?? 25, 200);
    const skip = filters.skip ?? 0;

    const [ids, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(sql`
        SELECT l.id ${from} ${where} ORDER BY l.created_at DESC LIMIT ${take} OFFSET ${skip}`),
      this.prisma.$queryRaw<[{ total: number }]>(sql`SELECT count(*)::int AS total ${from} ${where}`),
    ]);

    const rows = await this.prisma.license.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      select: {
        ...LICENSE_PUBLIC_SELECT,
        product: { select: { slug: true, name: true } },
        plan: { select: { slug: true, name: true, durationDays: true } },
        user: { select: { id: true, username: true } },
        build: { select: { id: true, name: true, version: true } },
        reseller: { select: { id: true, displayName: true } },
        // Для сводки «откуда лицензия». Наружу эти поля не уходят: покупатель
        // не получает идентификаторов сотрудников (см. LICENSE_PUBLIC_SELECT),
        // администратор получает готовую сводку origin.
        issuedById: true,
        order: { select: { number: true, source: true } },
        registrationKey: {
          select: { createdById: true, usedAt: true, usedByUser: { select: { username: true } } },
        },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const origins = scope === 'any' ? await this.originsOf(rows) : null;

    return {
      items: ids
        .map((r) => byId.get(r.id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map(({ issuedById: _issued, order: _order, registrationKey: _key, ...license }) =>
          origins ? { ...this.toPublic(license), origin: origins.get(license.id) ?? null } : this.toPublic(license),
        ),
      total,
      skip,
      take,
    };
  }

  /**
   * Откуда лицензия и кто её активировал — для таблицы админки.
   *
   *   source: reseller — продал реселлер (его ключом);
   *           order    — куплена на сайте или на Digiseller;
   *           admin    — выдана вручную администратором;
   *           key      — ключом регистрации от администратора;
   *   activatedBy: кто погасил ключ (или кому выдана лицензия) и когда.
   *
   * Первый запуск — отдельное событие (activatedAt лицензии), его показывает
   * колонка «Выдана».
   */
  private async originsOf(
    rows: Array<{
      id: string;
      issuedAt: Date;
      user: { username: string } | null;
      reseller: { id: string; displayName: string } | null;
      issuedById?: string | null;
      order?: { number: string; source: string } | null;
      registrationKey?: { createdById: string | null; usedAt: Date | null; usedByUser: { username: string } | null } | null;
    }>,
  ) {
    const staffIds = [
      ...new Set(
        rows.flatMap((r) => [r.issuedById, r.registrationKey?.createdById]).filter((v): v is string => Boolean(v)),
      ),
    ];
    const staff = staffIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, username: true } })
      : [];
    const nameOf = new Map(staff.map((u) => [u.id, u.username]));

    return new Map(
      rows.map((r) => {
        const key = r.registrationKey ?? null;
        const source = r.reseller
          ? { kind: 'reseller' as const, name: r.reseller.displayName }
          : r.order
            ? { kind: 'order' as const, number: r.order.number, channel: r.order.source }
            : r.issuedById
              ? { kind: 'admin' as const, by: nameOf.get(r.issuedById) ?? null }
              : key
                ? { kind: 'key' as const, by: key.createdById ? (nameOf.get(key.createdById) ?? null) : null }
                : { kind: 'unknown' as const };
        const activatedBy = key
          ? { username: key.usedByUser?.username ?? null, at: key.usedAt }
          : r.user
            ? { username: r.user.username, at: r.issuedAt }
            : null;
        return [r.id, { source, activatedBy }];
      }),
    );
  }

  private licenseTerm({ field, value }: QueryTerm): Prisma.Sql {
    const sql = Prisma.sql;
    const raw = Prisma.raw;
    switch (field) {
      case 'key':
        return textMatch(raw('l.key'), value);
      case 'user':
        return sql`(${textMatch(raw('u.username::text'), value)} OR ${textMatch(raw('u.email::text'), value)} OR l.user_id::text = ${value})`;
      case 'product':
        return sql`(${textMatch(raw('p.slug'), value)} OR ${textMatch(raw('p.name'), value)})`;
      case 'plan':
        return sql`(${textMatch(raw('pl.slug'), value)} OR ${textMatch(raw('pl.name'), value)})`;
      case 'status':
        return enumMatch(raw('l.status'), value);
      case 'build':
        return sql`(${textMatch(raw('b.name'), value)} OR ${textMatch(raw('b.version'), value)})`;
      case 'reseller':
        return textMatch(raw('r.display_name'), value);
      case 'id':
        return sql`l.id::text = ${value}`;
      default:
        return anyContains(['l.key', 'u.username::text', 'p.name', 'pl.name'], value);
    }
  }

  // ------------------------------------------------------ массовые операции

  /** Массовая блокировка или разблокировка: каждая лицензия отдельно. */
  async bulk(actor: AuthenticatedUser, ids: string[], action: 'block' | 'unblock', reason?: string) {
    if (action === 'block' && !reason?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Укажите причину блокировки' });
    }
    const results: BulkItemResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (action === 'block') await this.block(id, reason!.trim(), actor);
        else await this.unblock(id, actor);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, code: errorCode(error) });
      }
    }
    return summarize(results);
  }

  /**
   * Закрепить за лицензией сборку из хранилища её товара (null — снять):
   * загрузчик получит именно её, а не сборку тарифа.
   */
  async setBuild(licenseId: string, buildId: string | null, actor: AuthenticatedUser) {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: { id: true, productId: true, buildId: true },
    });
    if (!license) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });

    if (buildId) {
      const build = await this.prisma.payloadBuild.findUnique({ where: { id: buildId }, select: { productId: true } });
      if (!build || build.productId !== license.productId) {
        throw new BadRequestException({ code: 'BUILD_OF_OTHER_PRODUCT', message: 'Сборка должна быть из хранилища товара этой лицензии' });
      }
    }

    await this.prisma.license.update({ where: { id: licenseId }, data: { buildId } });
    await this.audit.record({
      action: 'license.build',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'license',
      entityId: licenseId,
      before: { buildId: license.buildId },
      after: { buildId },
    });
    return this.findById(licenseId, actor);
  }

  async findById(licenseId: string, actor: AuthenticatedUser) {
    // Почта владельца видна только обладателю .any.
    const scope = resolveScope(actor, 'licenses.read');

    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: {
        ...LICENSE_PUBLIC_SELECT,
        product: { select: { slug: true, name: true } },
        // Без цены и привязок к площадкам: кабинету нужны название и срок.
        plan: { select: { id: true, slug: true, name: true, durationDays: true } },
        user: { select: { id: true, username: true, email: scope === 'any' } },
        build: { select: { id: true, name: true, version: true } },
        hwidHistory: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: HWID_HISTORY_PUBLIC_SELECT,
        },
      },
    });

    if (!license) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }

    this.assertCanTouch(license, actor, 'licenses.read');
    return this.toPublic(license);
  }

  /**
   * Полный ключ по явному запросу. Отдельная ручка, чтобы каждый показ
   * попадал в аудит поимённо: ключ предъявительский, и «кто и когда его
   * видел» — главный вопрос при разборе перепродажи.
   *
   * @param source откуда запрос: показ в Telegram рискованнее (сообщение
   *               остаётся в облаке), поэтому различается в аудите
   */
  async revealKey(
    licenseId: string,
    actor: AuthenticatedUser,
    source: 'web' | 'telegram' = 'web',
  ): Promise<{ key: string }> {
    const license = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: { id: true, key: true, userId: true, status: true },
    });

    if (!license) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    }

    if (resolveScope(actor, 'licenses.read') !== 'any' && license.userId !== actor.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Полный ключ доступен только владельцу лицензии',
      });
    }

    // В аудит — факт показа, не значение: журнал читает поддержка.
    await this.audit.record({
      action: 'license.key.reveal',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'license',
      entityId: license.id,
      after: { source, status: license.status },
    });

    this.logger.log(`показан ключ лицензии ${license.id} (источник: ${source})`);
    return { key: license.key };
  }

  // -------------------------------------------------------- фоновые задачи

  /**
   * Перевод истёкших в EXPIRED. Статус хранится, а не вычисляется: по нему
   * фильтрует админка (индекс status, expires_at).
   */
  async expireOverdue(): Promise<number> {
    const overdue = await this.prisma.license.findMany({
      where: { status: LicenseStatus.ACTIVE, expiresAt: { not: null, lt: new Date() } },
      select: { id: true },
      take: 500,
    });

    if (overdue.length === 0) return 0;

    await this.prisma.license.updateMany({
      where: { id: { in: overdue.map((l) => l.id) } },
      data: { status: LicenseStatus.EXPIRED },
    });

    this.logger.log(`истекло лицензий: ${overdue.length}`);
    return overdue.length;
  }

  /**
   * Предупреждения об истечении — по точным суткам, а не «меньше N дней»,
   * иначе письмо уходило бы на каждом прогоне до самого истечения.
   */
  async notifyExpiring(): Promise<number> {
    let sent = 0;

    for (const days of EXPIRY_WARNING_DAYS) {
      const from = new Date(Date.now() + days * 86_400_000);
      const to = new Date(from.getTime() + 86_400_000);

      const expiring = await this.prisma.license.findMany({
        where: {
          status: LicenseStatus.ACTIVE,
          expiresAt: { gte: from, lt: to },
          userId: { not: null },
        },
        include: { product: { select: { name: true } }, user: { select: { locale: true } } },
        take: 500,
      });

      for (const license of expiring) {
        await this.notifications.enqueueMulti({
          templateKey: 'license.expiring',
          userId: license.userId!,
          locale: license.user?.locale,
          payload: {
            // Ось дедупликации Telegram-копий: без неё у человека с
            // несколькими лицензиями доходило бы одно предупреждение из N.
            licenseId: license.id,
            productName: license.product.name,
            daysLeft: days,
            expiresAt: license.expiresAt?.toISOString().slice(0, 10) ?? '',
            renewUrl: '',
          },
        });
        sent++;
      }
    }

    if (sent > 0) this.logger.log(`отправлено предупреждений об истечении: ${sent}`);
    return sent;
  }

  // ------------------------------------------------------------- внутреннее

  /**
   * Единственный выход лицензии наружу: `key` заменяется маской. `issue()`
   * через неё не проходит намеренно — новый ключ отдают покупателю один раз.
   */
  private toPublic<T extends { key: string }>(
    license: T,
  ): Omit<T, 'key'> & { maskedKey: string } {
    const { key, ...rest } = license;
    return { ...rest, maskedKey: maskLicenseKey(key) };
  }

  /** Guard пропускает .own и .any, но владельца объекта не знает — проверяем здесь. */
  private assertCanTouch(
    license: { userId: string | null },
    actor: AuthenticatedUser,
    base: string,
  ): void {
    if (resolveScope(actor, base) === 'any' || license.userId === actor.id) return;

    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Недостаточно прав для этого действия',
    });
  }

  /** Снимок «до/после» в журнал — через ту же маску: аудит читает поддержка. */
  private async recordChange(
    action: string,
    before: { id: string; key: string },
    after: { id: string; key: string },
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.audit.record({
      action,
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'license',
      entityId: after.id,
      before: this.toPublic(before),
      after: this.toPublic(after),
    });
  }

  /** Ключ вида FC26-ACDE-FGHJ-KMNP-QRTU. */
  private generateLicenseKey(productSlug: string): string {
    const groups: string[] = [];
    for (let g = 0; g < 4; g++) {
      let group = '';
      for (let i = 0; i < 4; i++) group += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
      groups.push(group);
    }
    return `${productSlug.toUpperCase()}-${groups.join('-')}`;
  }
}
