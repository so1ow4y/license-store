import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, CloudUpload, Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { formatDate, formatDateTime } from '@/lib/format/date'
import { cn } from '@/lib/utils'
import { ACTIVE_ROW, CURSOR_ROW, PanelFacts, PanelSection, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText } from '@/features/admin/error-text'
import { AdminPageHeader } from '@/features/admin/page-header'
import { adminRolesQueryOptions } from '@/features/admin-users/api'
import { FieldRow, Segmented } from '@/features/admin-security/controls'
import {
  adminLauncherQueryOptions,
  formatSize,
  LAUNCHER_AUDIENCES,
  LAUNCHER_PLATFORMS,
  useDeleteRelease,
  usePublishRelease,
  useSaveRelease,
  useUpdateLauncherPage,
  useUploadRelease,
  type AdminLauncherRelease,
  type LauncherPage,
  type ReleaseInput,
} from './api'
import { PLATFORM_ICON } from './launcher-page'

const NEW_RELEASE: ReleaseInput = {
  version: '',
  platform: 'WINDOWS',
  channel: 'STABLE',
  notes: '',
  audience: 'USERS',
  roles: [],
  isMandatory: false,
}

/**
 * Релизы клиента-загрузчика: черновик → файл в хранилище (хеш считает
 * сервер) → публикация. Аудитория решает, кто увидит версию: все с главной,
 * вошедшие, владельцы лицензий или выбранные роли.
 */
