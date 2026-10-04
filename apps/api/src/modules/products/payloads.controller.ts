import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import {
  ConfirmPayloadUploadDto,
  CreatePayloadBuildDto,
  ListPayloadBuildsDto,
  RenamePayloadBuildDto,
  RequestPayloadUploadDto,
  SetPlanBuildsDto,
} from './dto/payloads.dto';
import { PayloadsService } from './payloads.service';

/**
 * Админский путь, которым payload §7 попадает в систему.
 *
 * Маршруты сидят под /products намеренно: payload — артефакт продукта,
 * и права на него те же самые (versions.manage / files.upload), новых
 * записей в матрице RBAC не заводится. Отдельный класс, а не пять методов
 * в ProductsController, — только чтобы поток payload'а можно было читать
 * и ревьюить одним куском; на маршруты и права это не влияет.
 *
 * @Audit здесь НЕ вешается, в отличие от версий: интерцептор пишет строку
 * аудита ПОМИМО той, что пишет сервис (у версий из-за этого на каждую
 * операцию приходится две записи), а снимок before/after есть только
 * у сервиса. Журналирование целиком в PayloadsService.
 */
@ApiTags('products')
@Controller('products')
export class PayloadsController {
  constructor(private readonly payloads: PayloadsService) {}

  @Get(':id/payloads')
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.read', 'licenses.build.assign')
  @ApiOperation({ summary: 'Хранилище сборок товара: поиск name:, version:, status:, plan:, AND/OR/NOT' })
  async list(@Param('id') productId: string, @Query() query: ListPayloadBuildsDto): Promise<unknown> {
    return this.payloads.listForProduct(productId, query);
  }

  @Patch('payloads/:buildId')
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @ApiOperation({ summary: 'Переименовать сборку (можно и опубликованную: в контракт уходит версия)' })
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('buildId') buildId: string,
    @Body() dto: RenamePayloadBuildDto,
  ): Promise<unknown> {
    return this.payloads.rename(buildId, dto.name, user.id);
  }

  @Put('plans/:planId/builds')
  @ApiBearerAuth('jwt')
  @RequirePermissions('plans.manage')
  @ApiOperation({ summary: 'Сборки тарифа: загрузчик получает самую новую опубликованную из них' })
  async setPlanBuilds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: SetPlanBuildsDto,
  ): Promise<unknown> {
    return this.payloads.setPlanBuilds(planId, dto.buildIds, user.id);
  }

  @Post(':id/payloads')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @ApiOperation({
    summary: 'Черновик сборки payload’а',
    description:
      'Собственная ось версий, независимая от версий продукта: новый payload ' +
      'выкатывается, не выпуская новый exe.',
  })
  @ApiResponse({ status: 409, description: 'ALREADY_EXISTS — номер версии у продукта занят' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') productId: string,
    @Body() dto: CreatePayloadBuildDto,
  ): Promise<unknown> {
    return this.payloads.createDraft({ ...dto, productId }, user.id);
  }

  @Post('payloads/:buildId/upload-url')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage', 'files.upload')
  @ApiOperation({
    summary: 'Ссылка для прямой ЗАГРУЗКИ payload’а в хранилище',
    description:
      'Только upload. Ссылки на скачивание payload’а не существует: §7.1 её ' +
      'запрещает, и StorageService отбивает presigned на бакете payload кодом.',
  })
  @ApiResponse({ status: 409, description: 'PAYLOAD_PUBLISHED — опубликованная сборка неизменяема' })
  async requestUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('buildId') buildId: string,
    @Body() dto: RequestPayloadUploadDto,
  ): Promise<unknown> {
    return this.payloads.requestUpload(buildId, dto, user.id);
  }

  @Post('payloads/:buildId/confirm-upload')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @ApiOperation({
    summary: 'Подтверждение загрузки payload’а',
    description:
      'SHA-256 и размер считает СЕРВЕР, прочитав объект. Эталон от клиента не ' +
      'принимается: именно им загрузчик проверяет расшифрованный payload по §7.2.3.',
  })
  @ApiResponse({ status: 409, description: 'PAYLOAD_TOO_LARGE — объект больше потолка §12' })
  async confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('buildId') buildId: string,
    @Body() dto: ConfirmPayloadUploadDto,
  ): Promise<unknown> {
    return this.payloads.confirmUpload(buildId, dto.objectKey, user.id);
  }

  @Post('payloads/:buildId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @ApiOperation({
    summary: 'Публикация сборки — с этого момента её выдаёт загрузчик',
    description:
      'Здесь же последний рубеж перед горячим путём: размер против потолка §12, ' +
      'канонический вид sha256 и версии, наличие объекта в хранилище. ' +
      'После публикации запись неизменяема — перевыпуск это новая сборка.',
  })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('buildId') buildId: string,
  ): Promise<unknown> {
    return this.payloads.publish(buildId, user.id);
  }

  @Post('payloads/:buildId/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('versions.manage')
  @ApiOperation({
    summary: 'Снятие с публикации',
    description:
      'Выдача прекращается, но запись остаётся неизменяемой: файл и эталон ' +
      'обратно на правку не открываются.',
  })
  async unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('buildId') buildId: string,
  ): Promise<unknown> {
    return this.payloads.unpublish(buildId, user.id);
  }
}
