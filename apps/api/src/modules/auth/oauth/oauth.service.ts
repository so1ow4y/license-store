import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { OAuthProvider, UserStatus } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '@common/prisma/prisma.service';
import { SettingsService } from '@common/settings/settings.service';

import type { LoginResult, RequestContext } from '../auth.service';
import { AuthService } from '../auth.service';
import { DiscordProvider } from './discord.provider';
import { TelegramProvider, type TelegramAuthPayload } from './telegram.provider';

/** Нормализованный профиль, общий для провайдеров. */
interface ExternalProfile {
  provider: OAuthProvider;
  providerUserId: string;
  username: string;
  /** Telegram адрес не отдаёт — здесь всегда null. */
  email: string | null;
  /** Подтвердил ли адрес сам провайдер. */
  emailVerified: boolean;
  raw: Record<string, unknown>;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly discord: DiscordProvider,
    private readonly telegram: TelegramProvider,
  ) {}

  // =========================================================================
  //  ВХОД
  // =========================================================================

  async loginWithDiscord(code: string, state: string, ctx: RequestContext): Promise<LoginResult> {
    // state гасится ДО обмена кода: иначе при ошибке обмена он остаётся
    // валидным и код можно попробовать подставить ещё раз.
    if (!(await this.discord.consumeState(state))) {
      throw new UnauthorizedException({
        code: 'OAUTH_STATE_INVALID',
        message: 'Сессия входа истекла, попробуйте снова',
      });
    }

    const profile = await this.discord.exchangeCode(code);

    return this.resolveLogin(
      {
        provider: OAuthProvider.DISCORD,
        providerUserId: profile.id,
        username: profile.username,
        email: profile.email,
        emailVerified: profile.emailVerified,
        raw: profile.raw,
      },
      ctx,
    );
  }

  async loginWithTelegram(payload: TelegramAuthPayload, ctx: RequestContext): Promise<LoginResult> {
    const profile = this.telegram.verify(payload);

    return this.resolveLogin(
      {
        provider: OAuthProvider.TELEGRAM,
        providerUserId: profile.id,
        username: profile.username,
        // Telegram адрес не отдаёт, поэтому автопривязка по почте
        // здесь невозможна в принципе.
        email: null,
        emailVerified: false,
        raw: profile.raw,
      },
      ctx,
    );
  }

  /** Отвязка. Оставляет пользователя без способа войти — проверяем. */
  async unlink(userId: string, provider: OAuthProvider): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, oauthAccounts: { select: { provider: true } } },
    });

    const remaining = user.oauthAccounts.filter((a) => a.provider !== provider).length;

    if (!user.passwordHash && remaining === 0) {
      throw new ConflictException({
        code: 'LAST_LOGIN_METHOD',
        message: 'Это единственный способ входа. Сначала задайте пароль.',
      });
    }

    await this.prisma.oAuthAccount.deleteMany({ where: { userId, provider } });
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Три ветки: известная привязка, автопривязка по подтверждённой почте,
   * создание нового аккаунта.
   */
  private async resolveLogin(profile: ExternalProfile, ctx: RequestContext): Promise<LoginResult> {
    // --- 1. Привязка уже существует ---------------------------------------
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
      include: { user: true },
    });

    if (linked) {
      if (linked.user.status === UserStatus.BLOCKED) {
        throw new UnauthorizedException({
          code: 'ACCOUNT_BLOCKED',
          message: 'Аккаунт заблокирован. Обратитесь в поддержку.',
        });
      }

      // Профиль обновляем при каждом входе: имя у провайдера меняется,
      // и в поддержке полезно видеть актуальное.
      await this.prisma.oAuthAccount.update({
        where: { id: linked.id },
        data: { providerUsername: profile.username, profile: profile.raw as never },
      });

      return this.issue(linked.user, ctx, profile.provider);
    }

    // --- 2. Автопривязка по почте ----------------------------------------
    if (profile.email) {
      const byEmail = await this.prisma.user.findFirst({
        where: { email: profile.email, deletedAt: null },
      });

      if (byEmail) {
        // Требуем подтверждения С ОБЕИХ СТОРОН. Одного признака от провайдера
        // мало: если наш аккаунт сам не подтверждён, автопривязка отдаст его
        // владельцу почты, которую у нас никто не проверял.
        const canAutoLink = profile.emailVerified && byEmail.emailVerifiedAt !== null;

        if (!canAutoLink) {
          throw new ConflictException({
            code: 'EMAIL_TAKEN_LINK_MANUALLY',
            message:
              'Этот адрес уже используется. Войдите паролем и привяжите аккаунт в настройках.',
          });
        }

        if (byEmail.status === UserStatus.BLOCKED) {
          throw new UnauthorizedException({
            code: 'ACCOUNT_BLOCKED',
            message: 'Аккаунт заблокирован. Обратитесь в поддержку.',
          });
        }

        await this.prisma.oAuthAccount.create({
          data: {
            id: uuidv7(),
            userId: byEmail.id,
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            providerUsername: profile.username,
            profile: profile.raw as never,
          },
        });

        this.logger.log(
          `автопривязка ${profile.provider} к аккаунту ${byEmail.username} по подтверждённой почте`,
        );

        return this.issue(byEmail, ctx, profile.provider);
      }
    }

    // --- 3. Новый аккаунт -------------------------------------------------
    return this.createFromProfile(profile, ctx);
  }

  private async createFromProfile(
    profile: ExternalProfile,
    ctx: RequestContext,
  ): Promise<LoginResult> {
    const username = await this.allocateUsername(profile.username, profile.provider);
    const userId = uuidv7();
    const userRole = await this.prisma.role.findUniqueOrThrow({ where: { slug: 'user' } });

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: userId,
          username,
          email: profile.email,
          // Пароля нет. Это и есть признак «нужно задать пароль»:
          // отдельного поля не нужно. Без пароля кабинет доступен,
          // а загрузчик — нет, там вход по логину и паролю.
          passwordHash: null,
          // Адрес считается подтверждённым, только если это подтвердил
          // провайдер. Иначе останется неподтверждённым, и пользователь
          // пройдёт обычную процедуру.
          emailVerifiedAt: profile.emailVerified ? new Date() : null,
          status: UserStatus.ACTIVE,
          locale: await this.settings.getString('app.default_locale', 'ru'),
        },
      });

      await tx.userRole.create({ data: { userId, roleId: userRole.id } });

      await tx.oAuthAccount.create({
        data: {
          id: uuidv7(),
          userId,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          providerUsername: profile.username,
          profile: profile.raw as never,
        },
      });

      return created;
    });

    this.logger.log(`создан аккаунт ${username} через ${profile.provider}`);
    return this.issue(user, ctx, profile.provider);
  }

  /**
   * Свободный логин на основе имени у провайдера.
   *
   * Имя может быть занято, содержать недопустимые символы или отсутствовать.
   * Правила те же, что при обычной регистрации: латиница, цифры, дефис,
   * подчёркивание — иначе визуально неотличимые символы дадут подмену
   * аккаунта при обращении в поддержку.
   */
  private async allocateUsername(raw: string, provider: OAuthProvider): Promise<string> {
    const base =
      raw
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 24) || `${provider.toLowerCase()}_user`;

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = attempt === 0 ? base : `${base}_${attempt}`;
      const taken = await this.prisma.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }

    // Полсотни занятых подряд — либо совпадение имени у толпы, либо
    // атака на исчерпание. Уходим на гарантированно свободное значение.
    return `${base}_${uuidv7().slice(0, 8)}`;
  }

  private async issue(
    user: { id: string; username: string; email: string | null; locale: string },
    ctx: RequestContext,
    provider: OAuthProvider,
  ): Promise<LoginResult> {
    return this.auth.completeLogin(
      user.id,
      user.username,
      user.email,
      user.locale,
      ctx,
      provider.toLowerCase(),
    );
  }
}
