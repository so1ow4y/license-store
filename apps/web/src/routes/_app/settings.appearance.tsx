import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useT } from '@/lib/i18n'
import {
  DOCK_POSITIONS,
  THEMES,
  THEME_LETTER,
  setUiPreferences,
  useUiPreferences,
  type DockPosition,
  type ThemeName,
} from '@/lib/ui/preferences'
import { cn } from '@/lib/utils'
import { LocaleSwitcher } from '@/components/locale-switcher'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'

/** Внешний вид: положение дока, его развёрнутость, цветовая схема, язык. */
export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearancePage,
})

function AppearancePage() {
  const t = useT()
  const prefs = useUiPreferences()

  return (
    <div className='max-w-3xl space-y-6'>
      <header className='space-y-1'>
        <h1 className='text-xl font-semibold'>{t('appearance.title')}</h1>
        <p className='text-sm text-muted-foreground'>{t('appearance.description')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('appearance.dock.title')}</CardTitle>
          <CardDescription>{t('appearance.dock.description')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div
            role='radiogroup'
            aria-label={t('appearance.dock.title')}
            className='grid grid-cols-2 gap-3 sm:grid-cols-4'
          >
            {DOCK_POSITIONS.map((position) => (
              <Option
                key={position}
                selected={prefs.dock === position}
                onSelect={() => setUiPreferences({ dock: position })}
                label={t(`appearance.dock.${position}`)}
              >
                <DockPreview position={position} />
              </Option>
            ))}
          </div>

          <label className='flex items-start gap-3 text-sm'>
            <Checkbox
              className='mt-1'
              checked={prefs.dockExpanded}
              onCheckedChange={(value) => setUiPreferences({ dockExpanded: value === true })}
            />
            <span className='space-y-0.5'>
              <span className='block'>{t('appearance.dock.expanded')}</span>
              <span className='block text-xs text-muted-foreground'>
                {t('appearance.dock.expandedHint')}
              </span>
            </span>
          </label>

          <label className='flex items-start gap-3 text-sm'>
            <Checkbox
              className='mt-1'
              checked={prefs.dockAutoHide}
              onCheckedChange={(value) => setUiPreferences({ dockAutoHide: value === true })}
            />
            <span className='space-y-0.5'>
              <span className='block'>{t('appearance.dock.autoHide')}</span>
              <span className='block text-xs text-muted-foreground'>{t('appearance.dock.autoHideHint')}</span>
            </span>
          </label>

          <label className='flex items-start gap-3 text-sm'>
            <Checkbox
              className='mt-1'
              checked={prefs.dockHidden}
              onCheckedChange={(value) => setUiPreferences({ dockHidden: value === true })}
            />
            <span className='space-y-0.5'>
              <span className='block'>{t('appearance.dock.hidden')}</span>
              <span className='block text-xs text-muted-foreground'>{t('appearance.dock.hiddenHint')}</span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('appearance.theme.title')}</CardTitle>
          <CardDescription>{t('appearance.theme.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role='radiogroup'
            aria-label={t('appearance.theme.title')}
            className='grid gap-3 sm:grid-cols-2'
          >
            {THEMES.map((theme) => (
              <Option
                key={theme}
                selected={prefs.theme === theme}
                onSelect={() => setUiPreferences({ theme })}
                label={t(`appearance.theme.${theme}`)}
                hint={t(`appearance.theme.${theme}.hint`)}
              >
                <ThemePreview theme={theme} />
              </Option>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('locale.switcher.label')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher className='w-fit' />
        </CardContent>
      </Card>
    </div>
  )
}

function Option({
  selected,
  onSelect,
  label,
  hint,
  children,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-2 text-start text-sm transition-colors hover:bg-accent/50',
        selected && 'border-primary ring-1 ring-primary'
      )}
    >
      {children}
      <span className='flex items-center justify-between gap-2 px-1'>
        <span className='font-medium'>{label}</span>
        {selected && <Check className='size-4 text-primary' aria-hidden />}
      </span>
      {hint && <span className='px-1 pb-1 text-xs text-muted-foreground'>{hint}</span>}
    </button>
  )
}

const PREVIEW_BAR: Record<DockPosition, string> = {
  left: 'left-1.5 top-1/2 h-10 w-2 -translate-y-1/2',
  right: 'right-1.5 top-1/2 h-10 w-2 -translate-y-1/2',
  top: 'top-1.5 left-1/2 h-2 w-14 -translate-x-1/2',
  bottom: 'bottom-1.5 left-1/2 h-2 w-14 -translate-x-1/2',
}

function DockPreview({ position }: { position: DockPosition }) {
  return (
    <span className='relative block h-20 rounded-lg border bg-background'>
      <span className={cn('absolute rounded-full bg-primary/70', PREVIEW_BAR[position])} />
    </span>
  )
}

/** data-theme на блоке подставляет переменные схемы только внутри превью. */
function ThemePreview({ theme }: { theme: ThemeName }) {
  return (
    <span data-theme={theme} className='flex h-24 gap-2 rounded-lg border bg-background p-2'>
      <span className='flex w-8 flex-col items-center gap-1.5 rounded-md border bg-card py-1.5'>
        <span className='flex size-5 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground'>
          {THEME_LETTER[theme]}
        </span>
        <span className='size-3 rounded-sm bg-primary/40' />
        <span className='size-3 rounded-sm bg-muted-foreground/40' />
        <span className='size-3 rounded-sm bg-muted-foreground/40' />
      </span>
      <span className='flex flex-1 flex-col gap-1.5 rounded-md border bg-card p-2'>
        <span className='h-2 w-2/3 rounded bg-foreground/80' />
        <span className='h-2 w-1/2 rounded bg-muted-foreground/50' />
        <span className='mt-auto h-4 w-16 rounded bg-primary' />
      </span>
    </span>
  )
}
