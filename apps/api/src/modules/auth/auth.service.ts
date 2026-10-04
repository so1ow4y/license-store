import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { NotificationChannel, Prisma, UserStatus, VerificationTokenType } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { SettingsService } from '@common/settings/settings.service';
import { NotificationService } from '@modules/notifications/notification.service';

import { TokenService, type TokenPair } from './token.service';
import { TwoFactorService } from './two-factor.service';

/** Контекст запроса, нужный для журналов и антифрода. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
  clientVersion?: string;
  country?: string;
  city?: string;
}

export type LoginResult =
  | ({ twoFactorRequired: false } & TokenPair & { user: PublicUser })
  | { twoFactorRequired: true; challengeToken: string; expiresIn: number };

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  locale: string;
}

/** TTL промежуточного токена второго фактора. */
const TWO_FACTOR_CHALLENGE_TTL_SEC = 900;
/** TTL токена подтверждения адреса. */
const EMAIL_VERIFY_TTL_SEC = 86_400;
/**
 * Попыток ввода кода на один challenge.
 *
 * Шесть цифр — миллион комбинаций. При окне в 15 минут и без ограничения
 * перебор реален. Пять попыток покрывают опечатки и рассинхронизацию часов,
 * но не оставляют места боту.
 */
const MAX_TWO_FACTOR_ATTEMPTS = 5;
/**
 * TTL ссылки сброса пароля.
 *
 * Час, а не сутки: ссылка даёт полный доступ к аккаунту, и всё это время
 * она лежит в почтовом ящике. Час покрывает «отвлёкся и вернулся»,
 * но не «письмо годичной давности нашли в архиве».
 */
const PASSWORD_RESET_TTL_SEC = 3_600;

/**
 * Пауза между повторными письмами подтверждения — на аккаунт, не на адрес
 * отправителя запроса.
 *
 * Минута выбрана как компромисс: человек, не увидевший письмо, ждёт её без
 * раздражения, а вот залить чужой ящик со скоростью письмо в минуту уже
 * бессмысленно — почтовые службы такое даже не заметят.
 */
