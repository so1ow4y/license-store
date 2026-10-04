import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TelegramLinkScope } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

import { Audit } from '@common/audit/audit.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { BotLinkService } from './bot-link.service';
import { InitTelegramLinkDto } from './dto/telegram-link.dto';

/**
 * Эндпоинты привязки Telegram для кабинета (С4 из §8 ТЗ).
 *
 * Отдельный контроллер, а не новые методы в AuthController: пути те же
 * (/api/v1/auth/telegram/link*), но файл принадлежит модулю бота — там же,
 * где живёт сервис. Иначе правка привязки трогала бы файл, который правят
 * ещё пять сценариев аутентификации.
 *
 * @RequirePermissions намеренно НЕТ: это эндпоинты личного кабинета, они
 * работают только со своим аккаунтом, и владельца проверяет сам сервис —
 * ровно как в HwidController.status.
 *
 * Метода confirm здесь нет и быть не может: подтверждение приходит апдейтом
 * от Telegram, а не запросом от браузера. HTTP-ручка для него означала бы,
 * что токен привязки можно предъявить откуда угодно, минуя чат.
 */
@ApiTags('telegram')
@Controller('auth/telegram/link')
export class TelegramLinkController {
  constructor(private readonly links: BotLinkService) {}

  @Post('init')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @Audit({ action: 'telegram.link.init', entityType: 'user' })
  @ApiOperation({
    summary: 'Выпустить одноразовый код привязки',
    description:
      'Возвращает токен и готовую ссылку t.me/<bot>?start=<token>, срок 10 минут. ' +
      'В базе остаётся только SHA-256 от токена — повторно узнать значение нельзя, ' +
      'потерянный код выпускается заново. При включённой 2FA (и всегда для области ' +
      'ADMIN) требуется подтверждение кодом прямо сейчас: перехваченная сессия иначе ' +
      'заводит второй канал доступа, переживающий смену пароля. Не более 5 выпусков в час.',
  })
  @ApiResponse({ status: 401, description: 'TWO_FACTOR_REQUIRED, TWO_FACTOR_INVALID' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'TELEGRAM_DISABLED — бот выключен рубильником' })
  async init(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitTelegramLinkDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.links.initForUser({
      actor: user,
      scope: dto.scope === 'ADMIN' ? TelegramLinkScope.ADMIN : TelegramLinkScope.USER,
      totpCode: dto.totpCode,
      // req.ip учитывает X-Forwarded-For — адаптер создан с trustProxy,
      // и за nginx это единственный способ узнать настоящий адрес.
      ip: req.ip,
    });
  }

  @Get()
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Состояние привязки',
    description:
      'Числовой telegram_user_id и chat_id наружу не отдаются: они не нужны кабинету, ' +
      'а в связке с @username образуют готовую цель для адресной атаки.',
  })
  async state(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.links.stateFor(user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @Audit({ action: 'telegram.link.revoke', entityType: 'user' })
  @ApiOperation({
    summary: 'Отключить бота',
    description:
      'Разрывает связь чата с аккаунтом и прощается в чат. Вход через Telegram ' +
      '(OAuthAccount провайдера TELEGRAM) НЕ трогается — это другая сущность, и её ' +
      'удаление выбросило бы человека из аккаунта, а иногда и навсегда.',
  })
  @ApiResponse({ status: 404, description: 'TELEGRAM_NOT_LINKED' })
  async revoke(@CurrentUser() user: AuthenticatedUser): Promise<{ message: string }> {
    await this.links.revokeFromSite(user.id, user);
    return { message: 'Telegram отключён' };
  }
}
