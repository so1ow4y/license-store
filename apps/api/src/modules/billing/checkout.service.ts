import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  NotificationChannel,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { ENV, type Env } from '@common/config/env.schema';
import { PrismaService } from '@common/prisma/prisma.service';
import { resolveScope } from '@common/rbac/scope';
import { SettingsService } from '@common/settings/settings.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';
import { NotificationService } from '@modules/notifications/notification.service';

import { FulfillmentService } from './fulfillment.service';
import { PaymentProfilesService, type CheckoutTarget } from './payment-profiles.service';
import {
  YookassaClient,
  YookassaRejectedError,
  YookassaUnavailableError,
  type YookassaPayment,
} from './yookassa.client';

/**
 * Покупка на сайте: заказ, оплата через ЮKassa или переводом криптовалюты,
 * выдача лицензии. Digiseller живёт отдельно (DigisellerService): там
 * покупатель платит на площадке и приносит код.
 *
 * Состояния: заказ PENDING → PAID → DELIVERED, либо CANCELLED. Каждый переход
 * — условный UPDATE по текущему статусу, поэтому повторный вебхук или двойной
 * клик администратора не выдадут вторую лицензию.
 */

export type CheckoutProvider = 'YOOKASSA' | 'CRYPTO';

/** Сколько неоплаченных заказов может висеть у одного покупателя. */
const MAX_PENDING_ORDERS_PER_USER = 5;
/** Сколько ЮKassa держит неоплаченный платёж; дальше заказ отменяем. */
const YOOKASSA_PENDING_HOURS = 48;
const TX_HASH_RE = /^(0x)?[A-Za-z0-9]{16,128}$/;

