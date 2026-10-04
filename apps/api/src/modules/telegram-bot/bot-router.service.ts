import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '@common/redis/redis.service';

import { BotActorService, type BotActor } from './bot-actor.service';
import { BotLinkService } from './bot-link.service';
import { BotRateService } from './bot-rate.service';
import { BotStateService } from './bot-state.service';
import { BotSupportService } from './bot-support.service';
import { kb } from './bot-keyboard';
import type { BotRouter } from './bot-router.interface';
import { TelegramApiService } from './telegram.api';
import { TelegramBotConfig } from './telegram-bot.config';
import { pickLocale, t, type Locale } from './i18n';
import type { TgCallbackQuery, TgChatMemberUpdated, TgMessage, TgUpdate, TgUser } from './dto/telegram-update.types';
import { AccountScreen } from './screens/account.screen';
import { ActivateScreen } from './screens/activate.screen';
import { AdminScreen } from './screens/admin.screen';
import { HelpScreen } from './screens/help.screen';
import { HwidScreen } from './screens/hwid.screen';
import { LicensesScreen } from './screens/licenses.screen';
import { ProductsScreen } from './screens/products.screen';
import { RootScreen } from './screens/root.screen';
import { SupportScreen } from './screens/support.screen';
import { CB, apiErrorCode, type ScreenCtx, type ScreenView } from './screens/screen.types';

/**
 * Единственная точка входа логики бота.
 *
 * Что здесь решается и почему именно здесь:
 *
 *   1. ГДЕ РИСУЕТСЯ ЭКРАН. Ответ на команду — новое сообщение, ответ на
 *      кнопку — правка того же сообщения (§4.1 ТЗ). Экраны об этом не знают
 *      вовсе: они возвращают текст и клавиатуру. Иначе выбор пришлось бы
 *      повторить в девяти файлах, и на девятом он оказался бы другим.
 *   2. КТО ПЕРЕД НАМИ. Непривязанному доступны ровно три вещи: приветствие,
 *      каталог и справка. Заблокированному — только /help и /support: иначе
 *      человек, которого заблокировали, лишается способа спросить, за что.
 *   3. УДАЛЕНИЕ СЕКРЕТОВ. Сообщение с `/start <token>`, кодом Digiseller,
 *      номером заказа и регключом удаляется ДО обработки и ДО любого
 *      логирования. Удалять после обработки поздно: между приёмом и
 *      удалением стоит запись в лог.
 *
 * Тексты обращений в поддержку НЕ удаляются: это собственный текст человека,
 * а не секрет, и удалять его — значит стирать его же переписку.
 */

/** Лимит входящих: 20 в минуту на чат (§7.5 ТЗ). Превышение обрабатывается МОЛЧАНИЕМ. */
const MESSAGE_LIMIT = 20;
const MESSAGE_WINDOW_SEC = 60;

/** Неудачные попытки привязки: 5 в час на чат. */
const LINK_FAIL_LIMIT = 5;
const LINK_FAIL_WINDOW_SEC = 3600;

/** Язык до привязки. Хранить в БД нечего: привязки ещё нет. */
const LOCALE_PREFIX = 'tg:locale:';
const LOCALE_TTL_SEC = 86_400;

/** Команды меню. Любая из них сбрасывает состояние диалога в idle (§5.0 ТЗ). */
const MENU_COMMANDS = new Set([
  'start',
  'licenses',
  'activate',
  'products',
  'account',
  'support',
  'help',
  'language',
  'unlink',
  'renew',
  'cancel',
  'admin',
]);

/** Команды, доступные без привязки. */
const UNLINKED_COMMANDS = new Set(['start', 'help', 'products']);

/** Команды, доступные заблокированному аккаунту. */
const BLOCKED_COMMANDS = new Set(['help', 'support']);

/**
 * Кнопки с необратимым действием: перед ними статус аккаунта проверяется
 * в базе мимо минутного кэша (assertNotBlocked).
 */
