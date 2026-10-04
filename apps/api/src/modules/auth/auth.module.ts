import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';

import { ENV, type Env } from '@common/config/env.schema';
import { LicensesModule } from '@modules/licenses/licenses.module';

import { ApiKeyService } from './api-key.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { DiscordProvider } from './oauth/discord.provider';
import { OAuthService } from './oauth/oauth.service';
import { TelegramProvider } from './oauth/telegram.provider';
import { RegistrationKeyService } from './registration-key.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [
    // Выдача лицензий по регистрационному ключу делегируется
    // LicensesService — единственному месту, где они создаются.
    LicensesModule,
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        signOptions: {
          // HS256 достаточно: токены выпускает и проверяет один сервис.
          // RS256 нужен, когда проверяющих несколько и им нельзя давать
          // ключ подписи — у нас такого случая нет.
          algorithm: 'HS256',
          issuer: 'license-platform',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'license-platform',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TwoFactorService,
    OAuthService,
    DiscordProvider,
    TelegramProvider,
    RegistrationKeyService,
    ApiKeyService,
    {
      // Guard глобальный, а исключения помечаются декоратором @Public.
      // Обратный порядок означает, что забытый декоратор оставляет
      // эндпоинт открытым — и заметить это можно только по факту утечки.
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  // RegistrationKeyService экспортируется для экрана активации в боте:
  // «Активировать покупку → У меня регистрационный ключ» гасит ключ тем же
  // методом redeemForUser, что и кабинет. Второй путь погашения означал бы
  // второй набор проверок на израсходованность — и однажды они разойдутся.
  exports: [AuthService, TokenService, TwoFactorService, RegistrationKeyService],
})
export class AuthModule {}
