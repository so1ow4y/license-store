import { Injectable } from '@nestjs/common';

import { ProductsService } from '@modules/products/products.service';

import { durationText, formatMoney } from '../bot-format';
import { kb, paginateLabeled, type KbButton } from '../bot-keyboard';
import { truncate } from '../telegram-html';
import { raw, t, type Locale } from '../i18n';
import { CB, type ScreenView } from './screen.types';

/**
 * Каталог (E-11) — единственный экран, доступный без привязки.
 *
 * Данные берутся только через `ProductsService.listPublic()`: он отбирает
 * `status = ACTIVE`, то есть скрытые и архивные продукты сюда не попадают
 * в принципе. Своего запроса в таблицу продуктов здесь нет намеренно —
 * фильтр статуса должен жить в одном месте, иначе следующий забытый
 * `where` показывает невыпущенный продукт в чате.
 *
 * Карточка ищется по id В УЖЕ ПОЛУЧЕННОМ СПИСКЕ, а не отдельным запросом:
 * публичного метода «найти по id» у сервиса нет, а `findByIdForAdmin`
 * отдаёт любой статус — вызвать его отсюда значило бы открыть боту то,
 * что закрыто правом products.manage.
 */

/** Продуктов на страницу: столько же кнопок помещается в экран без прокрутки. */
const PAGE_SIZE = 5;

/** Потолок описания продукта. Лимит сообщения — 4096 символов на всё. */
const MAX_DESCRIPTION = 700;

/**
 * Кнопок покупки на карточке. Кнопка «назад» учитывается отдельно, чтобы
 * kb() не обрезал её; полный список тарифов и так есть в тексте.
 */
const MAX_BUY_BUTTONS = 5;

/** Ссылка на оплату. Тот же вид, что во фронте (features/catalog/api.ts). */
function purchaseUrl(digisellerProductId: number): string {
  return `https://www.digiseller.market/asp/pay_wm.asp?id_d=${digisellerProductId}`;
}

@Injectable()
export class ProductsScreen {
  constructor(private readonly products: ProductsService) {}

  async list(locale: Locale, page = 0): Promise<ScreenView> {
    const all = await this.products.listPublic();

    if (all.length === 0) {
      return {
        text: t(locale, 'screen.products.empty'),
        keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
      };
    }

    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const safePage = Number.isInteger(page) && page >= 0 && page < pages ? page : 0;
    const slice = all.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

    const rows: KbButton[][] = slice.map((product) => [
      { text: product.name, cb: CB.product(product.id) },
    ]);

    const navigation = paginateLabeled(safePage, pages, 'products', {
      prev: t(locale, 'btn.prev'),
      next: t(locale, 'btn.next'),
    });
    if (navigation.length > 0) rows.push(navigation);
    rows.push([{ text: t(locale, 'btn.menu'), cb: CB.root }]);

    return {
      text: t(locale, 'screen.products.list'),
      keyboard: kb(rows, { max: PAGE_SIZE + 3 }),
    };
  }

  async card(locale: Locale, productId: string): Promise<ScreenView> {
    const all = await this.products.listPublic();
    const product = all.find((item) => item.id === productId);

    if (!product) {
      // Скрытый, архивный или несуществующий — один и тот же ответ.
      // Подтверждать существование невыпущенного продукта незачем.
      return {
        text: t(locale, 'err.expired_action'),
        keyboard: kb([[{ text: t(locale, 'btn.back_to_catalogue'), cb: CB.products }]]),
      };
    }

    const plans = product.plans
      .map((plan) =>
        t(locale, 'screen.products.plan', {
          planName: plan.name,
          durationText: durationText(locale, plan.durationDays),
          price: formatMoney(plan.price),
          currency: plan.currency,
        }),
      )
      .join('\n');

    // Тариф без номера товара на площадке купить негде — кнопки у него нет.
    // flatMap, а не filter+map: он сужает тип и обходится без утверждения
    // «здесь точно не null», которое переживёт правку схемы молча.
    const buyButtons: KbButton[][] = product.plans
      .flatMap((plan) =>
        plan.digisellerProductId === null
          ? []
          : [[{ text: `🛒 ${plan.name}`, url: purchaseUrl(plan.digisellerProductId) }]],
      )
      .slice(0, MAX_BUY_BUTTONS);

    return {
      text: t(locale, 'screen.products.card', {
        name: product.name,
        // Обрезка ДО экранирования: обрезанная сущность («&am») ломает
        // разбор разметки, и Telegram отвергает сообщение целиком.
        description: truncate(product.description ?? '', MAX_DESCRIPTION),
        plans: raw(plans),
      }),
      keyboard: kb([...buyButtons, [{ text: t(locale, 'btn.back_to_catalogue'), cb: CB.products }]], {
        // Потолок = кнопки покупки + возврат. Считается от факта, а не от
        // константы 6: иначе достаточно шестого тарифа, чтобы отрезать выход.
        max: buyButtons.length + 1,
      }),
    };
  }
}
