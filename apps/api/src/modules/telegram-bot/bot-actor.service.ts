import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { TelegramLinkScope, UserStatus } from '@prisma/client';

import { PrismaService } from '@common/prisma/prisma.service';
import { loadActorProfile } from '@common/rbac/actor-profile';
import { RedisService } from '@common/redis/redis.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

/**
 * Кто именно пишет боту.
 *
 * Бот приходит не по HTTP: у него нет Bearer-токена, JwtAuthGuard на его
 * пути не стоит, а AuthenticatedUser сервисам домена всё равно нужен —
 * LicensesService, HwidService и RBAC умеют работать только с ним. Этот
 * сервис и есть замена гварда: находит связь чата с аккаунтом, проверяет
 * её срок, собирает профиль тем же кодом (loadActorProfile) и отдаёт
 * готового актора.
 */

/**
 * Кэш «жив ли аккаунт», 60 секунд.
 *
 * Права кэширует loadActorProfile на свои пять минут — их дублировать
 * незачем. Отдельный короткий ключ нужен ровно для одного: статуса
 * пользователя. Блокировка аккаунта обязана доходить до чата быстрее, чем
 * за пять минут, иначе заблокированный человек продолжает сбрасывать HWID.
 *
 * Явной инвалидации из AuthService НЕТ намеренно: инъекция этого сервиса
 * в AuthService дала бы цикл AuthModule → TelegramBotModule → AuthModule.
 * Вместо неё assertNotBlocked() перечитывает статус мимо кэша перед каждым
 * необратимым действием — там лаг нулевой, а на навигации по меню лаг
 * до минуты безвреден.
 */
const ACTOR_PREFIX = 'tg:actor:';
const ACTOR_TTL_SEC = 60;

/** Значения кэша. Односимвольные: ключей столько же, сколько активных чатов. */
const CACHED_LIVE = '0';
const CACHED_BLOCKED = '1';

export interface BotActorLink {
  id: string;
  chatId: bigint;
  telegramUserId: bigint;
  scope: TelegramLinkScope;
  locale: string;
  expiresAt: Date | null;
}

export interface BotActor {
  /**
   * sessionId — это link.id, а не идентификатор сессии из sessions.
   *
   * Синтетическое значение допустимо: AuditService.record поле sessionId
   * не пишет вовсе, внешнего ключа на sessions у него нет, ломаться нечему.
   * А польза есть — по строке аудита видно, ЧЕРЕЗ КАКУЮ привязку сделано
   * действие, даже если её потом отозвали и создали новую.
   */
  user: AuthenticatedUser;
  link: BotActorLink;
  /**
   * Аккаунт заблокирован или удалён. Не то же самое, что «нет актора»:
   * такому человеку бот обязан отвечать на /help и /support, иначе
   * заблокированный клиент лишается единственного способа спросить, за что.
   */
  blocked: boolean;
}

@Injectable()
export class BotActorService {
  private readonly logger = new Logger(BotActorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Актор по числовому идентификатору Telegram.
   *
   * null означает «этой связи нет или она больше не действует» — бот
   * покажет экран приветствия с предложением подключиться на сайте.
   * Отдельно «истекла» и «отозвана» наружу не различаются: пользователю
   * в обоих случаях делать одно и то же.
   */
  async resolve(telegramUserId: bigint): Promise<BotActor | null> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { telegramUserId },
      select: {
        id: true,
        userId: true,
        chatId: true,
        telegramUserId: true,
        scope: true,
        locale: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!link || link.revokedAt !== null) return null;

    // Срок проверяется здесь, а не только почасовым процессором: между
    // истечением и ближайшим тиком проходит до часа, и всё это время
    // просроченная привязка работала бы как действующая.
    if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) return null;

    const blocked = await this.isBlocked(link.userId);
    const profile = await loadActorProfile(this.prisma, this.redis, link.userId);

