import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { normalizeIp, parseCidr } from '../security/ip';

/**
 * Поисковая строка в духе SIEM для журналов, пользователей, лицензий и сборок:
 *
 *   (action:user.* OR action:license.*) AND NOT actor:system ip:10.0.0.0/8 "фраза"
 *
 * поле:значение — точное совпадение без учёта регистра, `*` — подстановка;
 * слово без поля ищется по всем текстовым колонкам как подстрока.
 * Операторы: AND (или просто пробел), OR (или |), NOT (или - / ! перед
 * условием), скобки. Приоритет: NOT, затем AND, затем OR. Поля задаёт
 * вызывающий: неизвестное поле — ошибка, а не тихий поиск по тексту.
 */

export interface QueryTerm {
  field: string | null;
  value: string;
}

export type QueryNode =
  | { type: 'term'; term: QueryTerm }
  | { type: 'not'; node: QueryNode }
  | { type: 'and' | 'or'; nodes: QueryNode[] };

const MAX_TERMS = 30;
const MAX_VALUE = 200;
const MAX_DEPTH = 10;

type Token =
  | { kind: 'lparen' | 'rparen' | 'and' | 'or' | 'not' }
  | { kind: 'term'; field: string | null; value: string };

function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ kind: ch === '(' ? 'lparen' : 'rparen' });
      i++;
      continue;
    }
    if (ch === '|') {
      tokens.push({ kind: 'or' });
      i++;
      continue;
    }
    // «-» и «!» в начале условия — отрицание.
    if ((ch === '-' || ch === '!') && i + 1 < q.length && !/\s/.test(q[i + 1]!)) {
      tokens.push({ kind: 'not' });
      i++;
      continue;
    }

    // Поле (необязательно), затем значение: в кавычках или до пробела/скобки.
    const field = /^([a-zA-Z][a-zA-Z0-9_]*):/.exec(q.slice(i));
    if (field) i += field[0].length;
    let value = '';
    const quoted = q[i] === '"';
    if (quoted) {
      const end = q.indexOf('"', i + 1);
      value = end === -1 ? q.slice(i + 1) : q.slice(i + 1, end);
      i = end === -1 ? q.length : end + 1;
    } else {
      const start = i;
      while (i < q.length && !/[\s()]/.test(q[i]!)) i++;
      value = q.slice(start, i);
    }

    if (!field && !quoted) {
      const word = value.toUpperCase();
      if (word === 'AND' || word === '&&') {
        tokens.push({ kind: 'and' });
        continue;
      }
      if (word === 'OR' || word === '||') {
        tokens.push({ kind: 'or' });
        continue;
      }
      if (word === 'NOT') {
        tokens.push({ kind: 'not' });
        continue;
      }
    }
    if (value || field) tokens.push({ kind: 'term', field: field?.[1] ?? null, value: value.slice(0, MAX_VALUE) });
  }
  return tokens;
}

/** Разбор строки в дерево условий. Пустая строка — null (без фильтра). */
export function parseQuery(q: string | undefined, fields: readonly string[]): QueryNode | null {
  const allowed = new Set(fields.map((f) => f.toLowerCase()));
  const tokens = tokenize(q ?? '');
  let pos = 0;
  let terms = 0;

  const syntax = (message: string) =>
    new BadRequestException({ code: 'SEARCH_SYNTAX', message: `Ошибка в запросе: ${message}` });

  function parseOr(depth: number): QueryNode | null {
    const nodes: QueryNode[] = [];
    const first = parseAnd(depth);
    if (first) nodes.push(first);
    while (tokens[pos]?.kind === 'or') {
      pos++;
      const next = parseAnd(depth);
      if (!next) throw syntax('после OR нужно условие');
      nodes.push(next);
    }
    if (nodes.length === 0) return null;
    return nodes.length === 1 ? nodes[0]! : { type: 'or', nodes };
  }

  function parseAnd(depth: number): QueryNode | null {
    const nodes: QueryNode[] = [];
    for (;;) {
      const token = tokens[pos];
      if (!token || token.kind === 'or' || token.kind === 'rparen') break;
      if (token.kind === 'and') {
        pos++;
        continue;
      }
      const node = parseUnary(depth);
      if (node) nodes.push(node);
    }
    if (nodes.length === 0) return null;
    return nodes.length === 1 ? nodes[0]! : { type: 'and', nodes };
  }

  function parseUnary(depth: number): QueryNode | null {
    if (depth > MAX_DEPTH) throw syntax('слишком глубокая вложенность скобок');
    const token = tokens[pos];
    if (!token) return null;
    if (token.kind === 'not') {
      pos++;
      const node = parseUnary(depth + 1);
      if (!node) throw syntax('после NOT нужно условие');
      return { type: 'not', node };
    }
    if (token.kind === 'lparen') {
      pos++;
      const node = parseOr(depth + 1);
      if (tokens[pos]?.kind !== 'rparen') throw syntax('не закрыта скобка');
      pos++;
      return node;
    }
    if (token.kind === 'term') {
      pos++;
      const field = token.field?.toLowerCase() ?? null;
      if (field && !allowed.has(field)) {
        throw new BadRequestException({
          code: 'SEARCH_FIELD_UNKNOWN',
          message: `Неизвестное поле «${token.field}». Доступны: ${fields.join(', ')}`,
        });
      }
      if (!token.value) throw syntax(`у поля ${token.field} нет значения`);
      if (++terms > MAX_TERMS) throw syntax(`не больше ${MAX_TERMS} условий`);
      return { type: 'term', term: { field, value: token.value } };
    }
    throw syntax('лишняя закрывающая скобка');
  }

  const root = parseOr(0);
  if (pos < tokens.length) throw syntax('лишняя закрывающая скобка');
  return root;
}

