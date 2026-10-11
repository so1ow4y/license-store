import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, TrafficPriorityKind } from '@prisma/client';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

import { ENV, type Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { cidrContains, normalizeIp, parseCidr, type ParsedCidr } from './ip';

/**
 * Приоритет трафика: чтобы при перегрузке и DDoS падал сайт для анонимов,
 * а не панель администратора.
 *
 * Каждому запросу ДО разбора тела и маршрутизации (хук onRequest Fastify)
 * назначается вес 0–100 — максимум из:
 *   - доверенного адреса или подсети (traffic_priorities, kind IP);
 *   - пользователя из access-токена: явный вес (kind USER) или вес его роли;
 *   - «пропуска приоритета» (заголовок X-Priority-Pass) — подписанной метки,
 *     которую браузер доверенного пользователя получает после входа. Она
 *     нужна, чтобы администратор вошёл, пока токена у него ещё нет;
 *   - базового веса анонима или вошедшего пользователя.
 *
 * Дальше работает приоритетная очередь: одновременно в обработке не больше
 * maxConcurrent запросов (вдвое меньше, если цикл событий тормозит). Лишние
 * ждут в очереди, и освободившийся слот получает самый тяжёлый по весу.
 * Вес не ниже bypassWeight проходит мимо очереди. При переполнении очереди
 * выбивается самый лёгкий, при ожидании дольше queueTimeoutMs — 503.
 * В «режиме атаки» всё легче attackMinWeight получает 503 сразу.
 *
 * Работает в пределах процесса: у каждой реплики своя очередь. Первый рубеж
 * всё равно nginx (лимиты по адресу, доверенные адреса мимо них) и фаервол.
 */

export interface TrafficConfig {
  enabled: boolean;
  maxConcurrent: number;
  queueMax: number;
  queueTimeoutMs: number;
  bypassWeight: number;
  lagThresholdMs: number;
  anonymousWeight: number;
  authenticatedWeight: number;
  roleWeights: Record<string, number>;
  attackMode: boolean;
  attackMinWeight: number;
}

export const TRAFFIC_SETTING = 'security.traffic';

/** То же значение, что в сиде и миграции 20261005150000_security_center. */
export const TRAFFIC_DEFAULTS: TrafficConfig = {
  enabled: true,
  maxConcurrent: 128,
  queueMax: 1000,
  queueTimeoutMs: 8000,
  bypassWeight: 90,
  lagThresholdMs: 250,
  anonymousWeight: 10,
  authenticatedWeight: 30,
  roleWeights: { super_admin: 100, security_admin: 95, product_admin: 80, support: 70, reseller: 50 },
  attackMode: false,
  attackMinWeight: 50,
};

/**
 * Пути мимо очереди: пробы шлёт инфраструктура, краевые агенты должны
 * получать списки блокировок именно во время атаки, а у выдачи payload'а
 * своя очередь по байтам (PayloadAdmissionService) — потоковый ответ держал
 * бы слот секундами.
 */
const EXEMPT_PREFIXES = ['/health', '/api/v1/internal/edge/', '/api/v1/launcher/payload'];

export const PRIORITY_PASS_HEADER = 'x-priority-pass';
const PASS_TTL_MS = 30 * 24 * 3_600_000;
const RELOAD_MS = 15_000;
const SLOT_MS = 10_000;
const SLOTS = 60;
/** Сколько адресов помнить в «топе по запросам» за минуту: защита памяти при флуде. */
const TALKERS_MAX = 50_000;
/** Сколько пользователей с весом роли держать в памяти. */
const ROLE_USERS_MAX = 50_000;

type Outcome = 'admitted' | 'bypass' | 'queued' | 'shed' | 'timedOut';

interface Slot {
  at: number;
  admitted: number;
  bypass: number;
  queued: number;
  shed: number;
  timedOut: number;
  maxInFlight: number;
  maxQueue: number;
}

interface Waiter {
  weight: number;
  seq: number;
  settle: (admitted: boolean) => void;
}

@Injectable()
export class TrafficPriorityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrafficPriorityService.name);
  private config: TrafficConfig = TRAFFIC_DEFAULTS;
  private ipRules: { cidr: ParsedCidr; weight: number }[] = [];
  private userWeights = new Map<string, number>();
  private readonly jwt: JwtService;
  private readonly passKey: Buffer;

  private inFlight = 0;
  private queue: Waiter[] = [];
  private seq = 0;

  private readonly lag: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  private lagMs = 0;
  private slots: Slot[] = [];
  private talkers = new Map<string, number>();
  private previousTalkers = new Map<string, number>();
  private talkersSince = Date.now();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(ENV) env: Env,
  ) {
    this.jwt = new JwtService({ secret: env.JWT_SECRET, verifyOptions: { algorithms: ['HS256'], issuer: 'license-platform' } });
    // Отдельный ключ из секрета JWT: пропуск нельзя предъявить как токен и наоборот.
    this.passKey = createHmac('sha256', env.JWT_SECRET).update('priority-pass:v1').digest();
  }

  async onModuleInit(): Promise<void> {
    this.lag.enable();
    await this.reload();
    this.timers.push(
      setInterval(() => void this.reload(), RELOAD_MS),
      setInterval(() => this.sampleLag(), 1_000),
      setInterval(() => this.rollTalkers(), 60_000),
    );
    for (const timer of this.timers) timer.unref();
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.lag.disable();
    // Ждущие получают отказ, а не висят до таймаута на остановке процесса.
    for (const waiter of this.queue.splice(0)) waiter.settle(false);
  }

  // ------------------------------------------------------------- хук Fastify

  handle(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void {
    const url = req.url;
    if (EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix))) return done();

    const ip = normalizeIp(req.ip);
    this.countTalker(ip);
    const weight = this.weightOf(req, ip);
    const config = this.config;
    if (!config.enabled) return done();

    if (config.attackMode && weight < config.attackMinWeight) {
      this.record('shed');
      return this.reject(req, reply, 30);
    }
    if (weight >= config.bypassWeight) {
      this.record('bypass');
      this.track(reply);
      return done();
    }
    if (this.inFlight < this.limit() && this.queue.length === 0) {
      this.record('admitted');
      this.track(reply);
      return done();
    }

    if (this.queue.length >= config.queueMax) {
      const lightest = this.queue[this.queue.length - 1];
      if (!lightest || lightest.weight >= weight) {
        this.record('shed');
        return this.reject(req, reply, 5);
      }
      this.queue.pop();
      lightest.settle(false);
    }

    this.record('queued');
    let settled = false;
    const waiter: Waiter = {
      weight,
      seq: this.seq++,
      settle: (admitted) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (admitted) {
          this.track(reply);
          done();
        } else if (!reply.raw.destroyed) {
          this.record('timedOut');
          this.reject(req, reply, 5);
        }
      },
    };
    const timer = setTimeout(() => {
      this.dequeue(waiter);
      waiter.settle(false);
    }, config.queueTimeoutMs);
    // Клиент ушёл, не дождавшись, — место в очереди ему больше не нужно.
    reply.raw.once('close', () => {
      if (settled) return;
      this.dequeue(waiter);
      settled = true;
      clearTimeout(timer);
    });
    this.enqueue(waiter);
  }

  /** Вес запроса 0–100. Дёшево: адреса и веса в памяти, JWT — один HMAC. */
  weightOf(req: FastifyRequest, ip: string | null): number {
    let weight = this.config.anonymousWeight;
    if (ip) {
      for (const rule of this.ipRules) {
        if (rule.weight > weight && cidrContains(rule.cidr, ip)) weight = rule.weight;
      }
    }

    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{ sub: string }>(auth.slice(7));
        weight = Math.max(weight, this.userWeights.get(payload.sub) ?? this.config.authenticatedWeight);
      } catch {
        // Просроченный или чужой токен веса не добавляет.
      }
    }

    const pass = req.headers[PRIORITY_PASS_HEADER];
    if (typeof pass === 'string') {
      const userId = this.verifyPass(pass);
      const passWeight = userId ? this.userWeights.get(userId) : undefined;
      if (passWeight) weight = Math.max(weight, passWeight);
    }
    return Math.max(0, Math.min(100, weight));
  }

  // ------------------------------------------------------ пропуск приоритета

  /** Пропуск для браузера доверенного пользователя; null — особого веса у него нет. */
  issuePass(userId: string): { pass: string; weight: number; expiresAt: string } | null {
    const weight = this.userWeights.get(userId);
    if (!weight || weight <= this.config.authenticatedWeight) return null;
    const expires = Date.now() + PASS_TTL_MS;
    const body = Buffer.from(`${userId}.${expires}`).toString('base64url');
    return { pass: `${body}.${this.sign(body)}`, weight, expiresAt: new Date(expires).toISOString() };
  }

  private verifyPass(pass: string): string | null {
    const [body, signature] = pass.split('.');
    if (!body || !signature || pass.length > 256) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const [userId, expires] = Buffer.from(body, 'base64url').toString().split('.');
    if (!userId || !(Number(expires) > Date.now())) return null;
    return userId;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.passKey).update(body).digest('base64url');
  }

  // --------------------------------------------------------------- очередь

  private limit(): number {
    const { maxConcurrent, lagThresholdMs } = this.config;
    return this.lagMs > lagThresholdMs ? Math.max(4, Math.floor(maxConcurrent / 2)) : maxConcurrent;
  }

  /** Очередь упорядочена: тяжёлые впереди, при равном весе — кто раньше пришёл. */
  private enqueue(waiter: Waiter): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.weight < waiter.weight) i--;
    this.queue.splice(i, 0, waiter);
    const slot = this.touchSlot();
    slot.maxQueue = Math.max(slot.maxQueue, this.queue.length);
  }

  private dequeue(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter);
    if (index !== -1) this.queue.splice(index, 1);
  }

  private track(reply: FastifyReply): void {
    this.inFlight++;
    const slot = this.touchSlot();
    slot.maxInFlight = Math.max(slot.maxInFlight, this.inFlight);
    let released = false;
    reply.raw.once('close', () => {
      if (released) return;
      released = true;
      this.inFlight--;
      this.drain();
    });
  }

  private drain(): void {
    const limit = this.limit();
    while (this.inFlight < limit && this.queue.length > 0) {
      this.queue.shift()!.settle(true);
    }
  }

  private reject(req: FastifyRequest, reply: FastifyReply, retryAfter: number): void {
    void reply
      .code(503)
      .header('Retry-After', String(retryAfter))
      .header('Cache-Control', 'no-store')
      .send({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Сервис перегружен, повторите попытку',
        requestId: String(req.id),
        timestamp: new Date().toISOString(),
      });
  }

  // ------------------------------------------------------------ статистика

  private record(outcome: Outcome): void {
    this.touchSlot()[outcome]++;
  }

  private touchSlot(): Slot {
    const at = Math.floor(Date.now() / SLOT_MS) * SLOT_MS;
    let slot = this.slots[this.slots.length - 1];
    if (!slot || slot.at !== at) {
      slot = { at, admitted: 0, bypass: 0, queued: 0, shed: 0, timedOut: 0, maxInFlight: this.inFlight, maxQueue: this.queue.length };
      this.slots.push(slot);
      if (this.slots.length > SLOTS) this.slots.shift();
    }
    return slot;
  }

  private sampleLag(): void {
    this.lagMs = Math.round(this.lag.percentile(99) / 1e6);
    this.lag.reset();
    // Освободившийся по задержке лимит тоже должен разбирать очередь.
    this.drain();
  }

  private countTalker(ip: string | null): void {
    if (!ip) return;
    const count = this.talkers.get(ip);
    if (count !== undefined) this.talkers.set(ip, count + 1);
    else if (this.talkers.size < TALKERS_MAX) this.talkers.set(ip, 1);
  }

  private rollTalkers(): void {
    this.previousTalkers = this.talkers;
    this.talkers = new Map();
    this.talkersSince = Date.now();
  }

  /** Живая картина для страницы «Приоритет трафика». */
  snapshot() {
    const now = Math.floor(Date.now() / SLOT_MS) * SLOT_MS;
    const byAt = new Map(this.slots.map((s) => [s.at, s]));
    const slots = Array.from({ length: SLOTS }, (_, i) => {
      const at = now - (SLOTS - 1 - i) * SLOT_MS;
      return byAt.get(at) ?? { at, admitted: 0, bypass: 0, queued: 0, shed: 0, timedOut: 0, maxInFlight: 0, maxQueue: 0 };
    }).map((s) => ({ ...s, at: new Date(s.at).toISOString() }));

    // Топ за последнюю полную минуту плюс текущую: при флуде видно сразу.
    const merged = new Map(this.previousTalkers);
    for (const [ip, count] of this.talkers) merged.set(ip, (merged.get(ip) ?? 0) + count);
    const elapsed = Math.max(1, (Date.now() - this.talkersSince) / 1000) + (this.previousTalkers.size ? 60 : 0);
    const talkers = [...merged.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([ip, count]) => ({
        ip,
        count,
        perMinute: Math.round((count / elapsed) * 60),
        weight: this.ipWeight(ip),
      }));

    return {
      config: this.config,
      inFlight: this.inFlight,
      queued: this.queue.length,
      limit: this.limit(),
      lagMs: this.lagMs,
      slots,
      talkers,
      trustedIps: this.ipRules.length,
      weightedUsers: this.userWeights.size,
    };
  }

  private ipWeight(ip: string): number {
    let weight = this.config.anonymousWeight;
    for (const rule of this.ipRules) if (rule.weight > weight && cidrContains(rule.cidr, ip)) weight = rule.weight;
    return weight;
  }

  /** Вес конкретного адреса — для обогащения событий в журнале. */
  describeIp(ip: string): { weight: number; trusted: boolean } {
    const weight = this.ipWeight(ip);
    return { weight, trusted: weight > this.config.anonymousWeight };
  }

  /** Адрес в списке доверенных: такие не блокируют правила корреляции. */
  isTrustedIp(ip: string): boolean {
    return this.ipRules.some((rule) => cidrContains(rule.cidr, ip));
  }

  // -------------------------------------------------------------- загрузка

  /** Перечитать настройки и списки сразу — после правки в панели. */
  async reload(): Promise<void> {
    try {
      const stored = await this.settings.get<Partial<TrafficConfig>>(TRAFFIC_SETTING, TRAFFIC_DEFAULTS);
      const config = sanitizeTrafficConfig(stored);
      const entries = await this.prisma.trafficPriority.findMany({ select: { kind: true, value: true, weight: true } });

      const ipRules = entries
        .filter((e) => e.kind === TrafficPriorityKind.IP)
        .map((e) => ({ cidr: parseCidr(e.value), weight: e.weight }))
        .filter((e): e is { cidr: ParsedCidr; weight: number } => e.cidr !== null)
        .sort((a, b) => b.weight - a.weight);

      const userWeights = new Map<string, number>();
      const slugs = Object.entries(config.roleWeights)
        .filter(([, w]) => w > config.authenticatedWeight)
        .map(([slug]) => slug);
      if (slugs.length > 0) {
        const rows = await this.prisma.$queryRaw<{ userId: string; slug: string }[]>(Prisma.sql`
          SELECT ur.user_id AS "userId", r.slug
          FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE r.slug = ANY(${slugs}::text[])
          LIMIT ${ROLE_USERS_MAX}`);
        for (const row of rows) {
          const w = config.roleWeights[row.slug] ?? 0;
          if (w > (userWeights.get(row.userId) ?? 0)) userWeights.set(row.userId, w);
        }
      }
      for (const entry of entries) {
        if (entry.kind === TrafficPriorityKind.USER && entry.weight > (userWeights.get(entry.value) ?? 0)) {
          userWeights.set(entry.value, entry.weight);
        }
      }

      this.config = config;
      this.ipRules = ipRules;
      this.userWeights = userWeights;
    } catch (error) {
      // База недоступна во время атаки — работаем на последних известных весах.
      this.logger.warn(`веса трафика не обновлены: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Настройка из БД в рабочий вид: недостающее — из умолчаний, числа — в границы. */
export function sanitizeTrafficConfig(raw: Partial<TrafficConfig> | null | undefined): TrafficConfig {
  const d = TRAFFIC_DEFAULTS;
  const r = raw ?? {};
  const roleWeights: Record<string, number> = {};
  for (const [slug, w] of Object.entries(r.roleWeights ?? d.roleWeights)) {
    if (/^[a-z0-9_.-]{1,64}$/.test(slug)) roleWeights[slug] = clampInt(w, 0, 100, 0);
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    maxConcurrent: clampInt(r.maxConcurrent, 4, 10_000, d.maxConcurrent),
    queueMax: clampInt(r.queueMax, 0, 100_000, d.queueMax),
    queueTimeoutMs: clampInt(r.queueTimeoutMs, 100, 60_000, d.queueTimeoutMs),
    bypassWeight: clampInt(r.bypassWeight, 1, 101, d.bypassWeight),
    lagThresholdMs: clampInt(r.lagThresholdMs, 10, 10_000, d.lagThresholdMs),
    anonymousWeight: clampInt(r.anonymousWeight, 0, 100, d.anonymousWeight),
    authenticatedWeight: clampInt(r.authenticatedWeight, 0, 100, d.authenticatedWeight),
    roleWeights,
    attackMode: typeof r.attackMode === 'boolean' ? r.attackMode : d.attackMode,
    attackMinWeight: clampInt(r.attackMinWeight, 1, 100, d.attackMinWeight),
  };
}
