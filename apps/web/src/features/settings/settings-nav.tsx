import { useMemo, useState, type ElementType } from 'react'
import { Link, useLocation, type LinkProps } from '@tanstack/react-router'
import { ChevronRight, KeyRound, Palette, Search, Send, ShieldCheck, UserRound } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT, type TFunction } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'

/**
 * Дерево разделов настроек: группы раскрываются, поиск ищет по названиям и
 * ключевым словам на обоих языках и раскрывает группы с совпадениями.
 */

type Leaf = { title: string; url: LinkProps['to'] & string; keywords: string; permission?: string }
type Group = { id: string; title: string; icon: ElementType; items: Leaf[] }

/** Какие группы человек раскрыл сам — переживает переходы между страницами. */
const OPEN_KEY = 'lp.settings.open'

function buildTree(t: TFunction): Group[] {
  return [
    {
      id: 'profile',
      title: t('settings.group.profile'),
      icon: UserRound,
      items: [{ title: t('settings.nav.profile'), url: '/settings/profile', keywords: 'профиль логин никнейм почта email username nickname profile' }],
    },
    {
      id: 'security',
      title: t('settings.group.security'),
      icon: ShieldCheck,
      items: [
        { title: t('nav.security.password'), url: '/settings/security/password', keywords: 'пароль password' },
        { title: t('nav.security.twoFactor'), url: '/settings/security/2fa', keywords: '2fa двухфакторная totp код authenticator' },
        { title: t('nav.security.logins'), url: '/settings/security/logins', keywords: 'вход discord telegram oauth способы входа logins' },
      ],
    },
    {
      id: 'interface',
      title: t('settings.group.interface'),
      icon: Palette,
      items: [{ title: t('nav.appearance'), url: '/settings/appearance', keywords: 'тема цвет панель док язык лаванда theme color dock panel language appearance' }],
    },
    {
      id: 'integrations',
      title: t('settings.group.integrations'),
      icon: Send,
      items: [{ title: t('nav.telegram'), url: '/settings/telegram', keywords: 'telegram телеграм бот уведомления bot notifications' }],
    },
    {
      id: 'access',
      title: t('settings.group.access'),
      icon: KeyRound,
      items: [
        {
          title: t('settings.nav.access'),
          url: '/settings/access',
          keywords: 'роль права доступ role permissions access',
          permission: PERMISSIONS.ROLES_READ,
        },
        {
          title: t('settings.nav.roles'),
          url: '/settings/roles',
          keywords: 'роли права создать роль набор действий roles permissions custom role',
          permission: PERMISSIONS.ROLES_READ,
        },
      ],
    },
  ]
}

function readOpen(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeOpen(ids: string[]) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(ids))
  } catch {
    // Не запомнится — не беда.
  }
}

export function SettingsNav({ className }: { className?: string }) {
  const t = useT()
  const { can } = useSession()
  const pathname = useLocation({ select: (location) => location.pathname })
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string[]>(readOpen)

  const tree = useMemo(
    () =>
      buildTree(t)
        .map((group) => ({ ...group, items: group.items.filter((leaf) => !leaf.permission || can(leaf.permission)) }))
        .filter((group) => group.items.length > 0),
    [t, can]
  )

  const needle = search.trim().toLowerCase()
  const visible = needle
    ? tree
        .map((group) => ({
          ...group,
          items: group.items.filter((leaf) =>
            `${group.title} ${leaf.title} ${leaf.keywords}`.toLowerCase().includes(needle)
          ),
        }))
        .filter((group) => group.items.length > 0)
    : tree

  function toggle(id: string, value: boolean) {
    const next = value ? [...new Set([...open, id])] : open.filter((g) => g !== id)
    setOpen(next)
    writeOpen(next)
  }

  return (
    <nav aria-label={t('settings.title')} className={cn('space-y-3', className)}>
      <div className='relative'>
        <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('settings.search')}
          aria-label={t('settings.search')}
          className='pl-8'
        />
      </div>

      {visible.length === 0 && <p className='px-2 text-sm text-muted-foreground'>{t('settings.nothingFound')}</p>}

      <div className='space-y-1'>
        {visible.map((group) => {
          const containsActive = group.items.some((leaf) => pathname.startsWith(leaf.url))
          const isOpen = Boolean(needle) || containsActive || open.includes(group.id)
          const Icon = group.icon
          return (
            <Collapsible key={group.id} open={isOpen} onOpenChange={(value) => toggle(group.id, value)}>
              <CollapsibleTrigger
                className={cn(
                  'group/settings flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-accent',
                  containsActive && 'text-primary'
                )}
              >
                <Icon className='size-4 shrink-0' aria-hidden />
                <span className='flex-1 text-start'>{group.title}</span>
                <ChevronRight className='size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/settings:rotate-90' />
              </CollapsibleTrigger>
              <CollapsibleContent className='CollapsibleContent'>
                <div className='ms-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-s ps-2'>
                  {group.items.map((leaf) => (
                    <Link
                      key={leaf.url}
                      to={leaf.url}
                      className='rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                      activeProps={{ className: 'bg-primary/15 font-medium text-primary' }}
                    >
                      {leaf.title}
                    </Link>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    </nav>
  )
}
