import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '@common/redis/redis.service';
import { HwidService } from '@modules/hwid/hwid.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import { BotRateService } from '../bot-rate.service';
import { BotStateService } from '../bot-state.service';
import {
  expiryLine,
  formatDate,
  formatDateTime,
  statusIcon,
  statusText,
  toLicenseView,
  validUntil,
} from '../bot-format';
import { kb, paginateLabeled, type KbButton } from '../bot-keyboard';
import { TelegramApiService } from '../telegram.api';
import { TelegramBotConfig } from '../telegram-bot.config';
import { raw, t, type Locale, type MessageKey } from '../i18n';
import { CB, apiErrorCode, type ScreenCtx, type ScreenView } from './screen.types';

/**
 * Лицензии: список (E-03), карточка (E-04) и раскрытие ключа (E-07).
 *
 * Показ ключа живёт здесь, а не в отдельном экране, потому что это действие
 * НАД карточкой: точка входа одна (кнопка на E-04), возврат туда же,
 * и лимит раскрытий имеет смысл только рядом с тем, что он ограничивает.
 *
 * Поиск по лицензиям отсутствует намеренно (§4.1 п.3 ТЗ): параметр `search`
 * у `LicensesService.list` для не-админа ищет по ПОДСТРОКЕ КЛЮЧА. Утечки
 * между аккаунтами нет — фильтр владельца сводится через AND, — но бот,
 * принимающий такой ввод, превращается в оракул по собственным ключам
 * («какие из моих ключей содержат FC26-1A2B») и начинает писать фрагменты
 * ключей в логи под видом поисковых запросов. Навигация — только кнопками.
 */

/** Лицензий на страницу. Больше пяти строк с ключами не читается с телефона. */
const PAGE_SIZE = 5;

/** Через сколько удаляется сообщение с полным ключом (§4.4 E-07 ТЗ). */
const KEY_MESSAGE_TTL_SEC = 90;

/** Лимит раскрытий ключа: 3 в час на чат (§7.5 ТЗ). */
const KEY_REVEAL_LIMIT = 3;
const KEY_REVEAL_WINDOW_SEC = 3600;

/**
 * Реестр неудалённых сообщений с ключами в Redis — переживает рестарт,
 * в отличие от setTimeout. Подметается при следующем апдейте из чата и
 * фоново (sweepAll). 48 часов — предел, после которого Bot API уже не даёт
 * удалить сообщение.
 */
const KEY_MESSAGES_PREFIX = 'tg:keymsg:';
const KEY_MESSAGES_TTL_SEC = 172_800;

/** Индекс чатов, где есть неудалённые сообщения с ключами. */
const KEY_MESSAGES_INDEX = 'tg:keymsg:chats';

/**
 * Сколько чатов подметается за один фоновый проход. Потолок нужен, чтобы
 * разбор очереди апдейтов не встал на уборке: чат, который не успели
 * подмести сейчас, останется в индексе и попадёт в следующий проход.
 */
const SWEEP_CHATS_PER_PASS = 50;

interface PendingKeyMessage {
  /** message_id сообщения с ключом. */
  m: number;
  /** Момент, начиная с которого сообщение подлежит удалению, epoch ms. */
  at: number;
}

@Injectable()
export class LicensesScreen {
  private readonly logger = new Logger(LicensesScreen.name);

  constructor(
    private readonly licenses: LicensesService,
    private readonly hwid: HwidService,
    private readonly state: BotStateService,
    private readonly rate: BotRateService,
    private readonly telegram: TelegramApiService,
    private readonly redis: RedisService,
    private readonly config: TelegramBotConfig,
  ) {}

  // =========================================================================
  //  E-03. СПИСОК
  // =========================================================================

