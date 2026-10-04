import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';

/**
 * Выдача и ротация токенов.
 *
 * Access-токен — короткоживущий JWT, несёт только идентификаторы:
 * пользователя и сессии. Прав в нём нет намеренно — иначе снятие роли
 * вступало бы в силу через 15 минут, а для админки это неприемлемо.
 *
 * Refresh-токен — 32 случайных байта. В БД лежит только SHA-256 от него:
 * дамп базы не даёт возможности войти. Argon2 здесь не нужен — перебирать
 * 256 бит случайности нечем, в отличие от пароля.
 */

/** Префикс ключей Redis, помечающих отозванные сессии. */
const REVOKED_SESSION_PREFIX = 'session:revoked:';

export interface AccessTokenPayload {
  /** ID пользователя. */
  sub: string;
  /** ID сессии — по нему проверяется отзыв. */
  sid: string;
  /** Уникальный ID токена, для аудита. */
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Время жизни access-токена в секундах. */
  expiresIn: number;
  sessionId: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Первичная выдача пары токенов при входе.
   * Создаёт новую сессию и новую семью refresh-токенов.
   */
  async issuePair(params: {
    userId: string;
    ip?: string;
    userAgent?: string;
    device?: string;
    clientVersion?: string;
    country?: string;
    city?: string;
  }): Promise<TokenPair> {
    const accessTtl = await this.settings.getNumber('security.jwt.access_ttl_sec', 900);
    const refreshTtl = await this.settings.getNumber('security.jwt.refresh_ttl_sec', 2_592_000);

    const sessionId = uuidv7();
    const family = uuidv7();
    const now = Date.now();

    const session = await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: params.userId,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        device: params.device ?? null,
        clientVersion: params.clientVersion ?? null,
        country: params.country ?? null,
        city: params.city ?? null,
        expiresAt: new Date(now + refreshTtl * 1000),
      },
    });

    const refreshToken = await this.createRefreshToken({
      userId: params.userId,
      sessionId: session.id,
      family,
      ttlSec: refreshTtl,
      ip: params.ip,
    });

    return {
      accessToken: this.signAccessToken(params.userId, session.id, accessTtl),
      refreshToken,
      expiresIn: accessTtl,
      sessionId: session.id,
    };
  }

  /**
   * Обновление пары по refresh-токену.
   *
   * Здесь же живёт обнаружение кражи: предъявление уже потраченного
   * токена гасит всю семью.
   */
  async rotate(rawToken: string, ip?: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });

    if (!stored) {
      throw new UnauthorizedException({ code: 'TOKEN_INVALID', message: 'Токен недействителен' });
    }

    // Повторное использование. Легитимный клиент давно перешёл на
    // следующий токен в цепочке — значит, этот кто-то перехватил.
    if (stored.usedAt) {
      await this.revokeFamily(stored.family, 'reuse_detected');
      this.logger.warn(
        `повторное использование refresh-токена, семья ${stored.family} погашена целиком`,
      );
      throw new UnauthorizedException({
        code: 'TOKEN_REUSED',
        message: 'Сессия завершена по соображениям безопасности. Войдите заново.',
      });
    }

    if (stored.revokedAt) {
      throw new UnauthorizedException({ code: 'TOKEN_REVOKED', message: 'Токен отозван' });
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', message: 'Токен истёк' });
    }

    if (stored.session.revokedAt) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Сессия завершена' });
    }

    const accessTtl = await this.settings.getNumber('security.jwt.access_ttl_sec', 900);
    const refreshTtl = await this.settings.getNumber('security.jwt.refresh_ttl_sec', 2_592_000);

    const newTokenId = uuidv7();
    const newRaw = this.generateRawToken();

    // Гашение старого и создание нового — в одной транзакции.
    // Условие usedAt: null стоит внутри UPDATE, а не в отдельном SELECT:
    // два параллельных обновления с одним токеном иначе оба прошли бы
    // проверку и создали две ветки цепочки.
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date(), replacedById: newTokenId },
      });

      if (claimed.count === 0) {
        // Между чтением и записью кто-то успел потратить токен —
        // это тот же признак кражи.
        throw new UnauthorizedException({
          code: 'TOKEN_REUSED',
          message: 'Сессия завершена по соображениям безопасности. Войдите заново.',
        });
      }

      await tx.refreshToken.create({
        data: {
          id: newTokenId,
          userId: stored.userId,
          sessionId: stored.sessionId,
          tokenHash: this.hashToken(newRaw),
          family: stored.family,
          expiresAt: new Date(Date.now() + refreshTtl * 1000),
          createdIp: ip ?? null,
        },
      });

      await tx.session.update({
        where: { id: stored.sessionId },
        data: { lastSeenAt: new Date() },
      });
    });

    return {
      accessToken: this.signAccessToken(stored.userId, stored.sessionId, accessTtl),
      refreshToken: newRaw,
      expiresIn: accessTtl,
      sessionId: stored.sessionId,
    };
  }

  /** Проверка и разбор access-токена. */
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return this.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', message: 'Токен недействителен' });
    }
  }

  /**
   * Отозвана ли сессия. Один просмотр в Redis.
   *
   * Именно поэтому прав нет в самом токене: снятие роли или блокировка
   * пользователя должны действовать сразу, а не через время жизни JWT.
   */
  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const flag = await this.redis.client.get(`${REVOKED_SESSION_PREFIX}${sessionId}`);
    return flag !== null;
  }

  /** Завершение одной сессии — выход пользователя. */
  async revokeSession(sessionId: string, reason: string): Promise<void> {
    const refreshTtl = await this.settings.getNumber('security.jwt.refresh_ttl_sec', 2_592_000);

    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: reason },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // TTL равен времени жизни refresh: дольше держать метку незачем,
    // после этого сессия всё равно не воскреснет.
    await this.redis.client.set(`${REVOKED_SESSION_PREFIX}${sessionId}`, reason, 'EX', refreshTtl);
  }

  /** Завершение всех сессий пользователя — блокировка, смена пароля. */
  async revokeAllUserSessions(userId: string, reason: string): Promise<number> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });

    for (const session of sessions) {
      await this.revokeSession(session.id, reason);
    }

    return sessions.length;
  }

  /**
   * Гашение всей семьи токенов при обнаружении кражи.
   *
   * Гасится именно семья, а не один токен: атакующий может держать
   * на руках любое звено цепочки, и погасив только предъявленное,
   * мы оставили бы ему доступ.
   */
  private async revokeFamily(family: string, reason: string): Promise<void> {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { family },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });

    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    for (const { sessionId } of tokens) {
      await this.revokeSession(sessionId, reason);
    }
  }

  private async createRefreshToken(params: {
    userId: string;
    sessionId: string;
    family: string;
    ttlSec: number;
    ip?: string;
  }): Promise<string> {
    const raw = this.generateRawToken();

    await this.prisma.refreshToken.create({
      data: {
        id: uuidv7(),
        userId: params.userId,
        sessionId: params.sessionId,
        tokenHash: this.hashToken(raw),
        family: params.family,
        expiresAt: new Date(Date.now() + params.ttlSec * 1000),
        createdIp: params.ip ?? null,
      },
    });

    return raw;
  }

  private signAccessToken(userId: string, sessionId: string, ttlSec: number): string {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, jti: uuidv7() };
    return this.jwt.sign(payload, { expiresIn: ttlSec });
  }

  /** 32 байта из криптографического источника. */
  private generateRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * SHA-256 достаточно: токен — это 256 бит случайности, перебирать
   * его нечем. Argon2 нужен там, где секрет выбирает человек.
   */
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }
}
