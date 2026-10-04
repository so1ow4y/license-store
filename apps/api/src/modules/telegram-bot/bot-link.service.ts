import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorType,
  NotificationChannel,
  Prisma,
  TelegramLinkScope,
  TelegramNotifyCategory,
  UserStatus,
} from '@prisma/client';
import type { TelegramLink } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationService } from '@modules/notifications/notification.service';
import { TwoFactorService } from '@modules/auth/two-factor.service';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { BotRateService } from './bot-rate.service';
import { TelegramApiService } from './telegram.api';
import { TelegramBotConfig } from './telegram-bot.config';
import type { TgChat, TgUser } from './dto/telegram-update.types';

/**
 * Привязка чата Telegram к аккаунту (§3 ТЗ бота).
 *
 * Направление строго одно: САЙТ → БОТ. Аутентифицированный пользователь
 * получает в кабинете одноразовый токен и нажимает Start у бота. Обратное
 * направление — «напишите боту логин и пароль» или Login Widget — отвергнуто
 * в ТЗ: пароль в переписке оседает в облаке Telegram, в бэкапах и на экране
 * блокировки, а виджет не даёт ни почты, ни отзываемой связи и подписывается
 * тем же токеном, которым проверяется.
 */

/**
 * 32 байта CSPRNG в base64url — 43 символа.
 *
 * Не больше: у payload команды /start лимит 64 символа, и токен длиннее
 * молча обрежется Telegram'ом, дав неотличимую от подделки строку.
 * Не меньше: токен — предъявительский документ на чужой аккаунт.
 */
const TOKEN_BYTES = 32;

/** 10 минут. Плата за то, что токен уезжает в буфер обмена и в переписку. */
const CODE_TTL_MS = 600_000;

/** Сроки привязки: у администратора цена потери телефона выше. */
const USER_LINK_DAYS = 90;
const ADMIN_LINK_DAYS = 30;

/** Право, без которого область ADMIN не выдаётся. */
const ADMIN_SCOPE_PERMISSION = 'licenses.create.any';

/** Выпуск кодов: 5 в час на аккаунт (§7.5 ТЗ). */
const ISSUE_LIMIT = 5;
const ISSUE_WINDOW_SEC = 3600;

/**
 * Категории уведомлений, создаваемые при привязке. ADMIN добавляется только
 * админской области: обычному пользователю нечего слать по этой категории,
 * а лишняя строка в настройках выглядела бы как обещание.
 */
const BASE_CATEGORIES: TelegramNotifyCategory[] = [
  TelegramNotifyCategory.LICENSE,
  TelegramNotifyCategory.EXPIRY,
  TelegramNotifyCategory.SECURITY,
  TelegramNotifyCategory.DEVICE,
];

/**
 * Прощальное сообщение в вытесняемый или отвязываемый чат.
 *
 * Двуязычное и БЕЗ подстановок: en — источник истины, ru рядом. Своего
 * словаря у этого пакета нет (i18n принадлежит экранам бота), а тянуть чужой
 * ради двух строк значило бы связать привязку с рендерингом меню. Данных
 * пользователя в тексте нет ни одной — значит, и экранировать нечего.
 */
const FAREWELL_HTML =
  '🚫 <b>Bot disconnected</b>\n' +
  'This chat is no longer linked to your account. ' +
  'You can connect it again from your dashboard.\n\n' +
  '🚫 <b>Бот отключён</b>\n' +
  'Этот чат больше не связан с вашим аккаунтом. ' +
  'Подключить заново можно в личном кабинете.';

export interface TelegramLinkState {
  linked: boolean;
  username: string | null;
  linkedAt: Date | null;
  expiresAt: Date | null;
  scope: TelegramLinkScope | null;
  chatBlocked: boolean;
}

