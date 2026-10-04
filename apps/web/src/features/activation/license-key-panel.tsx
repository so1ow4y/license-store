import { Link } from '@tanstack/react-router'
import { CopyButton } from '@/components/copy-button'
import { useT } from '@/lib/i18n'

/**
 * Общие куски экрана активации: выданный ключ лицензии и что будет дальше.
 *
 * Кнопка копирования — общая (`@/components/copy-button`). Своя локальная
 * копия здесь была, пока общей не существовало; в общей сохранён её запасной
 * путь через скрытое поле, так что поведение не изменилось.
 */

/**
 * Выданный ключ лицензии.
 *
 * `select-all` и моноширинный шрифт не украшение: ключ длинный, и одно
 * неверное выделение мышью даёт нерабочую строку в поддержке.
 */
export function LicenseKeyPanel({ licenseKey }: { licenseKey: string }) {
  const t = useT()
  const label = t('activation.licenseKey.title')

  return (
    <div className='space-y-2'>
      <p className='text-sm font-medium'>{label}</p>
      <div className='flex flex-wrap items-center gap-2'>
        <code className='min-w-0 flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm'>
          {licenseKey}
        </code>
        <CopyButton value={licenseKey} label={label} withLabel />
      </div>
    </div>
  )
}

/**
 * Что произойдёт дальше после выдачи лицензии.
 *
 * Текст обязателен: `LicensesService.issue` создаёт лицензию со статусом
 * PENDING и `expiresAt = null` (`licenses.service.ts:93-94`), отсчёт срока
 * начинается только при первом запуске лаунчера (`:108`). Без этого пояснения
 * человек, заплативший деньги, видит лицензию без даты окончания и решает,
 * что дни уже идут или что покупка неполноценна.
 */
export function WhatHappensNext({ emailed = true }: { emailed?: boolean }) {
  const t = useT()

  return (
    <ul className='list-inside list-disc space-y-1 text-sm text-muted-foreground'>
      <li>{t('activation.next.termStarts')}</li>
      {emailed && <li>{t('activation.next.emailed')}</li>}
      {/* Фраза разрезана на два ключа, потому что часть её — ссылка. Точка
          снаружи ссылки: подчёркнутая точка выглядит как часть адреса. */}
      <li>
        {t('activation.next.inLicenses')}{' '}
        <Link to='/' className='underline underline-offset-4'>
          {t('activation.next.inLicenses.link')}
        </Link>
        .
      </li>
    </ul>
  )
}
