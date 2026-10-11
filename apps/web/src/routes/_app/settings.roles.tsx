import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ChevronRight, Copy, Lock, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ACTIVE_ROW, CURSOR_ROW, PanelSection, SidePanel } from '@/components/side-panel'
import { useListHotkeys } from '@/hooks/use-list-hotkeys'
import { BulkConfirmDialog } from '@/features/admin/bulk'
import { AdminErrorText } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import {
  adminRolesQueryOptions,
  permissionsQueryOptions,
  useDeleteRole,
  useSaveRole,
  type AdminRole,
  type PermissionInfo,
} from '@/features/admin-users/api'

/**
 * Роли и права. Право — готовое действие системы (каждое открывает свои
 * маршруты API), роль — набор таких действий. Свою роль администратор
 * собирает из прав, которые есть у него самого, с уровнем ниже своего.
 * Системные роли принадлежат сиду: их можно посмотреть и взять за основу.
 */
export const Route = createFileRoute('/_app/settings/roles')({
  beforeLoad: ({ context }) => {
    if (!hasAny(context.me.permissions, [PERMISSIONS.ROLES_READ, PERMISSIONS.ROLES_MANAGE])) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  component: RolesPage,
})

/** Права уровня пользователя: роль только из них не требует 2FA и может быть низкой. */
const USER_LEVEL = new Set(['licenses.read.own', 'hwid.reset.self', 'orders.read.own', 'reseller.panel'])
/** Признак, а не полномочие: можно включать, даже если у себя его нет. */
const MARKERS = new Set(['reseller.panel'])
const PRIVILEGED_MIN = 60

type Draft = { mode: 'create'; base?: AdminRole } | { mode: 'edit'; role: AdminRole }

function RolesPage() {
  const t = useT()
  const { can } = useSession()
  const canManage = can(PERMISSIONS.ROLES_MANAGE)
  const roles = useQuery(adminRolesQueryOptions())
  const [draft, setDraft] = useState<Draft | null>(null)

  const openId = draft?.mode === 'edit' ? draft.role.id : null
  const cursor = useListHotkeys({
    ids: (roles.data ?? []).map((r) => r.id),
    openedId: openId,
    onOpen: (id) => {
      const role = roles.data?.find((r) => r.id === id)
      if (role) setDraft({ mode: 'edit', role })
    },
    onClose: () => setDraft(null),
  })

  if (isTwoFactorSetupRequired(roles.error)) return <TwoFactorSetupRequired />

  return (
    <div className='max-w-4xl space-y-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h1 className='text-xl font-semibold'>{t('roles.title')}</h1>
          <p className='text-sm text-muted-foreground'>{t('roles.description')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setDraft({ mode: 'create' })}>
            <Plus className='size-4' />
            {t('roles.create')}
          </Button>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>{t('roles.list.title')}</CardTitle>
          <CardDescription>{t('roles.list.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {roles.isPending ? (
            <Skeleton className='h-40 w-full' />
          ) : roles.isError ? (
            <AdminErrorText error={roles.error} />
          ) : (
            <div className='overflow-x-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('roles.column.role')}</TableHead>
                    <TableHead className='text-right'>{t('roles.column.priority')}</TableHead>
                    <TableHead className='text-right'>{t('roles.column.permissions')}</TableHead>
                    <TableHead className='text-right'>{t('roles.column.users')}</TableHead>
                    <TableHead className='w-8' />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.data.map((role) => (
                    <TableRow
                      key={role.id}
                      data-row-id={role.id}
                      className={cn('cursor-pointer', openId === role.id && ACTIVE_ROW, cursor === role.id && CURSOR_ROW)}
                      onClick={() => setDraft(openId === role.id ? null : { mode: 'edit', role })}
                    >
                      <TableCell>
                        <span className='flex flex-wrap items-center gap-2 font-medium'>
                          {role.name}
                          {role.isSystem ? (
                            <Badge variant='secondary' className='gap-1'>
                              <Lock className='size-3' />
                              {t('roles.system')}
                            </Badge>
                          ) : (
                            <Badge variant='outline'>{t('roles.custom')}</Badge>
                          )}
                        </span>
                        <span className='font-mono text-xs text-muted-foreground'>{role.slug}</span>
                        {role.description && <span className='block max-w-md truncate text-xs text-muted-foreground'>{role.description}</span>}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>{role.priority}</TableCell>
                      <TableCell className='text-right tabular-nums'>{role.permissions.length}</TableCell>
                      <TableCell className='text-right tabular-nums'>{role.users}</TableCell>
                      <TableCell>
                        <ChevronRight className={cn('size-4 text-muted-foreground', openId === role.id && 'text-primary')} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {draft && (
        <RolePanel
          key={draft.mode === 'edit' ? draft.role.id : `new-${draft.base?.id ?? ''}`}
          draft={draft}
          canManage={canManage}
          onClose={() => setDraft(null)}
          onCopy={(role) => setDraft({ mode: 'create', base: role })}
          onSaved={(role) => setDraft({ mode: 'edit', role })}
        />
      )}
    </div>
  )
}

/** Латиница для кода роли из названия: «Старший саппорт» → starshiy_sapport. */
function slugify(name: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  const latin = [...name.toLowerCase()].map((ch) => map[ch] ?? ch).join('')
  const slug = latin.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
  return /^[a-z]/.test(slug) ? slug : slug ? `role_${slug}`.slice(0, 64) : ''
}

function RolePanel({
  draft,
  canManage,
  onClose,
  onCopy,
  onSaved,
}: {
  draft: Draft
  canManage: boolean
  onClose: () => void
  onCopy: (role: AdminRole) => void
  onSaved: (role: AdminRole) => void
}) {
  const t = useT()
  const { me } = useSession()
  const permissions = useQuery(permissionsQueryOptions())
  const editing = draft.mode === 'edit' ? draft.role : null
  const source = editing ?? (draft.mode === 'create' ? draft.base : undefined)
  const readOnly = !canManage || Boolean(editing?.isSystem)
  const save = useSaveRole(editing?.id)
  const remove = useDeleteRole()
  const mine = useMemo(() => new Set(me?.permissions ?? []), [me])

  const [name, setName] = useState(editing ? editing.name : source ? t('roles.copyName', { name: source.name }) : '')
  const [slug, setSlug] = useState(editing?.slug ?? (source ? `${source.slug}_copy` : ''))
  const [slugTouched, setSlugTouched] = useState(Boolean(editing || source))
  const [description, setDescription] = useState(source?.description ?? '')
  const [selected, setSelected] = useState<Set<string>>(
    new Set((source?.permissions ?? []).filter((p) => editing || mine.has(p) || MARKERS.has(p)))
  )
  const [priority, setPriority] = useState(String(editing?.priority ?? (source && !source.isSystem ? source.priority : PRIVILEGED_MIN)))
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!slugTouched && !editing) setSlug(slugify(name))
  }, [name, slugTouched, editing])

  const privileged = [...selected].some((p) => !USER_LEVEL.has(p))
  const min = privileged ? PRIVILEGED_MIN : 11
  const priorityValue = Number(priority)
  const problems = readOnly
    ? []
    : [
        !name.trim() && t('roles.problem.name'),
        !editing && !/^[a-z][a-z0-9_]{2,63}$/.test(slug) && t('roles.problem.slug'),
        selected.size === 0 && t('roles.problem.permissions'),
        !(Number.isInteger(priorityValue) && priorityValue >= min && priorityValue <= 99) && t('roles.problem.priority', { min }),
      ]
  const valid = problems.every((p) => !p)

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const map = new Map<string, PermissionInfo[]>()
    for (const p of permissions.data ?? []) {
      if (needle && !`${p.slug} ${p.description ?? ''} ${p.group}`.toLowerCase().includes(needle)) continue
      map.set(p.group, [...(map.get(p.group) ?? []), p])
    }
    return [...map.entries()]
  }, [permissions.data, search])

  /** Право доступно для роли: оно есть у вас (или это признак), а роль не системная. */
  const allowed = (slug: string) => !readOnly && (mine.has(slug) || MARKERS.has(slug))

  function toggle(slug: string, on: boolean) {
    const next = new Set(selected)
    if (on) next.add(slug)
    else next.delete(slug)
    setSelected(next)
  }

  function toggleGroup(items: PermissionInfo[], on: boolean) {
    const next = new Set(selected)
    for (const p of items) {
      if (!allowed(p.slug)) continue
      if (on) next.add(p.slug)
      else next.delete(p.slug)
    }
    setSelected(next)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || readOnly) return
    save.mutate(
      {
        ...(editing ? {} : { slug }),
        name: name.trim(),
        description: description.trim() || null,
        priority: priorityValue,
        permissions: [...selected],
      },
      {
        onSuccess: (role) => {
          toast.success(t('admin.saved'))
          onSaved(role)
        },
      }
    )
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      title={editing ? editing.name : t('roles.create')}
      subtitle={editing ? <span className='font-mono'>{editing.slug}</span> : source ? t('roles.basedOn', { name: source.name }) : undefined}
      badges={
        editing &&
        (editing.isSystem ? (
          <Badge variant='secondary' className='gap-1'>
            <Lock className='size-3' />
            {t('roles.system')}
          </Badge>
        ) : (
          <Badge variant='outline'>{t('roles.custom')}</Badge>
        ))
      }
      actions={
        canManage &&
        editing && (
          <Button variant='ghost' size='sm' onClick={() => onCopy(editing)}>
            <Copy className='size-4' />
            {t('roles.copy')}
          </Button>
        )
      }
    >
      {editing?.isSystem && <p className='rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground'>{t('roles.systemHint')}</p>}

      <form onSubmit={submit} className='space-y-5'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2 sm:col-span-2'>
            <Label htmlFor='role-name'>{t('roles.field.name')}</Label>
            <Input id='role-name' value={name} maxLength={128} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='role-slug'>{t('roles.field.slug')}</Label>
            <Input
              id='role-slug'
              value={slug}
              maxLength={64}
              disabled={readOnly || Boolean(editing)}
              className='font-mono'
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase())
              }}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='role-priority'>{t('roles.field.priority')}</Label>
            <Input
              id='role-priority'
              type='number'
              min={min}
              max={99}
              value={priority}
              disabled={readOnly}
              onChange={(e) => setPriority(e.target.value)}
            />
            <p className='text-xs text-muted-foreground'>{privileged ? t('roles.priorityHint.staff', { min }) : t('roles.priorityHint.user')}</p>
          </div>
          <div className='space-y-2 sm:col-span-2'>
            <Label htmlFor='role-description'>{t('roles.field.description')}</Label>
            <Textarea id='role-description' rows={2} maxLength={500} value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <PanelSection
          title={t('roles.permissions.title', { count: selected.size })}
          description={readOnly ? undefined : t('roles.permissions.hint')}
        >
          <div className='relative'>
            <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input value={search} placeholder={t('roles.permissions.search')} className='pl-8' onChange={(e) => setSearch(e.target.value)} />
          </div>
          {permissions.isPending ? (
            <Skeleton className='h-48 w-full' />
          ) : permissions.isError ? (
            <AdminErrorText error={permissions.error} />
          ) : (
            <div className='space-y-4'>
              {groups.map(([group, items]) => {
                const selectable = items.filter((p) => allowed(p.slug))
                const all = selectable.length > 0 && selectable.every((p) => selected.has(p.slug))
                return (
                  <div key={group} className='space-y-1.5'>
                    <div className='flex items-center justify-between'>
                      <p className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{group}</p>
                      {!readOnly && selectable.length > 0 && (
                        <button type='button' className='text-xs text-primary hover:underline' onClick={() => toggleGroup(items, !all)}>
                          {all ? t('roles.permissions.none') : t('roles.permissions.all')}
                        </button>
                      )}
                    </div>
                    <ul className='grid gap-1'>
                      {items.map((p) => {
                        const can = allowed(p.slug)
                        return (
                          <li key={p.slug}>
                            <label
                              className={cn(
                                'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm',
                                can ? 'cursor-pointer hover:bg-accent' : 'opacity-60',
                                selected.has(p.slug) && 'bg-primary/10'
                              )}
                              title={!can && !readOnly ? t('roles.permissions.notOwned') : undefined}
                            >
                              <Checkbox
                                className='mt-0.5'
                                checked={selected.has(p.slug)}
                                disabled={!can}
                                onCheckedChange={(v) => toggle(p.slug, v === true)}
                              />
                              <span className='min-w-0'>
                                <span className='block'>{p.description ?? p.slug}</span>
                                <span className='font-mono text-[11px] text-muted-foreground'>{p.slug}</span>
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </PanelSection>

        {!readOnly && (
          <>
            <FormProblems problems={problems} />
            <AdminErrorText error={save.error ?? remove.error} />
            <div className='flex flex-wrap gap-2'>
              <Button type='submit' disabled={!valid || save.isPending}>
                {editing ? t('common.action.save') : t('common.action.create')}
              </Button>
              {editing && (
                <Button type='button' variant='outline' className='text-destructive' onClick={() => setDeleting(true)}>
                  <Trash2 className='size-4' />
                  {t('roles.delete')}
                </Button>
              )}
            </div>
          </>
        )}
      </form>

      {editing && (
        <BulkConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={t('roles.deleteTitle', { name: editing.name })}
          description={editing.users > 0 ? t('roles.deleteUsers', { count: editing.users }) : t('roles.deleteHint')}
          count={1}
          destructive
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() =>
            remove.mutate(editing.id, {
              onSuccess: () => {
                toast.success(t('roles.deleted'))
                setDeleting(false)
                onClose()
              },
            })
          }
        />
      )}
    </SidePanel>
  )
}
