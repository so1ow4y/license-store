import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { formatDateTime } from '@/lib/format/date'
import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminErrorText, adminErrorMessage } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { InlineText } from '@/features/admin/inline-edit'
import { formatPrice } from '@/features/catalog/api'
import {
  nextBuildVersion,
  payloadBuildsQueryOptions,
  useCreateBuild,
  useCreatePlan,
  usePublishBuild,
  useSetPlanBuilds,
  useUpdatePlan,
  useUploadBuild,
  type AdminPlan,
  type AdminProduct,
  type UpdatePlanInput,
} from './api'
import { BuildStatusBadge, isBuildName } from './builds-section'

export function PlansSection({ product }: { product: AdminProduct }) {
  const t = useT()
  const { can } = useSession()
  const [editing, setEditing] = useState<AdminPlan | 'new' | null>(null)
  const [buildsFor, setBuildsFor] = useState<AdminPlan | null>(null)
  const update = useUpdatePlan()

  function patch(plan: AdminPlan, body: UpdatePlanInput) {
    return update.mutateAsync({ planId: plan.id, body })
  }

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-3'>
        <div className='space-y-1'>
          <CardTitle className='text-base'>{t('admin.plans.title')}</CardTitle>
          <CardDescription>{t('admin.plans.description')}</CardDescription>
        </div>
        <Button size='sm' onClick={() => setEditing('new')}>
          <Plus className='size-4' />
          {t('admin.plans.create')}
        </Button>
      </CardHeader>
      <CardContent>
        {product.plans.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('admin.plans.empty')}</p>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.plans.column.name')}</TableHead>
                  <TableHead>{t('admin.plans.column.duration')}</TableHead>
                  <TableHead>{t('admin.plans.column.price')}</TableHead>
                  <TableHead>{t('admin.plans.column.digiseller')}</TableHead>
                  <TableHead>{t('admin.plans.column.builds')}</TableHead>
                  <TableHead>{t('admin.plans.column.state')}</TableHead>
                  <TableHead>{t('admin.products.field.sortOrder')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.plans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>
                      <InlineText
                        value={plan.name}
                        className='font-medium'
                        validate={(next) => (next ? null : t('admin.inline.required'))}
                        onSave={(name) => patch(plan, { name })}
                      />
                      <span className='block font-mono text-xs text-muted-foreground'>{plan.slug}</span>
                    </TableCell>
                    <TableCell>
                      {plan.durationDays
                        ? t('licenses.plan.days', { count: plan.durationDays })
                        : t('licenses.plan.lifetime')}
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      <InlineText
                        value={String(Math.round(Number(plan.price)))}
                        display={formatPrice(plan.price, plan.currency)}
                        type='number'
                        inputClassName='w-24'
                        validate={(next) => (/^\d+$/.test(next) ? null : t('admin.inline.number'))}
                        onSave={(price) => patch(plan, { price: Number(price) })}
                      />
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      <InlineText
                        value={plan.digisellerProductId?.toString() ?? ''}
                        type='number'
                        inputClassName='w-28'
                        validate={(next) => (next === '' || /^\d+$/.test(next) ? null : t('admin.inline.number'))}
                        onSave={(id) => patch(plan, { digisellerProductId: id ? Number(id) : null })}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type='button'
                        disabled={!can(PERMISSIONS.PLANS_MANAGE)}
                        onClick={() => setBuildsFor(plan)}
                        className='flex max-w-52 flex-wrap gap-1 rounded p-0.5 text-start enabled:hover:bg-accent'
                        title={t('admin.plans.builds.edit')}
                      >
                        {(plan.builds ?? []).length === 0 ? (
                          <span className='text-xs text-muted-foreground'>{t('admin.plans.builds.latest')}</span>
                        ) : (
                          (plan.builds ?? []).map(({ build }) => (
                            <Badge key={build.id} variant={build.isPublished ? 'secondary' : 'outline'} className='font-mono'>
                              {build.name}
                            </Badge>
                          ))
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <label className='flex items-center gap-2 text-sm'>
                        <Checkbox
                          checked={plan.isActive}
                          disabled={update.isPending}
                          onCheckedChange={(v) =>
                            void patch(plan, { isActive: v === true }).catch((e: unknown) => toast.error(adminErrorMessage(e)))
                          }
                        />
                        {plan.isActive ? t('admin.plans.active') : t('admin.plans.inactive')}
                      </label>
                    </TableCell>
                    <TableCell>
                      <InlineText
                        value={String(plan.sortOrder)}
                        type='number'
                        inputClassName='w-20'
                        validate={(next) => (/^-?\d+$/.test(next) ? null : t('admin.inline.number'))}
                        onSave={(sortOrder) => patch(plan, { sortOrder: Number(sortOrder) })}
                      />
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button size='sm' variant='outline' onClick={() => setEditing(plan)}>
                        {t('common.action.edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <PlanDialog
        productId={product.id}
        plan={editing === 'new' ? null : editing}
        open={editing !== null}
        canUpload={can(PERMISSIONS.VERSIONS_MANAGE)}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
      <PlanBuildsDialog
        productId={product.id}
        plan={buildsFor}
        canUpload={can(PERMISSIONS.VERSIONS_MANAGE)}
        onOpenChange={(open) => {
          if (!open) setBuildsFor(null)
        }}
      />
    </Card>
  )
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/**
 * Выбор сборок тарифа: галочки из хранилища товара и «загрузить свою exe»
 * (черновик со следующей версией → файл → публикация → галочка).
 * Общий для окна «Сборки» и окна правки тарифа.
 */
function BuildPicker({
  productId,
  picked,
  onPickedChange,
  canUpload,
  onBusyChange,
}: {
  productId: string
  picked: Set<string>
  onPickedChange: (next: Set<string>) => void
  canUpload: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const t = useT()
  const builds = useQuery(payloadBuildsQueryOptions(productId))
  const create = useCreateBuild(productId)
  const upload = useUploadBuild(productId)
  const publish = usePublishBuild(productId)
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<unknown>(null)

  const list = (builds.data ?? []).filter((b) => {
    const f = filter.trim().toLowerCase()
    return !f || b.name.toLowerCase().includes(f) || b.version.includes(f)
  })

  function toggle(id: string) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onPickedChange(next)
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    onBusyChange?.(true)
    setUploadError(null)
    try {
      const version = nextBuildVersion(builds.data ?? [])
      const draft = await create.mutateAsync({ version, ...(newName ? { name: newName } : {}) })
      await upload.mutateAsync({ buildId: draft.id, file })
      await publish.mutateAsync({ buildId: draft.id, publish: true })
      onPickedChange(new Set(picked).add(draft.id))
      setNewName('')
      toast.success(t('admin.plans.builds.uploaded', { name: draft.name }))
    } catch (error) {
      setUploadError(error)
    } finally {
      setUploading(false)
      onBusyChange?.(false)
    }
  }

  const newNameValid = newName === '' || isBuildName(newName)

  return (
    <div className='space-y-3'>
      <Input value={filter} placeholder={t('admin.plans.builds.filter')} onChange={(e) => setFilter(e.target.value)} />

      <div className='max-h-60 space-y-1 overflow-y-auto rounded-md border p-2'>
        {builds.isPending ? (
          <Skeleton className='h-16 w-full' />
        ) : list.length === 0 ? (
          <p className='p-2 text-sm text-muted-foreground'>{t('admin.builds.empty')}</p>
        ) : (
          list.map((build) => (
            <label key={build.id} className='flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-accent'>
              <Checkbox checked={picked.has(build.id)} onCheckedChange={() => toggle(build.id)} />
              <span className='min-w-0 flex-1'>
                <span className='font-mono text-sm'>{build.name}</span>
                <span className='ms-2 text-xs text-muted-foreground'>
                  v{build.version} · {formatDateTime(build.createdAt)}
                </span>
              </span>
              <BuildStatusBadge status={build.status} />
            </label>
          ))
        )}
      </div>
      <p className='text-xs text-muted-foreground'>
        {picked.size === 0 ? t('admin.plans.builds.noneMeansLatest') : t('admin.plans.builds.pickedCount', { count: picked.size })}
      </p>
      {[...picked].some((id) => builds.data?.find((b) => b.id === id && !b.isPublished)) && (
        <p className='text-xs text-amber-600 dark:text-amber-400'>{t('admin.plans.builds.unpublishedWarning')}</p>
      )}

      {canUpload && (
        <div className='space-y-2 rounded-md border border-dashed p-3'>
          <p className='text-sm font-medium'>{t('admin.plans.builds.uploadTitle')}</p>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              value={newName}
              placeholder={t('admin.plans.builds.namePlaceholder', { version: nextBuildVersion(builds.data ?? []) })}
              aria-invalid={!newNameValid || undefined}
              className='w-56 font-mono'
              onChange={(e) => setNewName(e.target.value.trim())}
            />
            <Button type='button' variant='outline' disabled={uploading || !newNameValid} onClick={() => fileInput.current?.click()}>
              <Upload className='size-4' />
              {uploading ? t('admin.builds.uploading') : t('admin.plans.builds.uploadButton')}
            </Button>
            <input ref={fileInput} type='file' className='hidden' onChange={(e) => void onFile(e)} />
          </div>
          <p className={newNameValid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>{t('admin.builds.nameHint')}</p>
          <AdminErrorText error={uploadError} />
        </div>
      )}
    </div>
  )
}

/** Окно «Сборки» из таблицы тарифов. */
function PlanBuildsDialog({
  productId,
  plan,
  canUpload,
  onOpenChange,
}: {
  productId: string
  plan: AdminPlan | null
  canUpload: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const save = useSetPlanBuilds(productId)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!plan) return
    setPicked(new Set((plan.builds ?? []).map((b) => b.build.id)))
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id])

  function onSave() {
    if (!plan) return
    save.mutate(
      { planId: plan.id, buildIds: [...picked] },
      {
        onSuccess: () => {
          toast.success(t('admin.saved'))
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <Dialog open={plan !== null} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('admin.plans.builds.title', { plan: plan?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('admin.plans.builds.hint')}</DialogDescription>
        </DialogHeader>
        {plan && (
          <BuildPicker productId={productId} picked={picked} onPickedChange={setPicked} canUpload={canUpload} onBusyChange={setBusy} />
        )}
        <AdminErrorText error={save.error} />
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            {t('common.action.cancel')}
          </Button>
          <Button type='button' disabled={save.isPending || busy} onClick={onSave}>
            {t('common.action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PLAN_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * Создание и правка тарифа вместе со сборками. Код и срок после создания
 * не меняются — проще завести новый тариф.
 */
function PlanDialog({
  productId,
  plan,
  open,
  canUpload,
  onOpenChange,
}: {
  productId: string
  plan: AdminPlan | null
  open: boolean
  canUpload: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const create = useCreatePlan(productId)
  const update = useUpdatePlan()
  const setBuilds = useSetPlanBuilds(productId)
  const mutation = plan ? update : create

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [days, setDays] = useState('30')
  const [lifetime, setLifetime] = useState(false)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('RUB')
  const [digiseller, setDigiseller] = useState('')
  const [active, setActive] = useState(true)
  const [sortOrder, setSortOrder] = useState('0')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [initialPicked, setInitialPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    create.reset()
    update.reset()
    setBuilds.reset()
    setName(plan?.name ?? '')
    setSlug(plan?.slug ?? '')
    setDays(plan?.durationDays?.toString() ?? '30')
    setLifetime(plan ? plan.durationDays === null : false)
    setPrice(plan ? String(Math.round(Number(plan.price))) : '')
    setCurrency(plan?.currency ?? 'RUB')
    setDigiseller(plan?.digisellerProductId?.toString() ?? '')
    setActive(plan?.isActive ?? true)
    setSortOrder(String(plan?.sortOrder ?? 0))
    const builds = new Set((plan?.builds ?? []).map((b) => b.build.id))
    setPicked(builds)
    setInitialPicked(builds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id])

  const priceValue = Number(price)
  const priceValid = price.trim() !== '' && Number.isInteger(priceValue) && priceValue >= 0
  const slugValid = Boolean(plan) || PLAN_SLUG_RE.test(slug)
  const daysValid = Boolean(plan) || lifetime || Number(days) >= 1
  const valid = name.trim() !== '' && priceValid && slugValid && daysValid

  /** Сборки сохраняются вторым запросом: у нового тарифа id появляется только после создания. */
  async function saveBuilds(planId: string) {
    // Новый тариф без галочек сервер сам привязывает к последней сборке — не трогаем.
    if (sameSet(picked, initialPicked)) return
    await setBuilds.mutateAsync({ planId, buildIds: [...picked] })
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    const digisellerId = digiseller.trim() ? Number(digiseller) : null
    try {
      if (plan) {
        await update.mutateAsync({
          planId: plan.id,
          body: { name: name.trim(), price: priceValue, digisellerProductId: digisellerId, isActive: active, sortOrder: Number(sortOrder) || 0 },
        })
        await saveBuilds(plan.id)
      } else {
        const created = await create.mutateAsync({
          slug,
          name: name.trim(),
          durationDays: lifetime ? null : Number(days),
          price: priceValue,
          currency,
          ...(digisellerId ? { digisellerProductId: digisellerId } : {}),
          sortOrder: Number(sortOrder) || 0,
        })
        await saveBuilds(created.id)
      }
      toast.success(t('admin.saved'))
      onOpenChange(false)
    } catch {
      // Ошибку показывает AdminErrorText ниже.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <form onSubmit={(e) => void onSubmit(e)} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>{plan ? t('admin.plans.edit') : t('admin.plans.create')}</DialogTitle>
            <DialogDescription>{t('admin.plans.dialogHint')}</DialogDescription>
          </DialogHeader>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2 sm:col-span-2'>
              <Label htmlFor='plan-name'>{t('admin.plans.field.name')}</Label>
              <Input id='plan-name' value={name} maxLength={128} placeholder={t('admin.plans.field.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
            </div>
            {!plan && (
              <>
                <div className='space-y-2'>
                  <Label htmlFor='plan-slug'>{t('admin.plans.field.slug')}</Label>
                  <Input id='plan-slug' value={slug} className='font-mono' placeholder='30d' onChange={(e) => setSlug(e.target.value.toLowerCase())} />
                  <p className='text-xs text-muted-foreground'>{t('admin.plans.field.slugPurpose')}</p>
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='plan-days'>{t('admin.plans.field.days')}</Label>
                  <Input id='plan-days' type='number' min={1} disabled={lifetime} value={days} onChange={(e) => setDays(e.target.value)} />
                  <label className='flex items-center gap-2 text-sm'>
                    <Checkbox checked={lifetime} onCheckedChange={(v) => setLifetime(v === true)} />
                    {t('admin.plans.field.lifetime')}
                  </label>
                </div>
              </>
            )}
            <div className='space-y-2'>
              <Label htmlFor='plan-price'>{t('admin.plans.field.price')}</Label>
              <Input id='plan-price' type='number' min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            {!plan && (
              <div className='space-y-2'>
                <Label htmlFor='plan-currency'>{t('admin.plans.field.currency')}</Label>
                <Input id='plan-currency' value={currency} maxLength={3} className='uppercase' onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              </div>
            )}
            <div className='space-y-2'>
              <Label htmlFor='plan-digiseller'>{t('admin.plans.field.digiseller')}</Label>
              <Input id='plan-digiseller' type='number' min={1} value={digiseller} placeholder='—' onChange={(e) => setDigiseller(e.target.value)} />
              <p className='text-xs text-muted-foreground'>{t('admin.plans.field.digisellerHint')}</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='plan-sort'>{t('admin.products.field.sortOrder')}</Label>
              <Input id='plan-sort' type='number' value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            {plan && (
              <label className='flex items-center gap-2 text-sm sm:col-span-2'>
                <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
                {t('admin.plans.field.active')}
              </label>
            )}
          </div>

          <div className='space-y-2'>
            <Label>{t('admin.plans.column.builds')}</Label>
            {open && (
              <BuildPicker productId={productId} picked={picked} onPickedChange={setPicked} canUpload={canUpload} onBusyChange={setBusy} />
            )}
          </div>

          <FormProblems
            problems={[
              !name.trim() && t('admin.form.nameRequired'),
              !priceValid && t('admin.plans.problem.price'),
              !slugValid && (slug ? t('admin.plans.problem.slug') : t('admin.form.slugRequired')),
              !daysValid && t('admin.plans.problem.days'),
            ]}
          />
          <AdminErrorText error={mutation.error ?? setBuilds.error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' disabled={!valid || mutation.isPending || setBuilds.isPending || busy}>
              {t('common.action.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

