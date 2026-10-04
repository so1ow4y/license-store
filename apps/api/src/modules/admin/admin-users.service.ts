import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

import { AuditService } from '@common/audit/audit.service';
import { errorCode, summarize } from '@common/bulk/bulk';
import { PrismaService } from '@common/prisma/prisma.service';
import { PermissionsService } from '@common/rbac/permissions.service';
import {
  compileQuery,
  enumMatch,
  ipMatch,
  parseQuery,
  textContains,
  textMatch,
  timeRange,
  usesField,
  whereClause,
  yesNo,
  type QueryTerm,
} from '@common/search/query';
import { IpBlockService } from '@common/security/ip-block.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';
import { TokenService } from '@modules/auth/token.service';

export const USER_FIELDS = ['username', 'email', 'role', 'status', 'ip', '2fa', 'id'] as const;
const IPS_IN_LIST = 3;

/**
 * Управление пользователями из панели (ТЗ п.8): поиск, карточка, правка,
 * блокировка, роли.
 *
 * Правило иерархии одно на всё: трогать можно только тех, чья старшая роль
 * НИЖЕ твоей, и назначать только роли ниже твоей. Поэтому администратор не
 * сделает себя или соседа супер-админом и не заблокирует равного.
 */

const USER_LIST_SELECT = {
  id: true,
  username: true,
  email: true,
  status: true,
  emailVerifiedAt: true,
  twoFactorEnabled: true,
  createdAt: true,
  lastLoginAt: true,
  roles: { select: { role: { select: { slug: true, name: true, priority: true } } } },
  _count: { select: { licenses: true, orders: true } },
} satisfies Prisma.UserSelect;