export function AdminLauncherPage({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const t = useT()
  const data = useQuery(adminLauncherQueryOptions())
  const releases = data.data?.releases ?? []
  const opened = openId === 'new' ? null : (releases.find((r) => r.id === openId) ?? null)
  const cursor = useListHotkeys({ ids: releases.map((r) => r.id), openedId: openId, onOpen, onClose: () => onOpen(null) })
  const totalDownloads = releases.reduce((sum, r) => sum + r.downloads, 0)

  return (
    <div className='space-y-6'>
      <AdminPageHeader
        title={t('launcherAdmin.title')}
        description={t('launcherAdmin.description')}
        actions={
          <Button onClick={() => onOpen('new')}>
            <Plus className='size-4' />
            {t('launcherAdmin.new')}
          </Button>
        }
      />
      <AdminErrorText error={data.error} />

      {data.isPending ? (
        <Skeleton className='h-64 w-full' />
      ) : (
        <>
          <div className='grid gap-3 sm:grid-cols-3'>
            <Stat label={t('launcherAdmin.stat.published')} value={releases.filter((r) => r.isPublished).length} />
            <Stat label={t('launcherAdmin.stat.drafts')} value={releases.filter((r) => !r.isPublished).length} />
            <Stat label={t('launcherAdmin.stat.downloads')} value={totalDownloads} />
          </div>

          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('launcherAdmin.column.version')}</TableHead>
                  <TableHead>{t('launcherAdmin.column.audience')}</TableHead>
                  <TableHead>{t('launcherAdmin.column.file')}</TableHead>
                  <TableHead>{t('launcherAdmin.column.status')}</TableHead>
                  <TableHead className='text-end'>{t('launcherAdmin.column.downloads')}</TableHead>
                  <TableHead className='w-8' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {releases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className='py-10 text-center text-muted-foreground'>
                      {t('launcherAdmin.empty')}
                    </TableCell>
                  </TableRow>
                )}
                {releases.map((release) => {
                  const Icon = PLATFORM_ICON[release.platform]
                  return (
                    <TableRow
                      key={release.id}
                      data-row-id={release.id}
                      className={cn('cursor-pointer', openId === release.id && ACTIVE_ROW, cursor === release.id && CURSOR_ROW)}
                      onClick={() => onOpen(openId === release.id ? null : release.id)}
                    >
                      <TableCell>
                        <span className='flex items-center gap-2'>
                          <Icon className='size-4 text-muted-foreground' />
                          <span className='font-medium'>{release.version}</span>
                          {release.channel === 'BETA' && <Badge variant='secondary'>{t('launcher.channel.BETA')}</Badge>}
                          {release.isMandatory && <Badge variant='destructive'>{t('launcher.mandatory')}</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className='text-sm'>
                        {t(`launcherAdmin.audience.${release.audience}`)}
                        {release.audience === 'ROLES' && <span className='block text-xs text-muted-foreground'>{release.roles.join(', ')}</span>}
                      </TableCell>
                      <TableCell className='text-sm'>
                        {release.fileName ? (
                          <>
                            <span className='font-mono text-xs'>{release.fileName}</span>
                            <span className='block text-xs text-muted-foreground'>{formatSize(release.fileSize)}</span>
                          </>
                        ) : (
                          <span className='text-muted-foreground'>{t('launcherAdmin.noFile')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {release.isPublished ? (
                          <Badge>{t('launcherAdmin.published', { date: formatDate(release.publishedAt) })}</Badge>
                        ) : (
                          <Badge variant='outline'>{t('launcherAdmin.draft')}</Badge>
                        )}
                      </TableCell>
                      <TableCell className='text-end tabular-nums'>{release.downloads}</TableCell>
                      <TableCell>
                        <ChevronRight className={cn('size-4 text-muted-foreground', openId === release.id && 'text-primary')} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {data.data && <PageSettings key={JSON.stringify(data.data.page)} page={data.data.page} />}
        </>
      )}

      {openId && (openId === 'new' || opened) && (
        <ReleasePanel key={openId} release={opened} onClose={() => onOpen(null)} onCreated={(id) => onOpen(id)} />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-1 text-2xl font-semibold tabular-nums'>{value.toLocaleString()}</p>
    </div>
  )
}

function ReleasePanel({
  release,
  onClose,
  onCreated,
}: {
  release: AdminLauncherRelease | null
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const t = useT()
  const roles = useQuery(adminRolesQueryOptions())
  const save = useSaveRelease()
  const publish = usePublishRelease()
  const remove = useDeleteRelease()
  const upload = useUploadRelease()
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ReleaseInput>(() =>
    release
      ? {
          version: release.version,
          platform: release.platform,
          channel: release.channel,
          notes: release.notes ?? '',
          audience: release.audience,
          roles: release.roles,
          isMandatory: release.isMandatory,
        }
      : NEW_RELEASE
  )
  const locked = Boolean(release?.isPublished)
  const valid = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(form.version) && (form.audience !== 'ROLES' || form.roles.length > 0)

  function onSave() {
    const body = locked ? { notes: form.notes, audience: form.audience, roles: form.roles, isMandatory: form.isMandatory } : form
    save.mutate(
      { ...(release ? { id: release.id } : {}), ...body },
      {
        onSuccess: (saved) => {
          toast.success(t('launcherAdmin.saved'))
          if (!release) onCreated(saved.id)
        },
      }
    )
  }

  function onFile(file: File | undefined) {
    if (!file || !release) return
    setProgress(0)
    upload.mutate(
      { id: release.id, file, onProgress: setProgress },
      {
        onSuccess: () => toast.success(t('launcherAdmin.uploaded')),
        onSettled: () => setProgress(null),
      }
    )
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      title={release ? t('launcher.version', { version: release.version }) : t('launcherAdmin.new')}
      subtitle={release ? `${t(`launcher.platform.${release.platform}`)} · ${t(`launcher.channel.${release.channel}`)}` : undefined}
      badges={release && (release.isPublished ? <Badge>{t('launcherAdmin.publishedShort')}</Badge> : <Badge variant='outline'>{t('launcherAdmin.draft')}</Badge>)}
    >
      <PanelSection title={t('launcherAdmin.section.release')}>
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <FieldRow label={t('launcherAdmin.field.version')} hint={locked ? t('launcherAdmin.lockedHint') : undefined}>
              <Input value={form.version} disabled={locked} placeholder='2.1.0' onChange={(e) => setForm({ ...form, version: e.target.value.trim() })} className='font-mono' />
            </FieldRow>
            <FieldRow label={t('launcherAdmin.field.channel')}>
              <Segmented
                value={form.channel}
                onChange={(channel) => !locked && setForm({ ...form, channel })}
                options={(['STABLE', 'BETA'] as const).map((c) => ({ value: c, label: t(`launcher.channel.${c}`), disabled: locked }))}
              />
            </FieldRow>
          </div>
          <FieldRow label={t('launcherAdmin.field.platform')}>
            <Segmented
              value={form.platform}
              onChange={(platform) => !locked && setForm({ ...form, platform })}
              options={LAUNCHER_PLATFORMS.map((p) => ({ value: p, label: t(`launcher.platform.${p}`), disabled: locked }))}
            />
          </FieldRow>
          <FieldRow label={t('launcherAdmin.field.notes')} hint={t('launcherAdmin.field.notesHint')}>
            <Textarea value={form.notes} rows={5} maxLength={5000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FieldRow>
          <FieldRow label={t('launcherAdmin.field.audience')}>
            <div className='grid gap-2'>
              {LAUNCHER_AUDIENCES.map((audience) => (
                <label
                  key={audience}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm',
                    form.audience === audience ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                  )}
                >
                  <input type='radio' className='mt-1' checked={form.audience === audience} onChange={() => setForm({ ...form, audience })} />
                  <span>
                    <span className='font-medium'>{t(`launcherAdmin.audience.${audience}`)}</span>
                    <span className='block text-xs text-muted-foreground'>{t(`launcherAdmin.audience.${audience}.hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </FieldRow>
          {form.audience === 'ROLES' && (
            <FieldRow label={t('launcherAdmin.field.roles')}>
              <div className='grid gap-1.5 sm:grid-cols-2'>
                {(roles.data ?? []).map((role) => (
                  <label key={role.slug} className='flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm'>
                    <Checkbox
                      checked={form.roles.includes(role.slug)}
                      onCheckedChange={(checked) =>
                        setForm({ ...form, roles: checked === true ? [...form.roles, role.slug] : form.roles.filter((r) => r !== role.slug) })
                      }
                    />
                    <span className='truncate'>{role.name}</span>
                  </label>
                ))}
              </div>
            </FieldRow>
          )}
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox checked={form.isMandatory} onCheckedChange={(c) => setForm({ ...form, isMandatory: c === true })} />
            {t('launcherAdmin.field.mandatory')}
          </label>
          <Button disabled={!valid || save.isPending} onClick={onSave}>
            {release ? t('common.action.save') : t('launcherAdmin.create')}
          </Button>
          <AdminErrorText error={save.error} />
        </div>
      </PanelSection>

      {release && (
        <PanelSection title={t('launcherAdmin.section.file')}>
          <div className='space-y-3'>
            {release.fileName && (
              <PanelFacts
                rows={[
                  [t('launcherAdmin.column.file'), <span className='font-mono text-xs break-all'>{release.fileName}</span>],
                  [t('launcherAdmin.size'), formatSize(release.fileSize)],
                  ['SHA-256', <span className='font-mono text-[11px] break-all'>{release.sha256}</span>],
                ]}
              />
            )}
            {!locked && (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  onFile(e.dataTransfer.files[0])
                }}
                onClick={() => input.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
                )}
              >
                {progress !== null ? <Loader2 className='size-6 animate-spin text-primary' /> : <CloudUpload className='size-6 text-muted-foreground' />}
                <span>{progress !== null ? t('launcherAdmin.uploading', { n: Math.round(progress * 100) }) : release.fileName ? t('launcherAdmin.replace') : t('launcherAdmin.drop')}</span>
                {progress !== null && (
                  <span className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
                    <span className='block h-full bg-primary transition-all' style={{ width: `${progress * 100}%` }} />
                  </span>
                )}
                <input ref={input} type='file' className='hidden' onChange={(e) => onFile(e.target.files?.[0])} />
              </div>
            )}
            <AdminErrorText error={upload.error} />
          </div>
        </PanelSection>
      )}

      {release && (
        <PanelSection title={t('launcherAdmin.section.publish')}>
          <div className='space-y-3'>
            <PanelFacts
              rows={[
                [t('launcherAdmin.column.downloads'), String(release.downloads)],
                [t('launcherAdmin.createdBy'), `${release.createdByUsername ?? '—'} · ${formatDateTime(release.createdAt)}`],
              ]}
            />
            <div className='flex flex-wrap gap-2'>
              {release.isPublished ? (
                <Button variant='outline' disabled={publish.isPending} onClick={() => publish.mutate({ id: release.id, publish: false }, { onSuccess: () => toast.success(t('launcherAdmin.unpublished')) })}>
                  <EyeOff className='size-4' />
                  {t('launcherAdmin.unpublish')}
                </Button>
              ) : (
                <Button disabled={!release.fileName || publish.isPending} onClick={() => publish.mutate({ id: release.id, publish: true }, { onSuccess: () => toast.success(t('launcherAdmin.publishedToast')) })}>
                  <Eye className='size-4' />
                  {t('launcherAdmin.publish')}
                </Button>
              )}
              {!release.isPublished && (
                <Button
                  variant='ghost'
                  className='ms-auto text-destructive'
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(t('launcherAdmin.deleteConfirm'))) return
                    remove.mutate(release.id, { onSuccess: onClose })
                  }}
                >
                  <Trash2 className='size-4' />
                  {t('launcherAdmin.delete')}
                </Button>
              )}
            </div>
            {!release.fileName && <p className='text-xs text-muted-foreground'>{t('launcherAdmin.needFile')}</p>}
            <AdminErrorText error={publish.error ?? remove.error} />
          </div>
        </PanelSection>
      )}
    </SidePanel>
  )
}

function PageSettings({ page }: { page: LauncherPage }) {
  const t = useT()
  const update = useUpdateLauncherPage()
  const [form, setForm] = useState(page)
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('launcherAdmin.page.title')}</CardTitle>
        <CardDescription>{t('launcherAdmin.page.hint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='grid gap-3 lg:grid-cols-2'>
          <FieldRow label={t('launcher.requirements')} hint={t('launcherAdmin.page.lines')}>
            <Textarea rows={6} value={form.requirements} maxLength={4000} onChange={(e) => setForm({ ...form, requirements: e.target.value })} />
          </FieldRow>
          <FieldRow label={t('launcher.steps')} hint={t('launcherAdmin.page.lines')}>
            <Textarea rows={6} value={form.steps} maxLength={4000} onChange={(e) => setForm({ ...form, steps: e.target.value })} />
          </FieldRow>
        </div>
        <Button disabled={update.isPending} onClick={() => update.mutate(form, { onSuccess: () => toast.success(t('launcherAdmin.saved')) })}>
          {t('common.action.save')}
        </Button>
        <AdminErrorText error={update.error} />
      </CardContent>
    </Card>
  )
}