const RESEND_COOLDOWN_SEC = 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly settings: SettingsService,
    private readonly twoFactor: TwoFactorService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  //  РЕГИСТРАЦИЯ
  // =========================================================================

  /**
   * Регистрация через сайт (ТЗ п.5).
   *
   * Пользователь создаётся в статусе PENDING_VERIFICATION и получает
   * токен подтверждения адреса. До подтверждения вход запрещён.
   */
  async register(
    params: { email: string; username: string; password: string; locale?: string },
    ctx: RequestContext,
  ): Promise<{ userId: string; verificationToken: string }> {
    this.passwords.assertLength(params.password);

    // citext делает сравнение регистронезависимым, поэтому Ivan и ivan —
    // один и тот же логин, и занять оба нельзя.
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: params.email }, { username: params.username }] },
      select: { id: true, email: true, username: true },
    });

    if (existing) {
      // Какое именно поле занято, не уточняем: иначе форма регистрации
      // превращается в проверялку «есть ли такой email в системе».
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Пользователь с такими данными уже зарегистрирован',
      });
    }

    const { hash, version } = await this.passwords.hashPassword(params.password);
    const userId = uuidv7();
    const rawToken = randomBytes(32).toString('base64url');

    const userRole = await this.prisma.role.findUniqueOrThrow({ where: { slug: 'user' } });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          email: params.email,
          username: params.username,
          passwordHash: hash,
          passwordVersion: version,
          passwordChangedAt: new Date(),
          status: UserStatus.PENDING_VERIFICATION,
          locale: params.locale ?? (await this.settings.getString('app.default_locale', 'ru')),
        },
      });

      await tx.userRole.create({ data: { userId, roleId: userRole.id } });

      await tx.verificationToken.create({
        data: {
          id: uuidv7(),
          userId,
          type: VerificationTokenType.EMAIL_VERIFY,
          tokenHash: this.hashToken(rawToken),
          expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_SEC * 1000),
          createdIp: ctx.ip ?? null,
        },
      });
    });

    this.logger.log(`зарегистрирован пользователь ${params.username}`);

    // Постановка письма в очередь ПОСЛЕ коммита транзакции: иначе
    // обработчик может успеть прочитать уведомление о ещё не существующем
    // пользователе. Ошибка постановки регистрацию не роняет — аккаунт
    // создан, письмо можно переотправить.
    await this.notifications.enqueue({
      templateKey: 'auth.email_verify',
      channel: NotificationChannel.EMAIL,
      userId,
      recipient: params.email,
      locale: params.locale,
      payload: {
        username: params.username,
        verifyUrl: `${await this.frontendUrl()}/verify-email?token=${rawToken}`,
      },
    });

    return { userId, verificationToken: rawToken };
  }

  /** Подтверждение адреса по токену из письма. */
  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);

    // Гашение условием внутри UPDATE: иначе два параллельных перехода
    // по ссылке из письма оба пройдут проверку.
    const claimed = await this.prisma.verificationToken.updateMany({
      where: {
        tokenHash,
        type: VerificationTokenType.EMAIL_VERIFY,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Ссылка недействительна или устарела',
      });
    }

    const token = await this.prisma.verificationToken.findUniqueOrThrow({
      where: { tokenHash },
      include: { user: { select: { status: true } } },
    });

    // Статус поднимается ТОЛЬКО из PENDING_VERIFICATION.
    //
    // Безусловный перевод в ACTIVE был дырой: токен подтверждения живёт
    // сутки, и заблокированный за это время пользователь снимал блокировку
    // сам, публичным запросом без авторизации. Заблокированному и удалённому
    // отвечаем как на недействительную ссылку — существование аккаунта
    // подтверждать незачем.
    if (
      token.user.status === UserStatus.BLOCKED ||
      token.user.status === UserStatus.DELETED
    ) {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Ссылка недействительна или устарела',
      });
    }

    await this.prisma.user.update({
      where: { id: token.userId },
      data: {
        emailVerifiedAt: new Date(),
        ...(token.user.status === UserStatus.PENDING_VERIFICATION
          ? { status: UserStatus.ACTIVE }
          : {}),
      },
    });
  }

  /**
   * Повторная отправка письма подтверждения.
   *
   * ЗАЧЕМ. Без этого метода потерянное письмо означало тупик, из которого
   * пользователь не выбирался вовсе: войти нельзя — почта не подтверждена,
   * зарегистрироваться заново нельзя — логин и адрес заняты им же самим,
   * а обратиться было не к кому. Единственным выходом оказывался сброс
   * пароля, и то случайно: он подтверждает адрес побочным эффектом.
   *
   * ОТВЕТ ВСЕГДА ОДИНАКОВ, как и у сброса пароля. Иначе форма превращается
   * в проверялку «зарегистрирован ли такой адрес», причём бесплатную и без
   * авторизации.
   *
   * ПАУЗА МЕЖДУ ПИСЬМАМИ ОБЯЗАТЕЛЬНА. Адрес получателя выбирает тот, кто
   * жмёт кнопку, а письмо уходит НЕ ему. Без паузы это готовый инструмент
   * заваливания чужого ящика: чем чаще жмёшь, тем больше писем от нашего
   * имени приходит постороннему человеку. Ограничение частоты на nginx
   * считает по адресу отправителя запроса и от распределённой отправки
   * не спасает, поэтому счёт ведётся здесь и по КОНКРЕТНОМУ аккаунту.
   */
  async resendVerification(email: string, ctx: RequestContext): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, status: true, username: true, locale: true },
    });

    // Подтверждать нечего у всех, кроме ожидающих подтверждения: активному
    // письмо не нужно, заблокированному не поможет.
    if (!user || user.status !== UserStatus.PENDING_VERIFICATION) {
      this.logger.log('повторное письмо не требуется: адрес неизвестен или уже подтверждён');
      return;
    }

    const recent = await this.prisma.verificationToken.findFirst({
      where: {
        userId: user.id,
        type: VerificationTokenType.EMAIL_VERIFY,
        createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_SEC * 1000) },
      },
      select: { id: true },
    });

    if (recent) {
      // Молча: сказать «подождите минуту» значит подтвердить, что адрес
      // зарегистрирован, — ровно то, что скрывает одинаковый ответ.
      this.logger.log(`повторное письмо для ${user.username} пропущено: слишком часто`);
      return;
    }

    const raw = randomBytes(32).toString('base64url');

    await this.prisma.$transaction([
      // Прежние ссылки гасим: иначе у пользователя на руках оказывается
      // несколько действующих, и какая из них сработает — лотерея.
      this.prisma.verificationToken.updateMany({
        where: { userId: user.id, type: VerificationTokenType.EMAIL_VERIFY, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.verificationToken.create({
        data: {
          id: uuidv7(),
          userId: user.id,
          type: VerificationTokenType.EMAIL_VERIFY,
          tokenHash: this.hashToken(raw),
          expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_SEC * 1000),
          createdIp: ctx.ip ?? null,
        },
      }),
    ]);

    await this.notifications.enqueue({
      templateKey: 'auth.email_verify',
      channel: NotificationChannel.EMAIL,
      userId: user.id,
      recipient: email,
      locale: user.locale,
      payload: {
        username: user.username,
        verifyUrl: `${await this.frontendUrl()}/verify-email?token=${raw}`,
      },
    });

    this.logger.log(`повторное письмо подтверждения отправлено для ${user.username}`);
  }

  // =========================================================================
  //  ВХОД
  // =========================================================================

  /**
   * Вход по логину или email и паролю (ТЗ п.6).
   *
   * Все ветки отказа возвращают одинаковое сообщение и тратят одинаковое
   * время: различимые ответы превращают форму входа в перечислитель
   * существующих аккаунтов.
   */
  async login(
    params: { login: string; password: string },
    ctx: RequestContext,
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: params.login }, { username: params.login }],
        deletedAt: null,
      },
    });

    // Проверка выполняется ДАЖЕ при отсутствии пользователя: внутри
    // PasswordService в этом случае считается фиктивный хеш, чтобы время
    // ответа не выдавало, существует логин или нет.
    const passwordOk = await this.passwords.verifyPassword(
      params.password,
      user?.passwordHash ?? null,
    );

    if (!user || !passwordOk) {
      await this.recordLogin({
        userId: user?.id,
        identifier: params.login,
        success: false,
        reason: user ? 'invalid_password' : 'user_not_found',
        method: 'password',
        ctx,
      });

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Неверный логин или пароль',
      });
    }

    await this.assertUserCanLogin(user.status, user.id, params.login, ctx);

    // Параметры Argon2 могли усилить с момента последнего входа.
    // Открытый пароль сейчас в руках — пересчитываем молча.
    if (await this.passwords.needsRehash(user.passwordHash!)) {
      const { hash, version } = await this.passwords.hashPassword(params.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, passwordVersion: version },
      });
      this.logger.log(`пароль пользователя ${user.username} перехеширован новыми параметрами`);
    }

    // Второй фактор проверяется НЕ здесь, а внутри completeLogin — см.
    // комментарий к нему. Здесь его не было бы видно у входа через OAuth.
    return this.completeLogin(user.id, user.username, user.email, user.locale, ctx, 'password');
  }

  /**
   * Завершение входа: второй фактор, выдача токенов, запись в журнал,
   * обновление времени последнего входа.
   *
   * ПРОВЕРКА ВТОРОГО ФАКТОРА СТОИТ ИМЕННО ЗДЕСЬ, а не у вызывающих.
   *
   * Раньше она жила внутри login() — то есть в парольном пути, — а
   * completeLogin был просто выдачей токенов. Из-за этого вход через
   * Discord/Telegram (oauth.service.ts:310) второй фактор не спрашивал
   * вовсе: пользователь, включивший 2FA и имеющий привязанный аккаунт,
   * входил одним запросом к callback'у. Обходился тот самый фактор, ради
   * которого его и включали, причём каналом, который человек считает
   * вспомогательным.
   *
   * Это ловушка размещения, а не забывчивость: защиту поставили в
   * ВЫЗЫВАЮЩЕМ, а не в защищаемом, и четвёртый вызывающий унаследовал бы
   * ту же дыру молча. Теперь наоборот: гейт срабатывает по умолчанию, а
   * пропустить его можно только осознанно, передав twoFactorSatisfied.
   * Забыть — значит получить лишний запрос кода, а не открытую дверь.
   *
   * Единственный законный обход — verifyTwoFactor: там фактор уже
   * предъявлен, и повторная проверка дала бы бесконечный круг.
   */
  async completeLogin(
    userId: string,
    username: string,
    email: string | null,
    locale: string,
    ctx: RequestContext,
    method: string,
    opts: { twoFactorSatisfied?: boolean } = {},
  ): Promise<LoginResult> {
    if (!opts.twoFactorSatisfied) {
      // Читаем состояние 2FA здесь, а не принимаем параметром: параметр
      // пришлось бы прокидывать через всех вызывающих, и первый же
      // забывший передал бы false. Один поиск по первичному ключу на пути,
      // где и так считается Argon2, погоды не делает.
      const state = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true, twoFactorConfirmedAt: true },
      });

      if (state?.twoFactorEnabled && state.twoFactorConfirmedAt) {
        const challengeToken = await this.createTwoFactorChallenge(userId, ctx);

        await this.recordLogin({
          userId,
          identifier: username,
          success: false,
          reason: 'awaiting_2fa',
          method,
          ctx,
        });

        return {
          twoFactorRequired: true,
          challengeToken,
          expiresIn: TWO_FACTOR_CHALLENGE_TTL_SEC,
        };
      }
    }

    const pair = await this.tokens.issuePair({
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      device: ctx.clientVersion ? `Launcher ${ctx.clientVersion}` : undefined,
      clientVersion: ctx.clientVersion,
      country: ctx.country,
      city: ctx.city,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), lastLoginIp: ctx.ip ?? null },
    });

    await this.recordLogin({
      userId,
      identifier: username,
      success: true,
      method,
      ctx,
      sessionId: pair.sessionId,
    });

    return {
      twoFactorRequired: false,
      ...pair,
      user: { id: userId, username, email, locale },
    };
  }

  /**
   * Завершение входа вторым фактором.
   *
   * Challenge живёт 15 минут, и шестизначный код за это время перебирается
   * ботом. Поэтому счётчик попыток на самом токене: после исчерпания
   * challenge гасится и требуется вводить пароль заново.
   */
  async verifyTwoFactor(
    challengeToken: string,
    code: string,
    ctx: RequestContext,
  ): Promise<Extract<LoginResult, { twoFactorRequired: false }>> {
    const tokenHash = this.hashToken(challengeToken);

    const challenge = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !challenge ||
      challenge.type !== VerificationTokenType.TWO_FACTOR_CHALLENGE ||
      challenge.usedAt ||
      challenge.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException({
        code: 'CHALLENGE_INVALID',
        message: 'Сессия подтверждения истекла. Войдите заново.',
      });
    }

    // Инкремент ДО проверки кода: иначе неудачная попытка, прерванная
    // разрывом соединения, не засчитывается, и лимит обходится.
    const attempts = challenge.attempts + 1;
    await this.prisma.verificationToken.update({
      where: { id: challenge.id },
      data: { attempts },
    });

    if (attempts > MAX_TWO_FACTOR_ATTEMPTS) {
      await this.prisma.verificationToken.update({
        where: { id: challenge.id },
        data: { usedAt: new Date() },
      });

      await this.recordLogin({
        userId: challenge.userId,
        identifier: challenge.user.username,
        success: false,
        reason: '2fa_attempts_exceeded',
        method: '2fa',
        ctx,
      });

      throw new UnauthorizedException({
        code: 'TWO_FACTOR_ATTEMPTS_EXCEEDED',
        message: 'Слишком много неверных кодов. Войдите заново.',
      });
    }

    try {
      await this.twoFactor.verify(challenge.userId, code);
    } catch (error) {
      await this.recordLogin({
        userId: challenge.userId,
        identifier: challenge.user.username,
        success: false,
        reason: '2fa_invalid',
        method: '2fa',
        ctx,
      });
      throw error;
    }

    // Гашение условием внутри UPDATE: два параллельных запроса с одним
    // challenge и верным кодом не должны создать две сессии.
    const claimed = await this.prisma.verificationToken.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new UnauthorizedException({
        code: 'CHALLENGE_INVALID',
        message: 'Сессия подтверждения уже использована',
      });
    }

    // Единственное место, где гейт второго фактора обходится законно:
    // код только что предъявлен и погашен выше. Без этого флага
    // completeLogin выдал бы новый challenge, и человек ходил бы по кругу.
    return this.completeLogin(
      challenge.user.id,
      challenge.user.username,
      challenge.user.email,
      challenge.user.locale,
      ctx,
      '2fa',
      { twoFactorSatisfied: true },
    ) as Promise<Extract<LoginResult, { twoFactorRequired: false }>>;
  }

  // =========================================================================
  //  СБРОС И СМЕНА ПАРОЛЯ
  // =========================================================================

  /**
   * Запрос сброса пароля.
   *
   * Возвращает успех ВСЕГДА, существует адрес или нет. Различимый ответ
   * превращает форму восстановления в проверялку «зарегистрирован ли этот
   * человек» — для платформы с лицензиями это лишняя утечка.
   *
   * @returns токен, если пользователь найден. Вызывающий отправляет письмо;
   *          в HTTP-ответ значение не попадает.
   */
  async requestPasswordReset(
    email: string,
    ctx: RequestContext,
  ): Promise<{ token: string; userId: string } | null> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, status: true, username: true, locale: true },
    });

    if (!user || user.status === UserStatus.BLOCKED) {
      // Заблокированному сброс не поможет — вход всё равно запрещён,
      // а письмо только подскажет атакующему, что аккаунт существует.
      this.logger.log(`запрос сброса пароля для неизвестного или заблокированного адреса`);
      return null;
    }

    const raw = randomBytes(32).toString('base64url');

    // Предыдущие невыполненные запросы гасим: иначе каждое нажатие
    // «забыли пароль» добавляет ещё один действующий токен, и их
    // накапливается сколько угодно.
    await this.prisma.$transaction([
      this.prisma.verificationToken.updateMany({
        where: { userId: user.id, type: VerificationTokenType.PASSWORD_RESET, usedAt: null },
        data: { usedAt: new Date() },
      }),
      // Непотраченные токены подтверждения адреса гасим здесь же: сброс
      // пароля по ссылке из письма сам по себе доказывает владение адресом,
      // и оставлять валидным ещё один токен, меняющий статус аккаунта,
      // незачем.
      this.prisma.verificationToken.updateMany({
        where: { userId: user.id, type: VerificationTokenType.EMAIL_VERIFY, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.verificationToken.create({
        data: {
          id: uuidv7(),
          userId: user.id,
          type: VerificationTokenType.PASSWORD_RESET,
          tokenHash: this.hashToken(raw),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_SEC * 1000),
          createdIp: ctx.ip ?? null,
        },
      }),
    ]);

    await this.notifications.enqueue({
      templateKey: 'auth.password_reset',
      channel: NotificationChannel.EMAIL,
      userId: user.id,
      recipient: email,
      locale: user.locale,
      payload: {
        username: user.username,
        resetUrl: `${await this.frontendUrl()}/reset-password?token=${raw}`,
      },
    });

    return { token: raw, userId: user.id };
  }

  /** База для ссылок в письмах. Настраивается из админки без передеплоя. */
  private async frontendUrl(): Promise<string> {
    return (await this.settings.getString('app.frontend_url', 'http://localhost:5173')).replace(
      /\/+$/,
      '',
    );
  }

  /**
   * Подтверждение сброса.
   *
   * Если у пользователя включён второй фактор, он требуется и здесь.
   * Иначе доступ к почте обходит 2FA целиком, и второй фактор превращается
   * в украшение. Потерявшего и пароль, и телефон выручают коды восстановления.
   */
  async confirmPasswordReset(
    params: { token: string; newPassword: string; twoFactorCode?: string },
    ctx: RequestContext,
  ): Promise<void> {
    this.passwords.assertLength(params.newPassword);

    const tokenHash = this.hashToken(params.token);
    const stored = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !stored ||
      stored.type !== VerificationTokenType.PASSWORD_RESET ||
      stored.usedAt ||
      stored.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Ссылка недействительна или устарела',
      });
    }

    if (stored.user.twoFactorEnabled && stored.user.twoFactorConfirmedAt) {
      if (!params.twoFactorCode) {
        throw new UnauthorizedException({
          code: 'TWO_FACTOR_REQUIRED',
          message: 'Введите код двухфакторной аутентификации',
        });
      }
      await this.twoFactor.verify(stored.userId, params.twoFactorCode);
    }

    const { hash, version } = await this.passwords.hashPassword(params.newPassword);

    // Гашение токена условием внутри UPDATE: два параллельных перехода
    // по ссылке из письма не должны оба сменить пароль.
    const claimed = await this.prisma.verificationToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Ссылка уже использована',
      });
    }

    await this.prisma.user.update({
      where: { id: stored.userId },
      data: {
        passwordHash: hash,
        passwordVersion: version,
        passwordChangedAt: new Date(),
        // Сброс пароля заодно подтверждает владение адресом: письмо дошло.
        ...(stored.user.status === UserStatus.PENDING_VERIFICATION
          ? { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() }
          : {}),
      },
    });

    // ВСЕ сессии, без исключений. Смысл сброса в том, что пароль мог утечь;
    // оставлять активными входы, сделанные до него, бессмысленно.
    const revoked = await this.tokens.revokeAllUserSessions(stored.userId, 'password_reset');

    await this.recordLogin({
      userId: stored.userId,
      identifier: stored.user.username,
      success: true,
      method: 'password_reset',
      ctx,
    });

    this.logger.log(`пароль сброшен, завершено сессий: ${revoked}`);
  }

  /**
   * Смена пароля вошедшим пользователем.
   *
   * В отличие от сброса, текущая сессия остаётся — человек только что
   * доказал знание старого пароля и не должен получать разлогин в награду.
   * Остальные гасятся: если пароль меняют из-за подозрений, чужие входы
   * надо оборвать.
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    params: { currentPassword: string; newPassword: string },
  ): Promise<{ revokedSessions: number }> {
    this.passwords.assertLength(params.newPassword);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!(await this.passwords.verifyPassword(params.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Текущий пароль неверен',
      });
    }

    if (params.currentPassword === params.newPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: 'Новый пароль совпадает с текущим',
      });
    }

    const { hash, version } = await this.passwords.hashPassword(params.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, passwordVersion: version, passwordChangedAt: new Date() },
    });

    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      select: { id: true },
    });

    for (const s of sessions) {
      await this.tokens.revokeSession(s.id, 'password_changed');
    }

    return { revokedSessions: sessions.length };
  }

  /**
   * Установка первого пароля для аккаунта, созданного через OAuth.
   *
   * Отдельный метод, а не changePassword: текущего пароля нет, требовать
   * его нечего. Проверка одна и она жёсткая — метод работает ТОЛЬКО пока
   * пароля нет. Иначе это стал бы способ сменить пароль без знания старого,
   * то есть полный захват аккаунта из угнанной сессии.
   */
  async setInitialPassword(userId: string, password: string): Promise<void> {
    this.passwords.assertLength(password);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (user.passwordHash) {
      throw new ConflictException({
        code: 'PASSWORD_ALREADY_SET',
        message: 'Пароль уже задан. Используйте смену пароля.',
      });
    }

    const { hash, version } = await this.passwords.hashPassword(password);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, passwordVersion: version, passwordChangedAt: new Date() },
    });

    this.logger.log(`задан первый пароль для аккаунта ${userId}`);
  }

  // =========================================================================
  //  ПРОФИЛЬ: ЛОГИН И ПОЧТА
  // =========================================================================

  /**
   * Смена логина. Подтверждение — текущий пароль; старая почта получает
   * уведомление, чтобы угон аккаунта не прошёл незаметно.
   */
  async changeUsername(userId: string, params: { username: string; password: string }): Promise<void> {
    const user = await this.verifyOwner(userId, params.password);
    const username = params.username.trim();
    if (username.toLowerCase() === user.username.toLowerCase()) {
      throw new BadRequestException({ code: 'USERNAME_UNCHANGED', message: 'Это ваш текущий логин' });
    }

    try {
      await this.prisma.user.update({ where: { id: userId }, data: { username } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Этот логин уже занят' });
      }
      throw error;
    }

    await this.audit.record({
      action: 'user.username_change',
      actorId: userId,
      actorType: 'USER',
      entityType: 'user',
      entityId: userId,
      before: { username: user.username },
      after: { username },
    });
    if (user.email) {
      await this.notifications.enqueue({
        templateKey: 'auth.username_changed',
        channel: NotificationChannel.EMAIL,
        userId,
        recipient: user.email,
        locale: user.locale,
        payload: { oldUsername: user.username, newUsername: username },
      });
    }
  }

  /**
   * Запрос смены почты: ссылка уходит на НОВЫЙ адрес, почта меняется только
   * после перехода по ней. Прежние незавершённые запросы гасятся.
   */
  async requestEmailChange(
    userId: string,
    params: { email: string; password: string },
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.verifyOwner(userId, params.password);
    const email = params.email.trim().toLowerCase();
    if (user.email && email === user.email.toLowerCase()) {
      throw new BadRequestException({ code: 'EMAIL_UNCHANGED', message: 'Это ваша текущая почта' });
    }
    await this.assertEmailFree(email, userId);

    const recent = await this.prisma.verificationToken.count({
      where: {
        userId,
        type: VerificationTokenType.EMAIL_CHANGE,
        createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_SEC * 1000) },
      },
    });
    if (recent) {
      throw new ConflictException({ code: 'TOO_FREQUENT', message: 'Письмо уже отправлено, подождите минуту' });
    }

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.verificationToken.updateMany({
        where: { userId, type: VerificationTokenType.EMAIL_CHANGE, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.verificationToken.create({
        data: {
          id: uuidv7(),
          userId,
          type: VerificationTokenType.EMAIL_CHANGE,
          tokenHash: this.hashToken(raw),
          payload: { email },
          expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_SEC * 1000),
          createdIp: ctx.ip ?? null,
        },
      }),
    ]);

    await this.notifications.enqueue({
      templateKey: 'auth.email_change',
      channel: NotificationChannel.EMAIL,
      userId,
      recipient: email,
      locale: user.locale,
      payload: {
        username: user.username,
        confirmUrl: `${await this.frontendUrl()}/verify-email-change?token=${raw}`,
      },
    });
    await this.audit.record({
      action: 'user.email_change_requested',
      actorId: userId,
      actorType: 'USER',
      entityType: 'user',
      entityId: userId,
      after: { email },
    });
  }

  /** Переход по ссылке из письма на новый адрес. */
  async confirmEmailChange(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, username: true, email: true, status: true, locale: true } } },
    });
    const invalid = new UnauthorizedException({ code: 'TOKEN_INVALID', message: 'Ссылка недействительна или устарела' });
    if (
      !stored ||
      stored.type !== VerificationTokenType.EMAIL_CHANGE ||
      stored.usedAt ||
      stored.expiresAt.getTime() < Date.now() ||
      stored.user.status === UserStatus.BLOCKED ||
      stored.user.status === UserStatus.DELETED
    ) {
      throw invalid;
    }

    const email = (stored.payload as { email?: string } | null)?.email;
    if (!email) throw invalid;
    await this.assertEmailFree(email, stored.userId);

    const claimed = await this.prisma.verificationToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw invalid;

    try {
      await this.prisma.user.update({
        where: { id: stored.userId },
        data: {
          email,
          emailVerifiedAt: new Date(),
          ...(stored.user.status === UserStatus.PENDING_VERIFICATION ? { status: UserStatus.ACTIVE } : {}),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Эта почта уже используется другим аккаунтом' });
      }
      throw error;
    }

    await this.audit.record({
      action: 'user.email_change',
      actorId: stored.userId,
      actorType: 'USER',
      entityType: 'user',
      entityId: stored.userId,
      before: { email: stored.user.email },
      after: { email },
    });
    if (stored.user.email) {
      await this.notifications.enqueue({
        templateKey: 'auth.email_changed',
        channel: NotificationChannel.EMAIL,
        userId: stored.userId,
        recipient: stored.user.email,
        locale: stored.user.locale,
        payload: { username: stored.user.username, newEmail: email },
      });
    }
  }

  /** Своя роль и права — для раздела «Моя роль» (с уровня поддержки). */
  async getAccess(userId: string) {
    const roles = await this.prisma.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            slug: true,
            name: true,
            description: true,
            priority: true,
            permissions: { select: { permission: { select: { slug: true, group: true, description: true } } } },
          },
        },
      },
    });
    const permissions = new Map<string, { slug: string; group: string; description: string | null }>();
    for (const { role } of roles) {
      for (const { permission } of role.permissions) permissions.set(permission.slug, permission);
    }
    return {
      roles: roles
        .map(({ role }) => ({ slug: role.slug, name: role.name, description: role.description, priority: role.priority }))
        .sort((a, b) => b.priority - a.priority),
      permissions: [...permissions.values()].sort((a, b) => a.group.localeCompare(b.group) || a.slug.localeCompare(b.slug)),
    };
  }

  /** Владелец ли меняет профиль: пароль обязателен (без него — сначала задать). */
  private async verifyOwner(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, email: true, locale: true, passwordHash: true },
    });
    if (!user.passwordHash) {
      throw new ForbiddenException({ code: 'PASSWORD_REQUIRED', message: 'Сначала задайте пароль' });
    }
    if (!(await this.passwords.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Неверный пароль' });
    }
    return user;
  }

  private async assertEmailFree(email: string, userId: string): Promise<void> {
    const taken = await this.prisma.user.count({ where: { email, id: { not: userId } } });
    if (taken) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Эта почта уже используется другим аккаунтом' });
  }

  /**
   * Сводка профиля для кабинета: логин, почта (и новая, ждущая подтверждения),
   * способы входа — по ней же решается, просить ли задать пароль.
   */
  async getLoginMethods(userId: string): Promise<{
    username: string;
    email: string | null;
    emailVerified: boolean;
    pendingEmail: string | null;
    hasPassword: boolean;
    /** Без пароля лицензия не выдаётся и загрузчик не запускается. */
    requiresPassword: boolean;
    providers: string[];
    twoFactorEnabled: boolean;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        username: true,
        email: true,
        emailVerifiedAt: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorConfirmedAt: true,
        oauthAccounts: { select: { provider: true } },
        verificationTokens: {
          where: { type: VerificationTokenType.EMAIL_CHANGE, usedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { payload: true },
        },
      },
    });

    const hasPassword = user.passwordHash !== null;
    const pending = user.verificationTokens[0]?.payload as { email?: string } | undefined;

    return {
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      pendingEmail: pending?.email ?? null,
      hasPassword,
      requiresPassword: !hasPassword,
      providers: user.oauthAccounts.map((a) => a.provider),
      twoFactorEnabled: user.twoFactorEnabled && user.twoFactorConfirmedAt !== null,
    };
  }

  /** Публичный профиль пользователя. */
  async getPublicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, username: true, email: true, locale: true },
    });
    return user;
  }

  /** Обновление пары токенов. */
  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, ctx.ip);
  }

  /** Выход: гасит текущую сессию. */
  async logout(sessionId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'logout');
  }

  /**
   * Отключение второго фактора.
   *
   * Требует и пароль, и текущий код. Одного кода мало: перехваченная
   * сессия сняла бы защиту одним запросом. Одного пароля тоже мало —
   * второй фактор ровно для того и нужен, что пароль мог утечь.
   */
  async disableTwoFactor(userId: string, password: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!(await this.passwords.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Неверный пароль',
      });
    }

    await this.twoFactor.disable(userId, code);

    // Все прочие сессии гасим: отключение второго фактора — событие,
    // после которого стоит убедиться, что чужих активных входов не осталось.
    await this.tokens.revokeAllUserSessions(userId, 'two_factor_disabled');
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /** Проверка статуса аккаунта. Разделена по причинам для журнала. */
  private async assertUserCanLogin(
    status: UserStatus,
    userId: string,
    identifier: string,
    ctx: RequestContext,
  ): Promise<void> {
    if (status === UserStatus.ACTIVE) return;

    const reason =
      status === UserStatus.BLOCKED
        ? 'blocked'
        : status === UserStatus.PENDING_VERIFICATION
          ? 'email_not_verified'
          : 'deleted';

    await this.recordLogin({
      userId,
      identifier,
      success: false,
      reason,
      method: 'password',
      ctx,
    });

    if (status === UserStatus.BLOCKED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_BLOCKED',
        message: 'Аккаунт заблокирован. Обратитесь в поддержку.',
      });
    }

    if (status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Подтвердите адрес электронной почты',
      });
    }

    throw new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Неверный логин или пароль',
    });
  }

  private async createTwoFactorChallenge(userId: string, ctx: RequestContext): Promise<string> {
    const raw = randomBytes(32).toString('base64url');

    // Незакрытые challenge того же пользователя гасим: иначе их
    // накапливается сколько угодно, и каждый — отдельная попытка подбора.
    await this.prisma.verificationToken.updateMany({
      where: { userId, type: VerificationTokenType.TWO_FACTOR_CHALLENGE, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.verificationToken.create({
      data: {
        id: uuidv7(),
        userId,
        type: VerificationTokenType.TWO_FACTOR_CHALLENGE,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_SEC * 1000),
        createdIp: ctx.ip ?? null,
      },
    });

    return raw;
  }

  /**
   * Запись в историю входов (ТЗ п.10, п.15).
   *
   * identifierUsed заполняется всегда, включая несуществующие логины:
   * без этого невозможно увидеть перебор по словарю — у таких попыток
   * userId пустой, и в журнале осталась бы серия неотличимых строк.
   */
  private async recordLogin(params: {
    userId?: string;
    identifier: string;
    success: boolean;
    reason?: string;
    method: string;
    ctx: RequestContext;
    sessionId?: string;
  }): Promise<void> {
    try {
      await this.prisma.loginHistory.create({
        data: {
          id: uuidv7(),
          userId: params.userId ?? null,
          identifierUsed: params.identifier.slice(0, 255),
          success: params.success,
          failureReason: params.reason ?? null,
          method: params.method,
          ip: params.ctx.ip ?? null,
          country: params.ctx.country ?? null,
          city: params.ctx.city ?? null,
          userAgent: params.ctx.userAgent ?? null,
          clientVersion: params.ctx.clientVersion ?? null,
          sessionId: params.sessionId ?? null,
        },
      });
    } catch (error) {
      // Журнал не должен ронять вход. Потерянная запись хуже, чем
      // недоступный сервис, но не настолько, чтобы менять их местами.
      this.logger.error(
        `не удалось записать историю входа: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }
}
