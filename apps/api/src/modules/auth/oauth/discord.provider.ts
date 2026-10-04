import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { ENV, type Env } from '@common/config/env.schema';
import { RedisService } from '@common/redis/redis.service';

/**
 * Вход через Discord (OAuth 2.0, authorization code).
 *
 * Поток разбит на два вызова, а не на редиректы силами API: SPA сама
 * открывает окно провайдера и присылает нам код. Так API остаётся чистым
 * JSON-сервисом и не завязан на то, где именно живёт фронтенд.
 */

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

/** Запрашиваем минимум: идентификатор, имя и адрес. */
const SCOPES = ['identify', 'email'];

/** TTL state — защиты от CSRF. Пользователю хватает, злоумышленнику нет. */
const STATE_TTL_SEC = 600;
const STATE_PREFIX = 'oauth:state:discord:';

export interface DiscordProfile {
  id: string;
  username: string;
  email: string | null;
  /** Подтвердил ли адрес сам Discord. Ключевое поле для автопривязки. */
  emailVerified: boolean;
  avatarUrl: string | null;
  raw: Record<string, unknown>;
}

@Injectable()
export class DiscordProvider {
  private readonly logger = new Logger(DiscordProvider.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.env.DISCORD_CLIENT_ID && this.env.DISCORD_CLIENT_SECRET);
  }

  /**
   * Ссылка на окно авторизации плюс одноразовый state.
   *
   * state лежит в Redis, а не в куке: загрузчик и мобильный клиент кук
   * не держат, а защита от подмены кода нужна одинаково всем.
   */
  async buildAuthorizationUrl(): Promise<{ url: string; state: string }> {
    this.assertConfigured();

    const state = randomBytes(24).toString('base64url');
    await this.redis.client.set(`${STATE_PREFIX}${state}`, '1', 'EX', STATE_TTL_SEC);

    const params = new URLSearchParams({
      client_id: this.env.DISCORD_CLIENT_ID!,
      redirect_uri: this.env.DISCORD_REDIRECT_URI!,
      response_type: 'code',
      scope: SCOPES.join(' '),
      // Заставляет Discord каждый раз спрашивать подтверждение вместо
      // молчаливого редиректа — пользователь видит, что именно происходит.
      prompt: 'consent',
      state,
    });

    return { url: `${AUTHORIZE_URL}?${params.toString()}`, state };
  }

  /**
   * Гашение state. Атомарно: повторное предъявление того же значения
   * не пройдёт, даже если запросы придут одновременно.
   */
  async consumeState(state: string): Promise<boolean> {
    const removed = await this.redis.client.del(`${STATE_PREFIX}${state}`);
    return removed === 1;
  }

  /** Обмен кода на профиль. */
  async exchangeCode(code: string): Promise<DiscordProfile> {
    this.assertConfigured();

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.DISCORD_CLIENT_ID!,
        client_secret: this.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.env.DISCORD_REDIRECT_URI!,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      // Тело ответа Discord наружу не отдаём: там бывают подробности
      // о нашем приложении, клиенту они ни к чему.
      this.logger.warn(`обмен кода Discord отклонён: HTTP ${tokenResponse.status}`);
      throw new UnauthorizedException({
        code: 'OAUTH_EXCHANGE_FAILED',
        message: 'Не удалось завершить вход через Discord',
      });
    }

    const { access_token: accessToken } = (await tokenResponse.json()) as {
      access_token?: string;
    };

    if (!accessToken) {
      throw new UnauthorizedException({
        code: 'OAUTH_EXCHANGE_FAILED',
        message: 'Не удалось завершить вход через Discord',
      });
    }

    const userResponse = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!userResponse.ok) {
      throw new UnauthorizedException({
        code: 'OAUTH_PROFILE_FAILED',
        message: 'Не удалось получить профиль Discord',
      });
    }

    const raw = (await userResponse.json()) as Record<string, unknown>;

    return {
      id: String(raw['id']),
      username: String(raw['username'] ?? ''),
      email: typeof raw['email'] === 'string' ? raw['email'] : null,
      // Discord отдаёт verified отдельным полем. Именно оно решает,
      // можно ли автоматически привязать вход к существующему аккаунту.
      emailVerified: raw['verified'] === true,
      avatarUrl:
        typeof raw['avatar'] === 'string'
          ? `https://cdn.discordapp.com/avatars/${String(raw['id'])}/${raw['avatar']}.png`
          : null,
      raw,
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new UnauthorizedException({
        code: 'OAUTH_NOT_CONFIGURED',
        message: 'Вход через Discord не настроен',
      });
    }
  }
}
