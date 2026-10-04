import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

/** Тот же префикс, что использует JwtAuthGuard при чтении кэша. */
const PERMISSIONS_PREFIX = 'user:permissions:';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Сброс кэша прав пользователя. Обязателен при любом изменении ролей и
   * статуса 2FA: иначе изменение вступит в силу только через время жизни
   * кэша (5 минут), и разжалованный админ всё это время сохранит доступ.
   */
  async invalidate(userId: string): Promise<void> {
    await this.redis.client.del(`${PERMISSIONS_PREFIX}${userId}`);
    this.logger.log(`сброшен кэш прав пользователя ${userId}`);
  }
}
