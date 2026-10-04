import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ResellerStatus, ResellerTopupStatus, ResellerTxType, type ResellerTopup } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { ENV, type Env } from '@common/config/env.schema';
import { PrismaService } from '@common/prisma/prisma.service';
import { SettingsService } from '@common/settings/settings.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';
import { cryptoAmount, normalizeTxHash } from '@modules/billing/checkout.service';
import { PaymentProfilesService } from '@modules/billing/payment-profiles.service';
import { NotificationService } from '@modules/notifications/notification.service';

import type { ConfirmTopupDto, CreateTopupDto, ListTopupsDto } from './dto/resellers.dto';
import { ResellersService } from './resellers.service';

/**
 * Пополнение баланса реселлера криптой — как заказ покупателя:
 * заявка (адрес и сумма в монетах по курсу кошелька) → реселлер переводит и
 * присылает хеш → администратор сверяет перевод и подтверждает → строка
 * TOPUP в журнале баланса. Подтверждать может обладатель
 * resellers.topups.confirm (супер-админ и поддержка).
 *
 * Позже подтверждение заменит автоматическая сверка с блокчейном; заявка и
 * журнал при этом останутся теми же.
 */

const MAX_OPEN_TOPUPS = 5;
const OPEN: ResellerTopupStatus[] = [ResellerTopupStatus.PENDING, ResellerTopupStatus.SUBMITTED];

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

interface CryptoInstructions {
  kind: 'crypto';
  walletId: string;
  currency: string;
  network: string;
  address: string;
  amount: string;
  explorerTxUrl: string | null;
  note: string | null;
}

