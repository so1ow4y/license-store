import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Выбор одного из нескольких вариантов кнопками; у варианта может быть подсказка и запрет. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode; hint?: string; disabled?: boolean }[]
  onChange: (value: T) => void
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role='radiogroup' className={cn('inline-flex flex-wrap gap-0.5 rounded-md border p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          role='radio'
          aria-checked={value === option.value}
          title={option.hint}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            size === 'sm' ? 'py-0.5 text-xs' : 'py-1 text-sm',
            value === option.value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** «22, 443 8080» → [22, 443, 8080]; null — если есть что-то кроме портов. */
export function parsePorts(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean)
  const ports = parts.map(Number)
  if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65_535)) return null
  return [...new Set(ports)].sort((a, b) => a - b)
}

/** Подпись поля формы с подсказкой под ним. */
export function FieldRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className='space-y-1.5'>
      <div className='text-sm font-medium'>{label}</div>
      {children}
      {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
    </div>
  )
}
