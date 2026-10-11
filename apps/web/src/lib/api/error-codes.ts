/**
 * Словарь машинных кодов сервера в человеческие тексты.
 *
 * Точка синхронизации всех кусков работы: правится СТРОГО добавлением ключей.
 * Переструктурировать файл нельзя — его одновременно правят разные ветки.
 *
 * Тексты подобраны так, чтобы не выдавать лишнего:
 * - вход не уточняет, что именно неверно — логин или пароль;
 * - чужая лицензия выглядит как несуществующая;
 * - «код уже занят» не говорит, занят логин или почта.
 *
 * ЛОКАЛИЗАЦИЯ. Значение каждого кода — пара текстов, а не строка. Пара, а не
 * два соседних словаря, ровно по причине из шапки: файл правят параллельные
 * ветки, и два независимых объекта разъехались бы на первом же слиянии. Пара
 * физически не даёт добавить код на одном языке — типизация требует оба.
 *
 * Сервер НЕ переводится. Он отдаёт машинные коды, а его `message` остаётся
 * русским: это диагностика для разработчика и запасной текст для кода,
 * которого этот словарь ещё не знает.
 */
import { getLocale, type Locale } from '@/lib/i18n'

/** Текст кода на обоих языках. Английский — основной, русский — второй. */
type ErrorText = Record<Locale, string>

