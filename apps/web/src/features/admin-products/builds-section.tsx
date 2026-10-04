import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyButton } from '@/components/copy-button'
import { ALL_TIME, DateRangeFilter, type DateRange } from '@/features/admin/date-range'
import { AdminErrorText } from '@/features/admin/error-text'
import { InlineText } from '@/features/admin/inline-edit'
import { QueryInput, andQuery } from '@/features/admin/query-input'
import { formatDateTime } from '@/lib/format/date'
import {
  BUILD_NAME_RE,
  BUILD_SEARCH_FIELDS,
  BUILD_STATUSES,
  BUILD_VERSION_RE,
  formatBytes,
  nextBuildVersion,
  payloadBuildsQueryOptions,
  useCreateBuild,
  usePublishBuild,
  useRenameBuild,
  useUploadBuild,
  type BuildStatus,
  type PayloadBuild,
} from './api'

const STATUS_VARIANT: Record<BuildStatus, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  ready: 'secondary',
  published: 'default',
  unpublished: 'outline',
}

export function BuildStatusBadge({ status }: { status: BuildStatus }) {
  const t = useT()
  return <Badge variant={STATUS_VARIANT[status]}>{t(`admin.builds.status.${status}`)}</Badge>
}

/** Название сборки: до 64 символов, `1.2.3`, `beta.2`, `stable`. */
export function isBuildName(name: string): boolean {
  return name.length <= 64 && BUILD_NAME_RE.test(name)
}

/**
 * Хранилище сборок товара. Сборка — exe/payload, который загрузчик получает
 * после проверки лицензии. Порядок: черновик → файл → публикация.
 * Тарифы выбирают сборки отсюда, лицензии могут закрепить свою.
 */
