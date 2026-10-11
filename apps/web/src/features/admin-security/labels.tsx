import { Flame, Network, Server } from 'lucide-react'
import { useT, type TFunction } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { BlockLevel, HitStatus, Severity } from './center-api'

/**
 * Общие метки центра безопасности: критичность, уровень блокировки,
 * статус сработки, итог действия правила, разбор User-Agent.
 */

const SEVERITY_TONE: Record<Severity, string> = {
  LOW: 'border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300',
  MEDIUM: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  HIGH: 'border-transparent bg-orange-500/20 text-orange-700 dark:text-orange-300',
  CRITICAL: 'border-transparent bg-red-500/20 text-red-700 dark:text-red-300',
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const t = useT()
  return <Badge className={cn(SEVERITY_TONE[severity], className)}>{t(`sec.severity.${severity}`)}</Badge>
}

const LEVEL_ICON = { APP: Server, EDGE: Network, FIREWALL: Flame } as const

const LEVEL_TONE: Record<BlockLevel, string> = {
  APP: 'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300',
  EDGE: 'border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300',
  FIREWALL: 'border-transparent bg-red-500/15 text-red-700 dark:text-red-300',
}

/** Уровень блокировки с номером уровня OSI и портами фаервола. */
export function LevelBadge({ level, ports = [] }: { level: BlockLevel; ports?: number[] }) {
  const t = useT()
  const Icon = LEVEL_ICON[level]
  return (
    <Badge className={LEVEL_TONE[level]}>
      <Icon />
      {t(`sec.level.${level}`)}
      {ports.length > 0 && <span className='font-mono'>:{ports.join(',')}</span>}
    </Badge>
  )
}

const STATUS_TONE: Record<HitStatus, string> = {
  NEW: 'border-transparent bg-primary/15 text-primary',
  ACKNOWLEDGED: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
  RESOLVED: 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  FALSE_POSITIVE: 'border-transparent bg-muted text-muted-foreground',
}

export function HitStatusBadge({ status }: { status: HitStatus }) {
  const t = useT()
  return <Badge className={STATUS_TONE[status]}>{t(`sec.hitStatus.${status}`)}</Badge>
}

const OUTCOMES = ['alerted', 'blocked', 'skipped_protected', 'skipped_existing'] as const

/** Итог действия правила словами; у ошибки — её код. */
export function outcomeLabel(t: TFunction, outcome: string): string {
  if ((OUTCOMES as readonly string[]).includes(outcome)) return t(`sec.outcome.${outcome as (typeof OUTCOMES)[number]}`)
  if (outcome.startsWith('failed:')) return t('sec.outcome.failed', { code: outcome.slice(7) })
  return outcome
}

// ------------------------------------------------------------ User-Agent

export type ParsedAgent = { client: string; os: string | null; device: 'desktop' | 'mobile' | 'bot' | 'tool' | 'launcher' }

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
  [/OPR\/([\d.]+)/, 'Opera'],
  [/YaBrowser\/([\d.]+)/, 'Yandex'],
  [/Firefox\/([\d.]+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/([\d.]+)/, 'Chrome'],
  [/Version\/([\d.]+).*Safari/, 'Safari'],
]

const SYSTEMS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/Windows NT 10\.0/, () => 'Windows 10/11'],
  [/Windows NT ([\d.]+)/, (m) => `Windows NT ${m[1]}`],
  [/Android ([\d.]+)/, (m) => `Android ${m[1]}`],
  [/iPhone OS ([\d_]+)/, (m) => `iOS ${m[1]!.replace(/_/g, '.')}`],
  [/Mac OS X ([\d_]+)/, (m) => `macOS ${m[1]!.replace(/_/g, '.')}`],
  [/Linux/, () => 'Linux'],
]

/**
 * Что за клиент: браузер с версией, система, тип устройства. Без библиотеки —
 * нужно ровно столько, чтобы аналитик с первого взгляда отличил живого
 * человека от curl, бота или загрузчика.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedAgent | null {
  if (!ua) return null
  if (/bot|crawler|spider|slurp/i.test(ua)) return { client: ua.split(/[\s/;]/)[0] ?? 'bot', os: null, device: 'bot' }
  const tool = ua.match(/^(curl|wget|python-requests|python-urllib|Go-http-client|okhttp|PostmanRuntime|axios|node-fetch|undici)[/ ]?([\d.]*)/i)
  if (tool) return { client: `${tool[1]}${tool[2] ? ` ${tool[2]}` : ''}`, os: null, device: 'tool' }
  if (/launcher|WinHTTP/i.test(ua) && !/Mozilla/.test(ua)) return { client: ua.slice(0, 60), os: 'Windows', device: 'launcher' }

  const browser = BROWSERS.map(([re, name]) => {
    const m = ua.match(re)
    return m ? `${name} ${m[1]!.split('.')[0]}` : null
  }).find(Boolean)
  const system = SYSTEMS.map(([re, label]) => {
    const m = ua.match(re)
    return m ? label(m) : null
  }).find(Boolean)
  return {
    client: browser ?? ua.slice(0, 40),
    os: system ?? null,
    device: /Mobile|Android|iPhone|iPad/.test(ua) ? 'mobile' : 'desktop',
  }
}

// ------------------------------------------------------------ правила словами

/** Окно правила: «10 мин», «2 ч», «1 дн». */
export function windowLabel(t: TFunction, minutes: number): string {
  if (minutes % 1440 === 0) return t('timeRange.unit.d', { n: minutes / 1440 })
  if (minutes % 60 === 0) return t('timeRange.unit.h', { n: minutes / 60 })
  return t('timeRange.unit.m', { n: minutes })
}

type RuleShape = {
  threshold: number
  windowMinutes: number
  groupBy: string
  distinctField: string | null
  action: 'ALERT' | 'BLOCK_IP' | 'BLOCK_USER'
  blockLevel: BlockLevel
  blockPorts: number[]
  blockHours: number | null
}

/** «≥ 20 событий за 10 мин с одного ip» или «≥ 5 разных user за 15 мин с одного ip». */
export function conditionText(t: TFunction, rule: Pick<RuleShape, 'threshold' | 'windowMinutes' | 'groupBy' | 'distinctField'>): string {
  const window = windowLabel(t, rule.windowMinutes)
  return rule.distinctField
    ? t('sec.cond.distinct', { n: rule.threshold, distinct: rule.distinctField, window, field: rule.groupBy })
    : t('sec.cond.events', { n: rule.threshold, window, field: rule.groupBy })
}

/** «Блок на nginx, 24 ч», «Блок на фаерволе :22,443, бессрочно», «Только сработка». */
export function actionText(t: TFunction, rule: Pick<RuleShape, 'action' | 'blockLevel' | 'blockPorts' | 'blockHours'>): string {
  if (rule.action !== 'BLOCK_IP') return t(`sec.action.${rule.action}`)
  const ports = rule.blockLevel === 'FIREWALL' && rule.blockPorts.length ? ` :${rule.blockPorts.join(',')}` : ''
  const duration = rule.blockHours ? t('timeRange.unit.h', { n: rule.blockHours }) : t('sec.duration.forever')
  return t('sec.actionText.blockIp', { level: t(`sec.level.${rule.blockLevel}`), ports, duration })
}