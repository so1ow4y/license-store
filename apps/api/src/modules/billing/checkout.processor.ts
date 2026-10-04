import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RedisService } from '@common/redis/redis.service';

import { CheckoutService } from './checkout.service';

/**
 * Фоновые задачи покупок. Блокировка в Redis — чтобы при нескольких репликах
 * проход делала одна.
 */
@Injectable()
export class CheckoutProcessor {
  private readonly logger = new Logger(CheckoutProcessor.name);

  constructor(
    private readonly checkout: CheckoutService,
    private readonly redis: RedisService,
  ) {}

  /** Вебхук ЮKassa может не дойти — раз в 5 минут сверяем висящие платежи сами. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncYookassa(): Promise<void> {
    await this.locked('checkout:yookassa:lock', 240, () => this.checkout.syncPendingYookassa());
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async expireCrypto(): Promise<void> {
    await this.locked('checkout:crypto-expiry:lock', 600, async () => {
      const cancelled = await this.checkout.expireStaleCrypto();
      if (cancelled) this.logger.log(`отменено неоплаченных крипто-заказов: ${cancelled}`);
    });
  }

  private async locked(key: string, ttlSec: number, job: () => Promise<void>): Promise<void> {
    const acquired = await this.redis.client.set(key, '1', 'EX', ttlSec, 'NX');
    if (acquired === null) return;
    try {
      await job();
    } catch (error) {
      this.logger.error(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await this.redis.client.del(key);
    }
  }
}
