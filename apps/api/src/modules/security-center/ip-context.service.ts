import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as dns } from 'node:dns';

import { PrismaService } from '@common/prisma/prisma.service';
import { cidrContains, ipFamily, normalizeIp, parseCidr } from '@common/security/ip';
import { TrafficPriorityService } from '@common/security/traffic-priority.service';

/**
 * Контекст адреса для карточки события: что это за сеть, кто с неё ходит,
 * сколько было неудачных входов, под какими блоками и правилами она уже
 * была. То, что аналитик иначе собирал бы пятью запросами в журнал.
 */

/** Особые диапазоны: по ним сразу видно, что адрес не «из интернета». */
const SCOPES: [scope: string, cidr: string][] = [
  ['loopback', '127.0.0.0/8'],
  ['loopback', '::1/128'],
  ['private', '10.0.0.0/8'],
  ['private', '172.16.0.0/12'],
  ['private', '192.168.0.0/16'],
  ['private', 'fc00::/7'],
  ['cgnat', '100.64.0.0/10'],
  ['link-local', '169.254.0.0/16'],
  ['link-local', 'fe80::/10'],
  ['documentation', '192.0.2.0/24'],
  ['documentation', '198.51.100.0/24'],
  ['documentation', '203.0.113.0/24'],
  ['documentation', '2001:db8::/32'],
  ['multicast', '224.0.0.0/4'],
  ['multicast', 'ff00::/8'],
];

const PARSED_SCOPES = SCOPES.map(([scope, cidr]) => ({ scope, cidr: parseCidr(cidr)! }));

const DNS_TIMEOUT_MS = 1_500;

@Injectable()
export class IpContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly traffic: TrafficPriorityService,
  ) {}

  async describe(raw: string) {
    const ip = normalizeIp(raw);
    if (!ip) throw new BadRequestException({ code: 'IP_INVALID', message: 'Это не IP-адрес' });
    const sql = Prisma.sql;

    const [reverse, logins, audit, users, blocks, trusted, hits] = await Promise.all([
      this.reverse(ip),
      this.prisma.$queryRaw<
        {
          total: number;
          failed: number;
          failed24h: number;
          success24h: number;
          users: number;
          countries: string[] | null;
          firstSeen: Date | null;
          lastSeen: Date | null;
        }[]
      >(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE NOT l.success)::int AS failed,
               count(*) FILTER (WHERE NOT l.success AND l.created_at > now() - interval '24 hours')::int AS "failed24h",
               count(*) FILTER (WHERE l.success AND l.created_at > now() - interval '24 hours')::int AS "success24h",
               count(DISTINCT COALESCE(l.user_id::text, l.identifier_used))::int AS users,
               array_remove(array_agg(DISTINCT l.country), NULL) AS countries,
               min(l.created_at) AS "firstSeen", max(l.created_at) AS "lastSeen"
        FROM login_history l
        WHERE l.ip = ${ip}::inet AND l.created_at > now() - interval '90 days'`),
      this.prisma.$queryRaw<{ total24h: number; lastAction: string | null; lastAt: Date | null }[]>(sql`
        SELECT count(*) FILTER (WHERE a.created_at > now() - interval '24 hours')::int AS "total24h",
               (array_agg(a.action ORDER BY a.created_at DESC))[1] AS "lastAction",
               max(a.created_at) AS "lastAt"
        FROM audit_logs a
        WHERE a.ip = ${ip}::inet AND a.created_at > now() - interval '30 days'`),
      this.prisma.$queryRaw<{ id: string; username: string; status: string; hits: number; lastSeenAt: Date; rolePriority: number }[]>(sql`
        SELECT u.id, u.username::text AS username, u.status::text AS status, ui.hits, ui.last_seen_at AS "lastSeenAt",
               COALESCE((SELECT max(r.priority) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), 0)::int AS "rolePriority"
        FROM user_ips ui JOIN users u ON u.id = ui.user_id
        WHERE ui.ip = ${ip}::inet
        ORDER BY ui.last_seen_at DESC
        LIMIT 10`),
      this.prisma.$queryRaw<{ id: string; cidr: string; level: string; ports: number[]; reason: string | null; source: string; expiresAt: Date | null }[]>(sql`
        SELECT b.id, b.cidr, b.level::text AS level, b.ports, b.reason, b.source, b.expires_at AS "expiresAt"
        FROM ip_blocks b
        WHERE ${ip}::inet <<= b.cidr::inet AND (b.expires_at IS NULL OR b.expires_at > now())`),
      this.prisma.$queryRaw<{ id: string; value: string; weight: number; note: string | null }[]>(sql`
        SELECT t.id, t.value, t.weight, t.note FROM traffic_priorities t
        WHERE CASE WHEN t.kind = 'IP' THEN ${ip}::inet <<= t.value::inet ELSE false END`),
      this.prisma.correlationHit.findMany({
        where: { groupKey: ip },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, createdAt: true, status: true, severity: true, outcome: true, count: true, rule: { select: { name: true } } },
      }),
    ]);

    return {
      ip,
      family: ipFamily(ip),
      scope: PARSED_SCOPES.find((s) => cidrContains(s.cidr, ip))?.scope ?? 'public',
      reverseDns: reverse,
      logins: logins[0],
      audit: audit[0],
      users,
      blocks,
      trusted,
      weight: this.traffic.describeIp(ip).weight,
      hits: hits.map((h) => ({ ...h, ruleName: h.rule.name, rule: undefined })),
    };
  }

  /** Обратная зона с жёстким таймаутом: медленный DNS не должен держать карточку. */
  private async reverse(ip: string): Promise<string | null> {
    const lookup = dns.reverse(ip).then((names) => names[0] ?? null).catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DNS_TIMEOUT_MS).unref());
    return Promise.race([lookup, timeout]);
  }
}
