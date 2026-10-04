import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';

/**
 * Права доступа и журнал аудита.
 *
 * Guard и интерцептор регистрируются глобально. Порядок важен: этот
 * модуль подключается в AppModule ПОСЛЕ AuthModule, чтобы JwtAuthGuard
 * успел положить пользователя в запрос раньше, чем PermissionsGuard
 * начнёт проверять его права.
 */
@Global()
@Module({
  providers: [
    PermissionsService,
    AuditService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [PermissionsService, AuditService],
})
export class RbacModule {}
