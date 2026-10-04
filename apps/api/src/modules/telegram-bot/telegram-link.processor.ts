import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActorType, NotificationChannel } from '@prisma/client';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { NotificationService } from '@modules/notifications/notification.service';

import { TelegramBotConfig } from './telegram-bot.config';

/**
 * Обслуживание сроков привязки Telegram.
 *
 * Привязка живёт 90 дней (30 у администратора) и НЕ продлевается молча.
 * Без этого процессора «не продлевается» означало бы «работает вечно»:
 * expires_at проверяется при разборе апдейта, но истёкшая строка так и
 * оставалась бы в базе со статусом действующей — кабинет показывал бы
 * «подключён», уведомления уходили бы в чат, а причина отказа бота была бы
 * видна только по коду.
 *
 * Раз в час, а не раз в минуту: точность до часа для срока в 90 дней
 * избыточна, а лишние проходы по таблице не бесплатны.
 */

const LOCK_KEY = 'tg:links:lock';
const LOCK_TTL_SEC = 300;

/** Пакет за проход. Всё сразу читать нельзя — таблица растёт с аудиторией. */
const BATCH_SIZE = 500;

/** За сколько дней до истечения предупреждаем. */
const WARN_BEFORE_DAYS = 7;
const WARN_BEFORE_MS = WARN_BEFORE_DAYS * 86_400_000;

/**
 * Ключ «предупреждение уже отправлено».
 *
 * Живёт ровно окно предупреждения: пока привязка находится в этом окне,
 * ключ существует и второй раз письмо не уйдёт. Альтернатива — окно
 * шириной в один час, точно совпадающее с периодом крона, — теряла бы
 * предупреждение при любом пропущенном тике (перезапуск, выкладка).
 * Здесь худший случай при потере Redis — одно лишнее письмо, а не
 * молчание перед отключением второго канала доступа.
 */
const WARNED_PREFIX = 'tg:linkwarn:';
const WARNED_TTL_SEC = WARN_BEFORE_DAYS * 86_400;

/**
 * Сколько погашенные и просроченные коды лежат до удаления.
 *
 * Не удаляем сразу: сутки истории нужны, чтобы на жалобу «нажал ссылку,
 * а бот сказал, что код неверный» можно было ответить по данным, а не
 * по догадкам. Дольше держать нечего — гасить их уже нельзя.
 */
const CODE_RETENTION_MS = 86_400_000;

@Injectable()
export class TelegramLinkProcessor {
  private readonly logger = new Logger(TelegramLinkProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly config: TelegramBotConfig,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    // Рубильник — первой строкой, как и у обработчика очереди апдейтов.
    // Без него выключенный бот всё равно рассылал бы письма «привязка
    // истекает» и «привязка отозвана» про канал, которого сейчас нет:
    // человек получал бы тревожное письмо о том, что у него отключилось
    // то, что и так не работает. Отзыв истёкших при этом откладывается
    // до включения — и это правильнее, чем молча гасить привязки,
    // пока владелец разбирается с токеном.
    if (!this.config.enabled) return;

    // Блокировка на случай нескольких реплик: иначе письмо «привязка скоро
    // истечёт» уйдёт столько раз, сколько поднято инстансов.
    //
    // catch на самом взятии: без него недоступный Redis выбрасывает наружу
    // из @Cron, а необработанное отклонение в планировщике Nest не ловит
    // никто — процесс получает unhandledRejection. Пропустить час
    // обслуживания дешевле, чем уронить API.
    const acquired = await this.redis.client
      .set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEC, 'NX')
      .catch(() => null);
    if (acquired === null) return;

