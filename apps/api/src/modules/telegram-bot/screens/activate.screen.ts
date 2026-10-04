import { Injectable, Logger } from '@nestjs/common';

import { RegistrationKeyService } from '@modules/auth/registration-key.service';
import { DigisellerService } from '@modules/billing/digiseller.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import { BotRateService } from '../bot-rate.service';
import { BotStateService } from '../bot-state.service';
import { looksLikeLicenseKey, toLicenseView, validUntil } from '../bot-format';
import { kb, type KbButton } from '../bot-keyboard';
import { TelegramBotConfig } from '../telegram-bot.config';
import { t, type Locale, type MessageKey } from '../i18n';
import { CB, apiErrorCode, type ScreenCtx, type ScreenView } from './screen.types';

/**
 * Активация покупки (E-08): код Digiseller, номер заказа с почтой,
 * регистрационный ключ.
 *
 * Три из четырёх точек свободного ввода во всём боте — здесь, и все три
 * принимают одноразовый секрет. Отсюда два жёстких правила, которые нельзя
 * ослабить ради удобства:
 *
 *   1. Входящее сообщение удаляется ДО обработки и ДО любого логирования.
 *      Это делает маршрутизатор — он видит message_id, экран уже нет.
 *   2. Из ответов сервисов поле `licenseKey` вырезается немедленно, до
 *      рендера и до записи в лог. Дальше экран работает с `licenseId`.
 *
 * Ключ лицензии, введённый вместо кода Digiseller, до площадки НЕ доезжает:
 * иначе он уедет в ИХ логи как неудачная попытка активации, и отозвать его
 * оттуда будет нечем.
 */

/** Потолок длины ввода. Код — 16 символов, всё длиннее это уже не код. */
const MAX_INPUT_LENGTH = 128;

/** Лимит попыток активации: 10 в час на пользователя (§7.5 ТЗ). */
const ACTIVATE_LIMIT = 10;
const ACTIVATE_WINDOW_SEC = 3600;

/** Сколько раз подряд можно не разобрать «номер заказа + почта» (§5.5 ТЗ). */
const MAX_ORDER_PARSE_ATTEMPTS = 3;

@Injectable()
export class ActivateScreen {
  private readonly logger = new Logger(ActivateScreen.name);

  constructor(
    private readonly digiseller: DigisellerService,
    private readonly registrationKeys: RegistrationKeyService,
    private readonly licenses: LicensesService,
    private readonly state: BotStateService,
    private readonly rate: BotRateService,
    private readonly config: TelegramBotConfig,
  ) {}

  /** E-08. Выбор способа. */
  choose(locale: Locale): ScreenView {
    return {
      text: t(locale, 'screen.activate.choose'),
      keyboard: kb([
        [{ text: t(locale, 'btn.act_code'), cb: CB.actCode }],
        [{ text: t(locale, 'btn.act_order'), cb: CB.actOrder }],
        [{ text: t(locale, 'btn.act_regkey'), cb: CB.actRegKey }],
        [{ text: t(locale, 'btn.menu'), cb: CB.root }],
      ]),
    };
  }

  async askCode(ctx: ScreenCtx): Promise<ScreenView> {
    await this.state.set(ctx.chatId, 'awaiting_digiseller_code');
    return this.prompt(ctx.locale, 'screen.activate.ask_code');
  }

  async askOrder(ctx: ScreenCtx): Promise<ScreenView> {
    await this.state.set(ctx.chatId, 'awaiting_order_data', { attempts: '0' });
    return this.prompt(ctx.locale, 'screen.activate.ask_order');
  }

  async askRegKey(ctx: ScreenCtx): Promise<ScreenView> {
    await this.state.set(ctx.chatId, 'awaiting_registration_key');
    return this.prompt(ctx.locale, 'screen.activate.ask_regkey');
  }

  // =========================================================================
  //  ОБРАБОТКА ВВОДА
  // =========================================================================

  /** Код с площадки. Сообщение с ним маршрутизатор уже удалил. */
  async submitCode(ctx: ScreenCtx, input: string): Promise<ScreenView> {
    const { locale } = ctx;
    const code = input.trim().slice(0, MAX_INPUT_LENGTH);

    if (!(await this.allowAttempt(ctx))) return this.fail(locale, 'err.digiseller_rate');

    // Проверка ДО обращения к площадке: чужой лог — это чужой лог.
    if (looksLikeLicenseKey(code)) {
      await this.state.clear(ctx.chatId);
      return this.fail(locale, 'err.looks_like_license_key');
    }

    await this.state.clear(ctx.chatId);

    try {
      const result = await this.digiseller.redeem(ctx.actor.user.id, code, {
        // Ось лимита попыток. У бота IP один на всю аудиторию (это адрес
        // вебхука Telegram), поэтому счётчик по адресу делился бы на всех
        // сразу и активация ложилась бы после нескольких десятков покупок.
        // Поле добавляет пакет 5 (правка C2 в digiseller.service.ts).
        sourceKey: `telegram:${ctx.actor.link.telegramUserId}`,
      });

      if (result.status === 'ALREADY_YOURS') {
        return this.fail(locale, 'err.digiseller_used', [
          [{ text: t(locale, 'btn.licenses'), cb: CB.licenses }],
        ]);
      }

      // Полный ключ из ответа не используется НИГДЕ: ни в рендере, ни в логе.
      // Экран берёт лицензию заново и показывает маску.
      return this.success(ctx, result.licenseId);
    } catch (error) {
      return this.mapDigisellerError(locale, error);
    }
  }

