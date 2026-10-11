import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HwidEventReason,
  LicenseStatus,
  Prisma,
  ProductStatus,
  ResellerStatus,
  ResellerTxType,
  type Reseller,
} from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { PermissionsService } from '@common/rbac/permissions.service';
import { maskLicenseKey } from '@common/utils/license-key';
import { RegistrationKeyService } from '@modules/auth/registration-key.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';
import { HwidService } from '@modules/hwid/hwid.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import type {
  ChangeBalanceDto,
  CreateResellerDto,
  IssueKeysDto,
  ListClientLicensesDto,
  ListKeysDto,
  ListResellersDto,
  UpdateResellerDto,
} from './dto/resellers.dto';

/**
 * Реселлеры — оптовые продавцы (ТЗ п.2, п.9).
 *
 * Деньги ходят так: реселлер платит платформе вперёд, администратор
 * пополняет его баланс. Реселлер выпускает со своего баланса ключи активации
 * по цене тарифа минус свою скидку и продаёт их своим покупателям по своей
 * цене — разница и есть его заработок. Покупатель активирует ключ в кабинете
 * (или регистрируется по нему), получает лицензию и становится клиентом
 * реселлера: тот видит его лицензии, продлевает их со своего баланса и
 * сбрасывает привязку в пределах суточного лимита.
 *
 * Баланс меняется ТОЛЬКО условным UPDATE внутри транзакции вместе со строкой
 * журнала: две одновременные покупки не уводят баланс ниже кредитного лимита,
 * а журнал всегда сходится с балансом.
 */

const DAY_MS = 86_400_000;

type Money = Prisma.Decimal;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

