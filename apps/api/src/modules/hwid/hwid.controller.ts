import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { Audit } from '@common/audit/audit.decorator';
import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { HwidService } from './hwid.service';

export class SetHwidDto {
  @ApiProperty({ description: 'Нормализованный Disk ID', example: 'WD-WCC4N1234567' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  diskId!: string;
}

export class AdjustCounterDto {
  @ApiProperty({ minimum: 0, maximum: 1000 })
  @IsInt()
  @Min(0)
  @Max(1000)
  count!: number;

  @ApiProperty({ description: 'Обоснование — попадает в аудит' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  comment!: string;
}

@ApiTags('hwid')
@Controller('licenses/:licenseId/hwid')
export class HwidController {
  constructor(private readonly hwid: HwidService) {}

  @Get()
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Состояние привязки для кабинета',
    description:
      'Состав HWID не отдаётся — ни хеш, ни исходный идентификатор (ТЗ п.7). ' +
      'Только факт привязки, остаток сбросов и время следующего.',
  })
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('licenseId') licenseId: string,
  ): Promise<unknown> {
    return this.hwid.statusFor(licenseId, user.id);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('hwid.reset.self')
  @Audit({ action: 'hwid.reset.user', entityType: 'license', entityIdFrom: 'param:licenseId' })
  @ApiOperation({
    summary: 'Самостоятельный сброс',
    description: 'Единственный путь, где проверяются кулдаун и общий лимит.',
  })
  @ApiResponse({ status: 409, description: 'HWID_RESET_COOLDOWN или HWID_RESET_LIMIT' })
  async resetSelf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('licenseId') licenseId: string,
  ): Promise<unknown> {
    return this.hwid.resetBySelf(licenseId, user.id);
  }

  @Post('staff-reset')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('hwid.reset.any')
  @Audit({ action: 'hwid.reset.staff', entityType: 'license', entityIdFrom: 'param:licenseId' })
  @ApiOperation({
    summary: 'Сброс силами поддержки',
    description:
      'Счётчик общий: такой сброс расходует лимит пользователя наравне с его ' +
      'собственными. Компенсация — корректировка счётчика.',
  })
  async resetByStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('licenseId') licenseId: string,
  ): Promise<unknown> {
    return this.hwid.resetByStaff(licenseId, user);
  }

  @Post('set')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('hwid.set.manual')
  @Audit({ action: 'hwid.set_manual', entityType: 'license', entityIdFrom: 'param:licenseId' })
  @ApiOperation({
    summary: 'Ручная установка привязки',
    description: 'Для случаев, когда человек сменил железо, а лимит исчерпан.',
  })
  async setManually(
    @CurrentUser() user: AuthenticatedUser,
    @Param('licenseId') licenseId: string,
    @Body() dto: SetHwidDto,
  ): Promise<unknown> {
    return this.hwid.setManually(licenseId, dto.diskId, user);
  }

  @Post('counter')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('hwid.counter.adjust')
  @Audit({ action: 'hwid.counter_adjust', entityType: 'license', entityIdFrom: 'param:licenseId' })
  @ApiOperation({
    summary: 'Корректировка счётчика сбросов',
    description:
      'Сбросив привязку по вине системы, поддержка возвращает счётчик назад. ' +
      'Без этого человек навсегда уходит на ручное обслуживание.',
  })
  async adjustCounter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('licenseId') licenseId: string,
    @Body() dto: AdjustCounterDto,
  ): Promise<unknown> {
    return this.hwid.adjustCounter(licenseId, dto.count, user, dto.comment);
  }

  @Get('history')
  @ApiBearerAuth('jwt')
  @RequirePermissions('hwid.history.read')
  @ApiOperation({
    summary: 'История привязок',
    description: 'Хеши не отдаются даже администратору: глазами они бессмысленны.',
  })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('licenseId') licenseId: string,
  ): Promise<unknown> {
    return this.hwid.history(licenseId, user);
  }
}
