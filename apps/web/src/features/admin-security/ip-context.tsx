import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Crown, ShieldCheck } from 'lucide-react'
import { PERMISSIONS } from '@/lib/auth/permissions'
import { useSession } from '@/lib/auth/session'
import { useT } from '@/lib/i18n'
import { formatDateTime, formatRelative } from '@/lib/format/date'
import { PanelFacts, PanelSection } from '@/components/side-panel'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminErrorText } from '@/features/admin/error-text'
import { ipContextQueryOptions } from './center-api'
import { HitStatusBadge, LevelBadge, parseUserAgent, SeverityBadge } from './labels'

/** Уровень роли, с которого человек — сотрудник (PRIVILEGED_ROLE_PRIORITY на сервере). */
const STAFF_PRIORITY = 60

/**
 * Контекст адреса в панели события: что за сеть, кто с неё ходил, сколько
 * неудачных входов, какие блоки и сработки уже были. Загружается лениво —
 * только когда панель открыта.
 */
export function IpContextSection({ ip }: { ip: string }) {
  const t = useT()
  const { can } = useSession()
  const context = useQuery(ipContextQueryOptions(ip))

  return (
    <PanelSection title={t('sec.ip.title')}>
      {context.isPending ? (
        <Skeleton className='h-32 w-full' />
      ) : context.isError ? (
        <AdminErrorText error={context.error} />
      ) : (
        <div className='space-y-3'>
          <div className='flex flex-wrap gap-1.5'>
            <Badge variant='outline'>{t(`sec.ip.scope.${context.data.scope}`)}</Badge>
            <Badge variant='outline'>{context.data.family === 'ipv4' ? 'IPv4' : 'IPv6'}</Badge>
            {context.data.trusted.length > 0 && (
              <Badge className='border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'>
                <ShieldCheck />
                {t('sec.ip.trusted', { weight: context.data.weight })}
              </Badge>
            )}
            {context.data.blocks.map((block) => (
              <LevelBadge key={block.id} level={block.level} ports={block.ports} />
            ))}
          </div>
          <PanelFacts
            rows={[
              [t('sec.ip.reverse'), context.data.reverseDns ? <span className='font-mono text-xs break-all'>{context.data.reverseDns}</span> : '—'],
              [
                t('sec.ip.failed24h'),
                <span className={context.data.logins.failed24h > 10 ? 'font-semibold text-destructive' : undefined}>
                  {context.data.logins.failed24h}
                  <span className='text-muted-foreground'> · {t('sec.ip.success24h', { n: context.data.logins.success24h })}</span>
                </span>,
              ],
              [t('sec.ip.logins90d'), t('sec.ip.loginsTotal', { total: context.data.logins.total, failed: context.data.logins.failed })],
              [t('sec.ip.accounts'), String(context.data.logins.users)],
              [t('sec.ip.countries'), context.data.logins.countries?.length ? context.data.logins.countries.join(', ') : '—'],
              [
                t('sec.ip.seen'),
                context.data.logins.firstSeen
                  ? `${formatDateTime(context.data.logins.firstSeen)} — ${formatRelative(context.data.logins.lastSeen)}`
                  : '—',
              ],
              [t('sec.ip.audit24h'), `${context.data.audit.total24h}${context.data.audit.lastAction ? ` · ${context.data.audit.lastAction}` : ''}`],
            ]}
          />

          {context.data.users.length > 0 && (
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>{t('sec.ip.users')}</p>
              <ul className='space-y-1'>
                {context.data.users.map((user) => (
                  <li key={user.id} className='flex items-center justify-between gap-2 text-sm'>
                    <span className='flex min-w-0 items-center gap-1.5'>
                      {user.rolePriority >= STAFF_PRIORITY && <Crown className='size-3.5 shrink-0 text-amber-500' aria-label={t('sec.ip.staff')} />}
                      {can(PERMISSIONS.USERS_READ_ANY) ? (
                        <Link to='/admin/users' search={{ open: user.id }} className='truncate hover:underline'>
                          {user.username}
                        </Link>
                      ) : (
                        <span className='truncate'>{user.username}</span>
                      )}
                      {user.status === 'BLOCKED' && <Badge variant='destructive'>{t('sec.ip.blocked')}</Badge>}
                    </span>
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      {t('sec.ip.hits', { n: user.hits })} · {formatRelative(user.lastSeenAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {context.data.hits.length > 0 && (
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>{t('sec.ip.hitsTitle')}</p>
              <ul className='space-y-1'>
                {context.data.hits.map((hit) => (
                  <li key={hit.id} className='flex flex-wrap items-center gap-1.5 text-sm'>
                    <SeverityBadge severity={hit.severity} />
                    <Link to='/admin/security/hits' search={{ open: hit.id }} className='min-w-0 flex-1 truncate hover:underline'>
                      {hit.ruleName}
                    </Link>
                    <HitStatusBadge status={hit.status} />
                    <span className='text-xs text-muted-foreground'>{formatRelative(hit.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </PanelSection>
  )
}

/** Клиент из User-Agent: браузер, система, тип — и сырая строка под ними. */
export function UserAgentFacts({ ua }: { ua: string | null }) {
  const t = useT()
  const parsed = parseUserAgent(ua)
  if (!ua || !parsed) return <span>—</span>
  return (
    <span className='block space-y-0.5'>
      <span className='flex flex-wrap items-center gap-1.5'>
        <span className='font-medium'>{parsed.client}</span>
        {parsed.os && <span className='text-muted-foreground'>· {parsed.os}</span>}
        <Badge variant={parsed.device === 'tool' || parsed.device === 'bot' ? 'destructive' : 'outline'}>
          {t(`sec.ua.${parsed.device}`)}
        </Badge>
      </span>
      <span className='block text-[11px] break-all text-muted-foreground'>{ua}</span>
    </span>
  )
}
