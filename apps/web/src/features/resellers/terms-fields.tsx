import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT, type TFunction } from '@/lib/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { adminProductsQueryOptions } from '@/features/admin-products/api'
import { RESELLER_STATUSES, type AdminReseller, type ResellerStatus, type ResellerTermsInput } from './api'

/**
 * Условия реселлера: название, скидка, кредит, сбросы, товары, заметки и
 * (для существующего) статус. Общие для формы создания и панели реселлера.
 */

export type TermsState = ReturnType<typeof useTermsState>

export function useTermsState(reseller?: AdminReseller | null) {
  const [displayName, setDisplayName] = useState(reseller?.displayName ?? '')
  const [status, setStatus] = useState<ResellerStatus>(reseller?.status ?? 'ACTIVE')
  const [discount, setDiscount] = useState(String(Number(reseller?.discountPercent ?? 0)))
  const [credit, setCredit] = useState(String(Number(reseller?.creditLimit ?? 0)))
  const [resets, setResets] = useState(String(reseller?.hwidResetDailyLimit ?? 10))
  const [allowed, setAllowed] = useState<Set<string>>(new Set(reseller?.allowedProductIds ?? []))
  const [notes, setNotes] = useState(reseller?.notes ?? '')

  return {
    displayName,
    setDisplayName,
    status,
    setStatus,
    discount,
    setDiscount,
    credit,
    setCredit,
    resets,
    setResets,
    allowed,
    setAllowed,
    notes,
    setNotes,
    /** Сбросить поля к значениям реселлера (или к пустой форме). */
    reset(next?: AdminReseller | null) {
      setDisplayName(next?.displayName ?? '')
      setStatus(next?.status ?? 'ACTIVE')
      setDiscount(String(Number(next?.discountPercent ?? 0)))
      setCredit(String(Number(next?.creditLimit ?? 0)))
      setResets(String(next?.hwidResetDailyLimit ?? 10))
      setAllowed(new Set(next?.allowedProductIds ?? []))
      setNotes(next?.notes ?? '')
    },
  }
}

/** Проблемы формы человеческим языком; пустой список — можно сохранять. */
export function termsProblems(state: TermsState, t: TFunction): (string | false)[] {
  const discount = Number(state.discount)
  const credit = Number(state.credit)
  const resets = Number(state.resets)
  return [
    !state.displayName.trim() && t('resellers.problem.displayName'),
    !(state.discount.trim() !== '' && discount >= 0 && discount <= 100) && t('resellers.problem.discount'),
    !(state.credit.trim() !== '' && credit >= 0) && t('resellers.problem.credit'),
    !(Number.isInteger(resets) && resets >= 0 && resets <= 1000) && t('resellers.problem.resets'),
  ]
}

export function termsInput(state: TermsState): ResellerTermsInput & { displayName: string } {
  return {
    displayName: state.displayName.trim(),
    discountPercent: Number(state.discount),
    creditLimit: Number(state.credit),
    hwidResetDailyLimit: Number(state.resets),
    allowedProductIds: [...state.allowed],
    notes: state.notes.trim(),
  }
}

export function TermsFields({ state, withStatus }: { state: TermsState; withStatus?: boolean }) {
  const t = useT()
  const products = useQuery(adminProductsQueryOptions())

  function toggle(id: string) {
    const next = new Set(state.allowed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    state.setAllowed(next)
  }

  return (
    <div className='grid gap-4 sm:grid-cols-2'>
      <div className='space-y-2 sm:col-span-2'>
        <Label htmlFor='rs-name'>{t('resellers.field.displayName')}</Label>
        <Input id='rs-name' value={state.displayName} maxLength={128} onChange={(e) => state.setDisplayName(e.target.value)} />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='rs-discount'>{t('resellers.field.discount')}</Label>
        <Input
          id='rs-discount'
          type='number'
          min={0}
          max={100}
          step='0.01'
          value={state.discount}
          onChange={(e) => state.setDiscount(e.target.value)}
        />
        <p className='text-xs text-muted-foreground'>{t('resellers.field.discountHint')}</p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='rs-credit'>{t('resellers.field.credit')}</Label>
        <Input id='rs-credit' type='number' min={0} step='0.01' value={state.credit} onChange={(e) => state.setCredit(e.target.value)} />
        <p className='text-xs text-muted-foreground'>{t('resellers.field.creditHint')}</p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='rs-resets'>{t('resellers.field.resets')}</Label>
        <Input id='rs-resets' type='number' min={0} max={1000} value={state.resets} onChange={(e) => state.setResets(e.target.value)} />
      </div>
      {withStatus && (
        <div className='space-y-2'>
          <Label>{t('resellers.field.status')}</Label>
          <Select value={state.status} onValueChange={(v) => state.setStatus(v as ResellerStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESELLER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`resellers.status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-xs text-muted-foreground'>{t(`resellers.statusHint.${state.status}`)}</p>
        </div>
      )}
      <div className='space-y-2 sm:col-span-2'>
        <Label>{t('resellers.field.products')}</Label>
        <div className='max-h-44 space-y-1 overflow-y-auto rounded-md border p-2'>
          {(products.data ?? []).length === 0 && <p className='px-2 py-1 text-xs text-muted-foreground'>{t('resellers.field.noProducts')}</p>}
          {(products.data ?? []).map((p) => (
            <label key={p.id} className='flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent'>
              <Checkbox checked={state.allowed.has(p.id)} onCheckedChange={() => toggle(p.id)} />
              {p.name}
              <span className='font-mono text-xs text-muted-foreground'>{p.slug}</span>
            </label>
          ))}
        </div>
        <p className='text-xs text-muted-foreground'>{t('resellers.field.productsHint')}</p>
      </div>
      <div className='space-y-2 sm:col-span-2'>
        <Label htmlFor='rs-notes'>{t('resellers.field.notes')}</Label>
        <Textarea id='rs-notes' rows={2} maxLength={2000} value={state.notes} onChange={(e) => state.setNotes(e.target.value)} />
      </div>
    </div>
  )
}
