import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
  TelegramLinkScope,
  TelegramNotifyCategory,
} from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';
import { maskLicenseKey, redactLicenseKeys } from '@common/utils/license-key';
import { BotRateService } from '@modules/telegram-bot/bot-rate.service';
import { TelegramBotConfig } from '@modules/telegram-bot/telegram-bot.config';
import { escapeHtml } from '@modules/telegram-bot/telegram-html';

/**
 * Категория подписки для ключа шаблона. Ключа нет в таблице — в Telegram
 * событие НЕ уходит: забытый новый шаблон промолчит, а не уедет в чат мимо
 * настроек подписки.
 */
const TEMPLATE_CATEGORY: Record<string, TelegramNotifyCategory> = {
  'license.issued': TelegramNotifyCategory.LICENSE,
  'license.revoked': TelegramNotifyCategory.LICENSE,
  'license.expiring': TelegramNotifyCategory.EXPIRY,
  'hwid.reset': TelegramNotifyCategory.DEVICE,
  'telegram.linked': TelegramNotifyCategory.SECURITY,
  'telegram.unlinked': TelegramNotifyCategory.SECURITY,
  'telegram.link_expiring': TelegramNotifyCategory.SECURITY,
  'order.awaiting_confirmation': TelegramNotifyCategory.ADMIN,
  'reseller.topup.awaiting': TelegramNotifyCategory.ADMIN,
};

/**
 * Поля payload'а, которые не уезжают в Telegram: переписка живёт в облаке и
 * видна на экране блокировки, а ключ лицензии предъявительский. Вырезается
 * здесь, а не доверяется авторам шаблонов.
 */
const TELEGRAM_FORBIDDEN_PAYLOAD_FIELDS = [
  'licenseKey',
  'key',
  'code',
  'password',
  'token',
  'secret',
];

/**
 * Тихие часы: 23:00–08:00 по Москве (решение A3 — поля таймзоны у User нет,
 * считаем всех по МСК). Реализуются полем Notification.scheduledAt, а не
 * пропуском строки в обработчике: пропуск заставлял бы процессор перечитывать
 * одну и ту же строку каждые 5 секунд до самого утра.
 */
const QUIET_FROM_HOUR = 23;
const QUIET_TO_HOUR = 8;
const MSK_OFFSET_MIN = 180;

/** Одно и то же событие по одной лицензии — не чаще раза в 6 часов. */
const TELEGRAM_DEDUP_HOURS = 6;
/** Потолок сообщений боту на пользователя в час. */
const TELEGRAM_CAP_PER_HOUR = 10;

