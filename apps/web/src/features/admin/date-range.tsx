import { useT } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * Диапазон дат для списков панели: пресеты и свой интервал по календарю.
 * Границы считаются в момент выбора и хранятся готовыми ISO-строками —
 * иначе «последние 24 часа» менялись бы на каждом рендере и ключ запроса
 * вместе с ними.
 */

export const DATE_PRESETS = ['all', '24h', '7d', '30d', '90d', 'custom'] as const
export type DatePreset = (typeof DATE_PRESETS)[number]

export type DateRange = { preset: DatePreset; from?: string; to?: string; fromDay?: string; toDay?: string }

export const ALL_TIME: DateRange = { preset: 'all' }

const PRESET_MS: Record<'24h' | '7d' | '30d' | '90d', number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
  '90d': 90 * 24 * 3_600_000,
}

/** Начало или конец календарного дня (YYYY-MM-DD) в часовом поясе браузера. */
function dayBound(day: string | undefined, end: boolean): string | undefined {
  if (!day) return undefined
  const date = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function resolveRange(preset: DatePreset, fromDay?: string, toDay?: string): DateRange {
  if (preset === 'all') return ALL_TIME
  if (preset === 'custom') {
    return { preset, fromDay, toDay, from: dayBound(fromDay, false), to: dayBound(toDay, true) }
  }
  return { preset, from: new Date(Date.now() - PRESET_MS[preset]).toISOString() }
}

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const t = useT()
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Select value={value.preset} onValueChange={(preset) => onChange(resolveRange(preset as DatePreset, value.fromDay, value.toDay))}>
        <SelectTrigger className='w-44'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {t(`admin.dates.${preset}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.preset === 'custom' && (
        <>
          <Input
            type='date'
            aria-label={t('admin.dates.from')}
            className='w-40'
            value={value.fromDay ?? ''}
            max={value.toDay}
            onChange={(e) => onChange(resolveRange('custom', e.target.value || undefined, value.toDay))}
          />
          <span className='text-muted-foreground'>—</span>
          <Input
            type='date'
            aria-label={t('admin.dates.to')}
            className='w-40'
            value={value.toDay ?? ''}
            min={value.fromDay}
            onChange={(e) => onChange(resolveRange('custom', value.fromDay, e.target.value || undefined))}
          />
        </>
      )}
    </div>
  )
}
