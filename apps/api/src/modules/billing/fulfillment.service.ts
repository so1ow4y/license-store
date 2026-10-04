import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '@common/prisma/prisma.service';
import { LicensesService } from '@modules/licenses/licenses.service';
import { NotificationService } from '@modules/notifications/notification.service';

/**
 * Выполнение оплаченного заказа — общее для всех способов оплаты: выдать
 * лицензию, закрыть заказ, известить покупателя. Чтобы ЮKassa, крипта и
 * Digiseller не держали каждый свою копию этих правил.
 */
@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: LicensesService,
    private readonly notifications: NotificationService,
  ) {}

  /** Выдаёт лицензию по заказу в транзакции вызывающего и переводит заказ в DELIVERED. */
  async deliver(
    tx: Prisma.TransactionClient,
    order: { id: string; userId: string | null; productId: string; planId: string },
    /** Администратор, если выдачу завершил человек (разбор зависшей сделки). */
    issuedById?: string,
  ) {
    const license = await this.licenses.issue(
      {
        userId: order.userId,
        productId: order.productId,
        planId: order.planId,
        orderId: order.id,
        issuedById: issuedById ?? null,
      },
      tx,
    );
    await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DELIVERED, deliveredAt: new Date() },
    });
    return license;
  }

  /**
   * Письмо с ключом и копия в Telegram (там ключ заменяется маской — это
   * гарантирует NotificationService, а не автор шаблона).
   */
  async notifyIssued(userId: string | null, orderNumber: string, licenseId: string): Promise<void> {
    if (!userId) return;

    const issued = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: {
        key: true,
        expiresAt: true,
        user: { select: { username: true, locale: true } },
        product: { select: { name: true } },
        plan: { select: { name: true } },
      },
    });
    if (!issued) return;

    await this.notifications.enqueueMulti({
      templateKey: 'license.issued',
      userId,
      locale: issued.user?.locale,
      payload: {
        // Ось дедупликации Telegram-копий: две покупки подряд — два сообщения.
        licenseId,
        username: issued.user?.username ?? '',
        productName: issued.product.name,
        planName: issued.plan.name,
        licenseKey: issued.key,
        orderNumber,
        // Лицензия выдаётся в PENDING: срок пойдёт с первого запуска загрузчика.
        expiresAt: issued.expiresAt
          ? issued.expiresAt.toISOString().slice(0, 10)
          : issued.user?.locale === 'en'
            ? 'starts at first launch'
            : 'начнётся с первого запуска',
      },
    });
  }
}
