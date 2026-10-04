import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Сведения о текущем HTTP-запросе, доступные из любого сервиса без
 * протаскивания параметров: журнал аудита берёт отсюда IP, браузер и ID
 * запроса, если вызывающий их не передал. Заполняется хуком onRequest в main.ts.
 */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestMeta>();

export function currentRequest(): RequestMeta | undefined {
  return requestContext.getStore();
}
