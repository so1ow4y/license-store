import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '@prisma/client';

import { compileQuery, histogramStep, likePattern, parseQuery } from '../src/common/search/query';
import { cidrContains, normalizeIp, parseCidr } from '../src/common/security/ip';
import { IpBlockService } from '../src/common/security/ip-block.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

describe('parseQuery', () => {
  const fields = ['action', 'actor', 'ip'] as const;
  const term = (field: string | null, value: string) => ({ type: 'term', term: { field, value } });

  it('разбирает поля, исключения, фразы и слова (пробел — AND)', () => {
    expect(parseQuery('action:user.* -actor:system ip:"10.0.0.0/8" вход', fields)).toEqual({
      type: 'and',
      nodes: [
        term('action', 'user.*'),
        { type: 'not', node: term('actor', 'system') },
        term('ip', '10.0.0.0/8'),
        term(null, 'вход'),
      ],
    });
  });

  it('понимает OR, NOT и скобки с приоритетом NOT > AND > OR', () => {
    expect(parseQuery('(action:a OR action:b) AND NOT actor:x | ip:1.2.3.4', fields)).toEqual({
      type: 'or',
      nodes: [
        {
          type: 'and',
          nodes: [{ type: 'or', nodes: [term('action', 'a'), term('action', 'b')] }, { type: 'not', node: term('actor', 'x') }],
        },
        term('ip', '1.2.3.4'),
      ],
    });
  });

  it('слово AND в кавычках — это текст, а не оператор', () => {
    expect(parseQuery('"AND"', fields)).toEqual(term(null, 'AND'));
  });

  it('пустая строка — без фильтра', () => {
    expect(parseQuery('   ', fields)).toBeNull();
  });

  it('неизвестное поле и незакрытая скобка — ошибки', () => {
    expect(() => parseQuery('password:123', fields)).toThrow(BadRequestException);
    expect(() => parseQuery('(action:a OR action:b', fields)).toThrow(BadRequestException);
    expect(() => parseQuery('action:a)', fields)).toThrow(BadRequestException);
  });

  it('собирает SQL со связками и защищает исключение от NULL', () => {
    const sql = compileQuery(parseQuery('action:a OR NOT actor:b', fields), (t) =>
      Prisma.sql`${Prisma.raw(t.field ?? 'text')} = ${t.value}`,
    );
    expect(sql?.sql).toBe('((action = ?) OR NOT COALESCE((actor = ?), FALSE))');
    expect(sql?.values).toEqual(['a', 'b']);
  });

  it('экранирует спецсимволы LIKE и превращает * в подстановку', () => {
    expect(likePattern('50%_off')).toBe('50\\%\\_off');
    expect(likePattern('user.*')).toBe('user.%');
    expect(likePattern('bob', true)).toBe('%bob%');
  });
});

describe('histogramStep', () => {
  const at = (iso: string) => new Date(iso);

  it('дробит узкий диапазон до минут', () => {
    expect(histogramStep(at('2026-10-05T10:00:00Z'), at('2026-10-05T10:15:00Z'))).toEqual({ interval: '1 minute', intervalMs: 60_000 });
    expect(histogramStep(at('2026-10-05T10:00:00Z'), at('2026-10-05T14:00:00Z')).interval).toBe('5 minutes');
  });

  it('держит число столбиков около сотни', () => {
    const from = at('2026-09-05T00:00:00Z');
    const to = at('2026-10-05T00:00:00Z');
    const { intervalMs } = histogramStep(from, to);
    expect((to.getTime() - from.getTime()) / intervalMs).toBeLessThanOrEqual(90);
    expect(histogramStep(from, to).interval).toBe('12 hours');
  });

  it('без начала — шаг в день, очень длинный — неделя', () => {
    expect(histogramStep().interval).toBe('1 day');
    expect(histogramStep(at('2024-01-01T00:00:00Z'), at('2026-01-01T00:00:00Z')).interval).toBe('7 days');
  });
});