export const ERROR_CODE_MESSAGES: Record<string, ErrorText> = {
  // --- Сеть и общие ---
  NETWORK_ERROR: {
    en: "We can't reach the server. Check your connection and try again.",
    ru: 'Нет связи с сервером. Проверьте подключение и повторите.',
  },
  UNKNOWN_ERROR: {
    en: "That didn't go through. Try again.",
    ru: 'Не удалось выполнить запрос. Повторите попытку.',
  },
  INTERNAL_ERROR: {
    en: 'The service is having trouble. Try again in a minute.',
    ru: 'Сервис временно недоступен. Повторите через минуту.',
  },
  DATABASE_UNAVAILABLE: {
    en: 'The service is having trouble. Try again in a minute.',
    ru: 'Сервис временно недоступен. Повторите через минуту.',
  },
  NOT_READY: {
    en: 'The service is still starting up. Try again in a minute.',
    ru: 'Сервис ещё не готов принимать запросы. Повторите через минуту.',
  },
  VALIDATION_ERROR: {
    en: 'Check the highlighted fields and try again.',
    ru: 'Проверьте заполнение полей.',
  },
  // --- Реквизиты оплаты ---
  PROFILE_IN_USE: {
    en: 'These payment details are attached to products. Detach them first.',
    ru: 'Реквизиты привязаны к товарам. Сначала отвяжите их.',
  },
  PROFILE_PROVIDER_MISMATCH: {
    en: 'These payment details belong to another payment method.',
    ru: 'Эти реквизиты от другого способа оплаты.',
  },
  PROFILE_OF_OTHER_PRODUCT: {
    en: 'These are the own payment details of another product.',
    ru: 'Это личные реквизиты другого товара.',
  },
  // --- Поиск в журналах ---
  SEARCH_FIELD_UNKNOWN: {
    en: 'Unknown search field. Use the field buttons under the search box.',
    ru: 'Неизвестное поле поиска. Используйте кнопки полей под строкой поиска.',
  },
  SEARCH_VALUE_INVALID: {
    en: 'This field does not accept that value.',
    ru: 'Это поле не принимает такое значение.',
  },
  SEARCH_SYNTAX: {
    en: 'The search query is malformed: check brackets, quotes and AND / OR / NOT.',
    ru: 'Ошибка в строке поиска: проверьте скобки, кавычки и AND / OR / NOT.',
  },
  // --- Хранилище сборок ---
  BUILD_NAME_INVALID: {
    en: 'Build name: Latin letters and digits, segments separated by dots, ending with a letter or digit.',
    ru: 'Название сборки: латиница и цифры, части через точку, в конце буква или цифра.',
  },
  BUILD_NAME_TAKEN: {
    en: 'This product already has a build with that name.',
    ru: 'У товара уже есть сборка с таким названием.',
  },
  BUILD_OF_OTHER_PRODUCT: {
    en: 'The build must come from this product’s storage.',
    ru: 'Сборка должна быть из хранилища этого товара.',
  },
  // --- Блокировки адресов ---
  IP_INVALID: {
    en: 'That is not an address or a subnet (example: 203.0.113.7 or 203.0.113.0/24).',
    ru: 'Это не адрес и не подсеть (пример: 203.0.113.7 или 203.0.113.0/24).',
  },
  IP_RANGE_TOO_WIDE: {
    en: 'The subnet is too wide: at least /16 for IPv4 and /32 for IPv6.',
    ru: 'Слишком широкая подсеть: не шире /16 для IPv4 и /32 для IPv6.',
  },
  IP_BLOCK_SELF: {
    en: 'Your current address is in this subnet — you would lock yourself out.',
    ru: 'В эту подсеть входит ваш текущий адрес — вы заблокируете сами себя.',
  },
  IP_OF_PRIVILEGED_USER: {
    en: 'A user with a role at your level or higher signs in from this address — you cannot block it.',
    ru: 'С этого адреса входит пользователь с ролью вашего уровня или выше — блокировать его нельзя.',
  },
  IP_BLOCKED: {
    en: 'Access from your address is blocked.',
    ru: 'Доступ с вашего адреса заблокирован.',
  },
  // --- Профиль ---
  USERNAME_UNCHANGED: { en: 'That is already your username.', ru: 'Это ваш текущий логин.' },
  USERNAME_TAKEN: { en: 'This username is taken.', ru: 'Этот логин уже занят.' },
  EMAIL_UNCHANGED: { en: 'That is already your email.', ru: 'Это ваша текущая почта.' },
  EMAIL_TAKEN: { en: 'This email is used by another account.', ru: 'Эта почта уже используется другим аккаунтом.' },
  TOO_FREQUENT: {
    en: 'The email was just sent. Wait a minute before trying again.',
    ru: 'Письмо только что отправлено. Подождите минуту.',
  },
  PASSWORD_REQUIRED: { en: 'Set a password first.', ru: 'Сначала задайте пароль.' },
  // Коды из `codeFromStatus` (`all-exceptions.filter.ts:196`): их получает ЛЮБОЕ
  // исключение, которое не проставило `code` своими руками. В частности, отказ
  // ValidationPipe приходит именно как BAD_REQUEST, а не как VALIDATION_ERROR
  // выше — тот код сервер не отдаёт вообще.
  //
  // Без этих четырёх ключей `messageForCode` проваливается на `serverMessage`,
  // а он у сервера ВСЕГДА русский: английский интерфейс показывал бы
  // «Ошибка валидации запроса».
  BAD_REQUEST: {
    en: 'Check the highlighted fields and try again.',
    ru: 'Проверьте заполнение полей.',
  },
  CONFLICT: {
    en: 'That clashes with the current state. Refresh the page and try again.',
    ru: 'Действие противоречит текущему состоянию. Обновите страницу и повторите.',
  },
  UNPROCESSABLE: {
    en: "We can't process that request. Check the values and try again.",
    ru: 'Запрос не может быть обработан. Проверьте значения и повторите.',
  },
  // `codeFromStatus` отдаёт ERROR для статусов 4xx вне своей таблицы.
  ERROR: {
    en: "That didn't go through. Try again.",
    ru: 'Не удалось выполнить запрос. Повторите попытку.',
  },
  RATE_LIMIT_EXCEEDED: {
    en: 'Too many attempts. Wait a minute, then try again.',
    ru: 'Слишком много попыток. Подождите минуту и повторите.',
  },
  TOO_MANY_REQUESTS: {
    en: 'Too many attempts. Wait a minute, then try again.',
    ru: 'Слишком много попыток. Подождите минуту и повторите.',
  },
  // Именно этот код сервер ставит любому 429: `codeFromStatus` в
  // `all-exceptions.filter.ts:204`. Два ключа выше — синонимы на всякий случай,
  // но фактически приходит RATE_LIMITED.
  RATE_LIMITED: {
    en: 'Too many attempts. Wait a minute, then try again.',
    ru: 'Слишком много попыток. Подождите минуту и повторите.',
  },
  // Prisma-ошибка, которую фильтр не разобрал поимённо: наружу это 500.
  DATABASE_ERROR: {
    en: 'Something broke on our side. Try again in a minute — if it keeps happening, contact support.',
    ru: 'Внутренняя ошибка сервера. Повторите через минуту, а если повторится — напишите в поддержку.',
  },
  // `PrismaClientValidationError`: запрос собран неверно. Человеку помогает
  // только перезагрузка — состояние экрана разошлось с контрактом сервера.
  INVALID_QUERY: {
    en: "The request wasn't formed correctly. Reload the page and try again.",
    ru: 'Запрос составлен неверно. Обновите страницу и повторите.',
  },
  // Нарушение внешнего ключа: выбранной записи уже нет.
  INVALID_REFERENCE: {
    en: 'That points to a record which no longer exists. Refresh the page and pick again.',
    ru: 'Ссылка ведёт на запись, которой больше нет. Обновите страницу и выберите заново.',
  },
  SERVICE_UNAVAILABLE: {
    en: 'The service is busy right now. Try again in a minute.',
    ru: 'Сервис перегружен. Повторите через минуту.',
  },
  // Запрос оборвал сам клиент (вкладку закрыли, сеть моргнула).
  CLIENT_ABORTED: {
    en: 'The request was cancelled before it finished. Try again.',
    ru: 'Запрос был прерван, не завершившись. Повторите.',
  },
  STORAGE_UNAVAILABLE: {
    en: "File storage isn't responding. Try again in a few minutes.",
    ru: 'Хранилище файлов не отвечает. Повторите через несколько минут.',
  },

  // --- Токены и сессия ---
  TOKEN_EXPIRED: {
    en: 'Your session expired. Signing you back in…',
    ru: 'Сессия истекла, обновляем…',
  },
  UNAUTHORIZED: { en: 'Sign in to continue.', ru: 'Требуется вход.' },
  TOKEN_INVALID: {
    en: 'This link no longer works — it may already have been used. Request a new one.',
    ru: 'Ссылка недействительна или уже использована.',
  },
  TOKEN_REUSED: {
    en: 'We ended the session for safety. Sign in again.',
    ru: 'Сессия завершена из соображений безопасности. Войдите заново.',
  },
  TOKEN_REVOKED: {
    en: 'The session was ended. Sign in again.',
    ru: 'Сессия завершена. Войдите заново.',
  },
  SESSION_REVOKED: {
    en: 'The session was ended. Sign in again.',
    ru: 'Сессия завершена. Войдите заново.',
  },
  FORBIDDEN: {
    en: "Your account doesn't have rights for this. Ask an administrator if you need them.",
    ru: 'Недостаточно прав для этого действия.',
  },
  TWO_FACTOR_SETUP_REQUIRED: {
    en: 'Turn on two-factor authentication first, then repeat this action.',
    ru: 'Действие требует включённой двухфакторной аутентификации.',
  },
  // Ключ сборки лаунчера: область действия у него уже, чем запрошенный маршрут.
  API_KEY_SCOPE: {
    en: "This build's API key isn't allowed to use that endpoint. Issue a key with the right scope.",
    ru: 'Ключ сборки не имеет доступа к этому запросу. Выпустите ключ с нужной областью.',
  },
  SIGNATURE_MISSING: {
    en: 'The request arrived without its signature headers. Update the launcher to the current version.',
    ru: 'Запрос пришёл без заголовков подписи. Обновите лаунчер до актуальной версии.',
  },
  SIGNATURE_INVALID: {
    en: "The request signature didn't check out. Update the launcher and try again.",
    ru: 'Подпись запроса не сошлась. Обновите лаунчер и повторите.',
  },
  // Единственный код, где виновата не программа, а часы на машине.
  SIGNATURE_EXPIRED: {
    en: 'The request timestamp is outside the allowed window. Check the clock on this device and try again.',
    ru: 'Метка времени вне допустимого окна. Проверьте системное время на устройстве и повторите.',
  },
  REPLAY: {
    en: 'This request was already processed. Start the action over instead of sending it again.',
    ru: 'Этот запрос уже обработан. Начните действие заново, а не отправляйте тот же запрос.',
  },
  SESSION_KEY_REUSED: {
    en: 'That session key was already used. The launcher must generate a new one for every request — update it to the current version.',
    ru: 'Этот sessionKey уже использовался. Лаунчер обязан брать новый на каждый запрос — обновите его до актуальной версии.',
  },

  // --- Вход и регистрация ---
  INVALID_CREDENTIALS: {
    en: "That login and password don't match. Check both and try again.",
    ru: 'Неверный логин или пароль.',
  },
  EMAIL_NOT_VERIFIED: {
    en: 'Confirm your email using the link we sent you.',
    ru: 'Подтвердите почту по ссылке из письма.',
  },
  ACCOUNT_BLOCKED: {
    en: 'This account is blocked. Contact support to have it reviewed.',
    ru: 'Аккаунт заблокирован. Обратитесь в поддержку.',
  },
  ALREADY_EXISTS: {
    en: 'That login or email is already taken. Pick another one, or sign in instead.',
    ru: 'Такой логин или почта уже заняты. Возьмите другие или войдите.',
  },
  NOT_FOUND: {
    en: "We couldn't find that. Refresh the page — it may have been removed.",
    ru: 'Не найдено. Обновите страницу — запись могли удалить.',
  },

  // --- Второй фактор ---
  TWO_FACTOR_REQUIRED: {
    en: 'Enter the code from your authenticator app.',
    ru: 'Введите код двухфакторной аутентификации.',
  },
  TWO_FACTOR_INVALID: {
    en: "That code didn't work. Wait for the next one in your app and enter it.",
    ru: 'Неверный код. Дождитесь следующего в приложении и введите его.',
  },
  TWO_FACTOR_CODE_USED: {
    en: 'That code has already been used. Wait for the next one in your app.',
    ru: 'Этот код уже использован. Дождитесь следующего в приложении.',
  },
  TWO_FACTOR_ATTEMPTS_EXCEEDED: {
    en: "You're out of attempts. Enter your password again to start over.",
    ru: 'Попытки исчерпаны. Введите пароль заново.',
  },
  TWO_FACTOR_ALREADY_ENABLED: {
    en: 'Two-factor authentication is already on. To move it to another device, turn it off and set it up again.',
    ru: 'Двухфакторная аутентификация уже включена. Чтобы сменить устройство, выключите её и настройте заново.',
  },
  // --- Telegram-бот ---
  TELEGRAM_DISABLED: {
    en: 'The Telegram bot is switched off right now. Try again later.',
    ru: 'Telegram-бот сейчас отключён администратором. Попробуйте позже.',
  },
  TELEGRAM_NOT_LINKED: {
    en: 'The bot is not connected to this account.',
    ru: 'Бот не подключён к этому аккаунту.',
  },

  TWO_FACTOR_NOT_SET_UP: {
    en: "Two-factor authentication isn't set up yet. Set it up under Security.",
    ru: 'Двухфакторная аутентификация не настроена. Настройте её в разделе «Безопасность».',
  },
  CHALLENGE_INVALID: {
    en: 'The confirmation window closed. Enter your password again.',
    ru: 'Время подтверждения истекло. Введите пароль заново.',
  },

  // --- Пароль ---
  PASSWORD_UNCHANGED: {
    en: "That's your current password. Choose a different one.",
    ru: 'Новый пароль совпадает с текущим.',
  },
  PASSWORD_ALREADY_SET: {
    en: 'This account already has a password. Use «Change password» instead.',
    ru: 'Пароль уже задан — используйте смену пароля.',
  },

  // --- OAuth ---
  OAUTH_STATE_INVALID: {
    en: 'The sign-in attempt timed out. Start again from the sign-in page.',
    ru: 'Сессия входа истекла. Начните заново.',
  },
  OAUTH_SIGNATURE_INVALID: {
    en: "We couldn't verify the data from the provider. Start the sign-in again.",
    ru: 'Подпись данных входа не подтвердилась. Начните вход заново.',
  },
  OAUTH_PAYLOAD_EXPIRED: {
    en: 'The sign-in data is stale. Start the sign-in again.',
    ru: 'Данные входа устарели. Повторите.',
  },
  OAUTH_INVALID_PAYLOAD: {
    en: 'The sign-in data arrived damaged. Start the sign-in again.',
    ru: 'Данные входа повреждены. Повторите.',
  },
  OAUTH_EXCHANGE_FAILED: {
    en: "The provider didn't respond. Try again in a minute.",
    ru: 'Провайдер недоступен. Повторите попытку.',
  },
  OAUTH_PROFILE_FAILED: {
    en: "The provider didn't respond. Try again in a minute.",
    ru: 'Провайдер недоступен. Повторите попытку.',
  },
  OAUTH_NOT_CONFIGURED: {
    en: 'This sign-in method is switched off right now. Use your password instead.',
    ru: 'Этот способ входа сейчас недоступен. Войдите по паролю.',
  },
  UNKNOWN_PROVIDER: {
    en: "We don't support that sign-in method. Use one of the buttons on the sign-in page.",
    ru: 'Неизвестный способ входа. Используйте кнопки на странице входа.',
  },
  // Текст сервера советует «привяжите аккаунт в настройках», но привязки
  // в первой версии нет — даём выполнимую инструкцию.
  EMAIL_TAKEN_LINK_MANUALLY: {
    en: 'That email already has an account. Sign in with your password.',
    ru: 'Эта почта уже зарегистрирована. Войдите по паролю.',
  },
  LAST_LOGIN_METHOD: {
    en: 'This is your only way in. Set a password first, then you can remove it.',
    ru: 'Это единственный способ входа. Сначала задайте пароль.',
  },
  OAUTH_ALREADY_LINKED: {
    en: 'That provider account is already linked — to you or to someone else. Use a different provider account.',
    ru: 'Этот аккаунт провайдера уже привязан — к вам или к другому пользователю. Возьмите другой аккаунт провайдера.',
  },

  // --- Ключи регистрации и активации ---
  KEY_INVALID: {
    en: "We don't recognise that key. Check the characters and try again.",
    ru: 'Ключ не найден. Проверьте символы и повторите.',
  },
  KEY_EXPIRED: {
    en: 'That key has expired. Ask whoever gave it to you for a new one.',
    ru: 'Срок действия ключа истёк. Запросите новый у того, кто его выдал.',
  },
  KEY_ALREADY_USED: {
    en: "That key has already been activated. If it wasn't you, contact support.",
    ru: 'Ключ уже активирован. Если это были не вы — обратитесь в поддержку.',
  },
  // ВАЖНО: ключ здесь НЕ погашен. Исключение бросается до транзакции
  // (registration-key.service.ts:295-300), поэтому «ключ активирован» было бы
  // прямой ложью на денежном пути: человек решил бы, что потратил ключ впустую.
  KEY_WITHOUT_LICENSE: {
    en: 'This key only creates a new account — there is no product or plan in it. Nothing was spent, so you can still register with it.',
    ru: 'Этот ключ только для регистрации нового аккаунта — продукта и тарифа в нём нет. Ключ не потрачен.',
  },
  // Ключ лицензии, который лаунчер шлёт на проверку. Отдельный код от
  // KEY_INVALID: тот про ключ регистрации, и советы у них разные.
  LICENSE_KEY_INVALID: {
    en: "We don't recognise that licence key. Check it against the one in your account.",
    ru: 'Ключ лицензии не найден. Проверьте ключ в личном кабинете.',
  },

  // --- Покупки ---
  CODE_MALFORMED: {
    en: "That code isn't in the expected format. Copy it again from the store email.",
    ru: 'Проверьте формат кода — скопируйте его из письма магазина заново.',
  },
  CODE_NOT_ACCEPTED: {
    en: "The store didn't accept that code. Check it in the store email and try again.",
    ru: 'Площадка не подтвердила код. Проверьте его в письме магазина и повторите.',
  },
  CODE_ALREADY_USED: {
    en: 'That code was activated on another account. Contact support with the code and your order number.',
    ru: 'Код активирован другим аккаунтом. Обратитесь в поддержку.',
  },
  TOO_MANY_ATTEMPTS: {
    en: 'Too many attempts. Wait a few minutes, then try again.',
    ru: 'Слишком много попыток. Попробуйте позже.',
  },
  // Деньги у площадки, сделка припаркована и ждёт администратора.
  // Это НЕ ошибка пользователя: красным не красить.
  PRODUCT_NOT_MAPPED: {
    en: 'Payment received. Your licence will be issued shortly — nothing else is needed from you.',
    ru: 'Оплата принята, лицензия будет выдана в ближайшее время.',
  },

  // --- Активация по номеру заказа ---
  //
  // Каждое состояние счёта площадки получает СВОЙ текст. Общее «не удалось»
  // здесь особенно дорого: человек уже заплатил и хочет знать не «что-то
  // пошло не так», а что делать дальше — ждать, повторить оплату или писать
  // в поддержку. Ответы разные ровно потому, что действия разные.
  ORDER_MALFORMED: {
    en: 'An order number is digits only — check that you copied the whole thing.',
    ru: 'Номер заказа состоит только из цифр — проверьте, что скопировали его целиком.',
  },
  ORDER_NOT_ACCEPTED: {
    en: 'The store has no order with that number. Check it in your Digiseller email.',
    ru: 'Площадка не нашла такой заказ. Проверьте номер в письме от Digiseller.',
  },
  ORDER_NOT_PAID: {
    en: "This order isn't paid yet. Finish the payment on the store, then come back here.",
    ru: 'Заказ ещё не оплачен. Завершите оплату на площадке и вернитесь сюда.',
  },
  ORDER_PAYMENT_FAILED: {
    en: "The payment for this order didn't go through. Place the order again.",
    ru: 'Оплата по этому заказу не прошла. Оформите покупку заново.',
  },
  ORDER_EXPIRED: {
    en: 'The payment window for this order has closed. Place the order again.',
    ru: 'Срок оплаты заказа истёк. Оформите покупку заново.',
  },
  ORDER_REFUNDED: {
    en: "This order was refunded, so it can't be activated. Buy again to get a licence.",
    ru: 'По этому заказу оформлен возврат — активировать его нельзя.',
  },
  ORDER_REFUND_PENDING: {
    en: 'A refund is in progress for this order. Activation stays closed until it settles.',
    ru: 'По заказу идёт возврат средств. Активация недоступна, пока он не завершится.',
  },
  ORDER_STATE_UNKNOWN: {
    en: "The store returned a state we don't recognise. We're looking into it — contact support with your order number.",
    ru: 'Площадка вернула непонятное состояние заказа. Мы уже смотрим — напишите в поддержку.',
  },
  ORDER_NO_BUYER_EMAIL: {
    en: "The store didn't tell us the buyer's address for this order. Contact support with your order number.",
    ru: 'Площадка не сообщила адрес покупателя по этому заказу. Напишите в поддержку.',
  },
  // Намеренно не подсказываем, какой адрес правильный: подсказка превратила
  // бы форму в справочник чужих почт по номеру заказа.
  ORDER_EMAIL_MISMATCH: {
    en: "That address doesn't match the one the purchase was made with. Take it from your Digiseller email.",
    ru: 'Адрес не совпадает с тем, на который оформлена покупка. Возьмите его из письма от Digiseller.',
  },
  // ORDER_ATTEMPTS_EXHAUSTED здесь НАМЕРЕННО ОТСУТСТВУЕТ, и это не пропуск.
  //
  // Словарь перебивает сообщение сервера (см. messageForCode ниже), а сервер
  // по этому коду присылает точное время ожидания: «повторите через 47 мин».
  // Любая запись здесь заменила бы число на общие слова.
  //
  // История, из-за которой это важно: сначала сервер отдавал на «попытки
  // кончились» тот же код ORDER_EMAIL_MISMATCH, что и на настоящее
  // несовпадение почты. Словарь подставлял текст про адрес — и живой
  // покупатель, у которого адрес БЫЛ верным, час перепроверял почту вместо
  // того, чтобы просто подождать.
  //
  // ДОПОЛНЕНО ПРИ ЛОКАЛИЗАЦИИ. Опираться на текст сервера больше нельзя: он
  // русский, и в английском интерфейсе выдал бы кириллицу. Число при этом
  // терять по-прежнему запрещено. Поэтому код обслуживает не плоский словарь,
  // а DYNAMIC_CODE_MESSAGES ниже — он берёт `details.retryAfterSec`, который
  // сервер шлёт отдельным полем (digiseller.service.ts:1371), и собирает текст
  // на нужном языке сам. Число остаётся, язык становится правильным.
  ORDER_AMOUNT_MISMATCH: {
    // Деньги у площадки, разбирается администратор — это не вина покупателя.
    en: "The amount paid doesn't match the plan price. Your purchase is recorded and goes to a person for review.",
    ru: 'Сумма оплаты не сходится с ценой тарифа. Покупка записана и уйдёт на проверку.',
  },
  PLAN_INACTIVE: {
    en: "This plan is no longer on sale. Your purchase is recorded and we'll get in touch about it.",
    ru: 'Этот тариф снят с продажи. Покупка записана, мы свяжемся по ней.',
  },
  PROVIDER_UNAVAILABLE: {
    en: "The store isn't responding. Try again in a minute.",
    ru: 'Площадка недоступна. Повторите через минуту.',
  },
  ALREADY_REDEEMED: {
    en: 'This purchase has already been issued. Look for it in your licences.',
    ru: 'Покупка уже выдана — ищите её в списке лицензий.',
  },
  NO_CLAIMANT: {
    en: "We can't tell whose purchase this is. Contact support with your order number.",
    ru: 'Покупатель не определён. Напишите в поддержку с номером заказа.',
  },

  // --- Привязка к устройству ---
  HWID_RESET_COOLDOWN: {
    en: "A reset isn't available yet. The licence card shows when the next one opens up.",
    ru: 'Сброс будет доступен позже — точная дата указана в карточке лицензии.',
  },
  HWID_RESET_LIMIT: {
    en: "You've used every self-service reset for this licence. Contact support to change the device.",
    ru: 'Лимит сбросов исчерпан. Обратитесь в поддержку.',
  },
  NOT_BOUND: {
    en: "This licence isn't bound to a device yet. Start the product once — binding happens on first launch.",
    ru: 'Устройство не привязано. Запустите продукт — привязка происходит при первом запуске.',
  },
  // Блокировка устройства снимается только руками: сброс привязки её не обходит,
  // и предлагать сброс здесь значит отправить человека тратить лимит впустую.
  DEVICE_BLOCKED: {
    en: "This device is blocked. Contact support — resetting the binding won't lift it.",
    ru: 'Устройство заблокировано. Обратитесь в поддержку — сброс привязки этого не снимет.',
  },
  HWID_MISMATCH: {
    en: 'This licence is bound to a different device. Reset the binding in your account, then start the product again.',
    ru: 'Лицензия привязана к другому устройству. Сбросьте привязку в личном кабинете и запустите продукт заново.',
  },

  // --- Состояния лицензии ---
  //
  // Раздел появился при доведении словаря до полного покрытия: эти коды
  // сервер отдаёт лаунчеру и кабинету, а фронт до сих пор показывал по ним
  // русский текст сервера.
  LICENSE_BLOCKED: {
    en: "This licence is blocked. Contact support — another key won't get around it.",
    ru: 'Лицензия заблокирована. Обратитесь в поддержку — другой ключ этого не обойдёт.',
  },
  LICENSE_EXPIRED: {
    en: 'This licence has expired. Renew it to keep using the product.',
    ru: 'Срок действия лицензии истёк. Продлите её, чтобы продолжить пользоваться продуктом.',
  },
  LICENSE_REVOKED: {
    en: "This licence was revoked and can't be restored. You'll need a new one.",
    ru: 'Лицензия отозвана и восстановлению не подлежит. Потребуется новая.',
  },
  LICENSE_NOT_ACTIVATED: {
    en: "This licence hasn't started yet. Launch the product once — the term runs from the first launch.",
    ru: 'Лицензия ещё не активирована. Срок начнётся с первого запуска — запустите продукт.',
  },
  LICENSE_NOT_ASSIGNED: {
    en: "This key isn't attached to any account. Activate it in your account first.",
    ru: 'Ключ не привязан к аккаунту — активируйте его в личном кабинете.',
  },
  LICENSE_NOT_BOUND: {
    en: 'Run a licence check first — that is where the product binds to this device.',
    ru: 'Сначала выполните проверку лицензии — на ней продукт привязывается к устройству.',
  },
  NOT_BLOCKED: {
    en: "This licence isn't blocked, so there is nothing to lift. Refresh the page to see its current state.",
    ru: 'Лицензия не заблокирована — снимать нечего. Обновите страницу, чтобы увидеть её текущее состояние.',
  },

  // --- Продукты, тарифы, выпуск ключей (администрирование) ---
  PRODUCT_NOT_FOUND: {
    en: 'That product no longer exists. Refresh the page and pick another one.',
    ru: 'Продукт не найден. Обновите страницу и выберите другой.',
  },
  PRODUCT_ARCHIVED: {
    en: "This product is archived, so new keys can't be issued for it. Unarchive it or choose another product.",
    ru: 'Продукт архивирован, новые ключи на него не выпускаются. Разархивируйте его или выберите другой продукт.',
  },
  PLAN_MISMATCH: {
    en: 'That plan belongs to a different product. Pick a plan from the product you selected.',
    ru: 'Тариф принадлежит другому продукту. Выберите тариф из выбранного продукта.',
  },
  PRODUCT_AND_PLAN_REQUIRED: {
    en: 'Product and plan go together. Fill in both fields or clear both.',
    ru: 'Продукт и тариф указываются вместе либо не указываются вовсе — заполните оба поля или очистите оба.',
  },
  INVALID_COUNT: {
    en: 'That number is outside the allowed range. Check the limits and enter a smaller value.',
    ru: 'Число вне допустимого диапазона. Проверьте пределы и введите значение поменьше.',
  },
  INVALID_DURATION: {
    en: 'The term must be at least one day, or empty for a lifetime plan.',
    ru: 'Срок должен быть не меньше одного дня либо пустым для бессрочного тарифа.',
  },
  INVALID_VERSION: {
    en: 'Version numbers look like 1.4.2 — three numbers separated by dots. Fix it and try again.',
    ru: 'Номер версии пишется как 1.4.2 — три числа через точку. Исправьте и повторите.',
  },

  // --- Сборки, версии и файлы ---
  ALREADY_PUBLISHED: {
    en: 'This is already published. Publishing again changes nothing — release a new version instead.',
    ru: 'Уже опубликовано. Повторная публикация ничего не меняет — выпустите новую версию.',
  },
  VERSION_PUBLISHED: {
    en: "A published version can't be edited. Release a new version with your changes.",
    ru: 'Опубликованную версию менять нельзя. Выпустите новую версию с правками.',
  },
  PAYLOAD_PUBLISHED: {
    en: "A published build can't be edited, even after it is unpublished. Upload a new build.",
    ru: 'Опубликованную сборку менять нельзя, даже после снятия с публикации. Загрузите новую сборку.',
  },
  CHANNEL_NOT_SUPPORTED: {
    en: 'Only the STABLE channel is delivered right now. Publish the build to STABLE.',
    ru: 'Сегодня доставляется только канал STABLE. Опубликуйте сборку в STABLE.',
  },
  FILE_REQUIRED: {
    en: 'Upload the file and confirm the upload before publishing.',
    ru: 'Сначала загрузите файл и подтвердите загрузку, потом публикуйте.',
  },
  UPLOAD_NOT_FOUND: {
    en: "We don't see that upload in storage. Request an upload link and send the file again.",
    ru: 'Загрузки по этому ключу в хранилище нет. Запросите ссылку и отправьте файл заново.',
  },
  INVALID_OBJECT_KEY: {
    en: "The object key isn't in the expected shape. Request a fresh upload link instead of composing the key by hand.",
    ru: 'Ключ объекта не той формы. Запросите новую ссылку на загрузку вместо составления ключа руками.',
  },
  OBJECT_NOT_FOUND: {
    en: 'The file is missing from storage. Upload it again and confirm the upload.',
    ru: 'Файла нет в хранилище. Загрузите его заново и подтвердите загрузку.',
  },
  OBJECT_TOO_LARGE: {
    en: 'The file is over the size ceiling, so delivery is stopped. Publish a smaller build.',
    ru: 'Файл превышает допустимый размер, выдача остановлена. Опубликуйте сборку поменьше.',
  },
  PAYLOAD_TOO_LARGE: {
    en: 'This payload is over the size ceiling. Trim the build and upload it again.',
    ru: 'Payload превышает допустимый потолок. Уменьшите сборку и загрузите заново.',
  },
  PAYLOAD_OBJECT_MISMATCH: {
    en: "The file in storage doesn't match what was confirmed. Confirm the upload again.",
    ru: 'Объект в хранилище не совпадает с подтверждённым. Подтвердите загрузку заново.',
  },
  // Целостность не сошлась — выдача остановлена намеренно. Пользователю
  // делать нечего, и говорить ему «повторите» было бы враньём.
  PAYLOAD_CORRUPT: {
    en: "The build data failed its integrity check and delivery is paused. We're on it — nothing is needed from you.",
    ru: 'Данные сборки не прошли проверку целостности, выдача приостановлена. Мы уже разбираемся — от вас ничего не требуется.',
  },
  PAYLOAD_NOT_READY: {
    en: "This build isn't published yet. Try again once the release goes out.",
    ru: 'Сборка ещё не опубликована. Повторите после выпуска релиза.',
  },
  PAYLOAD_UNAVAILABLE: {
    en: 'The build is temporarily unavailable. Try again in a few minutes.',
    ru: 'Сборка временно недоступна. Повторите через несколько минут.',
  },
  PRESIGNED_FORBIDDEN: {
    en: "Direct download links to payloads aren't allowed. Use the launcher delivery endpoint.",
    ru: 'Прямые presigned-ссылки на payload запрещены. Используйте маршрут выдачи для лаунчера.',
  },
  ISSUE_NOT_RECORDED: {
    en: "We couldn't record the problem report. Try again in a minute.",
    ru: 'Не удалось записать сообщение о проблеме. Повторите через минуту.',
  },
  UPDATE_REQUIRED: {
    en: 'This launcher version is below the minimum we support. Update the launcher and try again.',
    ru: 'Версия лаунчера ниже минимально допустимой. Обновите лаунчер и повторите.',
  },

  // --- Покупка на сайте ---
  PAYMENT_METHOD_DISABLED: {
    en: 'This payment method is not available right now. Choose another one.',
    ru: 'Этот способ оплаты сейчас недоступен. Выберите другой.',
  },
  PLAN_NOT_AVAILABLE: {
    en: 'This plan is no longer on sale. Refresh the catalogue.',
    ru: 'Этот тариф больше не продаётся. Обновите каталог.',
  },
  PLAN_NOT_FOR_SALE: { en: 'This plan cannot be bought.', ru: 'Этот тариф не продаётся.' },
  TOO_MANY_PENDING_ORDERS: {
    en: 'You already have several unpaid orders. Pay or cancel them in “My orders”.',
    ru: 'У вас уже есть неоплаченные заказы. Оплатите или отмените их в «Моих заказах».',
  },
  WALLET_NOT_FOUND: {
    en: 'That wallet is no longer available. Reopen the payment window.',
    ru: 'Этот кошелёк больше недоступен. Откройте окно оплаты заново.',
  },
  EMAIL_REQUIRED_FOR_RECEIPT: {
    en: 'Card payments need an email in your profile — the receipt is sent there.',
    ru: 'Для оплаты картой нужна почта в профиле — на неё придёт чек.',
  },
  PROVIDER_REJECTED: {
    en: 'The payment system refused the request. Try another payment method.',
    ru: 'Платёжная система отклонила запрос. Попробуйте другой способ оплаты.',
  },
  TX_HASH_INVALID: {
    en: "That doesn't look like a transaction hash. Copy it from your wallet history.",
    ru: 'Это не похоже на хеш транзакции. Скопируйте его из истории кошелька.',
  },
  TX_ALREADY_USED: {
    en: 'This transaction is already attached to another order.',
    ru: 'Эта транзакция уже указана в другом заказе.',
  },
  NOT_CRYPTO_ORDER: { en: 'This order is not paid with crypto.', ru: 'Этот заказ оплачивается не криптовалютой.' },
  ORDER_NOT_PENDING: {
    en: 'The order has already been processed. Refresh the page.',
    ru: 'Заказ уже обработан. Обновите страницу.',
  },
  ORDER_CANCEL_NOT_ALLOWED: {
    en: 'This order can no longer be cancelled — the payment is already being processed.',
    ru: 'Этот заказ уже нельзя отменить — оплата в обработке.',
  },
  MANUAL_CONFIRM_NOT_ALLOWED: {
    en: 'YooKassa confirms this payment itself. Refresh the order status instead.',
    ru: 'Эту оплату подтверждает сама ЮKassa. Обновите статус заказа.',
  },
  PAYMENT_METHOD_NOT_READY: {
    en: 'The method cannot be turned on yet: fill in the keys or add a wallet.',
    ru: 'Способ пока нельзя включить: заполните ключи или добавьте кошелёк.',
  },

  // --- Реселлеры ---
  RESELLER_NOT_FOUND: { en: 'This account is not a reseller.', ru: 'Этот аккаунт не реселлер.' },
  RESELLER_INACTIVE: {
    en: 'Sales are suspended by the administrator.',
    ru: 'Продажи приостановлены администратором.',
  },
  INSUFFICIENT_BALANCE: {
    en: 'Not enough money on the balance (credit included). Ask the administrator to top it up.',
    ru: 'Не хватает денег на балансе (с учётом кредита). Попросите администратора пополнить баланс.',
  },
  PRODUCT_NOT_ALLOWED: { en: 'You are not allowed to sell this product.', ru: 'Этот товар вам продавать не разрешено.' },
  RESELLER_DAILY_LIMIT: {
    en: 'Your daily limit of device resets is used up. Try again tomorrow.',
    ru: 'Суточный лимит сбросов привязки исчерпан. Попробуйте завтра.',
  },
  ALREADY_RESELLER: { en: 'This user is already a reseller.', ru: 'Этот пользователь уже реселлер.' },
  KEY_NOT_CANCELLABLE: {
    en: 'The key is already activated or cancelled.',
    ru: 'Ключ уже активирован или отменён.',
  },
  CURRENCY_MISMATCH: {
    en: 'The plan currency differs from the balance currency.',
    ru: 'Валюта тарифа не совпадает с валютой баланса.',
  },
  TOO_MANY_PENDING_TOPUPS: {
    en: 'You already have too many open top-up requests. Pay or cancel one of them first.',
    ru: 'Слишком много незакрытых заявок на пополнение. Оплатите или отмените одну из них.',
  },
  TOPUP_NOT_OPEN: {
    en: 'The request has already been reviewed or cancelled.',
    ru: 'Заявка уже рассмотрена или отменена.',
  },
  TOPUP_EXPIRED: {
    en: 'The request has expired. Create a new one — the coin amount will be recalculated.',
    ru: 'Срок заявки истёк. Создайте новую — сумма в монетах пересчитается.',
  },
  TOPUP_NOT_CANCELLABLE: {
    en: 'Only a request that is still awaiting payment can be cancelled.',
    ru: 'Отменить можно только заявку, которая ещё ждёт оплаты.',
  },

  // --- Пользователи и роли ---
  ROLE_TOO_HIGH: {
    en: 'You can only grant and remove roles lower than your own.',
    ru: 'Выдавать и снимать можно только роли ниже вашей.',
  },
  USER_TOO_PRIVILEGED: {
    en: 'This user has a role at your level or higher — you cannot change them.',
    ru: 'У этого пользователя роль вашего уровня или выше — менять его нельзя.',
  },
  CANNOT_MANAGE_SELF: {
    en: 'Change your own account in the profile settings.',
    ru: 'Свой аккаунт меняйте в настройках профиля.',
  },
  ROLE_REQUIRED: { en: 'A user needs at least one role.', ru: 'Нужна хотя бы одна роль.' },
  ROLE_NOT_FOUND: { en: 'Unknown role. Refresh the page.', ru: 'Неизвестная роль. Обновите страницу.' },
  ROLE_SYSTEM: {
    en: 'System roles are managed by the seed. Create your own role based on this one.',
    ru: 'Системные роли меняет только сид. Создайте свою роль на основе этой.',
  },
  ROLE_PRIORITY_INVALID: {
    en: 'Invalid role level. A role with staff permissions needs level 60 or higher (2FA is mandatory for it).',
    ru: 'Неверный уровень роли. Роли с правами сотрудника нужен уровень от 60 (для неё обязательна 2FA).',
  },
  PERMISSION_NOT_OWNED: {
    en: 'You can only put permissions you have yourself into a role.',
    ru: 'В роль можно включать только права, которые есть у вас.',
  },
  PERMISSION_NOT_FOUND: { en: 'Unknown permission. Refresh the page.', ru: 'Неизвестное право. Обновите страницу.' },

  // --- Разделы реквизитов ---
  PROFILE_WRONG_SCOPE: {
    en: 'These payment details belong to the other section. Move them first.',
    ru: 'Эти реквизиты из другого раздела. Сначала перенесите их.',
  },
  PROFILE_PROVIDER_NOT_FOR_RESELLERS: {
    en: 'Resellers top up only with crypto — YooKassa stays in the products section.',
    ru: 'Реселлеры пополняют баланс только криптой — ЮKassa остаётся в разделе товаров.',
  },
}