@Injectable()
export class ResellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
    private readonly registrationKeys: RegistrationKeyService,
    private readonly licenses: LicensesService,
    private readonly hwid: HwidService,
  ) {}

  // =====================================================================
  //  Деньги
  // =====================================================================

  /** Цена для реселлера: цена тарифа минус скидка, до копеек вверх не округляем. */
  static priceFor(planPrice: Money, discountPercent: Money): Money {
    return planPrice
      .mul(D(100).minus(discountPercent))
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  /**
   * Списание: условие «не ниже кредитного лимита» и статус ACTIVE стоят в
   * самом UPDATE, поэтому параллельные покупки не проскакивают проверку.
   */
  private async debit(
    tx: Prisma.TransactionClient,
    reseller: Reseller,
    amount: Money,
    entry: Omit<Prisma.ResellerTransactionUncheckedCreateInput, 'id' | 'resellerId' | 'amount' | 'balanceAfter' | 'type'>,
  ): Promise<Money> {
    const rows = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
      UPDATE resellers
         SET balance = balance - ${amount}::numeric, updated_at = now()
       WHERE id = ${reseller.id}::uuid
         AND status = 'ACTIVE'
         AND balance - ${amount}::numeric >= -credit_limit
      RETURNING balance`;
    const row = rows[0];
    if (!row) {
      throw new ConflictException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Недостаточно средств на балансе',
        details: { needed: amount.toFixed(2), balance: reseller.balance.toFixed(2), creditLimit: reseller.creditLimit.toFixed(2) },
      });
    }
    await tx.resellerTransaction.create({
      data: {
        id: uuidv7(),
        resellerId: reseller.id,
        type: ResellerTxType.SALE,
        amount: amount.negated(),
        balanceAfter: row.balance,
        currency: reseller.currency,
        ...entry,
      },
    });
    return D(row.balance);
  }

  /** Зачисление или корректировка — без проверки лимита (это решает администратор). */
  async credit(
    tx: Prisma.TransactionClient,
    resellerId: string,
    amount: Money,
    entry: Omit<Prisma.ResellerTransactionUncheckedCreateInput, 'id' | 'resellerId' | 'amount' | 'balanceAfter'>,
    /** id строки журнала, если вызывающему нужно на неё сослаться. */
    transactionId: string = uuidv7(),
  ): Promise<Money> {
    const rows = await tx.$queryRaw<{ balance: Prisma.Decimal; currency: string }[]>`
      UPDATE resellers SET balance = balance + ${amount}::numeric, updated_at = now()
       WHERE id = ${resellerId}::uuid
      RETURNING balance, currency`;
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'RESELLER_NOT_FOUND', message: 'Реселлер не найден' });
    await tx.resellerTransaction.create({
      data: { id: transactionId, resellerId, amount, balanceAfter: row.balance, currency: row.currency, ...entry },
    });
    return D(row.balance);
  }

  // =====================================================================
  //  Панель реселлера
  // =====================================================================

  /** Карточка реселлера текущего пользователя; без неё панели нет. */
  private async mine(userId: string): Promise<Reseller> {
    const reseller = await this.prisma.reseller.findUnique({ where: { userId } });
    if (!reseller) {
      throw new NotFoundException({ code: 'RESELLER_NOT_FOUND', message: 'Этот аккаунт не реселлер' });
    }
    return reseller;
  }

  private assertCanSell(reseller: Reseller): void {
    if (reseller.status !== ResellerStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'RESELLER_INACTIVE',
        message: 'Продажи приостановлены администратором',
      });
    }
  }

  private assertProductAllowed(reseller: Reseller, productId: string): void {
    if (reseller.allowedProductIds.length > 0 && !reseller.allowedProductIds.includes(productId)) {
      throw new ForbiddenException({ code: 'PRODUCT_NOT_ALLOWED', message: 'Этот товар вам продавать не разрешено' });
    }
  }

  /** Профиль, цены и сводка продаж. */
  async overview(userId: string) {
    const reseller = await this.mine(userId);
    const since30 = new Date(Date.now() - 30 * DAY_MS);

    const [products, keyStats, licensesActive, clients, sales30] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          status: { not: ProductStatus.ARCHIVED },
          ...(reseller.allowedProductIds.length ? { id: { in: reseller.allowedProductIds } } : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          slug: true,
          name: true,
          plans: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
            select: { id: true, slug: true, name: true, durationDays: true, price: true, currency: true },
          },
        },
      }),
      this.prisma.$queryRaw<{ unused: number; used: number; cancelled: number }[]>`
        SELECT count(*) FILTER (WHERE used_at IS NULL AND cancelled_at IS NULL AND (expires_at IS NULL OR expires_at > now()))::int AS unused,
               count(*) FILTER (WHERE used_at IS NOT NULL)::int AS used,
               count(*) FILTER (WHERE cancelled_at IS NOT NULL)::int AS cancelled
          FROM registration_keys WHERE reseller_id = ${reseller.id}::uuid`,
      this.prisma.license.count({ where: { resellerId: reseller.id, status: LicenseStatus.ACTIVE } }),
      this.prisma.user.count({ where: { resellerId: reseller.id } }),
      this.prisma.resellerTransaction.aggregate({
        where: { resellerId: reseller.id, type: ResellerTxType.SALE, createdAt: { gte: since30 } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      reseller: this.view(reseller),
      catalog: products
        .filter((p) => p.plans.length > 0)
        .map((p) => ({
          ...p,
          plans: p.plans.map((plan) => ({
            ...plan,
            resellerPrice: ResellersService.priceFor(plan.price, reseller.discountPercent),
          })),
        })),
      stats: {
        keys: keyStats[0] ?? { unused: 0, used: 0, cancelled: 0 },
        licensesActive,
        clients,
        spent30d: (sales30._sum.amount ?? D(0)).negated(),
        operations30d: sales30._count,
      },
    };
  }

  /** Выпуск ключей активации со своего баланса. Коды показываются один раз — здесь. */
  async issueKeys(actor: AuthenticatedUser, dto: IssueKeysDto) {
    const reseller = await this.mine(actor.id);
    this.assertCanSell(reseller);

    const plan = await this.prisma.licensePlan.findUnique({
      where: { id: dto.planId },
      include: { product: { select: { id: true, status: true, name: true } } },
    });
    if (!plan || !plan.isActive || plan.product.status === ProductStatus.ARCHIVED) {
      throw new BadRequestException({ code: 'PLAN_NOT_AVAILABLE', message: 'Тариф недоступен' });
    }
    this.assertProductAllowed(reseller, plan.productId);
    if (plan.currency !== reseller.currency) {
      throw new BadRequestException({ code: 'CURRENCY_MISMATCH', message: 'Валюта тарифа не совпадает с валютой баланса' });
    }

    const unit = ResellersService.priceFor(plan.price, reseller.discountPercent);
    const total = unit.mul(dto.count);
    const expiresAt = dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * DAY_MS) : undefined;

    const { keys, balance } = await this.prisma.$transaction(async (tx) => {
      const balance = await this.debit(tx, reseller, total, {
        planId: plan.id,
        quantity: dto.count,
        comment: dto.note ?? null,
        createdById: actor.id,
      });
      const keys = await this.registrationKeys.issueForReseller(tx, {
        resellerId: reseller.id,
        productId: plan.productId,
        planId: plan.id,
        count: dto.count,
        price: unit,
        expiresAt,
        createdById: actor.id,
      });
      return { keys, balance };
    });

    // Коды в журнал не пишем: это предъявительские документы.
    await this.audit.record({
      action: 'reseller.keys.issue',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller',
      entityId: reseller.id,
      after: { planId: plan.id, count: dto.count, unitPrice: unit.toFixed(2), total: total.toFixed(2) },
    });

    return {
      codes: keys.map((k) => k.code),
      product: plan.product.name,
      plan: plan.name,
      unitPrice: unit,
      total,
      balance,
    };
  }

  /**
   * Ключи реселлера. Неиспользованный ключ виден целиком — он ещё у реселлера
   * и должен уйти покупателю. Использованный и отменённый — только маской:
   * после активации ключ принадлежит покупателю.
   */
  async listKeys(userId: string, dto: ListKeysDto) {
    const reseller = await this.mine(userId);
    const now = new Date();
    const stateWhere: Prisma.RegistrationKeyWhereInput =
      dto.state === 'used'
        ? { usedAt: { not: null } }
        : dto.state === 'cancelled'
          ? { cancelledAt: { not: null } }
          : dto.state === 'expired'
            ? { usedAt: null, cancelledAt: null, expiresAt: { lte: now } }
            : dto.state === 'unused'
              ? { usedAt: null, cancelledAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
              : {};
    const where: Prisma.RegistrationKeyWhereInput = { resellerId: reseller.id, ...stateWhere };
    const take = dto.take ?? 50;
    const skip = dto.skip ?? 0;

    const [rows, total] = await Promise.all([
      this.prisma.registrationKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          code: true,
          price: true,
          createdAt: true,
          expiresAt: true,
          usedAt: true,
          cancelledAt: true,
          product: { select: { name: true } },
          plan: { select: { name: true, durationDays: true } },
          usedByUser: { select: { username: true } },
        },
      }),
      this.prisma.registrationKey.count({ where }),
    ]);

    return {
      items: rows.map((row) => {
        const state = row.usedAt
          ? 'used'
          : row.cancelledAt
            ? 'cancelled'
            : row.expiresAt && row.expiresAt <= now
              ? 'expired'
              : 'unused';
        return {
          id: row.id,
          code: state === 'unused' ? row.code : maskCode(row.code),
          state,
          price: row.price,
          product: row.product?.name ?? null,
          plan: row.plan?.name ?? null,
          durationDays: row.plan?.durationDays ?? null,
          usedBy: row.usedByUser?.username ?? null,
          usedAt: row.usedAt,
          expiresAt: row.expiresAt,
          cancelledAt: row.cancelledAt,
          createdAt: row.createdAt,
          // Отменить можно всё, что не активировано, — в том числе истёкший ключ.
          cancellable: !row.usedAt && !row.cancelledAt,
        };
      }),
      total,
      skip,
      take,
    };
  }

  /** Отмена неиспользованного ключа: ключ гаснет, деньги возвращаются на баланс. */
  async cancelKey(actor: AuthenticatedUser, keyId: string) {
    const reseller = await this.mine(actor.id);
    if (reseller.status === ResellerStatus.CLOSED) {
      throw new ForbiddenException({ code: 'RESELLER_INACTIVE', message: 'Сотрудничество закрыто' });
    }

    const balance = await this.prisma.$transaction(async (tx) => {
      const key = await tx.registrationKey.findFirst({
        where: { id: keyId, resellerId: reseller.id },
        select: { id: true, price: true, planId: true },
      });
      if (!key) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ключ не найден' });

      // Условие в UPDATE: из «отменить» и «активировать» побеждает одно.
      const cancelled = await tx.registrationKey.updateMany({
        where: { id: key.id, usedAt: null, cancelledAt: null },
        data: { cancelledAt: new Date() },
      });
      if (cancelled.count === 0) {
        throw new ConflictException({ code: 'KEY_NOT_CANCELLABLE', message: 'Ключ уже активирован или отменён' });
      }

      const refund = key.price ?? D(0);
      return refund.gt(0)
        ? this.credit(tx, reseller.id, refund, {
            type: ResellerTxType.REFUND,
            registrationKeyId: key.id,
            planId: key.planId,
            quantity: 1,
            comment: 'отмена неиспользованного ключа',
            createdById: actor.id,
          })
        : reseller.balance;
    });

    await this.audit.record({
      action: 'reseller.key.cancel',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'registration_key',
      entityId: keyId,
    });
    return { balance };
  }

  /** Лицензии, проданные реселлером. Ключ — только маской: он у покупателя. */
  async listLicenses(userId: string, dto: ListClientLicensesDto) {
    const reseller = await this.mine(userId);
    const search = dto.search?.trim();
    const where: Prisma.LicenseWhereInput = {
      resellerId: reseller.id,
      ...(search
        ? {
            OR: [
              { key: { contains: search, mode: 'insensitive' } },
              { user: { username: { contains: search, mode: 'insensitive' } } },
              { product: { name: { contains: search, mode: 'insensitive' } } },
              { plan: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const take = dto.take ?? 50;
    const skip = dto.skip ?? 0;

    const [rows, total, resetsToday] = await Promise.all([
      this.prisma.license.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          key: true,
          status: true,
          issuedAt: true,
          activatedAt: true,
          expiresAt: true,
          currentDeviceId: true,
          hwidResetCount: true,
          lastCheckAt: true,
          productId: true,
          product: { select: { name: true } },
          plan: { select: { name: true, durationDays: true } },
          user: { select: { username: true } },
          registrationKey: { select: { usedAt: true } },
        },
      }),
      this.prisma.license.count({ where }),
      this.resetsToday(userId),
    ]);

    return {
      items: rows.map(({ key, currentDeviceId, registrationKey, ...row }) => ({
        ...row,
        maskedKey: maskLicenseKey(key),
        bound: currentDeviceId !== null,
        // Когда клиент активировал ключ (до первого запуска лицензия PENDING).
        claimedAt: registrationKey?.usedAt ?? row.issuedAt,
      })),
      total,
      skip,
      take,
      hwidResets: { usedToday: resetsToday, dailyLimit: reseller.hwidResetDailyLimit },
    };
  }

  /** Продление проданной лицензии со своего баланса. */
  async extendLicense(actor: AuthenticatedUser, licenseId: string, planId: string) {
    const reseller = await this.mine(actor.id);
    this.assertCanSell(reseller);

    const [license, plan] = await Promise.all([
      this.prisma.license.findFirst({
        where: { id: licenseId, resellerId: reseller.id },
        select: { id: true, productId: true, status: true },
      }),
      this.prisma.licensePlan.findUnique({ where: { id: planId } }),
    ]);
    if (!license) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });
    if (!plan || !plan.isActive || plan.productId !== license.productId) {
      throw new BadRequestException({ code: 'PLAN_MISMATCH', message: 'Тариф не от товара этой лицензии' });
    }
    this.assertProductAllowed(reseller, license.productId);
    // Состояния, при которых продление не пройдёт, отсекаются ДО списания.
    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException({ code: 'LICENSE_REVOKED', message: 'Отозванную лицензию продлить нельзя' });
    }
    if (license.status === LicenseStatus.PENDING && plan.durationDays !== null) {
      throw new ConflictException({
        code: 'LICENSE_NOT_ACTIVATED',
        message: 'Лицензия ещё не активирована. Срок начнётся с первого запуска.',
      });
    }

    const price = ResellersService.priceFor(plan.price, reseller.discountPercent);
    await this.prisma.$transaction((tx) =>
      this.debit(tx, reseller, price, {
        planId: plan.id,
        quantity: 1,
        licenseId: license.id,
        comment: 'продление лицензии клиента',
        createdById: actor.id,
      }),
    );

    try {
      const updated = await this.licenses.extendForReseller(license.id, reseller.id, actor, plan.id);
      return { license: updated, price };
    } catch (error) {
      // Продление не состоялось — деньги возвращаются той же суммой.
      await this.prisma.$transaction((tx) =>
        this.credit(tx, reseller.id, price, {
          type: ResellerTxType.REFUND,
          licenseId: license.id,
          planId: plan.id,
          quantity: 1,
          comment: 'продление не выполнено',
          createdById: actor.id,
        }),
      );
      throw error;
    }
  }

  /** Сброс привязки клиенту в пределах суточного лимита реселлера. */
  async resetHwid(actor: AuthenticatedUser, licenseId: string, ip?: string) {
    const reseller = await this.mine(actor.id);
    if (reseller.status === ResellerStatus.CLOSED) {
      throw new ForbiddenException({ code: 'RESELLER_INACTIVE', message: 'Сотрудничество закрыто' });
    }
    const license = await this.prisma.license.findFirst({
      where: { id: licenseId, resellerId: reseller.id },
      select: { id: true },
    });
    if (!license) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Лицензия не найдена' });

    // Считается по истории, а не отдельным счётчиком: его пришлось бы
    // обнулять кроном, и он разъезжался бы с фактом.
    const used = await this.resetsToday(actor.id);
    if (used >= reseller.hwidResetDailyLimit) {
      throw new ConflictException({
        code: 'RESELLER_DAILY_LIMIT',
        message: `Исчерпан суточный лимит сбросов (${reseller.hwidResetDailyLimit})`,
        details: { limit: reseller.hwidResetDailyLimit },
      });
    }

    await this.hwid.resetByReseller(license.id, actor, ip);
    return { usedToday: used + 1, dailyLimit: reseller.hwidResetDailyLimit };
  }

  private resetsToday(userId: string): Promise<number> {
    return this.prisma.hwidHistory.count({
      where: { actorId: userId, reason: HwidEventReason.RESELLER_RESET, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
  }

  async myTransactions(userId: string, page: { skip?: number; take?: number }) {
    const reseller = await this.mine(userId);
    return this.transactions(reseller.id, page);
  }

  // =====================================================================
  //  Администрирование
  // =====================================================================

  async list(dto: ListResellersDto) {
    const search = dto.search?.trim();
    const where: Prisma.ResellerWhereInput = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { user: { username: { contains: search, mode: 'insensitive' } } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const take = dto.take ?? 50;
    const skip = dto.skip ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.reseller.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { id: true, username: true, email: true } },
          _count: { select: { clients: true, licenses: true, registrationKeys: true } },
        },
      }),
      this.prisma.reseller.count({ where }),
    ]);

    // Продажи за 30 дней одним запросом на страницу, а не по запросу на строку.
    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const sales = rows.length
      ? await this.prisma.resellerTransaction.groupBy({
          by: ['resellerId'],
          where: { resellerId: { in: rows.map((r) => r.id) }, type: ResellerTxType.SALE, createdAt: { gte: since30 } },
          _sum: { amount: true },
        })
      : [];
    const salesBy = new Map(sales.map((s) => [s.resellerId, (s._sum.amount ?? D(0)).negated()]));

    return {
      items: rows.map(({ _count, user, ...row }) => ({
        ...this.view(row),
        user,
        clients: _count.clients,
        licenses: _count.licenses,
        keys: _count.registrationKeys,
        sales30d: salesBy.get(row.id) ?? D(0),
      })),
      total,
      skip,
      take,
    };
  }

  /**
   * Кандидаты в реселлеры для подсказки в форме: аккаунты по логину или почте,
   * по алфавиту. Уже реселлеры возвращаются с отметкой — их видно, но выбрать
   * нельзя. Свой аккаунт тоже в списке: администратор может продавать сам.
   */
  async candidates(search: string | undefined, page: { skip?: number; take?: number }) {
    const needle = search?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      status: { not: 'DELETED' },
      ...(needle
        ? {
            OR: [
              { username: { contains: needle, mode: 'insensitive' } },
              { email: { contains: needle, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const take = Math.min(page.take ?? 30, 100);
    const skip = page.skip ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { username: 'asc' },
        skip,
        take,
        select: {
          id: true,
          username: true,
          email: true,
          status: true,
          resellerProfile: { select: { id: true } },
          roles: { select: { role: { select: { name: true, priority: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map(({ resellerProfile, roles, ...user }) => ({
        ...user,
        isReseller: resellerProfile !== null,
        /** Старшая роль — чтобы отличить сотрудника от покупателя. */
        role: roles.map((r) => r.role).sort((a, b) => b.priority - a.priority)[0]?.name ?? null,
      })),
      total,
      skip,
      take,
    };
  }

  async create(actor: AuthenticatedUser, dto: CreateResellerDto) {
    const user = await this.prisma.user.findFirst({
      where: { username: { equals: dto.username.trim(), mode: 'insensitive' }, deletedAt: null },
      select: { id: true, username: true, resellerProfile: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Пользователь с таким логином не найден' });
    if (user.resellerProfile) {
      throw new ConflictException({ code: 'ALREADY_RESELLER', message: 'Этот пользователь уже реселлер' });
    }
    await this.assertProductsExist(dto.allowedProductIds);

    const role = await this.prisma.role.findUniqueOrThrow({ where: { slug: 'reseller' } });
    const id = uuidv7();
    await this.prisma.$transaction([
      this.prisma.reseller.create({
        data: {
          id,
          userId: user.id,
          displayName: dto.displayName.trim(),
          discountPercent: dto.discountPercent ?? 0,
          creditLimit: dto.creditLimit ?? 0,
          allowedProductIds: dto.allowedProductIds ?? [],
          hwidResetDailyLimit: dto.hwidResetDailyLimit ?? 10,
          notes: dto.notes?.trim() || null,
          createdById: actor.id,
        },
      }),
      this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id, grantedById: actor.id },
      }),
    ]);
    // Права кэшируются: без сброса панель появилась бы через пять минут.
    await this.permissions.invalidate(user.id);

    await this.audit.record({
      action: 'reseller.create',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller',
      entityId: id,
      after: { userId: user.id, username: user.username, displayName: dto.displayName, discountPercent: dto.discountPercent ?? 0 },
    });
    return this.get(id);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateResellerDto) {
    const before = await this.load(id);
    await this.assertProductsExist(dto.allowedProductIds);
    await this.prisma.reseller.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.discountPercent !== undefined ? { discountPercent: dto.discountPercent } : {}),
        ...(dto.creditLimit !== undefined ? { creditLimit: dto.creditLimit } : {}),
        ...(dto.allowedProductIds !== undefined ? { allowedProductIds: dto.allowedProductIds } : {}),
        ...(dto.hwidResetDailyLimit !== undefined ? { hwidResetDailyLimit: dto.hwidResetDailyLimit } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
      },
    });
    await this.audit.record({
      action: 'reseller.update',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller',
      entityId: id,
      before: this.view(before),
      after: dto,
    });
    return this.get(id);
  }

  /** Пополнение, бонус или корректировка баланса администратором. */
  async changeBalance(actor: AuthenticatedUser, id: string, dto: ChangeBalanceDto) {
    await this.load(id);
    if (dto.type !== ResellerTxType.ADJUSTMENT && dto.amount <= 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Пополнение и бонус — только положительной суммой' });
    }
    const balance = await this.prisma.$transaction((tx) =>
      this.credit(tx, id, D(dto.amount), {
        type: dto.type,
        comment: dto.comment?.trim() || null,
        createdById: actor.id,
      }),
    );
    await this.audit.record({
      action: 'reseller.balance',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller',
      entityId: id,
      after: { type: dto.type, amount: dto.amount, balance: balance.toFixed(2), comment: dto.comment ?? null },
    });
    return { balance };
  }

  async get(id: string) {
    const row = await this.prisma.reseller.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true } },
        _count: { select: { clients: true, licenses: true, registrationKeys: true } },
      },
    });
    if (!row) throw new NotFoundException({ code: 'RESELLER_NOT_FOUND', message: 'Реселлер не найден' });
    const { _count, user, ...rest } = row;
    return { ...this.view(rest), user, clients: _count.clients, licenses: _count.licenses, keys: _count.registrationKeys };
  }

  async transactions(resellerId: string, page: { skip?: number; take?: number }) {
    const take = page.take ?? 50;
    const skip = page.skip ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.resellerTransaction.findMany({
        where: { resellerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.resellerTransaction.count({ where: { resellerId } }),
    ]);

    const planIds = [...new Set(rows.map((r) => r.planId).filter((v): v is string => Boolean(v)))];
    const plans = planIds.length
      ? await this.prisma.licensePlan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, name: true, product: { select: { name: true } } },
        })
      : [];
    const planBy = new Map(plans.map((p) => [p.id, `${p.product.name} · ${p.name}`]));

    return {
      items: rows.map((row) => ({ ...row, planLabel: row.planId ? (planBy.get(row.planId) ?? null) : null })),
      total,
      skip,
      take,
    };
  }

  // ------------------------------------------------------------ внутреннее

  private async load(id: string): Promise<Reseller> {
    const row = await this.prisma.reseller.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'RESELLER_NOT_FOUND', message: 'Реселлер не найден' });
    return row;
  }

  private async assertProductsExist(ids?: string[]): Promise<void> {
    if (!ids?.length) return;
    const found = await this.prisma.product.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) {
      throw new BadRequestException({ code: 'PRODUCT_NOT_FOUND', message: 'Один из товаров не найден' });
    }
  }

  private view(row: Reseller) {
    return {
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      status: row.status,
      balance: row.balance,
      currency: row.currency,
      discountPercent: row.discountPercent,
      creditLimit: row.creditLimit,
      allowedProductIds: row.allowedProductIds,
      hwidResetDailyLimit: row.hwidResetDailyLimit,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/** ACDE-****-****-QRTU: узнаваемо в списке, но не годится для активации. */
function maskCode(code: string): string {
  const parts = code.split('-');
  if (parts.length < 3) return '****';
  return [parts[0], ...parts.slice(1, -1).map(() => '****'), parts[parts.length - 1]].join('-');
}
