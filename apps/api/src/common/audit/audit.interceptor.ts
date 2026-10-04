import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorType } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { AUDIT_KEY, type AuditMetadata } from './audit.decorator';
import { AuditService } from './audit.service';

/**
 * Автоматическая часть журнала аудита.
 *
 * Пишет запись ТОЛЬКО при успешном завершении обработчика. Неудачные
 * попытки в аудит не попадают намеренно: для них есть login_history
 * и anti_fraud_events, а смешивание «что сделали» с «что пытались»
 * превращает журнал изменений в журнал трафика.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditMetadata | undefined>(AUDIT_KEY, context.getHandler());
    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request.user;

    return next.handle().pipe(
      tap((result) => {
        // void: запись в журнал не должна задерживать ответ клиенту.
        // Ошибку внутри record() проглотит сам сервис.
        void this.audit.record({
          action: metadata.action,
          actorId: user?.id ?? null,
          actorType: user ? ActorType.USER : ActorType.SYSTEM,
          actorLabel: this.buildActorLabel(request),
          entityType: metadata.entityType ?? null,
          entityId: this.extractEntityId(metadata, request, result),
          // Снимок «после» — тело запроса: что именно просили изменить.
          //
          // Тело пишется ЦЕЛИКОМ, и это единственное место в проекте, где
          // в журнал попадает структура, которую никто не просматривал
          // глазами: у сервисов снимок собирает автор эндпоинта, здесь —
          // фреймворк. Поэтому фильтр обязан жить не тут, а в
          // AuditService.redact(): он рекурсивно вырезает поля из
          // REDACTED_FIELDS (diskId, hwid, password, token, sessionKey,
          // secret, code…) по регистронезависимому сравнению имени.
          // Так новый маршрут с @Audit наследует защиту молча, а не дыру.
          //
          // Дублировать фильтр здесь было бы хуже: два списка запрещённых
          // имён неизбежно разъезжаются, и разъехавшийся обнаружится
          // только по факту утечки в журнале, который хранится годами.
          // Единственное, что обязан сделать автор НОВОГО секретного поля
          // в DTO, — дописать его имя в REDACTED_FIELD_NAMES.
          after: request.body ?? null,
          ip: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
          requestId: String(request.id ?? ''),
        });
      }),
    );
  }

  /**
   * Подпись актора на момент действия.
   *
   * Денормализуется намеренно: если роль потом сменят или сотрудника
   * удалят, в журнале останется правда о том, кем он был тогда.
   */
  private buildActorLabel(request: FastifyRequest): string | null {
    const user = request.user;
    if (!user) return 'system';

    // Права на момент действия — самая полезная часть подписи: по ней
    // видно, чем именно человек мог воспользоваться.
    const marker = user.permissions.has('users.read.any')
      ? 'admin'
      : user.permissions.has('licenses.read.own')
        ? 'user'
        : 'unknown';

    return `${marker}:${user.id}`;
  }

  private extractEntityId(
    metadata: AuditMetadata,
    request: FastifyRequest,
    result: unknown,
  ): string | null {
    if (!metadata.entityIdFrom) return null;

    const [source, field] = metadata.entityIdFrom.split(':');
    if (!field) return null;

    const bag =
      source === 'param'
        ? (request.params as Record<string, unknown> | undefined)
        : source === 'body'
          ? (request.body as Record<string, unknown> | undefined)
          : (result as Record<string, unknown> | undefined);

    const value = bag?.[field];
    return typeof value === 'string' ? value : null;
  }
}
