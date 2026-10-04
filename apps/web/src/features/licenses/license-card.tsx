import { Link } from '@tanstack/react-router'
import { ChevronRight, MonitorSmartphone } from 'lucide-react'
import { useT } from '@/lib/i18n'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { fetchLicenseKey, planDurationText, type LicenseListItem } from './api'
import { CopyButton } from '@/components/copy-button'
import { daysUntil, formatDate } from '@/lib/format/date'
import { LicenseStatusBadge, pendingExplanation } from './status-badge'

/**
 * Карточка лицензии в списке.
 *
 * Показывает ровно то, по чему человек опознаёт покупку: продукт, тариф,
 * статус и срок. Ключ — частично: список лицензий часто оказывается на
 * скриншоте в переписке с поддержкой, а ключ предъявительский.
 */
type LicenseCardProps = {
  license: LicenseListItem
}

export function LicenseCard({ license }: LicenseCardProps) {
  const remaining = daysUntil(license.expiresAt)
  const t = useT()

  return (
    <Card className='flex flex-col'>
      <CardHeader className='gap-1'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <CardTitle className='truncate text-base'>
              {license.product.name}
            </CardTitle>
            <p className='truncate text-xs text-muted-foreground'>
              {license.product.slug}
            </p>
          </div>
          <LicenseStatusBadge status={license.status} />
        </div>
      </CardHeader>

      <CardContent className='flex-1 space-y-3 text-sm'>
        <dl className='space-y-1.5'>
          <Row label={t('licenses.field.plan')}>
            {license.plan.name}
            <span className='text-muted-foreground'>
              {' · '}
              {planDurationText(license.plan.durationDays)}
            </span>
          </Row>

          {/* Статус PENDING объясняем прямо в карточке: без этого дата
              «действует до» отсутствует, и это выглядит как потеря покупки. */}
          {license.status === 'PENDING' ? (
            <Row label={t('licenses.field.term')}>
              <span className='text-muted-foreground'>
                {t('licenses.card.term.notStarted')}
              </span>
            </Row>
          ) : (
            <Row label={t('licenses.field.expires')}>
              {license.expiresAt ? (
                <>
                  {formatDate(license.expiresAt)}
                  {remaining !== null && remaining > 0 && (
                    // Число подставляется в текст словаря, а не склеивается
                    // здесь: форму слова выбирает язык, а не эта строка.
                    <span className='text-muted-foreground'>
                      {' · '}
                      {t('licenses.card.remaining', { count: remaining })}
                    </span>
                  )}
                </>
              ) : (
                t('licenses.plan.lifetime')
              )}
            </Row>
          )}

          {license.activatedAt && (
            <Row label={t('licenses.field.activated')}>
              {formatDate(license.activatedAt)}
            </Row>
          )}
        </dl>

        {license.status === 'PENDING' && (
          <p className='rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground'>
            {pendingExplanation()}
          </p>
        )}

        {/* Сама причина приходит с сервера и остаётся как есть — переводится
            только рамка вокруг неё. */}
        {license.status === 'BLOCKED' && license.blockedReason && (
          <p className='rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'>
            {t('licenses.card.blockedReason', { reason: license.blockedReason })}
          </p>
        )}

        {license.status === 'REVOKED' && license.revokedReason && (
          <p className='rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'>
            {t('licenses.card.revokedReason', { reason: license.revokedReason })}
          </p>
        )}

        <div className='flex items-center gap-2'>
          <code className='min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs'>
            {license.maskedKey}
          </code>
          {/*
            Маску рисует сервер, полный ключ приходит только по нажатию.
            Раньше здесь стояло `value={license.key}`: ключ уже лежал
            в ответе списка, и кнопка просто перекладывала его в буфер.
          */}
          <CopyButton
            value={() => fetchLicenseKey(license.id)}
            label={t('licenses.key.label')}
            size='icon'
          />
        </div>

        <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          <MonitorSmartphone className='size-3.5 shrink-0' />
          {license.currentDeviceId
            ? t('licenses.card.device.bound')
            : t('licenses.card.device.unbound')}
        </p>
      </CardContent>

      <CardFooter>
        <Link
          to='/licenses/$licenseId'
          params={{ licenseId: license.id }}
          className='inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline'
        >
          {t('licenses.card.action.details')}
          <ChevronRight className='size-4' />
        </Link>
      </CardFooter>
    </Card>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-wrap items-baseline gap-x-2'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='min-w-0'>{children}</dd>
    </div>
  )
}
