import { Module } from '@nestjs/common';

import { AdminModule } from '@modules/admin/admin.module';
import { AuthModule } from '@modules/auth/auth.module';

import { CorrelationService } from './correlation.service';
import { DashboardsService } from './dashboards.service';
import { EdgeController } from './edge.controller';
import { EdgeService } from './edge.service';
import { IpContextService } from './ip-context.service';
import { SecurityCenterController } from './security-center.controller';
import { TrafficAdminService } from './traffic-admin.service';

/**
 * Центр безопасности поверх журналов (AdminModule): правила корреляции,
 * дашборды, приоритет трафика и списки для краевых агентов. TokenService
 * (AuthModule) нужен правилам, которые блокируют пользователя.
 */
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [SecurityCenterController, EdgeController],
  providers: [CorrelationService, DashboardsService, EdgeService, IpContextService, TrafficAdminService],
})
export class SecurityCenterModule {}
