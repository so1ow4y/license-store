import { Injectable } from '@nestjs/common';
import { IpBlockLevel, TrafficPriorityKind } from '@prisma/client';

import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { coversWeb, IpBlockService, type EdgeBlock } from '@common/security/ip-block.service';
import { parseCidr } from '@common/security/ip';

/**
 * Списки для краевых агентов — то, что делает блокировку «ниже» приложения.
 *
 *   nginx (L7 на краю): geo-карта заблокированных адресов → 403 до прокси в
 *     API; geo-карта доверенных → мимо limit_req. Агент — фоновый цикл в
 *     контейнере nginx (docker/nginx/entrypoint.d/30-lp-edge-sync.sh).
 *   фаервол (L3/L4): таблица nftables `inet lp_guard`, хук prerouting с
 *     приоритетом raw — пакет отбрасывается до conntrack и DNAT докера, то
 *     есть до TCP-рукопожатия. Агент — контейнер с network_mode: host
 *     (docker/firewall, профиль compose firewall).
 *
 * Агенты забирают готовый текст и применяют его, только если он изменился.
 * Тексты детерминированы (сортировка), чтобы одинаковый набор блоков давал
 * побайтно одинаковый файл и nginx не перезагружался впустую.
 */

export type EdgeAgent = 'nginx' | 'firewall';

const AGENT_KEY = 'edge:agent:';
/** Через сколько агент без обращений считается пропавшим. */
const AGENT_STALE_SEC = 120;

@Injectable()
export class EdgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly blocks: IpBlockService,
  ) {}

  /** geo-карта блокировок для nginx: EDGE и FIREWALL, кроме блоков только по не-веб портам. */
  async nginxBlocklist(): Promise<string> {
    const blocks = (await this.blocks.activeForEdge()).filter((b) => coversWeb(b.ports));
    return this.geo('Заблокированные адреса: nginx отвечает 403, в API запрос не попадает.', blocks.map((b) => b.cidr));
  }

  /** geo-карта доверенных адресов для nginx: их запросы не попадают под limit_req. */
  async nginxPriority(): Promise<string> {
    const rows = await this.prisma.trafficPriority.findMany({
      where: { kind: TrafficPriorityKind.IP },
      select: { value: true },
      orderBy: { value: 'asc' },
    });
    return this.geo('Доверенные адреса: мимо ограничений скорости.', rows.map((r) => r.value));
  }

  /**
   * Сценарий nftables целиком: таблица пересоздаётся одной транзакцией
   * `nft -f`, поэтому промежуточного состояния «правил нет» не бывает.
   */
  async nftables(): Promise<string> {
    const blocks = (await this.blocks.activeForEdge()).filter((b) => b.level === IpBlockLevel.FIREWALL);
    const trusted = await this.prisma.trafficPriority.findMany({
      where: { kind: TrafficPriorityKind.IP },
      select: { value: true },
      orderBy: { value: 'asc' },
    });
    return renderNftables(blocks, trusted.map((t) => t.value));
  }

  /** Отметка агента: когда приходил и с какого адреса — для страницы блокировок. */
  async touch(agent: EdgeAgent, ip: string | undefined, bytes: number): Promise<void> {
    await this.redis.client.set(
      `${AGENT_KEY}${agent}`,
      JSON.stringify({ at: new Date().toISOString(), ip: ip ?? null, bytes }),
      'EX',
      24 * 3600,
    );
  }

  async status(configured: boolean) {
    const agents = await Promise.all(
      (['nginx', 'firewall'] as const).map(async (agent) => {
        const raw = await this.redis.client.get(`${AGENT_KEY}${agent}`);
        const seen = raw ? (JSON.parse(raw) as { at: string; ip: string | null }) : null;
        const online = seen ? Date.now() - new Date(seen.at).getTime() < AGENT_STALE_SEC * 1000 : false;
        return { agent, online, lastSeenAt: seen?.at ?? null, ip: seen?.ip ?? null };
      }),
    );
    return { configured, agents };
  }

  private geo(title: string, cidrs: string[]): string {
    const lines = [...new Set(cidrs)].sort().map((cidr) => `${cidr} 1;`);
    return [`# ${title}`, '# Сгенерировано API (edge.service.ts), правка руками будет перезаписана.', ...lines, ''].join('\n');
  }
}

/** Текст nftables для набора блоков; вынесен для тестов. */
export function renderNftables(blocks: EdgeBlock[], trusted: string[]): string {
  const v4 = (cidr: string) => !cidr.includes(':');
  const whole = blocks.filter((b) => b.ports.length === 0).map((b) => b.cidr);
  const ported = blocks.filter((b) => b.ports.length > 0);
  const valid = (cidr: string) => parseCidr(cidr) !== null;

  const set = (name: string, type: string, cidrs: string[]) => {
    const elements = [...new Set(cidrs.filter(valid))].sort();
    return [
      `  set ${name} {`,
      `    type ${type}; flags interval; auto-merge;`,
      ...(elements.length ? [`    elements = { ${elements.join(', ')} }`] : []),
      '  }',
    ];
  };

  const portRules = ported
    .filter((b) => valid(b.cidr))
    .flatMap((b) => {
      const family = v4(b.cidr) ? 'ip' : 'ip6';
      const ports = b.ports.join(', ');
      return [
        `    ${family} saddr ${b.cidr} tcp dport { ${ports} } counter drop`,
        `    ${family} saddr ${b.cidr} udp dport { ${ports} } counter drop`,
      ];
    });

  return [
    '# Сгенерировано API (edge.service.ts). Применяет агент фаервола: nft -f.',
    '# Таблица своя: правила хоста и докера не трогаются.',
    'table inet lp_guard',
    'delete table inet lp_guard',
    'table inet lp_guard {',
    ...set('trusted4', 'ipv4_addr', trusted.filter(v4)),
    ...set('trusted6', 'ipv6_addr', trusted.filter((c) => !v4(c))),
    ...set('blocked4', 'ipv4_addr', whole.filter(v4)),
    ...set('blocked6', 'ipv6_addr', whole.filter((c) => !v4(c))),
    '  chain prerouting {',
    // raw (-300): раньше conntrack и DNAT — опубликованные порты докера тоже под защитой.
    '    type filter hook prerouting priority -300; policy accept;',
    '    iif "lo" accept',
    '    ip saddr @trusted4 accept',
    '    ip6 saddr @trusted6 accept',
    '    ip saddr @blocked4 counter drop',
    '    ip6 saddr @blocked6 counter drop',
    ...portRules,
    '  }',
    '}',
    '',
  ].join('\n');
}