type UserListRow = Prisma.UserGetPayload<{ select: typeof USER_LIST_SELECT }>;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly ipBlocks: IpBlockService,
  ) {}

  /**
   * Поиск строкой «поле:значение» (username, email, role, status, ip, 2fa, id)
   * плюс прежние фильтры. Адреса в строках и поиск по ip — только с правом
   * security.ips.read.
   */
  async list(
    actor: AuthenticatedUser,
    filters: {
      q?: string;
      search?: string;
      status?: UserStatus;
      role?: string;
      from?: Date;
      to?: Date;
      skip?: number;
      take?: number;
    },
  ) {
    const canSeeIps = actor.permissions.has('security.ips.read');
    const tree = parseQuery(filters.q, USER_FIELDS);
    if (usesField(tree, 'ip') && !canSeeIps) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Поиск по адресам недоступен' });
    }
    const conditions: (Prisma.Sql | null)[] = [
      Prisma.sql`u.deleted_at IS NULL`,
      ...timeRange(Prisma.raw('u.created_at'), filters),
      filters.status ? Prisma.sql`u.status::text = ${filters.status}` : null,
      filters.role ? this.userTerm({ field: 'role', value: filters.role }) : null,
      filters.search ? this.userTerm({ field: null, value: filters.search }) : null,
      compileQuery(tree, (term) => this.userTerm(term)),
    ];

    const where = whereClause(conditions);
    const take = Math.min(filters.take ?? 25, 200);
    const skip = filters.skip ?? 0;
    const [ids, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT u.id FROM users u ${where} ORDER BY u.created_at DESC LIMIT ${take} OFFSET ${skip}`),
      this.prisma.$queryRaw<[{ total: number }]>(Prisma.sql`SELECT count(*)::int AS total FROM users u ${where}`),
    ]);

    const order = ids.map((r) => r.id);
    const rows = await this.prisma.user.findMany({ where: { id: { in: order } }, select: USER_LIST_SELECT });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ips = canSeeIps ? await this.recentIps(order) : null;

    const items = order
      .map((id) => byId.get(id))
      .filter((row): row is UserListRow => Boolean(row))
      .map((row) => ({ ...this.toView(row), ...(ips ? { ips: ips.get(row.id) ?? { recent: [], count: 0, lastSeenAt: null } } : {}) }));

    return { items, total, skip, take };
  }

  /** Все адреса пользователя: когда, сколько раз, кто ещё с них заходил. */
  async listIps(userId: string) {
    const rows = await this.prisma.$queryRaw<
      { ip: string; firstSeenAt: Date; lastSeenAt: Date; hits: number; lastUserAgent: string | null; sharedWith: number }[]
    >(Prisma.sql`
      SELECT host(ui.ip) AS ip, ui.first_seen_at AS "firstSeenAt", ui.last_seen_at AS "lastSeenAt", ui.hits,
             ui.last_user_agent AS "lastUserAgent",
             (SELECT count(DISTINCT x.user_id)::int - 1 FROM user_ips x WHERE x.ip = ui.ip) AS "sharedWith"
      FROM user_ips ui WHERE ui.user_id = ${userId}::uuid
      ORDER BY ui.last_seen_at DESC LIMIT 500`);
    return Promise.all(rows.map(async (row) => ({ ...row, blocked: await this.ipBlocks.isBlocked(row.ip) })));
  }

  // ------------------------------------------------------ массовые операции

  /**
   * Массовая блокировка или разблокировка. Каждый пользователь проверяется
   * отдельно (иерархия ролей, сам себя): отказ по одному не отменяет остальных.
   */
  async bulk(actor: AuthenticatedUser, ids: string[], action: 'block' | 'unblock', reason?: string) {
    if (action === 'block' && !reason?.trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Укажите причину блокировки' });
    }
    const results: { id: string; ok: boolean; code?: string }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (action === 'block') await this.block(actor, id, reason!.trim(), { skipView: true });
        else await this.unblock(actor, id, { skipView: true });
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, code: errorCode(error) });
      }
    }
    return summarize(results);
  }

  /**
   * Заблокировать все адреса выбранных пользователей. Те же правила, что у
   * блокировки аккаунта: только пользователи ниже вас по роли; свой текущий
   * адрес и адреса пользователей не ниже вас пропускаются.
   */
  async blockIpsOf(
    actor: AuthenticatedUser,
    ids: string[],
    params: { reason?: string; expiresInHours?: number; actorIp?: string },
  ) {
    const results: { id: string; ok: boolean; code?: string }[] = [];
    const manageable: string[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        await this.loadManageable(actor, id);
        manageable.push(id);
      } catch (error) {
        results.push({ id, ok: false, code: errorCode(error) });
      }
    }
    const rows = manageable.length
      ? await this.prisma.$queryRaw<{ ip: string }[]>(Prisma.sql`
          SELECT DISTINCT host(ip) AS ip FROM user_ips WHERE user_id = ANY(${manageable}::uuid[])`)
      : [];
    for (const { ip } of rows) {
      try {
        await this.ipBlocks.create(
          { value: ip, reason: params.reason, expiresInHours: params.expiresInHours },
          { id: actor.id, ip: params.actorIp, rolePriority: actor.rolePriority },
        );
        results.push({ id: ip, ok: true });
      } catch (error) {
        results.push({ id: ip, ok: false, code: errorCode(error) });
      }
    }
    return summarize(results);
  }

  /** Блокировка по логину — для формы в разделе безопасности. */
  async blockByUsername(actor: AuthenticatedUser, username: string, reason: string) {
    const user = await this.prisma.user.findFirst({ where: { username: username.trim(), deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Пользователь с таким логином не найден' });
    return this.block(actor, user.id, reason);
  }

  private userTerm({ field, value }: QueryTerm): Prisma.Sql {
    const sql = Prisma.sql;
    const raw = Prisma.raw;
    switch (field) {
      case 'username':
        return textMatch(raw('u.username::text'), value);
      case 'email':
        return textMatch(raw('u.email::text'), value);
      case 'role':
        return sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                           WHERE ur.user_id = u.id AND ${textMatch(raw('r.slug'), value)})`;
      case 'status':
        return enumMatch(raw('u.status'), value);
      case 'ip':
        return sql`EXISTS (SELECT 1 FROM user_ips ui WHERE ui.user_id = u.id AND ${ipMatch(raw('ui.ip'), value)})`;
      case '2fa': {
        const enabled = yesNo(value);
        if (enabled === null) throw new BadRequestException({ code: 'SEARCH_VALUE_INVALID', message: '2fa: yes или no' });
        return sql`u.two_factor_enabled = ${enabled}`;
      }
      case 'id':
        return sql`u.id::text = ${value}`;
      default:
        return sql`(${textContains(raw('u.username::text'), value)} OR ${textContains(raw('u.email::text'), value)})`;
    }
  }

  private async recentIps(userIds: string[]) {
    const result = new Map<string, { recent: string[]; count: number; lastSeenAt: Date | null }>();
    if (userIds.length === 0) return result;
    const rows = await this.prisma.$queryRaw<{ userId: string; ip: string; lastSeenAt: Date }[]>(Prisma.sql`
      SELECT ui.user_id AS "userId", host(ui.ip) AS ip, ui.last_seen_at AS "lastSeenAt"
      FROM user_ips ui WHERE ui.user_id = ANY(${userIds}::uuid[])
      ORDER BY ui.last_seen_at DESC`);
    for (const row of rows) {
      const entry = result.get(row.userId) ?? { recent: [], count: 0, lastSeenAt: row.lastSeenAt };
      entry.count++;
      if (entry.recent.length < IPS_IN_LIST) entry.recent.push(row.ip);
      result.set(row.userId, entry);
    }
    return result;
  }

  async get(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...USER_LIST_SELECT,
        locale: true,
        blockedAt: true,
        blockedReason: true,
        lastLoginIp: true,
        passwordHash: true,
        oauthAccounts: { select: { provider: true, providerUsername: true, createdAt: true } },
      },
    });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Пользователь не найден' });

    const { passwordHash, oauthAccounts, locale, blockedAt, blockedReason, lastLoginIp, ...rest } = user;
    return {
      ...this.toView(rest),
      locale,
      blockedAt,
      blockedReason,
      lastLoginIp,
      hasPassword: Boolean(passwordHash),
      oauth: oauthAccounts,
    };
  }

  async update(actor: AuthenticatedUser, userId: string, input: { username?: string; email?: string | null; emailVerified?: boolean }) {
    const target = await this.loadManageable(actor, userId);

    const data: Prisma.UserUpdateInput = {
      ...(input.username !== undefined ? { username: input.username.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email ? input.email.trim().toLowerCase() : null } : {}),
      ...(input.emailVerified !== undefined ? { emailVerifiedAt: input.emailVerified ? new Date() : null } : {}),
    };

    // Подтверждение почты администратором выводит аккаунт из ожидания.
    if (input.emailVerified && target.status === UserStatus.PENDING_VERIFICATION) {
      data.status = UserStatus.ACTIVE;
    }

    try {
      await this.prisma.user.update({ where: { id: userId }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'ALREADY_EXISTS', message: 'Такой логин или почта уже заняты' });
      }
      throw error;
    }

    await this.audit.record({
      action: 'user.update',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'user',
      entityId: userId,
      before: { username: target.username, email: target.email },
      after: input,
    });
    return this.get(userId);
  }

  async block(actor: AuthenticatedUser, userId: string, reason: string, opts: { skipView?: boolean } = {}) {
    await this.loadManageable(actor, userId);

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.BLOCKED, blockedAt: new Date(), blockedReason: reason, blockedById: actor.id },
    });
    // Без отзыва сессий заблокированный работал бы до истечения токена.
    const revoked = await this.tokens.revokeAllUserSessions(userId, 'blocked');
    await this.permissions.invalidate(userId);

    await this.audit.record({
      action: 'user.block',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'user',
      entityId: userId,
      after: { reason, revokedSessions: revoked },
    });
    return opts.skipView ? null : this.get(userId);
  }

  async unblock(actor: AuthenticatedUser, userId: string, opts: { skipView?: boolean } = {}) {
    const target = await this.loadManageable(actor, userId);
    if (target.status !== UserStatus.BLOCKED) {
      throw new ConflictException({ code: 'NOT_BLOCKED', message: 'Пользователь не заблокирован' });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        // Неподтверждённая почта возвращает в ожидание, а не в ACTIVE.
        status: target.email && !target.emailVerifiedAt ? UserStatus.PENDING_VERIFICATION : UserStatus.ACTIVE,
        blockedAt: null,
        blockedReason: null,
        blockedById: null,
      },
    });
    await this.permissions.invalidate(userId);

    await this.audit.record({
      action: 'user.unblock',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'user',
      entityId: userId,
    });
    return opts.skipView ? null : this.get(userId);
  }

  async setRoles(actor: AuthenticatedUser, userId: string, slugs: string[]) {
    const target = await this.loadManageable(actor, userId);
    const unique = [...new Set(slugs)];
    if (unique.length === 0) {
      throw new BadRequestException({ code: 'ROLE_REQUIRED', message: 'Нужна хотя бы одна роль' });
    }

    const roles = await this.prisma.role.findMany({ where: { slug: { in: unique } } });
    if (roles.length !== unique.length) {
      throw new BadRequestException({ code: 'ROLE_NOT_FOUND', message: 'Неизвестная роль' });
    }

    // Нельзя ни выдать, ни снять роль не ниже своей.
    const current = target.roles.map((r) => r.role);
    const touched = [
      ...roles.filter((r) => !current.some((c) => c.slug === r.slug)),
      ...current.filter((c) => !unique.includes(c.slug)),
    ];
    if (touched.some((r) => r.priority >= actor.rolePriority)) {
      throw new ForbiddenException({ code: 'ROLE_TOO_HIGH', message: 'Можно назначать только роли ниже своей' });
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({ userId, roleId: role.id, grantedById: actor.id })),
      }),
    ]);
    await this.permissions.invalidate(userId);

    await this.audit.record({
      action: 'user.roles',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'user',
      entityId: userId,
      before: { roles: current.map((r) => r.slug) },
      after: { roles: unique },
    });
    return this.get(userId);
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { priority: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        priority: true,
        permissions: { select: { permission: { select: { slug: true } } } },
        _count: { select: { users: true } },
      },
    });
    return roles.map(({ permissions, _count, ...role }) => ({
      ...role,
      permissions: permissions.map((p) => p.permission.slug).sort(),
      users: _count.users,
    }));
  }

  // ------------------------------------------------------------- внутреннее

  /** Цель существует, это не ты сам, и её старшая роль ниже твоей. */
  private async loadManageable(actor: AuthenticatedUser, userId: string) {
    if (actor.id === userId) {
      throw new ForbiddenException({ code: 'CANNOT_MANAGE_SELF', message: 'Свой аккаунт меняйте в настройках профиля' });
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        emailVerifiedAt: true,
        roles: { select: { role: { select: { slug: true, priority: true } } } },
      },
    });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Пользователь не найден' });

    const targetPriority = Math.max(0, ...target.roles.map((r) => r.role.priority));
    if (targetPriority >= actor.rolePriority) {
      throw new ForbiddenException({ code: 'USER_TOO_PRIVILEGED', message: 'Нельзя менять пользователя с ролью не ниже вашей' });
    }
    return target;
  }

  private toView(row: UserListRow) {
    const { roles, _count, ...user } = row;
    return {
      ...user,
      roles: roles.map((r) => r.role).sort((a, b) => b.priority - a.priority),
      licenses: _count.licenses,
      orders: _count.orders,
    };
  }
}
