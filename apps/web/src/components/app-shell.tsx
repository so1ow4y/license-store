import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet } from '@tanstack/react-router'
import {
  Ban,
  CreditCard,
  Download,
  Gauge,
  HardDriveDownload,
  LayoutDashboard,
  LogIn,
  Siren,
  Workflow,
  Handshake,
  KeyRound,
  LayoutGrid,
  Package,
  Palette,
  Receipt,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Ticket,
  UserCog,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { apiFetch } from '@/lib/api/client'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { hardLogout, useSession } from '@/lib/auth/session'
import { useT, type TFunction } from '@/lib/i18n'
import { setUiPreferences, useUiPreferences, type DockPosition } from '@/lib/ui/preferences'
import { cn } from '@/lib/utils'
import { Dock } from '@/components/layout/dock'
import { type NavGroup as NavGroupType, type NavTarget } from '@/components/layout/types'
import { PasswordRequiredBanner } from '@/components/password-required-banner'

/**
 * Меню приложения. Пункт с `permission` (одно право или любое из списка)
 * скрывается, если прав нет; гейтинг только по правам — роли в `/auth/me` нет.
 *
 * Функция, а не константа: меню пересобирается при смене языка.
 */
type Permission = string | readonly string[]
type GatedTarget = NavTarget & { title: string; icon?: React.ElementType; permission?: Permission }
/** Пункт меню: ссылка или ветка, у которой права проверяются по каждому пункту. */
type GatedNavItem =
  | (GatedTarget & { items?: never })
  | { title: string; icon: React.ElementType; items: GatedTarget[]; url?: never; permission?: never }
type GatedNavGroup = { title: string; items: GatedNavItem[] }

/**
 * Меню ветками: «Кабинет», «Мои продажи» (реселлеру), ветки админки и
 * «Настройки». Ветка раскрывается на месте в развёрнутом доке и подветкой
 * квадратиков в свёрнутом — так в доке видно 5–8 значков вместо пятнадцати.
 */
function buildMenu(t: TFunction): GatedNavGroup[] {
  const LOG_READERS = [PERMISSIONS.AUDIT_READ, PERMISSIONS.LOGINS_READ]
  return [
    {
      title: t('nav.group.workspace'),
      items: [
        {
          title: t('nav.branch.cabinet'),
          icon: LayoutGrid,
          items: [
            { title: t('nav.licenses'), url: '/licenses', icon: LayoutGrid },
            { title: t('nav.catalog'), url: '/catalog', icon: ShoppingCart },
            { title: t('nav.orders'), url: '/orders', icon: Receipt },
            { title: t('nav.activate'), url: '/activate', icon: Ticket },
            { title: t('nav.downloads'), url: '/downloads', icon: Download },
          ],
        },
        {
          title: t('nav.reseller'),
          icon: Store,
          items: [
            { title: t('nav.reseller.overview'), url: '/reseller', icon: Store, permission: PERMISSIONS.RESELLER_PANEL },
            { title: t('nav.reseller.keys'), url: '/reseller', search: { tab: 'keys' }, icon: KeyRound, permission: PERMISSIONS.RESELLER_PANEL },
            { title: t('nav.reseller.clients'), url: '/reseller', search: { tab: 'licenses' }, icon: Users, permission: PERMISSIONS.RESELLER_PANEL },
            { title: t('nav.reseller.balance'), url: '/reseller', search: { tab: 'balance' }, icon: Wallet, permission: PERMISSIONS.RESELLER_PANEL },
          ],
        },
      ],
    },
    {
      title: t('nav.group.admin'),
      items: [
        {
          title: t('nav.branch.users'),
          icon: Users,
          items: [
            { title: t('nav.admin.users'), url: '/admin/users', icon: Users, permission: PERMISSIONS.USERS_READ_ANY },
            { title: t('nav.admin.licenses'), url: '/admin/licenses', icon: ScrollText, permission: PERMISSIONS.LICENSES_READ_ANY },
          ],
        },
        {
          title: t('nav.branch.resellers'),
          icon: Handshake,
          items: [
            {
              title: t('nav.admin.resellers'),
              url: '/admin/resellers',
              icon: Handshake,
              permission: [PERMISSIONS.RESELLERS_READ, PERMISSIONS.RESELLERS_MANAGE],
            },
            {
              title: t('nav.admin.resellerTopups'),
              url: '/admin/resellers',
              search: { tab: 'topups' },
              icon: Wallet,
              permission: [PERMISSIONS.RESELLERS_READ, PERMISSIONS.RESELLERS_TOPUPS_CONFIRM],
            },
          ],
        },
        {
          title: t('nav.branch.catalog'),
          icon: Package,
          items: [
            {
              title: t('nav.admin.products'),
              url: '/admin/products',
              icon: Package,
              permission: [PERMISSIONS.PRODUCTS_MANAGE, PERMISSIONS.PRODUCTS_PAYMENTS_ASSIGN],
            },
            {
              title: t('nav.admin.payments'),
              url: '/admin/payments',
              icon: CreditCard,
              permission: [PERMISSIONS.PAYMENTS_MANAGE, PERMISSIONS.PAYMENT_PROFILES_MANAGE, PERMISSIONS.PRODUCTS_PAYMENTS_ASSIGN],
            },
            { title: t('nav.admin.launcher'), url: '/admin/launcher', icon: HardDriveDownload, permission: PERMISSIONS.LAUNCHER_MANAGE },
          ],
        },
        {
          title: t('nav.branch.sales'),
          icon: Receipt,
          items: [
            { title: t('nav.admin.orders'), url: '/admin/orders', icon: Receipt, permission: PERMISSIONS.ORDERS_READ_ANY },
            // Сделки Digiseller, подтверждённые площадкой, но не выданные.
            { title: t('nav.admin.pendingDeals'), url: '/admin/billing/pending', icon: Wallet, permission: PERMISSIONS.LICENSES_CREATE_ANY },
          ],
        },
        {
          // Центр безопасности: каждый раздел — свой квадратик, как в SIEM.
          title: t('nav.branch.security'),
          icon: ShieldAlert,
          items: [
            { title: t('nav.sec.dashboards'), url: '/admin/security', exact: true, icon: LayoutDashboard, permission: LOG_READERS },
            { title: t('nav.sec.events'), url: '/admin/security/events', icon: ScrollText, permission: PERMISSIONS.AUDIT_READ },
            { title: t('nav.sec.logins'), url: '/admin/security/logins', icon: LogIn, permission: PERMISSIONS.LOGINS_READ },
            { title: t('nav.sec.hits'), url: '/admin/security/hits', icon: Siren, permission: [...LOG_READERS, PERMISSIONS.SECURITY_RULES_MANAGE] },
            { title: t('nav.sec.rules'), url: '/admin/security/rules', icon: Workflow, permission: [...LOG_READERS, PERMISSIONS.SECURITY_RULES_MANAGE] },
            { title: t('nav.sec.blocks'), url: '/admin/security/blocks', icon: Ban, permission: [PERMISSIONS.SECURITY_IP_BLOCK, PERMISSIONS.USERS_BLOCK] },
            { title: t('nav.sec.traffic'), url: '/admin/security/traffic', icon: Gauge, permission: [PERMISSIONS.SECURITY_TRAFFIC_MANAGE, PERMISSIONS.SECURITY_IP_BLOCK] },
          ],
        },
        {
          title: t('nav.branch.system'),
          icon: SlidersHorizontal,
          items: [
            { title: t('nav.admin.settings'), url: '/admin/settings', icon: SlidersHorizontal, permission: PERMISSIONS.SETTINGS_READ },
          ],
        },
      ],
    },
    {
      title: t('nav.group.account'),
      // Профиль, безопасность, внешний вид, Telegram, доступ и роли — разделы
      // одного окна настроек; в доке они подветкой, как остальные ветки.
      items: [
        {
          title: t('nav.settings'),
          icon: Settings,
          items: [
            { title: t('settings.group.profile'), url: '/settings/profile', icon: UserRound },
            { title: t('settings.group.security'), url: '/settings/security/password', match: '/settings/security', icon: ShieldCheck },
            { title: t('settings.group.interface'), url: '/settings/appearance', icon: Palette },
            { title: t('settings.group.integrations'), url: '/settings/telegram', icon: Send },
            { title: t('settings.nav.access'), url: '/settings/access', icon: KeyRound, permission: PERMISSIONS.ROLES_READ },
            {
              title: t('settings.nav.roles'),
              url: '/settings/roles',
              icon: UserCog,
              permission: [PERMISSIONS.ROLES_READ, PERMISSIONS.ROLES_MANAGE],
            },
          ],
        },
      ],
    },
  ]
}

function visibleMenu(
  menu: GatedNavGroup[],
  can: (permission: string) => boolean
): NavGroupType[] {
  const allowed = (permission?: Permission) =>
    !permission || (typeof permission === 'string' ? can(permission) : permission.some(can))
  const strip = ({ permission: _p, ...target }: GatedTarget) => target

  const items = (group: GatedNavGroup): NavGroupType['items'] =>
    group.items.flatMap((item): NavGroupType['items'] => {
      if (!item.items) return allowed(item.permission) ? [strip(item) as NavGroupType['items'][number]] : []
      const subs = item.items.filter((sub) => allowed(sub.permission)).map(strip)
      if (subs.length === 0) return []
      // Ветка из одного пункта — просто ссылка: лишний клик ни к чему.
      if (subs.length === 1) return [{ ...subs[0]!, icon: item.icon } as NavGroupType['items'][number]]
      return [{ title: item.title, icon: item.icon, items: subs }]
    })

  return menu
    .map((group) => ({ title: group.title, items: items(group) }))
    .filter((group) => group.items.length > 0)
}

/** С какой стороны страница освобождает место под док. */
const PADDING: Record<DockPosition, 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom'> = {
  left: 'paddingLeft',
  right: 'paddingRight',
  top: 'paddingTop',
  bottom: 'paddingBottom',
}

