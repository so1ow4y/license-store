import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { useT } from '@/lib/i18n'
import { formatAxis, formatShortDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { useStepLabel, type ResolvedRange } from '@/features/admin/time-range'

/**
 * Гистограмма событий во времени, как в SIEM: пустые шаги дорисованы нулями,
 * чтобы ось была честной; под курсором — время и число событий; протяжка
 * мышью выделяет участок и приближает его, клик по столбику — один шаг.
 */

export type HistogramBucket = { bucket: string; count: number; failed?: number }

type Bar = { time: number; count: number; failed: number }

/** Начало сетки сервера (`date_bin` от 2000-01-01 UTC). */
const ORIGIN = Date.UTC(2000, 0, 1)
/** Дальше столбики не дорисовываются — слишком мелко для экрана. */
const MAX_BARS = 400

function align(ms: number, step: number): number {
  return ORIGIN + Math.floor((ms - ORIGIN) / step) * step
}

function fillBars(buckets: HistogramBucket[], step: number, range: ResolvedRange): Bar[] {
  const bars = buckets.map((b) => ({ time: new Date(b.bucket).getTime(), count: b.count, failed: b.failed ?? 0 }))
  if (!step || (bars.length === 0 && !range.from)) return bars
  const first = range.from ? align(new Date(range.from).getTime(), step) : bars[0].time
  const lastData = bars.length ? bars[bars.length - 1].time : first
  const last = Math.max(align(range.to ? new Date(range.to).getTime() : Date.now(), step), lastData)
  if ((last - first) / step > MAX_BARS) return bars
  const byTime = new Map(bars.map((b) => [b.time, b]))
  const filled: Bar[] = []
  for (let time = first; time <= last; time += step) filled.push(byTime.get(time) ?? { time, count: 0, failed: 0 })
  return filled
}

export function TimeHistogram({
  buckets,
  intervalMs,
  range,
  loading,
  withFailures = false,
  onZoom,
  className,
}: {
  buckets?: HistogramBucket[]
  intervalMs?: number
  range: ResolvedRange
  loading?: boolean
  withFailures?: boolean
  onZoom?: (from: number, to: number) => void
  className?: string
}) {
  const t = useT()
  const stepLabel = useStepLabel()
  const step = intervalMs ?? 0
  const bars = useMemo(() => fillBars(buckets ?? [], step, range), [buckets, step, range])
  const area = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null)

  if (loading && !buckets) return <Skeleton className={cn('h-32 w-full', className)} />

  const max = Math.max(1, ...bars.map((b) => b.count))
  const span = bars.length ? bars[bars.length - 1].time + step - bars[0].time : 0

  function indexAt(event: PointerEvent): number {
    const rect = area.current!.getBoundingClientRect()
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width - 1)
    return Math.min(bars.length - 1, Math.floor((x / rect.width) * bars.length))
  }

  function finish() {
    if (!drag || !onZoom) return setDrag(null)
    const lo = Math.min(drag.start, drag.end)
    const hi = Math.max(drag.start, drag.end)
    setDrag(null)
    onZoom(bars[lo].time, bars[hi].time + step)
  }

  const selected = drag ? [Math.min(drag.start, drag.end), Math.max(drag.start, drag.end)] : null
  const focus = hover !== null ? bars[hover] : null
  const ticks = bars.length > 1 ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (bars.length - 1))) : []

  return (
    <div className={cn('rounded-md border p-3', className)}>
      <div className='mb-2 flex min-h-4 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
        <span>
          {selected
            ? t('siem.histogram.selection', {
                from: formatShortDateTime(bars[selected[0]].time),
                to: formatShortDateTime(bars[selected[1]].time + step),
              })
            : focus
              ? t('siem.histogram.hover', {
                  time: `${formatShortDateTime(focus.time)} — ${formatShortDateTime(focus.time + step)}`,
                  n: focus.count,
                }) + (withFailures ? ` · ${t('siem.failed')}: ${focus.failed}` : '')
              : t('siem.histogram')}
        </span>
        {step > 0 && <span>{t('siem.interval', { interval: stepLabel(step) })}</span>}
      </div>
      {bars.length === 0 ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>{t('siem.empty')}</p>
      ) : (
        <>
          <div
            ref={area}
            className={cn('relative flex h-20 touch-none items-end gap-px select-none', onZoom && 'cursor-crosshair')}
            onPointerDown={(event) => {
              if (!onZoom || event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              const index = indexAt(event)
              setDrag({ start: index, end: index })
            }}
            onPointerMove={(event) => {
              const index = indexAt(event)
              setHover(index)
              if (drag) setDrag({ ...drag, end: index })
            }}
            onPointerUp={finish}
            onPointerCancel={() => setDrag(null)}
            onPointerLeave={() => {
              if (!drag) setHover(null)
            }}
          >
            {bars.map((bar, index) => {
              const inSelection = selected && index >= selected[0] && index <= selected[1]
              const ok = bar.count - (withFailures ? bar.failed : 0)
              return (
                <div
                  key={bar.time}
                  className={cn(
                    'flex h-full min-w-px flex-1 flex-col justify-end rounded-t-sm',
                    inSelection && 'bg-primary/15',
                    hover === index && !selected && 'bg-muted'
                  )}
                >
                  {withFailures && bar.failed > 0 && (
                    <div className='rounded-t-sm bg-destructive/80' style={{ height: `${(bar.failed / max) * 100}%` }} />
                  )}
                  <div
                    className={cn('bg-primary/70', !(withFailures && bar.failed > 0) && 'rounded-t-sm', hover === index && 'bg-primary')}
                    style={{ height: `${(ok / max) * 100}%` }}
                  />
                </div>
              )
            })}
          </div>
          <div className='relative mt-1 h-4 text-[10px] text-muted-foreground'>
            {ticks.map((index, i) => (
              <span
                key={`${index}-${i}`}
                className={cn('absolute whitespace-nowrap', i === 0 ? 'left-0' : i === ticks.length - 1 ? 'right-0' : '-translate-x-1/2')}
                style={i === 0 || i === ticks.length - 1 ? undefined : { left: `${((index + 0.5) / bars.length) * 100}%` }}
              >
                {formatAxis(bars[index].time, step, span)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
