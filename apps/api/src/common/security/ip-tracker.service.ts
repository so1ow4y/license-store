import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { normalizeIp } from './ip';

/** Повторная отметка той же пары «пользователь — адрес» не чаще, чем раз в 10 минут. */
const SEEN_TTL_SEC = 600;

/**
 * Учёт адресов пользователя (user_ips): с каких IP он работал, когда впервые
 * и в последний раз, сколько раз. Вызывается на каждом запросе с токеном,
 * поэтому дубли отсекаются в Redis, а ошибки не роняют запрос.
 */
@Injectable()
export class IpTrackerService {
  private readonly logger = new Logger(IpTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async touch(userId: string, rawIp: string | undefined, userAgent?: string): Promise<void> {
    const ip = normalizeIp(rawIp);
    if (!ip) return;
    try {
      const fresh = await this.redis.client.set(`ipseen:${userId}:${ip}`, '1', 'EX', SEEN_TTL_SEC, 'NX');
      if (fresh !== 'OK') return;

      const agent = userAgent?.slice(0, 500) ?? null;
      await this.prisma.userIp.upsert({
        where: { userId_ip: { userId, ip } },
        create: { userId, ip, lastUserAgent: agent },
        update: { lastSeenAt: new Date(), hits: { increment: 1 }, ...(agent ? { lastUserAgent: agent } : {}) },
      });
    } catch (error) {
      this.logger.warn(`адрес не учтён: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