/** Свёрнутый док: значок 40px + внутренние отступы + отступ от края. */
const COLLAPSED_SIZE = 66

/**
 * Каркас защищённой части: док навигации, глобальный баннер и содержимое
 * маршрута в `<Outlet />`.
 *
 * Сдвигать ли страницу под док, решает настройка `dockPush`: по умолчанию
 * док лежит поверх, можно отдать место под сам док или ещё и под открытую
 * колонку подпунктов. На телефоне развёрнутый док — временная шторка поверх
 * страницы: место под неё не резервируется, и выбор не запоминается.
 */
export function AppShell() {
  const { me, can, requiresPassword } = useSession()
  const t = useT()
  const prefs = useUiPreferences()
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [reserved, setReserved] = useState({ dock: COLLAPSED_SIZE, strip: 0 })
  const groups = visibleMenu(buildMenu(t), can)

  const expanded = isMobile ? mobileOpen : prefs.dockExpanded
  const overlayOpen = isMobile && mobileOpen && !prefs.dockHidden
  // Спрятанный или выезжающий док места на странице не занимает.
  const autoHide = prefs.dockAutoHide && !isMobile
  const reserve =
    prefs.dockHidden || autoHide || prefs.dockPush === 'none'
      ? 0
      : reserved.dock + (prefs.dockPush === 'all' ? reserved.strip : 0)

  // Пока шторка открыта, страница держит место только под свёрнутый док.
  const overlayRef = useRef(overlayOpen)
  overlayRef.current = overlayOpen
  const onSize = useCallback((dock: number, strip: number) => {
    if (!overlayRef.current) {
      setReserved((prev) => (prev.dock === dock && prev.strip === strip ? prev : { dock, strip }))
    }
  }, [])

  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen])

  function onToggle() {
    if (isMobile) setMobileOpen((open) => !open)
    else setUiPreferences({ dockExpanded: !prefs.dockExpanded })
  }

  // Стабильная ссылка: док держит на ней обработчик клавиатуры.
  const onNavigate = useCallback(() => {
    if (isMobile) setMobileOpen(false)
  }, [isMobile])

  async function onLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // Выйти локально обязаны, даже если сервер не ответил.
    } finally {
      hardLogout('manual')
    }
  }

  return (
    <>
      <Dock
        position={prefs.dock}
        expanded={expanded}
        hidden={prefs.dockHidden}
        autoHide={autoHide}
        subMode={prefs.dockSubMode}
        grow={prefs.dockGrow}
        sizeMode={prefs.dockSizeMode}
        size={prefs.dockSize}
        thickness={prefs.dockWidthMode === 'fixed' ? prefs.dockWidth : null}
        theme={prefs.theme}
        groups={groups}
        username={me?.username ?? ''}
        onToggle={onToggle}
        onToggleHidden={() => {
          setMobileOpen(false)
          setUiPreferences({ dockHidden: !prefs.dockHidden })
        }}
        onNavigate={onNavigate}
        onLogout={onLogout}
        onSize={onSize}
      />

      {overlayOpen && (
        <div
          aria-hidden
          className='fixed inset-0 z-30 bg-black/50'
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* min-w-0: иначе широкая таблица растягивает страницу и прокрутка
          внутри таблиц не включается. */}
      {/* Открытая справа панель записи (components/side-panel) отодвигает
          страницу на свою ширину — список остаётся виден рядом с ней.
          В настройках можно выбрать «поверх», без сдвига. */}
      <div
        className={cn(
          'min-w-0 transition-[padding] duration-200',
          prefs.sidePanelPush && 'xl:pr-[var(--side-panel-width,0px)]'
        )}
        style={{ [PADDING[prefs.dock]]: reserve }}
      >
        {requiresPassword && <PasswordRequiredBanner />}
        <main className='min-w-0 px-4 py-6'>
          <Outlet />
        </main>
      </div>
    </>
  )
}
