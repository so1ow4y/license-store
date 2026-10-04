import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApiKeyOwnerType } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { CryptoService } from '@common/crypto/crypto.service';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';

/**
 * Ключи API для сборок загрузчика.
 *
 * Ключ состоит из двух частей: публичного префикса, который уходит
 * в заголовок X-Api-Key, и секрета подписи, который ложится в бинарник
 * сборки. Секрет отдаётся ОДИН раз при создании — повторно сервер
 * его не покажет.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async create(
    params: { name: string; scopes?: string[]; expiresAt?: Date },
    actorId: string,
  ): Promise<{ prefix: string; signingSecret: string }> {
    // Префикс узнаваем глазами: в логах и в поддержке сразу видно,
    // что это ключ платформы, а не случайная строка.
    //
    // Длина подогнана под колонку prefix VARCHAR(16): 3 символа маркера
    // плюс 8 hex — ровно 11. Это публичный идентификатор, а не секрет,
    // и энтропии здесь достаточно: уникальность обеспечивает UNIQUE-индекс.
    const prefix = `lp_${randomBytes(4).toString('hex')}`;
    const rawKey = randomBytes(32).toString('base64url');
    const signingSecret = randomBytes(32).toString('base64url');
    const id = uuidv7();

    await this.prisma.apiKey.create({
      data: {
        id,
        name: params.name,
        ownerType: ApiKeyOwnerType.SYSTEM,
        prefix,
        // Сам ключ хешируется Argon2: в отличие от секрета подписи,
        // сервер его никогда не расшифровывает — только сверяет.
        keyHash: (await this.passwords.hashPassword(rawKey)).hash,
        // А секрет подписи нужен в открытом виде на каждой проверке,
        // поэтому он шифруется обратимо, с привязкой к строке.
        signingSecretEnc: this.crypto.encrypt(signingSecret, {
          table: 'api_keys',
          column: 'signing_secret_enc',
          rowId: id,
        }),
        signingSecretKeyVer: this.crypto.keyVersion,
        scopes: params.scopes ?? [],
        expiresAt: params.expiresAt ?? null,
      },
    });

    await this.audit.record({
      action: 'apikey.create',
      actorId,
      actorType: 'USER',
      entityType: 'api_key',
      entityId: id,
      // Ни ключ, ни секрет в аудит не попадают.
      after: { name: params.name, prefix },
    });

    this.logger.log(`выпущен ключ API ${prefix} (${params.name})`);

    return { prefix, signingSecret };
  }

  async list() {
    return this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        lastUsedIp: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Отзыв ключа.
   *
   * Кэш сбрасывается сразу: иначе отозванная сборка продолжит работать
   * до истечения TTL, а отзыв нужен именно тогда, когда ждать нельзя.
   */
  async revoke(id: string, actorId: string): Promise<void> {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ключ не найден' });
    }

    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.redis.client.del(`apikey:${key.prefix}`);

    await this.audit.record({
      action: 'apikey.revoke',
      actorId,
      actorType: 'USER',
      entityType: 'api_key',
      entityId: id,
      before: { revokedAt: null },
      after: { revokedAt: new Date().toISOString() },
    });

    this.logger.warn(`отозван ключ API ${key.prefix}`);
  }
}