describe('IP и подсети', () => {
  it('разворачивает IPv4 внутри IPv6', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('не адрес')).toBeNull();
  });

  it('приводит подсеть к адресу сети', () => {
    expect(parseCidr('203.0.113.77/24')?.cidr).toBe('203.0.113.0/24');
    expect(parseCidr('203.0.113.7')?.cidr).toBe('203.0.113.7/32');
    expect(parseCidr('2001:db8:aaaa:bbbb::1/48')?.cidr).toBe('2001:db8:aaaa::/48');
    expect(parseCidr('10.0.0.0/33')).toBeNull();
  });

  it('проверяет вхождение адреса в подсеть', () => {
    const net = parseCidr('10.1.0.0/16')!;
    expect(cidrContains(net, '10.1.200.3')).toBe(true);
    expect(cidrContains(net, '10.2.0.1')).toBe(false);
    expect(cidrContains(parseCidr('2001:db8::/32')!, '2001:db8:1::5')).toBe(true);
  });
});

describe('IpBlockService', () => {
  function makeService(rows: Array<{ cidr: string; ports: number[] }>, privileged: Array<{ username: string }> = []) {
    const prisma = {
      $queryRaw: vi.fn(async () => privileged),
      ipBlock: {
        findMany: vi.fn(async () => rows),
        upsert: vi.fn(async ({ create }: { create: { id: string; cidr: string; ports: number[] } }) => {
          rows.push({ cidr: create.cidr, ports: create.ports });
          return create;
        }),
      },
    } as unknown as PrismaService;
    const audit = { record: vi.fn(async () => undefined) } as unknown as AuditService;
    return new IpBlockService(prisma, audit);
  }

  it('блокирует адреса из подсети и пропускает остальные', async () => {
    const service = makeService([{ cidr: '198.51.100.0/24', ports: [] }]);
    expect(await service.isBlocked('198.51.100.20')).toBe(true);
    expect(await service.isBlocked('::ffff:198.51.100.20')).toBe(true);
    expect(await service.isBlocked('198.51.101.1')).toBe(false);
  });

  it('не даёт заблокировать свой адрес и слишком широкую сеть', async () => {
    const service = makeService([]);
    await expect(service.create({ value: '203.0.113.0/24' }, { id: 'a', ip: '203.0.113.9' })).rejects.toMatchObject({
      response: { code: 'IP_BLOCK_SELF' },
    });
    await expect(service.create({ value: '10.0.0.0/8' }, { id: 'a' })).rejects.toMatchObject({
      response: { code: 'IP_RANGE_TOO_WIDE' },
    });
  });

  it('не даёт заблокировать адрес пользователя не ниже себя по роли', async () => {
    const service = makeService([], [{ username: 'other-super' }]);
    await expect(
      service.create({ value: '192.0.2.50' }, { id: 'a', ip: '198.51.100.1', rolePriority: 100 }),
    ).rejects.toMatchObject({ response: { code: 'IP_OF_PRIVILEGED_USER' } });
    expect(await service.isBlocked('192.0.2.50')).toBe(false);
  });

  it('новая блокировка действует сразу', async () => {
    const service = makeService([]);
    expect(await service.isBlocked('192.0.2.5')).toBe(false);
    await service.create({ value: '192.0.2.5', reason: 'перебор' }, { id: 'a', ip: '198.51.100.1' });
    expect(await service.isBlocked('192.0.2.5')).toBe(true);
  });
  it('блок фаервола только по SSH не закрывает сайт, по 443 — закрывает', async () => {
    const service = makeService([
      { cidr: '198.51.100.7/32', ports: [22] },
      { cidr: '198.51.100.8/32', ports: [22, 443] },
    ]);
    expect(await service.isBlocked('198.51.100.7')).toBe(false);
    expect(await service.isBlocked('198.51.100.8')).toBe(true);
  });

  it('петлю заблокировать нельзя', async () => {
    const service = makeService([]);
    await expect(service.create({ value: '127.0.0.1' }, { id: 'a' })).rejects.toMatchObject({
      response: { code: 'IP_BLOCK_LOOPBACK' },
    });
  });
});