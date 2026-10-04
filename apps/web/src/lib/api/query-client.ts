import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './http'

/**
 * Единый QueryClient приложения.
 *
 * Ретраи только на 5xx. Повторять 4xx нельзя принципиально: сервер уже сказал,
 * что запрос неверен, а счётчики вроде TOO_MANY_ATTEMPTS у активации кодов
 * тратятся на каждой попытке — лишний ретрай сжигает лимит живого пользователя.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.isNetworkError) return failureCount < 2
          if (error.status < 500) return false
        }
        return failureCount < 2
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Мутации не ретраим вовсе: среди них есть неидемпотентные
      // (погашение ключа, активация кода покупки).
      retry: false,
    },
  },
})
