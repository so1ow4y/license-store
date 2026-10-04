import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RedisService } from '@common/redis/redis.service';

import { LicensesService } from './licenses.service';

/**
 * Обслуживание сроков лицензий.
 *
 * Раз в час, а не раз в минуту: точность до часа для срока в днях
 * избыточна, а лишние проходы по таблице лицензий не бесплатны.
 * Пользователь, у которого лицензия истекла пять минут назад, всё равно
 * получит отказ — проверка лицензии смотрит на expires_at, а не только
 * на статус.
 */

const LOCK_KEY = 'licenses:expiry:lock';
const LOCK_TTL_SEC = 300;

@Injectable()
export class LicenseExpiryProcessor {
  private readonly logger = new Logger(LicenseExpiryProcessor.name);

  constructor(
    private readonly licenses: LicensesService,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    // Блокировка на случай нескольких реплик: иначе предупреждения
    // об истечении уйдут пользователю столько раз, сколько инстансов.
    const acquired = await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEC, 'NX');
    if (acquired === null) return;

    try {
      // Порядок важен: сначала предупреждаем тех, у кого срок ещё идёт,
      // и только потом переводим истёкшие. Обратный порядок отправил бы
      // предупреждение «остался 1 день» уже истёкшей лицензии.
      await this.licenses.notifyExpiring();
      await this.licenses.expireOverdue();
    } catch (error) {
      this.logger.error(
        `сбой обслуживания сроков: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.redis.client.del(LOCK_KEY);
    }
  }
}
