import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Audit } from '@common/audit/audit.decorator';
import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Public } from '@modules/auth/decorators/public.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import {
  ConfirmUploadDto,
  CreatePlanDto,
  CreateProductDto,
  CreateVersionDto,
  RequestUploadDto,
  SetManifestDto,
  UpdatePlanDto,
  UpdateProductDto,
} from './dto/products.dto';
import { ProductsService } from './products.service';
import { VersionsService } from './versions.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly versions: VersionsService,
  ) {}

  // ---------------------------------------------------------------------
  //  Каталог
  // ---------------------------------------------------------------------

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Каталог продуктов с тарифами',
    description: 'Только активные. Архивные не показываются, но их лицензии продолжают работать.',
  })
  async list(): Promise<unknown> {
    return this.products.listPublic();
  }

  @Public()
  @Get(':slug')
  @ApiOperation({
    summary: 'Продукт по коду',
    description:
      'Только активные. Скрытые и архивные отвечают 404, а не 403: ' +
      'подтверждать существование невыпущенного продукта незачем.',
  })
  async bySlug(@Param('slug') slug: string): Promise<unknown> {
    return this.products.findBySlug(slug);
  }

  @Get('admin/:id')
  @ApiBearerAuth('jwt')
  // Поддержка открывает карточку, чтобы привязать к товару шаблон оплаты.
  @RequirePermissions('products.manage', 'products.payments.assign')
  @ApiOperation({ summary: 'Карточка продукта для админки: любой статус, все поля' })
  async byIdForAdmin(@Param('id') id: string): Promise<unknown> {
    return this.products.findByIdForAdmin(id);
  }

  // ---------------------------------------------------------------------
  //  Управление продуктами
  // ---------------------------------------------------------------------

  @Get('admin/all')
  @ApiBearerAuth('jwt')
  // Скрытые и архивные товары со счётчиками — только тем, кто ими управляет
  // или привязывает к ним оплату.
  @RequirePermissions('products.manage', 'products.payments.assign')
  @ApiOperation({ summary: 'Полный список, включая архивные и скрытые' })
  async listAll(): Promise<unknown> {
    return this.products.listAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  @RequirePermissions('products.manage')
  @Audit({ action: 'product.create', entityType: 'product', entityIdFrom: 'result:id' })
  @ApiOperation({
    summary: 'Создание продукта',
    description: 'Создаётся скрытым. Показать в каталоге — отдельным изменением статуса.',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ): Promise<unknown> {
    return this.products.create(dto, user.id);
  }

  @Patch(':id')
  @ApiBearerAuth('jwt')
  @RequirePermissions('products.manage')
  @Audit({ action: 'product.update', entityType: 'product', entityIdFrom: 'param:id' })
  @ApiOperation({ summary: 'Изменение продукта' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<unknown> {
    return this.products.update(id, dto, user.id);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('products.manage')
  @Audit({ action: 'product.archive', entityType: 'product', entityIdFrom: 'param:id' })
  @ApiOperation({
    summary: 'Архивирование',
    description:
      'Удаления нет намеренно: на продукт ссылаются лицензии, заказы и версии. ' +
      'Архив снимает с продажи, не трогая выданное.',
  })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.products.archive(id, user.id);
  }

  // ---------------------------------------------------------------------
  //  Тарифы
  // ---------------------------------------------------------------------

  @Post(':id/plans')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  @RequirePermissions('plans.manage')
  @Audit({ action: 'plan.create', entityType: 'license_plan', entityIdFrom: 'result:id' })
  @ApiOperation({ summary: 'Создание тарифа' })
  async createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') productId: string,
    @Body() dto: CreatePlanDto,
  ): Promise<unknown> {
    return this.products.createPlan({ ...dto, productId }, user.id);
  }

  @Patch('plans/:planId')
  @ApiBearerAuth('jwt')
  @RequirePermissions('plans.manage')
  @Audit({ action: 'plan.update', entityType: 'license_plan', entityIdFrom: 'param:planId' })
  @ApiOperation({
    summary: 'Изменение тарифа',
    description:
      'Срок (durationDays) изменить нельзя: у выданных лицензий он не поменяется, ' +
      'и тариф разойдётся со своей историей. Нужен другой срок — новый тариф.',
  })
  async updatePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<unknown> {
    return this.products.updatePlan(planId, dto, user.id);
  }

  // ---------------------------------------------------------------------
  //  Версии
  // ---------------------------------------------------------------------

  @Get(':id/versions')
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.read')
  @ApiOperation({ summary: 'Версии продукта' })
  async listVersions(@Param('id') productId: string): Promise<unknown> {
    return this.versions.listForProduct(productId);
  }

  @Post(':id/versions')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @Audit({ action: 'version.create', entityType: 'product_version', entityIdFrom: 'result:id' })
  @ApiOperation({ summary: 'Черновик версии. Файла и публикации ещё нет.' })
  async createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') productId: string,
    @Body() dto: CreateVersionDto,
  ): Promise<unknown> {
    return this.versions.create({ ...dto, productId }, user.id);
  }

  @Post('versions/:versionId/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage', 'files.upload')
  @ApiOperation({
    summary: 'Ссылка для прямой загрузки дистрибутива',
    description:
      'Файл идёт напрямую в хранилище, минуя API: дистрибутив в десятки мегабайт ' +
      'занимал бы воркер на всё время передачи.',
  })
  async requestUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() dto: RequestUploadDto,
  ): Promise<unknown> {
    return this.versions.requestUpload(versionId, dto, user.id);
  }

  @Post('versions/:versionId/confirm-upload')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @Audit({ action: 'version.upload_confirm', entityType: 'product_version', entityIdFrom: 'param:versionId' })
  @ApiOperation({
    summary: 'Подтверждение загрузки',
    description:
      'SHA-256 считает СЕРВЕР, скачав объект. Принимать хеш от клиента нельзя: ' +
      'им загрузчик проверяет целостность перед установкой.',
  })
  async confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() dto: ConfirmUploadDto,
  ): Promise<unknown> {
    return this.versions.confirmUpload(versionId, dto.objectKey, user.id);
  }

  @Post('versions/:versionId/manifest')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @ApiOperation({
    summary: 'Манифест целостности релиза',
    description:
      'Хеш архива отвечает «скачалось без ошибок», манифест — «файл не подменили ' +
      'после установки».',
  })
  async setManifest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() dto: SetManifestDto,
  ): Promise<unknown> {
    return this.versions.setManifest(versionId, dto.files, user.id);
  }

  @Post('versions/:versionId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @Audit({ action: 'version.publish', entityType: 'product_version', entityIdFrom: 'param:versionId' })
  @ApiOperation({ summary: 'Публикация версии — с этого момента её видит загрузчик' })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
  ): Promise<unknown> {
    return this.versions.publish(versionId, user.id);
  }

  @Post('versions/:versionId/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @Audit({ action: 'version.unpublish', entityType: 'product_version', entityIdFrom: 'param:versionId' })
  @ApiOperation({ summary: 'Снятие с публикации' })
  async unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
  ): Promise<unknown> {
    return this.versions.unpublish(versionId, user.id);
  }
}
