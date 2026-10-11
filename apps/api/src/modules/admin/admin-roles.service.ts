import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { PRIVILEGED_ROLE_PRIORITY } from '@common/rbac/permissions.guard';
import { PermissionsService } from '@common/rbac/permissions.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

/**
 * Свои роли: администратор собирает роль из готовых прав (каждое право
 * закрывает маршруты API, новое право без кода ничего бы не открывало).
 *
 * Системные роли принадлежат сиду — он пересобирает их права при каждом
 * запуске, поэтому из панели они только читаются (их можно взять за основу).
 *
 * Правила против повышения себя:
 *   - приоритет роли ниже своего — как при назначении ролей;
 *   - в роль попадают только права, которые есть у самого создателя;
 *   - роль с любым правом сотрудника получает приоритет не ниже порога
 *     привилегированных ролей, иначе её носитель обходил бы обязательную 2FA.
 */

/** Права обычного пользователя: роль из них не считается привилегированной. */
const USER_LEVEL = new Set(['licenses.read.own', 'hwid.reset.self', 'orders.read.own', 'reseller.panel']);

/**
 * Панель реселлера — признак «у аккаунта есть торговая точка», а не полномочие:
 * без карточки реселлера она пуста. У супер-админа её нет, но включать её
 * в свои роли он может.
 */
const MARKER_PERMISSIONS = new Set(['reseller.panel']);

export interface RoleInput {
  slug?: string;
  name?: string;
  description?: string | null;
  priority?: number;
  permissions?: string[];
}