const IRREVERSIBLE_CALLBACKS = new Set(['hwid_go', 'key_go', 'unlink_go']);

/** Состояния свободного ввода, за которыми стоит необратимое действие. */
const IRREVERSIBLE_STATES = new Set([
  'awaiting_digiseller_code',
  'awaiting_order_data',
  'awaiting_registration_key',
]);

/** Идентификаторы в callback_data — только uuid. Всё остальное — мусор или подбор. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Метка подтверждения: восемь символов из алфавита BotStateService. */
const NONCE_RE = /^[A-Z2-9]{8}$/;

@Injectable()
export class BotRouterService implements BotRouter {
  private readonly logger = new Logger(BotRouterService.name);

  constructor(
    private readonly telegram: TelegramApiService,
    private readonly config: TelegramBotConfig,
    private readonly actors: BotActorService,
    private readonly links: BotLinkService,
    private readonly state: BotStateService,
    private readonly rate: BotRateService,
    private readonly support: BotSupportService,
    private readonly redis: RedisService,
    private readonly rootScreen: RootScreen,
    private readonly licensesScreen: LicensesScreen,
    private readonly hwidScreen: HwidScreen,
    private readonly activateScreen: ActivateScreen,
    private readonly accountScreen: AccountScreen,
    private readonly productsScreen: ProductsScreen,
    private readonly supportScreen: SupportScreen,
    private readonly helpScreen: HelpScreen,
    private readonly adminScreen: AdminScreen,
  ) {}

  async handleUpdate(update: TgUpdate): Promise<void> {
    if (update.my_chat_member) {
      await this.handleChatMember(update.my_chat_member);
      return;
    }

    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    if (update.message) {
      await this.handleMessage(update, update.message);
    }
  }

  /** Фоновая уборка сообщений с ключами. Подробности — в BotRouter. */
  async sweepExpiredKeyMessages(): Promise<void> {
    await this.licensesScreen.sweepAllKeyMessages();
  }

  // =========================================================================
  //  ЧЛЕНСТВО В ЧАТАХ
  // =========================================================================

  /**
   * Бота добавили в группу — выходим молча.
   *
   * Именно молча: прощальное сообщение в чужой группе это спам, а причина
   * ухода никого из участников не касается. Правило «только приватный чат»
   * из §7 ТЗ иначе обходится добавлением бота в группу, где `chat.id`
   * общий на всех и любой участник видит чужие лицензии.
   */
  private async handleChatMember(event: TgChatMemberUpdated): Promise<void> {
    if (event.chat.type !== 'private') {
      // Админ-чат — исключение: туда бот пишет алерты и треды поддержки.
      if (this.config.adminChatId !== null && event.chat.id === this.config.adminChatId) return;

      await this.telegram.leaveChat(event.chat.id);
      this.logger.warn(`покинут неприватный чат ${event.chat.id}`);
      return;
    }

    // Возвращение в приватный чат снимает флаг заблокированной доставки:
    // человек снова нажал Start, значит уведомления снова доходят.
    const actor = await this.actors.resolve(event.from.id);
    if (actor) await this.actors.touch(actor.link.id, event.chat.id, event.from.username);
  }

  // =========================================================================
  //  СООБЩЕНИЯ
  // =========================================================================

