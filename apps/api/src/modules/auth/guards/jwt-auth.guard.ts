import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { PrismaService } from '@common/prisma/prisma.service';
import { loadActorProfile } from '@common/rbac/actor-profile';
import { RedisService } from '@common/redis/redis.service';
import { IpTrackerService } from '@common/security/ip-tracker.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../token.service';

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  permissions: Set<string>;
  /**
   * Наибольший приоритет среди ролей пользователя: 100 super_admin,
   * 80 админ, 60 поддержка, 10 пользователь (prisma/seed.ts).
   *
   * Нужен, чтобы отличить привилегированного человека от обычного, не
   * гадая по названиям прав. Требование «у администратора обязана быть
   * 2FA» иначе пришлось бы выражать перечислением слагов, и первое же
   * новое право разошлось бы со списком.
   */
  rolePriority: number;
  /** Второй фактор включён И подтверждён. */
  twoFactorEnabled: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Проверка access-токена.
 *
 * Помимо подписи JWT делает две вещи, ради которых стоит один просмотр
 * в Redis на запрос:
 *
 *   1. Проверяет, не отозвана ли сессия. Токен живёт 15 минут, и без
 *      этой проверки заблокированный админом пользователь продолжал бы
 *      работать до истечения токена.
 *   2. Загружает актуальные права. В токене их нет намеренно — иначе
 *      снятие роли вступало бы в силу с той же задержкой.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
    private readonly ipTracker: IpTrackerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Требуется авторизация',
      });
    }

    const payload = this.tokens.verifyAccessToken(token);

    if (await this.tokens.isSessionRevoked(payload.sid)) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Сессия завершена. Войдите заново.',
      });
    }

    const profile = await this.loadProfile(payload.sub);

    request.user = {
      id: payload.sub,
      sessionId: payload.sid,
      permissions: profile.permissions,
      rolePriority: profile.rolePriority,
      twoFactorEnabled: profile.twoFactorEnabled,
    };

    // Адрес в список IP пользователя — не дожидаясь, ответ не задерживается.
    const userAgent = request.headers['user-agent'];
    void this.ipTracker.touch(payload.sub, request.ip, typeof userAgent === 'string' ? userAgent : undefined);

    return true;
  }

  /**
   * Права пользователя с кэшем в Redis.
   *
   * Тело вынесено в @common/rbac/actor-profile: тот же профиль собирает
   * Telegram-бот, который приходит не по HTTP и через этот гвард не
   * проходит. Две копии логики разошлись бы при первой правке ролей.
   */
  private async loadProfile(userId: string): Promise<{
    permissions: Set<string>;
    rolePriority: number;
    twoFactorEnabled: boolean;
  }> {
    return loadActorProfile(this.prisma, this.redis, userId);
  }

  private extractToken(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;

    return value;
  }
}