/**
 * Постановка уведомлений в очередь и их рендеринг.
 *
 * Очередь — сама таблица notifications (status, attempts, error, sent_at),
 * а не брокер: второй источник правды разъехался бы с базой при первом сбое
 * между коммитом и публикацией.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    private readonly telegramConfig: TelegramBotConfig,
    private readonly botRate: BotRateService,
  ) {}

  /**
   * Ставит уведомление в очередь. Не отправляет — этим занимается
   * фоновый обработчик.
   *
   * Вызывается внутри бизнес-операции и НЕ должен её ронять: если
   * поставить в очередь не удалось, лицензия всё равно должна быть выдана,
   * а пароль — сменён.
   */
  async enqueue(params: {
    templateKey: string;
    channel: NotificationChannel;
    /** Получатель. Для email — адрес; при пустом берётся из профиля. */
    recipient?: string;
    userId?: string;
    locale?: string;
    payload?: Record<string, unknown>;
    /**
     * Отложить отправку до указанного момента. Используется тихими часами
     * Telegram и переносом после 429 от Bot API. null и undefined значат
     * «отправлять при ближайшем проходе обработчика».
     */
    scheduledAt?: Date | null;
  }): Promise<string | null> {
    try {
      const locale =
        params.locale ??
        (params.userId ? await this.resolveUserLocale(params.userId) : undefined) ??
        (await this.settings.getString('app.default_locale', 'ru'));

      const recipient = params.recipient ?? (await this.resolveRecipient(params));

      if (!recipient) {
        this.logger.warn(`уведомление ${params.templateKey} без получателя — пропущено`);
        return null;
      }

      const id = uuidv7();
      await this.prisma.notification.create({
        data: {
          id,
          userId: params.userId ?? null,
          channel: params.channel,
          status: NotificationStatus.PENDING,
          recipient,
          templateKey: params.templateKey,
          locale,
          scheduledAt: params.scheduledAt ?? null,
          payload: (params.payload ?? {}) as never,
        },
      });

      return id;
    } catch (error) {
      this.logger.error(
        `не удалось поставить в очередь ${params.templateKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  // =========================================================================
  //  ДВА КАНАЛА НА ОДНО СОБЫТИЕ
  // =========================================================================

  /**
   * Одно событие — письмо всегда, Telegram по возможности.
   *
   * Письмо не зависит от настроек бота намеренно: почта — единственный якорь
   * восстановления доступа (решение 0.6 ТЗ бота). Дать её отключить — дать
   * угонщику обрубить тревогу: он привязал бы свой чат, выключил категорию
   * SECURITY и спокойно менял бы пароль, пока владелец ничего не видит.
   *
   * Telegram-ветка НЕ имеет права уронить вызывающего и НЕ имеет права
   * помешать письму: она идёт второй и целиком в try/catch. Худшее, что может
   * случиться при недоступном Redis или битой привязке, — человек не получит
   * дубль в чат и получит письмо.
   */
  async enqueueMulti(params: {
    templateKey: string;
    userId: string;
    locale?: string;
    payload?: Record<string, unknown>;
    /** Явный адрес письма. Без него берётся users.email. */
    emailRecipient?: string;
  }): Promise<{ email: string | null; telegram: string | null }> {
    const email = await this.enqueue({
      templateKey: params.templateKey,
      channel: NotificationChannel.EMAIL,
      recipient: params.emailRecipient,
      userId: params.userId,
      locale: params.locale,
      payload: params.payload,
    });

    let telegram: string | null = null;
    try {
      telegram = await this.enqueueTelegram(params);
    } catch (error) {
      this.logger.error(
        `telegram-копия ${params.templateKey} не поставлена: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { email, telegram };
  }

  /**
   * Telegram-копия события. Возвращает id уведомления либо null, если
   * событие отсеяно одним из фильтров (рубильник, привязка, подписка,
   * дедупликация, потолок).
   *
   * Порядок фильтров не случаен: сначала бесплатные проверки в памяти,
   * потом обращения к БД, и только в самом конце — расход бюджета в Redis.
   * Иначе отсеянное на подписке событие всё равно съедало бы потолок часа.
   */
  private async enqueueTelegram(params: {
    templateKey: string;
    userId: string;
    locale?: string;
    payload?: Record<string, unknown>;
  }): Promise<string | null> {
    if (!this.telegramConfig.enabled) return null;

    const category = TEMPLATE_CATEGORY[params.templateKey];
    if (!category) {
      // Не warn на каждое письмо: у писем вроде auth.password_reset
      // Telegram-копии нет и быть не должно, это штатный путь.
      this.logger.debug(`шаблон ${params.templateKey} без категории Telegram — только почта`);
      return null;
    }

    const link = await this.prisma.telegramLink.findFirst({
      where: {
        userId: params.userId,
        revokedAt: null,
        chatBlocked: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, chatId: true, locale: true, scope: true },
    });
    if (!link) return null;

    // Категория ADMIN приходит только в админский чат. Строки настройки
    // для неё у обычной привязки не существует вовсе (её создаёт пакет
    // привязки только при scope=ADMIN), поэтому без этой проверки
    // «строки нет ⇒ по умолчанию включено» отправило бы алерт о зависшей
    // сделке обычному покупателю.
    if (category === TelegramNotifyCategory.ADMIN && link.scope !== TelegramLinkScope.ADMIN) {
      return null;
    }

    if (!(await this.isCategoryEnabled(link.id, category))) return null;

    // SECURITY не проходит ни дедупликацию, ни потолок часа. Это ровно те
    // события, ради которых второй канал и заводился: «бот подключён»,
    // «бот отключён». Молчание здесь — готовый сценарий для угонщика,
    // которому достаточно набить десять безобидных уведомлений за час,
    // чтобы тревога о привязке чужого чата ушла «молча в лог».
    const critical = category === TelegramNotifyCategory.SECURITY;

    if (!critical && !(await this.passesDedup(params.userId, params.templateKey, params.payload))) {
      return null;
    }

    if (!critical && !(await this.botRate.hit(`tg:notify:${params.userId}`, TELEGRAM_CAP_PER_HOUR, 3600))) {
      this.logger.warn(
        `потолок telegram-уведомлений исчерпан для ${params.userId}, ${params.templateKey} пропущено`,
      );
      return null;
    }

    return this.enqueue({
      templateKey: params.templateKey,
      channel: NotificationChannel.TELEGRAM,
      // Адрес подставляется явно: привязка уже прочитана выше, второй
      // запрос в resolveRecipient был бы лишним и мог бы вернуть другую
      // строку, если между вызовами произошло вытеснение привязки.
      recipient: String(link.chatId),
      userId: params.userId,
      // Язык чата важнее языка кабинета: человек читает бота там, где
      // выбрал язык кнопкой «🌐 Язык», а не там, где менял профиль.
      locale: params.locale ?? link.locale,
      payload: this.sanitizeTelegramPayload(params.payload),
      scheduledAt: this.quietDelay(category),
    });
  }

  /**
   * Включена ли категория у этой привязки.
   *
   * Отсутствие строки трактуется как «включено»: в схеме у enabled стоит
   * @default(true), и набор настроек создаётся при привязке. Строки может
   * не быть у привязок, созданных до появления новой категории, — молчать
   * из-за этого неправильно.
   *
   * SECURITY не отключается вовсе (§6.3 ТЗ): запрет живёт здесь, а не
   * CHECK-ограничением в схеме, чтобы снятие запрета не требовало миграции.
   */
  private async isCategoryEnabled(
    linkId: string,
    category: TelegramNotifyCategory,
  ): Promise<boolean> {
    if (category === TelegramNotifyCategory.SECURITY) return true;

    const pref = await this.prisma.telegramNotificationPref.findUnique({
      where: { linkId_category: { linkId, category } },
      select: { enabled: true },
    });
    return pref?.enabled ?? true;
  }

  /**
   * Дедупликация (userId, templateKey, licenseId) — не чаще раза в 6 часов.
   *
   * Ключ ставится через SET NX: атомарно, поэтому два одновременных события
   * по одной лицензии дадут ровно одно сообщение, а не два.
   *
   * Redis недоступен ⇒ пропускаем (true). Дедупликация — удобство, а не
   * рубеж безопасности; ценой её отказа будет дубль в чате, ценой отказа
   * в обратную сторону — потерянное уведомление.
   */
  private async passesDedup(
    userId: string,
    templateKey: string,
    payload?: Record<string, unknown>,
  ): Promise<boolean> {
    const licenseId = this.dedupScope(payload);
    const key = `tg:dedup:${userId}:${templateKey}:${licenseId}`;

    try {
      const acquired = await this.redis.client.set(
        key,
        '1',
        'EX',
        TELEGRAM_DEDUP_HOURS * 3600,
        'NX',
      );
      return acquired !== null;
    } catch (error) {
      this.logger.warn(
        `дедупликация telegram недоступна: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
  }

  /**
   * Ось дедупликации внутри шаблона — как правило, лицензия.
   *
   * ПОЧЕМУ ЭТО ВАЖНО, А НЕ КОСМЕТИКА. Без оси все события одного шаблона
   * сливаются в одно: у человека с тремя лицензиями, истекающими в один день,
   * два уведомления из трёх были бы съедены дедупликацией — и он узнал бы
   * об истечении двух лицензий постфактум.
   *
   * Порядок предпочтений: licenseId (payload его даёт не везде — см. отчёт
   * пакета), затем хеш ключа лицензии, затем общая ось на пользователя.
   * Именно ХЕШ, а не сам ключ: ключи Redis видны в MONITOR и в slowlog,
   * то есть попадали бы туда же, куда §7.6 ТЗ запрещает им попадать.
   *
   * Значение чистится от посторонних символов: двоеточие — разделитель
   * пространства ключей Redis, и подставленный туда идентификатор
   * с двоеточием склеил бы два разных события в одно.
   */
  private dedupScope(payload?: Record<string, unknown>): string {
    const licenseId = payload?.licenseId;
    if (typeof licenseId === 'string' || typeof licenseId === 'number') {
      const clean = String(licenseId).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
      if (clean.length > 0) return clean;
    }

    const key = payload?.licenseKey ?? payload?.key ?? payload?.maskedKey;
    if (typeof key === 'string' && key.length > 0) {
      return createHash('sha256').update(key).digest('hex').slice(0, 16);
    }

    return '-';
  }

  /**
   * Вырезает из payload'а всё, что не должно попасть в переписку, и
   * подставляет маску ключа.
   *
   * Оставшиеся строки дополнительно прогоняются через цензор ключей: ключ
   * умеет приехать не только полем licenseKey, но и внутри свободного текста
   * (причина отзыва, деталь антифрода), где его никто не ждёт.
   */
  private sanitizeTelegramPayload(
    payload?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!payload) return {};

    const source = payload.licenseKey ?? payload.key;
    const result: Record<string, unknown> = {};

    for (const [name, value] of Object.entries(payload)) {
      if (TELEGRAM_FORBIDDEN_PAYLOAD_FIELDS.includes(name)) continue;
      result[name] = typeof value === 'string' ? redactLicenseKeys(value) : value;
    }

    if (typeof source === 'string' && result.maskedKey === undefined) {
      result.maskedKey = maskLicenseKey(source);
    }

    return result;
  }

  /**
   * Момент отправки с учётом тихих часов, либо null для «сейчас».
   *
   * SECURITY и ADMIN будят: сообщение «бот подключён к вашему аккаунту»
   * в три часа ночи — это единственный момент, когда владелец ещё может
   * успеть что-то сделать. Остальное ждёт восьми утра.
   *
   * Сдвиг считается арифметикой над UTC, а не через toLocaleString: у Node
   * без полного ICU перевод в именованную зону молча даёт UTC, и тихие часы
   * поехали бы на три часа ровно там, где их никто не проверяет — на боевом
   * сервере в контейнере slim.
   */
  private quietDelay(category: TelegramNotifyCategory): Date | null {
    if (
      category === TelegramNotifyCategory.SECURITY ||
      category === TelegramNotifyCategory.ADMIN
    ) {
      return null;
    }

    const now = new Date();
    const msk = new Date(now.getTime() + MSK_OFFSET_MIN * 60_000);
    const hour = msk.getUTCHours();

    if (hour < QUIET_FROM_HOUR && hour >= QUIET_TO_HOUR) return null;

    const target = new Date(msk.getTime());
    // 23:00 и позже — утро уже следующих суток; до 08:00 — сегодняшних.
    if (hour >= QUIET_FROM_HOUR) target.setUTCDate(target.getUTCDate() + 1);
    target.setUTCHours(QUIET_TO_HOUR, 0, 0, 0);

    return new Date(target.getTime() - MSK_OFFSET_MIN * 60_000);
  }

  // =========================================================================
  //  РЕНДЕРИНГ
  // =========================================================================

  /**
   * Рендеринг шаблона.
   *
   * Локаль подбирается с откатом: запрошенная → язык по умолчанию.
   * Без отката добавление нового языка ломало бы рассылку до тех пор,
   * пока не переведут все шаблоны.
   */
  async render(
    templateKey: string,
    channel: NotificationChannel,
    locale: string,
    payload: Record<string, unknown>,
  ): Promise<{ subject: string | null; body: string }> {
    const defaultLocale = await this.settings.getString('app.default_locale', 'ru');

    const template =
      (await this.prisma.notificationTemplate.findUnique({
        where: { key_locale_channel: { key: templateKey, locale, channel } },
      })) ??
      (await this.prisma.notificationTemplate.findUnique({
        where: { key_locale_channel: { key: templateKey, locale: defaultLocale, channel } },
      }));

    if (!template || !template.isActive) {
      throw new Error(`шаблон ${templateKey}/${locale}/${channel} не найден`);
    }

    // Тело сообщения Telegram уходит с parse_mode: HTML, поэтому любое
    // подставляемое значение обязано быть экранировано. Имя пользователя
    // Telegram может содержать «<b>» ровно так же, как и любой текст,
    // и без экранирования разметка чужого ника ломала бы наше сообщение —
    // а в худшем случае подрисовывала бы к нему ссылку.
    const escape = channel === NotificationChannel.TELEGRAM;

    const subject = template.subject
      ? this.substitute(template.subject, payload, templateKey, escape)
      : null;
    const body = this.substitute(template.body, payload, templateKey, escape);

    if (!escape) return { subject, body };

    // Последний рубеж §7.6 ТЗ: ключ не должен попасть в переписку никаким
    // путём. enqueueMulti чистит payload, но enqueue({channel: TELEGRAM})
    // можно позвать и напрямую — например, алертом администратору.
    return { subject: subject === null ? null : redactLicenseKeys(subject), body: redactLicenseKeys(body) };
  }

  /**
   * Подстановка {{переменных}}.
   *
   * Отсутствующая переменная заменяется пустой строкой, а не оставляется
   * как есть: увидеть в письме «Здравствуйте, {{username}}» хуже, чем
   * «Здравствуйте, ». В лог при этом пишется предупреждение, чтобы
   * пропуск не остался незамеченным.
   */
  private substitute(
    template: string,
    payload: Record<string, unknown>,
    templateKey: string,
    escape = false,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = payload[name];
      if (value === undefined || value === null) {
        this.logger.warn(`в шаблоне ${templateKey} не заполнена переменная ${name}`);
        return '';
      }
      const text = String(value);
      return escape ? escapeHtml(text) : text;
    });
  }

  private async resolveUserLocale(userId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return user?.locale;
  }

  /**
   * Адрес получателя из профиля.
   *
   * Заполняется на момент постановки в очередь, а не при отправке: адрес
   * мог смениться между этими моментами, и письмо о смене адреса должно
   * уйти на старый.
   */
  private async resolveRecipient(params: {
    channel: NotificationChannel;
    userId?: string;
  }): Promise<string | null> {
    if (!params.userId) return null;

    if (params.channel === NotificationChannel.EMAIL) {
      const user = await this.prisma.user.findUnique({
        where: { id: params.userId },
        select: { email: true },
      });
      return user?.email ?? null;
    }

    if (params.channel === NotificationChannel.TELEGRAM) {
      // Адрес — chat_id из telegram_links, а НЕ provider_user_id из
      // oauth_accounts: последний идентифицирует пользователя виджета входа,
      // а не чат с ботом. Отправка по нему ушла бы в никуда — Bot API вернул
      // бы «chat not found», и мы бы отвязали живую привязку по чужой ошибке.
      //
      // chatBlocked = false в условии: заблокировавший бота человек всё равно
      // получит письмо, а очередь не будет восемь часов долбиться в 403.
      const link = await this.prisma.telegramLink.findFirst({
        where: {
          userId: params.userId,
          revokedAt: null,
          chatBlocked: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { chatId: true },
      });
      return link ? String(link.chatId) : null;
    }

    return null;
  }
}
