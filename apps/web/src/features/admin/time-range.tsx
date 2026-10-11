import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { CalendarClock, ChevronLeft, ChevronRight, RefreshCw, ZoomOut } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { formatShortDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Период для журналов в духе SIEM/WAF: быстрые пресеты, «последние N
 * минут/часов/дней», абсолютный интервал «с — по» с точностью до минуты,
 * сдвиг окна назад/вперёд, отдаление и автообновление.
 *
 * Относительный период («последние 24 часа») хранится как правило, а не как
 * готовые даты: при обновлении окно сдвигается к «сейчас». Готовые границы
 * считаются в момент выбора или обновления — иначе ключ запроса менялся бы на
 * каждом рендере.
 */

export type TimeUnit = 'm' | 'h' | 'd'

export type TimeRange =
  | { kind: 'relative'; amount: number; unit: TimeUnit }
  | { kind: 'today' }
  /** `to` не задан — до текущего момента. */
  | { kind: 'absolute'; from: string; to?: string }
  | { kind: 'all' }

export type ResolvedRange = { from?: string; to?: string }

const UNIT_MS: Record<TimeUnit, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }
const UNITS: TimeUnit[] = ['m', 'h', 'd']

const QUICK = ['15m', '1h', '4h', '24h', '7d', '30d', '90d', 'today', 'yesterday', 'all'] as const
type QuickKey = (typeof QUICK)[number]

const QUICK_RELATIVE: Partial<Record<QuickKey, { amount: number; unit: TimeUnit }>> = {
  '15m': { amount: 15, unit: 'm' },
  '1h': { amount: 1, unit: 'h' },
  '4h': { amount: 4, unit: 'h' },
  '24h': { amount: 24, unit: 'h' },
  '7d': { amount: 7, unit: 'd' },
  '30d': { amount: 30, unit: 'd' },
  '90d': { amount: 90, unit: 'd' },
}

