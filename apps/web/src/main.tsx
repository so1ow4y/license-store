import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { queryClient } from '@/lib/api/query-client'
import { bootstrapSession } from '@/lib/auth/session'
import { initLocale } from '@/lib/i18n'
import { initUiPreferences } from '@/lib/ui/preferences'
import { routeTree } from './routeTree.gen'
import './styles/globals.css'

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

async function start() {
  const rootElement = document.getElementById('root')
  if (!rootElement || rootElement.innerHTML) return

  // Язык выбирается ДО всего остального, включая восстановление сессии:
  // `bootstrapSession` уже ходит в сеть, а `Accept-Language` берётся из этого
  // хранилища. Синхронно и до первого рендера — иначе интерфейс мигнёт
  // английским и перерисуется русским у того, кто выбрал русский.
  initLocale()
  initUiPreferences()

  // «Холодный» refresh ДО первого рендера: access-токен живёт только в памяти
  // и умирает при перезагрузке вкладки. Если не восстановить сессию заранее,
  // `beforeLoad` защищённого layout увидит пустое хранилище и выкинет на вход
  // любого, кто просто нажал F5.
  await bootstrapSession()

  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  )
}

void start()
