import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Eye, EyeOff, Plus, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import {
  DEFAULT_HOTKEYS,
  DOCK_GROW,
  DOCK_POSITIONS,
  DOCK_PUSH,
  DOCK_SIZE_MAX,
  DOCK_SIZE_MIN,
  DOCK_SIZE_MODES,
  DOCK_SUB_MODES,
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN,
  HOTKEY_ACTIONS,
  SIDE_PANEL_MAX,
  SIDE_PANEL_MIN,
  THEMES,
  THEME_LETTER,
  hotkeyLabel,
  resetUiPreferences,
  setUiPreferences,
  useUiPreferences,
  type DockPosition,
  type DockSubMode,
  type HotkeyAction,
  type ThemeName,
} from '@/lib/ui/preferences'
import { cn } from '@/lib/utils'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { PanelFacts, PanelSection, SidePanel } from '@/components/side-panel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * Внешний вид и поведение: док (где стоит, как раскрываются ветки, куда
 * растёт, какой длины, сдвигает ли страницу), панель записи справа (ширина
 * с живым предпросмотром, тянется ли мышью, сдвигает ли страницу), горячие
 * клавиши, цветовая схема и язык. Всё применяется сразу.
 */
export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearancePage,
})

function AppearancePage() {
  const t = useT()
  const prefs = useUiPreferences()

  return (
    <div className='max-w-3xl space-y-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h1 className='text-xl font-semibold'>{t('appearance.title')}</h1>
          <p className='text-sm text-muted-foreground'>{t('appearance.description')}</p>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => {
            resetUiPreferences()
            toast.success(t('appearance.resetDone'))
          }}
        >
          <RotateCcw className='size-4' />
          {t('appearance.reset')}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('appearance.dock.title')}</CardTitle>
          <CardDescription>{t('appearance.dock.description')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div role='radiogroup' aria-label={t('appearance.dock.title')} className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
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

          <Flag
            checked={prefs.dockExpanded}
            onChange={(dockExpanded) => setUiPreferences({ dockExpanded })}
            label={t('appearance.dock.expanded')}
            hint={t('appearance.dock.expandedHint')}
          />
          <Flag
            checked={prefs.dockAutoHide}
            onChange={(dockAutoHide) => setUiPreferences({ dockAutoHide })}
            label={t('appearance.dock.autoHide')}
            hint={t('appearance.dock.autoHideHint')}
          />
          <Flag
            checked={prefs.dockHidden}
            onChange={(dockHidden) => setUiPreferences({ dockHidden })}
            label={t('appearance.dock.hidden')}
            hint={t('appearance.dock.hiddenHint')}
          />

          <Field label={t('appearance.dock.push')} hint={t(`appearance.dock.push.${prefs.dockPush}.hint`)}>
            <Choice
              value={prefs.dockPush}
              options={DOCK_PUSH.map((value) => ({ value, label: t(`appearance.dock.push.${value}`) }))}
              onChange={(dockPush) => setUiPreferences({ dockPush })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('appearance.sub.title')}</CardTitle>
          <CardDescription>{t('appearance.sub.description')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div role='radiogroup' aria-label={t('appearance.sub.title')} className='grid gap-3 sm:grid-cols-2'>
            {DOCK_SUB_MODES.map((mode) => (
              <Option
                key={mode}
                selected={prefs.dockSubMode === mode}
                onSelect={() => setUiPreferences({ dockSubMode: mode })}
                label={t(`appearance.sub.${mode}`)}
                hint={t(`appearance.sub.${mode}.hint`)}
              >
                <SubModePreview mode={mode} />
              </Option>
            ))}
          </div>

          <Field label={t('appearance.grow.title')} hint={t(`appearance.grow.${prefs.dockGrow}.hint`)}>
            <Choice
              value={prefs.dockGrow}
              options={DOCK_GROW.map((value) => ({ value, label: t(`appearance.grow.${value}`) }))}
              onChange={(dockGrow) => setUiPreferences({ dockGrow })}
            />
          </Field>

          <Field label={t('appearance.size.title')} hint={t(`appearance.size.${prefs.dockSizeMode}.hint`)}>
            <Choice
              value={prefs.dockSizeMode}
              options={DOCK_SIZE_MODES.map((value) => ({ value, label: t(`appearance.size.${value}`) }))}
              onChange={(dockSizeMode) => setUiPreferences({ dockSizeMode })}
            />
          </Field>
          {prefs.dockSizeMode === 'fixed' && (
            <Range
              label={t('appearance.size.length')}
              value={prefs.dockSize}
              min={DOCK_SIZE_MIN}
              max={DOCK_SIZE_MAX}
              step={10}
              onChange={(dockSize) => setUiPreferences({ dockSize })}
            />
          )}

          <Field label={t('appearance.width.title')} hint={t(`appearance.width.${prefs.dockWidthMode}.hint`)}>
            <Choice
              value={prefs.dockWidthMode}
              options={DOCK_SIZE_MODES.map((value) => ({ value, label: t(`appearance.size.${value}`) }))}
              onChange={(dockWidthMode) => setUiPreferences({ dockWidthMode })}
            />
          </Field>
          {prefs.dockWidthMode === 'fixed' && (
            <Range
              label={t('appearance.width.value')}
              value={prefs.dockWidth}
              min={DOCK_WIDTH_MIN}
              max={DOCK_WIDTH_MAX}
              step={2}
              onChange={(dockWidth) => setUiPreferences({ dockWidth })}
            />
          )}
        </CardContent>
      </Card>

      <SidePanelSettings />

      <Card>
        <CardHeader>
          <CardTitle>{t('appearance.hotkeys.title')}</CardTitle>
          <CardDescription>{t('appearance.hotkeys.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <HotkeysEditor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('appearance.theme.title')}</CardTitle>
          <CardDescription>{t('appearance.theme.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div role='radiogroup' aria-label={t('appearance.theme.title')} className='grid gap-3 sm:grid-cols-2'>
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

/**
 * Панель справа: сдвигать ли страницу, тянется ли мышью, ширина. Пока
 * двигаешь ширину, сама панель показывается рядом — видно, какой она будет.
 */
function SidePanelSettings() {
  const t = useT()
  const prefs = useUiPreferences()
  const [preview, setPreview] = useState(false)
  // Потолок ширины — от текущего окна (панель шире 85% экрана не бывает);
  // окно меняют — потолок следует за ним.
  const [viewport, setViewport] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const max = Math.max(SIDE_PANEL_MIN + 100, Math.min(SIDE_PANEL_MAX, Math.round(viewport * 0.85)))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('appearance.panel.title')}</CardTitle>
        <CardDescription>{t('appearance.panel.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-5'>
        <Flag
          checked={prefs.sidePanelPush}
          onChange={(sidePanelPush) => setUiPreferences({ sidePanelPush })}
          label={t('appearance.panel.push')}
          hint={t('appearance.panel.pushHint')}
        />
        <Flag
          checked={prefs.sidePanelResizable}
          onChange={(sidePanelResizable) => setUiPreferences({ sidePanelResizable })}
          label={t('appearance.panel.resizable')}
          hint={t('appearance.panel.resizableHint')}
        />
        <Range
          label={t('appearance.panel.width')}
          value={Math.min(prefs.sidePanelWidth, max)}
          min={SIDE_PANEL_MIN}
          max={max}
          step={10}
          onChange={(sidePanelWidth) => setUiPreferences({ sidePanelWidth })}
          onActivate={() => setPreview(true)}
        />
        <Button type='button' variant='outline' size='sm' onClick={() => setPreview(!preview)}>
          {preview ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
          {preview ? t('appearance.panel.hidePreview') : t('appearance.panel.showPreview')}
        </Button>
      </CardContent>

      <SidePanel
        open={preview}
        onClose={() => setPreview(false)}
        title={t('appearance.panel.previewTitle')}
        subtitle={t('appearance.panel.previewSubtitle', { width: prefs.sidePanelWidth })}
      >
        <PanelSection title={t('appearance.panel.previewSection')}>
          <PanelFacts
            rows={[
              [t('appearance.panel.width'), `${prefs.sidePanelWidth} px`],
              [t('appearance.panel.push'), prefs.sidePanelPush ? t('appearance.yes') : t('appearance.no')],
              [t('appearance.panel.resizable'), prefs.sidePanelResizable ? t('appearance.yes') : t('appearance.no')],
            ]}
          />
        </PanelSection>
        <p className='text-sm text-muted-foreground'>{t('appearance.panel.previewHint')}</p>
      </SidePanel>
    </Card>
  )
}

/**
 * Горячие клавиши: на действие сколько угодно клавиш. «+» и нажать клавишу;
 * Esc отменяет. Запоминается физическая клавиша, раскладка не важна. Клавиша,
 * занятая другим действием, переходит к этому — одна клавиша, одно действие.
 */
function HotkeysEditor() {
  const t = useT()
  const { hotkeys } = useUiPreferences()
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null)

  useEffect(() => {
    if (!capturing) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setCapturing(null)
        return
      }
      // Одиночные модификаторы и Tab не годятся: ими пользуются для другого.
      if (!event.code || /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$|^Tab$|^CapsLock$/.test(event.code)) return
      const code = event.code
      if (hotkeys.bindings[capturing].includes(code)) {
        setCapturing(null)
        return
      }
      const owner = HOTKEY_ACTIONS.find((action) => action !== capturing && hotkeys.bindings[action].includes(code))
      const bindings = { ...hotkeys.bindings, [capturing]: [...hotkeys.bindings[capturing], code] }
      if (owner) {
        bindings[owner] = bindings[owner].filter((c) => c !== code)
        toast.info(t('appearance.hotkeys.moved', { key: hotkeyLabel(code), from: t(`appearance.hotkeys.${owner}`) }))
      }
      setUiPreferences({ hotkeys: { ...hotkeys, bindings } })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, hotkeys, t])

  function remove(action: HotkeyAction, code: string) {
    setUiPreferences({
      hotkeys: { ...hotkeys, bindings: { ...hotkeys.bindings, [action]: hotkeys.bindings[action].filter((c) => c !== code) } },
    })
  }

  const groups: { title: string; actions: HotkeyAction[] }[] = [
    { title: t('appearance.hotkeys.group.lists'), actions: ['down', 'up', 'open', 'close'] },
    { title: t('appearance.hotkeys.group.menu'), actions: ['menuUp', 'menuDown', 'menuActivate'] },
  ]

  return (
    <div className='space-y-4'>
      <Flag
        checked={hotkeys.enabled}
        onChange={(enabled) => setUiPreferences({ hotkeys: { ...hotkeys, enabled } })}
        label={t('appearance.hotkeys.enabled')}
      />
      {groups.map((group) => (
        <div key={group.title} className='space-y-2'>
          <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{group.title}</p>
          <div className='space-y-1.5'>
            {group.actions.map((action) => (
              <div
                key={action}
                className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2', !hotkeys.enabled && 'opacity-50')}
              >
                <span className='min-w-44 flex-1 text-sm'>
                  {t(`appearance.hotkeys.${action}`)}
                  <span className='block text-xs text-muted-foreground'>{t(`appearance.hotkeys.${action}.hint`)}</span>
                </span>
                <span className='flex flex-wrap items-center gap-1.5'>
                  {hotkeys.bindings[action].length === 0 && capturing !== action && (
                    <span className='text-xs text-muted-foreground'>{t('appearance.hotkeys.none')}</span>
                  )}
                  {hotkeys.bindings[action].map((code) => (
                    <span key={code} className='inline-flex items-center gap-1 rounded-md border bg-muted py-0.5 ps-2 pe-1 font-mono text-sm'>
                      {hotkeyLabel(code)}
                      <button
                        type='button'
                        disabled={!hotkeys.enabled}
                        onClick={() => remove(action, code)}
                        className='rounded text-muted-foreground hover:text-destructive'
                        title={t('appearance.hotkeys.remove')}
                      >
                        <X className='size-3.5' />
                        <span className='sr-only'>{t('appearance.hotkeys.remove')}</span>
                      </button>
                    </span>
                  ))}
                  <button
                    type='button'
                    disabled={!hotkeys.enabled}
                    onClick={() => setCapturing(capturing === action ? null : action)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground',
                      capturing === action && 'animate-pulse border-primary text-primary'
                    )}
                  >
                    <Plus className='size-3.5' />
                    {capturing === action ? t('appearance.hotkeys.press') : t('appearance.hotkeys.add')}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button
        type='button'
        variant='ghost'
        size='sm'
        onClick={() => setUiPreferences({ hotkeys: { ...DEFAULT_HOTKEYS, enabled: hotkeys.enabled } })}
      >
        <RotateCcw className='size-4' />
        {t('appearance.hotkeys.reset')}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Элементы формы                                                       */
/* ------------------------------------------------------------------ */

function Flag({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  return (
    <label className='flex items-start gap-3 text-sm'>
      <Checkbox className='mt-1' checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span className='space-y-0.5'>
        <span className='block'>{label}</span>
        {hint && <span className='block text-xs text-muted-foreground'>{hint}</span>}
      </span>
    </label>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className='space-y-2'>
      <p className='text-sm font-medium'>{label}</p>
      {children}
      {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
    </div>
  )
}

/** Переключатель из нескольких вариантов в одну строку. */
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role='radiogroup' className='inline-flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1'>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          role='radio'
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent',
            value === option.value && 'bg-primary text-primary-foreground hover:bg-primary'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Ползунок с числом. `onActivate` — когда за него взялись (показать предпросмотр). */
function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onActivate,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  onActivate?: () => void
}) {
  return (
    <label className='block space-y-2'>
      <span className='flex items-center justify-between text-sm'>
        <span className='font-medium'>{label}</span>
        <span className='font-mono text-muted-foreground tabular-nums'>{value} px</span>
      </span>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onActivate}
        onFocus={onActivate}
        onChange={(e) => onChange(Number(e.target.value))}
        className='w-full accent-primary'
      />
    </label>
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

/** Схема дока: подветка колонкой сбоку (вниз от значка) или внутри дока под значком. */
function SubModePreview({ mode }: { mode: DockSubMode }) {
  const square = (accent = false) => (
    <span className={cn('size-3 rounded-[3px]', accent ? 'bg-primary/80' : 'bg-muted-foreground/40')} />
  )
  return (
    <span className='flex h-28 items-start gap-2 rounded-lg border bg-background p-2'>
      <span className='flex flex-col items-center gap-1 rounded-md border bg-card p-1'>
        {square()}
        <span className='rounded-[3px] ring-1 ring-primary'>{square(true)}</span>
        {mode === 'inline' && (
          <span className='flex flex-col items-center gap-0.5 rounded bg-muted p-0.5'>
            {square()}
            {square()}
            {square()}
          </span>
        )}
        {square()}
        {square()}
      </span>
      {mode === 'side' && (
        <span className='mt-3 flex flex-col items-center gap-1 rounded-md border bg-card p-1'>
          {square(true)}
          {square()}
          {square()}
          {square()}
        </span>
      )}
      <span className='flex h-full flex-1 flex-col gap-1.5 rounded-md border bg-card p-2'>
        <span className='h-2 w-2/3 rounded bg-foreground/70' />
        <span className='h-2 w-1/2 rounded bg-muted-foreground/40' />
      </span>
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
