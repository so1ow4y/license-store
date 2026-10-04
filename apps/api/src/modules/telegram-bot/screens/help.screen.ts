import { Injectable } from '@nestjs/common';

import { kb, type KbButton } from '../bot-keyboard';
import { TelegramBotConfig } from '../telegram-bot.config';
import { t, type Locale } from '../i18n';
import { CB, type ScreenView } from './screen.types';

/**
 * Справка (E-13).
 *
 * Половина текста — про то, чего бот НЕ делает. Это не оговорка юриста:
 * человек, знающий, что бот никогда не спросит пароль и не выключит 2FA,
 * не поверит и тому, кто попросит их «от имени поддержки». Список
 * невозможного здесь работает как прививка от фишинга, поэтому сокращать
 * его нельзя.
 *
 * Экран доступен без привязки — вместе с каталогом это всё, что видит
 * непривязанный человек.
 */
@Injectable()
export class HelpScreen {
  constructor(private readonly config: TelegramBotConfig) {}

  help(locale: Locale, linked: boolean): ScreenView {
    const buttons: KbButton[][] = linked
      ? [[{ text: t(locale, 'btn.menu'), cb: CB.root }]]
      : [
          [{ text: t(locale, 'btn.connect'), url: `${this.config.appUrl}/account/telegram` }],
          [{ text: t(locale, 'btn.catalogue'), cb: CB.products }],
        ];

    return { text: t(locale, 'screen.help'), keyboard: kb(buttons) };
  }
}