const ORDER_SELECT = {
  id: true,
  number: true,
  userId: true,
  productId: true,
  planId: true,
  amount: true,
  currency: true,
  status: true,
  source: true,
  comment: true,
  createdAt: true,
  paidAt: true,
  deliveredAt: true,
  cancelledAt: true,
  product: { select: { id: true, name: true } },
  plan: { select: { id: true, name: true, durationDays: true } },
  user: { select: { id: true, username: true } },
  licenses: { select: { id: true } },
  payments: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      provider: true,
      profileId: true,
      method: true,
      status: true,
      externalId: true,
      instructions: true,
      submittedAt: true,
      confirmedAt: true,
      failedAt: true,
      errorMessage: true,
    },
  },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: PaymentProfilesService,
    private readonly yookassa: YookassaClient,
    private readonly fulfillment: FulfillmentService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------------------------------------------------------------- заказ

  async createOrder(userId: string, input: { planId: string; provider: CheckoutProvider; walletId?: string }) {
    const plan = await this.prisma.licensePlan.findUnique({
      where: { id: input.planId },
      include: { product: { select: { name: true, status: true } } },
    });
    if (!plan || !plan.isActive || plan.product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException({ code: 'PLAN_NOT_AVAILABLE', message: 'Тариф недоступен для покупки' });
    }
    if (plan.price.lte(0)) {
      throw new BadRequestException({ code: 'PLAN_NOT_FOR_SALE', message: 'Этот тариф не продаётся' });
    }

    // Реквизиты — у товара: шаблон или свои.
    const target = await this.profiles.resolveForCheckout(plan.productId, input.provider, input.walletId);

    const pending = await this.prisma.order.count({
      where: { userId, status: OrderStatus.PENDING, source: OrderSource.WEBSITE },
    });
    if (pending >= MAX_PENDING_ORDERS_PER_USER) {
      throw new ConflictException({
        code: 'TOO_MANY_PENDING_ORDERS',
        message: 'У вас уже есть неоплаченные заказы. Оплатите или отмените их.',
      });
    }

    // Всё, что может отказать по вводу, проверяется ДО создания заказа.
    const instructions =
      input.provider === 'CRYPTO'
        ? this.cryptoInstructions(target as CheckoutTarget<'CRYPTO'>, plan.price, target.walletId)
        : null;
    const receiptEmail =
      input.provider === 'YOOKASSA'
        ? await this.receiptEmail(userId, (target as CheckoutTarget<'YOOKASSA'>).config.sendReceipt)
        : undefined;

    const orderId = uuidv7();
    const paymentId = uuidv7();
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          id: orderId,
          userId,
          productId: plan.productId,
          planId: plan.id,
          amount: plan.price,
          currency: plan.currency,
          status: OrderStatus.PENDING,
          source: OrderSource.WEBSITE,
        },
        select: { number: true },
      });
      await tx.payment.create({
        data: {
          id: paymentId,
          orderId,
          provider: input.provider,
          profileId: target.profileId,
          method: input.provider === 'CRYPTO' ? PaymentMethod.CRYPTO : PaymentMethod.OTHER,
          status: PaymentStatus.PENDING,
          amount: plan.price,
          currency: plan.currency,
          instructions: instructions ?? undefined,
        },
      });
      return created;
    });

    if (input.provider === 'YOOKASSA') {
      await this.startYookassa(target as CheckoutTarget<'YOOKASSA'>, {
        orderId,
        paymentId,
        orderNumber: order.number,
        amount: plan.price,
        currency: plan.currency,
        description: `${plan.product.name} — ${plan.name} (заказ ${order.number})`,
        receiptEmail,
      });
    }

    await this.audit.record({
      action: 'order.create',
      actorId: userId,
      actorType: 'USER',
      entityType: 'order',
      entityId: orderId,
      after: { provider: input.provider, planId: plan.id, amount: plan.price.toFixed(2), currency: plan.currency },
    });

    return this.viewById(orderId);
  }

  /** Покупатель сообщает хеш транзакции — заказ уходит на проверку администратору. */
  async submitCryptoTx(userId: string, orderId: string, rawTxHash: string) {
    const order = await this.loadOwn(userId, orderId);
    const payment = this.paymentOf(order);

    if (payment.provider !== PaymentProvider.CRYPTO) {
      throw new BadRequestException({ code: 'NOT_CRYPTO_ORDER', message: 'Заказ оплачивается не криптовалютой' });
    }
    this.assertPending(order);
    if (payment.status !== PaymentStatus.PENDING) {
      throw new ConflictException({ code: 'ORDER_NOT_PENDING', message: 'Оплата по заказу уже рассмотрена' });
    }

    const txHash = normalizeTxHash(rawTxHash);
    // Тот же перевод не может оплатить и заказ, и пополнение баланса реселлера.
    const usedByTopup = await this.prisma.resellerTopup.findUnique({ where: { txHash }, select: { id: true } });
    if (usedByTopup) {
      throw new ConflictException({ code: 'TX_ALREADY_USED', message: 'Эта транзакция уже указана в другом платеже' });
    }
    try {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { externalId: txHash, submittedAt: new Date() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'TX_ALREADY_USED', message: 'Эта транзакция уже указана в другом заказе' });
      }
      throw error;
    }

    await this.audit.record({
      action: 'order.crypto_submitted',
      actorId: userId,
      actorType: 'USER',
      entityType: 'order',
      entityId: orderId,
      after: { txHash },
    });

    // Повторная отправка хеша (исправили опечатку) не будит админов второй раз.
    if (!payment.submittedAt) await this.notifyAdmins(orderId);
    return this.viewById(orderId);
  }

  /** Отмена покупателем — только крипта, пока не прислан хеш. ЮKassa отменяет платёж сама. */
  async cancelByUser(userId: string, orderId: string) {
    const order = await this.loadOwn(userId, orderId);
    const payment = this.paymentOf(order);
    this.assertPending(order);

    if (payment.provider !== PaymentProvider.CRYPTO || payment.submittedAt) {
      throw new ConflictException({
        code: 'ORDER_CANCEL_NOT_ALLOWED',
        message: 'Этот заказ нельзя отменить: оплата уже в обработке',
      });
    }

    await this.cancel(order.id, payment.id, 'отменён покупателем');
    return this.viewById(orderId);
  }

  // -------------------------------------------------------- администратор

  /** Ручное подтверждение оплаты (крипта): выдаёт лицензию. */
  async confirmByAdmin(adminId: string, orderId: string, note?: string) {
    const order = await this.loadAny(orderId);
    const payment = this.paymentOf(order);
    this.assertPending(order);

    if (payment.provider === PaymentProvider.YOOKASSA) {
      throw new BadRequestException({
        code: 'MANUAL_CONFIRM_NOT_ALLOWED',
        message: 'Оплату ЮKassa подтверждает сама ЮKassa — обновите статус заказа',
      });
    }

    const licenseId = await this.markPaidAndDeliver(order, payment.id, {
      reviewedById: adminId,
      comment: note,
    });
    if (!licenseId) throw new ConflictException({ code: 'ORDER_NOT_PENDING', message: 'Заказ уже обработан' });

    await this.audit.record({
      action: 'order.confirm',
      actorId: adminId,
      actorType: 'USER',
      entityType: 'order',
      entityId: orderId,
      after: { licenseId, note: note ?? null },
    });
    return this.viewById(orderId);
  }

  async rejectByAdmin(adminId: string, orderId: string, reason: string) {
    const order = await this.loadAny(orderId);
    const payment = this.paymentOf(order);
    this.assertPending(order);

    await this.cancel(order.id, payment.id, reason, adminId);

    if (order.userId) {
      await this.notifications.enqueue({
        templateKey: 'order.rejected',
        channel: NotificationChannel.EMAIL,
        userId: order.userId,
        payload: { orderNumber: order.number, productName: order.product.name, reason },
      });
    }

    await this.audit.record({
      action: 'order.reject',
      actorId: adminId,
      actorType: 'USER',
      entityType: 'order',
      entityId: orderId,
      after: { reason },
    });
    return this.viewById(orderId);
  }

  // ---------------------------------------------------------------- ЮKassa

  /** Уведомление ЮKassa. Телу не доверяем: статус перечитывается из API нашими ключами. */
  async handleYookassaWebhook(body: unknown): Promise<void> {
    const paymentId = (body as { object?: { id?: unknown } } | null)?.object?.id;
    if (typeof paymentId !== 'string' || paymentId.length > 64) return;

    const payment = await this.prisma.payment.findUnique({
      where: { provider_externalId: { provider: PaymentProvider.YOOKASSA, externalId: paymentId } },
      select: { id: true, orderId: true, externalId: true, profileId: true },
    });
    if (!payment) return;

    await this.syncYookassa(payment);
  }

  /** Обновить статус заказа по запросу покупателя (вернулся со страницы оплаты). */
  async refresh(actor: AuthenticatedUser, orderId: string) {
    const order = await this.loadVisible(actor, orderId);
    const payment = this.paymentOf(order);
    if (order.status === OrderStatus.PENDING && payment.provider === PaymentProvider.YOOKASSA && payment.externalId) {
      await this.syncYookassa({
        id: payment.id,
        orderId: order.id,
        externalId: payment.externalId,
        profileId: payment.profileId,
      });
    }
    return this.viewById(orderId);
  }

  /** Сверка с ЮKassa ключами того магазина, где создан платёж. */
  async syncYookassa(payment: {
    id: string;
    orderId: string;
    externalId: string | null;
    profileId: string | null;
  }): Promise<void> {
    if (!payment.externalId) return;
    const target = await this.profiles.forPayment(payment.profileId, 'YOOKASSA');
    const { shopId, secretKey } = target?.secrets ?? {};
    if (!shopId || !secretKey) return;

    let remote: YookassaPayment;
    try {
      remote = await this.yookassa.getPayment({ shopId, secretKey }, payment.externalId);
    } catch (error) {
      if (error instanceof YookassaUnavailableError) {
        throw new ServiceUnavailableException({ code: 'PROVIDER_UNAVAILABLE', message: 'ЮKassa недоступна, повторите позже' });
      }
      throw error;
    }

    if (remote.metadata?.paymentId && remote.metadata.paymentId !== payment.id) {
      this.logger.error(`платёж ЮKassa ${remote.id} принадлежит другому заказу — пропущен`);
      return;
    }

    if (remote.status === 'succeeded' && remote.paid) {
      await this.applyYookassaSuccess(payment.orderId, payment.id, remote);
    } else if (remote.status === 'canceled') {
      const reason = remote.cancellation_details?.reason ?? 'canceled';
      await this.cancel(payment.orderId, payment.id, `ЮKassa: ${reason}`, undefined, remote);
    }
  }

  private async applyYookassaSuccess(orderId: string, paymentId: string, remote: YookassaPayment) {
    const order = await this.loadAny(orderId);

    if (order.amount.toFixed(2) !== remote.amount.value || order.currency !== remote.amount.currency) {
      // Сумма задаётся нами, расхождение — повод для человека, а не для выдачи.
      this.logger.error(`ЮKassa ${remote.id}: сумма ${remote.amount.value} ${remote.amount.currency} не совпала с заказом ${order.number}`);
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { errorMessage: 'сумма платежа не совпала с заказом', rawPayload: remote as unknown as Prisma.InputJsonValue },
      });
      return;
    }

    const licenseId = await this.markPaidAndDeliver(order, paymentId, {
      method: mapYookassaMethod(remote.payment_method?.type),
      rawPayload: remote,
      // Оплата могла прийти после отмены по сроку — деньги взяты, выдаём.
      allowCancelled: true,
    });
    if (!licenseId) return;

    await this.audit.record({
      action: 'order.paid.yookassa',
      actorType: 'SYSTEM',
      actorLabel: 'yookassa',
      entityType: 'order',
      entityId: orderId,
      after: { licenseId, yookassaId: remote.id },
    });
  }

  // ------------------------------------------------------- фоновые задачи

  /** Ловит пропущенные вебхуки и закрывает истёкшие платежи ЮKassa. */
  async syncPendingYookassa(): Promise<void> {
    const now = Date.now();
    const pending = await this.prisma.payment.findMany({
      where: {
        provider: PaymentProvider.YOOKASSA,
        status: PaymentStatus.PENDING,
        externalId: { not: null },
        createdAt: { lt: new Date(now - 2 * 60_000) },
        order: { status: OrderStatus.PENDING },
      },
      select: { id: true, orderId: true, externalId: true, profileId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const payment of pending) {
      try {
        await this.syncYookassa(payment);
        if (payment.createdAt.getTime() < now - YOOKASSA_PENDING_HOURS * 3_600_000) {
          await this.cancel(payment.orderId, payment.id, 'истёк срок оплаты');
        }
      } catch (error) {
        this.logger.warn(`сверка ЮKassa ${payment.externalId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Отменяет крипто-заказы, по которым за отведённое время не прислали хеш.
   * Срок у каждых реквизитов свой, минимальный — час.
   */
  async expireStaleCrypto(): Promise<number> {
    const now = Date.now();
    const candidates = await this.prisma.payment.findMany({
      where: {
        provider: PaymentProvider.CRYPTO,
        status: PaymentStatus.PENDING,
        submittedAt: null,
        createdAt: { lt: new Date(now - 3_600_000) },
        order: { status: OrderStatus.PENDING },
      },
      select: { id: true, orderId: true, profileId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const hoursByProfile = new Map<string, number>();
    let cancelled = 0;
    for (const payment of candidates) {
      const key = payment.profileId ?? '';
      let hours = hoursByProfile.get(key);
      if (hours === undefined) {
        hours = await this.profiles.cryptoExpireHours(payment.profileId);
        hoursByProfile.set(key, hours);
      }
      if (payment.createdAt.getTime() < now - hours * 3_600_000) {
        await this.cancel(payment.orderId, payment.id, 'истёк срок оплаты');
        cancelled++;
      }
    }
    return cancelled;
  }

  // ---------------------------------------------------------------- чтение

  async list(
    actor: AuthenticatedUser,
    filters: {
      status?: OrderStatus;
      provider?: PaymentProvider;
      awaiting?: boolean;
      userId?: string;
      search?: string;
      skip?: number;
      take?: number;
    } = {},
  ) {
    const scope = resolveScope(actor, 'orders.read');
    const paymentFilter: Prisma.PaymentWhereInput = {
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(filters.awaiting
        ? { provider: PaymentProvider.CRYPTO, status: PaymentStatus.PENDING, submittedAt: { not: null } }
        : {}),
    };

    const where: Prisma.OrderWhereInput = {
      userId: scope === 'own' ? actor.id : filters.userId,
      ...(filters.awaiting ? { status: OrderStatus.PENDING } : filters.status ? { status: filters.status } : {}),
      ...(Object.keys(paymentFilter).length ? { payments: { some: paymentFilter } } : {}),
      ...(filters.search && scope === 'any'
        ? {
            OR: [
              { number: { contains: filters.search, mode: 'insensitive' } },
              { user: { username: { contains: filters.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const take = Math.min(filters.take ?? 25, 200);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take,
        select: ORDER_SELECT,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items: rows.map((row) => this.toView(row)), total, skip: filters.skip ?? 0, take };
  }

  async findVisible(actor: AuthenticatedUser, orderId: string) {
    return this.toView(await this.loadVisible(actor, orderId));
  }

  // ------------------------------------------------------------- внутреннее

  private async viewById(orderId: string) {
    return this.toView(await this.loadAny(orderId));
  }

  private toView(order: OrderRow) {
    const payment = order.payments[0] ?? null;
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      source: order.source,
      amount: order.amount.toFixed(2),
      currency: order.currency,
      comment: order.comment,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
      product: order.product,
      plan: order.plan,
      user: order.user,
      licenseIds: order.licenses.map((l) => l.id),
      payment,
    };
  }

  private async loadAny(orderId: string): Promise<OrderRow> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Заказ не найден' });
    return order;
  }

  private async loadOwn(userId: string, orderId: string): Promise<OrderRow> {
    const order = await this.loadAny(orderId);
    if (order.userId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Это не ваш заказ' });
    return order;
  }

  private async loadVisible(actor: AuthenticatedUser, orderId: string): Promise<OrderRow> {
    const order = await this.loadAny(orderId);
    if (resolveScope(actor, 'orders.read') !== 'any' && order.userId !== actor.id) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Это не ваш заказ' });
    }
    return order;
  }

  private paymentOf(order: OrderRow) {
    const payment = order.payments[0];
    if (!payment) throw new ConflictException({ code: 'ORDER_WITHOUT_PAYMENT', message: 'У заказа нет платежа' });
    return payment;
  }

  private assertPending(order: OrderRow): void {
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException({ code: 'ORDER_NOT_PENDING', message: 'Заказ уже обработан' });
    }
  }

  /**
   * PENDING → PAID → выдача → DELIVERED одной транзакцией. Возвращает id
   * лицензии или null, если заказ уже обработан кем-то другим.
   */
  private async markPaidAndDeliver(
    order: OrderRow,
    paymentId: string,
    opts: {
      reviewedById?: string;
      comment?: string;
      method?: PaymentMethod;
      rawPayload?: unknown;
      allowCancelled?: boolean;
    },
  ): Promise<string | null> {
    const now = new Date();
    const license = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          status: { in: opts.allowCancelled ? [OrderStatus.PENDING, OrderStatus.CANCELLED] : [OrderStatus.PENDING] },
        },
        data: {
          status: OrderStatus.PAID,
          paidAt: now,
          cancelledAt: null,
          ...(opts.comment ? { comment: opts.comment } : {}),
        },
      });
      if (claimed.count === 0) return null;

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmedAt: now,
          failedAt: null,
          errorMessage: null,
          ...(opts.reviewedById ? { reviewedById: opts.reviewedById } : {}),
          ...(opts.method ? { method: opts.method } : {}),
          ...(opts.rawPayload ? { rawPayload: opts.rawPayload as Prisma.InputJsonValue } : {}),
        },
      });

      return this.fulfillment.deliver(tx, order);
    });

    if (!license) return null;
    await this.fulfillment.notifyIssued(order.userId, order.number, license.id);
    return license.id;
  }

  private async cancel(
    orderId: string,
    paymentId: string,
    reason: string,
    reviewedById?: string,
    rawPayload?: unknown,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED, cancelledAt: now, comment: reason },
      });
      if (claimed.count === 0) return;
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: now,
          errorMessage: reason,
          ...(reviewedById ? { reviewedById } : {}),
          ...(rawPayload ? { rawPayload: rawPayload as Prisma.InputJsonValue } : {}),
        },
      });
    });
  }

  private async startYookassa(
    target: CheckoutTarget<'YOOKASSA'>,
    params: {
      orderId: string;
      paymentId: string;
      orderNumber: string;
      amount: Prisma.Decimal;
      currency: string;
      description: string;
      receiptEmail?: string;
    },
  ): Promise<void> {
    const { secrets, config } = target;
    const frontendUrl = await this.frontendUrl();

    try {
      const remote = await this.yookassa.createPayment(
        { shopId: secrets.shopId ?? '', secretKey: secrets.secretKey ?? '' },
        {
          // Повтор запроса с тем же ключом не создаст второй платёж.
          idempotenceKey: params.paymentId,
          amount: params.amount.toFixed(2),
          currency: params.currency,
          description: params.description,
          returnUrl: `${frontendUrl}/orders/${params.orderId}`,
          metadata: { orderId: params.orderId, paymentId: params.paymentId },
          receipt: params.receiptEmail ? { email: params.receiptEmail, vatCode: config.vatCode } : undefined,
        },
      );

      await this.prisma.payment.update({
        where: { id: params.paymentId },
        data: {
          externalId: remote.id,
          rawPayload: remote as unknown as Prisma.InputJsonValue,
          instructions: { kind: 'redirect', url: remote.confirmation?.confirmation_url ?? null },
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.cancel(params.orderId, params.paymentId, `ЮKassa: ${reason}`);
      if (error instanceof YookassaRejectedError) {
        throw new BadRequestException({
          code: 'PROVIDER_REJECTED',
          message: 'Платёжная система отклонила запрос. Попробуйте другой способ оплаты.',
        });
      }
      throw new ServiceUnavailableException({ code: 'PROVIDER_UNAVAILABLE', message: 'Платёжная система недоступна, повторите позже' });
    }
  }

  /** Сумма в монетах по курсу админа, округлённая вверх — недоплаты из-за округления не бывает. */
  private cryptoInstructions(target: CheckoutTarget<'CRYPTO'>, price: Prisma.Decimal, walletId?: string) {
    const { config } = target;
    const wallet = walletId ? config.wallets.find((w) => w.id === walletId) : config.wallets[0];
    if (!wallet) {
      throw new BadRequestException({ code: 'WALLET_NOT_FOUND', message: 'Выбранный кошелёк недоступен' });
    }

    return {
      kind: 'crypto',
      walletId: wallet.id,
      currency: wallet.currency,
      network: wallet.network,
      address: wallet.address,
      amount: cryptoAmount(price, wallet.rate, wallet.decimals),
      explorerTxUrl: wallet.explorerTxUrl ?? null,
      note: config.instructions ?? null,
      expiresAt: new Date(Date.now() + config.expireHours * 3_600_000).toISOString(),
    };
  }

  /** Почта для чека 54-ФЗ, если он включён; без почты чек не пробить. */
  private async receiptEmail(userId: string, sendReceipt: boolean): Promise<string | undefined> {
    if (!sendReceipt) return undefined;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) {
      throw new BadRequestException({
        code: 'EMAIL_REQUIRED_FOR_RECEIPT',
        message: 'Для оплаты картой нужна почта в профиле — на неё придёт чек',
      });
    }
    return user.email;
  }

  /** Алерт всем, кто может подтверждать заказы: почта всегда, Telegram — при админской привязке. */
  private async notifyAdmins(orderId: string): Promise<void> {
    const order = await this.loadAny(orderId);
    const payment = this.paymentOf(order);
    const instructions = (payment.instructions ?? {}) as { currency?: string; network?: string; amount?: string };

    const admins = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { slug: 'orders.manage' } } } } } },
      },
      select: { id: true, locale: true },
      take: 20,
    });

    const adminUrl = `${await this.frontendUrl()}/admin/orders?status=awaiting`;
    for (const admin of admins) {
      await this.notifications.enqueueMulti({
        templateKey: 'order.awaiting_confirmation',
        userId: admin.id,
        locale: admin.locale,
        payload: {
          // Ось дедупликации Telegram-копий — по заказу, иначе второй заказ съест окно.
          licenseId: order.id,
          orderNumber: order.number,
          productName: order.product.name,
          planName: order.plan.name,
          amount: order.amount.toFixed(2),
          currency: order.currency,
          method: `${instructions.amount ?? ''} ${instructions.currency ?? ''} (${instructions.network ?? ''})`.trim(),
          details: `TX: ${payment.externalId ?? '—'}`,
          adminUrl,
        },
      });
    }
  }

  private async frontendUrl(): Promise<string> {
    const url = await this.settings.getString('app.frontend_url', this.env.FRONTEND_URL);
    return url.replace(/\/+$/, '');
  }
}

/** Сумма в монетах: цена / курс, вверх до нужного числа знаков. */
export function cryptoAmount(price: Prisma.Decimal, rate: number, decimals: number): string {
  return price.div(rate).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_UP).toFixed(decimals);
}

export function normalizeTxHash(raw: string): string {
  const value = raw.trim();
  if (!TX_HASH_RE.test(value)) {
    throw new BadRequestException({ code: 'TX_HASH_INVALID', message: 'Хеш транзакции выглядит неверно' });
  }
  // Шестнадцатеричные хеши регистронезависимы — приводим, чтобы один хеш
  // не прошёл дважды в разном регистре. Base58 (TRON, Solana) не трогаем.
  return /^(0x)?[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value;
}

function mapYookassaMethod(type?: string): PaymentMethod {
  switch (type) {
    case 'bank_card':
      return PaymentMethod.CARD;
    case 'sbp':
      return PaymentMethod.SBP;
    case 'yoo_money':
    case 'sberbank':
    case 'tinkoff_bank':
      return PaymentMethod.EWALLET;
    case 'mobile_balance':
      return PaymentMethod.MOBILE;
    default:
      return PaymentMethod.OTHER;
  }
}