/** Есть ли в дереве условие по полю (для проверки прав на отдельные поля). */
export function usesField(node: QueryNode | null, field: string): boolean {
  if (!node) return false;
  if (node.type === 'term') return node.term.field === field;
  if (node.type === 'not') return usesField(node.node, field);
  return node.nodes.some((child) => usesField(child, field));
}

/** Дерево в SQL: каждое условие переводит вызывающий, связки — здесь. */
export function compileQuery(node: QueryNode | null, term: (t: QueryTerm) => Prisma.Sql): Prisma.Sql | null {
  if (!node) return null;
  switch (node.type) {
    case 'term':
      return Prisma.sql`(${term(node.term)})`;
    case 'not':
      // Исключение не должно терять строки с NULL в колонке.
      return Prisma.sql`NOT COALESCE(${compileQuery(node.node, term)!}, FALSE)`;
    default:
      return Prisma.sql`(${Prisma.join(
        node.nodes.map((child) => compileQuery(child, term)!),
        node.type === 'and' ? ' AND ' : ' OR ',
      )})`;
  }
}

/** Разобрать и перевести за один шаг; null — фильтра нет. */
export function queryCondition(
  q: string | undefined,
  fields: readonly string[],
  term: (t: QueryTerm) => Prisma.Sql,
): Prisma.Sql | null {
  return compileQuery(parseQuery(q, fields), term);
}

/** Значение в шаблон ILIKE: спецсимволы экранируются, `*` — любая подстрока. */
export function likePattern(value: string, contains = false): string {
  const escaped = value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '%');
  return contains && !value.includes('*') ? `%${escaped}%` : escaped;
}

/** Колонка (SQL-выражение) совпадает со значением: точно или по маске. */
export function textMatch(column: Prisma.Sql, value: string): Prisma.Sql {
  return Prisma.sql`${column} ILIKE ${likePattern(value)}`;
}

/** Колонка содержит подстроку. */
export function textContains(column: Prisma.Sql, value: string): Prisma.Sql {
  return Prisma.sql`${column} ILIKE ${likePattern(value, true)}`;
}

/** Любая из колонок содержит подстроку — поиск слова без поля. */
export function anyContains(columns: string[], value: string): Prisma.Sql {
  return Prisma.sql`(${Prisma.join(
    columns.map((column) => textContains(Prisma.raw(column), value)),
    ' OR ',
  )})`;
}

/**
 * Условие по IP-колонке (inet): адрес, подсеть CIDR, маска со `*` или
 * начало адреса («192.168.»).
 */
export function ipMatch(column: Prisma.Sql, value: string): Prisma.Sql {
  if (value.includes('*')) return Prisma.sql`host(${column}) LIKE ${likePattern(value)}`;
  const address = normalizeIp(value);
  if (address) return Prisma.sql`${column} = ${address}::inet`;
  const cidr = value.includes('/') ? parseCidr(value) : null;
  if (cidr) return Prisma.sql`${column} <<= ${cidr.cidr}::inet`;
  return Prisma.sql`host(${column}) LIKE ${`${likePattern(value)}%`}`;
}

/** Значение перечисления (статус и т.п.): точно или по маске, без учёта регистра. */
export function enumMatch(column: Prisma.Sql, value: string): Prisma.Sql {
  return Prisma.sql`${column}::text ILIKE ${likePattern(value)}`;
}

export function whereClause(conditions: (Prisma.Sql | null)[]): Prisma.Sql {
  const list = conditions.filter((c): c is Prisma.Sql => c !== null);
  return list.length ? Prisma.sql`WHERE ${Prisma.join(list, ' AND ')}` : Prisma.empty;
}

/** Условия диапазона времени по колонке. */
export function timeRange(column: Prisma.Sql, range: { from?: Date; to?: Date }): Prisma.Sql[] {
  return [
    ...(range.from ? [Prisma.sql`${column} >= ${range.from}`] : []),
    ...(range.to ? [Prisma.sql`${column} <= ${range.to}`] : []),
  ];
}

/** Шаг гистограммы под длину диапазона. */
export function histogramInterval(from?: Date, to?: Date): string {
  if (!from) return '1 day';
  const span = (to ?? new Date()).getTime() - from.getTime();
  const hour = 3_600_000;
  if (span <= 3 * hour) return '5 minutes';
  if (span <= 2 * 24 * hour) return '1 hour';
  if (span <= 14 * 24 * hour) return '6 hours';
  if (span <= 90 * 24 * hour) return '1 day';
  return '7 days';
}

export function yesNo(value: string): boolean | null {
  const v = value.toLowerCase();
  if (['yes', 'true', '1', 'on', 'да', 'success', 'ok'].includes(v)) return true;
  if (['no', 'false', '0', 'off', 'нет', 'fail', 'failed', 'error'].includes(v)) return false;
  return null;
}
