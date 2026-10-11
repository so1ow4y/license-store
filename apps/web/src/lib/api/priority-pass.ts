/**
 * Пропуск приоритета (traffic-priority.service.ts на сервере).
 *
 * Доверенный пользователь — администратор, у которого есть вес роли или
 * личный вес в «приоритете трафика», — после входа получает подписанную
 * метку. Браузер шлёт её заголовком X-Priority-Pass с каждым запросом,
 * в том числе со входом: во время DDoS сервер обслуживает такие запросы
 * первыми и пропускает мимо «режима атаки», даже пока токена ещё нет.
 *
 * Хранится в localStorage отдельно от сессии и переживает выход: смысл
 * именно в том, чтобы снова войти, когда остальным сайт отвечает 503.
 * Метка не даёт доступа ни к чему — только место в очереди.
 */

const KEY = 'lp.priorityPass'

type Stored = { pass: string; expiresAt: string }

export function getPriorityPass(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Stored
    if (!stored.pass || new Date(stored.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(KEY)
      return null
    }
    return stored.pass
  } catch {
    return null
  }
}

export function setPriorityPass(value: Stored | null): void {
  try {
    if (value?.pass) localStorage.setItem(KEY, JSON.stringify(value))
    else localStorage.removeItem(KEY)
  } catch {
    // Приватный режим: без пропуска, просто без приоритета.
  }
}