@Injectable()
export class ResellerTopupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
    private readonly profiles: PaymentProfilesService,
    private readonly resellers: ResellersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------- реселлер

  private async mine(userId: string) {
    const reseller = await this.prisma.reseller.findUnique({ where: { userId } });
    if (!reseller) throw new NotFoundException({ code: 'RESELLER_NOT_FOUND', message: 'Этот аккаунт не реселлер' });
    return reseller;
  }

  /** Кошельки, на которые можно пополнить баланс. */
  async options(userId: string) {
    const reseller = await this.mine(userId);
    return { currency: reseller.currency, wallets: await this.profiles.topupWallets() };
  }

  async create(actor: AuthenticatedUser, dto: CreateTopupDto) {
    const reseller = await this.mine(actor.id);
    // Приостановленный может пополнить — например, чтобы закрыть долг;
    // закрытое сотрудничество — нет.
    if (reseller.status === ResellerStatus.CLOSED) {
      throw new ForbiddenException({ code: 'RESELLER_INACTIVE', message: 'Сотрудничество закрыто' });
    }
    const open = await this.prisma.resellerTopup.count({ where: { resellerId: reseller.id, status: { in: OPEN } } });
    if (open >= MAX_OPEN_TOPUPS) {
      throw new ConflictException({
        code: 'TOO_MANY_PENDING_TOPUPS',
        message: 'Слишком много незавершённых заявок. Завершите или отмените прежние.',
      });
    }

    const target = await this.profiles.topupTarget(dto.walletId);
    const amount = D(dto.amount).toDecimalPlaces(2);
    const instructions: CryptoInstructions = {
      kind: 'crypto',
      walletId: target.wallet.id,
      currency: target.wallet.currency,
      network: target.wallet.network,
      address: target.wallet.address,
      amount: cryptoAmount(amount, target.wallet.rate, target.wallet.decimals),
      explorerTxUrl: target.wallet.explorerTxUrl ?? null,
      note: target.config.instructions ?? null,
    };
    const id = uuidv7();
    await this.prisma.resellerTopup.create({
      data: {
        id,
        resellerId: reseller.id,
        amount,
        currency: reseller.currency,
        profileId: target.profileId,
        walletId: target.wallet.id,
        instructions: instructions as unknown as Prisma.InputJsonValue,
        note: dto.note?.trim() || null,
        expiresAt: new Date(Date.now() + target.config.expireHours * 3_600_000),
      },
    });
    await this.audit.record({
      action: 'reseller.topup.create',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller_topup',
      entityId: id,
      after: { amount: amount.toFixed(2), currency: reseller.currency, coin: instructions.currency, coins: instructions.amount },
    });
    return this.view(await this.prisma.resellerTopup.findUniqueOrThrow({ where: { id } }));
  }

  /** Реселлер присылает хеш перевода — заявка уходит администратору. */
  async submitTx(actor: AuthenticatedUser, id: string, rawTxHash: string) {
    const reseller = await this.mine(actor.id);
    const topup = await this.prisma.resellerTopup.findFirst({ where: { id, resellerId: reseller.id } });
    if (!topup) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Заявка не найдена' });
    if (!OPEN.includes(topup.status)) {
      throw new ConflictException({ code: 'TOPUP_NOT_OPEN', message: 'Заявка уже рассмотрена или отменена' });
    }
    if (topup.status === ResellerTopupStatus.PENDING && topup.expiresAt.getTime() < Date.now()) {
      throw new ConflictException({ code: 'TOPUP_EXPIRED', message: 'Срок заявки истёк — создайте новую' });
    }

    const txHash = normalizeTxHash(rawTxHash);
    // Один перевод — одна оплата: хеш не должен совпадать ни с заказом
    // покупателя, ни с другой заявкой.
    const usedByOrder = await this.prisma.payment.findFirst({
      where: { provider: 'CRYPTO', externalId: txHash },
      select: { id: true },
    });
    if (usedByOrder) throw new ConflictException({ code: 'TX_ALREADY_USED', message: 'Эта транзакция уже указана в заказе' });

    try {
      await this.prisma.resellerTopup.update({
        where: { id },
        data: { txHash, status: ResellerTopupStatus.SUBMITTED, submittedAt: topup.submittedAt ?? new Date() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'TX_ALREADY_USED', message: 'Эта транзакция уже указана в другой заявке' });
      }
      throw error;
    }

    await this.audit.record({
      action: 'reseller.topup.submitted',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller_topup',
      entityId: id,
      after: { txHash },
    });
    // Исправленная опечатка в хеше не будит администраторов второй раз.
    if (!topup.submittedAt) await this.notifyReviewers(id);
    return this.view(await this.prisma.resellerTopup.findUniqueOrThrow({ where: { id } }));
  }

  async cancel(actor: AuthenticatedUser, id: string) {
    const reseller = await this.mine(actor.id);
    const cancelled = await this.prisma.resellerTopup.updateMany({
      where: { id, resellerId: reseller.id, status: ResellerTopupStatus.PENDING },
      data: { status: ResellerTopupStatus.CANCELLED },
    });
    if (cancelled.count === 0) {
      throw new ConflictException({ code: 'TOPUP_NOT_CANCELLABLE', message: 'Отменить можно только заявку без отправленного хеша' });
    }
    return this.view(await this.prisma.resellerTopup.findUniqueOrThrow({ where: { id } }));
  }

  async listMine(userId: string, page: { skip?: number; take?: number }) {
    const reseller = await this.mine(userId);
    const take = page.take ?? 25;
    const skip = page.skip ?? 0;
    const where = { resellerId: reseller.id };
    const [rows, total] = await Promise.all([
      this.prisma.resellerTopup.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.resellerTopup.count({ where }),
    ]);
    return { items: rows.map((r) => this.view(r)), total, skip, take };
  }

  // ---------------------------------------------------------- администратор

  async list(dto: ListTopupsDto) {
    const where: Prisma.ResellerTopupWhereInput = dto.status
      ? dto.status === 'OPEN'
        ? { status: { in: OPEN } }
        : { status: dto.status }
      : {};
    const take = dto.take ?? 50;
    const skip = dto.skip ?? 0;
    const [rows, total, awaiting] = await Promise.all([
      this.prisma.resellerTopup.findMany({
        where,
        // Ждущие проверки — первыми, внутри — старые первыми: их ждут дольше.
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take,
        include: { reseller: { select: { id: true, displayName: true, user: { select: { username: true } } } } },
      }),
      this.prisma.resellerTopup.count({ where }),
      this.prisma.resellerTopup.count({ where: { status: ResellerTopupStatus.SUBMITTED } }),
    ]);
    return {
      items: rows.map(({ reseller, ...row }) => ({ ...this.view(row), reseller })),
      total,
      skip,
      take,
      awaiting,
    };
  }

  /** Подтверждение: заявка закрывается, баланс пополняется одной транзакцией. */
  async confirm(actor: AuthenticatedUser, id: string, dto: ConfirmTopupDto) {
    const topup = await this.prisma.resellerTopup.findUnique({
      where: { id },
      include: { reseller: { select: { id: true, userId: true, displayName: true } } },
    });
    if (!topup) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Заявка не найдена' });
    // Пришло меньше заявленного — администратор зачисляет фактическую сумму.
    const credited = dto.amount !== undefined ? D(dto.amount).toDecimalPlaces(2) : topup.amount;
    const instructions = topup.instructions as unknown as CryptoInstructions;

    const balance = await this.prisma.$transaction(async (tx) => {
      // Условие в UPDATE: два администратора не зачислят одну заявку дважды.
      const closed = await tx.resellerTopup.updateMany({
        where: { id, status: { in: OPEN } },
        data: {
          status: ResellerTopupStatus.CONFIRMED,
          creditedAmount: credited,
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      });
      if (closed.count === 0) {
        throw new ConflictException({ code: 'TOPUP_NOT_OPEN', message: 'Заявка уже рассмотрена или отменена' });
      }
      const transactionId = uuidv7();
      const after = await this.resellers.credit(
        tx,
        topup.resellerId,
        credited,
        {
          type: ResellerTxType.TOPUP,
          comment:
            dto.comment?.trim() ||
            `пополнение криптой: ${instructions.amount} ${instructions.currency} (${instructions.network})${topup.txHash ? `, TX ${topup.txHash}` : ''}`,
          createdById: actor.id,
        },
        transactionId,
      );
      await tx.resellerTopup.update({ where: { id }, data: { transactionId } });
      return after;
    });

    await this.audit.record({
      action: 'reseller.topup.confirm',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller_topup',
      entityId: id,
      after: { requested: topup.amount.toFixed(2), credited: credited.toFixed(2), balance: balance.toFixed(2), txHash: topup.txHash },
    });
    await this.notifications.enqueueMulti({
      templateKey: 'reseller.topup.confirmed',
      userId: topup.reseller.userId,
      payload: { licenseId: id, amount: credited.toFixed(2), currency: topup.currency, balance: balance.toFixed(2) },
    });
    return { balance };
  }

  async reject(actor: AuthenticatedUser, id: string, reason: string) {
    const topup = await this.prisma.resellerTopup.findUnique({
      where: { id },
      include: { reseller: { select: { userId: true } } },
    });
    if (!topup) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Заявка не найдена' });
    const closed = await this.prisma.resellerTopup.updateMany({
      where: { id, status: { in: OPEN } },
      data: { status: ResellerTopupStatus.REJECTED, rejectReason: reason.trim(), reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (closed.count === 0) {
      throw new ConflictException({ code: 'TOPUP_NOT_OPEN', message: 'Заявка уже рассмотрена или отменена' });
    }
    await this.audit.record({
      action: 'reseller.topup.reject',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'reseller_topup',
      entityId: id,
      after: { reason: reason.trim(), txHash: topup.txHash },
    });
    await this.notifications.enqueueMulti({
      templateKey: 'reseller.topup.rejected',
      userId: topup.reseller.userId,
      payload: { licenseId: id, amount: topup.amount.toFixed(2), currency: topup.currency, reason: reason.trim() },
    });
    return { ok: true };
  }

  // ------------------------------------------------------------- внутреннее

  /** Алерт всем, кто может подтверждать пополнения: почта и Telegram-админка. */
  private async notifyReviewers(id: string): Promise<void> {
    const topup = await this.prisma.resellerTopup.findUniqueOrThrow({
      where: { id },
      include: { reseller: { select: { displayName: true } } },
    });
    const instructions = topup.instructions as unknown as CryptoInstructions;
    const reviewers = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { slug: 'resellers.topups.confirm' } } } } } },
      },
      select: { id: true, locale: true },
      take: 20,
    });
    const base = (await this.settings.getString('app.frontend_url', this.env.FRONTEND_URL)).replace(/\/+$/, '');
    for (const reviewer of reviewers) {
      await this.notifications.enqueueMulti({
        templateKey: 'reseller.topup.awaiting',
        userId: reviewer.id,
        locale: reviewer.locale,
        payload: {
          licenseId: topup.id,
          resellerName: topup.reseller.displayName,
          amount: topup.amount.toFixed(2),
          currency: topup.currency,
          method: `${instructions.amount} ${instructions.currency} (${instructions.network})`,
          details: `TX: ${topup.txHash ?? '—'}`,
          adminUrl: `${base}/admin/resellers?tab=topups`,
        },
      });
    }
  }

  private view(row: ResellerTopup) {
    const expired = row.status === ResellerTopupStatus.PENDING && row.expiresAt.getTime() < Date.now();
    return {
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      expired,
      instructions: row.instructions as unknown as CryptoInstructions,
      txHash: row.txHash,
      creditedAmount: row.creditedAmount,
      note: row.note,
      rejectReason: row.rejectReason,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
    };
  }
}
