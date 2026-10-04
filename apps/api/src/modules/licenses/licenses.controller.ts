import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LicenseStatus } from '@prisma/client';

import { Audit } from '@common/audit/audit.decorator';
import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import {
  BlockLicenseDto,
  BulkLicensesDto,
  ExtendLicenseDto,
  IssueLicenseDto,
  LicenseKeyDto,
  ListLicensesDto,
  RevokeLicenseDto,
  SetLicenseBuildDto,
} from './dto/licenses.dto';
import { LicensesService } from './licenses.service';

@ApiTags('licenses')
@Controller('licenses')
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get()
  @ApiBearerAuth('jwt')
  // Оба права: администратор видит все лицензии, пользователь свои.
  // Область видимости выбирает сервис — guard про владельца не знает.
  @RequirePermissions('licenses.read.any', 'licenses.read.own')
  @ApiOperation({
    summary: 'Список лицензий',
    description: 'Область видимости зависит от прав: все или только свои.',
  })
  @ApiQuery({ name: 'status', enum: LicenseStatus, required: false })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLicensesDto,
  ): Promise<unknown> {
    return this.licenses.list(user, query);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.block')
  @ApiOperation({ summary: 'Массовая блокировка или разблокировка (до 500 за раз)' })
  async bulk(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkLicensesDto): Promise<unknown> {
    return this.licenses.bulk(user, dto.ids, dto.action, dto.reason);
  }

  @Patch(':id/build')
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.build.assign')
  @ApiOperation({ summary: 'Закрепить сборку за лицензией (null — сборка по тарифу)' })
  async setBuild(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetLicenseBuildDto,
  ): Promise<unknown> {
    return this.licenses.setBuild(id, dto.buildId ?? null, user);
  }

  @Get(':id')
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.read.any', 'licenses.read.own')
  @ApiOperation({ summary: 'Лицензия с историей привязок' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — чужая лицензия' })
  async byId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.licenses.findById(id, user);
  }

  @Get(':id/key')
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.read.any', 'licenses.read.own')
  @Audit({ action: 'license.key.reveal', entityType: 'license', entityIdFrom: 'param:id' })
  @ApiOperation({
    summary: 'Полный ключ лицензии',
    description:
      'Каждый вызов попадает в журнал аудита поимённо. В списке и в карточке ' +
      'ключ отдаётся только маской: он предъявительский, привязки к аккаунту ' +
      'у него нет, и один открытый список выгружал бы сразу все рабочие доступы.',
  })
  @ApiResponse({ status: 200, type: LicenseKeyDto })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — чужая лицензия' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async key(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ key: string }> {
    return this.licenses.revealKey(id, user, 'web');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.create.any')
  @Audit({ action: 'license.issue', entityType: 'license', entityIdFrom: 'result:id' })
  @ApiOperation({
    summary: 'Ручная выдача лицензии',
    description:
      'Срок НЕ начинается здесь: статус PENDING, отсчёт идёт от первого запуска. ' +
      'Иначе подаренный или лежащий в резерве ключ протухает неиспользованным.',
  })
  async issue(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IssueLicenseDto,
  ): Promise<unknown> {
    return this.licenses.issue({
      userId: dto.userId ?? null,
      productId: dto.productId,
      planId: dto.planId,
      issuedById: user.id,
      notes: dto.notes,
    });
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.extend')
  @Audit({ action: 'license.extend', entityType: 'license', entityIdFrom: 'param:id' })
  @ApiOperation({
    summary: 'Продление',
    description:
      'Считается от большей из двух дат — текущего срока и текущего момента. ' +
      'Продливший заранее не теряет остаток, опоздавший получает полный срок.',
  })
  async extend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ExtendLicenseDto,
  ): Promise<unknown> {
    return this.licenses.extend(id, user, dto.planId);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.block')
  @Audit({ action: 'license.block', entityType: 'license', entityIdFrom: 'param:id' })
  @ApiOperation({ summary: 'Блокировка за нарушение' })
  async block(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: BlockLicenseDto,
  ): Promise<unknown> {
    return this.licenses.block(id, dto.reason, user);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.block')
  @Audit({ action: 'license.unblock', entityType: 'license', entityIdFrom: 'param:id' })
  @ApiOperation({
    summary: 'Разблокировка',
    description:
      'Возвращает состояние, соответствующее сроку: истёкшая не воскресает в ACTIVE.',
  })
  async unblock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.licenses.unblock(id, user);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('orders.refund')
  @Audit({ action: 'license.revoke', entityType: 'license', entityIdFrom: 'param:id' })
  @ApiOperation({
    summary: 'Отзыв при возврате средств',
    description:
      'Отличается от блокировки: блокирует администратор за нарушение, ' +
      'отзывает система, когда за лицензию не заплатили. Привязка к устройству снимается.',
  })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RevokeLicenseDto,
  ): Promise<unknown> {
    return this.licenses.revoke(id, dto.reason, user);
  }
}