  /** Номер заказа и почта, двумя строками. */
  async submitOrder(ctx: ScreenCtx, input: string, attempts: number): Promise<ScreenView> {
    const { locale } = ctx;
    const parsed = this.parseOrderInput(input);

    if (!parsed) {
      const next = attempts + 1;

      if (next >= MAX_ORDER_PARSE_ATTEMPTS) {
        await this.state.clear(ctx.chatId);
        return this.fail(locale, 'err.order_malformed', [
          [{ text: t(locale, 'btn.activate'), cb: CB.activate }],
          [{ text: t(locale, 'btn.menu'), cb: CB.root }],
        ]);
      }

      await this.state.set(ctx.chatId, 'awaiting_order_data', { attempts: String(next) });
      return this.fail(locale, 'err.order_malformed');
    }

    if (!(await this.allowAttempt(ctx))) return this.fail(locale, 'err.digiseller_rate');

    await this.state.clear(ctx.chatId);

    try {
      const result = await this.digiseller.redeemByOrder(
        ctx.actor.user.id,
        parsed.invoice,
        parsed.email,
        { sourceKey: `telegram:${ctx.actor.link.telegramUserId}` },
      );

      if (result.status === 'ALREADY_YOURS') {
        return this.fail(locale, 'err.digiseller_used', [
          [{ text: t(locale, 'btn.licenses'), cb: CB.licenses }],
        ]);
      }

      return this.success(ctx, result.licenseId);
    } catch (error) {
      return this.mapDigisellerError(locale, error);
    }
  }

  /**
   * Регистрационный ключ.
   *
   * Зовётся `redeemForUser`, а НЕ `register-with-key`: второй создаёт
   * аккаунт без почты и без пароля, и бот становится единственным способом
   * до него достучаться (решение A5 и 0.6). Регключ здесь принимается только
   * для УЖЕ привязанного аккаунта.
   */
  async submitRegistrationKey(ctx: ScreenCtx, input: string): Promise<ScreenView> {
    const { locale } = ctx;
    const code = input.trim().slice(0, MAX_INPUT_LENGTH);

    if (!(await this.allowAttempt(ctx))) return this.fail(locale, 'err.digiseller_rate');

    await this.state.clear(ctx.chatId);

    try {
      // Ответ содержит licenseKey. Он не присваивается переменной и не
      // попадает ни в лог, ни в рендер — экран перечитывает лицензию сам.
      await this.registrationKeys.redeemForUser(code, ctx.actor.user.id);
    } catch (error) {
      return this.mapRegistrationKeyError(locale, error);
    }

    return this.successLatest(ctx);
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Разбор «номер заказа + почта».
   *
   * Две непустые строки: первая — только цифры, вторая — с собакой.
   * Строже проверять здесь незачем: настоящая проверка живёт в
   * DigisellerService, а бот отсекает только то, что заведомо не доедет.
   */
  private parseOrderInput(input: string): { invoice: string; email: string } | null {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 2);

    const [first, second] = lines;
    if (!first || !second) return null;
    if (!/^\d{4,20}$/.test(first)) return null;
    if (!second.includes('@') || second.length > 254) return null;

    return { invoice: first, email: second };
  }

  /** Успех по известному идентификатору лицензии. */
  private async success(ctx: ScreenCtx, licenseId: string): Promise<ScreenView> {
    const license = await this.licenses.findById(licenseId, ctx.actor.user);
    return this.renderSuccess(ctx.locale, license);
  }

  /**
   * Успех, когда сервис вернул только ключ (регистрационные ключи).
   *
   * Лицензия ищется как самая свежая в списке пользователя: `list` сортирует
   * по createdAt убыванию, а создана она была секунду назад в этой же
   * операции. Искать по значению ключа нельзя — это ровно тот путь, из-за
   * которого поиск и запрещён боту (§4.1 п.3).
   */
  private async successLatest(ctx: ScreenCtx): Promise<ScreenView> {
    const latest = await this.licenses.list(ctx.actor.user, { take: 1 });
    const first = latest.items[0];

    if (!first) {
      this.logger.error(`регключ погашен, но лицензия не найдена у ${ctx.actor.user.id}`);
      return this.fail(ctx.locale, 'err.server', [
        [{ text: t(ctx.locale, 'btn.licenses'), cb: CB.licenses }],
      ]);
    }

    return this.renderSuccess(ctx.locale, first);
  }

