import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import { DigisellerClient } from './digiseller.client';
import { FulfillmentService } from './fulfillment.service';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Выдача лицензий по покупкам Digiseller (ТЗ п.17): покупатель платит на
 * площадке и приносит код, мы проверяем его у площадки и выдаём лицензию —
 * заказ, платёж и лицензия одной транзакцией.
 *
 * Гарантии:
 * 1. Один код — одна лицензия: UNIQUE(unique_code) и UNIQUE(inv_id),
 *    проигравший гонку откатывается целиком.
 * 2. Заплатил — получил, либо это видно: покупка с ненастроенным товаром
 *    паркуется (redeemed_at = NULL) и довыдаётся из админки.
 * 3. Возвраты ловит опрос сделок раз в 10 минут; горизонт не короче срока
 *    холдирования площадки (5 суток) с запасом.
 *
 * Два пути: уникальный код (предъявительский) и номер заказа + почта — для
 * товаров без кодов. Номер заказа не секрет, поэтому промах по почте дорогой.
 *
 * «Код не существует» мы не говорим: у площадки описан только retval = 0,
 * любой другой ответ — повод попросить повторить, а не отказ.
 */

/** Код покупки — ровно 16 символов (документация площадки). */
const CODE_RE = /^[A-Za-z0-9]{16}$/;

/** Номер заказа площадки: целое 6–12 цифр — «1» и «42» до площадки не доезжают. */
const INVOICE_RE = /^[0-9]{6,12}$/;

const ATTEMPT_PREFIX = 'digiseller:attempts:';
const ATTEMPT_WINDOW_SEC = 3600;

/**
 * Промахи по почте — отдельный счётчик по паре «пользователь + счёт». Почта
 * покупателя не секрет, поэтому промах стоит дорого (MISMATCH_PENALTY попыток
 * общего бюджета), а после MISMATCH_MAX_PER_DEAL счёт закрывается на час —
 * не на сутки, чтобы честный покупатель, забывший адрес, не ждал до завтра.
 */
const MISMATCH_PREFIX = 'digiseller:mismatch:';
const MISMATCH_WINDOW_SEC = 3_600;
const MISMATCH_PENALTY = 5;
const MISMATCH_MAX_PER_DEAL = 5;

/** Нижняя граница горизонта наблюдения за возвратами, ч (холдирование 120 ч + запас). */
const REFUND_WATCH_MIN_HOURS = 336;

/** Валюты площадки, сравнимые с рублёвой ценой тарифа напрямую (курса других у нас нет). */
const RUB_CURRENCY_CODES = new Set(['RUB', 'RUR', 'WMR']);

export interface RedeemContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
  /**
   * Ось второго счётчика попыток с префиксом: `ip:<адрес>` для HTTP,
   * `telegram:<id>` для бота (у бота один адрес на всех — без своей оси он
   * делил бы бюджет на всю аудиторию).
   */
  sourceKey?: string;
}

/** Подтверждённая площадкой покупка — общий вид для пути по коду и по номеру заказа. */
interface VerifiedPurchase {
  inv: number | bigint;
  idGoods: number;
  amount: number | null;
  currency: string | null;
  buyerEmail: string | null;
  raw: unknown;
}

/** Строка сделки в объёме, которого хватает, чтобы ответить на повторное предъявление. */
interface ExistingDeal {
  redeemedAt: Date | null;
  redeemedByUserId: string | null;
  orderId: string | null;
}

@Injectable()
export class DigisellerService {
  private readonly logger = new Logger(DigisellerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly client: DigisellerClient,
    private readonly licenses: LicensesService,
    private readonly fulfillment: FulfillmentService,
    private readonly methods: PaymentMethodsService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  //  ПОГАШЕНИЕ КОДА
  // =========================================================================

  async redeem(userId: string, rawCode: string, ctx: RedeemContext = {}) {
    const code = rawCode.trim();

    if (!CODE_RE.test(code)) {
      throw new BadRequestException({
        code: 'CODE_MALFORMED',
        message: 'Код покупки состоит из 16 латинских букв и цифр',
      });
    }

    // Порог щедрый: мешать перебору, а не человеку с опечаткой.
    await this.checkAttemptLimit(userId, ctx);

    // Уже погашенный код (повторный клик) — отвечаем без запроса к площадке.
    const existing = await this.prisma.digisellerOrder.findUnique({
      where: { uniqueCode: code },
      select: { id: true, redeemedAt: true, redeemedByUserId: true, payment: { select: { orderId: true } } },
    });

    if (existing?.redeemedAt) {
      return this.describeExisting(
        { redeemedAt: existing.redeemedAt, redeemedByUserId: existing.redeemedByUserId, orderId: existing.payment?.orderId ?? null },
        userId,
        'CODE',
      );
    }

    // --- Проверка у площадки (сеть, вне транзакции) ------------------------
    const verdict = await this.client.verifyUniqueCode(code);

    if (verdict.kind === 'unavailable') {
      this.logger.warn(`проверка кода не удалась: ${verdict.reason}`);
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Не удалось связаться с площадкой. Повторите через минуту.',
      });
    }

