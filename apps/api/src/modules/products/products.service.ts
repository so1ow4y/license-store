import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * Продукты и тарифы (ТЗ п.3, п.8).
 *
 * Продукт — это то, что покупают: FC 26, GTA V. Тариф определяет срок
 * и цену. Сроки не захардкожены перечислением: акция «14 дней со скидкой»
 * не должна требовать миграции базы.
 */
/** Сборки тарифа для админки: название, версия, опубликована ли. */
const PLAN_BUILDS_INCLUDE = {
  builds: {
    orderBy: { createdAt: 'asc' as const },
    select: { build: { select: { id: true, name: true, version: true, isPublished: true } } },
  },
} satisfies Prisma.LicensePlanInclude;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  //  ЧТЕНИЕ
  // =========================================================================

  /**
   * Каталог для пользователя.
   *
   * Архивные и скрытые не показываются: архивный продукт снят с продажи,
   * скрытый ещё не выпущен. При этом у пользователей могут оставаться
   * действующие лицензии на архивный — они продолжают работать,
   * просто продукт не предлагается к покупке.
   */
  async listPublic() {
    return this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        plans: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            durationDays: true,
            price: true,
            currency: true,
            // Идентификатор товара на площадке. Отдаётся ПУБЛИЧНО намеренно:
            // из него фронт строит ссылку на оплату, а сама эта ссылка и так
            // общедоступна — секретом является ключ продавца, не номер товара.
            // Без этого поля витрина показывает цену, но купить по ней негде.
            digisellerProductId: true,
          },
        },
      },
    });
  }

  /** Полный список для админки, включая архив. */
  async listAll() {
    return this.prisma.product.findMany({
      orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }],
      include: {
        plans: { orderBy: { sortOrder: 'asc' }, include: PLAN_BUILDS_INCLUDE },
        _count: { select: { versions: true, licenses: true } },
      },
    });
  }

  /**
   * Публичная карточка продукта.
   *
   * Фильтр по статусу обязателен, и отдаётся отобранный набор полей,
   * а не запись целиком. Без этого перебор кодов продуктов выдавал бы
   * скрытые и архивные вместе с внутренними полями — то есть ровно то,
   * что закрыто на listAll правом products.manage.
   *
   * Скрытый и архивный отвечают 404, а не 403: подтверждать существование
   * невыпущенного продукта незачем.
   */
  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: ProductStatus.ACTIVE },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        plans: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            durationDays: true,
            price: true,
            currency: true,
            // Идентификатор товара на площадке. Отдаётся ПУБЛИЧНО намеренно:
            // из него фронт строит ссылку на оплату, а сама эта ссылка и так
            // общедоступна — секретом является ключ продавца, не номер товара.
            // Без этого поля витрина показывает цену, но купить по ней негде.
            digisellerProductId: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Продукт не найден' });
    }

    return product;
  }

  /** Карточка для админки: любой статус, все поля. */
  async findByIdForAdmin(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        plans: { orderBy: { sortOrder: 'asc' }, include: PLAN_BUILDS_INCLUDE },
        _count: { select: { versions: true, licenses: true } },
      },
    });

    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Продукт не найден' });
    }

    return product;
  }

  // =========================================================================
  //  ИЗМЕНЕНИЕ
  // =========================================================================

  async create(
    params: {
      slug: string;
      name: string;
      description?: string;
      sortOrder?: number;
      maxHwidResets?: number;
      hwidResetCooldownHours?: number;
    },
    actorId: string,
  ) {
    const exists = await this.prisma.product.findUnique({
      where: { slug: params.slug },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Продукт с таким кодом уже существует',
      });
    }

    const product = await this.prisma.product.create({
      data: {
        id: uuidv7(),
        slug: params.slug,
        name: params.name,
        description: params.description ?? null,
        sortOrder: params.sortOrder ?? 0,
        // NULL означает «брать глобальное значение из настроек».
        // Так лимиты можно задать разными для разных продуктов,
        // не дублируя общее значение в каждом.
        maxHwidResets: params.maxHwidResets ?? null,
        hwidResetCooldownHours: params.hwidResetCooldownHours ?? null,
        status: ProductStatus.HIDDEN,
      },
    });

    await this.audit.record({
      action: 'product.create',
      actorId,
      actorType: 'USER',
      entityType: 'product',
      entityId: product.id,
      after: product,
    });

    return product;
  }

  async update(
    id: string,
    params: Partial<{
      slug: string;
      name: string;
      description: string;
      sortOrder: number;
      status: ProductStatus;
      maxHwidResets: number | null;
      hwidResetCooldownHours: number | null;
    }>,
    actorId: string,
  ) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Продукт не найден' });
    }

    let after;
    try {
      after = await this.prisma.product.update({
        where: { id },
        data: {
          ...params,
          archivedAt:
            params.status === ProductStatus.ARCHIVED
              ? (before.archivedAt ?? new Date())
              : params.status
                ? null
                : before.archivedAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'ALREADY_EXISTS', message: 'Товар с таким кодом уже есть' });
      }
      throw error;
    }

    // Снимок до и после — то, ради чего аудит и существует: по нему видно,
    // что именно изменилось, а не только факт изменения.
    await this.audit.record({
      action: 'product.update',
      actorId,
      actorType: 'USER',
      entityType: 'product',
      entityId: id,
      before,
      after,
    });

    return after;
  }

  /**
   * Архивирование вместо удаления.
   *
   * Удалять продукт нельзя: на него ссылаются лицензии, заказы и версии.
   * Каскад стёр бы историю платежей, а Restrict просто не дал бы удалить.
   * Архив снимает продукт с продажи, не трогая выданное.
   */
  async archive(id: string, actorId: string) {
    return this.update(id, { status: ProductStatus.ARCHIVED }, actorId);
  }

  // =========================================================================
  //  ТАРИФЫ
  // =========================================================================

  async createPlan(
    params: {
      productId: string;
      slug: string;
      name: string;
      /** NULL означает Lifetime. */
      durationDays: number | null;
      price: number;
      currency?: string;
      digisellerProductId?: number;
      sortOrder?: number;
    },
    actorId: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: params.productId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Продукт не найден' });
    }

    if (params.durationDays !== null && params.durationDays < 1) {
      throw new BadRequestException({
        code: 'INVALID_DURATION',
        message: 'Срок должен быть положительным либо NULL для бессрочного тарифа',
      });
    }

    const exists = await this.prisma.licensePlan.findUnique({
      where: { productId_slug: { productId: params.productId, slug: params.slug } },
      select: { id: true },
    });

    if (exists) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Тариф с таким кодом уже есть у этого продукта',
      });
    }

    const plan = await this.prisma.licensePlan.create({
      data: {
        id: uuidv7(),
        productId: params.productId,
        slug: params.slug,
        name: params.name,
        durationDays: params.durationDays,
        price: params.price,
        currency: params.currency ?? 'RUB',
        digisellerProductId: params.digisellerProductId ?? null,
        sortOrder: params.sortOrder ?? 0,
      },
    });

    // Новому тарифу по умолчанию достаётся последняя по дате сборка с файлом.
    const latest = await this.prisma.payloadBuild.findFirst({
      where: { productId: params.productId, fileId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (latest) await this.prisma.planBuild.create({ data: { planId: plan.id, buildId: latest.id } });

    await this.audit.record({
      action: 'plan.create',
      actorId,
      actorType: 'USER',
      entityType: 'license_plan',
      entityId: plan.id,
      after: plan,
    });

    return plan;
  }

  async updatePlan(
    id: string,
    params: Partial<{
      name: string;
      price: number;
      digisellerProductId: number | null;
      isActive: boolean;
      sortOrder: number;
    }>,
    actorId: string,
  ) {
    const before = await this.prisma.licensePlan.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Тариф не найден' });
    }

    // durationDays намеренно НЕ меняется: срок уже выданных по этому тарифу
    // лицензий от правки не изменится, и тариф разойдётся со своей историей.
    // Нужен другой срок — заводится новый тариф, старый отключается.
    const after = await this.prisma.licensePlan.update({ where: { id }, data: params });

    await this.audit.record({
      action: 'plan.update',
      actorId,
      actorType: 'USER',
      entityType: 'license_plan',
      entityId: id,
      before,
      after,
    });

    return after;
  }
}
