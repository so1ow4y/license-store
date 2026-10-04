import { Injectable, Logger } from '@nestjs/common';
import { TelegramLinkScope } from '@prisma/client';

import { DigisellerService } from '@modules/billing/digiseller.service';

import { formatDateTime, formatMoney } from '../bot-format';
import { kb } from '../bot-keyboard';
import { raw, t } from '../i18n';
import { CB, type ScreenCtx, type ScreenView } from './screen.types';

/**
 * Админский экран `/admin`: зависшие сделки Digiseller.
 *
 * ПРОВЕРОК ДВЕ, И ОБЕ ОБЯЗАТЕЛЬНЫ (§3.9 ТЗ).
 *
 * Первая — область привязки. Она подтверждает, что чат заводился ПОД
 * админский доступ: такая привязка требует TOTP в момент выпуска кода
 * и живёт 30 дней вместо 90.
 *
 * Вторая — право в момент вызова. Привязка со `scope = ADMIN` живёт месяц,
 * а роль могли снять вчера: доверять области значит оставить бывшему
 * сотруднику админский экран до конца срока.
 *
 * Ни одна не заменяет другую: без первой обходится step-up, без второй —
 * снятие роли.
 *
 * Кнопки «Выдать» здесь НЕТ, и это не упущение. Выдача необратима, требует
 * карточки заказа целиком (сумма, покупатель, товар, тариф) и подтверждения
 * — то есть формы, а не кнопки в чате. Чат хорош как сигнал «посмотри»,
 * а не как пульт необратимых операций.
 */

/** Сколько сделок показывается. Дальше это уже не сигнал, а выгрузка. */
const MAX_ROWS = 10;

/** Право, дающее доступ к экрану. Совпадает с тем, что стоит на `GET /billing/digiseller/pending`. */
const REQUIRED_PERMISSION = 'licenses.create.any';

@Injectable()
export class AdminScreen {
  private readonly logger = new Logger(AdminScreen.name);

  constructor(private readonly digiseller: DigisellerService) {}

  /**
   * `null` означает «прав нет».
   *
   * Маршрутизатор отвечает на это «не знаю такой команды»: сообщать, какого
   * права не хватило, — значит рисовать карту админского API тому, кто её
   * собирает (то же правило, что в permissions.guard.ts).
   */
  async pending(ctx: ScreenCtx): Promise<ScreenView | null> {
    // Нужна привязка с областью ADMIN (выдаётся после ввода TOTP), а не
    // только право: иначе обычная привязка обходила бы step-up.
    if (ctx.actor.link.scope !== TelegramLinkScope.ADMIN) return null;

    if (!ctx.actor.user.permissions.has(REQUIRED_PERMISSION)) return null;

    const { locale } = ctx;
    const deals = await this.digiseller.listPending();

    if (deals.length === 0) {
      return {
        text: t(locale, 'screen.admin.empty'),
        keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
      };
    }

    const items = deals
      .slice(0, MAX_ROWS)
      .map((deal) =>
        t(locale, 'screen.admin.item', {
          // invId у сделки, заведённой по коду площадки, может быть пуст:
          // номер счёта приходит только вместе с подтверждением покупки.
          invId: deal.invId?.toString() ?? t(locale, 'fmt.none'),
          amount: formatMoney(deal.amount),
          currency: deal.currency ?? '',
          productId: deal.digisellerProductId ?? t(locale, 'fmt.none'),
          createdAt: formatDateTime(locale, deal.createdAt),
        }),
      )
      .join('\n');

    this.logger.log(`админ ${ctx.actor.user.id} смотрит зависшие сделки: ${deals.length}`);

    return {
      text: t(locale, 'screen.admin.pending', { items: raw(items) }),
      keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
    };
  }
}
