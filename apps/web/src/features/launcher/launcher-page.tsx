import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Apple, Check, Copy, Download, FlaskConical, History, Loader2, Monitor, ShieldCheck, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { formatDate } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText } from '@/features/admin/error-text'
import {
  detectPlatform,
  formatSize,
  myLauncherQueryOptions,
  useDownloadLauncher,
  type LauncherPage,
  type LauncherPlatform,
  type LauncherRelease,
} from './api'

export const PLATFORM_ICON: Record<LauncherPlatform, typeof Monitor> = { WINDOWS: Monitor, LINUX: Terminal, MACOS: Apple }

/**
 * Загрузчик в кабинете: последняя доступная версия под систему посетителя
 * крупной кнопкой, бета рядом, «что нового», требования и шаги установки,
 * история версий. Что именно доступно — решает сервер по роли и лицензиям.
 */
export function LauncherDownloadPage() {
  const t = useT()
  const data = useQuery(myLauncherQueryOptions())
  const [platform, setPlatform] = useState<LauncherPlatform>(detectPlatform)

  if (data.isPending) return <Skeleton className='h-96 w-full' />
  if (data.isError) return <AdminErrorText error={data.error} />

  const { latest, history, page, licensed } = data.data
  const platforms = [...new Set(latest.map((r) => r.platform))]
  const current = platforms.includes(platform) ? platform : (platforms[0] ?? platform)
  const stable = latest.find((r) => r.platform === current && r.channel === 'STABLE')
  const beta = latest.find((r) => r.platform === current && r.channel === 'BETA')
  const main = stable ?? beta

  return (
    <div className='space-y-6'>
      <section className='relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/15 via-background to-background p-6 sm:p-10'>
        <div aria-hidden className='pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/20 blur-3xl' />
        <div className='relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center'>
          <div className='space-y-4'>
            <Badge variant='outline' className='gap-1.5'>
              <ShieldCheck className='size-3.5' />
              {t('launcher.badge')}
            </Badge>
            <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>{t('launcher.title')}</h1>
            <p className='max-w-xl text-muted-foreground'>{t('launcher.subtitle')}</p>
            {platforms.length > 1 && (
              <div className='flex flex-wrap gap-1.5'>
                {platforms.map((p) => {
                  const Icon = PLATFORM_ICON[p]
                  return (
                    <Button key={p} size='sm' variant={p === current ? 'default' : 'outline'} onClick={() => setPlatform(p)}>
                      <Icon className='size-4' />
                      {t(`launcher.platform.${p}`)}
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
          {main ? (
            <ReleaseCard release={main} primary />
          ) : (
            <div className='rounded-xl border bg-background/70 p-6 text-sm backdrop-blur'>
              <p className='font-medium'>{t('launcher.none')}</p>
              <p className='mt-1 text-muted-foreground'>{licensed ? t('launcher.noneHint') : t('launcher.noneLicense')}</p>
              {!licensed && (
                <Button asChild className='mt-4'>
                  <Link to='/catalog'>{t('launcher.toCatalog')}</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {beta && stable && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <FlaskConical className='size-4' />
              {t('launcher.beta')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ReleaseCard release={beta} />
          </CardContent>
        </Card>
      )}

      <div className='grid gap-4 lg:grid-cols-2'>
        <PageLists page={page} />
      </div>

      {history.length > 0 && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <History className='size-4' />
              {t('launcher.history')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='divide-y'>
              {history.map((release) => (
                <HistoryRow key={release.id} release={release} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Карточка релиза: версия, дата, размер, контрольная сумма, кнопка. */
export function ReleaseCard({ release, primary = false, guest = false }: { release: LauncherRelease; primary?: boolean; guest?: boolean }) {
  const t = useT()
  const download = useDownloadLauncher()
  const [copied, setCopied] = useState(false)
  const Icon = PLATFORM_ICON[release.platform]

  return (
    <div className={cn('space-y-4 rounded-xl border bg-background/80 p-5 backdrop-blur', primary && 'shadow-lg')}>
      <div className='flex flex-wrap items-center gap-2'>
        <Icon className='size-5 text-muted-foreground' />
        <span className='text-lg font-semibold'>
          {t('launcher.version', { version: release.version })}
        </span>
        {release.channel === 'BETA' && <Badge variant='secondary'>{t('launcher.channel.BETA')}</Badge>}
        {release.isMandatory && <Badge variant='destructive'>{t('launcher.mandatory')}</Badge>}
      </div>
      <p className='text-sm text-muted-foreground'>
        {t(`launcher.platform.${release.platform}`)} · {formatSize(release.fileSize)}
        {release.publishedAt && ` · ${formatDate(release.publishedAt)}`}
      </p>
      <Button size={primary ? 'lg' : 'default'} className='w-full' disabled={download.isPending} onClick={() => download.mutate({ id: release.id, guest })}>
        {download.isPending ? <Loader2 className='size-4 animate-spin' /> : <Download className='size-4' />}
        {t('launcher.download', { platform: t(`launcher.platform.${release.platform}`) })}
      </Button>
      <AdminErrorText error={download.error} />
      {release.sha256 && (
        <button
          type='button'
          onClick={() => {
            void navigator.clipboard.writeText(release.sha256!).then(() => {
              setCopied(true)
              toast.success(t('launcher.copied'))
              setTimeout(() => setCopied(false), 2000)
            })
          }}
          className='flex w-full items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-start text-[11px] text-muted-foreground hover:bg-muted'
          title={t('launcher.sha256Hint')}
        >
          <span className='shrink-0 font-medium'>SHA-256</span>
          <span className='truncate font-mono'>{release.sha256}</span>
          {copied ? <Check className='ms-auto size-3.5 shrink-0' /> : <Copy className='ms-auto size-3.5 shrink-0' />}
        </button>
      )}
      {release.notes && (
        <div className='space-y-1'>
          <p className='text-xs font-medium text-muted-foreground'>{t('launcher.notes')}</p>
          <p className='text-sm whitespace-pre-line'>{release.notes}</p>
        </div>
      )}
    </div>
  )
}

function HistoryRow({ release }: { release: LauncherRelease }) {
  const t = useT()
  const download = useDownloadLauncher()
  const Icon = PLATFORM_ICON[release.platform]
  return (
    <li className='flex flex-wrap items-center gap-3 py-2.5 text-sm'>
      <Icon className='size-4 text-muted-foreground' />
      <span className='font-medium'>{release.version}</span>
      {release.channel === 'BETA' && <Badge variant='secondary'>{t('launcher.channel.BETA')}</Badge>}
      <span className='text-muted-foreground'>
        {release.publishedAt ? formatDate(release.publishedAt) : '—'} · {formatSize(release.fileSize)}
      </span>
      {release.notes && <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>{release.notes.split('\n')[0]}</span>}
      <Button size='sm' variant='outline' className='ms-auto' disabled={download.isPending} onClick={() => download.mutate({ id: release.id })}>
        <Download className='size-4' />
        {t('launcher.downloadShort')}
      </Button>
    </li>
  )
}

/** Требования и шаги установки: строки из настроек страницы. */
export function PageLists({ page, className }: { page: LauncherPage; className?: string }) {
  const t = useT()
  const requirements = page.requirements.split('\n').map((s) => s.trim()).filter(Boolean)
  const steps = page.steps.split('\n').map((s) => s.trim()).filter(Boolean)
  return (
    <>
      {requirements.length > 0 && (
        <Card className={className}>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>{t('launcher.requirements')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='space-y-2 text-sm'>
              {requirements.map((line) => (
                <li key={line} className='flex gap-2'>
                  <Check className='mt-0.5 size-4 shrink-0 text-primary' />
                  {line}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {steps.length > 0 && (
        <Card className={className}>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>{t('launcher.steps')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className='space-y-2 text-sm'>
              {steps.map((line, index) => (
                <li key={line} className='flex gap-3'>
                  <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary'>
                    {index + 1}
                  </span>
                  <span className='pt-0.5'>{line}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </>
  )
}
