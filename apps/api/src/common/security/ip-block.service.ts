import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '../audit/audit.service';
import { errorCode, summarize, type BulkItemResult, type BulkResult } from '../bulk/bulk';
import { PrismaService } from '../prisma/prisma.service';
import { cidrContains, normalizeIp, parseCidr, type ParsedCidr } from './ip';

/** Как долго держится загруженный список блокировок в памяти процесса. */
const CACHE_TTL_MS = 15_000;
/** Узкие префиксы — защита от опечатки, которая отрежет пол-интернета. */
const MIN_PREFIX = { ipv4: 16, ipv6: 32 } as const;

/**
 * Кто блокирует: его текущий адрес (свой заблокировать нельзя) и уровень
 * роли (адреса тех, кто не ниже, заблокировать нельзя).
 */
export interface IpBlockActor {
  id: string;
  ip?: string;
  rolePriority?: number;
}

/**
 * Блокировка адресов и подсетей. Проверка идёт на каждом запросе
 * (IpBlockGuard), поэтому список держится в памяти и перечитывается раз в
 * 15 секунд — на другой реплике блок вступает в силу с этой задержкой.
 */
@Injectable()
export class IpBlockService {
  private readonly logger = new Logger(IpBlockService.name);
  private blocks: ParsedCidr[] = [];
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async isBlocked(ip: string | null | undefined): Promise<boolean> {
    const address = normalizeIp(ip);
    if (!address) return false;
    await this.ensureFresh();
    return this.blocks.some((block) => cidrContains(block, address));
  }

  async list() {
    const rows = await this.prisma.ipBlock.findMany({ orderBy: { createdAt: 'desc' } });
    const creatorIds = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => Boolean(id)))];
    const creators = await this.prisma.user.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, username: true },
    });
    const names = new Map(creators.map((c) => [c.id, c.username]));
    const now = Date.now();
    return rows.map((row) => ({
      ...row,
      createdByUsername: row.createdById ? (names.get(row.createdById) ?? null) : null,
      active: !row.expiresAt || row.expiresAt.getTime() > now,
    }));
  }

  /**
   * Заблокировать адрес или подсеть. Повторная блокировка той же сети
   * обновляет причину и срок.
   */
  async create(
    input: { value: string; reason?: string; expiresInHours?: number },
    actor: IpBlockActor,
  ) {
    const parsed = parseCidr(input.value);
    if (!parsed) {
      throw new BadRequestException({ code: 'IP_INVALID', message: 'Это не адрес и не подсеть (пример: 203.0.113.7 или 203.0.113.0/24)' });
    }
    if (parsed.prefix < MIN_PREFIX[parsed.family]) {
      throw new BadRequestException({
        code: 'IP_RANGE_TOO_WIDE',
        message: `Слишком широкая подсеть: минимум /${MIN_PREFIX[parsed.family]}`,
      });
    }
    if (actor.ip && cidrContains(parsed, actor.ip)) {
      throw new BadRequestException({ code: 'IP_BLOCK_SELF', message: 'В эту подсеть входит ваш текущий адрес' });
    }
    // Как и блокировка аккаунта: нельзя отрезать по адресу того, кто не ниже
    // тебя по роли. Иначе админ безопасности выкинул бы супер-админа, а один
    // супер-админ — другого, заблокировав их адреса вместо аккаунтов.
    if (actor.rolePriority !== undefined) {
      const [privileged] = await this.prisma.$queryRaw<{ username: string }[]>(Prisma.sql`
        SELECT u.username::text AS username
        FROM user_ips ui
        JOIN users u ON u.id = ui.user_id
        JOIN user_roles ur ON ur.user_id = ui.user_id
        JOIN roles r ON r.id = ur.role_id
        WHERE ui.ip <<= ${parsed.cidr}::inet AND r.priority >= ${actor.rolePriority} AND ui.user_id <> ${actor.id}::uuid
        LIMIT 1`);
      if (privileged) {
        throw new ForbiddenException({
          code: 'IP_OF_PRIVILEGED_USER',
          message: `С этого адреса входит пользователь с ролью не ниже вашей (${privileged.username})`,
        });
      }
    }

    const expiresAt = input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3_600_000) : null;
    const data = { reason: input.reason?.trim() || null, expiresAt, createdById: actor.id };
    const row = await this.prisma.ipBlock.upsert({
      where: { cidr: parsed.cidr },
      update: data,
      create: { id: uuidv7(), cidr: parsed.cidr, ...data },
    });

    await this.audit.record({
      action: 'security.ip_block',
      actorId: actor.id,
      actorType: 'USER',
      entityType: 'ip_block',
      entityId: row.id,
      after: { cidr: parsed.cidr, reason: data.reason, expiresAt },
    });
    await this.reload();
    return row;
  }

  /** Массовая блокировка: каждый адрес отдельно, свой и слишком широкие отклоняются поштучно. */
  async createMany(
    values: string[],
    params: { reason?: string; expiresInHours?: number },
    actor: IpBlockActor,
  ): Promise<BulkResult> {
    const results: BulkItemResult[] = [];
    for (const value of [...new Set(values.map((v) => v.trim()).filter(Boolean))]) {
      try {
        await this.create({ value, ...params }, actor);
        results.push({ id: value, ok: true });
      } catch (error) {
        results.push({ id: value, ok: false, code: errorCode(error) });
      }
    }
    return summarize(results);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const row = await this.prisma.ipBlock.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Блокировка не найдена' });

    await this.prisma.ipBlock.delete({ where: { id } });
    await this.audit.record({
      action: 'security.ip_unblock',
      actorId,
      actorType: 'USER',
      entityType: 'ip_block',
      entityId: id,
      before: { cidr: row.cidr, reason: row.reason },
    });
    await this.reload();
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.loadedAt < CACHE_TTL_MS) return;
    this.loading ??= this.reload().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  private async reload(): Promise<void> {
    try {
      const rows = await this.prisma.ipBlock.findMany({
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { cidr: true },
      });
      this.blocks = rows.map((r) => parseCidr(r.cidr)).filter((p): p is ParsedCidr => p !== null);
    } catch (error) {
      // База недоступна — оставляем прежний список, а не пускаем или режем всех.
      this.logger.warn(`список блокировок не обновлён: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.loadedAt = Date.now();
  }
}
