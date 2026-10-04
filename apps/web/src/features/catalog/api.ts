import { queryOptions } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api/client'
import { getLocale, t } from '@/lib/i18n'

/**
 * Витрина: продукты и тарифы с ценами.
 *
 * Эндпоинт ПУБЛИЧНЫЙ и отдаёт только продукты со статусом ACTIVE — скрытые
 * и архивные в выдачу не попадают вовсе, поэтому фильтровать на клиенте
 * нечего и незачем.
 */

export type CatalogPlan = {
  id: string
  slug: string
  name: string
  durationDays: number
  price: string
  currency: string
  /**
   * Номер товара на Digiseller. null означает, что тариф в магазине ещё
   * не заведён — купить его нельзя, и кнопку показывать нечестно.
   */
  digisellerProductId: number | null
}

export type CatalogProduct = {
  id: string
  slug: string
  name: string
  description?: string | null
  plans: CatalogPlan[]
}

export function catalogQueryOptions() {
  return queryOptions({
    queryKey: ['catalog'],
    queryFn: () => apiFetch<CatalogProduct[]>('/products'),
    // Каталог меняется редко: держим дольше обычного, чтобы переход между
    // кабинетом и витриной не дёргал сеть.
    staleTime: 5 * 60_000,
  })
}

/**
 * Ссылка на оплату товара.
 *
 * Формат проверен на живом товаре: адрес отвечает 200 и открывает карточку.
 * Адрес собирается на клиенте, а не приходит с сервера, потому что в базе
 * хранится только номер товара — отдельного поля со ссылкой в схеме нет,
 * а Digiseller по ТЗ §17 единственный канал оплаты, так что вариативности
 * тут не предвидится. Появится второй магазин — поле придётся завести.
 */
export function purchaseUrl(digisellerProductId: number): string {
  return `https://www.digiseller.market/asp/pay_wm.asp?id_d=${digisellerProductId}`
}

/**
 * «30 дней» читается лучше, чем «30 д.», а Lifetime вообще не про дни.
 *
 * Формы числа считает словарь через `Intl.PluralRules`, а не самодельная
 * лесенка `< 5`: у русского форма зависит от последних двух цифр, и «21 день»
 * лесенка превращала в «21 дней».
 */
export function formatDuration(days: number): string {
  if (days <= 0) return t('catalog.plan.lifetime')
  return t('catalog.plan.days', { count: days })
}

export function formatPrice(price: string, currency: string): string {
  const value = Number(price)
  if (!Number.isFinite(value)) return `${price} ${currency}`
  const symbol = currency === 'RUB' ? '₽' : currency
  // Разделитель разрядов берём из языка интерфейса: «12 000 ₽» и «12,000 ₽» —
  // одно и то же число, но чужой разделитель читается как опечатка в цене.
  return `${value.toLocaleString(getLocale(), { maximumFractionDigits: 0 })} ${symbol}`
}
