import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  CorrelationAction,
  CorrelationSource,
  HitStatus,
  IpBlockLevel,
  Prisma,
  UserStatus,
  type CorrelationRule,
  type HitSeverity,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { errorCode } from '@common/bulk/bulk';
import { PrismaService } from '@common/prisma/prisma.service';
import { PermissionsService } from '@common/rbac/permissions.service';
import { PRIVILEGED_ROLE_PRIORITY } from '@common/rbac/permissions.guard';
import { RedisService } from '@common/redis/redis.service';
import { IpBlockService, normalizePorts } from '@common/security/ip-block.service';
import { parseCidr } from '@common/security/ip';
import { TrafficPriorityService } from '@common/security/traffic-priority.service';
import { AdminAuditService, CORRELATION_FIELDS, type CorrelationGroup } from '@modules/admin/admin-audit.service';
import { TokenService } from '@modules/auth/token.service';

/**
 * Правила корреляции в духе WAF/SIEM: раз в 30 секунд каждое включённое
 * правило считает события в своём окне, группирует их по полю и смотрит,
 * какие группы перешли порог. На каждую новую группу — сработка и действие:
 * только сработка, блок адреса на выбранном уровне (приложение, nginx,
 * фаервол с портами) или блок пользователя.
 *
 * Защита от самострела:
 *   - адреса из списка доверенных (приоритет трафика) не блокируются;
 *   - адрес, с которого входит сотрудник (роль от PRIVILEGED_ROLE_PRIORITY),
 *     не блокируется — это проверяет сам IpBlockService;
 *   - сотрудники не блокируются по правилу никогда — только руками;
 *   - уже действующий блок того же или более строгого уровня не трогается.
 *
 * На нескольких репликах правила считает одна: замок в Redis на время тика.
 */

const TICK_MS = 30_000;
const LOCK_KEY = 'correlation:lock';
const MAX_GROUPS_PER_RUN = 100;

const LEVEL_RANK: Record<IpBlockLevel, number> = { APP: 0, EDGE: 1, FIREWALL: 2 };

/** Поле, по которому правило может блокировать пользователя. */
const USER_FIELD: Record<CorrelationSource, string> = { LOGINS: 'user', AUDIT: 'actor' };

export interface RuleInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  source: CorrelationSource;
  query?: string;
  groupBy: string;
  distinctField?: string | null;
  threshold: number;
  windowMinutes: number;
  severity?: HitSeverity;
  action?: CorrelationAction;
  blockLevel?: IpBlockLevel;
  blockPorts?: number[];
  blockHours?: number | null;
  cooldownMinutes?: number;
}

type Outcome = { outcome: string; blockId?: string };

