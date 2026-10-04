import { isIP } from 'node:net';

/**
 * Адреса и подсети: нормализация того, что пришло от прокси, и разбор CIDR,
 * который вводит администратор безопасности.
 */

export type IpFamily = 'ipv4' | 'ipv6';

export interface ParsedCidr {
  /** Каноническая запись сети: 203.0.113.0/24, 2001:db8::/48. */
  cidr: string;
  network: string;
  prefix: number;
  family: IpFamily;
}

/** IPv4, завёрнутый в IPv6 (::ffff:1.2.3.4), разворачивается — иначе блок не сработает. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) value = value.slice(7);
  return isIP(value) ? value : null;
}

export function ipFamily(ip: string): IpFamily {
  return isIP(ip) === 4 ? 'ipv4' : 'ipv6';
}

/** Адрес или подсеть в каноническую CIDR; null — если это не адрес. */
export function parseCidr(input: string): ParsedCidr | null {
  const [addressRaw, prefixRaw, extra] = input.trim().split('/');
  if (extra !== undefined) return null;
  const address = normalizeIp(addressRaw);
  if (!address) return null;

  const family = ipFamily(address);
  const bits = family === 'ipv4' ? 32 : 128;
  const prefix = prefixRaw === undefined || prefixRaw === '' ? bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;

  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  const value = toBigInt(address, family) & mask;
  const network = fromBigInt(value, family);
  return { cidr: `${network}/${prefix}`, network, prefix, family };
}

/** Входит ли адрес в подсеть. */
export function cidrContains(cidr: ParsedCidr, ip: string): boolean {
  const address = normalizeIp(ip);
  if (!address || ipFamily(address) !== cidr.family) return false;
  return parseCidr(`${address}/${cidr.prefix}`)?.network === cidr.network;
}

function toBigInt(address: string, family: IpFamily): bigint {
  if (family === 'ipv4') {
    return address.split('.').reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
  }
  // Развернуть «::» до восьми групп; хвост в виде IPv4 переводится в две группы.
  let text = address;
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4) {
    const n = toBigInt(v4, 'ipv4');
    text = text.replace(v4, `${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`);
  }
  const [head, tail] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? headParts
      : [...headParts, ...Array<string>(8 - headParts.length - tailParts.length).fill('0'), ...tailParts];
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
}

function fromBigInt(value: bigint, family: IpFamily): string {
  if (family === 'ipv4') {
    return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 0xffn).toString()).join('.');
  }
  const groups = Array.from({ length: 8 }, (_, i) => ((value >> BigInt((7 - i) * 16)) & 0xffffn).toString(16));
  // Самая длинная серия нулевых групп сворачивается в «::» (RFC 5952).
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > bestLen && j - i > 1) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (bestStart === -1) return groups.join(':');
  const left = groups.slice(0, bestStart).join(':');
  const right = groups.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}
