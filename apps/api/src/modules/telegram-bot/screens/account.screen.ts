import { Injectable, Logger } from '@nestjs/common';
import { TelegramNotifyCategory } from '@prisma/client';

import { PrismaService } from '@common/prisma/prisma.service';
import { AuthService } from '@modules/auth/auth.service';

import { BotActorService } from '../bot-actor.service';
import { BotLinkService } from '../bot-link.service';
import { BotStateService } from '../bot-state.service';
import { formatDate, formatDateTime, maskEmail } from '../bot-format';
import { kb, type KbButton } from '../bot-keyboard';
import { TelegramBotConfig } from '../telegram-bot.config';
import { t, type Locale } from '../i18n';
import { CB, type ScreenCtx, type ScreenView } from './screen.types';

/**
 * Аккаунт (E-09), настройки уведомлений (E-10), язык (§5.10) и отвязка
 * из чата (§5.11).
 *
 * Ничего из того, что меняет доступ к аккаунту, здесь нет и быть не может:
 * ни смены пароля, ни настройки 2FA, ни смены почты. Бот, умеющий выключать
 * второй фактор, — это обход второго фактора, и никакие подтверждения этого
 * не меняют (решение 0.4).
 */

/** Категории с тумблерами. ADMIN сюда не входит: он не про пользователя. */
const TOGGLEABLE: Array<{ category: TelegramNotifyCategory; label: 'btn.notify.license' | 'btn.notify.expiry' | 'btn.notify.security' | 'btn.notify.device' }> = [
  { category: TelegramNotifyCategory.LICENSE, label: 'btn.notify.license' },
  { category: TelegramNotifyCategory.EXPIRY, label: 'btn.notify.expiry' },
  { category: TelegramNotifyCategory.SECURITY, label: 'btn.notify.security' },
  { category: TelegramNotifyCategory.DEVICE, label: 'btn.notify.device' },
];

@Injectable()
export class AccountScreen {
  private readonly logger = new Logger(AccountScreen.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly links: BotLinkService,
    private readonly actors: BotActorService,
    private readonly state: BotStateService,
    private readonly config: TelegramBotConfig,
  ) {}

  // =========================================================================
  //  E-09. АККАУНТ
  // =========================================================================

  async account(ctx: ScreenCtx): Promise<ScreenView> {
    const { locale } = ctx;
    const profile = await this.auth.getPublicUser(ctx.actor.user.id);
    const link = await this.linkRow(ctx.actor.link.id);

    return {
      text: t(locale, 'screen.account', {
        username: profile.username,
        emailMasked: maskEmail(profile.email),
        twoFactorText: ctx.actor.user.twoFactorEnabled
          ? t(locale, 'fmt.twofactor.on')
          : t(locale, 'fmt.twofactor.off'),
        localeName: t(locale, locale === 'ru' ? 'fmt.locale.ru' : 'fmt.locale.en'),
        linkedAt: formatDate(locale, link?.linkedAt ?? null),
        expiresAt: formatDateTime(locale, ctx.actor.link.expiresAt),
      }),
      keyboard: kb([
        [{ text: t(locale, 'btn.notify'), cb: CB.notify }],
        [{ text: t(locale, 'btn.language'), cb: CB.lang }],
        [{ text: t(locale, 'btn.open_cabinet'), url: `${this.config.appUrl}/` }],
        [{ text: t(locale, 'btn.unlink'), cb: CB.unlink }],
        [{ text: t(locale, 'btn.menu'), cb: CB.root }],
      ]),
    };
  }

  // =========================================================================
  //  E-10. УВЕДОМЛЕНИЯ
  // =========================================================================

  async notify(ctx: ScreenCtx, alert?: string): Promise<ScreenView> {
    const { locale } = ctx;
    const enabled = await this.preferences(ctx.actor.link.id);

    const rows: KbButton[][] = TOGGLEABLE.map((item) => [
      {
        text: `${enabled.get(item.category) === false ? '▫️' : '✅'} ${t(locale, item.label)}`,
        cb: CB.notifyToggle(item.category),
      },
    ]);
    rows.push([{ text: t(locale, 'btn.back_to_account'), cb: CB.account }]);

    return {
      text: t(locale, 'screen.notify'),
      keyboard: kb(rows, { max: TOGGLEABLE.length + 1 }),
      ...(alert ? { alert } : {}),
    };
  }

  /**
   * Переключение категории.
   *
   * SECURITY не выключается ничем. Это не техническое ограничение, а суть:
   * уведомления безопасности — единственный способ узнать, что к аккаунту
   * получил доступ кто-то ещё. Дать их отключить значит дать угонщику
   * первым делом обрубить тревогу.
   */
  async toggle(ctx: ScreenCtx, rawCategory: string): Promise<ScreenView> {
    const category = this.parseCategory(rawCategory);
    if (!category) return this.notify(ctx);

    if (category === TelegramNotifyCategory.SECURITY) {
      return this.notify(ctx, t(ctx.locale, 'msg.security_always_on'));
    }

    const current = await this.prisma.telegramNotificationPref.findUnique({
      where: { linkId_category: { linkId: ctx.actor.link.id, category } },
      select: { enabled: true },
    });

    await this.prisma.telegramNotificationPref.upsert({
      where: { linkId_category: { linkId: ctx.actor.link.id, category } },
      // Строки может не быть у привязки, созданной до появления категории,
      // поэтому upsert, а не update: иначе тумблер молча не работает.
      create: { linkId: ctx.actor.link.id, category, enabled: false },
      update: { enabled: !(current?.enabled ?? true) },
    });

    return this.notify(ctx);
  }

