import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { hasAny, PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText, adminErrorMessage } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { InlineText } from '@/features/admin/inline-edit'
import { AdminPageHeader } from '@/features/admin/page-header'
import { isTwoFactorSetupRequired, TwoFactorSetupRequired } from '@/features/admin/two-factor-gate'
import {
  PRODUCT_SLUG_RE,
  PRODUCT_STATUSES,
  adminProductsQueryOptions,
  useCreateProduct,
  useUpdateAnyProduct,
  type AdminProduct,
  type ProductInput,
  type ProductStatus,
} from '@/features/admin-products/api'
import { ProductStatusBadge } from '@/features/admin-products/status-badge'

export const Route = createFileRoute('/_app/admin/products/')({
  beforeLoad: ({ context }) => {
    if (!hasAny(context.me.permissions, [PERMISSIONS.PRODUCTS_MANAGE, PERMISSIONS.PRODUCTS_PAYMENTS_ASSIGN])) {
      throw redirect({ to: '/403' })
    }
  },
  component: AdminProductsPage,
})

function AdminProductsPage() {
  const t = useT()
  const { can } = useSession()
  const query = useQuery(adminProductsQueryOptions())
  const [creating, setCreating] = useState(false)
  const canEdit = can(PERMISSIONS.PRODUCTS_MANAGE)

  if (isTwoFactorSetupRequired(query.error)) return <TwoFactorSetupRequired />

  return (
    <div className='space-y-6'>
      <AdminPageHeader
        title={t('admin.products.title')}
        description={t('admin.products.description')}
        actions={
          can(PERMISSIONS.PRODUCTS_MANAGE) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className='size-4' />
              {t('admin.products.create')}
            </Button>
          ) : undefined
        }
      />

      {query.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : query.isError ? (
        <AdminErrorText error={query.error} />
      ) : query.data.length === 0 ? (
        <Alert>
          <AlertDescription>{t('admin.products.empty')}</AlertDescription>
        </Alert>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.products.column.name')}</TableHead>
                <TableHead>{t('admin.products.column.slug')}</TableHead>
                <TableHead>{t('admin.products.column.status')}</TableHead>
                <TableHead>{t('admin.products.column.plans')}</TableHead>
                <TableHead>{t('admin.products.column.licenses')}</TableHead>
                <TableHead>{t('admin.products.field.sortOrder')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((product) => (
                <ProductRow key={product.id} product={product} editable={canEdit} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateProductDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

const SLUG_RE = PRODUCT_SLUG_RE

/**
 * Строка товара: название, код, статус и порядок правятся прямо в таблице,
 * клик по любому другому месту строки открывает товар.
 */
function ProductRow({ product, editable }: { product: AdminProduct; editable: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const update = useUpdateAnyProduct()
  const save = (body: ProductInput) => update.mutateAsync({ id: product.id, body })

  function open(event: React.MouseEvent) {
    // Клики по полям правки, выбору статуса и всплывающим спискам — не переход.
    if ((event.target as HTMLElement).closest('button, input, a, [role="combobox"], [role="option"]')) return
    void navigate({ to: '/admin/products/$productId', params: { productId: product.id } })
  }

  return (
    <TableRow className='cursor-pointer' onClick={open}>
      <TableCell className='font-medium'>
        <InlineText
          value={product.name}
          disabled={!editable}
          validate={(next) => (next ? null : t('admin.inline.required'))}
          onSave={(name) => save({ name })}
        />
      </TableCell>
      <TableCell className='text-xs'>
        <InlineText
          value={product.slug}
          mono
          disabled={!editable}
          confirm={t('admin.products.slugChangeConfirm')}
          validate={(next) => (SLUG_RE.test(next) ? null : t('admin.products.field.slugHint'))}
          onSave={(slug) => save({ slug: slug.toLowerCase() })}
        />
      </TableCell>
      <TableCell>
        {editable ? (
          <Select
            value={product.status}
            onValueChange={(status) =>
              void save({ status: status as ProductStatus }).catch((e: unknown) => toast.error(adminErrorMessage(e)))
            }
          >
            <SelectTrigger className='h-8 w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`admin.products.status.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <ProductStatusBadge status={product.status} />
        )}
      </TableCell>
      <TableCell>
        {product.plans.filter((p) => p.isActive).length} / {product.plans.length}
      </TableCell>
      <TableCell>{product._count.licenses}</TableCell>
      <TableCell>
        <InlineText
          value={String(product.sortOrder)}
          type='number'
          disabled={!editable}
          inputClassName='w-20'
          validate={(next) => (/^-?\d+$/.test(next) ? null : t('admin.inline.number'))}
          onSave={(sortOrder) => save({ sortOrder: Number(sortOrder) })}
        />
      </TableCell>
      <TableCell className='w-8 text-muted-foreground'>
        <ChevronRight className='size-4' />
      </TableCell>
    </TableRow>
  )
}

function CreateProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const create = useCreateProduct()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const slugValid = SLUG_RE.test(slug)

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!slugValid || !name.trim()) return
    create.mutate(
      { slug, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) },
      {
        onSuccess: (product) => {
          onOpenChange(false)
          setSlug('')
          setName('')
          setDescription('')
          void navigate({ to: '/admin/products/$productId', params: { productId: product.id } })
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>{t('admin.products.create')}</DialogTitle>
            <DialogDescription>{t('admin.products.createHint')}</DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='product-name'>{t('admin.products.field.name')}</Label>
            <Input id='product-name' value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='product-slug'>{t('admin.products.field.slug')}</Label>
            <Input
              id='product-slug'
              value={slug}
              maxLength={32}
              className='font-mono'
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
            <p className='text-xs text-muted-foreground'>{t('admin.products.field.slugPurpose')}</p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='product-description'>{t('admin.products.field.description')}</Label>
            <Textarea
              id='product-description'
              value={description}
              rows={3}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <FormProblems
            problems={[
              !name.trim() && t('admin.form.nameRequired'),
              !slugValid && (slug ? t('admin.products.field.slugHint') : t('admin.form.slugRequired')),
            ]}
          />
          <AdminErrorText error={create.error} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button type='submit' disabled={!slugValid || !name.trim() || create.isPending}>
              {t('common.action.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