export type TelegramConfirmResult =
  | { ok: true; link: TelegramLink; username: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' };

/** Строка, возвращаемая атомарным гашением кода. */
interface RedeemedCodeRow {
  id: string;
  user_id: string;
  scope: TelegramLinkScope;
}

@Injectable()
export class BotLinkService {
  private readonly logger = new Logger(BotLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly twoFactor: TwoFactorService,
    private readonly rate: BotRateService,
    private readonly telegram: TelegramApiService,
    private readonly config: TelegramBotConfig,
  ) {}

  // =========================================================================
  //  ВЫПУСК КОДА (сайт)
  // =========================================================================

  /**
   * Одноразовый токен привязки для уже аутентифицированного пользователя.
   *
   * В БД уходит ТОЛЬКО sha256(token). Сам токен возвращается вызывающему
   * и больше нигде не остаётся: ни в логах, ни в аудите, ни в таблице.
   * Иначе дамп базы, реплика для аналитики или утёкший бэкап становились бы
   * готовым списком действующих отмычек к чужим аккаунтам.
   */
  async initForUser(params: {
    actor: AuthenticatedUser;
    scope?: TelegramLinkScope;
    totpCode?: string;
    ip?: string;
  }): Promise<{ token: string; deepLink: string; expiresAt: Date }> {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException({
        code: 'TELEGRAM_DISABLED',
        message: 'Telegram-бот отключён администратором',
      });
    }

    const userId = params.actor.id;

    // Лимит списывается ДО проверки второго фактора намеренно: иначе этот
    // эндпоинт превращается в бесплатный стенд для перебора TOTP — коды
    // шестизначные, и без потолка попыток шанс угадать за час перестаёт
    // быть теоретическим.
    const allowed = await this.rate.hit(`tg:linkcode:${userId}`, ISSUE_LIMIT, ISSUE_WINDOW_SEC);
    if (!allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Слишком много попыток подключения. Повторите позже.',
        },
        429,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorConfirmedAt: true },
    });

    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Пользователь не найден' });
    }

    // Область ADMIN — это доступ к админским командам бота, поэтому право
    // проверяется здесь, а не только при их вызове. Проверка «в момент
    // вызова» остаётся обязательной и там: роль могли снять за те 30 дней,
    // что живёт привязка.
    const scope =
      params.scope === TelegramLinkScope.ADMIN &&
      params.actor.permissions.has(ADMIN_SCOPE_PERMISSION)
        ? TelegramLinkScope.ADMIN
        : TelegramLinkScope.USER;

    if (params.scope === TelegramLinkScope.ADMIN && scope !== TelegramLinkScope.ADMIN) {
      // Наружу НЕ сообщаем, какого именно права не хватило: список админских
      // прав это карта административного API для того, кто её собирает.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Недостаточно прав для административной привязки',
      });
    }

    const twoFactorActive = Boolean(user.twoFactorEnabled && user.twoFactorConfirmedAt);

    // Step-up: подтверждение вторым фактором прямо сейчас, а не «когда-то
    // при входе». Перехваченная сессия иначе привязывает чужой Telegram
    // одним запросом и получает второй канал доступа, переживающий смену
    // пароля. Для области ADMIN step-up обязателен всегда.
    if (twoFactorActive || scope === TelegramLinkScope.ADMIN) {
      if (!params.totpCode) {
        throw new UnauthorizedException({
          code: 'TWO_FACTOR_REQUIRED',
          message: 'Требуется код двухфакторной аутентификации',
        });
      }
      await this.twoFactor.verify(userId, params.totpCode);
    }

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await this.prisma.telegramLinkCode.create({
      data: {
        id: uuidv7(),
        codeHash: this.hashToken(token),
        userId,
        scope,
        expiresAt,
        createdIp: params.ip ?? null,
      },
    });

    await this.audit.record({
      action: 'telegram.link.init',
      actorId: userId,
      actorType: ActorType.USER,
      entityType: 'user',
      entityId: userId,
      // Ни токена, ни его хеша: по хешу из журнала код гасится так же
      // успешно, как по самому токену.
      after: { scope, expiresAt: expiresAt.toISOString() },
      ip: params.ip ?? null,
    });

    this.logger.log(`выпущен код привязки Telegram для пользователя ${userId}, область ${scope}`);

    return { token, deepLink: this.config.deepLink(token), expiresAt };
  }

  // =========================================================================
  //  СОСТОЯНИЕ И ОТВЯЗКА (сайт)
  // =========================================================================

  /** Состояние привязки для кабинета. */
  async stateFor(userId: string): Promise<TelegramLinkState> {
    const link = await this.findActiveByUser(userId);

    if (!link) {
      return {
        linked: false,
        username: null,
        linkedAt: null,
        expiresAt: null,
        scope: null,
        chatBlocked: false,
      };
    }

    return {
      linked: true,
      username: link.username,
      linkedAt: link.linkedAt,
      expiresAt: link.expiresAt,
      scope: link.scope,
      chatBlocked: link.chatBlocked,
    };
  }

  /**
   * Отвязка кнопкой в кабинете.
   *
   * НЕ трогает OAuthAccount провайдера TELEGRAM. Это разные сущности:
   * запись OAuth — способ ВОЙТИ на сайт, привязка бота — канал доставки
   * и управления. Снести заодно и вход означало бы выбросить человека
   * из аккаунта за нажатие «отключить уведомления»; в худшем случае —
   * навсегда, если Telegram был его единственным способом входа
   * (тот самый 409 LAST_LOGIN_METHOD).
   */
  async revokeFromSite(userId: string, actor: AuthenticatedUser): Promise<void> {
    const link = await this.findActiveByUser(userId);

    if (!link) {
      throw new NotFoundException({
        code: 'TELEGRAM_NOT_LINKED',
        message: 'Telegram не подключён',
      });
    }

    await this.softRevoke(link.id, 'site_request');

    // Прощаемся ПОСЛЕ отзыва: если отправка упадёт, связь всё равно должна
    // считаться разорванной — иначе кнопка «отключить» ничего не делает
    // ровно в том случае, когда её нажимают из-за угона.
    await this.sayFarewell(link.chatId);

    await this.audit.record({
      action: 'telegram.link.revoke',
      actorId: actor.id,
      actorType: ActorType.USER,
      entityType: 'telegram_link',
      entityId: link.id,
      after: { source: 'site' },
    });

    this.logger.log(`привязка Telegram отозвана с сайта: пользователь ${userId}`);
  }

  // =========================================================================
  //  ОТВЯЗКА ИЗ ЧАТА
  // =========================================================================

  /** Команда /unlink. Прощальное сообщение шлёт экран бота, здесь только связь. */
  async revokeFromChat(linkId: string): Promise<void> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { id: linkId },
      select: { id: true, userId: true, revokedAt: true },
    });

    if (!link || link.revokedAt !== null) return;

    await this.softRevoke(link.id, 'user_request');

    // Письмо обязательно: отключение второго канала — событие безопасности,
    // и узнать о нём владелец должен там, откуда его нельзя отключить.
    //
    // Здесь именно enqueue({EMAIL}), а не enqueueMulti, и это не упущение:
    // привязка уже отозвана строкой выше, получателя для канала TELEGRAM
    // больше нет, и enqueueTelegram отсеял бы строку молча. Роль копии
    // в чате исполняют экран `screen.unlink.done` (отвязка из чата),
    // sayFarewell при вытеснении и отвязке с сайта.
    await this.notifications.enqueue({
      templateKey: 'telegram.unlinked',
      channel: NotificationChannel.EMAIL,
      userId: link.userId,
      payload: { reason: 'user_request' },
    });

    await this.audit.record({
      action: 'telegram.link.revoke',
      actorId: link.userId,
      actorType: ActorType.USER,
      actorLabel: `telegram:${linkId}`,
      entityType: 'telegram_link',
      entityId: link.id,
      after: { source: 'chat' },
    });

    this.logger.log(`привязка Telegram отозвана из чата: привязка ${linkId}`);
  }

  // =========================================================================
  //  ПОДТВЕРЖДЕНИЕ (бот)
  // =========================================================================

  /**
   * Гашение токена и создание связи. Вызывается из обработчика /start.
   *
   * Возвращает ОДИН отказ на все причины — «использован», «просрочен»,
   * «не существует» неразличимы снаружи. Различимые ответы превратили бы
   * бота в оракул: перебирающий узнавал бы, какие токены существовали.
   */
  async confirm(rawToken: string, from: TgUser, chat: TgChat): Promise<TelegramConfirmResult> {
    // Приватность чата проверяется и здесь, а не только в маршрутизаторе.
    // Привязка в группе означала бы, что список лицензий и кнопка сброса
    // HWID достаются всем её участникам.
    if (chat.type !== 'private' || chat.id !== from.id) {
      this.logger.warn(`попытка привязки вне приватного чата, тип ${chat.type}`);
      return { ok: false, reason: 'invalid' };
    }

    const codeHash = this.hashToken(rawToken);

    // Гашение ОДНИМ UPDATE ... WHERE used_at IS NULL ... RETURNING.
    //
    // Отдельные SELECT и UPDATE здесь были бы гонкой: два быстрых нажатия
    // Start (а Telegram доставляет апдейты параллельно) проходят проверку
    // одновременно, и один токен создаёт две привязки. Условие внутри
    // UPDATE делает победителя ровно одним — на уровне строки БД.
    //
    // Гашение сознательно вынесено ЗА транзакцию создания связи. Размен:
    // если создание ниже упадёт, код сгорит впустую и человеку придётся
    // выпустить новый (их пять в час — не потеря). Обратный размен хуже:
    // держать код непогашенным до конца транзакции значит вернуть то самое
    // окно, в котором два параллельных апдейта гасят один токен дважды.
    const rows = await this.prisma.$queryRaw<RedeemedCodeRow[]>`
      UPDATE telegram_link_codes
         SET used_at = now()
       WHERE code_hash = ${codeHash}
         AND used_at IS NULL
         AND expires_at > now()
      RETURNING id, user_id, scope
    `;

    const redeemed = rows[0];
    if (!redeemed) return { ok: false, reason: 'invalid' };

    const user = await this.prisma.user.findUnique({
      where: { id: redeemed.user_id },
      select: { id: true, status: true, deletedAt: true, locale: true },
    });

    // Аккаунт мог быть заблокирован в те десять минут, что жил токен.
    // Ответ тот же самый: сообщать «ваш аккаунт заблокирован» тому, кто
    // предъявил чужой токен, незачем.
    if (
      !user ||
      user.deletedAt !== null ||
      user.status === UserStatus.BLOCKED ||
      user.status === UserStatus.DELETED
    ) {
      this.logger.warn(`код привязки погашен для недоступного аккаунта ${redeemed.user_id}`);
      return { ok: false, reason: 'invalid' };
    }

    // Право могли снять между выпуском кода и нажатием Start. Понижаем
    // область молча вместо отказа: человек хотел подключить бота, и
    // отсутствие админских кнопок — не повод не подключать его вовсе.
    let scope = redeemed.scope;
    if (scope === TelegramLinkScope.ADMIN) {
      const stillAdmin = await this.hasAdminScopePermission(user.id);
      if (!stillAdmin) {
        this.logger.warn(`область ADMIN понижена до USER: право снято у ${user.id}`);
        scope = TelegramLinkScope.USER;
      }
    }

    const days = scope === TelegramLinkScope.ADMIN ? ADMIN_LINK_DAYS : USER_LINK_DAYS;
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const telegramUserId = from.id;
    const username = from.username ?? null;

    const { link, evicted } = await this.prisma.$transaction(async (tx) =>
      this.upsertLink(tx, {
        userId: user.id,
        telegramUserId,
        chatId: chat.id,
        username,
        scope,
        expiresAt,
        locale: user.locale,
      }),
    );

    // Побочные эффекты — строго после коммита: письмо о вытеснении,
    // отправленное при откате транзакции, обмануло бы владельца аккаунта.
    for (const old of evicted) {
      await this.audit.record({
        action: 'telegram.link.evict',
        actorId: user.id,
        actorType: ActorType.USER,
        actorLabel: `telegram:${telegramUserId}`,
        entityType: 'telegram_link',
        entityId: old.id,
        after: { replacedBy: link.id, previousUserId: old.userId },
      });

      // В чат, который прямо сейчас становится новым, прощаться не надо:
      // человек сидит в нём и через секунду увидит экран успеха.
      if (old.chatId !== chat.id) await this.sayFarewell(old.chatId);

      await this.notifications.enqueue({
        templateKey: 'telegram.unlinked',
        channel: NotificationChannel.EMAIL,
        userId: old.userId,
        payload: { reason: 'evicted' },
      });
    }

    // ТОЛЬКО письмо, и это разобранное решение, а не пропущенный enqueueMulti.
    //
    // Разбор пакета указал, что шаблон telegram.linked/TELEGRAM засеян, но
    // не заказывается ниоткуда. Проверено по коду: копия в чат здесь была бы
    // дублем в чистом виде. Единственный получатель канала TELEGRAM для этого
    // пользователя — привязка, созданная строкой выше, то есть ТОТ ЖЕ чат,
    // куда маршрутизатор сейчас нарисует экран E-01 с тем же содержанием.
    // Человек получил бы «✅ Готово, бот подключён» и следом «🔗 Бот подключён»
    // подряд.
    //
    // Вытесненный чат при этом не остаётся в неведении: ему уходит прощание
    // (sayFarewell выше по коду), а владельцу аккаунта — письмо. §3.4 ТЗ
    // предписывает здесь ровно письмо: почта — единственный якорь, который
    // угонщик не может отключить.
    await this.notifications.enqueue({
      templateKey: 'telegram.linked',
      channel: NotificationChannel.EMAIL,
      userId: user.id,
      locale: user.locale,
      payload: {
        // @username — кэш для показа, а не идентификатор. Если его нет,
        // подставляем числовой id: пустая строка в письме о безопасности
        // не даёт владельцу понять, ЧЕЙ чат подключён.
        username: username ?? String(telegramUserId),
        expiresAt: expiresAt.toISOString().slice(0, 10),
      },
    });

    await this.audit.record({
      action: 'telegram.link.confirm',
      actorId: user.id,
      actorType: ActorType.USER,
      actorLabel: `telegram:${telegramUserId}`,
      entityType: 'telegram_link',
      entityId: link.id,
      after: { scope, expiresAt: expiresAt.toISOString(), codeId: redeemed.id },
    });

    this.logger.log(
      `привязка Telegram подтверждена: пользователь ${user.id}, область ${scope}, ` +
        `вытеснено связей ${evicted.length}`,
    );

    return { ok: true, link, username: username ?? String(telegramUserId), expiresAt };
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Создание или воскрешение связи с вытеснением конфликтующих.
   * user_id и telegram_user_id уникальны даже у отозванных строк, поэтому:
   *   • та же пара (аккаунт, telegram-пользователь) — строка воскрешается
   *     на месте, сохраняя настройки уведомлений и обращения;
   *   • чужие строки, занявшие слот, удаляются и возвращаются как
   *     вытесненные (их владельцам уйдут письмо и прощание в чат).
   */
  private async upsertLink(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      telegramUserId: bigint;
      chatId: bigint;
      username: string | null;
      scope: TelegramLinkScope;
      expiresAt: Date;
      locale: string;
    },
  ): Promise<{
    link: TelegramLink;
    evicted: Array<{ id: string; userId: string; chatId: bigint }>;
  }> {
    const blocking = await tx.telegramLink.findMany({
      where: {
        OR: [{ userId: params.userId }, { telegramUserId: params.telegramUserId }],
      },
      select: {
        id: true,
        userId: true,
        chatId: true,
        telegramUserId: true,
        revokedAt: true,
      },
    });

    const reusable = blocking.find(
      (row) => row.userId === params.userId && row.telegramUserId === params.telegramUserId,
    );
    const conflicting = blocking.filter((row) => row.id !== reusable?.id);

    if (conflicting.length > 0) {
      await tx.telegramLink.deleteMany({ where: { id: { in: conflicting.map((r) => r.id) } } });
    }

    const now = new Date();
    const data = {
      telegramUserId: params.telegramUserId,
      chatId: params.chatId,
      username: params.username,
      locale: params.locale,
      scope: params.scope,
      chatBlocked: false,
      lastSeenAt: now,
      expiresAt: params.expiresAt,
      revokedAt: null,
      revokeReason: null,
    };

    const link = reusable
      ? await tx.telegramLink.update({
          where: { id: reusable.id },
          // linkedAt обновляется тоже: это дата действующей привязки, а не
          // дата первого знакомства. Иначе кабинет показывал бы «подключён
          // 90 дней назад» сразу после переподключения.
          data: { ...data, linkedAt: now },
        })
      : await tx.telegramLink.create({
          data: { id: uuidv7(), userId: params.userId, linkedAt: now, ...data },
        });

    const categories =
      params.scope === TelegramLinkScope.ADMIN
        ? [...BASE_CATEGORIES, TelegramNotifyCategory.ADMIN]
        : BASE_CATEGORIES;

    // skipDuplicates, потому что у воскрешённой строки настройки уже есть,
    // и перезаписывать их значило бы включать заново то, что пользователь
    // осознанно выключил.
    await tx.telegramNotificationPref.createMany({
      data: categories.map((category) => ({ linkId: link.id, category, enabled: true })),
      skipDuplicates: true,
    });

    // Понижение области с ADMIN до USER убирает лишний тумблер: иначе
    // в настройках остался бы переключатель категории, по которой этому
    // человеку больше ничего не приходит.
    await tx.telegramNotificationPref.deleteMany({
      where: { linkId: link.id, category: { notIn: categories } },
    });

    return {
      link,
      evicted: conflicting.map((row) => ({ id: row.id, userId: row.userId, chatId: row.chatId })),
    };
  }

  /** Мягкий отзыв: строка остаётся, чтобы причина была видна при разборе жалобы. */
  private async softRevoke(linkId: string, reason: string): Promise<void> {
    await this.prisma.telegramLink.updateMany({
      where: { id: linkId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  private async findActiveByUser(userId: string) {
    const link = await this.prisma.telegramLink.findUnique({
      where: { userId },
      select: {
        id: true,
        chatId: true,
        username: true,
        linkedAt: true,
        expiresAt: true,
        scope: true,
        chatBlocked: true,
        revokedAt: true,
      },
    });

    if (!link || link.revokedAt !== null) return null;
    if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) return null;

    return link;
  }

  /**
   * Право на админскую область читается из БД, а не из кэша прав.
   *
   * Кэш живёт пять минут, а решение принимается на 30 дней вперёд —
   * размен не в нашу пользу.
   */
  private async hasAdminScopePermission(userId: string): Promise<boolean> {
    const found = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: { permissions: { some: { permission: { slug: ADMIN_SCOPE_PERMISSION } } } },
      },
      select: { userId: true },
    });
    return found !== null;
  }

  /** Прощание в чат. Провал отправки не отменяет отвязку — она уже произошла. */
  private async sayFarewell(chatId: bigint): Promise<void> {
    try {
      await this.telegram.sendMessage(chatId, FAREWELL_HTML);
    } catch (error) {
      this.logger.warn(
        `не удалось отправить прощание в чат: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * SHA-256, а не Argon2.
   *
   * Медленный хеш нужен там, где секрет выбирает человек и его можно
   * подобрать по словарю. Здесь секрет — 32 байта CSPRNG, словаря для него
   * не существует, а Argon2 добавил бы 70 мс к каждому нажатию Start.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
