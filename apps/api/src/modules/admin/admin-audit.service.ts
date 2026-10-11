import { BadRequestException, Injectable } from '@nestjs/common';
import { AntiFraudSeverity, AntiFraudType, Prisma } from '@prisma/client';

import { PrismaService } from '@common/prisma/prisma.service';
import {
  anyContains,
  histogramStep,
  ipMatch,
  queryCondition,
  textMatch,
  timeRange,
  whereClause,
  yesNo,
  type QueryTerm,
} from '@common/search/query';

/**
 * Мини-SIEM: журнал событий (audit_logs) и журнал входов (login_history).
 * Поиск строкой «поле:значение», диапазон времени, топ значений по полям и
 * гистограмма событий. Запросы собираются из Prisma.sql — значения уходят
 * параметрами, имена колонок фиксированы в коде.
 */

export interface SearchInput {
  q?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

export const AUDIT_FIELDS = ['action', 'actor', 'actortype', 'entity', 'entityid', 'ip', 'request'] as const;
export const LOGIN_FIELDS = ['user', 'ip', 'result', 'reason', 'method', 'country'] as const;

const sql = Prisma.sql;
const raw = Prisma.raw;

/** Топ значений: подпись поля в строке поиска и SQL-выражение. */
type Facet = { field: string; expr: Prisma.Sql };

const AUDIT_FACETS: Facet[] = [
  { field: 'action', expr: raw('a.action') },
  { field: 'actor', expr: raw('COALESCE(u.username::text, a.actor_label)') },
  { field: 'ip', expr: raw('host(a.ip)') },
  { field: 'entity', expr: raw('a.entity_type') },
];

const LOGIN_FACETS: Facet[] = [
  { field: 'user', expr: raw('COALESCE(u.username::text, l.identifier_used)') },
  { field: 'ip', expr: raw('host(l.ip)') },
  { field: 'reason', expr: raw('l.failure_reason') },
  { field: 'method', expr: raw('l.method') },
];

/**
 * Поля, по которым правило корреляции группирует события и считает разные
 * значения. Подпись — то, что видит администратор, выражение — фиксированный SQL.
 */
export const CORRELATION_FIELDS = {
  LOGINS: {
    ip: 'host(l.ip)',
    user: 'COALESCE(u.username::text, l.identifier_used)',
    country: 'l.country',
    method: 'l.method',
    reason: 'l.failure_reason',
  },
  AUDIT: {
    ip: 'host(a.ip)',
    actor: 'COALESCE(u.username::text, a.actor_label)',
    action: 'a.action',
    entity: 'a.entity_type',
  },
} as const;

export interface CorrelationQuery {
  source: keyof typeof CORRELATION_FIELDS;
  q: string;
  groupBy: string;
  distinctField?: string | null;
  threshold: number;
  from: Date;
  to: Date;
  limit?: number;
}

export interface CorrelationGroup {
  key: string;
  count: number;
  distinctCount: number | null;
  firstEventAt: Date;
  lastEventAt: Date;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- события

  async searchAudit(input: SearchInput) {
    const where = whereClause(this.auditConditions(input));
    const take = Math.min(input.take ?? 50, 200);
    const skip = input.skip ?? 0;

    const [items, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>(sql`
        SELECT a.id, a.created_at AS "createdAt", a.actor_id AS "actorId", a.actor_type::text AS "actorType",
               a.actor_label AS "actorLabel", u.username::text AS "actorUsername", a.action,
               a.entity_type AS "entityType", a.entity_id AS "entityId", host(a.ip) AS ip,
               a.user_agent AS "userAgent", a.request_id AS "requestId", a.before, a.after
        FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${take} OFFSET ${skip}`),
      this.prisma.$queryRaw<[{ total: number }]>(sql`
        SELECT count(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where}`),
    ]);
    return { items, total, skip, take };
  }

