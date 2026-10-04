import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminUsersService } from '../src/modules/admin/admin-users.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { PermissionsService } from '../src/common/rbac/permissions.service';
import type { IpBlockService } from '../src/common/security/ip-block.service';
import type { AuthenticatedUser } from '../src/modules/auth/guards/jwt-auth.guard';
import type { TokenService } from '../src/modules/auth/token.service';

/**
 * Иерархия ролей: сотрудник не назначит роль не ниже своей, не тронет
 * равного или старшего и не изменит сам себя. Иначе админ безопасности
 * сделал бы себя или соседа super_admin.
 */

const ROLES = {
  super_admin: { id: 'r100', slug: 'super_admin', priority: 100 },
  security_admin: { id: 'r80', slug: 'security_admin', priority: 80 },
  support: { id: 'r60', slug: 'support', priority: 60 },
  user: { id: 'r10', slug: 'user', priority: 10 },
};

const ADMIN: AuthenticatedUser = {
  id: 'admin-id',
  sessionId: 's',
  permissions: new Set(['roles.assign', 'users.block']),
  rolePriority: 80,
  twoFactorEnabled: true,
};

function makeService(targetRoles: Array<keyof typeof ROLES>) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'target-id',
        username: 'target',
        email: null,
        status: 'ACTIVE',
        emailVerifiedAt: null,
        roles: targetRoles.map((slug) => ({ role: ROLES[slug] })),
      })),
      update: vi.fn(async () => ({})),
    },
    role: {
      findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] } } }) =>
        where.slug.in.map((slug) => ROLES[slug as keyof typeof ROLES]).filter(Boolean),
      ),
    },
    userRole: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async () => []),
  } as unknown as PrismaService;

  const service = new AdminUsersService(
    prisma,
    { invalidate: vi.fn(async () => undefined) } as unknown as PermissionsService,
    { revokeAllUserSessions: vi.fn(async () => 1) } as unknown as TokenService,
    { record: vi.fn(async () => undefined) } as unknown as AuditService,
    { isBlocked: vi.fn(async () => false) } as unknown as IpBlockService,
  );
  // get() после изменения не нужен для проверки решения о доступе.
  vi.spyOn(service, 'get').mockResolvedValue({} as never);
  return { service, prisma };
}

describe('AdminUsersService — иерархия', () => {
  it('назначает поддержку пользователю', async () => {
    const { service, prisma } = makeService(['user']);
    await service.setRoles(ADMIN, 'target-id', ['user', 'support']);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('не назначает роль своего уровня и выше', async () => {
    const { service } = makeService(['user']);
    await expect(service.setRoles(ADMIN, 'target-id', ['security_admin'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setRoles(ADMIN, 'target-id', ['super_admin'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('без права на адреса поиск по ip запрещён', async () => {
    const { service } = makeService(['user']);
    await expect(service.list(ADMIN, { q: 'ip:10.0.0.1' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('не трогает равного по роли', async () => {
    const { service } = makeService(['security_admin']);
    await expect(service.setRoles(ADMIN, 'target-id', ['user'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.block(ADMIN, 'target-id', 'причина')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('не меняет сам себя', async () => {
    const { service } = makeService(['user']);
    await expect(service.setRoles(ADMIN, ADMIN.id, ['user'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('блокировка завершает все сессии', async () => {
    const tokens = { revokeAllUserSessions: vi.fn(async () => 2) };
    const { service, prisma } = makeService(['user']);
    (service as unknown as { tokens: typeof tokens }).tokens = tokens;

    await service.block(ADMIN, 'target-id', 'передача доступа');

    expect(prisma.user.update).toHaveBeenCalled();
    expect(tokens.revokeAllUserSessions).toHaveBeenCalledWith('target-id', 'blocked');
  });
});