/** Интервалы автообновления, мс; 0 — выключено. */
const AUTO_REFRESH = [0, 10_000, 30_000, 60_000, 300_000] as const
const AUTO_LABEL: Record<(typeof AUTO_REFRESH)[number], 'off' | '10s' | '30s' | '1m' | '5m'> = {
  0: 'off',
  10_000: '10s',
  30_000: '30s',
  60_000: '1m',
  300_000: '5m',
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function quickRange(key: QuickKey): TimeRange {
  const relative = QUICK_RELATIVE[key]
  if (relative) return { kind: 'relative', ...relative }
  if (key === 'today') return { kind: 'today' }
  if (key === 'yesterday') {
    const today = startOfDay(Date.now())
    return { kind: 'absolute', from: new Date(startOfDay(today - 1)).toISOString(), to: new Date(today - 1).toISOString() }
  }
  return { kind: 'all' }
}

function quickKeyOf(range: TimeRange): QuickKey | null {
  if (range.kind === 'all') return 'all'
  if (range.kind === 'today') return 'today'
  if (range.kind !== 'relative') return null
  const found = Object.entries(QUICK_RELATIVE).find(([, r]) => r.amount === range.amount && r.unit === range.unit)
  return (found?.[0] as QuickKey | undefined) ?? null
}

export function resolveTimeRange(range: TimeRange): ResolvedRange {
  const now = Date.now()
  switch (range.kind) {
    case 'relative':
      return { from: new Date(now - range.amount * UNIT_MS[range.unit]).toISOString() }
    case 'today':
      return { from: new Date(startOfDay(now)).toISOString() }
    case 'absolute':
      return { from: range.from, to: range.to }
    case 'all':
      return {}
  }
}

/** Границы окна в мс (конец — «сейчас», если не задан); у «всего времени» окна нет. */
function windowOf(range: TimeRange): { from: number; to: number } | null {
  const resolved = resolveTimeRange(range)
  if (!resolved.from) return null
  return { from: new Date(resolved.from).getTime(), to: resolved.to ? new Date(resolved.to).getTime() : Date.now() }
}

/** Абсолютный период из мс; конец в будущем срезается до «сейчас». */
function absolute(from: number, to: number): TimeRange {
  const now = Date.now()
  return {
    kind: 'absolute',
    from: new Date(Math.min(from, now - 60_000)).toISOString(),
    to: to >= now ? undefined : new Date(to).toISOString(),
  }
}

/** Выделение на гистограмме и клик по столбику — в период. */
export function zoomRange(from: number, to: number): TimeRange {
  return absolute(from, to)
}

/**
 * Состояние периода для страницы: правило, готовые границы и автообновление.
 * `onRefresh` вызывается, когда границы не сдвигаются («всё время», абсолютный
 * период, «сегодня»): тогда обновлять нужно сами запросы.
 */
export function useTimeRange(initial: TimeRange, onRefresh?: () => void) {
  const [range, setRangeState] = useState(initial)
  const [resolved, setResolved] = useState(() => resolveTimeRange(initial))
  const [auto, setAuto] = useState<number>(0)
  const refreshRef = useRef(onRefresh)
  useEffect(() => {
    refreshRef.current = onRefresh
  })

  const setRange = useCallback((next: TimeRange) => {
    setRangeState(next)
    setResolved(resolveTimeRange(next))
  }, [])

  const refresh = useCallback(() => {
    if (range.kind === 'relative') setResolved(resolveTimeRange(range))
    else refreshRef.current?.()
  }, [range])

  useEffect(() => {
    if (!auto) return
    const id = window.setInterval(refresh, auto)
    return () => window.clearInterval(id)
  }, [auto, refresh])

  return { range, resolved, setRange, refresh, auto, setAuto }
}

export type TimeRangeState = ReturnType<typeof useTimeRange>

/** Значение для `<input type="datetime-local">` в часовом поясе браузера. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : format(date, "yyyy-MM-dd'T'HH:mm")
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function useTimeRangeLabel() {
  const t = useT()
  return (range: TimeRange): string => {
    const quick = quickKeyOf(range)
    if (quick) return t(`timeRange.quick.${quick}`)
    if (range.kind === 'relative') return t('timeRange.last', { value: t(`timeRange.unit.${range.unit}`, { n: range.amount }) })
    if (range.kind === 'absolute') {
      const year = new Date(range.from).getFullYear() !== new Date().getFullYear()
      return `${formatShortDateTime(range.from, { year })} — ${range.to ? formatShortDateTime(range.to, { year }) : t('timeRange.now')}`
    }
    return ''
  }
}

/** Шаг гистограммы словами: «5 мин», «1 ч», «7 дн». */
export function useStepLabel() {
  const t = useT()
  return (ms: number): string => {
    if (ms % UNIT_MS.d === 0) return t('timeRange.unit.d', { n: ms / UNIT_MS.d })
    if (ms % UNIT_MS.h === 0) return t('timeRange.unit.h', { n: ms / UNIT_MS.h })
    return t('timeRange.unit.m', { n: Math.round(ms / UNIT_MS.m) })
  }
}

/**
 * Выбор периода: кнопка с текущим периодом открывает панель с пресетами
 * слева и своими границами справа; рядом — сдвиг окна, отдаление и
 * обновление.
 */
export function TimeRangePicker({ state, onChange }: { state: TimeRangeState; onChange?: (range: TimeRange) => void }) {
  const t = useT()
  const label = useTimeRangeLabel()
  const [open, setOpen] = useState(false)
  const { range } = state

  const change = (next: TimeRange) => {
    state.setRange(next)
    onChange?.(next)
  }

  const span = windowOf(range)
  const length = span ? span.to - span.from : 0
  const atNow = range.kind !== 'absolute' || !range.to

  return (
    <div className='flex items-center gap-1'>
      <Button
        type='button'
        variant='outline'
        size='icon'
        disabled={!span}
        title={t('timeRange.earlier')}
        aria-label={t('timeRange.earlier')}
        onClick={() => span && change(absolute(span.from - length, span.from))}
      >
        <ChevronLeft className='size-4' />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type='button' variant='outline' className='min-w-48 justify-start font-normal'>
            <CalendarClock className='size-4 text-muted-foreground' />
            <span className='truncate'>{label(range)}</span>
            {state.auto > 0 && (
              <span className='ms-auto rounded bg-primary/10 px-1.5 text-[11px] font-medium text-primary'>
                {t(`timeRange.auto.${AUTO_LABEL[state.auto as (typeof AUTO_REFRESH)[number]]}`)}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align='end' className='w-[min(36rem,calc(100vw-2rem))] p-0'>
          <RangePanel
            range={range}
            auto={state.auto}
            onAuto={state.setAuto}
            onPick={(next) => {
              change(next)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        type='button'
        variant='outline'
        size='icon'
        disabled={!span || atNow}
        title={t('timeRange.later')}
        aria-label={t('timeRange.later')}
        onClick={() => span && change(absolute(span.to, span.to + length))}
      >
        <ChevronRight className='size-4' />
      </Button>
      <Button
        type='button'
        variant='outline'
        size='icon'
        disabled={!span}
        title={t('timeRange.zoomOut')}
        aria-label={t('timeRange.zoomOut')}
        onClick={() => span && change(absolute(span.from - length / 2, span.to + length / 2))}
      >
        <ZoomOut className='size-4' />
      </Button>
      <Button type='button' variant='outline' size='icon' title={t('timeRange.refresh')} aria-label={t('timeRange.refresh')} onClick={state.refresh}>
        <RefreshCw className='size-4' />
      </Button>
    </div>
  )
}

function RangePanel({
  range,
  auto,
  onAuto,
  onPick,
}: {
  range: TimeRange
  auto: number
  onAuto: (ms: number) => void
  onPick: (range: TimeRange) => void
}) {
  const t = useT()
  const active = quickKeyOf(range)
  const [amount, setAmount] = useState(range.kind === 'relative' ? String(range.amount) : '30')
  const [unit, setUnit] = useState<TimeUnit>(range.kind === 'relative' ? range.unit : 'm')
  const resolved = resolveTimeRange(range)
  const [from, setFrom] = useState(() => toLocalInput(resolved.from))
  const [to, setTo] = useState(() => toLocalInput(resolved.to))
  const [error, setError] = useState(false)

  function pickLast(event: FormEvent) {
    event.preventDefault()
    const n = Math.floor(Number(amount))
    if (!Number.isFinite(n) || n < 1) return
    onPick({ kind: 'relative', amount: Math.min(n, unit === 'm' ? 60 * 24 * 365 : unit === 'h' ? 24 * 365 : 3650), unit })
  }

  function pickAbsolute(event: FormEvent) {
    event.preventDefault()
    const fromIso = fromLocalInput(from)
    const toIso = fromLocalInput(to)
    if (!fromIso || (toIso && new Date(toIso) <= new Date(fromIso))) {
      setError(true)
      return
    }
    onPick({ kind: 'absolute', from: fromIso, to: toIso })
  }

  return (
    <div className='grid sm:grid-cols-[11rem_1fr]'>
      <div className='border-b p-2 sm:border-e sm:border-b-0'>
        <p className='px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{t('timeRange.quickTitle')}</p>
        <ul className='grid grid-cols-2 gap-0.5 sm:grid-cols-1'>
          {QUICK.map((key) => (
            <li key={key}>
              <button
                type='button'
                onClick={() => onPick(quickRange(key))}
                className={cn(
                  'w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent',
                  active === key && 'bg-primary/10 font-medium text-primary'
                )}
              >
                {t(`timeRange.quick.${key}`)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className='space-y-4 p-3'>
        <form onSubmit={pickLast} className='space-y-1.5'>
          <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{t('timeRange.lastTitle')}</p>
          <div className='flex flex-wrap items-center gap-1.5'>
            <Input
              type='number'
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className='h-8 w-20'
              aria-label={t('timeRange.lastTitle')}
            />
            <div className='flex rounded-md border p-0.5'>
              {UNITS.map((u) => (
                <button
                  key={u}
                  type='button'
                  onClick={() => setUnit(u)}
                  className={cn('rounded px-2 py-0.5 text-xs', unit === u ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                >
                  {t(`timeRange.unitName.${u}`)}
                </button>
              ))}
            </div>
            <Button type='submit' size='sm' variant='secondary'>
              {t('timeRange.apply')}
            </Button>
          </div>
        </form>

        <form onSubmit={pickAbsolute} className='space-y-1.5'>
          <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{t('timeRange.absoluteTitle')}</p>
          <div className='grid gap-1.5 sm:grid-cols-2'>
            <label className='space-y-0.5 text-xs text-muted-foreground'>
              <span>{t('timeRange.from')}</span>
              <Input
                type='datetime-local'
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setError(false)
                }}
                className='h-8 text-sm text-foreground'
                required
              />
            </label>
            <label className='space-y-0.5 text-xs text-muted-foreground'>
              <span>{t('timeRange.to')}</span>
              <Input
                type='datetime-local'
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setTo(e.target.value)
                  setError(false)
                }}
                className='h-8 text-sm text-foreground'
              />
            </label>
          </div>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
              {error ? t('timeRange.invalid') : t('timeRange.toHint')}
            </span>
            <Button type='submit' size='sm' variant='secondary'>
              {t('timeRange.apply')}
            </Button>
          </div>
        </form>

        <div className='space-y-1.5'>
          <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{t('timeRange.autoTitle')}</p>
          <div className='flex flex-wrap gap-1'>
            {AUTO_REFRESH.map((ms) => (
              <button
                key={ms}
                type='button'
                onClick={() => onAuto(ms)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs',
                  auto === ms ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                )}
              >
                {t(`timeRange.auto.${AUTO_LABEL[ms]}`)}
              </button>
            ))}
          </div>
        </div>

        <p className='text-xs text-muted-foreground'>{t('timeRange.brushHint')}</p>
      </div>
    </div>
  )
}
