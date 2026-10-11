import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { IpBlockGuard } from './ip-block.guard';
import { IpBlockService } from './ip-block.service';
import { IpTrackerService } from './ip-tracker.service';
import { TrafficPriorityService } from './traffic-priority.service';

/**
 * Блокировки адресов, учёт IP пользователей и приоритет трафика.
 * Регистрируется в AppModule раньше AuthModule: глобальные guard'ы идут в
 * порядке регистрации, и заблокированный адрес отсекается до проверки
 * токена. AuditService берётся из глобального RbacModule.
 *
 * TrafficPriorityService работает не guard'ом, а хуком onRequest Fastify
 * (main.ts): очередь должна стоять до разбора тела и маршрутизации.
 */
@Global()
@Module({
  providers: [IpBlockService, IpTrackerService, TrafficPriorityService, { provide: APP_GUARD, useClass: IpBlockGuard }],
  exports: [IpBlockService, IpTrackerService, TrafficPriorityService],
})
export class SecurityModule {}