  async list(ctx: ScreenCtx, page = 0): Promise<ScreenView> {
    const { locale } = ctx;
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    const result = await this.licenses.list(ctx.actor.user, {
      skip: safePage * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    if (result.total === 0) {
      return {
        text: t(locale, 'screen.licenses.empty'),
        keyboard: kb([
          [{ text: t(locale, 'btn.activate'), cb: CB.activate }],
          [{ text: t(locale, 'btn.menu'), cb: CB.root }],
        ]),
      };
    }

    const views = result.items.map((item) => toLicenseView(item));
    const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

    const body = views
      .map((view) =>
        t(locale, 'screen.licenses.item', {
          statusIcon: statusIcon(view.status),
          productName: view.productName,
          planName: view.planName,
          expiryLine: expiryLine(locale, view),
          maskedKey: view.maskedKey,
        }),
      )
      .join('\n\n');

    const rows: KbButton[][] = views.map((view) => [
      { text: `${statusIcon(view.status)} ${view.productName}`, cb: CB.license(view.id) },
    ]);

    const navigation = paginateLabeled(safePage, pages, 'licenses', {
      prev: t(locale, 'btn.prev'),
      next: t(locale, 'btn.next'),
    });
    if (navigation.length > 0) rows.push(navigation);
    rows.push([{ text: t(locale, 'btn.menu'), cb: CB.root }]);

    return {
      text: t(locale, 'screen.licenses.list', { items: raw(body) }),
      // Потолок поднят: пять кнопок здесь — это строки данных, а не действия,
      // и обрезка по шести отрезала бы выход с экрана вместе с пагинацией.
      keyboard: kb(rows, { max: PAGE_SIZE + 3 }),
    };
  }

  // =========================================================================
  //  E-04. КАРТОЧКА
  // =========================================================================

  async card(ctx: ScreenCtx, licenseId: string): Promise<ScreenView> {
    const { locale } = ctx;
    const license = await this.licenses.findById(licenseId, ctx.actor.user);
    const view = toLicenseView(license);
    const binding = await this.bindingStatus(licenseId, ctx.actor.user.id);

    const canReset =
      binding !== null &&
      binding.bound &&
      binding.resetsLeft > 0 &&
      binding.nextResetAvailableAt === null;

    const buttons: KbButton[][] = [];
    if (canReset) buttons.push([{ text: t(locale, 'btn.reset_hwid'), cb: CB.hwid(view.id) }]);
    // Полный ключ сервис отдаёт только владельцу — кнопка не обещает отказ.
    if (this.isOwnLicense(license, ctx)) {
      buttons.push([{ text: t(locale, 'btn.reveal_key'), cb: CB.key(view.id) }]);
    }
    buttons.push([{ text: t(locale, 'btn.back_to_list'), cb: CB.licenses }]);

    return {
      text: t(locale, 'screen.licenses.card', {
        statusIcon: statusIcon(view.status),
        productName: view.productName,
        planName: view.planName,
        statusText: statusText(locale, view.status),
        expiresAt: validUntil(locale, view),
        maskedKey: view.maskedKey,
        bindLine: this.bindLine(locale, binding),
        resetsUsed: binding ? binding.resetsUsed : t(locale, 'fmt.none'),
        maxResets: binding ? binding.maxResets : t(locale, 'fmt.none'),
        cooldownLine: this.cooldownLine(locale, binding),
      }),
      keyboard: kb(buttons),
    };
  }

  // =========================================================================
  //  E-07. КЛЮЧ
  // =========================================================================

  /**
   * Подтверждение показа ключа.
   *
   * Лимит здесь ПРОВЕРЯЕТСЯ, но не расходуется: списывать попытку за экран,
   * с которого человек ушёл по «Отмена», значит наказывать за осторожность.
   * Расход — в момент фактического раскрытия.
   */
  async keyConfirm(ctx: ScreenCtx, licenseId: string): Promise<ScreenView> {
    const { locale } = ctx;

    const used = await this.rate.peek(this.keyRevealKey(ctx.chatId));
    if (used >= KEY_REVEAL_LIMIT) {
      return this.error(locale, 'err.key_reveal_limit', [
        [{ text: t(locale, 'btn.open_on_site'), url: this.licenseUrl(licenseId) }],
        [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
      ]);
    }

    const license = await this.licenses.findById(licenseId, ctx.actor.user);

    // Кнопки на экране уже нет, но `callback_data` присылает клиент, а не мы:
    // произвольную строку `cb:key:<uuid>` умеет отправить любой нестандартный
    // клиент Telegram. Метка подтверждения выдаётся только владельцу.
    if (!this.isOwnLicense(license, ctx)) {
      return this.error(ctx.locale, 'err.expired_action', [
        [{ text: t(locale, 'btn.back_to_list'), cb: CB.licenses }],
      ]);
    }

    const view = toLicenseView(license);
    const nonce = await this.state.newNonce(ctx.chatId, 'awaiting_key_confirm', {
      licenseId: view.id,
    });

    return {
      text: t(locale, 'screen.key.confirm', { seconds: KEY_MESSAGE_TTL_SEC }),
      keyboard: kb([
        // Ссылка на сайт стоит ПЕРВОЙ по §5.6: это предпочтительный путь.
        // deleteMessage в чате — гигиена, а не защита: он не отменяет ни
        // уведомление на экране блокировки, ни скриншот, ни пересылку.
        [{ text: t(locale, 'btn.open_on_site'), url: this.licenseUrl(view.id) }],
        [{ text: t(locale, 'btn.show_here'), cb: CB.keyGo(view.id, nonce) }],
        [{ text: t(locale, 'btn.cancel'), cb: CB.license(view.id) }],
      ]),
    };
  }

  /**
   * Раскрытие ключа отдельным сообщением.
   *
   * Возвращает экран, который остаётся на месте карточки. Сам ключ уходит
   * НОВЫМ сообщением: его надо уметь удалить, не разрушив навигацию, а
   * править им экран меню значило бы оставить ключ в истории под кнопками.
   */
  async keyReveal(ctx: ScreenCtx, licenseId: string, nonce: string): Promise<ScreenView> {
    const { locale } = ctx;

    const consumed = await this.state.consumeNonce(ctx.chatId, 'awaiting_key_confirm', nonce);
    if (!consumed || consumed.licenseId !== licenseId) {
      return this.error(locale, 'err.expired_action', [
        [{ text: t(locale, 'btn.back_to_list'), cb: CB.licenses }],
      ]);
    }

    const allowed = await this.rate.hit(
      this.keyRevealKey(ctx.chatId),
      KEY_REVEAL_LIMIT,
      KEY_REVEAL_WINDOW_SEC,
    );
    if (!allowed) {
      return this.error(locale, 'err.key_reveal_limit', [
        [{ text: t(locale, 'btn.open_on_site'), url: this.licenseUrl(licenseId) }],
        [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
      ]);
    }

    // Блокировка на необратимое действие снята с пользователя, но не с нас:
    // повторное нажатие уже погашено меткой выше, поэтому здесь достаточно
    // одного вызова. Аудит факта раскрытия пишет сам revealKey — значение
    // ключа в журнал не попадает.
    const { key } = await this.licenses.revealKey(licenseId, ctx.actor.user, 'telegram');

    const sent = await this.telegram.sendMessage(
      ctx.chatId,
      t(locale, 'screen.key.reveal', { key, seconds: KEY_MESSAGE_TTL_SEC }),
      { disableNotification: true },
    );

    await this.scheduleKeyMessageDeletion(ctx.chatId, sent.messageId);

    // Логируем ТОЛЬКО идентификаторы. Ключ в строку лога не интерполируется
    // никогда: redact в pino работает по путям структурированных полей и
    // текст сообщения не смотрит.
    this.logger.log(`ключ лицензии ${licenseId} раскрыт в чате пользователем ${ctx.actor.user.id}`);

    return this.card(ctx, licenseId);
  }

  /**
   * Подмести сообщения с ключами, которым вышел срок.
   *
   * Зовётся маршрутизатором на каждом апдейте чата. Это страховка на случай
   * рестарта процесса между показом ключа и срабатыванием таймера.
   */
  async sweepKeyMessages(chatId: bigint, pruneIndex = false): Promise<void> {
    const pending = await this.readKeyMessages(chatId);
    if (pending.length === 0) {
      // Чистка индекса — только в фоновом проходе (pruneIndex = true).
      // На пути апдейта её нет намеренно: у подавляющего большинства чатов
      // список пуст всегда, и безусловный SREM означал бы лишнюю команду
      // в Redis на КАЖДОЕ входящее сообщение бота ради работы, которую
      // фоновый проход делает раз в минуту и по делу.
      if (pruneIndex) await this.dropFromIndex(chatId);
      return;
    }

    const now = Date.now();
    const remaining: PendingKeyMessage[] = [];

    for (const entry of pending) {
      if (entry.at > now) {
        remaining.push(entry);
        continue;
      }
      await this.telegram.deleteMessage(chatId, entry.m);
    }

    await this.writeKeyMessages(chatId, remaining);
  }

  /**
   * Фоновое подметание по всем чатам сразу.
   *
   * Зовётся обработчиком очереди апдейтов по расписанию, а не приходом
   * сообщения. Без него удаление сообщения с ключом зависело бы от того,
   * вернётся ли человек в бота, — а он мог раскрыть ключ и закрыть Telegram
   * навсегда.
   *
   * Никогда не бросает: уборка не должна ронять разбор очереди.
   */
  async sweepAllKeyMessages(): Promise<void> {
    let chats: string[];
    try {
      chats = await this.redis.client.srandmember(KEY_MESSAGES_INDEX, SWEEP_CHATS_PER_PASS);
    } catch (error) {
      this.logger.warn(
        `индекс сообщений с ключами недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    for (const raw of chats) {
      let chatId: bigint;
      try {
        chatId = BigInt(raw);
      } catch {
        // Мусор в индексе не должен останавливать уборку остальных чатов.
        await this.redis.client.srem(KEY_MESSAGES_INDEX, raw).catch(() => undefined);
        continue;
      }

      await this.sweepKeyMessages(chatId, true).catch((error: unknown) => {
        this.logger.warn(
          `подметание чата не выполнено: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Состояние привязки или `null`, если его не отдают.
   *
   * `HwidService.statusFor` бросает FORBIDDEN на чужую лицензию и
   * LICENSE_REVOKED на отозванную. Оба случая для карточки не ошибка:
   * карточка рисуется, блок привязки заменяется прочерками.
   */
  private async bindingStatus(licenseId: string, userId: string) {
    try {
      return await this.hwid.statusFor(licenseId, userId);
    } catch (error) {
      const code = apiErrorCode(error);
      if (code === 'FORBIDDEN' || code === 'LICENSE_REVOKED' || code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  private bindLine(
    locale: Locale,
    binding: { bound: boolean; boundAt: Date | null } | null,
  ): string {
    if (!binding) return t(locale, 'fmt.none');
    return binding.bound
      ? t(locale, 'fmt.bind.bound', { boundAt: formatDate(locale, binding.boundAt) })
      : t(locale, 'fmt.bind.not_bound');
  }

  private cooldownLine(
    locale: Locale,
    binding: { resetsLeft: number; nextResetAvailableAt: Date | null } | null,
  ): string {
    if (!binding) return '';
    if (binding.resetsLeft <= 0) return t(locale, 'fmt.cooldown.exhausted');
    if (binding.nextResetAvailableAt) {
      return t(locale, 'fmt.cooldown.next', {
        date: formatDateTime(locale, binding.nextResetAvailableAt),
      });
    }
    return '';
  }

  /** Экран с одной строкой ошибки и кнопками возврата. */
  private error(locale: Locale, key: MessageKey, buttons: KbButton[][]): ScreenView {
    return { text: t(locale, key), keyboard: kb(buttons) };
  }

  /**
   * Владелец ли собеседник этой лицензии.
   *
   * Сравнение по `userId`, а не по факту «сервис отдал карточку»: карточку
   * отдают и обладателю licenses.read.any.
   * Для показа полного ключа нужен именно владелец — остальным сервис
   * ответит FORBIDDEN, и предлагать им кнопку незачем.
   */
  private isOwnLicense(license: { userId: string | null }, ctx: ScreenCtx): boolean {
    return license.userId === ctx.actor.user.id;
  }

  private licenseUrl(licenseId: string): string {
    // Одноразовая ссылка на ключ (§8-С3) — отдельная задача сервера.
    // До неё ведём в кабинет: страница требует входа, то есть ссылка,
    // утёкшая из переписки, сама по себе ключа не открывает.
    return `${this.config.appUrl}/licenses/${licenseId}`;
  }

  private keyRevealKey(chatId: bigint): string {
    return `tg:keyreveal:${chatId}`;
  }

  private async scheduleKeyMessageDeletion(chatId: bigint, messageId: number): Promise<void> {
    const deleteAt = Date.now() + KEY_MESSAGE_TTL_SEC * 1000;

    const pending = await this.readKeyMessages(chatId);
    pending.push({ m: messageId, at: deleteAt });
    await this.writeKeyMessages(chatId, pending);

    // unref: таймер не должен удерживать процесс при остановке. Если
    // выключение случится раньше срабатывания, сообщение подметёт
    // sweepKeyMessages на следующем апдейте из этого чата.
    setTimeout(() => {
      void this.deleteKeyMessage(chatId, messageId);
    }, KEY_MESSAGE_TTL_SEC * 1000).unref();
  }

  private async deleteKeyMessage(chatId: bigint, messageId: number): Promise<void> {
    try {
      await this.telegram.deleteMessage(chatId, messageId);
      const pending = await this.readKeyMessages(chatId);
      await this.writeKeyMessages(
        chatId,
        pending.filter((entry) => entry.m !== messageId),
      );
    } catch (error) {
      this.logger.warn(
        `сообщение с ключом не удалено: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async readKeyMessages(chatId: bigint): Promise<PendingKeyMessage[]> {
    try {
      const stored = await this.redis.client.get(`${KEY_MESSAGES_PREFIX}${chatId}`);
      if (!stored) return [];

      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (entry): entry is PendingKeyMessage =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as PendingKeyMessage).m === 'number' &&
          typeof (entry as PendingKeyMessage).at === 'number',
      );
    } catch {
      return [];
    }
  }

  private async writeKeyMessages(chatId: bigint, entries: PendingKeyMessage[]): Promise<void> {
    const key = `${KEY_MESSAGES_PREFIX}${chatId}`;
    try {
      if (entries.length === 0) {
        await this.redis.client.del(key);
        await this.redis.client.srem(KEY_MESSAGES_INDEX, String(chatId));
        return;
      }
      await this.redis.client.set(key, JSON.stringify(entries), 'EX', KEY_MESSAGES_TTL_SEC);
      // Индекс без TTL намеренно: он должен пережить любой срок жизни
      // отдельного списка, иначе фоновая уборка потеряет ровно тот чат,
      // до которого не дошла вовремя. Записи из него убирает подметание.
      await this.redis.client.sadd(KEY_MESSAGES_INDEX, String(chatId));
    } catch (error) {
      this.logger.warn(
        `реестр сообщений с ключами недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async dropFromIndex(chatId: bigint): Promise<void> {
    await this.redis.client.srem(KEY_MESSAGES_INDEX, String(chatId)).catch(() => undefined);
  }
}