  private renderSuccess(
    locale: Locale,
    license: Parameters<typeof toLicenseView>[0],
  ): ScreenView {
    const view = toLicenseView(license);

    return {
      text: t(locale, 'screen.activate.success', {
        productName: view.productName,
        planName: view.planName,
        expiresAt: validUntil(locale, view),
        maskedKey: view.maskedKey,
      }),
      keyboard: kb([
        [{ text: t(locale, 'btn.reveal_key'), cb: CB.key(view.id) }],
        [{ text: t(locale, 'btn.open_on_site'), url: `${this.config.appUrl}/licenses/${view.id}` }],
        [{ text: t(locale, 'btn.licenses'), cb: CB.licenses }],
      ]),
    };
  }

  private async allowAttempt(ctx: ScreenCtx): Promise<boolean> {
    return this.rate.hit(
      `tg:activate:${ctx.actor.user.id}`,
      ACTIVATE_LIMIT,
      ACTIVATE_WINDOW_SEC,
    );
  }

  /**
   * Отказ площадки → экран. «Не подошёл» и «уже активирован другим аккаунтом»
   * неотличимы: номера счетов последовательны, и разный ответ позволил бы
   * перебором найти чужие покупки. ALREADY_YOURS — про свой же аккаунт.
   */
  private mapDigisellerError(locale: Locale, error: unknown): ScreenView {
    const code = apiErrorCode(error);

    switch (code) {
      case 'CODE_MALFORMED':
      case 'CODE_NOT_ACCEPTED':
      case 'ORDER_MALFORMED':
      case 'ORDER_NOT_ACCEPTED':
      case 'ORDER_EMAIL_MISMATCH':
      case 'ORDER_NO_BUYER_EMAIL':
      case 'ORDER_EXPIRED':
      case 'ORDER_REFUNDED':
      case 'ORDER_PAYMENT_FAILED':
      case 'ORDER_AMOUNT_MISMATCH':
      case 'CODE_ALREADY_USED':
      case 'ORDER_ALREADY_USED':
        return this.fail(locale, 'err.digiseller_invalid', this.retryButtons(locale));

      case 'TOO_MANY_ATTEMPTS':
      case 'ORDER_ATTEMPTS_EXHAUSTED':
        return this.fail(locale, 'err.digiseller_rate');

      case 'PRODUCT_NOT_MAPPED':
      case 'ORDER_NOT_PAID':
      case 'ORDER_REFUND_PENDING':
      case 'ORDER_STATE_UNKNOWN':
        return this.fail(locale, 'err.digiseller_pending');

      default:
        this.logger.error(
          `активация не выполнена, код ${code ?? 'нет'}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return this.fail(locale, 'err.server', this.retryButtons(locale));
    }
  }

  private mapRegistrationKeyError(locale: Locale, error: unknown): ScreenView {
    const code = apiErrorCode(error);

    switch (code) {
      case 'KEY_ALREADY_USED':
        return this.fail(locale, 'err.regkey_used', this.retryButtons(locale));
      case 'KEY_INVALID':
      case 'KEY_EXPIRED':
        return this.fail(locale, 'err.regkey_invalid', this.retryButtons(locale));
      case 'KEY_WITHOUT_LICENSE':
        return this.fail(locale, 'err.regkey_no_license', this.retryButtons(locale));
      default:
        this.logger.error(
          `регключ не погашен, код ${code ?? 'нет'}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return this.fail(locale, 'err.server', this.retryButtons(locale));
    }
  }

  /**
   * Кнопки под отказом.
   *
   * Поддержка стоит здесь, а не в отдельной ветке «код уже активирован»:
   * набор кнопок — такой же различимый ответ, как текст, и разные наборы
   * восстановили бы ровно тот оракул, который снят выше.
   */
  private retryButtons(locale: Locale): KbButton[][] {
    return [
      [{ text: t(locale, 'btn.activate'), cb: CB.activate }],
      [{ text: t(locale, 'btn.support'), cb: CB.support }],
      [{ text: t(locale, 'btn.menu'), cb: CB.root }],
    ];
  }

  private prompt(locale: Locale, key: MessageKey): ScreenView {
    return {
      text: t(locale, key),
      keyboard: kb([[{ text: t(locale, 'btn.cancel'), cb: CB.activate }]]),
    };
  }

  private fail(locale: Locale, key: MessageKey, buttons?: KbButton[][]): ScreenView {
    return {
      text: t(locale, key),
      keyboard: kb(buttons ?? [[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
    };
  }
}