@Injectable()
export class AdminRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  /** Все права системы по группам — из них собираются роли. */
  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { slug: 'asc' }],
      select: { slug: true, group: true, description: true },
    });
  }

  async create(actor: AuthenticatedUser, input: RoleInput) {
    const slug = (input.slug ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(slug)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Код роли: 3–64 символа, латиница, цифры и _' });
    }
    const name = this.cleanName(input.name);
    const permissions = await this.checkPermissions(actor, input.permissions ?? []);
    const priority = this.checkPriority(actor, input.priority, permissions);

    const id = uuidv7();
    try {
      await this.prisma.role.create({
        data: {
          id,
          slug,
          name,
          description: input.description?.trim() || null,
          priority,
          isSystem: false,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'ALREADY_EXISTS', message: 'Роль с таким кодом уже есть' });
      }
      throw error;
    }

    await this.audit.record({
      action: 'role.create',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'role',
      entityId: id,
      after: { slug, name, priority, permissions: permissions.map((p) => p.slug) },
    });
    return this.get(id);
  }

  async update(actor: AuthenticatedUser, id: string, input: RoleInput) {
    const role = await this.loadEditable(actor, id);
    const permissions = input.permissions
      ? await this.checkPermissions(actor, input.permissions)
      : await this.prisma.permission.findMany({
          where: { roles: { some: { roleId: id } } },
          select: { id: true, slug: true },
        });
    const priority = this.checkPriority(actor, input.priority ?? role.priority, permissions);

    await this.prisma.$transaction([
      this.prisma.role.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: this.cleanName(input.name) } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          priority,
        },
      }),
      ...(input.permissions
        ? [
            this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
            this.prisma.rolePermission.createMany({
              data: permissions.map((p) => ({ roleId: id, permissionId: p.id })),
            }),
          ]
        : []),
    ]);
    // Права носителей роли кэшируются — без сброса изменение дошло бы через пять минут.
    await this.invalidateHolders(id);

    await this.audit.record({
      action: 'role.update',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'role',
      entityId: id,
      before: { name: role.name, priority: role.priority, permissions: role.permissions.map((p) => p.permission.slug) },
      after: { name: input.name, priority, permissions: input.permissions },
    });
    return this.get(id);
  }

  /** Удаление: носители, у которых не останется ни одной роли, получают роль пользователя. */
  async remove(actor: AuthenticatedUser, id: string) {
    const role = await this.loadEditable(actor, id);
    const holders = await this.prisma.userRole.findMany({
      where: { roleId: id },
      select: { userId: true, user: { select: { _count: { select: { roles: true } } } } },
    });
    const orphans = holders.filter((h) => h.user._count.roles <= 1).map((h) => h.userId);
    const fallback = orphans.length ? await this.prisma.role.findUnique({ where: { slug: 'user' } }) : null;

    await this.prisma.$transaction([
      ...(fallback
        ? [
            this.prisma.userRole.createMany({
              data: orphans.map((userId) => ({ userId, roleId: fallback.id, grantedById: actor.id })),
              skipDuplicates: true,
            }),
          ]
        : []),
      this.prisma.role.delete({ where: { id } }),
    ]);
    for (const holder of holders) await this.permissions.invalidate(holder.userId);

    await this.audit.record({
      action: 'role.delete',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'role',
      entityId: id,
      before: { slug: role.slug, name: role.name, users: holders.length },
    });
    return { users: holders.length };
  }

  // ------------------------------------------------------------- внутреннее

  private async get(id: string) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        priority: true,
        isSystem: true,
        permissions: { select: { permission: { select: { slug: true } } } },
        _count: { select: { users: true } },
      },
    });
    const { permissions, _count, ...rest } = role;
    return { ...rest, permissions: permissions.map((p) => p.permission.slug).sort(), users: _count.users };
  }

  /** Своя роль ниже своего уровня — иначе не трогаем. */
  private async loadEditable(actor: AuthenticatedUser, id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { select: { permission: { select: { slug: true } } } } },
    });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Роль не найдена' });
    if (role.isSystem) {
      throw new ForbiddenException({ code: 'ROLE_SYSTEM', message: 'Системные роли меняются только сидом — создайте свою на их основе' });
    }
    if (role.priority >= actor.rolePriority) {
      throw new ForbiddenException({ code: 'ROLE_TOO_HIGH', message: 'Можно менять только роли ниже своей' });
    }
    return role;
  }

  private async checkPermissions(actor: AuthenticatedUser, slugs: string[]) {
    const unique = [...new Set(slugs)];
    if (unique.length === 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Выберите хотя бы одно право' });
    }
    const found = await this.prisma.permission.findMany({ where: { slug: { in: unique } }, select: { id: true, slug: true } });
    if (found.length !== unique.length) {
      throw new BadRequestException({ code: 'PERMISSION_NOT_FOUND', message: 'Неизвестное право' });
    }
    const foreign = unique.filter((slug) => !actor.permissions.has(slug) && !MARKER_PERMISSIONS.has(slug));
    if (foreign.length) {
      throw new ForbiddenException({
        code: 'PERMISSION_NOT_OWNED',
        message: 'В роль можно включать только права, которые есть у вас',
        details: { permissions: foreign },
      });
    }
    return found;
  }

  private checkPriority(actor: AuthenticatedUser, raw: number | undefined, permissions: { slug: string }[]): number {
    const privileged = permissions.some((p) => !USER_LEVEL.has(p.slug));
    const min = privileged ? PRIVILEGED_ROLE_PRIORITY : 11;
    const priority = raw ?? min;
    if (!Number.isInteger(priority) || priority < min || priority > 99) {
      throw new BadRequestException({
        code: 'ROLE_PRIORITY_INVALID',
        message: privileged
          ? `Роль с правами сотрудника — уровень от ${PRIVILEGED_ROLE_PRIORITY} (для неё обязательна 2FA)`
          : 'Уровень роли — от 11 до 99',
        details: { min },
      });
    }
    if (priority >= actor.rolePriority) {
      throw new ForbiddenException({ code: 'ROLE_TOO_HIGH', message: 'Уровень роли должен быть ниже вашего' });
    }
    return priority;
  }

  private async invalidateHolders(roleId: string): Promise<void> {
    const holders = await this.prisma.userRole.findMany({ where: { roleId }, select: { userId: true } });
    for (const holder of holders) await this.permissions.invalidate(holder.userId);
  }

  private cleanName(name: string | undefined): string {
    const value = (name ?? '').trim();
    if (!value) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Укажите название роли' });
    return value.slice(0, 128);
  }
}
