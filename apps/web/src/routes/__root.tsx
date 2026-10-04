import { Fragment, useEffect } from 'react'
import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { useLocale, useT } from '@/lib/i18n'
import { Toaster } from '@/components/ui/sonner'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'

/**
 * Корень дерева маршрутов.
 *
 * queryClient прокинут в контекст роутера, чтобы `beforeLoad` защищённого
 * layout мог дождаться `/auth/me` до рендера — проверка прав внутри компонента
 * успела бы мигнуть чужим содержимым.
 */
export type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})

function RootLayout() {
  const locale = useLocale()
  const t = useT()

  // Заголовок вкладки задан статикой в `index.html` и до сих пор оставался
  // русским при английском интерфейсе. Вкладка — тоже текст, который человек
  // читает, причём чаще всего среди десятка других.
  useEffect(() => {
    document.title = t('shell.brand')
  }, [t])

  return (
    <>
      {/*
        `key={locale}` перемонтирует всё дерево при смене языка, и это сделано
        намеренно.

        Хук `useT()` перерисовывает только тех, кто его вызвал. Но текст берут
        не только компоненты: `formatDate` подставляет русские названия
        месяцев, `messageForCode` — текст ошибки, `licenseStatusLabel` —
        подпись статуса. Все они читают язык в момент вызова и без
        перерисовки останутся на старом. Без перемонтирования после нажатия
        «RU» получился бы наполовину переведённый экран — худший из исходов,
        потому что выглядит он как поломка данных, а не как язык.

        Цена — сброс несохранённого состояния форм. Смена языка происходит
        осознанно и редко, а «поле ввода очистилось» человек понимает; «часть
        экрана на другом языке» — нет.
      */}
      <Fragment key={locale}>
        <Outlet />
      </Fragment>
      <Toaster duration={5000} position='bottom-right' />
    </>
  )
}
