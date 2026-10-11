import { EventEmitter } from 'node:events';
import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { coversWeb, normalizePorts } from '../src/common/security/ip-block.service';
import {
  sanitizeTrafficConfig,
  TRAFFIC_DEFAULTS,
  TrafficPriorityService,
  type TrafficConfig,
} from '../src/common/security/traffic-priority.service';
import { renderNftables } from '../src/modules/security-center/edge.service';
import { sanitizeWidgets } from '../src/modules/security-center/dashboards.service';
import type { Env } from '../src/common/config/env.schema';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { SettingsService } from '../src/common/settings/settings.service';

// ------------------------------------------------------------ подставки

type Entry = { kind: 'IP' | 'USER'; value: string; weight: number };

async function makeService(config: Partial<TrafficConfig>, entries: Entry[] = []) {
  const prisma = {
    trafficPriority: { findMany: vi.fn().mockResolvedValue(entries) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
  const settings = { get: vi.fn().mockResolvedValue({ ...TRAFFIC_DEFAULTS, ...config }) } as unknown as SettingsService;
  const service = new TrafficPriorityService(prisma, settings, { JWT_SECRET: 'x'.repeat(48) } as Env);
  await service.reload();
  return service;
}

let seq = 0;
function request(ip: string, headers: Record<string, string> = {}) {
  const raw = Object.assign(new EventEmitter(), { destroyed: false });
  const reply = {
    raw,
    status: 0,
    body: undefined as unknown,
    code(status: number) {
      this.status = status;
      return this;
    },
    header() {
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const req = { url: '/api/v1/products', ip, headers, id: `r${++seq}` };
  const done = vi.fn();
  return { req, reply, done, finish: () => raw.emit('close') };
}

function handle(service: TrafficPriorityService, r: ReturnType<typeof request>) {
  service.handle(r.req as never, r.reply as never, r.done);
}

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------ очередь

describe('TrafficPriorityService: очередь по весам', () => {
  it('освободившийся слот получает самый тяжёлый запрос, равные — по порядку', async () => {
    const service = await makeService({ maxConcurrent: 4 }, [{ kind: 'IP', value: '198.51.100.0/24', weight: 60 }]);
    const running = Array.from({ length: 4 }, () => request('203.0.113.1'));
    running.forEach((r) => handle(service, r));
    expect(running.every((r) => r.done.mock.calls.length === 1)).toBe(true);

    const anonA = request('203.0.113.2');
    const trusted = request('198.51.100.9');
    const anonB = request('203.0.113.3');
    [anonA, trusted, anonB].forEach((r) => handle(service, r));
    expect([anonA, trusted, anonB].map((r) => r.done.mock.calls.length)).toEqual([0, 0, 0]);

    running[0]!.finish();
    expect(trusted.done).toHaveBeenCalledTimes(1);
    expect(anonA.done).not.toHaveBeenCalled();

    running[1]!.finish();
    expect(anonA.done).toHaveBeenCalledTimes(1);
    expect(anonB.done).not.toHaveBeenCalled();
    expect(service.snapshot().queued).toBe(1);
  });

  it('вес не ниже bypassWeight проходит мимо полной очереди', async () => {
    const service = await makeService({ maxConcurrent: 4, bypassWeight: 90 }, [{ kind: 'IP', value: '192.0.2.10', weight: 100 }]);
    Array.from({ length: 5 }, () => request('203.0.113.1')).forEach((r) => handle(service, r));
    const admin = request('192.0.2.10');
    handle(service, admin);
    expect(admin.done).toHaveBeenCalledTimes(1);
  });

  it('при переполнении очереди выбивается самый лёгкий, а не новый тяжёлый', async () => {
    const service = await makeService({ maxConcurrent: 4, queueMax: 1 }, [{ kind: 'IP', value: '198.51.100.0/24', weight: 60 }]);
    Array.from({ length: 4 }, () => request('203.0.113.1')).forEach((r) => handle(service, r));
    const light = request('203.0.113.2');
    handle(service, light);
    const heavy = request('198.51.100.5');
    handle(service, heavy);
    expect(light.reply.status).toBe(503);
    expect(heavy.reply.status).toBe(0);
    // Новый лёгкий при полной очереди с тяжёлым — отказ сразу.
    const late = request('203.0.113.3');
    handle(service, late);
    expect(late.reply.status).toBe(503);
  });

  it('ожидание дольше queueTimeoutMs — 503', async () => {
    vi.useFakeTimers();
    const service = await makeService({ maxConcurrent: 4, queueTimeoutMs: 1000 });
    Array.from({ length: 4 }, () => request('203.0.113.1')).forEach((r) => handle(service, r));
    const waiting = request('203.0.113.2');
    handle(service, waiting);
    vi.advanceTimersByTime(1001);
    expect(waiting.reply.status).toBe(503);
    expect(waiting.done).not.toHaveBeenCalled();
  });

  it('режим атаки: легче порога — 503 сразу, доверенный адрес проходит', async () => {
    const service = await makeService({ attackMode: true, attackMinWeight: 50 }, [{ kind: 'IP', value: '192.0.2.0/24', weight: 60 }]);
    const anon = request('203.0.113.1');
    handle(service, anon);
    expect(anon.reply.status).toBe(503);
    expect((anon.reply.body as { code: string }).code).toBe('SERVICE_UNAVAILABLE');
    const trusted = request('192.0.2.77');
    handle(service, trusted);
    expect(trusted.done).toHaveBeenCalledTimes(1);
  });

  it('пробы и краевые агенты мимо очереди даже в режиме атаки', async () => {
    const service = await makeService({ attackMode: true });
    const probe = request('203.0.113.1');
    probe.req.url = '/health/live';
    handle(service, probe);
    expect(probe.done).toHaveBeenCalledTimes(1);
  });
});

describe('TrafficPriorityService: пропуск приоритета', () => {
  const userId = '0199a000-0000-7000-8000-000000000001';

  it('выдаётся пользователю с весом и поднимает вес запроса без токена', async () => {
    const service = await makeService({}, [{ kind: 'USER', value: userId, weight: 95 }]);
    const issued = service.issuePass(userId);
    expect(issued?.weight).toBe(95);
    const r = request('203.0.113.1', { 'x-priority-pass': issued!.pass });
    expect(service.weightOf(r.req as never, '203.0.113.1')).toBe(95);
  });

  it('подделанный пропуск и пользователь без веса — без приоритета', async () => {
    const service = await makeService({}, [{ kind: 'USER', value: userId, weight: 95 }]);
    expect(service.issuePass('0199a000-0000-7000-8000-000000000002')).toBeNull();
    const issued = service.issuePass(userId)!;
    const forged = `${issued.pass.split('.')[0]}.${'A'.repeat(43)}`;
    const r = request('203.0.113.1', { 'x-priority-pass': forged });
    expect(service.weightOf(r.req as never, '203.0.113.1')).toBe(TRAFFIC_DEFAULTS.anonymousWeight);
  });
});

// ------------------------------------------------------------ настройки и рендер

describe('sanitizeTrafficConfig', () => {
  it('берёт недостающее из умолчаний и зажимает числа в границы', () => {
    const config = sanitizeTrafficConfig({ maxConcurrent: 1, bypassWeight: 500, roleWeights: { 'bad slug!': 5, support: 300 } });
    expect(config.maxConcurrent).toBe(4);
    expect(config.bypassWeight).toBe(101);
    expect(config.roleWeights).toEqual({ support: 100 });
    expect(config.queueMax).toBe(TRAFFIC_DEFAULTS.queueMax);
  });
});

describe('порты блокировок', () => {
  it('нормализует и проверяет', () => {
    expect(normalizePorts([443, 22, 443])).toEqual([22, 443]);
    expect(() => normalizePorts([0])).toThrow(BadRequestException);
  });

  it('блок только по SSH не касается веб-трафика', () => {
    expect(coversWeb([])).toBe(true);
    expect(coversWeb([22])).toBe(false);
    expect(coversWeb([22, 443])).toBe(true);
  });
});

describe('renderNftables', () => {
  it('целые адреса — в множества, с портами — отдельными правилами, доверенные — раньше блоков', () => {
    const text = renderNftables(
      [
        { cidr: '198.51.100.7/32', level: 'FIREWALL', ports: [] },
        { cidr: '2001:db8::/48', level: 'FIREWALL', ports: [] },
        { cidr: '203.0.113.0/24', level: 'FIREWALL', ports: [22] },
      ],
      ['192.0.2.10/32'],
    );
    expect(text).toContain('delete table inet lp_guard');
    expect(text).toContain('elements = { 198.51.100.7/32 }');
    expect(text).toContain('elements = { 2001:db8::/48 }');
    expect(text).toContain('ip saddr 203.0.113.0/24 tcp dport { 22 } counter drop');
    expect(text.indexOf('@trusted4 accept')).toBeLessThan(text.indexOf('@blocked4 counter drop'));
  });

  it('пустой набор — валидные пустые множества без elements', () => {
    const text = renderNftables([], []);
    expect(text).not.toContain('elements');
    expect(text).toContain('policy accept');
  });
});

describe('sanitizeWidgets', () => {
  it('отбрасывает лишние поля и неизвестные размеры', () => {
    const [widget] = sanitizeWidgets([{ type: 'top', title: 'x', size: 'huge', source: 'logins', field: 'ip', evil: 1 }]);
    expect(widget).toMatchObject({ type: 'top', size: 'm', source: 'logins', field: 'ip' });
    expect(widget).not.toHaveProperty('evil');
  });

  it('неизвестный тип — ошибка', () => {
    expect(() => sanitizeWidgets([{ type: 'iframe' }])).toThrow(BadRequestException);
  });
});
