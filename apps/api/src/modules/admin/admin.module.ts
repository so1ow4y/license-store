import { Module } from '@nestjs/common';

import { AuthModule } from '@modules/auth/auth.module';

import { AdminAuditService } from './admin-audit.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminUsersService } from './admin-users.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminUsersService, AdminSettingsService, AdminAuditService],
})
export class AdminModule {}
