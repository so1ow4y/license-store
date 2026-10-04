/**
 * Единственный владелец токенов. Больше никто в приложении не трогает
 * localStorage и не держит токены в своём состоянии.
 *
 * Почему так:
 * - сервер не ставит ни одной cookie, refresh-токен принимается в ТЕЛЕ запроса,
 *   значит вариант httpOnly физически недоступен — хранение целиком на клиенте;
 * - access живёт только в памяти: он короткоживущий, а любой XSS, дотянувшийся
 *   до storage, получил бы его бесплатно и надолго;
 * - refresh кладём в localStorage — без этого сессия не переживает перезагрузку
 *   вкладки. Это осознанный компромисс, ущерб ограничен одним ключом и тем,
 *   что кроме этого модуля к нему никто не обращается.
 */

/** Ключ ровно один и объявлен здесь. Искать строку 'lp.rt' в других файлах — признак ошибки. */
const REFRESH_TOKEN_KEY = 'lp.rt'
/** Чья сессия лежит в storage: refresh общий для всех вкладок, а пользователь — нет. */
const SESSION_USER_KEY = 'lp.uid'

/** Пользователь, под которым работает ЭТА вкладка. */
let sessionUserId: string | null = null

/**
 * Запомнить, чья это сессия. Вход под другим аккаунтом в соседней вкладке
 * перезаписывает общий refresh-токен: без этой отметки текущая вкладка
 * молча стала бы чужой на следующем обновлении токена и получала бы
 * «недостаточно прав» на действиях, которые только что работали.
 */
export function rememberSessionUser(id: string): void {
  sessionUserId = id
  try {
    if (localStorage.getItem(SESSION_USER_KEY) !== id) localStorage.setItem(SESSION_USER_KEY, id)
  } catch {
    /* приватный режим — вкладка одна, сравнивать не с чем */
  }
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
  /** Время жизни access в секундах, как его отдал сервер. */
  expiresIn?: number
}

/** Access только в памяти: перезагрузка страницы обязана его терять. */
let accessToken: string | null = null
/** Момент истечения access в миллисекундах epoch; 0 — неизвестно. */
let accessTokenExpiresAt = 0

type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

/** Подписка для React: useSyncExternalStore ждёт функцию отписки. */
export function subscribeTokens(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    // Приватный режим или отключённый storage — работаем как гость на одну вкладку.
    return null
  }
}

/**
 * Истёк ли access по данным сервера. Запас в 5 секунд закрывает расхождение
 * часов клиента и сервера: лучше обновиться на секунду раньше, чем словить 401.
 */
export function isAccessTokenExpired(): boolean {
  if (!accessToken) return true
  if (accessTokenExpiresAt === 0) return false
  return Date.now() >= accessTokenExpiresAt - 5_000
}

/** Есть ли смысл вообще пытаться восстановить сессию. */
export function hasStoredSession(): boolean {
  return Boolean(accessToken ?? getRefreshToken())
}

export function setTokens(pair: TokenPair): void {
  accessToken = pair.accessToken
  accessTokenExpiresAt = pair.expiresIn ? Date.now() + pair.expiresIn * 1000 : 0
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, pair.refreshToken)
  } catch {
    // Записать не вышло — сессия проживёт до закрытия вкладки, это лучше отказа входа.
  }
  emit()
}

export function clearTokens(): void {
  accessToken = null
  accessTokenExpiresAt = 0
  sessionUserId = null
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(SESSION_USER_KEY)
  } catch {
    /* см. выше */
  }
  emit()
}

/**
 * Событие storage приходит только в ДРУГИХ вкладках. Если там сделали выход,
 * ключ пропал — эта вкладка обязана погасить свой access, иначе продолжит
 * дёргать API по сессии, которую пользователь уже закрыл.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // В соседней вкладке вошли под другим аккаунтом: общий refresh уже чужой,
    // поэтому вкладка перезагружается и честно показывает, кто вошёл.
    if (event.key === SESSION_USER_KEY) {
      if (sessionUserId && event.newValue && event.newValue !== sessionUserId) window.location.reload()
      return
    }
    if (event.key !== REFRESH_TOKEN_KEY) return
    if (event.newValue === null) {
      accessToken = null
      accessTokenExpiresAt = 0
      emit()
    }
  })
}