  async auditStats(input: SearchInput) {
    const conditions = this.auditConditions(input);
    const step = histogramStep(input.from, input.to);
    const from = sql`FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id`;
    const [histogram, facets] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>(sql`
        SELECT date_bin(${step.interval}::interval, a.created_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket,
               count(*)::int AS count
        ${from} ${whereClause(conditions)}
        GROUP BY 1 ORDER BY 1 DESC LIMIT 200`),
      this.facets(from, conditions, AUDIT_FACETS),
    ]);
    return { ...step, histogram: histogram.reverse(), facets };
  }

  private auditConditions(input: SearchInput): (Prisma.Sql | null)[] {
    return [
      ...timeRange(raw('a.created_at'), input),
      queryCondition(input.q, AUDIT_FIELDS, (term) => this.auditTerm(term)),
    ];
  }

  private auditTerm({ field, value }: QueryTerm): Prisma.Sql {
    switch (field) {
      case 'action':
        return textMatch(raw('a.action'), value);
      case 'actor':
        return sql`(${textMatch(raw('a.actor_label'), value)} OR ${textMatch(raw('u.username::text'), value)} OR a.actor_id::text = ${value})`;
      case 'actortype':
        return sql`a.actor_type::text = ${value.toUpperCase()}`;
      case 'entity':
        return textMatch(raw('a.entity_type'), value);
      case 'entityid':
        return textMatch(raw('a.entity_id::text'), value);
      case 'ip':
        return ipMatch(raw('a.ip'), value);
      case 'request':
        return sql`a.request_id = ${value}`;
      default:
        return anyContains(
          ['a.action', 'a.actor_label', 'u.username::text', 'a.entity_type', 'a.entity_id::text', 'host(a.ip)', 'a.request_id', 'a.before::text', 'a.after::text'],
          value,
        );
    }
  }

  // ---------------------------------------------------------------- входы

  async searchLogins(input: SearchInput) {
    const where = whereClause(this.loginConditions(input));
    const take = Math.min(input.take ?? 50, 200);
    const skip = input.skip ?? 0;

    const [items, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>(sql`
        SELECT l.id, l.created_at AS "createdAt", l.user_id AS "userId", u.username::text AS username,
               l.identifier_used AS "identifierUsed", l.success, l.failure_reason AS "failureReason",
               l.method, host(l.ip) AS ip, l.country, l.user_agent AS "userAgent", l.client_version AS "clientVersion"
        FROM login_history l LEFT JOIN users u ON u.id = l.user_id
        ${where}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${take} OFFSET ${skip}`),
      this.prisma.$queryRaw<[{ total: number }]>(sql`
        SELECT count(*)::int AS total FROM login_history l LEFT JOIN users u ON u.id = l.user_id ${where}`),
    ]);
    return { items, total, skip, take };
  }

  async loginStats(input: SearchInput) {
    const conditions = this.loginConditions(input);
    const step = histogramStep(input.from, input.to);
    const from = sql`FROM login_history l LEFT JOIN users u ON u.id = l.user_id`;
    const [histogram, facets] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>(sql`
        SELECT date_bin(${step.interval}::interval, l.created_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket,
               count(*)::int AS count, count(*) FILTER (WHERE NOT l.success)::int AS failed
        ${from} ${whereClause(conditions)}
        GROUP BY 1 ORDER BY 1 DESC LIMIT 200`),
      this.facets(from, conditions, LOGIN_FACETS),
    ]);
    return { ...step, histogram: histogram.reverse(), facets };
  }

  private loginConditions(input: SearchInput): (Prisma.Sql | null)[] {
    return [
      ...timeRange(raw('l.created_at'), input),
      queryCondition(input.q, LOGIN_FIELDS, (term) => this.loginTerm(term)),
    ];
  }

  private loginTerm({ field, value }: QueryTerm): Prisma.Sql {
    switch (field) {
      case 'user':
        return sql`(${textMatch(raw('l.identifier_used'), value)} OR ${textMatch(raw('u.username::text'), value)} OR l.user_id::text = ${value})`;
      case 'ip':
        return ipMatch(raw('l.ip'), value);
      case 'result': {
        const success = yesNo(value);
        if (success === null) {
          throw new BadRequestException({ code: 'SEARCH_VALUE_INVALID', message: 'result: success или fail' });
        }
        return sql`l.success = ${success}`;
      }
      case 'reason':
        return textMatch(raw('l.failure_reason'), value);
      case 'method':
        return textMatch(raw('l.method'), value);
      case 'country':
        return sql`l.country = ${value.toUpperCase()}`;
      default:
        return anyContains(['l.identifier_used', 'u.username::text', 'host(l.ip)', 'l.failure_reason', 'l.method', 'l.user_agent'], value);
    }
  }

  // ------------------------------------------------------------- антифрод

  async listAntifraud(filters: { type?: AntiFraudType; severity?: AntiFraudSeverity; skip?: number; take?: number }) {
    const where: Prisma.AntiFraudEventWhereInput = {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
    };
    const take = Math.min(filters.take ?? 50, 200);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.antiFraudEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: filters.skip ?? 0, take }),
      this.prisma.antiFraudEvent.count({ where }),
    ]);
    return { items, total, skip: filters.skip ?? 0, take };
  }

  // ------------------------------------------------------------ корреляция

  /**
   * Группы событий, перешедшие порог: «N событий по запросу за окно» или
   * «N разных значений поля». Строка поиска — тот же язык, что в
   * обозревателе, поэтому правило можно сначала отладить там.
   */
  async correlate(input: CorrelationQuery): Promise<CorrelationGroup[]> {
    const { group, distinct, from, createdAt, conditions } = this.correlationParts(input);
    const measure = distinct ? sql`count(DISTINCT ${distinct})` : sql`count(*)`;
    return this.prisma.$queryRaw<CorrelationGroup[]>(sql`
      SELECT ${group} AS "key", count(*)::int AS "count",
             ${distinct ? sql`count(DISTINCT ${distinct})::int` : sql`NULL::int`} AS "distinctCount",
             min(${createdAt}) AS "firstEventAt", max(${createdAt}) AS "lastEventAt"
      ${from} ${whereClause([...conditions, sql`${group} IS NOT NULL`])}
      GROUP BY 1
      HAVING ${measure} >= ${input.threshold}
      ORDER BY ${measure} DESC, 1
      LIMIT ${Math.min(input.limit ?? 100, 500)}`);
  }

  /** Что стояло за сработкой: топ значений по остальным полям внутри одной группы. */
  async correlationSample(input: Omit<CorrelationQuery, 'threshold' | 'limit'> & { key: string }) {
    const { group, from, conditions } = this.correlationParts(input);
    const facets = (input.source === 'LOGINS' ? LOGIN_FACETS : AUDIT_FACETS).filter((f) => f.field !== input.groupBy);
    return this.facets(from, [...conditions, sql`${group} = ${input.key}`], facets);
  }

  private correlationParts(input: Omit<CorrelationQuery, 'threshold' | 'limit'>) {
    const fields: Record<string, string> = CORRELATION_FIELDS[input.source];
    const groupExpr = fields[input.groupBy];
    const distinctExpr = input.distinctField ? fields[input.distinctField] : undefined;
    if (!groupExpr || (input.distinctField && !distinctExpr)) {
      throw new BadRequestException({ code: 'CORRELATION_FIELD_INVALID', message: 'Поле группировки недоступно для этого журнала' });
    }
    const logins = input.source === 'LOGINS';
    const range = { q: input.q, from: input.from, to: input.to };
    return {
      group: raw(groupExpr),
      distinct: distinctExpr ? raw(distinctExpr) : null,
      createdAt: raw(logins ? 'l.created_at' : 'a.created_at'),
      from: logins
        ? sql`FROM login_history l LEFT JOIN users u ON u.id = l.user_id`
        : sql`FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id`,
      conditions: logins ? this.loginConditions(range) : this.auditConditions(range),
    };
  }

  // ------------------------------------------------------------- внутреннее

  private async facets(from: Prisma.Sql, conditions: (Prisma.Sql | null)[], facets: Facet[]) {
    const rows = await Promise.all(
      facets.map((facet) =>
        this.prisma.$queryRaw<{ value: string; count: number }[]>(sql`
          SELECT ${facet.expr} AS value, count(*)::int AS count
          ${from} ${whereClause([...conditions, sql`${facet.expr} IS NOT NULL`])}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      ),
    );
    return facets.map((facet, i) => ({ field: facet.field, values: rows[i] }));
  }
}
