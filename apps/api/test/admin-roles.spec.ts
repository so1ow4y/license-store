import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminRolesService } from '../src/modules/admin/admin-roles.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { PermissionsService } from '../src/common/rbac/permissions.service';
import type { AuthenticatedUser } from '../src/modules/auth/guards/jwt-auth.guard';

/**
 * Свои роли: собрать роль выше себя или с чужими правами нельзя, роль с
 * правами сотрудника не может оказаться ниже порога обязательной 2FA,
 * системные роли из панели не меняются.
 */

const ALL = ['users.read.any', 'users.block', 'orders.read.any', 'licenses.read.own', 'reseller.panel', 'settings.manage'];

const ADMIN: AuthenticatedUser = {
  id: 'admin-id',
  sessionId: 's',
  permissions: new Set(['roles.manage', 'users.read.any', 'users.block', 'orders.read.any', 'licenses.read.own']),
  rolePriority: 80,
  twoFactorEnabled: true,
};

function makeService(existing?: { isSystem: boolean; priority: number }) {
  const prisma = {
    permission: {
      findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] } } }) =>
        where.slug.in.filter((s) => ALL.includes(s)).map((slug) => ({ id: `p-${slug}`, slug })),
      ),
    },
    role: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => (existing ? { id: 'role-1', slug: 'x', name: 'x', permissions: [], ...existing } : null)),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'role-1', permissions: [], _count: { users: 0 } })),
      update: vi.fn(),
    },
    userRole: { findMany: vi.fn(async () => []) },
    rolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async () => []),
  } as unknown as PrismaService;
  const service = new AdminRolesService(
    prisma,
    { invalidate: vi.fn(async () => undefined) } as unknown as PermissionsService,
    { record: vi.fn(async () => undefined) } as unknown as AuditService,
  );
  return { service, prisma };
}

describe('AdminRolesService', () => {
  it('создаёт роль сотрудника из своих прав', async () => {
    const { service, prisma } = makeService();
    await service.create(ADMIN, { slug: 'senior_support', name: 'Старший саппорт', priority: 65, permissions: ['users.read.any', 'users.block'] });
    expect(prisma.role.create).toHaveBeenCalled();
  });

  it('не включает в роль права, которых нет у создателя', async () => {
    const { service } = makeService();
    await expect(
      service.create(ADMIN, { slug: 'sneaky', name: 'x', priority: 65, permissions: ['settings.manage'] }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_NOT_OWNED' } });
  });

  it('уровень роли — ниже своего', async () => {
    const { service } = makeService();
    await expect(
      service.create(ADMIN, { slug: 'equal', name: 'x', priority: 80, permissions: ['users.read.any'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('роль с правами сотрудника не ниже порога 2FA, пользовательская — может быть низкой', async () => {
    const { service } = makeService();
    await expect(
      service.create(ADMIN, { slug: 'low_staff', name: 'x', priority: 40, permissions: ['users.block'] }),
    ).rejects.toMatchObject({ response: { code: 'ROLE_PRIORITY_INVALID' } });
    await expect(
      service.create(ADMIN, { slug: 'partner', name: 'x', priority: 20, permissions: ['licenses.read.own', 'reseller.panel'] }),
    ).resolves.toBeDefined();
  });

  it('системные роли из панели не меняются', async () => {
    const { service } = makeService({ isSystem: true, priority: 60 });
    await expect(service.update(ADMIN, 'role-1', { name: 'y' })).rejects.toMatchObject({ response: { code: 'ROLE_SYSTEM' } });
    await expect(service.remove(ADMIN, 'role-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('код роли проверяется', async () => {
    const { service } = makeService();
    await expect(service.create(ADMIN, { slug: 'Плохой код', name: 'x', permissions: ['users.read.any'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