/**
 * Коды, текст которых собирается из данных ответа, а не берётся готовым.
 *
 * Нужны там, где в сообщении есть ЧИСЛО от сервера. Плоский словарь такое
 * число потерял бы, а текст сервера — русский и в английском интерфейсе
 * неуместен. Здесь текст собирается на нужном языке вокруг числа.
 *
 * Возврат `null` означает «данных не хватило» — тогда работает обычный
 * порядок разбора, как будто динамического текста нет.
 */
const DYNAMIC_CODE_MESSAGES: Record<
  string,
  (locale: Locale, details: unknown) => string | null
> = {
  ORDER_ATTEMPTS_EXHAUSTED: (locale, details) => {
    const seconds = retryAfterSec(details)
    if (seconds === null) {
      return locale === 'ru'
        ? 'Слишком много неудачных попыток по этому заказу. Повторите позже.'
        : 'Too many failed attempts on this order. Try again later.'
    }
    const minutes = Math.max(1, Math.ceil(seconds / 60))
    return locale === 'ru'
      ? `Слишком много неудачных попыток по этому заказу. Повторите через ${minutes} мин — адрес при этом менять не нужно.`
      : `Too many failed attempts on this order. Try again in ${minutes} min — you don't need to change the address.`
  },
}

/** `details: { retryAfterSec }` от сервера; всё прочее — не наше дело. */
function retryAfterSec(details: unknown): number | null {
  if (typeof details !== 'object' || details === null) return null
  const value = (details as { retryAfterSec?: unknown }).retryAfterSec
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Коды, которые по смыслу не ошибка, а состояние. UI обязан рисовать их
 * нейтрально: деньги списаны, действие прошло, красный цвет вводит в панику.
 */
export const NEUTRAL_ERROR_CODES = new Set([
  'PRODUCT_NOT_MAPPED',
  'ALREADY_YOURS',
  'KEY_WITHOUT_LICENSE',
  'TWO_FACTOR_REQUIRED',
  // Деньги дошли, сделка припаркована и ждёт администратора. Красный цвет
  // сказал бы заплатившему человеку «ты сделал что-то не так» — а он не делал.
  'ORDER_AMOUNT_MISMATCH',
  'PLAN_INACTIVE',
])

/**
 * Текст для кода на текущем языке.
 *
 * Порядок разбора: динамический текст с числом → словарь → сообщение сервера →
 * общая заглушка. Сообщение сервера предпоследнее и остаётся русским: это
 * запасной вариант для кода, которого словарь ещё не знает, и увидеть его
 * лучше, чем «неизвестная ошибка».
 *
 * `details` необязателен — старые вызовы с двумя аргументами продолжают
 * работать как работали.
 */
export function messageForCode(
  code: string,
  serverMessage?: string,
  details?: unknown
): string {
  const locale = getLocale()

  const dynamic = DYNAMIC_CODE_MESSAGES[code]?.(locale, details)
  if (dynamic) return dynamic

  return (
    ERROR_CODE_MESSAGES[code]?.[locale] ??
    serverMessage ??
    ERROR_CODE_MESSAGES.UNKNOWN_ERROR[locale]
  )
}

/** Текст «не получилось» на текущем языке — общий запасной вариант. */
export function unknownErrorMessage(): string {
  return ERROR_CODE_MESSAGES.UNKNOWN_ERROR[getLocale()]
}
