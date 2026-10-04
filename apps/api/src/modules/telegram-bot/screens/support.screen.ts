import { Injectable } from '@nestjs/common';

import { BotStateService } from '../bot-state.service';
import { BotSupportService } from '../bot-support.service';
import { kb } from '../bot-keyboard';
import { t } from '../i18n';
import { CB, type ScreenCtx, type ScreenView } from './screen.types';

/**
 * Поддержка (E-12).
 *
 * Экран сознательно предупреждает: пароли, коды и ключи присылать не нужно.
 * Не потому, что бот их отфильтрует — он не фильтрует и не должен: владелец
 * обязан видеть ровно то, что написал человек. А потому, что предупреждение
 * до ввода дешевле, чем разбор последствий после.
 */
@Injectable()
export class SupportScreen {
  constructor(
    private readonly support: BotSupportService,
    private readonly state: BotStateService,
  ) {}

  async ask(ctx: ScreenCtx): Promise<ScreenView> {
    await this.state.set(ctx.chatId, 'awaiting_support_text');

    return {
      text: t(ctx.locale, 'screen.support.ask'),
      keyboard: kb([[{ text: t(ctx.locale, 'btn.cancel'), cb: CB.root }]]),
    };
  }

  /** Текст обращения. Состояние снимается в любом исходе — второй попытки в этом же ходе нет. */
  async submit(ctx: ScreenCtx, text: string): Promise<ScreenView> {
    const { locale } = ctx;
    await this.state.clear(ctx.chatId);

    if (!(await this.support.allow(ctx.actor.user.id))) {
      return {
        text: t(locale, 'err.support_rate'),
        keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
      };
    }

    const ticket = await this.support.open(ctx.actor, text);

    if (!ticket) {
      return {
        text: t(locale, 'err.server'),
        keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
      };
    }

    return {
      text: t(locale, 'screen.support.sent', { ticketNo: ticket.ticketNo }),
      keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
    };
  }
}
