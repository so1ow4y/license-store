import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'auditAction';

export interface AuditMetadata {
  /** Действие: license.extend | user.block | hwid.reset | news.publish */
  action: string;
  /** Тип объекта: user | license | product | news */
  entityType?: string;
  /**
   * Откуда взять идентификатор объекта.
   *
   *   'param:id'  — из параметра маршрута
   *   'body:userId' — из тела запроса
   *   'result:id' — из результата обработчика (для операций создания)
   */
  entityIdFrom?: string;
}

/**
 * Помечает эндпоинт для записи в журнал аудита.
 *
 * Интерцептор снимает автоматическую часть: кто, когда, откуда, с каким
 * requestId. Снимки before/after автоматически снять нельзя — для них
 * сервис вызывает AuditService.record() явно, потому что только он знает,
 * как выглядел объект до изменения.
 *
 * @example
 *   @Audit({ action: 'user.block', entityType: 'user', entityIdFrom: 'param:id' })
 */
export const Audit = (metadata: AuditMetadata): MethodDecorator =>
  SetMetadata(AUDIT_KEY, metadata);
