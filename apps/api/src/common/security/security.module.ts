import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { IpBlockGuard } from './ip-block.guard';
import { IpBlockService } from './ip-block.service';
import { IpTrackerService } from './ip-tracker.service';

/**
 * Блокировки адресов и учёт IP пользователей. Регистрируется в AppModule
 * раньше AuthModule: глобальные guard'ы идут в порядке регистрации, и
 * заблокированный адрес отсекается до проверки токена. AuditService берётся
 * из глобального RbacModule.
 */
@Global()
@Module({
  providers: [IpBlockService, IpTrackerService, { provide: APP_GUARD, useClass: IpBlockGuard }],
  exports: [IpBlockService, IpTrackerService],
})
export class SecurityModule {}
