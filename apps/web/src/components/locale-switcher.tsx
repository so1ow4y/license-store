import { Languages } from 'lucide-react'
import {
  LOCALES,
  LOCALE_NAMES,
  LOCALE_SHORT,
  setLocale,
  useLocale,
  useT,
} from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Переключатель языка.
 *
 * Сегменты, а не выпадающий список: языков два, и список означал бы два
 * действия (открыть, выбрать) там, где хватает одного. Разворачивать меню
 * ради переключения тумблера — лишняя работа для человека, который уже не
 * может прочитать интерфейс.
 *
 * Подписи — на своём языке («English», «Русский»), никогда не переведённые.
 * Человек, попавший на чужой язык, ищет знакомые буквы: «Russian» в
 * английском интерфейсе прячет выход именно от того, кому он нужен.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  const t = useT()

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-md border p-0.5',
        className
      )}
      role='group'
      aria-label={t('locale.switcher.label')}
    >
      <Languages
        className='mx-1 size-3.5 shrink-0 text-muted-foreground'
        aria-hidden
      />
      {LOCALES.map((option) => {
        const active = option === locale
        return (
          <button
            key={option}
            type='button'
            // `aria-pressed`, а не `aria-selected`: это группа переключателей,
            // а не вкладки и не список. Скринридер объявит «нажата».
            aria-pressed={active}
            // Название языка на нём самом, поэтому подпись помечена своим
            // `lang` — иначе синтезатор прочитает «Русский» по-английски.
            lang={option}
            title={t('locale.switcher.option', {
              language: LOCALE_NAMES[option],
            })}
            onClick={() => setLocale(option)}
            className={cn(
              // `py-1`, а не `py-0.5`: при 20 пикселях высоты кнопка мимо
              // пальца на телефоне и мимо курсора при быстром движении.
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {LOCALE_SHORT[option]}
            <span className='sr-only'> — {LOCALE_NAMES[option]}</span>
          </button>
        )
      })}
    </div>
  )
}
