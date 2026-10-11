import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import {
  AttachProfileDto,
  BulkProfilesDto,
  CreateProfileDto,
  ListProfilesDto,
  MoveProfileDto,
  SearchProfilesDto,
  UpdateProductOptionDto,
  UpdateProfileDto,
} from './dto/orders.dto';
import { PaymentProfilesService } from './payment-profiles.service';

/** Реквизиты оплаты: шаблоны и личные реквизиты товаров. */
@ApiTags('admin')
@ApiBearerAuth('jwt')
@Controller('admin/payment-profiles')
export class PaymentProfilesController {
  constructor(private readonly profiles: PaymentProfilesService) {}

  @Get()
  @RequirePermissions('payment_profiles.manage', 'products.payments.assign', 'resellers.manage')
  @ApiOperation({ summary: 'Шаблоны реквизитов и личные реквизиты товара (ключи не отдаются)' })
  async list(@Query() query: ListProfilesDto): Promise<unknown> {
    return this.profiles.list(query.productId, query.scope);
  }

  @Get('search')
  @RequirePermissions('payment_profiles.manage', 'products.payments.assign', 'payments.manage')
  @ApiOperation({ summary: 'Реестр всех реквизитов: кто создал, когда, к каким товарам привязаны' })
  async search(@Query() query: SearchProfilesDto): Promise<unknown> {
    return this.profiles.search(query);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payment_profiles.manage')
  @ApiOperation({ summary: 'Удалить реквизиты для всех товаров (до 500 за раз)' })
  async bulkDelete(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkProfilesDto): Promise<unknown> {
    return this.profiles.archiveMany(dto.ids, user.id);
  }

  @Post()
  @RequirePermissions('payment_profiles.manage')
  @ApiOperation({ summary: 'Создать шаблон или личные реквизиты товара' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProfileDto): Promise<unknown> {
    return this.profiles.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('payment_profiles.manage')
  @ApiOperation({ summary: 'Изменить реквизиты' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<unknown> {
    return this.profiles.update(id, dto, user.id);
  }

  @Post(':id/resellers/all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('resellers.manage')
  @ApiOperation({ summary: 'Выдать реквизиты раздела реселлеров всем реселлерам (кроме закрытых)' })
  async attachToAllResellers(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.profiles.attachToAllResellers(id, user.id);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payment_profiles.manage')
  @ApiOperation({ summary: 'Перенести реквизиты между разделами товаров и реселлеров (привязки прежнего раздела снимаются)' })
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveProfileDto,
  ): Promise<unknown> {
    return this.profiles.move(id, dto.scope, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('payment_profiles.manage')
  @ApiOperation({ summary: 'Удалить реквизиты для всех: снимаются со всех товаров' })
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.profiles.archive(id, user.id);
  }
}

/** Способы оплаты конкретного товара. */
@ApiTags('admin')
@ApiBearerAuth('jwt')
@Controller('products/:productId/payment-options')
export class ProductPaymentOptionsController {
  constructor(private readonly profiles: PaymentProfilesService) {}

  @Get()
  @RequirePermissions('payment_profiles.manage', 'products.payments.assign')
  @ApiOperation({ summary: 'Способы оплаты товара и все привязанные реквизиты' })
  async list(@Param('productId', ParseUUIDPipe) productId: string): Promise<unknown> {
    return this.profiles.productOptions(productId);
  }

  @Post()
  @RequirePermissions('products.payments.assign')
  @ApiOperation({ summary: 'Привязать реквизиты к товару (их может быть несколько на способ)' })
  async attach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AttachProfileDto,
  ): Promise<unknown> {
    return this.profiles.attach(productId, dto.profileId, user.id);
  }

  @Patch(':profileId')
  @RequirePermissions('products.payments.assign')
  @ApiOperation({ summary: 'Включить или выключить приём на эти реквизиты, порядок' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: UpdateProductOptionDto,
  ): Promise<unknown> {
    return this.profiles.updateOption(productId, profileId, dto, user.id);
  }

  @Delete(':profileId')
  @RequirePermissions('products.payments.assign')
  @ApiOperation({ summary: 'Отвязать реквизиты от товара (сами реквизиты остаются)' })
  async detach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ): Promise<unknown> {
    return this.profiles.detach(productId, profileId, user.id);
  }
}
