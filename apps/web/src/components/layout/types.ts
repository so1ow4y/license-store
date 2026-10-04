import { type LinkProps } from '@tanstack/react-router'

type BaseNavItem = {
  title: string
  icon?: React.ElementType
}

/**
 * Адрес пункта меню — строго существующий маршрут: опечатка не пройдёт
 * типизацию. `search` — вкладка страницы (`?tab=…`): пункт «Ключи» ведёт
 * на панель реселлера сразу во вкладку ключей.
 */
type NavTarget = { url: LinkProps['to']; search?: Record<string, string> }

type NavLink = BaseNavItem & NavTarget & { items?: never }

/** Ветка меню (например, «Реселлеры»): раскрывается и показывает свои пункты. */
type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & NavTarget)[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type NavGroup = {
  title: string
  items: NavItem[]
}

export type { NavGroup, NavItem, NavCollapsible, NavLink, NavTarget }
