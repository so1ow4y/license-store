import type { ReactNode } from 'react'

/** Шапка административного экрана: заголовок, описание, действия. Разделы — в доке. */
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className='flex flex-wrap items-start justify-between gap-3'>
      <div className='space-y-1'>
        <h1 className='text-xl font-semibold'>{title}</h1>
        {description && <p className='max-w-3xl text-sm text-muted-foreground'>{description}</p>}
      </div>
      {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
    </header>
  )
}
