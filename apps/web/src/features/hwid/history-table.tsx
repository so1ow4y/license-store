import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useT, type TFunction } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format/date'
import type { HwidHistoryEntry } from './api'

/**
 * История привязок к устройству (план п. 3.12).
 *
 * Колонок под хеши и Disk ID нет и не будет: сервер их не отдаёт, а ТЗ
 * запрещает показывать состав HWID даже владельцу.
 *
 * Колонки IP тоже нет: поле заполняется только при первой привязке из
 * лаунчера, у сбросов через кабинет оно всегда NULL (контроллер ip не
 * передаёт). Колонка, пустая в девяти строках из десяти, выглядит как потеря
 * данных.
 *
 * Подписи событий и акторов собираются из самого кода (`FIRST_BIND` →
 * `hwid.history.reason.FIRST_BIND`), а не лежат словарём-константой: константа
 * считалась бы при загрузке модуля и осталась бы на языке, выбранном тогда.
 */
function reasonText(entry: HwidHistoryEntry, t: TFunction): string {
  return t(`hwid.history.reason.${entry.reason}`)
}

/**
 * Кто именно.
 *
 * `actorLabel` — техническая подпись вида `admin:<uuid>`: показывать её
 * целиком незачем, голый идентификатор ничего не объясняет. Исключение —
 * `launcher`: это единственная подпись, которая человеку что-то говорит.
 */
function actorText(entry: HwidHistoryEntry, t: TFunction): string {
  if (entry.actorLabel === 'launcher') return t('hwid.history.actor.launcher')
  return t(`hwid.history.actor.${entry.actorType}`)
}

type HwidHistoryTableProps = {
  entries: HwidHistoryEntry[]
  isLoading?: boolean
}

export function HwidHistoryTable({
  entries,
  isLoading = false,
}: HwidHistoryTableProps) {
  const t = useT()

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-9 w-full' />
        <Skeleton className='h-9 w-full' />
        <Skeleton className='h-9 w-full' />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>{t('hwid.history.empty')}</p>
    )
  }

  return (
    // Таблица шире телефона: горизонтальная прокрутка внутри блока, а не
    // расползание всей страницы.
    <div className='w-full overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='whitespace-nowrap'>
              {t('hwid.history.column.when')}
            </TableHead>
            <TableHead className='whitespace-nowrap'>
              {t('hwid.history.column.event')}
            </TableHead>
            <TableHead className='whitespace-nowrap'>
              {t('hwid.history.column.who')}
            </TableHead>
            <TableHead>{t('hwid.history.column.comment')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className='whitespace-nowrap'>
                {formatDateTime(entry.createdAt)}
              </TableCell>
              <TableCell className='whitespace-nowrap'>
                {/* Незнакомый код события показываем как есть: строка «—»
                    вместо причины скрыла бы событие целиком. */}
                {reasonText(entry, t) || entry.reason}
              </TableCell>
              <TableCell
                className='whitespace-nowrap'
                // Полная подпись остаётся доступной для разбора с поддержкой,
                // но не занимает место на экране.
                title={entry.actorLabel ?? undefined}
              >
                {actorText(entry, t) || t('hwid.history.actor.unknown')}
              </TableCell>
              <TableCell className='text-muted-foreground'>
                {/* Комментарий пишет администратор — это данные, а не текст
                    интерфейса, и переводу не подлежит. */}
                {entry.comment ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