export function BuildsSection({ productId }: { productId: string }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<BuildStatus | null>(null)
  const [range, setRange] = useState<DateRange>(ALL_TIME)
  const filters = { q: andQuery(q, status && `status:${status}`), from: range.from, to: range.to }
  const builds = useQuery(payloadBuildsQueryOptions(productId, filters))
  const all = useQuery(payloadBuildsQueryOptions(productId))

  const create = useCreateBuild(productId)
  const upload = useUploadBuild(productId)
  const publish = usePublishBuild(productId)
  const rename = useRenameBuild(productId)
  const [version, setVersion] = useState('')
  const [name, setName] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)

  const suggested = nextBuildVersion(all.data ?? [])
  const effectiveVersion = version || suggested
  const versionValid = BUILD_VERSION_RE.test(effectiveVersion)
  const nameValid = name === '' || isBuildName(name)

  function onCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!versionValid || !nameValid) return
    create.mutate(
      { version: effectiveVersion, ...(name ? { name } : {}) },
      {
        onSuccess: () => {
          setVersion('')
          setName('')
        },
      }
    )
  }

  function pickFile(build: PayloadBuild) {
    setUploadTarget(build.id)
    fileInput.current?.click()
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !uploadTarget) return
    upload.mutate(
      { buildId: uploadTarget, file },
      { onSuccess: () => toast.success(t('admin.builds.uploaded')), onSettled: () => setUploadTarget(null) }
    )
  }

  const rows = builds.data ?? []

  return (
    <Card>
      <CardHeader className='space-y-1'>
        <CardTitle className='text-base'>{t('admin.builds.title')}</CardTitle>
        <CardDescription>{t('admin.builds.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <form onSubmit={onCreate} className='flex flex-wrap items-end gap-2'>
          <div className='space-y-1'>
            <label htmlFor='build-version' className='text-xs text-muted-foreground'>
              {t('admin.builds.version')}
            </label>
            <Input
              id='build-version'
              value={version}
              placeholder={suggested}
              className='w-32 font-mono'
              onChange={(e) => setVersion(e.target.value.trim())}
            />
          </div>
          <div className='space-y-1'>
            <label htmlFor='build-name' className='text-xs text-muted-foreground'>
              {t('admin.builds.name')}
            </label>
            <Input
              id='build-name'
              value={name}
              placeholder={effectiveVersion}
              aria-invalid={!nameValid || undefined}
              className='w-48 font-mono'
              onChange={(e) => setName(e.target.value.trim())}
            />
          </div>
          <Button type='submit' variant='outline' disabled={!versionValid || !nameValid || create.isPending}>
            <Plus className='size-4' />
            {t('admin.builds.create')}
          </Button>
          <p className={cn('basis-full text-xs', nameValid ? 'text-muted-foreground' : 'text-destructive')}>
            {t('admin.builds.nameHint')}
          </p>
        </form>
        <AdminErrorText error={create.error ?? upload.error ?? publish.error} />

        <input ref={fileInput} type='file' className='hidden' onChange={onFile} />

        <QueryInput value={q} onSubmit={setQ} fields={BUILD_SEARCH_FIELDS} placeholder={t('admin.builds.queryPlaceholder')}>
          <DateRangeFilter value={range} onChange={setRange} />
        </QueryInput>
        <div className='flex flex-wrap gap-1'>
          {([null, ...BUILD_STATUSES] as const).map((s) => (
            <Button key={s ?? 'all'} size='sm' variant={status === s ? 'default' : 'outline'} className='h-7' onClick={() => setStatus(s)}>
              {s ? t(`admin.builds.status.${s}`) : t('admin.builds.status.all')}
            </Button>
          ))}
        </div>

        {builds.isPending ? (
          <Skeleton className='h-24 w-full' />
        ) : builds.isError ? (
          <AdminErrorText error={builds.error} />
        ) : rows.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {filters.q || range.from || range.to ? t('admin.builds.nothingFound') : t('admin.builds.empty')}
          </p>
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.builds.name')}</TableHead>
                  <TableHead>{t('admin.builds.version')}</TableHead>
                  <TableHead>{t('admin.builds.state')}</TableHead>
                  <TableHead>{t('admin.builds.plans')}</TableHead>
                  <TableHead>{t('admin.builds.pinned')}</TableHead>
                  <TableHead>{t('admin.builds.size')}</TableHead>
                  <TableHead>SHA-256</TableHead>
                  <TableHead>{t('admin.builds.created')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((build) => {
                  const hasFile = build.status !== 'draft'
                  const editable = !build.publishedAt
                  const busy = upload.isPending && uploadTarget === build.id
                  return (
                    <TableRow key={build.id}>
                      <TableCell>
                        <InlineText
                          value={build.name}
                          mono
                          validate={(next) => (isBuildName(next) ? null : t('admin.builds.nameHint'))}
                          onSave={(next) => rename.mutateAsync({ buildId: build.id, name: next })}
                        />
                      </TableCell>
                      <TableCell className='font-mono text-xs text-muted-foreground'>{build.version}</TableCell>
                      <TableCell>
                        <BuildStatusBadge status={build.status} />
                      </TableCell>
                      <TableCell>
                        <div className='flex max-w-48 flex-wrap gap-1'>
                          {build.plans.length === 0 ? (
                            <span className='text-xs text-muted-foreground'>—</span>
                          ) : (
                            build.plans.map((plan) => (
                              <button key={plan.id} type='button' onClick={() => setQ(andQuery(q, `plan:${plan.slug}`))}>
                                <Badge variant='outline'>{plan.name}</Badge>
                              </button>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {build.pinnedLicenses > 0 ? (
                          <Link
                            to='/admin/licenses'
                            search={{ q: `build:${build.name}` }}
                            className='underline-offset-4 hover:underline'
                          >
                            {build.pinnedLicenses}
                          </Link>
                        ) : (
                          <span className='text-muted-foreground'>0</span>
                        )}
                      </TableCell>
                      <TableCell className='whitespace-nowrap'>{formatBytes(build.size)}</TableCell>
                      <TableCell className='font-mono text-xs'>
                        {build.sha256 ? (
                          <span className='inline-flex items-center gap-1'>
                            {build.sha256.slice(0, 10)}…
                            <CopyButton value={build.sha256} label='SHA-256' />
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-muted-foreground'>{formatDateTime(build.createdAt)}</TableCell>
                      <TableCell className='space-x-2 text-right whitespace-nowrap'>
                        {editable && (
                          <Button size='sm' variant='outline' disabled={busy} onClick={() => pickFile(build)}>
                            <Upload className='size-4' />
                            {busy ? t('admin.builds.uploading') : hasFile ? t('admin.builds.reupload') : t('admin.builds.upload')}
                          </Button>
                        )}
                        {build.isPublished ? (
                          <Button size='sm' variant='outline' disabled={publish.isPending} onClick={() => publish.mutate({ buildId: build.id, publish: false })}>
                            {t('admin.builds.unpublish')}
                          </Button>
                        ) : (
                          <Button size='sm' disabled={!hasFile || publish.isPending} onClick={() => publish.mutate({ buildId: build.id, publish: true })}>
                            {t('admin.builds.publish')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