    if (verdict.kind === 'rejected') {
      // Не приговор («проверьте и повторите») и не антифрод: почти всегда это
      // опечатка, а перебор ловит счётчик попыток.
      this.logger.log(`код отклонён площадкой (retval=${verdict.retval}), пользователь ${userId}`);
      throw new BadRequestException({
        code: 'CODE_NOT_ACCEPTED',
        message: 'Площадка не подтвердила код. Проверьте его и повторите; если код верен — напишите в поддержку.',
      });
    }

    const info = verdict.data;

    // --- Тариф по товару площадки -----------------------------------------
    const plan = await this.prisma.licensePlan.findUnique({
      where: { digisellerProductId: info.idGoods },
      select: { id: true, productId: true, price: true, isActive: true },
    });

    if (!plan) {
      // Деньги у площадки, а тариф не заведён — паркуем сделку для админки.
      await this.parkUnmapped(code, info, userId, 'UNMAPPED');
      throw new ConflictException({
        code: 'PRODUCT_NOT_MAPPED',
        message: 'Покупка подтверждена, но товар ещё не настроен. Мы уже знаем об этом — лицензия придёт после проверки.',
      });
    }

    // Тариф снят с продажи, а карточка на площадке жива — решает администратор.
    if (!plan.isActive) {
      await this.parkUnmapped(code, info, userId, 'UNMAPPED');
      throw new ConflictException({
        code: 'PLAN_INACTIVE',
        message:
          'Этот тариф снят с продажи. Покупка записана и уйдёт на проверку — мы свяжемся по ней.',
      });
    }

    if (await this.looksUnderpaid(info.amount, info.currency, plan.price)) {
      await this.parkUnmapped(code, info, userId, 'AMOUNT');
      throw new ConflictException({
        code: 'ORDER_AMOUNT_MISMATCH',
        message: 'Сумма оплаты не совпадает с ценой тарифа. Покупка записана и уйдёт на проверку — лицензия придёт после неё.',
      });
    }

    // --- Заказ, платёж, лицензия — одной транзакцией -----------------------
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const orderId = uuidv7();

        const order = await tx.order.create({
          data: {
            id: orderId,
            userId,
            productId: plan.productId,
            planId: plan.id,
            amount: plan.price,
            currency: 'RUB',
            status: OrderStatus.PAID,
            source: OrderSource.DIGISELLER,
            paidAt: new Date(),
          },
          select: { id: true, number: true },
        });

        const payment = await tx.payment.create({
          data: {
            id: uuidv7(),
            orderId,
            provider: PaymentProvider.DIGISELLER,
            // Способа оплаты в ответе проверки кода нет, лишний запрос ради него не делаем.
            method: PaymentMethod.OTHER,
            status: PaymentStatus.CONFIRMED,
            amount: plan.price,
            currency: 'RUB',
            externalId: String(info.inv),
            rawPayload: info.raw as Prisma.InputJsonValue,
            confirmedAt: new Date(),
          },
          select: { id: true },
        });

        await this.claimDeal(tx, {
          inv: BigInt(info.inv),
          code,
          paymentId: payment.id,
          productId: info.idGoods,
          amount: info.amount,
          currency: info.currency,
          buyerEmail: info.buyerEmail,
          raw: info.raw,
          userId,
        });

        const license = await this.fulfillment.deliver(tx, {
          id: orderId,
          userId,
          productId: plan.productId,
          planId: plan.id,
        });

