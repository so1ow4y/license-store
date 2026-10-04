import { Injectable, Logger } from '@nestjs/common';
import { LicenseStatus } from '@prisma/client';

import { AuthService } from '@modules/auth/auth.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import { formatDate, formatDateTime } from '../bot-format';
import { kb } from '../bot-keyboard';
import { TelegramBotConfig } from '../telegram-bot.config';
import { raw, t, type Locale } from '../i18n';
import { CB, type ScreenCtx, type ScreenView } from './screen.types';

/**
 * Корневые экраны: приветствие без привязки (E-00), подтверждение привязки
 * (E-01), главное меню (E-02) и честный ответ про продление (§5.9).
 *
 * Главное меню считает лицензии двумя count-запросами (всего и активных),
 * не загружая сами строки.
 */
@Injectable()
export class RootScreen {
  private readonly logger = new Logger(RootScreen.name);

  constructor(
    private readonly licenses: LicensesService,
    private readonly auth: AuthService,
    private readonly config: TelegramBotConfig,
  ) {}

  /** E-00. Единственный экран, который видит непривязанный человек. */
  welcome(locale: Locale): ScreenView {
    return {
      text: t(locale, 'screen.welcome_unlinked'),
      keyboard: kb([
        [{ text: t(locale, 'btn.connect'), url: `${this.config.appUrl}/account/telegram` }],
        [{ text: t(locale, 'btn.catalogue'), cb: CB.products }],
        [{ text: t(locale, 'btn.help'), cb: CB.help }],
      ]),
    };
  }

  /** E-01. Показывается один раз, сразу после `/start <token>`. */
  linkSuccess(locale: Locale, username: string, expiresAt: Date | null): ScreenView {
    return {
      text: t(locale, 'screen.link_success', {
        username,
        expiresAt: formatDate(locale, expiresAt),
      }),
      keyboard: kb([
        [{ text: t(locale, 'btn.licenses'), cb: CB.licenses }],
        [{ text: t(locale, 'btn.account'), cb: CB.account }],
      ]),
    };
  }

  /** E-02. Главное меню. */
  async root(ctx: ScreenCtx): Promise<ScreenView> {
    const { locale } = ctx;

    const [profile, all, active] = await Promise.all([
      this.auth.getPublicUser(ctx.actor.user.id),
      this.licenses.list(ctx.actor.user, { take: 1 }),
      this.licenses.list(ctx.actor.user, { status: LicenseStatus.ACTIVE, take: 100 }),
    ]);

    return {
      text: t(locale, 'screen.root', {
        username: profile.username,
        activeCount: active.total,
        totalCount: all.total,
        // Суффикс — уже готовый HTML (внутри экранированная дата), поэтому raw.
        expirySuffix: raw(this.expirySuffix(locale, active.items)),
      }),
      keyboard: kb([
        [{ text: t(locale, 'btn.licenses'), cb: CB.licenses }],
        [{ text: t(locale, 'btn.activate'), cb: CB.activate }],
        [{ text: t(locale, 'btn.catalogue'), cb: CB.products }],
        [{ text: t(locale, 'btn.account'), cb: CB.account }],
        [{ text: t(locale, 'btn.support'), cb: CB.support }],
      ]),
    };
  }

  /**
   * Экран «продления» (§5.9).
   *
   * Текст обязан говорить правду про вторую лицензию: активация второй
   * покупки создаёт новый `License` с новым ключом и новым счётчиком
   * сбросов, срок текущей не меняется (решение 0.5). Сгладить эту
   * формулировку значит превратить бота в источник обещания, которое
   * сервер не исполняет.
   */
  renew(locale: Locale): ScreenView {
    return {
      text: t(locale, 'screen.renew'),
      keyboard: kb([
        [{ text: t(locale, 'btn.catalogue'), cb: CB.products }],
        [{ text: t(locale, 'btn.menu'), cb: CB.root }],
      ]),
    };
  }

  /**
   * Ближайшее истечение среди активных лицензий.
   *
   * Считается по выборке до ста активных: у кого их больше, тому суффикс
   * в меню всё равно ничего не решает, а тянуть тысячи строк ради одной
   * даты незачем. Бессрочные (expiresAt = null) в расчёт не входят.
   */
  private expirySuffix(locale: Locale, items: Array<{ expiresAt: Date | null }>): string {
    let nearest: Date | null = null;

    for (const item of items) {
      if (!item.expiresAt) continue;
      if (!nearest || item.expiresAt.getTime() < nearest.getTime()) nearest = item.expiresAt;
    }

    if (!nearest) return '';

    // Дата уже экранирована t(): подставляем её через тот же механизм,
    // а не конкатенацией, чтобы правило «всё через escapeHtml» не имело
    // исключений даже там, где значение заведомо безопасно.
    return t(locale, 'fmt.expiry.suffix', { date: formatDateTime(locale, nearest) });
  }
}