    return {
      user: {
        id: link.userId,
        sessionId: link.id,
        permissions: profile.permissions,
        rolePriority: profile.rolePriority,
        twoFactorEnabled: profile.twoFactorEnabled,
      },
      link: {
        id: link.id,
        chatId: link.chatId,
        telegramUserId: link.telegramUserId,
        scope: link.scope,
        locale: link.locale,
        expiresAt: link.expiresAt,
      },
      blocked,
    };
  }

  /**
   * Проверка «аккаунт ещё жив» МИМО кэша.
   *
   * Вызывается перед каждым необратимым действием: сбросом привязки,
   * показом ключа, активацией покупки. Кэш на 60 секунд экономит запросы
   * на навигации по меню, но здесь эта экономия обошлась бы в минуту, за
   * которую заблокированный человек успевает сжечь остаток сбросов HWID.
   */
  async assertNotBlocked(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, deletedAt: true },
    });

    // Пользователя нет вовсе — считаем заблокированным. Привязка каскадно
    // удаляется вместе с аккаунтом, так что это состояние означает гонку
    // между удалением и обработкой апдейта.
    if (!user || this.statusIsBlocked(user.status, user.deletedAt)) {
      // Кэш поправляем сразу: следующий экран уже не покажет меню.
      await this.writeCache(userId, true);
      throw new ForbiddenException({
        code: 'ACCOUNT_BLOCKED',
        message: 'Аккаунт заблокирован',
      });
    }
  }

  /**
   * Отметка активности чата.
   *
   * Здесь же снимается chatBlocked: входящий апдейт — единственное
   * доказательство, что человек разблокировал бота. Ждать удачной отправки
   * нельзя, потому что отправлять мы перестаём как раз из-за этого флага,
   * и связь осталась бы «заблокированной» навсегда.
   *
   * Троттлинга нет намеренно: сообщения от одного чата и так ограничены
   * 20 в минуту, а лишний UPDATE по первичному ключу дешевле, чем
   * рассинхронизация chatBlocked с действительностью.
   */
  async touch(linkId: string, chatId: bigint, username?: string): Promise<void> {
    try {
      await this.prisma.telegramLink.updateMany({
        where: { id: linkId },
        data: {
          lastSeenAt: new Date(),
          chatBlocked: false,
          chatId,
          // undefined в Prisma означает «не трогать поле». У пользователя
          // Telegram username может отсутствовать вовсе, и затирать
          // сохранённый кэш пустотой при каждом апдейте незачем.
          username: username ?? undefined,
        },
      });
    } catch (error) {
      // Отметка активности — служебная запись. Уронить из-за неё обработку
      // сообщения значит превратить недоступность БД на секунду в потерю
      // ответа пользователю.
      this.logger.warn(
        `не удалось отметить активность привязки ${linkId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Сброс кэша статуса. Зовётся после блокировки и после отвязки. */
  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.client.del(`${ACTOR_PREFIX}${userId}`);
    } catch (error) {
      this.logger.warn(
        `не удалось сбросить кэш актора ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  private async isBlocked(userId: string): Promise<boolean> {
    const cached = await this.readCache(userId);
    if (cached !== null) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, deletedAt: true },
    });

    const blocked = !user || this.statusIsBlocked(user.status, user.deletedAt);
    await this.writeCache(userId, blocked);
    return blocked;
  }

  /**
   * PENDING_VERIFICATION блокировкой НЕ считается.
   *
   * Привязка выдаётся только за аутентифицированной сессией, а аккаунт с
   * неподтверждённой почтой в неё и так не войдёт. Считать такой статус
   * блокировкой значило бы наказывать за состояние, которого у владельца
   * действующей привязки быть не может.
   */
  private statusIsBlocked(status: UserStatus, deletedAt: Date | null): boolean {
    return status === UserStatus.BLOCKED || status === UserStatus.DELETED || deletedAt !== null;
  }

  private async readCache(userId: string): Promise<boolean | null> {
    try {
      const raw = await this.redis.client.get(`${ACTOR_PREFIX}${userId}`);
      if (raw === CACHED_BLOCKED) return true;
      if (raw === CACHED_LIVE) return false;
      return null;
    } catch (error) {
      // Redis недоступен — читаем из БД. Fail-open здесь недопустим:
      // кэш существует ради экономии, а не ради решения о доступе.
      this.logger.warn(
        `кэш актора недоступен, читаем БД: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async writeCache(userId: string, blocked: boolean): Promise<void> {
    try {
      await this.redis.client.set(
        `${ACTOR_PREFIX}${userId}`,
        blocked ? CACHED_BLOCKED : CACHED_LIVE,
        'EX',
        ACTOR_TTL_SEC,
      );
    } catch {
      // Молча: не записавшийся кэш означает лишний запрос в БД, не более.
    }
  }
}