@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logs: AdminAuditService,
    private readonly blocks: IpBlockService,
    private readonly traffic: TrafficPriorityService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------- движок

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    const token = randomUUID();
    const locked = await this.redis.client.set(LOCK_KEY, token, 'PX', TICK_MS - 2_000, 'NX').catch(() => null);
    if (!locked) return;
    const rules = await this.prisma.correlationRule.findMany({ where: { enabled: true } });
    for (const rule of rules) {
      try {
        await this.run(rule);
      } catch (error) {
        this.logger.warn(`правило «${rule.name}» не отработало: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Прогнать правило сейчас: сработки и действия по всем группам за порогом. */
  async run(rule: CorrelationRule): Promise<{ hits: number; groups: number }> {
    const to = new Date();
    const from = new Date(to.getTime() - rule.windowMinutes * 60_000);
    const groups = await this.logs.correlate({
      source: rule.source,
      q: rule.query,
      groupBy: rule.groupBy,
      distinctField: rule.distinctField,
      threshold: rule.threshold,
      from,
      to,
      limit: MAX_GROUPS_PER_RUN,
    });

    let hits = 0;
    const cooldownFrom = new Date(to.getTime() - rule.cooldownMinutes * 60_000);
    for (const group of groups) {
      const recent = await this.prisma.correlationHit.findFirst({
        where: { ruleId: rule.id, groupKey: group.key, createdAt: { gt: cooldownFrom } },
        select: { id: true },
      });
      if (recent) continue;

      const sample = await this.logs
        .correlationSample({ source: rule.source, q: rule.query, groupBy: rule.groupBy, from, to, key: group.key })
        .catch(() => null);
      const result = await this.act(rule, group.key);
      await this.prisma.correlationHit.create({
        data: {
          id: uuidv7(),
          ruleId: rule.id,
          groupKey: group.key.slice(0, 255),
          count: group.count,
          distinctCount: group.distinctCount,
          severity: rule.severity,
          action: rule.action,
          outcome: result.outcome.slice(0, 64),
          blockId: result.blockId ?? null,
          windowFrom: from,
          windowTo: to,
          firstEventAt: group.firstEventAt,
          lastEventAt: group.lastEventAt,
          sample: (sample ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await this.audit.record({
        action: 'security.correlation_hit',
        actorType: 'SYSTEM',
        actorLabel: `rule:${rule.name}`,
        entityType: 'correlation_rule',
        entityId: rule.id,
        after: { key: group.key, count: group.count, distinct: group.distinctCount, outcome: result.outcome },
      });
      hits++;
    }

    await this.prisma.correlationRule.update({
      where: { id: rule.id },
      data: { lastRunAt: to, ...(hits > 0 ? { lastHitAt: to } : {}) },
    });
    return { hits, groups: groups.length };
  }

  private async act(rule: CorrelationRule, key: string): Promise<Outcome> {
    switch (rule.action) {
      case CorrelationAction.ALERT:
        return { outcome: 'alerted' };
      case CorrelationAction.BLOCK_IP:
        return this.blockIp(rule, key);
      case CorrelationAction.BLOCK_USER:
        return this.blockUser(rule, key);
    }
  }

  private async blockIp(rule: CorrelationRule, ip: string): Promise<Outcome> {
    const parsed = parseCidr(ip);
    if (!parsed) return { outcome: 'failed:IP_INVALID' };
    if (this.traffic.isTrustedIp(ip)) return { outcome: 'skipped_protected' };

    const existing = await this.prisma.ipBlock.findUnique({ where: { cidr: parsed.cidr } });
    const active = existing && (!existing.expiresAt || existing.expiresAt > new Date());
    if (active && LEVEL_RANK[existing.level] >= LEVEL_RANK[rule.blockLevel]) return { outcome: 'skipped_existing', blockId: existing.id };

    try {
      const block = await this.blocks.create(
        {
          value: parsed.cidr,
          reason: `Правило «${rule.name}»`,
          expiresInHours: rule.blockHours ?? undefined,
          level: rule.blockLevel,
          ports: rule.blockPorts,
          source: 'rule',
          ruleId: rule.id,
        },
        // Уровень сотрудника: адреса, с которых входят сотрудники, правило не тронет.
        { id: null, label: `rule:${rule.name}`, rolePriority: PRIVILEGED_ROLE_PRIORITY },
      );
      return { outcome: 'blocked', blockId: block.id };
    } catch (error) {
      const code = errorCode(error);
      return { outcome: code === 'IP_OF_PRIVILEGED_USER' ? 'skipped_protected' : `failed:${code}` };
    }
  }

  private async blockUser(rule: CorrelationRule, login: string): Promise<Outcome> {
    const user = await this.prisma.user.findFirst({
      where: { username: login, deletedAt: null },
      select: { id: true, status: true, roles: { select: { role: { select: { priority: true } } } } },
    });
    if (!user) return { outcome: 'failed:USER_NOT_FOUND' };
    const priority = Math.max(0, ...user.roles.map((r) => r.role.priority));
    if (priority >= PRIVILEGED_ROLE_PRIORITY) return { outcome: 'skipped_protected' };
    if (user.status === UserStatus.BLOCKED) return { outcome: 'skipped_existing' };

    const reason = `Правило «${rule.name}»`;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.BLOCKED, blockedAt: new Date(), blockedReason: reason, blockedById: null },
    });
    const revoked = await this.tokens.revokeAllUserSessions(user.id, 'blocked');
    await this.permissions.invalidate(user.id);
    await this.audit.record({
      action: 'user.block',
      actorType: 'SYSTEM',
      actorLabel: `rule:${rule.name}`,
      entityType: 'user',
      entityId: user.id,
      after: { reason, revokedSessions: revoked, ruleId: rule.id },
    });
    return { outcome: 'blocked' };
  }

  // ------------------------------------------------------------- правила

  async listRules() {
    const rules = await this.prisma.correlationRule.findMany({ orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }] });
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [day, open] = await Promise.all([
      this.prisma.correlationHit.groupBy({ by: ['ruleId'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.correlationHit.groupBy({ by: ['ruleId'], where: { status: HitStatus.NEW }, _count: { _all: true } }),
    ]);
    const dayBy = new Map(day.map((r) => [r.ruleId, r._count._all]));
    const openBy = new Map(open.map((r) => [r.ruleId, r._count._all]));
    return rules.map((rule) => ({ ...rule, hits24h: dayBy.get(rule.id) ?? 0, hitsOpen: openBy.get(rule.id) ?? 0 }));
  }

  async getRule(id: string) {
    const rule = await this.prisma.correlationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Правило не найдено' });
    return rule;
  }

  async createRule(input: RuleInput, actorId: string) {
    const data = await this.validate(input);
    const rule = await this.prisma.correlationRule.create({ data: { id: uuidv7(), ...data, createdById: actorId } });
    await this.audit.record({
      action: 'security.rule_create',
      actorId,
      actorType: 'USER',
      entityType: 'correlation_rule',
      entityId: rule.id,
      after: data,
    });
    return rule;
  }

  async updateRule(id: string, input: Partial<RuleInput>, actorId: string) {
    const before = await this.getRule(id);
    const data = await this.validate({ ...before, ...input } as RuleInput);
    const rule = await this.prisma.correlationRule.update({ where: { id }, data });
    await this.audit.record({
      action: 'security.rule_update',
      actorId,
      actorType: 'USER',
      entityType: 'correlation_rule',
      entityId: id,
      before: { enabled: before.enabled, threshold: before.threshold, action: before.action, query: before.query },
      after: { enabled: rule.enabled, threshold: rule.threshold, action: rule.action, query: rule.query },
    });
    return rule;
  }

  async removeRule(id: string, actorId: string): Promise<void> {
    const rule = await this.getRule(id);
    await this.prisma.correlationRule.delete({ where: { id } });
    await this.audit.record({
      action: 'security.rule_delete',
      actorId,
      actorType: 'USER',
      entityType: 'correlation_rule',
      entityId: id,
      before: { name: rule.name, source: rule.source, query: rule.query },
    });
  }

  /**
   * Что правило нашло бы прямо сейчас — без сработок и действий. По каждой
   * группе — что бы с ней сделали: так видно, не заденет ли правило своих.
   */
  async preview(input: RuleInput) {
    const data = await this.validate(input);
    const to = new Date();
    const from = new Date(to.getTime() - data.windowMinutes * 60_000);
    const groups: CorrelationGroup[] = await this.logs.correlate({ ...data, q: data.query, from, to, limit: 50 });
    return {
      from,
      to,
      groups: groups.map((g) => ({
        ...g,
        protected: data.action === CorrelationAction.BLOCK_IP && this.traffic.isTrustedIp(g.key),
      })),
    };
  }

  /** Проверка и нормализация правила; заодно проверяет строку поиска пробным запросом. */
  private async validate(input: RuleInput) {
    const fields: Record<string, string> = CORRELATION_FIELDS[input.source];
    if (!fields[input.groupBy]) {
      throw new BadRequestException({ code: 'CORRELATION_FIELD_INVALID', message: 'Группировка по этому полю для журнала недоступна' });
    }
    const distinctField = input.distinctField || null;
    if (distinctField && (!fields[distinctField] || distinctField === input.groupBy)) {
      throw new BadRequestException({ code: 'CORRELATION_FIELD_INVALID', message: 'Поле «разных значений» должно отличаться от группировки' });
    }
    const action = input.action ?? CorrelationAction.ALERT;
    if (action === CorrelationAction.BLOCK_IP && input.groupBy !== 'ip') {
      throw new BadRequestException({ code: 'CORRELATION_ACTION_INVALID', message: 'Блокировать адрес можно, только когда группировка — по ip' });
    }
    if (action === CorrelationAction.BLOCK_USER && input.groupBy !== USER_FIELD[input.source]) {
      throw new BadRequestException({
        code: 'CORRELATION_ACTION_INVALID',
        message: `Блокировать пользователя можно, только когда группировка — по ${USER_FIELD[input.source]}`,
      });
    }
    const blockLevel = input.blockLevel ?? IpBlockLevel.EDGE;
    const data = {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      enabled: input.enabled ?? false,
      source: input.source,
      query: (input.query ?? '').trim(),
      groupBy: input.groupBy,
      distinctField,
      threshold: input.threshold,
      windowMinutes: input.windowMinutes,
      severity: input.severity ?? 'MEDIUM',
      action,
      blockLevel,
      blockPorts: blockLevel === IpBlockLevel.FIREWALL ? normalizePorts(input.blockPorts) : [],
      blockHours: input.blockHours ?? null,
      cooldownMinutes: input.cooldownMinutes ?? 60,
    };
    // Ошибка синтаксиса или неизвестное поле в строке поиска всплывёт здесь,
    // а не молча в фоновом тике.
    const now = new Date();
    await this.logs.correlate({ ...data, q: data.query, from: new Date(now.getTime() - 60_000), to: now, limit: 1 });
    return data;
  }

  // ------------------------------------------------------------- сработки

  async listHits(filters: { status?: HitStatus; ruleId?: string; severity?: HitSeverity; q?: string; skip?: number; take?: number }) {
    const where: Prisma.CorrelationHitWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.ruleId ? { ruleId: filters.ruleId } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.q?.trim() ? { groupKey: { contains: filters.q.trim(), mode: 'insensitive' } } : {}),
    };
    const take = Math.min(filters.take ?? 50, 200);
    const skip = filters.skip ?? 0;
    const [items, total, open] = await this.prisma.$transaction([
      this.prisma.correlationHit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { rule: { select: { id: true, name: true, source: true, query: true, groupBy: true, distinctField: true, blockLevel: true } } },
      }),
      this.prisma.correlationHit.count({ where }),
      this.prisma.correlationHit.count({ where: { status: HitStatus.NEW } }),
    ]);
    const handlerIds = [...new Set(items.map((i) => i.handledById).filter((id): id is string => Boolean(id)))];
    const handlers = await this.prisma.user.findMany({ where: { id: { in: handlerIds } }, select: { id: true, username: true } });
    const names = new Map(handlers.map((h) => [h.id, h.username]));
    return {
      items: items.map((item) => ({ ...item, handledByUsername: item.handledById ? (names.get(item.handledById) ?? null) : null })),
      total,
      open,
      skip,
      take,
    };
  }

  async summary() {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [open, day, critical] = await Promise.all([
      this.prisma.correlationHit.count({ where: { status: HitStatus.NEW } }),
      this.prisma.correlationHit.count({ where: { createdAt: { gte: since } } }),
      this.prisma.correlationHit.count({ where: { status: HitStatus.NEW, severity: 'CRITICAL' } }),
    ]);
    return { open, day, critical };
  }

  async updateHits(ids: string[], input: { status: HitStatus; note?: string }, actorId: string) {
    const result = await this.prisma.correlationHit.updateMany({
      where: { id: { in: ids } },
      data: {
        status: input.status,
        ...(input.note !== undefined ? { note: input.note.trim() || null } : {}),
        handledById: actorId,
        handledAt: new Date(),
      },
    });
    await this.audit.record({
      action: 'security.hits_update',
      actorId,
      actorType: 'USER',
      entityType: 'correlation_hit',
      entityId: ids.length === 1 ? ids[0] : null,
      after: { ids, status: input.status, note: input.note ?? null },
    });
    return { updated: result.count };
  }
}