  private async handleMessage(update: TgUpdate, message: TgMessage): Promise<void> {
    const from = message.from;
    if (!from || from.is_bot) return;

    // Админ-чат: только доставка ответов поддержки, никаких команд (§3.9 ТЗ).
    if (this.config.adminChatId !== null && message.chat.id === this.config.adminChatId) {
      await this.support.relayAdminReply(update);
      return;
    }

    if (message.chat.type !== 'private') {
      await this.telegram.leaveChat(message.chat.id);
      return;
    }

    const chatId = message.chat.id;

    if (chatId !== from.id) {
      // Приватный чат, где идентификатор чата не совпадает с отправителем,
      // — состояние, которого Bot API не порождает. Отвечаем отказом,
      // а не догадками.
      await this.telegram.sendMessage(chatId, t(await this.localeFor(chatId, from, null), 'err.private_only'));
      return;
    }

    if (!(await this.rate.hit(`tg:msg:${chatId}`, MESSAGE_LIMIT, MESSAGE_WINDOW_SEC))) {
      // Молчание, а не «слишком часто»: ответ на флуд — это тоже ответ,
      // и он удваивает трафик, который мы пытаемся ограничить.
      return;
    }

    // Страховка на случай рестарта между показом ключа и его удалением.
    await this.licensesScreen.sweepKeyMessages(chatId).catch(() => undefined);

    const text = (message.text ?? '').trim();

    if (text.startsWith('/')) {
      await this.handleCommand(message, from, text);
      return;
    }

    await this.handleFreeText(message, from, text);
  }

  private async handleCommand(message: TgMessage, from: TgUser, text: string): Promise<void> {
    const chatId = message.chat.id;
    const [head = '', ...rest] = text.split(/\s+/);
    // `/start@pxcheats_bot` — так Telegram пишет команду в группах, и этот
    // же вид иногда приходит из приватного чата после пересылки.
    const command = head.slice(1).split('@')[0]?.toLowerCase() ?? '';
    const payload = rest.join(' ').trim();

    // `/start <token>` — единственная команда, которая обрабатывается
    // до определения актора: она этого актора и создаёт.
    if (command === 'start' && payload.length > 0) {
      await this.handleLinkToken(message, from, payload);
      return;
    }

    const actor = await this.actors.resolve(from.id);
    const locale = await this.localeFor(chatId, from, actor);

    if (MENU_COMMANDS.has(command)) await this.state.clear(chatId);

    if (!actor) {
      if (!UNLINKED_COMMANDS.has(command)) {
        await this.sendScreen(chatId, this.notLinked(locale));
        return;
      }

      switch (command) {
        case 'start':
          await this.sendScreen(chatId, this.rootScreen.welcome(locale));
          return;
        case 'products':
          await this.sendScreen(chatId, await this.productsScreen.list(locale));
          return;
        default:
          await this.sendScreen(chatId, this.helpScreen.help(locale, false));
          return;
      }
    }

    await this.actors.touch(actor.link.id, chatId, from.username);

    if (actor.blocked && !BLOCKED_COMMANDS.has(command)) {
      await this.sendScreen(chatId, {
        text: t(locale, 'err.account_blocked'),
        keyboard: kb([]),
      });
      return;
    }

    const ctx: ScreenCtx = { actor, locale, chatId };

    try {
      const view = await this.runCommand(ctx, command);
      if (view) await this.sendScreen(chatId, view);
    } catch (error) {
      await this.sendScreen(chatId, this.failure(locale, error, `команда /${command}`));
    }
  }

