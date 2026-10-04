/**
 * Английский словарь бота — ИСТОЧНИК ИСТИНЫ.
 *
 * Русский словарь (`ru.ts`) типизирован как `Record<MessageKey, string>`, где
 * `MessageKey = keyof typeof en`. Это не украшение: расхождение наборов ключей
 * ловится компилятором, а не пользователем, которому вместо текста прилетел
 * голый идентификатор ключа. Забытый перевод — ошибка сборки, лишний —
 * тоже (литерал объекта с чужим полем не присваивается точному Record).
 *
 * Значения — HTML для Telegram (`parse_mode: HTML`, поддерживаются
 * b/i/u/s/a/code/pre/tg-spoiler). Плейсхолдеры — `{{name}}`; ВСЕ подставляемые
 * значения экранируются в `t()`, кроме явно помеченных `raw()`. Правило
 * односторонее намеренно: забыть экранировать чужой @username проще, чем
 * вспомнить про raw() для собственноручно собранного куска разметки.
 *
 * Тексты взяты из §4.4 и §4.5 ТЗ дословно там, где ТЗ их задаёт.
 */
export const en = {
  // =========================================================================
  //  ЭКРАНЫ
  // =========================================================================

  /** E-00. Первый контакт без привязки. */
  'screen.welcome_unlinked':
    '👋 This is <b>PX</b> — the pxcheats.com bot.\n\n' +
    'Here you can: view your licenses, reset your device binding, activate a Digiseller ' +
    'purchase and get expiry reminders.\n\n' +
    'To begin, connect the bot to your account on the website — it takes half a minute. ' +
    "Connecting is only possible from the website: that way nobody can attach your account " +
    "to someone else's chat.",

  /** E-01. Успешная привязка. */
  'screen.link_success':
    '✅ Done. The bot is connected to account <b>{{username}}</b>.\n\n' +
    "We've emailed you — if it wasn't you who connected it, disconnect the bot with /unlink " +
    'and change your password on the website.\n\n' +
    "The connection is valid until {{expiresAt}}. I'll remind you here closer to that date.",

  /** E-02. Главное меню. */
  'screen.root': '<b>PX</b> · {{username}}\n\nLicenses: {{activeCount}} active of {{totalCount}}.{{expirySuffix}}',

  /** E-03. Список лицензий. */
  'screen.licenses.list': '<b>My licenses</b>\n\n{{items}}',
  /** Строка одной лицензии в списке. Собирается отдельно и вставляется как raw. */
  'screen.licenses.item':
    '{{statusIcon}} <b>{{productName}}</b> · {{planName}}\n   {{expiryLine}} · <code>{{maskedKey}}</code>',
  'screen.licenses.empty':
    "<b>My licenses</b>\n\nYou don't have any licenses yet.\n\n" +
    'If you bought on Digiseller — tap "Activate a purchase" and enter the code from the marketplace.',

  /** E-04. Карточка лицензии. */
  'screen.licenses.card':
    '{{statusIcon}} <b>{{productName}}</b>\n' +
    'Plan: {{planName}}\n' +
    'Status: {{statusText}}\n' +
    'Valid until: {{expiresAt}}\n' +
    'Key: <code>{{maskedKey}}</code>\n\n' +
    '<b>Device binding</b>\n' +
    '{{bindLine}}\n' +
    'Resets used: {{resetsUsed}} of {{maxResets}}\n' +
    '{{cooldownLine}}',

  /** E-05. Подтверждение сброса привязки. */
  'screen.hwid.confirm':
    '⚠️ <b>Reset device binding</b>\n\n' +
    'License: {{productName}} · <code>{{maskedKey}}</code>\n\n' +
    'After the reset the license will detach from the current computer and attach to the next ' +
    'one you launch the loader on.\n\n' +
    'This is <b>irreversible</b>. You have used {{resetsUsed}} of {{maxResets}} resets. ' +
    'After this <b>{{resetsAfter}}</b> will remain. Resets are never restored.\n\n' +
    'The next reset will not be available for another {{cooldownText}}.',

  /** E-06. Результат сброса. */
  'screen.hwid.done':
    '✅ Binding reset.\n\n' +
    'Launch the loader on the computer you need — the license will bind to it.\n\n' +
    'Resets left: <b>{{resetsLeft}}</b>. The next one will be available {{nextResetAvailableAt}}.\n\n' +
    "We've also sent you an email.",

  /** E-07. Подтверждение показа ключа. */
  'screen.key.confirm':
    '🔑 Reveal the full license key?\n\n' +
    'The key is the only thing the loader uses to prove your right to run the product. ' +
    'Anyone who gets the key can run it.\n\n' +
    'The message with the key will be visible on every device where your Telegram is open, ' +
    "and Telegram will keep it until deletion. I'll delete it after {{seconds}} seconds, " +
    'but that does not undo lock-screen notifications or screenshots.\n\n' +
    'Opening the key on the website is safer.',
  /**
   * E-07. Сам ключ — отдельным сообщением, в котором нет ничего, кроме ключа
   * и строки таймера. Единственный шаблон во всём словаре, куда полное
   * значение ключа попадает по замыслу; проверяется тестом bot-i18n.spec.ts.
   */
  'screen.key.reveal': '<code>{{key}}</code>\n\n⏳ I will delete this in {{seconds}} sec.',

  /** E-08. Активация покупки. */
  'screen.activate.choose': '🎟 <b>Activate a purchase</b>\n\nChoose what you have at hand.',
  'screen.activate.ask_code':
    'Send the code you received on Digiseller after payment, in one message.\n\n' +
    "I'll delete your message right after processing — the code is single-use, but there's no " +
    'reason to leave it in the chat.',
  'screen.activate.ask_order':
    'Send the Digiseller order number and the email used at purchase, on two lines:\n\n' +
    '<code>123456789</code>\n<code>mail@example.com</code>\n\n' +
    "I'll delete your message right after processing.",
  'screen.activate.ask_regkey':
    'Send the registration key in one message.\n\n' +
    "I'll delete your message right after processing — the key is single-use, but there's no " +
    'reason to leave it in the chat.',
  'screen.activate.success':
    '✅ License issued.\n\n' +
    'Product: <b>{{productName}}</b> · {{planName}}\n' +
    'Valid until: {{expiresAt}}\n' +
    'Key: <code>{{maskedKey}}</code>\n\n' +
    'The full key has also been emailed to you. Download the loader from the website and run it — ' +
    'the license will bind to this computer.',

  /** E-09. Аккаунт. */
  'screen.account':
    '⚙️ <b>Account</b>\n\n' +
    'User: <b>{{username}}</b>\n' +
    'Email: {{emailMasked}}\n' +
    'Two-factor: {{twoFactorText}}\n' +
    'Language: {{localeName}}\n' +
    'Bot connected: {{linkedAt}}, valid until {{expiresAt}}',

  /** E-10. Настройки уведомлений. */
  'screen.notify':
    '🔔 <b>Notifications</b>\n\n' +
    'Checked categories are delivered to this chat. Emails are always sent regardless of these settings.',

  /** E-11. Каталог. */
  'screen.products.list': '🛒 <b>Catalogue</b>\n\nChoose a product.',
  'screen.products.card': '<b>{{name}}</b>\n\n{{description}}\n\n<b>Plans</b>\n{{plans}}',
  'screen.products.plan': '• {{planName}} — {{durationText}} — {{price}} {{currency}}',
  'screen.products.empty': '🛒 <b>Catalogue</b>\n\nThe catalogue is empty right now.',

  /** E-12. Поддержка. */
  'screen.support.ask':
    '💬 Describe your problem in one message.\n\n' +
    'Your login, license list and binding state will be attached automatically. ' +
    'Do not send passwords, codes or keys: the message goes to support word for word ' +
    'and stays in the chat forever.',
  'screen.support.sent': '✅ Ticket #{{ticketNo}} sent. The reply will arrive here.',

  /** E-13. Справка. */
  'screen.help':
    '<b>What the bot can do</b>\n\n' +
    '/licenses — your licenses, expiry, binding state\n' +
    '/activate — activate a Digiseller purchase or a key\n' +
    '/products — catalogue and prices\n' +
    // /renew в меню setMyCommands не выводится (там только семь ежедневных
    // команд), а до этой строки на него не вело вообще ничего — экран
    // существовал и был недостижим. Справка и есть место для такого.
    '/renew — how renewal works\n' +
    '/account — settings, language, disconnecting the bot\n' +
    '/support — contact support\n\n' +
    '<b>What the bot will never do</b>\n' +
    'It does not accept passwords or two-factor codes. It does not set up 2FA. It does not ' +
    'restore access to an account. All of that lives on the website only — because in a Telegram ' +
    'chat such data stays forever and on every device of yours.',

  /** Экран честного «продления» (§5.9). */
  'screen.renew':
    'Renewal currently works as a new purchase.\n\n' +
    'If you buy again on Digiseller and activate the code, you will receive a <b>second license</b> ' +
    'with a new key and a fresh reset counter. The current license’s expiry date will not change.\n\n' +
    'We know this is inconvenient and plan to implement real renewal.',

  /** Отвязка из чата (§5.11). */
  'screen.unlink.confirm':
    'Disconnect the bot from account <b>{{username}}</b>?\n\n' +
    'Notifications will stop arriving. Website login via Telegram, if you have it set up, ' +
    'will keep working — these are different things.\n\n' +
    'You can connect it back from your account on the website.',
  'screen.unlink.done': 'The bot is disconnected.',

  /** Выбор языка (§5.10). */
  'screen.language': '🌐 Choose your language.',

  /** /admin — зависшие сделки площадки. */
  'screen.admin.pending':
    '🛠 <b>Stuck Digiseller deals</b>\n\n' +
    'Confirmed by the marketplace but not delivered: the item is not mapped to a plan.\n\n' +
    '{{items}}\n\n' +
    'Issuing is done on the website: the operation is irreversible and needs the full order card.',
  'screen.admin.item': '• #{{invId}} · {{amount}} {{currency}} · item {{productId}} · {{createdAt}}',
  'screen.admin.empty': '🛠 <b>Stuck Digiseller deals</b>\n\nNothing is stuck. Everything has been delivered.',

  // =========================================================================
  //  ОПИСАНИЯ КОМАНД МЕНЮ (§4.3, setMyCommands)
  //
  //  Живут в словаре, а не в скрипте деплоя: иначе меню бота и справка
  //  внутри бота начинают описывать команды разными словами, а меняет их
  //  разный человек.
  // =========================================================================

  'cmd.start': 'Start / link account',
  'cmd.licenses': 'My licenses',
  'cmd.activate': 'Activate a purchase',
  'cmd.products': 'Catalogue and prices',
  'cmd.account': 'Account and settings',
  'cmd.support': 'Contact support',
  'cmd.help': 'Help',

  // =========================================================================
  //  КНОПКИ
  // =========================================================================

  'btn.connect': '🔗 Connect account',
  'btn.catalogue': '🛒 Catalogue and prices',
  'btn.help': '❓ Help',
  'btn.licenses': '📋 My licenses',
  'btn.account': '⚙️ Account',
  'btn.activate': '🎟 Activate a purchase',
  'btn.support': '💬 Support',
  'btn.menu': '⬅️ Menu',
  'btn.back_to_list': '⬅️ Back to list',
  'btn.back_to_license': '⬅️ Back to license',
  'btn.back_to_account': '⬅️ Account',
  'btn.back_to_catalogue': '⬅️ Catalogue',
  'btn.reset_hwid': '🔓 Reset binding',
  'btn.reset_hwid_confirm': '✅ Yes, reset',
  'btn.reveal_key': '🔑 Reveal key',
  'btn.open_on_site': '🌐 Open on the website',
  'btn.show_here': '👁 Show here',
  'btn.cancel': '❌ Cancel',
  'btn.act_code': '🔢 Digiseller code',
  'btn.act_order': '🧾 Order number and email',
  'btn.act_regkey': '🗝 Registration key',
  'btn.notify': '🔔 Notifications',
  'btn.language': '🌐 Language',
  'btn.open_cabinet': '🌐 Open the website',
  'btn.unlink': '🚫 Disconnect bot',
  'btn.unlink_confirm': '✅ Yes, disconnect',
  'btn.buy': '🛒 Buy on Digiseller',
  'btn.download': '⬇️ Download the loader',
  'btn.prev': '‹ Back',
  'btn.next': 'Next ›',
  'btn.lang_ru': '🇷🇺 Русский',
  'btn.lang_en': '🇬🇧 English',
  'btn.notify.license': 'Licenses',
  'btn.notify.expiry': 'Expiry',
  'btn.notify.security': 'Security',
  'btn.notify.device': 'Device binding',

  // =========================================================================
  //  ОШИБКИ И СЛУЖЕБНЫЕ СООБЩЕНИЯ (§4.5)
  // =========================================================================

  'err.not_linked': 'The bot is not connected to an account. Tap /start.',
  'err.link_invalid':
    "This link didn't work: it is already used, expired or invalid. Open your account on the " +
    'website and get a new one.',
  'err.link_rate': 'Too many connection attempts. Try again in an hour.',
  'err.account_blocked': 'The account is blocked. Contact support — /support.',
  'err.expired_action': 'This action has expired. Open the license again.',
  'err.hwid_cooldown':
    'You can reset the binding once every {{cooldownText}}. The next reset is available {{date}}.',
  'err.hwid_limit': 'No resets left: {{max}} of {{max}} used. Only support can restore them — /support.',
  'err.not_bound': 'The license is not bound to anything — there is nothing to reset.',
  /**
   * Один текст на все отказы площадки, включая «уже активирован другим
   * аккаунтом». Различать их нельзя: см. mapDigisellerError в activate.screen.
   */
  'err.digiseller_invalid':
    "The code didn't work. Check that you copied it in full and that it is a Digiseller code, " +
    'not a license key. If you are sure the code is correct — contact support.',
  /**
   * Только состояние ALREADY_YOURS — «эта покупка уже активирована ВАМИ».
   * Про чужие аккаунты этот текст больше ничего не говорит: см. en 'err.digiseller_invalid'.
   */
  'err.digiseller_used':
    'This purchase is already activated on your account. The license is in "My licenses"; ' +
    'if you cannot find it — /support.',
  'err.digiseller_rate': 'Too many activation attempts. Try again in an hour.',
  'err.digiseller_pending':
    "The order was found but the marketplace hasn't confirmed it yet. I'll let you know as soon " +
    'as the license is issued.',
  'err.key_reveal_limit':
    'The key can be revealed at most three times per hour. Open it on the website.',
  'err.password_required':
    'To receive a license you need to set a password in your account on the website.',
  'err.server':
    "Something went wrong on our side. Try again in a minute, and if that doesn't help — /support.",
  'err.private_only': 'I only work in private chats.',
  /** §5.4, шаг 3: ключ лицензии не уезжает в чужой сервис как «неудачная попытка». */
  'err.looks_like_license_key':
    'This looks like a license key, not a Digiseller code. A license key does not need activating — ' +
    'it is already yours.',
  /**
   * Регистрационный ключ — третий способ активации (§5.7), своих строк
   * в §4.5 не получивший. Тексты отдельные, потому что «код с Digiseller»
   * в сообщении про регключ сбивает с толку сильнее, чем помогает.
   */
  'err.regkey_invalid': 'The key did not work. Check that you copied it in full.',
  'err.regkey_used': 'This key has already been used.',
  'err.regkey_no_license':
    'This key is only good for registering a new account — it does not carry a license.',
  'err.order_malformed':
    'I could not read that. Send exactly two lines: the order number (digits) and the email used ' +
    'at purchase.',
  'err.support_rate': 'You have already sent three tickets this hour. Please wait for a reply.',
  'err.unknown_command': "I don't know that command. /help lists what I can do.",

  'msg.cancelled': 'Cancelled.',
  'msg.security_always_on':
    'Security notifications cannot be turned off — they are the only way to learn about ' +
    "someone else's access to your account.",
  'msg.support_reply': '💬 Support reply:',

  // =========================================================================
  //  ФРАГМЕНТЫ ФОРМАТИРОВАНИЯ
  //
  //  Живут в словаре, а не в bot-format.ts, ровно по той же причине, что и
  //  всё остальное: иначе половина переводов оказывается вне проверки
  //  «наборы ключей ru и en совпадают», и первое же расхождение всплывает
  //  у пользователя.
  // =========================================================================

  'fmt.status.ACTIVE': 'active',
  'fmt.status.PENDING': 'not activated',
  'fmt.status.EXPIRED': 'expired',
  'fmt.status.BLOCKED': 'blocked',
  'fmt.status.REVOKED': 'revoked',

  'fmt.expiry.until': 'until {{date}}',
  'fmt.expiry.lifetime': 'lifetime',
  'fmt.expiry.not_activated': 'not activated',
  'fmt.expiry.expired': 'expired {{date}}',
  'fmt.expiry.blocked': 'blocked',
  'fmt.expiry.revoked': 'revoked',
  'fmt.expiry.suffix': ' The nearest one expires {{date}}.',

  'fmt.bind.bound': 'Bound on {{boundAt}}',
  'fmt.bind.not_bound': 'Not bound — will bind on first launcher run',
  'fmt.cooldown.next': 'Next reset available {{date}}',
  'fmt.cooldown.exhausted': 'No resets left — please contact support',

  'fmt.duration.days': '{{days}} {{unit}}',
  'fmt.duration.lifetime': 'lifetime',

  /**
   * Формы множественного числа.
   *
   * Без них тариф на 30 дней подписан «30 дней» правильно, а на 31 — «31 дней»
   * неправильно, и это видно каждому русскоязычному покупателю на витрине.
   * Выбор формы делает Intl.PluralRules, а не таблица «если оканчивается на»:
   * своя таблица однажды разойдётся с правилами языка, которого мы не знаем.
   */
  'fmt.plural.day_one': 'day',
  'fmt.plural.day_few': 'days',
  'fmt.plural.day_many': 'days',
  'fmt.plural.hour_one': 'hour',
  'fmt.plural.hour_few': 'hours',
  'fmt.plural.hour_many': 'hours',

  'fmt.twofactor.on': 'enabled',
  'fmt.twofactor.off': 'disabled — turn it on from the website',

  'fmt.locale.ru': 'Русский',
  'fmt.locale.en': 'English',

  /**
   * Подпись часового пояса у дат.
   *
   * Даты показываются по Москве (решение A3: поля таймзоны у пользователя
   * нет). Без подписи человек читает «следующий сброс в 09:00» по своему
   * времени и приходит в поддержку на два часа раньше — а разница между
   * «бот врёт» и «бот не сказал, в каком поясе» ему не видна.
   */
  'fmt.tz': 'MSK',

  /** Прочерк там, где значения нет: единый вид у всех «пустых» полей. */
  'fmt.none': '—',
} as const;

/**
 * Ключ сообщения. Строковый союз, а не `string`: опечатка в имени ключа
 * обязана быть ошибкой компиляции, иначе она превращается в пустой экран
 * в проде — `t()` вернуть-то что-то вернёт, но не текст.
 */
export type MessageKey = keyof typeof en;