        return { orderId, orderNumber: order.number, licenseId: license.id, licenseKey: license.key };
      });

      await this.afterIssue(userId, result, { code }, ctx);
      return { status: 'ISSUED' as const, ...result };
    } catch (error) {
      // Гонка: этот код погасил параллельный запрос, наша транзакция откатилась.
      // Победителя ищем и по коду, и по invId: покупку могли активировать
      // номером заказа, тогда uniqueCode у строки пуст.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner =
          (await this.prisma.digisellerOrder.findUnique({
            where: { uniqueCode: code },
            select: { redeemedAt: true, redeemedByUserId: true, payment: { select: { orderId: true } } },
          })) ??
          (await this.prisma.digisellerOrder.findUnique({
            where: { invId: BigInt(info.inv) },
            select: { redeemedAt: true, redeemedByUserId: true, payment: { select: { orderId: true } } },
          }));
        return this.describeExisting(
          {
            redeemedAt: winner?.redeemedAt ?? null,
            redeemedByUserId: winner?.redeemedByUserId ?? null,
            orderId: winner?.payment?.orderId ?? null,
          },
          userId,
          'CODE',
        );
      }
      throw error;
    }
  }

  // =========================================================================
  //  ПОГАШЕНИЕ ПО НОМЕРУ ЗАКАЗА
  // =========================================================================

  /**
   * Запасной путь для товаров без уникальных кодов: номер заказа + почта.
   * Номер не секрет (идёт подряд), право доказывает совпадение почты с
   * buyer_info: подтверждённая почта аккаунта (владение адресом) или
   * введённая в форме (знание адреса — поэтому промах по ней дорогой).
   */
  async redeemByOrder(userId: string, rawInvoice: string, rawEmail: string, ctx: RedeemContext = {}) {
    const invoice = rawInvoice.trim();
    const email = rawEmail.trim().toLowerCase();

    if (!INVOICE_RE.test(invoice)) {
      throw new BadRequestException({
        code: 'ORDER_MALFORMED',
        message: 'Номер заказа — от 6 до 12 цифр без пробелов и других символов',
      });
    }

    const inv = BigInt(invoice);

    // Бюджет попыток общий с путём по коду — иначе перебор получил бы двойной.
    await this.checkAttemptLimit(userId, ctx);

    // Уже погашенный заказ (по invId — общему для обоих путей).
    const existing = await this.prisma.digisellerOrder.findUnique({
      where: { invId: inv },
      select: { redeemedAt: true, redeemedByUserId: true, payment: { select: { orderId: true } } },
    });

    if (existing?.redeemedAt) {
      return this.describeExisting(
        { redeemedAt: existing.redeemedAt, redeemedByUserId: existing.redeemedByUserId, orderId: existing.payment?.orderId ?? null },
        userId,
        'ORDER',
      );
    }

    // Замок по счёту после серии промахов почтой — до запроса к площадке,
    // чтобы перебирающему не доставалось даже состояние чужого счёта.
    await this.checkDealMismatchLock(userId, inv);

    // --- Состояние счёта у площадки (сеть, вне транзакции) -----------------
    const outcome = await this.client.purchaseInfo(inv);

    if (outcome.kind === 'unavailable') {
      this.logger.warn(`состояние счёта ${inv} получить не удалось: ${outcome.reason}`);
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Не удалось связаться с площадкой. Повторите через минуту.',
      });
    }

    if (outcome.kind === 'rejected') {
      // «Не подтвердила», а не «нет такого»: опечатка и чужой заказ неотличимы.
      this.logger.log(`счёт ${inv} не подтверждён площадкой (retval=${outcome.retval}), пользователь ${userId}`);
      throw new BadRequestException({
        code: 'ORDER_NOT_ACCEPTED',
        message: 'Площадка не подтвердила этот номер заказа. Проверьте его в письме о покупке и повторите.',
      });
    }

    const info = outcome.data;

    // Только 3 — «оплачено»; остальные состояния — разные коды с разными
    // действиями для человека. Деньги раньше почты: у неоплаченного счёта
    // buyer_info пуст, и честный «не доплатил» получил бы отказ про почту.
    if (info.invoiceState !== 3) {
      this.rejectByInvoiceState(info.invoiceState, inv);
    }

    // --- Владелец покупки --------------------------------------------------
    const buyerEmail = info.buyerEmail?.trim().toLowerCase() ?? null;

    if (!buyerEmail) {
      // Без почты проверять нечем — выдача по публичному номеру была бы подарком.
      this.logger.error(`счёт ${inv} оплачен, но buyer_info.email пуст — активацию по номеру подтвердить нечем`);
      throw new ConflictException({
        code: 'ORDER_NO_BUYER_EMAIL',
        message: 'Площадка не вернула почту покупателя по этому заказу. Напишите в поддержку — выдадим вручную.',
      });
    }

    // Сильное доказательство — ПОДТВЕРЖДЁННАЯ почта аккаунта (неподтверждённую
    // можно просто вписать в профиль).
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    const verifiedEmail =
      account?.emailVerifiedAt && account.email ? account.email.trim().toLowerCase() : null;
    const provenByAccount = verifiedEmail !== null && verifiedEmail === buyerEmail;

    if (!provenByAccount && buyerEmail !== email) {
      // Промах по введённой почте стоит дорого и приближает замок по счёту.
      const mismatches = await this.chargeEmailMismatch(userId, inv);

      // Почту покупателя не показываем и не логируем — иначе отказ стал бы
      // справочником чужих адресов.
      await this.audit.record({
        actorId: userId,
        actorType: 'USER',
        actorLabel: 'digiseller-redeem-order',
        action: 'billing.digiseller.email_mismatch',
        entityType: 'user',
        entityId: userId,
        after: { invId: invoice, mismatches },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });

      this.logger.warn(
        `почта не совпала с покупателем счёта ${inv}, пользователь ${userId}, промахов по этому счёту: ${mismatches}`,
      );
      throw new ForbiddenException({
        code: 'ORDER_EMAIL_MISMATCH',
        message: 'Заказ оплачен другой почтой. Укажите ту, на которую оформлялась покупка на площадке.',
      });
    }

    // --- Товар -------------------------------------------------------------
    if (!info.itemId) {
      // Похоже на сбой ответа площадки, а не на её решение — просим повторить.
      this.logger.error(`счёт ${inv} оплачен, но item_id в ответе нет — связать с тарифом нечем`);
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Площадка не вернула товар по заказу. Повторите через минуту.',
      });
    }

    const purchase: VerifiedPurchase = {
      inv,
      idGoods: info.itemId,
      amount: info.amount,
      currency: info.currency,
      buyerEmail: info.buyerEmail,
      raw: info.raw,
    };

    const plan = await this.prisma.licensePlan.findUnique({
      where: { digisellerProductId: info.itemId },
      select: { id: true, productId: true, price: true, isActive: true },
    });

    if (!plan) {
      // Как на пути с кодом; кода у покупки нет, поэтому uniqueCode = NULL.
      await this.parkUnmapped(null, purchase, userId, 'UNMAPPED');
      throw new ConflictException({
        code: 'PRODUCT_NOT_MAPPED',
        message: 'Покупка подтверждена, но товар ещё не настроен. Мы уже знаем об этом — лицензия придёт после проверки.',
      });
    }

    if (!plan.isActive) {
      await this.parkUnmapped(null, purchase, userId, 'UNMAPPED');
      throw new ConflictException({
        code: 'PLAN_INACTIVE',
        message:
          'Этот тариф снят с продажи. Покупка записана и уйдёт на проверку — мы свяжемся по ней.',
      });
    }

    if (await this.looksUnderpaid(info.amount, info.currency, plan.price)) {
      await this.parkUnmapped(null, purchase, userId, 'AMOUNT');
      throw new ConflictException({
        code: 'ORDER_AMOUNT_MISMATCH',
        message: 'Сумма оплаты не совпадает с ценой тарифа. Покупка записана и уйдёт на проверку — лицензия придёт после неё.',
      });
    }

    // --- Заказ, платёж, лицензия — одной транзакцией -----------------------
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const orderId = uuidv7();

        const order = await tx.order.create({
          data: {
            id: orderId,
            userId,
            productId: plan.productId,
            planId: plan.id,
            amount: plan.price,
            currency: 'RUB',
            status: OrderStatus.PAID,
            source: OrderSource.DIGISELLER,
            // Наше время: в date_pay площадки нет часового пояса. Её дата — в comment.
            paidAt: new Date(),
            comment: `Digiseller, счёт ${inv}, оплачен ${info.datePay ?? 'дата не указана'}`,
          },
          select: { id: true, number: true },
        });

        const payment = await tx.payment.create({
          data: {
            id: uuidv7(),
            orderId,
            provider: PaymentProvider.DIGISELLER,
            // Способ площадка называет своими словами — исходник в raw_payload.
            method: PaymentMethod.OTHER,
            status: PaymentStatus.CONFIRMED,
            amount: plan.price,
            currency: 'RUB',
            externalId: String(inv),
            rawPayload: info.raw as Prisma.InputJsonValue,
            confirmedAt: new Date(),
          },
          select: { id: true },
        });

        // Сумма и валюта пишутся как у площадки (0.04 WMT), а не как у
        // тарифа: это запись о ЕЁ сделке. Рублёвая цена — в order/payment.
        await this.claimDeal(tx, {
          inv,
          code: null,
          paymentId: payment.id,
          productId: info.itemId,
          amount: info.amount,
          currency: info.currency,
          buyerEmail: info.buyerEmail,
          raw: info.raw,
          userId,
        });

        const license = await this.fulfillment.deliver(tx, {
          id: orderId,
          userId,
          productId: plan.productId,
          planId: plan.id,
        });

        return { orderId, orderNumber: order.number, licenseId: license.id, licenseKey: license.key };
      });

      // Владение доказано — прежние промахи по этому счёту обнуляем.
      await this.redis.client.del(`${MISMATCH_PREFIX}${userId}:${inv}`).catch(() => undefined);

      await this.afterIssue(userId, result, { invId: inv }, ctx);
      return { status: 'ISSUED' as const, ...result };
    } catch (error) {
      // Гонка: счёт погасил параллельный запрос (кодом или номером).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.digisellerOrder.findUnique({
          where: { invId: inv },
          select: { redeemedAt: true, redeemedByUserId: true, payment: { select: { orderId: true } } },
        });
        return this.describeExisting(
          {
            redeemedAt: winner?.redeemedAt ?? null,
            redeemedByUserId: winner?.redeemedByUserId ?? null,
            orderId: winner?.payment?.orderId ?? null,
          },
          userId,
          'ORDER',
        );
      }
      throw error;
    }
  }

  // =========================================================================
  //  ВОЗВРАТЫ
  // =========================================================================

  /**
   * Поиск возвратов опросом (вебхуков у площадки нет). Поштучно: права
   * sales_statistics_view для пакетного запроса у ключа нет.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async pollRefunds(): Promise<void> {
    if (!(await this.client.isConfigured())) return;

    // Горизонт не короче срока холдирования площадки (5 суток) с запасом:
    // иначе поздний возврат не обнаружится, и лицензия останется активной.
    const { pollWindowHours } = await this.methods.config('DIGISELLER');
    const windowHours = Math.max(pollWindowHours, REFUND_WATCH_MIN_HOURS);
    const since = new Date(Date.now() - windowHours * 3600_000);

    const candidates = await this.prisma.digisellerOrder.findMany({
      where: { redeemedAt: { not: null, gte: since }, refundedAt: null, invId: { not: null } },
      select: { id: true, invId: true, payment: { select: { id: true, orderId: true } } },
      orderBy: { lastPolledAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
    });

    for (const row of candidates) {
      const state = await this.client.purchaseInfo(row.invId!);

      // Отметка при любом исходе — иначе неотвечающая сделка навсегда
      // заняла бы начало очереди.
      await this.prisma.digisellerOrder.update({
        where: { id: row.id },
        data: { lastPolledAt: new Date() },
      });

      // Отказ по своей подтверждённой сделке — признак отозванного права
      // view_invoice: в этом состоянии возвраты не находятся, пишем ошибку.
      if (state.kind === 'rejected') {
        this.logger.error(
          `сделка ${row.invId}: площадка отказала в состоянии счёта (retval=${state.retval}, ${state.message}) — возвраты по ней не отслеживаются`,
        );
        continue;
      }

      if (state.kind !== 'ok') continue;

      // 5 — возврат. 35 — возврат начат, но не завершён покупателем: денег
      // ещё никто не вернул, доступ не трогаем.
      if (state.data.invoiceState === 5) {
        await this.applyRefund(row.id, row.payment?.id ?? null, row.payment?.orderId ?? null);
        continue;
      }

      // 4 — покупатель оспорил доставку: это спор, а не возврат, лицензию не трогаем.
      if (state.data.uniqueCodeState === 4) {
        this.logger.warn(`сделка ${row.invId}: покупатель опроверг доставку — нужен разбор, лицензия НЕ отозвана`);
      }
    }
  }

  private async applyRefund(digisellerOrderId: string, paymentId: string | null, orderId: string | null) {
    // Условный UPDATE: повторный или уже проведённый руками возврат — no-op.
    const claimed = await this.prisma.digisellerOrder.updateMany({
      where: { id: digisellerOrderId, refundedAt: null },
      data: { refundedAt: new Date() },
    });
    if (claimed.count === 0) return;

    if (paymentId) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.REFUNDED, refundedAt: new Date() },
      });
    }

    if (!orderId) return;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REFUNDED, refundedAt: new Date() },
    });

    const licenses = await this.prisma.license.findMany({
      where: { orderId },
      select: { id: true, userId: true },
    });

    for (const lic of licenses) {
      await this.licenses.revoke(lic.id, 'возврат средств через Digiseller');

      await this.audit.record({
        actorType: 'SYSTEM',
        actorLabel: 'digiseller-poll',
        action: 'license.revoked.refund',
        entityType: 'license',
        entityId: lic.id,
        after: { reason: 'REFUND', orderId },
      });
      // Письмо об отзыве отправляет сам revoke — второго уведомления здесь нет.
    }

    this.logger.warn(`возврат по заказу ${orderId}: лицензий отозвано ${licenses.length}`);
  }

  // =========================================================================
  //  РУЧНОЕ ЗАВЕРШЕНИЕ
  // =========================================================================

  /** Сделки, подтверждённые площадкой, но не выданные: товар не привязан к тарифу. */
  async listPending() {
    return this.prisma.digisellerOrder.findMany({
      where: { verifiedAt: { not: null }, redeemedAt: null },
      select: {
        id: true, uniqueCode: true, invId: true, digisellerProductId: true,
        amount: true, currency: true, buyerEmail: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /**
   * Довыдать лицензию по зависшей сделке — после того, как владелец завёл
   * тариф. Кода площадки здесь не спрашиваем повторно: ответ на проверку
   * лежит в raw_payload, и он уже подтверждён.
   */
  async completePending(digisellerOrderId: string, adminId: string) {
    const row = await this.prisma.digisellerOrder.findUnique({
      where: { id: digisellerOrderId },
      select: {
        id: true, uniqueCode: true, invId: true, digisellerProductId: true,
        amount: true, redeemedAt: true, redeemedByUserId: true, rawPayload: true,
      },
    });

    if (!row) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Сделка не найдена' });
    if (row.redeemedAt) {
      throw new ConflictException({ code: 'ALREADY_REDEEMED', message: 'Лицензия по этой сделке уже выдана' });
    }
    if (!row.redeemedByUserId) {
      throw new ConflictException({
        code: 'NO_CLAIMANT',
        message: 'Неизвестно, кому выдавать: код никто не предъявлял',
      });
    }

    const plan = await this.prisma.licensePlan.findUnique({
      where: { digisellerProductId: row.digisellerProductId ?? -1 },
      select: { id: true, productId: true, price: true },
    });

    if (!plan) {
      throw new ConflictException({
        code: 'PRODUCT_NOT_MAPPED',
        message: `Товар ${row.digisellerProductId} всё ещё не привязан ни к одному тарифу`,
      });
    }

    const userId = row.redeemedByUserId;

    const result = await this.prisma.$transaction(async (tx) => {
      const orderId = uuidv7();

      // В заказ — рублёвая цена тарифа; сумма площадки в её валюте остаётся
      // в DigisellerOrder.amount.
      const order = await tx.order.create({
        data: {
          id: orderId, userId,
          productId: plan.productId, planId: plan.id,
          amount: plan.price, currency: 'RUB',
          status: OrderStatus.PAID, source: OrderSource.DIGISELLER,
          paidAt: new Date(), comment: `довыдача по сделке ${row.invId}`,
        },
        select: { id: true, number: true },
      });

      const payment = await tx.payment.create({
        data: {
          id: uuidv7(), orderId,
          provider: PaymentProvider.DIGISELLER, method: PaymentMethod.OTHER,
          status: PaymentStatus.CONFIRMED,
          amount: plan.price, currency: 'RUB',
          externalId: String(row.invId),
          rawPayload: row.rawPayload as Prisma.InputJsonValue,
          confirmedAt: new Date(),
        },
        select: { id: true },
      });

      // Условное погашение: если параллельно кто-то уже довыдал, count = 0
      // и вся транзакция откатывается вместе с заказом и платежом.
      const claimed = await tx.digisellerOrder.updateMany({
        where: { id: row.id, redeemedAt: null },
        data: { redeemedAt: new Date(), paymentId: payment.id },
      });
      if (claimed.count === 0) {
        throw new ConflictException({ code: 'ALREADY_REDEEMED', message: 'Лицензия по этой сделке уже выдана' });
      }

      const license = await this.fulfillment.deliver(
        tx,
        { id: orderId, userId, productId: plan.productId, planId: plan.id },
        adminId,
      );

      return { orderId, orderNumber: order.number, licenseId: license.id, licenseKey: license.key };
    });

    await this.afterIssue(userId, result, { code: row.uniqueCode, invId: row.invId }, {}, adminId);
    return { status: 'ISSUED' as const, ...result };
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /** Уведомление и аудит — два из четырёх действий, которых требует ТЗ п.17. */
  private async afterIssue(
    userId: string,
    result: { orderId: string; orderNumber: string; licenseId: string; licenseKey: string },
    /** Чем покупка была предъявлена. У пути по номеру заказа кода нет, и наоборот. */
    ref: { code?: string | null; invId?: bigint | number | null },
    ctx: RedeemContext,
    adminId?: string,
  ) {
    await this.fulfillment.notifyIssued(userId, result.orderNumber, result.licenseId);

    await this.audit.record({
      actorId: adminId ?? userId,
      actorType: adminId ? 'ADMIN' : 'USER',
      actorLabel: adminId ? 'digiseller-complete' : 'digiseller-redeem',
      action: 'order.paid.digiseller',
      entityType: 'order',
      entityId: result.orderId,
      // Код предъявительский — в журнал только хвост; номер счёта не секрет.
      after: {
        licenseId: result.licenseId,
        ...(ref.code ? { codeTail: ref.code.slice(-4) } : {}),
        ...(ref.invId != null ? { invId: String(ref.invId) } : {}),
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
  }

  /**
   * Сделка уже есть в базе: своя погашенная — тот же ответ, что в первый раз;
   * своя запаркованная — «ждёт разбора»; чужая — отказ.
   */
  private describeExisting(deal: ExistingDeal, userId: string, kind: 'CODE' | 'ORDER') {
    if (deal.redeemedByUserId !== userId) {
      throw new ConflictException({
        code: kind === 'CODE' ? 'CODE_ALREADY_USED' : 'ORDER_ALREADY_USED',
        message: kind === 'CODE'
          ? 'Этот код покупки уже активирован на другом аккаунте'
          : 'Эта покупка уже активирована на другом аккаунте',
      });
    }

    if (!deal.redeemedAt) {
      throw new ConflictException({
        code: 'PRODUCT_NOT_MAPPED',
        message: 'Покупка подтверждена, но лицензия ещё не выдана — сделка ждёт настройки. Мы уже знаем об этом.',
      });
    }

    // Идемпотентность: повторная отправка формы обязана дать тот же ответ,
    // а не ошибку. Человек не должен гадать, прошло или нет.
    return { status: 'ALREADY_YOURS' as const, orderId: deal.orderId };
  }

  /**
   * Покупка подтверждена, но выдать сейчас нельзя — паркуем для разбора в
   * админке. UNMAPPED: товар площадки не привязан к тарифу; AMOUNT: заплачено
   * заметно меньше цены. code = null при активации по номеру заказа.
   */
  private async parkUnmapped(
    code: string | null,
    info: VerifiedPurchase,
    userId: string,
    reason: 'UNMAPPED' | 'AMOUNT',
  ) {
    try {
      await this.prisma.digisellerOrder.create({
        data: {
          id: uuidv7(),
          uniqueCode: code,
          invId: BigInt(info.inv),
          digisellerProductId: info.idGoods,
          amount: info.amount,
          currency: this.normalizeCurrency(info.currency),
          buyerEmail: info.buyerEmail,
          rawPayload: info.raw as Prisma.InputJsonValue,
          verifiedAt: new Date(),
          redeemedAt: null, // признак парковки
          redeemedByUserId: userId,
        },
      });
    } catch (error) {
      // Повторное предъявление той же покупки: строка уже есть.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }

    this.logger.error(
      reason === 'UNMAPPED'
        ? `товар площадки ${info.idGoods} не привязан ни к одному тарифу — сделка ${info.inv} ждёт настройки`
        : `сделка ${info.inv}: оплачено ${info.amount} ${info.currency ?? '?'} — заметно меньше цены тарифа, выдача остановлена до разбора`,
    );
  }

  /**
   * Записать сделку как погашенную: занять запаркованную строку или создать
   * новую. Если строка уже погашена, updateMany вернёт 0, вставка упадёт на
   * UNIQUE(inv_id) — проигравший гонку откатывается целиком.
   */
  private async claimDeal(
    tx: Prisma.TransactionClient,
    params: {
      inv: bigint;
      code: string | null;
      paymentId: string;
      productId: number | null;
      amount: number | null;
      currency: string | null;
      buyerEmail: string | null;
      raw: unknown;
      userId: string;
    },
  ): Promise<void> {
    const data = {
      paymentId: params.paymentId,
      // undefined: путь по номеру заказа не затирает уже записанный код.
      uniqueCode: params.code ?? undefined,
      invId: params.inv,
      digisellerProductId: params.productId,
      amount: params.amount,
      currency: this.normalizeCurrency(params.currency),
      buyerEmail: params.buyerEmail,
      rawPayload: params.raw as Prisma.InputJsonValue,
      verifiedAt: new Date(),
      redeemedAt: new Date(),
      redeemedByUserId: params.userId,
    };

    const claimed = await tx.digisellerOrder.updateMany({
      where: { invId: params.inv, redeemedAt: null },
      data,
    });
    if (claimed.count > 0) return;

    await tx.digisellerOrder.create({ data: { id: uuidv7(), ...data } });
  }

  /**
   * Заплачено ли заметно меньше цены тарифа (порог — minAmountRatio).
   * Сравниваем только рубли: курса других валют площадки у нас нет, такие
   * сделки лишь пишутся в лог.
   */
  private async looksUnderpaid(
    amount: number | null,
    currency: string | null,
    planPrice: Prisma.Decimal,
  ): Promise<boolean> {
    if (amount === null) return false;

    const price = Number(planPrice);
    if (!Number.isFinite(price) || price <= 0) return false;

    const code = this.normalizeCurrency(currency);
    if (code === null || !RUB_CURRENCY_CODES.has(code)) {
      if (amount < price) {
        this.logger.warn(
          `сумма сделки ${amount} ${code ?? '?'} не сравнима с ценой тарифа ${price} ₽ — гейт по сумме не применён`,
        );
      }
      return false;
    }

    const { minAmountRatio } = await this.methods.config('DIGISELLER');
    return amount < price * minAmountRatio;
  }

  /** Код валюты для VarChar(3); не трёхбуквенный — NULL, а не обрезка (USDT ≠ USD). */
  private normalizeCurrency(raw: string | null | undefined): string | null {
    const code = raw?.trim().toUpperCase() ?? '';
    if (code === '') return null;
    if (/^[A-Z]{3}$/.test(code)) return code;
    this.logger.warn(`код валюты площадки "${code}" не помещается в колонку — записан NULL`);
    return null;
  }

  /**
   * Счёт не оплачен — свой код на каждое состояние, чтобы человек знал, что
   * делать. invoice_state (проверено на живой площадке): 1 ждёт оплаты,
   * 2 отказ, 3 оплачено, 4 просрочен, 5 возврат, 35 возврат начат.
   */
  private rejectByInvoiceState(state: number | null, inv: bigint): never {
    switch (state) {
      case 1:
        throw new ConflictException({
          code: 'ORDER_NOT_PAID',
          message: 'Заказ создан, но оплата ещё не прошла. Завершите её на площадке и вернитесь сюда.',
        });
      case 2:
        throw new ConflictException({
          code: 'ORDER_PAYMENT_FAILED',
          message: 'Оплата по этому заказу не прошла. Оформите покупку на площадке заново.',
        });
      case 4:
        throw new ConflictException({
          code: 'ORDER_EXPIRED',
          message: 'Срок оплаты этого заказа истёк, деньги не списаны. Оформите покупку на площадке заново.',
        });
      case 5:
        throw new ConflictException({
          code: 'ORDER_REFUNDED',
          message: 'По этому заказу оформлен возврат — деньги вернулись покупателю, лицензия по нему не выдаётся.',
        });
      case 35:
        throw new ConflictException({
          code: 'ORDER_REFUND_PENDING',
          message: 'По заказу начат возврат средств. Отмените заявку на возврат у площадки или дождитесь её завершения.',
        });
      default:
        this.logger.error(`счёт ${inv}: неизвестное invoice_state=${state}, выдача не сделана`);
        throw new ConflictException({
          code: 'ORDER_STATE_UNKNOWN',
          message: 'Площадка вернула непонятное состояние заказа. Напишите в поддержку и укажите номер заказа.',
        });
    }
  }

  /**
   * Бюджет попыток в час: на аккаунт и на источник (sourceKey вызывающего,
   * иначе IP) — аккаунты заводятся мгновенно, поэтому одного счётчика мало.
   * @param cost сколько попыток стоит проверка (подозрительные — дороже).
   */
  private async checkAttemptLimit(
    userId: string,
    ctx: RedeemContext,
    cost = 1,
  ): Promise<void> {
    const [perUser, perIpLegacy] = await Promise.all([
      this.settings.get<number>('limits.digiseller.attempts_per_hour', 30),
      this.settings.get<number>('limits.digiseller.attempts_per_ip_per_hour', 60),
    ]);

    // Старый ключ attempts_per_ip_per_hour служит умолчанием для нового.
    const perSource = await this.settings.get<number>(
      'limits.digiseller.attempts_per_source_per_hour',
      Number(perIpLegacy) || 60,
    );

    await this.bumpAttemptCounter(`${ATTEMPT_PREFIX}${userId}`, Number(perUser) || 30, cost);

    // Источник бывает общим (NAT), поэтому его порог выше пользовательского.
    const source = ctx.sourceKey ?? (ctx.ip ? `ip:${ctx.ip}` : null);
    if (source) {
      await this.bumpAttemptCounter(`${ATTEMPT_PREFIX}${source}`, Number(perSource) || 60, cost);
    }
  }

  private async bumpAttemptCounter(key: string, limit: number, cost: number): Promise<void> {
    let count: number;

    try {
      count = await this.redis.client.incrby(key, cost);
      if (count <= cost) await this.redis.client.expire(key, ATTEMPT_WINDOW_SEC);
      else if ((await this.redis.client.ttl(key)) < 0) await this.redis.client.expire(key, ATTEMPT_WINDOW_SEC);
    } catch {
      // Без Redis не блокируем оплату: перебор упрётся в лимиты площадки.
      this.logger.warn('счётчик попыток недоступен, пропускаю проверку лимита');
      return;
    }

    if (count > limit) {
      throw new BadRequestException({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Слишком много попыток. Попробуйте через час.',
      });
    }
  }

  /**
   * Счёт закрыт для пользователя промахами по почте? Проверяется до запроса
   * к площадке, чтобы перебирающий не узнал даже состояние счёта.
   */
  private async checkDealMismatchLock(userId: string, inv: bigint): Promise<void> {
    const key = `${MISMATCH_PREFIX}${userId}:${inv}`;
    let count = 0;
    let ttl = MISMATCH_WINDOW_SEC;
    try {
      count = Number(await this.redis.client.get(key)) || 0;
      if (count >= MISMATCH_MAX_PER_DEAL) {
        const left = Number(await this.redis.client.ttl(key));
        if (Number.isFinite(left) && left > 0) ttl = left;
      }
    } catch {
      return; // Redis лежит — блокировать нечем, общий бюджет попыток остаётся.
    }

    if (count >= MISMATCH_MAX_PER_DEAL) {
      // Отдельный код, а не ORDER_EMAIL_MISMATCH: клиент ветвится по коду.
      const minutes = Math.max(1, Math.ceil(ttl / 60));
      throw new ForbiddenException({
        code: 'ORDER_ATTEMPTS_EXHAUSTED',
        message: `Слишком много неудачных попыток по этому заказу. Повторите через ${minutes} мин.`,
        details: { retryAfterSec: ttl },
      });
    }
  }

  /** Списать стоимость промаха по почте. Возвращает номер промаха по этому счёту. */
  private async chargeEmailMismatch(userId: string, inv: bigint): Promise<number> {
    let count = 0;
    try {
      const key = `${MISMATCH_PREFIX}${userId}:${inv}`;
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, MISMATCH_WINDOW_SEC);
    } catch {
      this.logger.warn('счётчик промахов по почте недоступен');
    }

    // Одна попытка уже списана на входе — добираем до полной цены промаха.
    try {
      await this.bumpAttemptCounter(
        `${ATTEMPT_PREFIX}${userId}`,
        Number(await this.settings.get<number>('limits.digiseller.attempts_per_hour', 30)) || 30,
        MISMATCH_PENALTY - 1,
      );
    } catch {
      // Исчерпание бюджета не подменяет ответ про неверную почту.
    }

    return count;
  }
}