    try {
      // Порядок важен: сначала предупреждаем тех, у кого срок ещё идёт,
      // и только потом отзываем истёкшие. Обратный порядок отправил бы
      // «истекает через 7 дней» уже отозванной привязке.
      await this.warnExpiring();
      await this.revokeExpired();
      await this.purgeCodes();
    } catch (error) {
      this.logger.error(
        `сбой обслуживания привязок Telegram: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await this.redis.client.del(LOCK_KEY).catch(() => undefined);
    }
  }

  // =========================================================================
  //  ПРЕДУПРЕЖДЕНИЕ
  // =========================================================================

  private async warnExpiring(): Promise<number> {
    const now = new Date();
    const horizon = new Date(now.getTime() + WARN_BEFORE_MS);

    const soon = await this.prisma.telegramLink.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: now, lte: horizon },
      },
      select: { id: true, userId: true, expiresAt: true },
      orderBy: { expiresAt: 'asc' },
      take: BATCH_SIZE,
    });

    let sent = 0;

    for (const link of soon) {
      if (!(await this.claimWarning(link.id))) continue;

      const daysLeft = Math.max(
        1,
        Math.ceil(((link.expiresAt?.getTime() ?? now.getTime()) - now.getTime()) / 86_400_000),
      );

      // Категория SECURITY: и письмо, и сообщение в чат, который отключится.
      await this.notifications.enqueueMulti({
        templateKey: 'telegram.link_expiring',
        userId: link.userId,
        payload: {
          daysLeft,
          expiresAt: link.expiresAt?.toISOString().slice(0, 10) ?? '',
        },
      });
      sent++;
    }

    if (sent > 0) this.logger.log(`предупреждений об истечении привязки Telegram: ${sent}`);
    return sent;
  }

  /** true — предупреждение по этой привязке ещё не отправлялось. */
  private async claimWarning(linkId: string): Promise<boolean> {
    try {
      const claimed = await this.redis.client.set(
        `${WARNED_PREFIX}${linkId}`,
        '1',
        'EX',
        WARNED_TTL_SEC,
        'NX',
      );
      return claimed !== null;
    } catch (error) {
      // Redis недоступен — предупреждение пропускаем. Fail-open здесь дал бы
      // письмо каждый час до самого истечения, то есть 168 писем на человека.
      this.logger.warn(
        `не удалось отметить предупреждение по привязке ${linkId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  // =========================================================================
  //  ОТЗЫВ ИСТЁКШИХ
  // =========================================================================

  private async revokeExpired(): Promise<number> {
    const now = new Date();

    const overdue = await this.prisma.telegramLink.findMany({
      where: { revokedAt: null, expiresAt: { lte: now } },
      select: { id: true, userId: true },
      take: BATCH_SIZE,
    });

    if (overdue.length === 0) return 0;

    for (const link of overdue) {
      // Условие revokedAt: null внутри UPDATE, а не отдельной проверкой —
      // между выборкой и записью пользователь мог отвязаться сам, и тогда
      // его причина 'user_request' важнее нашей 'expired'.
      const revoked = await this.prisma.telegramLink.updateMany({
        where: { id: link.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'expired' },
      });

      if (revoked.count === 0) continue;

      await this.notifications.enqueue({
        templateKey: 'telegram.unlinked',
        channel: NotificationChannel.EMAIL,
        userId: link.userId,
        payload: { reason: 'expired' },
      });

      await this.audit.record({
        action: 'telegram.link.revoke',
        actorId: null,
        actorType: ActorType.SYSTEM,
        actorLabel: 'system',
        entityType: 'telegram_link',
        entityId: link.id,
        after: { source: 'expiry' },
      });
    }

    this.logger.log(`отозвано истёкших привязок Telegram: ${overdue.length}`);
    return overdue.length;
  }

  // =========================================================================
  //  УБОРКА КОДОВ
  // =========================================================================

  private async purgeCodes(): Promise<number> {
    const threshold = new Date(Date.now() - CODE_RETENTION_MS);

    const { count } = await this.prisma.telegramLinkCode.deleteMany({
      where: { expiresAt: { lt: threshold } },
    });

    if (count > 0) this.logger.log(`удалено просроченных кодов привязки: ${count}`);
    return count;
  }
}
