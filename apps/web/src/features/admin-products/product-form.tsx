import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AdminErrorText } from '@/features/admin/error-text'
import { FormProblems } from '@/features/admin/form-problems'
import { PRODUCT_SLUG_RE, PRODUCT_STATUSES, useUpdateProduct, type AdminProduct, type ProductStatus } from './api'

/** Пустое поле лимита — «брать из настроек» (null на сервере). */
function toLimit(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

export function ProductForm({ product }: { product: AdminProduct }) {
  const t = useT()
  const update = useUpdateProduct(product.id)
  const [name, setName] = useState(product.name)
  const [description, setDescription] = useState(product.description ?? '')
  const [status, setStatus] = useState<ProductStatus>(product.status)
  const [sortOrder, setSortOrder] = useState(String(product.sortOrder))
  const [maxResets, setMaxResets] = useState(product.maxHwidResets?.toString() ?? '')
  const [cooldown, setCooldown] = useState(product.hwidResetCooldownHours?.toString() ?? '')
  const [slug, setSlug] = useState(product.slug)
  const slugValid = PRODUCT_SLUG_RE.test(slug)

  useEffect(() => {
    setSlug(product.slug)
    setName(product.name)
    setDescription(product.description ?? '')
    setStatus(product.status)
    setSortOrder(String(product.sortOrder))
    setMaxResets(product.maxHwidResets?.toString() ?? '')
    setCooldown(product.hwidResetCooldownHours?.toString() ?? '')
  }, [product])

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!slugValid || !name.trim()) return
    const slugChanged = slug !== product.slug
    if (slugChanged && !window.confirm(t('admin.products.slugChangeConfirm'))) return
    update.mutate(
      {
        ...(slugChanged ? { slug } : {}),
        name: name.trim(),
        description: description.trim(),
        status,
        sortOrder: Number(sortOrder) || 0,
        maxHwidResets: toLimit(maxResets),
        hwidResetCooldownHours: toLimit(cooldown),
      },
      { onSuccess: () => toast.success(t('admin.saved')) }
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{t('admin.products.section.main')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label htmlFor='p-name'>{t('admin.products.field.name')}</Label>
            <Input id='p-name' value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label>{t('admin.products.field.status')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ProductStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`admin.products.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>{t('admin.products.field.statusHint')}</p>
          </div>
          <div className='space-y-2 sm:col-span-2'>
            <Label htmlFor='p-description'>{t('admin.products.field.description')}</Label>
            <Textarea
              id='p-description'
              value={description}
              rows={3}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-resets'>{t('admin.products.field.maxResets')}</Label>
            <Input
              id='p-resets'
              type='number'
              min={0}
              max={100}
              value={maxResets}
              placeholder={t('admin.products.field.fromSettings')}
              onChange={(e) => setMaxResets(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-cooldown'>{t('admin.products.field.cooldown')}</Label>
            <Input
              id='p-cooldown'
              type='number'
              min={0}
              max={8760}
              value={cooldown}
              placeholder={t('admin.products.field.fromSettings')}
              onChange={(e) => setCooldown(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-sort'>{t('admin.products.field.sortOrder')}</Label>
            <Input id='p-sort' type='number' value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='p-slug'>{t('admin.products.field.slug')}</Label>
            <Input
              id='p-slug'
              value={slug}
              maxLength={32}
              className='font-mono'
              aria-invalid={!slugValid || undefined}
              onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
            />
            <p className='text-xs text-muted-foreground'>{t('admin.products.field.slugPurpose')}</p>
          </div>
          <div className='sm:col-span-2 space-y-2'>
            <FormProblems
              problems={[
                !name.trim() && t('admin.form.nameRequired'),
                !slugValid && t('admin.products.field.slugHint'),
              ]}
            />
            <AdminErrorText error={update.error} />
            <Button type='submit' disabled={update.isPending || !name.trim() || !slugValid}>
              {t('common.action.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