  // =========================================================================
  //  ЯЗЫК (§5.10)
  // =========================================================================

  language(locale: Locale): ScreenView {
    return {
      text: t(locale, 'screen.language'),
      keyboard: kb([
        [{ text: t(locale, 'btn.lang_ru'), cb: CB.langSet('ru') }],
        [{ text: t(locale, 'btn.lang_en'), cb: CB.langSet('en') }],
        [{ text: t(locale, 'btn.back_to_account'), cb: CB.account }],
      ]),
    };
  }

  /**
   * Смена языка пишет В ОБА места: `TelegramLink.locale` и `User.locale`.
   *
   * Иначе экраны бота говорят по-русски, а письма и Telegram-уведомления
   * (их локаль берётся из `User.locale` в NotificationService.enqueue) —
   * по-английски. Для человека это выглядит не как настройка, а как поломка.
   *
   * Запись в `users` — единственное обращение бота к чужой таблице во всём
   * пакете. Своего метода у пакета привязки для этого нет; если он появится,
   * сюда встанет вызов сервиса (см. отчёт пакета).
   */
  async setLanguage(ctx: ScreenCtx, next: Locale): Promise<ScreenView> {
    await this.prisma.$transaction([
      this.prisma.telegramLink.update({
        where: { id: ctx.actor.link.id },
        data: { locale: next },
      }),
      this.prisma.user.update({
        where: { id: ctx.actor.user.id },
        data: { locale: next },
      }),
    ]);

    // Кэш актора держит локаль до 60 секунд — без сброса следующий экран
    // придёт на старом языке, и человек решит, что переключатель не сработал.
    await this.actors.invalidate(ctx.actor.user.id);

    return this.account({ ...ctx, locale: next });
  }

  // =========================================================================
  //  ОТВЯЗКА ИЗ ЧАТА (§5.11)
  // =========================================================================

  async unlinkConfirm(ctx: ScreenCtx): Promise<ScreenView> {
    const { locale } = ctx;
    const profile = await this.auth.getPublicUser(ctx.actor.user.id);
    const nonce = await this.state.newNonce(ctx.chatId, 'awaiting_unlink_confirm', {
      linkId: ctx.actor.link.id,
    });

    return {
      text: t(locale, 'screen.unlink.confirm', { username: profile.username }),
      keyboard: kb([
        [{ text: t(locale, 'btn.unlink_confirm'), cb: CB.unlinkGo(nonce) }],
        [{ text: t(locale, 'btn.cancel'), cb: CB.account }],
      ]),
    };
  }

  async unlink(ctx: ScreenCtx, nonce: string): Promise<ScreenView> {
    const { locale } = ctx;

    const consumed = await this.state.consumeNonce(ctx.chatId, 'awaiting_unlink_confirm', nonce);
    if (!consumed || consumed.linkId !== ctx.actor.link.id) {
      return {
        text: t(locale, 'err.expired_action'),
        keyboard: kb([[{ text: t(locale, 'btn.account'), cb: CB.account }]]),
      };
    }

    // Письмо на почту и запись в аудит делает сам revokeFromChat: отвязка —
    // событие безопасности, и узнать о ней владелец обязан по независимому
    // от бота каналу.
    await this.links.revokeFromChat(ctx.actor.link.id);
    await this.actors.invalidate(ctx.actor.user.id);
    await this.state.clear(ctx.chatId);

    this.logger.log(`привязка ${ctx.actor.link.id} отозвана из чата`);

    return {
      text: t(locale, 'screen.unlink.done'),
      // Кнопок нет намеренно: после отвязки бот отвечает только на
      // /start и /help, и кнопка, ведущая в закрытый экран, — это обещание,
      // которое немедленно нарушается.
      keyboard: kb([]),
    };
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  private async preferences(linkId: string): Promise<Map<TelegramNotifyCategory, boolean>> {
    const rows = await this.prisma.telegramNotificationPref.findMany({
      where: { linkId },
      select: { category: true, enabled: true },
    });

    return new Map(rows.map((row) => [row.category, row.enabled]));
  }

  private async linkRow(linkId: string) {
    return this.prisma.telegramLink.findUnique({
      where: { id: linkId },
      select: { linkedAt: true, username: true },
    });
  }

  private parseCategory(value: string): TelegramNotifyCategory | null {
    const found = TOGGLEABLE.find((item) => item.category === value);
    return found ? found.category : null;
  }
}