  private async runCommand(ctx: ScreenCtx, command: string): Promise<ScreenView | null> {
    const { locale } = ctx;

    switch (command) {
      case 'start':
        return this.rootScreen.root(ctx);
      case 'licenses':
        return this.licensesScreen.list(ctx);
      case 'activate':
        return this.activateScreen.choose(locale);
      case 'products':
        return this.productsScreen.list(locale);
      case 'account':
        return this.accountScreen.account(ctx);
      case 'support':
        return this.supportScreen.ask(ctx);
      case 'help':
        return this.helpScreen.help(locale, true);
      case 'language':
        return this.accountScreen.language(locale);
      case 'unlink':
        return this.accountScreen.unlinkConfirm(ctx);
      case 'renew':
        return this.rootScreen.renew(locale);
      case 'cancel':
        return { text: t(locale, 'msg.cancelled'), keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]) };
      case 'admin': {
        const view = await this.adminScreen.pending(ctx);
        // Прав нет — отвечаем как на незнакомую команду. Сообщать, что
        // команда существует, но недоступна, значит подсказывать цель.
        return view ?? { text: t(locale, 'err.unknown_command'), keyboard: kb([]) };
      }
      default:
        return { text: t(locale, 'err.unknown_command'), keyboard: kb([]) };
    }
  }

  /**
   * `/start <token>` — подтверждение привязки (§5.2 ТЗ).
   *
   * Сообщение с токеном удаляется ПЕРВЫМ действием. Токен одноразовый
   * и живёт десять минут, но в переписке он остаётся навсегда и виден
   * на всех устройствах, где открыт Telegram.
   */
  private async handleLinkToken(message: TgMessage, from: TgUser, token: string): Promise<void> {
    const chatId = message.chat.id;

    await this.telegram.deleteMessage(chatId, message.message_id);
    await this.state.clear(chatId);

    // Бюджет попыток списывается до гашения токена; успешная привязка его
    // обнуляет.
    const locale = await this.localeFor(chatId, from, null);
    const withinLimit = await this.rate.hit(
      `tg:linkfail:${chatId}`,
      LINK_FAIL_LIMIT,
      LINK_FAIL_WINDOW_SEC,
    );

    if (!withinLimit) {
      await this.sendScreen(chatId, this.linkFailure(locale, 'err.link_rate'));
      return;
    }

    const result = await this.links.confirm(token, from, message.chat);

    if (!result.ok) {
      // Один и тот же текст на «использован», «просрочен» и «не существует»:
      // различие превращает бота в оракул по существованию токенов.
      await this.sendScreen(chatId, this.linkFailure(locale, 'err.link_invalid'));
      return;
    }

    await this.rate.reset(`tg:linkfail:${chatId}`);

    const linkedLocale = pickLocale(result.link.locale);
    await this.sendScreen(
      chatId,
      this.rootScreen.linkSuccess(linkedLocale, result.username, result.expiresAt),
    );
  }

  /** Отказ привязки: один вид экрана на все причины. */
  private linkFailure(locale: Locale, key: 'err.link_invalid' | 'err.link_rate'): ScreenView {
    return {
      text: t(locale, key),
      keyboard: kb([
        [{ text: t(locale, 'btn.connect'), url: `${this.config.appUrl}/account/telegram` }],
      ]),
    };
  }

  /**
   * Свободный ввод. Смысл зависит от состояния диалога.
   *
   * Секреты (код площадки, номер заказа с почтой, регключ) удаляются до
   * обработки. Текст обращения в поддержку — нет: он не секрет, а
   * собственные слова человека.
   */
  private async handleFreeText(message: TgMessage, from: TgUser, text: string): Promise<void> {
    const chatId = message.chat.id;
    const actor = await this.actors.resolve(from.id);
    const locale = await this.localeFor(chatId, from, actor);

    if (!actor) {
      await this.sendScreen(chatId, this.notLinked(locale));
      return;
    }

    const ctx: ScreenCtx = { actor, locale, chatId };
    const state = await this.state.get(chatId);

    // Заблокированному оставлен ровно один вид свободного ввода — текст
    // обращения в поддержку. Иначе человек, которого заблокировали, видит
    // «аккаунт заблокирован» в ответ на попытку спросить, за что именно.
    if (actor.blocked && state.s !== 'awaiting_support_text') {
      await this.sendScreen(chatId, { text: t(locale, 'err.account_blocked'), keyboard: kb([]) });
      return;
    }

    try {
      // Ввод кода площадки, номера заказа и регключа необратим ровно так же,
      // как нажатие кнопки: активация связывает покупку с аккаунтом навсегда.
      if (IRREVERSIBLE_STATES.has(state.s)) {
        await this.actors.assertNotBlocked(actor.user.id);
      }

      switch (state.s) {
        case 'awaiting_digiseller_code':
          await this.telegram.deleteMessage(chatId, message.message_id);
          await this.sendScreen(chatId, await this.activateScreen.submitCode(ctx, text));
          return;

        case 'awaiting_order_data': {
          await this.telegram.deleteMessage(chatId, message.message_id);
          const attempts = Number(state.ctx?.attempts ?? '0');
          await this.sendScreen(
            chatId,
            await this.activateScreen.submitOrder(ctx, text, Number.isFinite(attempts) ? attempts : 0),
          );
          return;
        }

        case 'awaiting_registration_key':
          await this.telegram.deleteMessage(chatId, message.message_id);
          await this.sendScreen(chatId, await this.activateScreen.submitRegistrationKey(ctx, text));
          return;

        case 'awaiting_support_text':
          await this.sendScreen(chatId, await this.supportScreen.submit(ctx, text));
          return;

        default:
          // Ни состояния, ни команды — показываем меню. Отвечать «не понял»
          // на «привет» значит требовать от человека знания синтаксиса.
          await this.sendScreen(chatId, await this.rootScreen.root(ctx));
      }
    } catch (error) {
      await this.sendScreen(chatId, this.failure(locale, error, `ввод в состоянии ${state.s}`));
    }
  }

  // =========================================================================
  //  КНОПКИ
  // =========================================================================

  private async handleCallback(query: TgCallbackQuery): Promise<void> {
    const message = query.message;

    if (!message) {
      // Сообщение старше 48 часов Telegram в апдейте не присылает —
      // править нечего, остаётся только погасить часики.
      await this.telegram.answerCallbackQuery(query.id);
      return;
    }

    const chatId = message.chat.id;
    const from = query.from;

    if (message.chat.type !== 'private' || chatId !== from.id) {
      await this.telegram.answerCallbackQuery(query.id);
      return;
    }

    if (!(await this.rate.hit(`tg:msg:${chatId}`, MESSAGE_LIMIT, MESSAGE_WINDOW_SEC))) {
      // Часики гасим, экран не трогаем: иначе флуд по кнопке стоит нам
      // двух обращений к Bot API вместо одного.
      await this.telegram.answerCallbackQuery(query.id);
      return;
    }

    await this.licensesScreen.sweepKeyMessages(chatId).catch(() => undefined);

    const actor = await this.actors.resolve(from.id);
    const locale = await this.localeFor(chatId, from, actor);
    const data = query.data ?? '';

    let view: ScreenView | null = null;

    try {
      view = await this.dispatchCallback(chatId, from, actor, locale, data);
    } catch (error) {
      view = this.failure(locale, error, `кнопка ${this.callbackName(data)}`);
    }

    // Часики на кнопке гасим всегда, даже если экран не перерисовался.
    try {
      if (view) await this.editScreen(chatId, message.message_id, view);
    } finally {
      await this.telegram
        .answerCallbackQuery(
          query.id,
          view?.alert ? { text: view.alert, showAlert: true } : undefined,
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `часики на кнопке не погашены: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
  }

  /**
   * Разбор `callback_data` по строгому списку §4.4.
   *
   * Всё, что в список не входит, — «действие устарело». Это же ответ
   * на кнопку из истории чата, у которой изменился формат данных: гадать
   * о намерении по обрывку строки хуже, чем честно сказать «переоткройте».
   */
  private async dispatchCallback(
    chatId: bigint,
    from: TgUser,
    actor: BotActor | null,
    locale: Locale,
    data: string,
  ): Promise<ScreenView | null> {
    if (!data.startsWith('cb:')) return this.expired(locale);

    const parts = data.slice(3).split(':');
    const name = parts[0] ?? '';

    // Доступное без привязки — ровно каталог и справка (§5.1 ТЗ).
    if (!actor) {
      if (name === 'products') return this.productsScreen.list(locale, this.pageOf(parts[1]));
      if (name === 'prod') return this.productCard(locale, parts[1]);
      if (name === 'help') return this.helpScreen.help(locale, false);
      if (name === 'page' && parts[1] === 'products') {
        return this.productsScreen.list(locale, this.pageOf(parts[2]));
      }
      return this.notLinked(locale);
    }

    await this.actors.touch(actor.link.id, chatId, from.username);

    if (actor.blocked) {
      return { text: t(locale, 'err.account_blocked'), keyboard: kb([]) };
    }

    const ctx: ScreenCtx = { actor, locale, chatId };

    // Статус читается мимо кэша ровно перед необратимым. Исключение
    // ACCOUNT_BLOCKED ловит общий try/catch вызывающего и превращает
    // в экран «аккаунт заблокирован» (см. failure).
    if (IRREVERSIBLE_CALLBACKS.has(name)) {
      await this.actors.assertNotBlocked(actor.user.id);
    }

    switch (name) {
      case 'root':
        await this.state.clear(chatId);
        return this.rootScreen.root(ctx);

      case 'licenses':
        return this.licensesScreen.list(ctx);

      case 'lic':
        return this.withId(locale, parts[1], (id) => this.licensesScreen.card(ctx, id));

      case 'hwid':
        return this.withId(locale, parts[1], (id) => this.hwidScreen.confirm(ctx, id));

      case 'hwid_go':
        return this.withIdAndNonce(locale, parts[1], parts[2], (id, nonce) =>
          this.hwidScreen.reset(ctx, id, nonce),
        );

      case 'key':
        return this.withId(locale, parts[1], (id) => this.licensesScreen.keyConfirm(ctx, id));

      case 'key_go':
        return this.withIdAndNonce(locale, parts[1], parts[2], (id, nonce) =>
          this.licensesScreen.keyReveal(ctx, id, nonce),
        );

      case 'activate':
        await this.state.clear(chatId);
        return this.activateScreen.choose(locale);

      case 'act_code':
        return this.activateScreen.askCode(ctx);

      case 'act_order':
        return this.activateScreen.askOrder(ctx);

      case 'act_regkey':
        return this.activateScreen.askRegKey(ctx);

      case 'products':
        return this.productsScreen.list(locale, this.pageOf(parts[1]));

      case 'prod':
        return this.productCard(locale, parts[1]);

      case 'account':
        await this.state.clear(chatId);
        return this.accountScreen.account(ctx);

      case 'notify':
        return this.accountScreen.notify(ctx);

      case 'notify_toggle':
        return parts[1] ? this.accountScreen.toggle(ctx, parts[1]) : this.expired(locale);

      case 'lang':
        return this.accountScreen.language(locale);

      case 'lang_set':
        return parts[1] === 'ru' || parts[1] === 'en'
          ? this.accountScreen.setLanguage(ctx, parts[1])
          : this.expired(locale);

      case 'unlink':
        return this.accountScreen.unlinkConfirm(ctx);

      case 'unlink_go':
        return parts[1] && NONCE_RE.test(parts[1])
          ? this.accountScreen.unlink(ctx, parts[1])
          : this.expired(locale);

      case 'support':
        return this.supportScreen.ask(ctx);

      case 'help':
        return this.helpScreen.help(locale, true);

      case 'page':
        if (parts[1] === 'licenses') return this.licensesScreen.list(ctx, this.pageOf(parts[2]));
        if (parts[1] === 'products') return this.productsScreen.list(locale, this.pageOf(parts[2]));
        return this.expired(locale);

      default:
        return this.expired(locale);
    }
  }

  // =========================================================================
  //  ДОСТАВКА И ОБЩЕЕ
  // =========================================================================

  private async sendScreen(chatId: bigint, view: ScreenView): Promise<void> {
    await this.telegram.sendMessage(chatId, view.text, {
      keyboard: view.keyboard,
    });
  }

  private async editScreen(chatId: bigint, messageId: number, view: ScreenView): Promise<void> {
    await this.telegram.editMessageText(chatId, messageId, view.text, {
      keyboard: view.keyboard,
    });
  }

  /**
   * Локаль собеседника.
   *
   * Порядок источников: привязка (человек выбрал явно) → сохранённый выбор
   * до привязки → язык клиента Telegram. Последний — только догадка, поэтому
   * он и последний.
   */
  private async localeFor(chatId: bigint, from: TgUser, actor: BotActor | null): Promise<Locale> {
    if (actor) return pickLocale(actor.link.locale);

    try {
      const stored = await this.redis.client.get(`${LOCALE_PREFIX}${chatId}`);
      if (stored === 'ru' || stored === 'en') return stored;
    } catch {
      // Кэш недоступен — определяем по клиенту, это не ошибка.
    }

    const locale = pickLocale(from.language_code);

    try {
      await this.redis.client.set(`${LOCALE_PREFIX}${chatId}`, locale, 'EX', LOCALE_TTL_SEC);
    } catch {
      // Не сохранили — определим заново на следующем сообщении.
    }

    return locale;
  }

  private notLinked(locale: Locale): ScreenView {
    return {
      text: t(locale, 'err.not_linked'),
      keyboard: kb([
        [{ text: t(locale, 'btn.connect'), url: `${this.config.appUrl}/account/telegram` }],
        [{ text: t(locale, 'btn.catalogue'), cb: CB.products }],
        [{ text: t(locale, 'btn.help'), cb: CB.help }],
      ]),
    };
  }

  private expired(locale: Locale): ScreenView {
    return {
      text: t(locale, 'err.expired_action'),
      keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
    };
  }

  /**
   * Отказ сервиса → экран.
   *
   * NOT_FOUND означает, что кнопка ведёт в исчезнувшее — для пользователя
   * это «действие устарело». FORBIDDEN на своей же лицензии означает
   * рассинхрон на нашей стороне, и человек об этом узнавать не должен:
   * ему общий текст, нам строка в журнале.
   */
  private failure(locale: Locale, error: unknown, where: string): ScreenView {
    const code = apiErrorCode(error);

    // Блокировка, замеченная проверкой мимо кэша перед необратимым действием.
    // Экран тот же, что у проверки по кэшу выше, — человек не должен видеть
    // разницу между «узнали сразу» и «узнали в последний момент».
    if (code === 'ACCOUNT_BLOCKED') {
      return { text: t(locale, 'err.account_blocked'), keyboard: kb([]) };
    }

    // Один ответ на оба кода, чтобы чужую лицензию нельзя было отличить от
    // несуществующей; разница видна только в журнале.
    if (code === 'FORBIDDEN' || code === 'NOT_FOUND') {
      this.logger.warn(`${where}: отказ ${code} — кнопка ведёт в недоступное`);
      return this.expired(locale);
    }

    this.logger.warn(
      `${where}: код ${code ?? 'нет'}, ${error instanceof Error ? error.message : String(error)}`,
    );

    return {
      text: t(locale, 'err.server'),
      keyboard: kb([[{ text: t(locale, 'btn.menu'), cb: CB.root }]]),
    };
  }

  private async withId(
    locale: Locale,
    id: string | undefined,
    run: (id: string) => Promise<ScreenView | null>,
  ): Promise<ScreenView | null> {
    if (!id || !UUID_RE.test(id)) return this.expired(locale);
    return run(id);
  }

  private async withIdAndNonce(
    locale: Locale,
    id: string | undefined,
    nonce: string | undefined,
    run: (id: string, nonce: string) => Promise<ScreenView | null>,
  ): Promise<ScreenView | null> {
    if (!id || !UUID_RE.test(id)) return this.expired(locale);
    if (!nonce || !NONCE_RE.test(nonce)) return this.expired(locale);
    return run(id, nonce);
  }

  private async productCard(locale: Locale, id: string | undefined): Promise<ScreenView> {
    if (!id || !UUID_RE.test(id)) return this.expired(locale);
    return this.productsScreen.card(locale, id);
  }

  private pageOf(value: string | undefined): number {
    const page = Number(value ?? 0);
    return Number.isInteger(page) && page >= 0 && page < 1000 ? page : 0;
  }

  /** Имя действия без идентификаторов — для лога. Сам `callback_data` не логируем. */
  private callbackName(data: string): string {
    return data.startsWith('cb:') ? (data.slice(3).split(':')[0] ?? 'нет') : 'нет';
  }
}
