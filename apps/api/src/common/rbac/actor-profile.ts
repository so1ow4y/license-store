import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Профиль актора: набор прав, приоритет роли, признак второго фактора.
 * Общий для JwtAuthGuard и Telegram-бота. Формат кэша не менять без сброса
 * ключей: старые записи прочитаются как приоритет 0.
 */

/** Кэш прав пользователя в Redis. Ключ общий с PermissionsService.invalidate. */
export const PERMISSIONS_PREFIX = 'user:permissions:';
export const PERMISSIONS_TTL_SEC = 300;

export interface ActorProfile {
  permissions: Set<string>;
  /**
   * Наибольший приоритет среди ролей пользователя: 100 super_admin,
   * 80 админ, 60 поддержка, 10 пользователь (prisma/seed.ts).
   */
  rolePriority: number;
  /** Второй фактор включён И подтверждён. */
  twoFactorEnabled: boolean;
}

/**
 * Права пользователя с кэшем в Redis.
 *
 * Пять минут — компромисс: изменение роли применяется достаточно быстро,
 * а на горячем пути не появляется трёх JOIN'ов на каждый запрос.
 * Для немедленного эффекта админские операции сбрасывают ключ явно
 * (PermissionsService.invalidate).
 */
export async function loadActorProfile(
  prisma: PrismaService,
  redis: RedisService,
  userId: string,
): Promise<ActorProfile> {
  const cacheKey = `${PERMISSIONS_PREFIX}${userId}`;
  const cached = await redis.client.get(cacheKey);

  if (cached !== null) {
    // Формат: "приоритет|2fa|право,право,…". Приоритет и признак 2FA
    // лежат в том же ключе, а не отдельными: иначе они разъезжались бы
    // между собой при частичном истечении, и привилегированный
    // пользователь на секунду оказывался бы обычным.
    //
    // Пустой список прав — валидное значение. Без явной проверки на null
    // такой случай перечитывался бы из БД на каждый запрос.
    const [priorityRaw, twoFactorRaw, slugs = ''] = cached.split('|');
    return {
      permissions: new Set(slugs ? slugs.split(',') : []),
      rolePriority: Number(priorityRaw) || 0,
      twoFactorEnabled: twoFactorRaw === '1',
    };
  }

  const [rows, user] = await Promise.all([
    prisma.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            priority: true,
            permissions: { select: { permission: { select: { slug: true } } } },
          },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorConfirmedAt: true },
    }),
  ]);

  const permissions = new Set<string>();
  let rolePriority = 0;
  for (const row of rows) {
    rolePriority = Math.max(rolePriority, row.role.priority);
    for (const rp of row.role.permissions) {
      permissions.add(rp.permission.slug);
    }
  }

  const twoFactorEnabled = Boolean(user?.twoFactorEnabled && user.twoFactorConfirmedAt);

  await redis.client.set(
    cacheKey,
    `${rolePriority}|${twoFactorEnabled ? '1' : '0'}|${[...permissions].join(',')}`,
    'EX',
    PERMISSIONS_TTL_SEC,
  );

  return { permissions, rolePriority, twoFactorEnabled };
}
