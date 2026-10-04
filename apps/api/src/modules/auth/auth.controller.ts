import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OAuthProvider } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

import { AuthService, type RequestContext } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { AuthenticatedUser } from './guards/jwt-auth.guard';
import {
  ChangeEmailDto,
  ChangeUsernameDto,
  CreateApiKeyDto,
  DiscordCallbackDto,
  IssueKeysDto,
  LoginDto,
  PasswordChangeDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  ResendVerificationDto,
  PasswordSetDto,
  RecoveryCodesDto,
  RedeemKeyDto,
  RegisterWithKeyDto,
  TelegramCallbackDto,
  RefreshDto,
  RegisterDto,
  TokenPairDto,
  TwoFactorDisableDto,
  TwoFactorEnableDto,
  TwoFactorRequiredDto,
  TwoFactorSetupDto,
  TwoFactorVerifyDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { Audit } from '@common/audit/audit.decorator';
import { RequirePermissions } from '@common/rbac/permissions.decorator';

import { ApiKeyService } from './api-key.service';
import { DiscordProvider } from './oauth/discord.provider';
import { OAuthService } from './oauth/oauth.service';
import { RegistrationKeyService } from './registration-key.service';
import { TwoFactorService } from './two-factor.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly oauth: OAuthService,
    private readonly discord: DiscordProvider,
    private readonly keys: RegistrationKeyService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Регистрация через сайт' })
  @ApiResponse({ status: 409, description: 'Логин или email уже заняты' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: FastifyRequest,
  ): Promise<{ userId: string; message: string }> {
    const { userId } = await this.auth.register(dto, this.context(req));

    // Токен подтверждения в ответ НЕ попадает: он уходит только письмом.
    // Иначе регистрация с чужим адресом сразу давала бы подтверждённый
    // аккаунт, и весь смысл проверки адреса исчезал.
    return {
      userId,
      message: 'Ссылка для подтверждения отправлена на указанный адрес',
    };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтверждение адреса по ссылке из письма' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.auth.verifyEmail(dto.token);
    return { message: 'Адрес подтверждён' };
  }

  @Public()
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Повторная отправка письма подтверждения',
    description:
      'Отвечает успехом ВСЕГДА — как и запрос сброса пароля. Различимый ответ ' +
      'превратил бы форму в бесплатную проверялку «зарегистрирован ли этот адрес». ' +
      'Между письмами выдерживается пауза: адрес получателя выбирает нажимающий ' +
      'кнопку, а письмо уходит НЕ ему.',
  })
  async resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() req: FastifyRequest,
  ): Promise<{ message: string }> {
    await this.auth.resendVerification(dto.email, this.context(req));

    return {
      message: 'Если адрес зарегистрирован и ещё не подтверждён, на него отправлено письмо',
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вход по логину или email' })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 200, type: TwoFactorRequiredDto, description: 'Требуется второй фактор' })
  @ApiResponse({ status: 401, description: 'Неверный логин или пароль' })
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest): Promise<unknown> {
    return this.auth.login(dto, this.context(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Обновление пары токенов' })
  @ApiResponse({
    status: 401,
    description: 'TOKEN_REUSED — токен предъявлен повторно, вся сессия погашена',
  })
  async refresh(@Body() dto: RefreshDto, @Req() req: FastifyRequest): Promise<unknown> {
    return this.auth.refresh(dto.refreshToken, this.context(req));
  }

  // ---------------------------------------------------------------------
  //  Регистрация по ключу
  // ---------------------------------------------------------------------

  @Public()
  @Post('register-with-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Регистрация по ключу',
    description:
      'Ключ уже подтверждает право на доступ, поэтому адрес почты необязателен ' +
      'и подтверждать его не требуется. Если ключ несёт продукт и тариф, ' +
      'сразу выдаётся лицензия.',
  })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 409, description: 'KEY_ALREADY_USED или ALREADY_EXISTS' })
  async registerWithKey(
    @Body() dto: RegisterWithKeyDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.keys.registerWithKey(dto, this.context(req));
  }

  @Post('redeem-key')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Активация ключа на существующем аккаунте' })
  async redeemKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemKeyDto,
  ): Promise<{ licenseKey: string | null }> {
    return this.keys.redeemForUser(dto.code, user.id);
  }

  @Post('registration-keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  // Ключ с продуктом и тарифом — отложенная лицензия, то есть бесплатный товар.
  @RequirePermissions('licenses.create.any')
  @Audit({ action: 'registration_key.issue', entityType: 'registration_key' })
  @ApiOperation({
    summary: 'Выпуск партии регистрационных ключей',
    description: 'Требует права licenses.create. Коды возвращаются один раз.',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — недостаточно прав' })
  async issueKeys(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IssueKeysDto,
  ): Promise<{ codes: string[] }> {
    return this.keys.issue({
      count: dto.count,
      productId: dto.productId,
      planId: dto.planId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdById: user.id,
    });
  }

  // ---------------------------------------------------------------------
  //  OAuth
  // ---------------------------------------------------------------------

  @Public()
  @Get('discord/url')
  @ApiOperation({
    summary: 'Ссылка на окно авторизации Discord',
    description: 'Возвращает URL и одноразовый state. State живёт 10 минут и гасится при обмене.',
  })
  async discordUrl(): Promise<{ url: string; state: string }> {
    return this.discord.buildAuthorizationUrl();
  }

  @Public()
  @Post('discord/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Завершение входа через Discord' })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 200, type: TwoFactorRequiredDto, description: 'Требуется второй фактор — гейт общий с парольным входом' })
  @ApiResponse({
    status: 409,
    description: 'EMAIL_TAKEN_LINK_MANUALLY — адрес занят, требуется явная привязка',
  })
  async discordCallback(
    @Body() dto: DiscordCallbackDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.oauth.loginWithDiscord(dto.code, dto.state, this.context(req));
  }

  @Public()
  @Post('telegram/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Вход через Telegram Login Widget',
    description:
      'Обмена кодом нет: виджет отдаёт подписанные данные прямо в браузер, ' +
      'сервер проверяет подпись и свежесть. Telegram не передаёт адрес почты.',
  })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 200, type: TwoFactorRequiredDto, description: 'Требуется второй фактор — гейт общий с парольным входом' })
  async telegramCallback(
    @Body() dto: TelegramCallbackDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.oauth.loginWithTelegram(dto, this.context(req));
  }

  @Delete('oauth/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Отвязка внешнего аккаунта',
    description: 'Откажет, если это единственный оставшийся способ войти.',
  })
  async unlinkOAuth(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
  ): Promise<{ message: string }> {
    const normalized = provider.toUpperCase();
    if (normalized !== 'DISCORD' && normalized !== 'TELEGRAM') {
      throw new BadRequestException({
        code: 'UNKNOWN_PROVIDER',
        message: 'Неизвестный провайдер',
      });
    }

    await this.oauth.unlink(user.id, normalized as OAuthProvider);
    return { message: 'Аккаунт отвязан' };
  }

  // ---------------------------------------------------------------------
  //  Пароль
  // ---------------------------------------------------------------------

  @Post('password/set')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Первый пароль для аккаунта из OAuth',
    description:
      'Работает только пока пароля нет. Без пароля кабинет доступен, ' +
      'но лицензия не выдаётся и загрузчик не запускается.',
  })
  @ApiResponse({ status: 409, description: 'PASSWORD_ALREADY_SET' })
  async setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PasswordSetDto,
  ): Promise<{ message: string }> {
    await this.auth.setInitialPassword(user.id, dto.password);
    return { message: 'Пароль задан' };
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Запрос сброса пароля',
    description:
      'Отвечает успехом ВСЕГДА, существует адрес или нет. Различимый ответ ' +
      'превратил бы форму в проверялку «зарегистрирован ли этот человек».',
  })
  async requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<{ message: string }> {
    // Токен уходит только письмом — постановка в очередь внутри сервиса.
    // В HTTP-ответ он не попадает даже при найденном пользователе: иначе
    // запрос сброса на чужой адрес сразу давал бы доступ к аккаунту.
    await this.auth.requestPasswordReset(dto.email, this.context(req));

    return {
      message: 'Если такой адрес зарегистрирован, на него отправлена ссылка для сброса',
    };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Подтверждение сброса пароля',
    description: 'При включённом втором факторе требуется код. Все сессии завершаются.',
  })
  @ApiResponse({ status: 401, description: 'TOKEN_INVALID или TWO_FACTOR_REQUIRED' })
  async confirmPasswordReset(
    @Body() dto: PasswordResetConfirmDto,
    @Req() req: FastifyRequest,
  ): Promise<{ message: string }> {
    await this.auth.confirmPasswordReset(dto, this.context(req));
    return { message: 'Пароль изменён, все сессии завершены. Войдите заново.' };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Смена пароля вошедшим пользователем',
    description: 'Текущая сессия сохраняется, остальные завершаются.',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PasswordChangeDto,
  ): Promise<{ message: string; revokedSessions: number }> {
    const { revokedSessions } = await this.auth.changePassword(user.id, user.sessionId, dto);
    return {
      message: 'Пароль изменён',
      revokedSessions,
    };
  }

  // ---------------------------------------------------------------------
  //  Второй фактор
  // ---------------------------------------------------------------------

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Завершение входа вторым фактором' })
  @ApiResponse({ status: 200, type: TokenPairDto })
  @ApiResponse({ status: 401, description: 'TWO_FACTOR_INVALID или TWO_FACTOR_ATTEMPTS_EXCEEDED' })
  async verifyTwoFactor(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.auth.verifyTwoFactor(dto.challengeToken, dto.code, this.context(req));
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Шаг 1: получить секрет и ссылку для QR',
    description:
      'Второй фактор здесь ещё НЕ включается — только после подтверждения кодом ' +
      'на /2fa/enable. Иначе криво отсканированный QR оставляет без доступа навсегда.',
  })
  @ApiResponse({ status: 200, type: TwoFactorSetupDto })
  async setupTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ secret: string; uri: string }> {
    const profile = await this.auth.getPublicUser(user.id);
    return this.twoFactor.setup(user.id, profile.username);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Шаг 2: подтвердить код и включить' })
  @ApiResponse({ status: 200, type: RecoveryCodesDto })
  async enableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TwoFactorEnableDto,
  ): Promise<{ recoveryCodes: string[]; message: string }> {
    const { recoveryCodes } = await this.twoFactor.enable(user.id, dto.code);
    return {
      recoveryCodes,
      message: 'Сохраните коды восстановления — они показываются один раз',
    };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Отключение второго фактора',
    description: 'Требует и пароль, и текущий код. Все сессии пользователя завершаются.',
  })
  async disableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TwoFactorDisableDto,
  ): Promise<{ message: string }> {
    await this.auth.disableTwoFactor(user.id, dto.password, dto.code);
    return { message: 'Двухфакторная аутентификация отключена, все сессии завершены' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Выход: завершает текущую сессию' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<{ message: string }> {
    await this.auth.logout(user.sessionId);
    return { message: 'Сессия завершена' };
  }

  @Get('me')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Текущий пользователь, его права и способы входа',
    description:
      'requiresPassword = true означает, что аккаунт создан через OAuth и пароля ' +
      'не имеет: кабинет доступен, но лицензия не выдаётся и загрузчик не запускается.',
  })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<{
    id: string;
    username: string;
    email: string | null;
    emailVerified: boolean;
    pendingEmail: string | null;
    sessionId: string;
    permissions: string[];
    hasPassword: boolean;
    requiresPassword: boolean;
    providers: string[];
    twoFactorEnabled: boolean;
  }> {
    const methods = await this.auth.getLoginMethods(user.id);

    return {
      id: user.id,
      sessionId: user.sessionId,
      permissions: [...user.permissions].sort(),
      ...methods,
    };
  }

  @Get('me/access')
  @ApiBearerAuth('jwt')
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'Свои роли и права (с уровня поддержки)' })
  async myAccess(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.auth.getAccess(user.id);
  }

  @Post('me/username')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Сменить логин (подтверждение — текущий пароль)' })
  @ApiResponse({ status: 409, description: 'USERNAME_TAKEN' })
  async changeUsername(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeUsernameDto,
  ): Promise<{ message: string }> {
    await this.auth.changeUsername(user.id, dto);
    return { message: 'Логин изменён' };
  }

  @Post('me/email')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Сменить почту: ссылка подтверждения уходит на новый адрес' })
  @ApiResponse({ status: 409, description: 'EMAIL_TAKEN, TOO_FREQUENT' })
  async changeEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeEmailDto,
    @Req() req: FastifyRequest,
  ): Promise<{ message: string }> {
    await this.auth.requestEmailChange(user.id, dto, this.context(req));
    return { message: 'Ссылка для подтверждения отправлена на новый адрес' };
  }

  @Public()
  @Post('email-change/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Подтверждение новой почты по ссылке из письма' })
  async confirmEmailChange(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.auth.confirmEmailChange(dto.token);
    return { message: 'Почта изменена' };
  }

  // ---------------------------------------------------------------------
  //  Ключи API для сборок загрузчика
  // ---------------------------------------------------------------------

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('jwt')
  @RequirePermissions('apikeys.manage')
  @Audit({ action: 'apikey.create', entityType: 'api_key' })
  @ApiOperation({
    summary: 'Выпуск ключа для сборки загрузчика',
    description:
      'Секрет подписи возвращается ОДИН раз. Повторно сервер его не покажет: ' +
      'он шифруется в БД и расшифровывается только для проверки подписи.',
  })
  async createApiKey(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApiKeyDto,
  ): Promise<unknown> {
    return this.apiKeys.create(
      {
        name: dto.name,
        scopes: dto.scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
      user.id,
    );
  }

  @Get('api-keys')
  @ApiBearerAuth('jwt')
  @RequirePermissions('apikeys.manage')
  @ApiOperation({ summary: 'Список ключей. Секреты не отдаются.' })
  async listApiKeys(): Promise<unknown> {
    return this.apiKeys.list();
  }

  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('jwt')
  @RequirePermissions('apikeys.manage')
  @Audit({ action: 'apikey.revoke', entityType: 'api_key', entityIdFrom: 'param:id' })
  @ApiOperation({
    summary: 'Отзыв ключа',
    description: 'Кэш сбрасывается сразу — отзыв нужен тогда, когда ждать нельзя.',
  })
  async revokeApiKey(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    await this.apiKeys.revoke(id, user.id);
    return { message: 'Ключ отозван' };
  }
  /**
   * Контекст запроса для журналов и антифрода.
   *
   * request.ip у Fastify учитывает X-Forwarded-For, потому что адаптер
   * создан с trustProxy — за nginx это единственный способ узнать
   * настоящий адрес клиента.
   */
  private context(req: FastifyRequest): RequestContext {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      clientVersion:
        typeof req.headers['x-client-version'] === 'string'
          ? req.headers['x-client-version']
          : undefined,
    };
  }
}
