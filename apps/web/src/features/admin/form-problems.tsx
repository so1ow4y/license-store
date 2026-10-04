import { AlertCircle } from 'lucide-react'

/**
 * Почему кнопка формы неактивна: список того, что не заполнено или заполнено
 * не так. Без него серая кнопка выглядит сломанной.
 */
export function FormProblems({ problems }: { problems: (string | false | null | undefined)[] }) {
  const list = problems.filter((p): p is string => Boolean(p))
  if (list.length === 0) return null
  return (
    <ul className='space-y-0.5 text-sm text-amber-700 dark:text-amber-400'>
      {list.map((problem) => (
        <li key={problem} className='flex items-start gap-1.5'>
          <AlertCircle className='mt-0.5 size-3.5 shrink-0' />
          {problem}
        </li>
      ))}
    </ul>
  )
}
