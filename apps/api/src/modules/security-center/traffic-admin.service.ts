import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TrafficPriorityKind } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { parseCidr } from '@common/security/ip';
import {
  sanitizeTrafficConfig,
  TRAFFIC_DEFAULTS,
  TRAFFIC_SETTING,
  TrafficPriorityService,
  type TrafficConfig,
} from '@common/security/traffic-priority.service';
import { SettingsService } from '@common/settings/settings.service';

/** Доверять подсети шире этой — значит раздать приоритет пол-интернету. */
const MIN_TRUSTED_PREFIX = { ipv4: 8, ipv6: 32 } as const;

/** Управление приоритетом трафика: доверенные адреса и пользователи, настройки очереди. */
@Injectable()
export class TrafficAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly traffic: TrafficPriorityService,
    private readonly audit: AuditService,
  ) {}

  async config(): Promise<TrafficConfig> {
    return sanitizeTrafficConfig(await this.settings.get<Partial<TrafficConfig>>(TRAFFIC_SETTING, TRAFFIC_DEFAULTS));
  }

  /**
   * Правка настроек. Включить «режим атаки» нельзя, если сам включающий
   * под него попадает: следующим запросом он отрезал бы себе панель.
   */
  async updateConfig(patch: Partial<TrafficConfig>, actor: { id: string; weight: number }) {
    const before = await this.config();
    const next = sanitizeTrafficConfig({ ...before, ...patch, roleWeights: patch.roleWeights ?? before.roleWeights });
    if (next.enabled && next.attackMode && actor.weight < next.attackMinWeight) {
      throw new BadRequestException({
        code: 'TRAFFIC_SELF_LOCKOUT',
        message: `Ваш вес ${actor.weight} ниже порога режима атаки ${next.attackMinWeight} — вы потеряете доступ к панели. Добавьте свой адрес или себя в доверенные.`,
      });
    }
    await this.settings.set(TRAFFIC_SETTING, next, actor.id);
    await this.audit.record({
      action: 'security.traffic_update',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'setting',
      entityId: TRAFFIC_SETTING,
      before,
      after: next,
    });
    await this.traffic.reload();
    return next;
  }

  async list() {
    const rows = await this.prisma.trafficPriority.findMany({ orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }] });
    const userIds = rows.filter((r) => r.kind === TrafficPriorityKind.USER).map((r) => r.value);
    const creatorIds = rows.map((r) => r.createdById).filter((id): id is string => Boolean(id));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set([...userIds, ...creatorIds])] } },
      select: { id: true, username: true },
    });
    const names = new Map(users.map((u) => [u.id, u.username]));
    return rows.map((row) => ({
      ...row,
      username: row.kind === TrafficPriorityKind.USER ? (names.get(row.value) ?? null) : null,
      createdByUsername: row.createdById ? (names.get(row.createdById) ?? null) : null,
    }));
  }

  async add(input: { kind: TrafficPriorityKind; value: string; weight: number; note?: string }, actorId: string) {
    let value: string;
    if (input.kind === TrafficPriorityKind.IP) {
      const parsed = parseCidr(input.value);
      if (!parsed) throw new BadRequestException({ code: 'IP_INVALID', message: 'Это не адрес и не подсеть' });
      if (parsed.prefix < MIN_TRUSTED_PREFIX[parsed.family]) {
        throw new BadRequestException({
          code: 'IP_RANGE_TOO_WIDE',
          message: `Слишком широкая подсеть для доверенных: минимум /${MIN_TRUSTED_PREFIX[parsed.family]}`,
        });
      }
      value = parsed.cidr;
    } else {
      const login = input.value.trim();
      const user = await this.prisma.user.findFirst({
        where: { deletedAt: null, OR: [{ username: login }, ...(/^[0-9a-f-]{36}$/i.test(login) ? [{ id: login }] : [])] },
        select: { id: true },
      });
      if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Пользователь не найден' });
      value = user.id;
    }

    const data = { weight: input.weight, note: input.note?.trim() || null, createdById: actorId };
    const row = await this.prisma.trafficPriority.upsert({
      where: { kind_value: { kind: input.kind, value } },
      update: data,
      create: { id: uuidv7(), kind: input.kind, value, ...data },
    });
    await this.audit.record({
      action: 'security.traffic_priority_add',
      actorId,
      actorType: 'USER',
      entityType: 'traffic_priority',
      entityId: row.id,
      after: { kind: row.kind, value: row.value, weight: row.weight, note: row.note },
    });
    await this.traffic.reload();
    return row;
  }

  async remove(id: string, actorId: string): Promise<void> {
    const row = await this.prisma.trafficPriority.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Запись не найдена' });
    await this.prisma.trafficPriority.delete({ where: { id } });
    await this.audit.record({
      action: 'security.traffic_priority_remove',
      actorId,
      actorType: 'USER',
      entityType: 'traffic_priority',
      entityId: id,
      before: { kind: row.kind, value: row.value, weight: row.weight },
    });
    await this.traffic.reload();
  }
}
