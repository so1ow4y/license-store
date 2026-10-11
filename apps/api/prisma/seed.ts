/**
 * Первичное наполнение БД: права, роли, настройки, шаблоны уведомлений и
 * супер-админ. Товаров здесь нет — их заводит администратор в панели.
 *
 * Идемпотентен (всё через upsert). Запуск:  npm run db:seed
 */
import { PrismaClient, ActorType } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

const ARGON2_OPTS = {
  memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 65536),
  timeCost: Number(process.env.ARGON2_TIME_COST ?? 3),
  parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
};

/** База ссылок в письмах. На сервере приезжает из .env.production. */
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// ---------------------------------------------------------------------------
//  ПРАВА. Формат <домен>.<действие>[.any|.own]; .own — только свои объекты.
//  Каждое право закрывает хотя бы один маршрут API.
// ---------------------------------------------------------------------------
const PERMISSIONS: Array<[slug: string, group: string, description: string]> = [
  ['users.read.any', 'users', 'Просмотр пользователей'],
  ['users.update.any', 'users', 'Редактирование пользователей'],
  ['users.block', 'users', 'Блокировка и разблокировка пользователей'],
  ['roles.read', 'users', 'Просмотр ролей'],
  ['roles.assign', 'users', 'Назначение ролей (только ниже своей)'],
  ['roles.manage', 'users', 'Создание своих ролей из набора прав (только ниже своей)'],

  ['products.manage', 'products', 'Создание и редактирование товаров'],
  ['plans.manage', 'products', 'Управление тарифами'],
  ['versions.read', 'products', 'Просмотр версий и сборок'],
  ['versions.manage', 'products', 'Публикация версий и сборок'],
  ['files.upload', 'products', 'Загрузка файлов в хранилище'],

  ['licenses.read.any', 'licenses', 'Просмотр всех лицензий'],
  ['licenses.read.own', 'licenses', 'Просмотр своих лицензий'],
  ['licenses.create.any', 'licenses', 'Выдача лицензий и ключей регистрации'],
  ['licenses.extend', 'licenses', 'Продление лицензий'],
  ['licenses.block', 'licenses', 'Блокировка и разблокировка лицензий'],
  ['licenses.build.assign', 'licenses', 'Закрепление сборки за лицензией'],

  ['hwid.reset.self', 'hwid', 'Самостоятельный сброс своей привязки'],
  ['hwid.reset.any', 'hwid', 'Сброс привязки любой лицензии'],
  ['hwid.set.manual', 'hwid', 'Ручная установка устройства'],
  ['hwid.history.read', 'hwid', 'Просмотр истории привязок'],
  // Сброс поддержкой расходует лимит пользователя (У-7); этим правом
  // поддержка возвращает счётчик, если сброс был по вине системы.
  ['hwid.counter.adjust', 'hwid', 'Корректировка счётчика сбросов'],

  ['orders.read.any', 'billing', 'Просмотр всех заказов'],
  ['orders.read.own', 'billing', 'Просмотр своих заказов'],
  ['orders.manage', 'billing', 'Подтверждение и отмена заказов'],
  ['orders.refund', 'billing', 'Отзыв лицензии при возврате средств'],
  ['payments.manage', 'billing', 'Глобальные способы оплаты и ключи Digiseller'],
  ['payment_profiles.manage', 'billing', 'Создание реквизитов оплаты: шаблонов и личных для товаров'],
  ['products.payments.assign', 'billing', 'Привязка реквизитов оплаты к товарам'],

  ['resellers.read', 'resellers', 'Просмотр реселлеров, их продаж и операций по балансу'],
  ['resellers.manage', 'resellers', 'Создание и настройка реселлеров: скидка, кредит, товары, статус'],
  ['resellers.balance', 'resellers', 'Пополнение и корректировка баланса реселлера'],
  ['resellers.topups.confirm', 'resellers', 'Подтверждение и отклонение заявок реселлеров на пополнение баланса'],
  ['reseller.panel', 'resellers', 'Панель реселлера: ключи со своего баланса, свои клиенты'],

  ['launcher.manage', 'products', 'Загрузчик: выпуск версий, кому они доступны, описание страницы загрузки'],

  ['settings.read', 'system', 'Просмотр настроек'],
  ['settings.manage', 'system', 'Изменение настроек'],
  ['apikeys.manage', 'system', 'Управление API-ключами загрузчика'],

  ['audit.read', 'security', 'Журнал событий'],
  ['logins.read', 'security', 'Журнал входов'],
  ['security.ips.read', 'security', 'Адреса пользователей и поиск по IP'],
  ['security.ip_block', 'security', 'Блокировка адресов и подсетей'],
  ['security.rules.manage', 'security', 'Правила корреляции: создание, включение, разбор сработок'],
  ['security.traffic.manage', 'security', 'Приоритет трафика: доверенные адреса и пользователи, веса ролей, режим атаки'],
];

// ---------------------------------------------------------------------------
//  РОЛИ. '*' у super_admin — все права. Назначать роли может только тот, у
//  кого есть roles.assign, и только роли ниже своей по приоритету.
// ---------------------------------------------------------------------------
const ROLES: Array<{
  slug: string;
  name: string;
  description: string;
  priority: number;
  permissions: string[] | '*';
}> = [
  {
    slug: 'super_admin',
    name: 'Супер-админ',
    description: 'Все возможности, включая назначение ролей и глобальные настройки.',
    priority: 100,
    permissions: '*',
  },
  {
    slug: 'security_admin',
    name: 'Администратор безопасности',
    description: 'Журналы событий и входов, адреса пользователей, блокировка по логину и IP. Роли не меняет.',
    priority: 80,
    permissions: [
      'users.read.any',
      'users.block',
      'roles.read',
      'audit.read',
      'logins.read',
      'security.ips.read',
      'security.ip_block',
      'security.rules.manage',
      'security.traffic.manage',
      'licenses.read.any',
      'hwid.history.read',
      'orders.read.any',
    ],
  },
  {
    slug: 'product_admin',
    name: 'Администратор товаров',
    description: 'Товары, тарифы, сборки и реквизиты оплаты: шаблоны и личные для товаров.',
    priority: 70,
    permissions: [
      'products.manage',
      'plans.manage',
      'versions.read',
      'versions.manage',
      'files.upload',
      'payment_profiles.manage',
      'products.payments.assign',
      'launcher.manage',
      'licenses.read.any',
      'licenses.build.assign',
      'orders.read.any',
      'roles.read',
    ],
  },
  {
    slug: 'support',
    name: 'Поддержка',
    description: 'Заказы и оплаты, лицензии, сбросы привязки, блокировка аккаунтов. Привязывает к товарам готовые шаблоны оплаты.',
    priority: 60,
    permissions: [
      'users.read.any',
      'users.block',
      'roles.read',
      'licenses.read.any',
      'licenses.create.any',
      'licenses.extend',
      'licenses.block',
      'licenses.build.assign',
      'hwid.reset.any',
      'hwid.history.read',
      'hwid.counter.adjust',
      'orders.read.any',
      'orders.manage',
      'orders.refund',
      'products.payments.assign',
      'resellers.read',
      // Подтверждает поступления так же, как оплату заказов покупателей.
      'resellers.topups.confirm',
    ],
  },
  {
    // Реселлер — тот же пользователь (роль user остаётся), плюс панель продаж.
    // Видит только своих клиентов и свои ключи: ownership проверяет
    // ResellersService по карточке реселлера, а не по роли.
    slug: 'reseller',
    name: 'Реселлер',
    description: 'Оптовый продавец: выпускает ключи активации со своего баланса со скидкой, продлевает лицензии и сбрасывает привязку своим клиентам.',
    priority: 30,
    permissions: ['reseller.panel'],
  },
  {
    slug: 'user',
    name: 'Пользователь',
    description: 'Свои лицензии, заказы и устройства.',
    priority: 10,
    permissions: ['licenses.read.own', 'hwid.reset.self', 'orders.read.own'],
  },
];

/** Роли прежних версий: их пользователи переезжают на новую роль, сама роль удаляется. */
const RETIRED_ROLES: Record<string, string> = { admin: 'product_admin' };

// ---------------------------------------------------------------------------
//  НАСТРОЙКИ. Только те, что читает код; у каждой в коде есть запасное
//  значение, здесь они — чтобы их можно было менять из панели без деплоя.
// ---------------------------------------------------------------------------
const SETTINGS: Array<{
  key: string;
  value: unknown;
  category: string;
  isSecret?: boolean;
  description: string;
}> = [
  { key: 'app.default_locale', value: 'ru', category: 'app', description: 'Язык по умолчанию для писем' },
  { key: 'app.frontend_url', value: FRONTEND_URL, category: 'app', description: 'Адрес сайта — база для ссылок в письмах' },

  { key: 'security.argon2.memory_kib', value: 65536, category: 'security', description: 'Argon2id: память, KiB' },
  { key: 'security.argon2.time_cost', value: 3, category: 'security', description: 'Argon2id: итерации' },
  { key: 'security.argon2.parallelism', value: 1, category: 'security', description: 'Argon2id: параллелизм' },
  // Пишется в users.password_version — по ней выбираются хеши на перехеширование.
  { key: 'security.argon2.params_version', value: 1, category: 'security', description: 'Версия набора параметров Argon2' },
  { key: 'security.jwt.access_ttl_sec', value: 900, category: 'security', description: 'Срок жизни access-токена, с' },
  { key: 'security.jwt.refresh_ttl_sec', value: 2592000, category: 'security', description: 'Срок жизни refresh-токена, с' },
  { key: 'security.request_signature.window_sec', value: 300, category: 'security', description: 'Окно защиты от повтора запросов загрузчика, с' },
  { key: 'security.2fa.required_for_admin', value: true, category: 'security', description: '2FA обязательна для администраторов' },
  // Значение по умолчанию — то же, что в миграции 20261005150000_security_center
  // и в TRAFFIC_DEFAULTS (traffic-priority.service.ts).
  {
    key: 'security.traffic',
    value: {
      enabled: true,
      maxConcurrent: 128,
      queueMax: 1000,
      queueTimeoutMs: 8000,
      bypassWeight: 90,
      lagThresholdMs: 250,
      anonymousWeight: 10,
      authenticatedWeight: 30,
      roleWeights: { super_admin: 100, security_admin: 95, product_admin: 80, support: 70, reseller: 50 },
      attackMode: false,
      attackMinWeight: 50,
    },
    category: 'security',
    description: 'Приоритет трафика: лимит одновременных запросов, очередь по весам, режим атаки',
  },

  // То же значение, что в миграции 20261005170000_launcher_releases.
  {
    key: 'launcher.page',
    value: {
      requirements: 'Windows 10 или 11, 64 бита\nСвободно 300 МБ на диске\nСтабильное интернет-соединение',
      steps:
        'Скачайте установщик\nЗапустите его и следуйте подсказкам\nВойдите своим логином и паролем от кабинета\nВыберите продукт — загрузчик сам скачает и обновит его',
    },
    category: 'launcher',
    description: 'Страница загрузчика: системные требования и шаги установки',
  },

  { key: 'limits.hwid.reset_cooldown_hours', value: 24, category: 'limits', description: 'Мин. интервал между самостоятельными сбросами, ч' },
  { key: 'limits.hwid.max_total_resets', value: 3, category: 'limits', description: 'Всего самостоятельных сбросов на лицензию' },
  // Уходит в X-Recheck-After: через сколько секунд после отзыва остановится запущенный процесс.
  { key: 'limits.license.check_cache_ttl_sec', value: 300, category: 'limits', description: 'Интервал перепроверки лицензии загрузчиком, с' },
  // Мягкий порог только пишет событие антифрода, жёсткий отказывает.
  { key: 'limits.payload.soft_per_license_per_hour', value: 20, category: 'limits', description: 'Выдач payload на лицензию в час до отметки в антифроде' },
  { key: 'limits.payload.hard_per_license_per_hour', value: 60, category: 'limits', description: 'Выдач payload на лицензию в час до отказа' },
  { key: 'limits.payload.inflight_bytes_max', value: 134_217_728, category: 'limits', description: 'Байт payload в полёте одновременно' },
  { key: 'limits.payload.cache_bytes_max', value: 67_108_864, category: 'limits', description: 'Размер кэша payload в памяти процесса' },
  // Пороги вокруг ключа лицензии ловят нагрузку и проверку утёкших списков,
  // а не угадывание (16 символов из 28 — это 2^76,9 вариантов).
  { key: 'limits.license_key.fail_per_source_per_window', value: 10, category: 'limits', description: 'Различных неверных ключей с одного источника за 10 мин до отказа' },
  { key: 'limits.license_key.distinct_key_per_source_per_hour', value: 25, category: 'limits', description: 'Различных живых ключей с одного источника в час до отметки в антифроде' },
  { key: 'limits.license_key.log_per_source_per_window', value: 60, category: 'limits', description: 'Отчётов загрузчика с одного источника за 10 мин до отбрасывания' },
  { key: 'limits.license_key.distinct_hwid_per_hour', value: 3, category: 'limits', description: 'Разных устройств на ключ в час до отметки в антифроде' },
  { key: 'limits.license_key.distinct_subnet_per_hour', value: 5, category: 'limits', description: 'Разных подсетей /24 на ключ в час до отметки в антифроде' },
  { key: 'limits.digiseller.attempts_per_hour', value: 30, category: 'limits', description: 'Попыток активации покупки на пользователя в час' },
  { key: 'limits.digiseller.attempts_per_ip_per_hour', value: 60, category: 'limits', description: 'Попыток активации покупки с одного адреса в час' },
  { key: 'limits.digiseller.attempts_per_source_per_hour', value: 60, category: 'limits', description: 'Попыток активации покупки с одного источника (IP или чат) в час' },
];

// ---------------------------------------------------------------------------
//  ПРАВИЛА КОРРЕЛЯЦИИ. Примеры, создаются ВЫКЛЮЧЕННЫМИ и только если правила
//  с таким названием ещё нет: дальше их правит администратор безопасности,
//  повторный сид не трогает ни пороги, ни включённость.
// ---------------------------------------------------------------------------
const CORRELATION_RULES: Array<{
  name: string;
  description: string;
  source: 'LOGINS' | 'AUDIT';
  query: string;
  groupBy: string;
  distinctField?: string;
  threshold: number;
  windowMinutes: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  action: 'ALERT' | 'BLOCK_IP' | 'BLOCK_USER';
  blockLevel?: 'APP' | 'EDGE' | 'FIREWALL';
  blockPorts?: number[];
  blockHours?: number;
  cooldownMinutes?: number;
}> = [
  {
    name: 'Перебор паролей с одного адреса',
    description: '20 неудачных входов за 10 минут с одного IP — блок на nginx на сутки.',
    source: 'LOGINS',
    query: 'result:failed',
    groupBy: 'ip',
    threshold: 20,
    windowMinutes: 10,
    severity: 'HIGH',
    action: 'BLOCK_IP',
    blockLevel: 'EDGE',
    blockHours: 24,
  },
  {
    name: 'Подбор учёток по списку (credential stuffing)',
    description: 'С одного IP за 15 минут пробуют 5+ разных логинов — сброс пакетов на фаерволе по веб-портам на 3 дня.',
    source: 'LOGINS',
    query: 'result:failed',
    groupBy: 'ip',
    distinctField: 'user',
    threshold: 5,
    windowMinutes: 15,
    severity: 'CRITICAL',
    action: 'BLOCK_IP',
    blockLevel: 'FIREWALL',
    blockPorts: [80, 443],
    blockHours: 72,
  },
  {
    name: 'Атака на одну учётку с разных адресов',
    description: 'Неудачные входы в один аккаунт с 5+ адресов за 30 минут — распределённый перебор.',
    source: 'LOGINS',
    query: 'result:failed',
    groupBy: 'user',
    distinctField: 'ip',
    threshold: 5,
    windowMinutes: 30,
    severity: 'HIGH',
    action: 'ALERT',
  },
  {
    name: 'Входы из нескольких стран за сутки',
    description: 'Успешные входы в один аккаунт из 3+ стран за 24 часа — похоже на передачу учётки.',
    source: 'LOGINS',
    query: 'result:success',
    groupBy: 'user',
    distinctField: 'country',
    threshold: 3,
    windowMinutes: 1440,
    severity: 'MEDIUM',
    action: 'ALERT',
    cooldownMinutes: 720,
  },
  {
    name: 'Массовые блокировки пользователей',
    description: 'Один сотрудник заблокировал 20+ аккаунтов за 10 минут — проверить, не скомпрометирован ли он.',
    source: 'AUDIT',
    query: 'action:user.block',
    groupBy: 'actor',
    threshold: 20,
    windowMinutes: 10,
    severity: 'HIGH',
    action: 'ALERT',
  },
];

// ---------------------------------------------------------------------------
//  СПОСОБЫ ОПЛАТЫ. Создаются один раз выключенными; дальше их настраивает
//  администратор в панели, повторный сид ничего не трогает. Digiseller
//  включается сразу, если его ключи уже заданы в окружении (старые установки).
// ---------------------------------------------------------------------------
const PAYMENT_METHODS = [
  {
    provider: 'DIGISELLER' as const,
    title: 'Digiseller',
    description: 'Оплата на площадке Digiseller, затем активация кода покупки',
    sortOrder: 30,
    enabled: Boolean(process.env.DIGISELLER_SELLER_ID && process.env.DIGISELLER_API_KEY),
    config: { minAmountRatio: 0.5, pollWindowHours: 336 },
  },
  // Реквизиты ЮKassa и крипты — в шаблонах и у товаров (payment_profiles).
  {
    provider: 'YOOKASSA' as const,
    title: 'Банковская карта или СБП',
    description: 'Оплата через ЮKassa, лицензия выдаётся сразу после оплаты',
    sortOrder: 10,
    enabled: false,
    config: {},
  },
  {
    provider: 'CRYPTO' as const,
    title: 'Криптовалюта',
    description: 'Перевод на кошелёк, лицензия — после проверки платежа',
    sortOrder: 20,
    enabled: false,
    config: {},
  },
];

// ---------------------------------------------------------------------------
//  ШАБЛОНЫ УВЕДОМЛЕНИЙ. Плейсхолдеры совпадают с payload на местах вызова.
//  В Telegram — только {{maskedKey}}, никогда полный ключ: переписка живёт
//  в облаке (гарантию даёт sanitizeTelegramPayload, не этот комментарий).
// ---------------------------------------------------------------------------
type Template = { key: string; locale: 'ru' | 'en'; channel: 'EMAIL' | 'TELEGRAM'; subject: string | null; body: string };

const email = (key: string, locale: 'ru' | 'en', subject: string, body: string): Template => ({
  key, locale, channel: 'EMAIL', subject, body,
});
const telegram = (key: string, locale: 'ru' | 'en', body: string): Template => ({
  key, locale, channel: 'TELEGRAM', subject: null, body,
});

const NOTIFICATION_TEMPLATES: Template[] = [
  email('auth.email_verify', 'ru', 'Подтвердите адрес электронной почты',
    'Здравствуйте, {{username}}!\n\nДля завершения регистрации перейдите по ссылке:\n{{verifyUrl}}\n\nСсылка действует 24 часа.\n\nЕсли вы не регистрировались — просто проигнорируйте это письмо.'),
  email('auth.email_verify', 'en', 'Confirm your email address',
    'Hi {{username}},\n\nFollow this link to finish signing up:\n{{verifyUrl}}\n\nThe link is valid for 24 hours.\n\nIf you did not sign up, just ignore this email.'),
  email('auth.password_reset', 'ru', 'Сброс пароля',
    'Здравствуйте, {{username}}!\n\nДля смены пароля перейдите по ссылке:\n{{resetUrl}}\n\nСсылка действует 1 час и сработает только один раз.\n\nЕсли вы не запрашивали сброс — проигнорируйте это письмо, пароль останется прежним. Если такие письма приходят регулярно, включите двухфакторную аутентификацию.'),
  email('auth.password_reset', 'en', 'Password reset',
    'Hi {{username}},\n\nFollow this link to change your password:\n{{resetUrl}}\n\nThe link is valid for 1 hour and works only once.\n\nIf you did not request a reset, ignore this email — your password stays unchanged.'),
  // Смена почты: ссылка уходит на НОВЫЙ адрес, уведомление — на старый.
  email('auth.email_change', 'ru', 'Подтвердите новый адрес почты',
    'Здравствуйте, {{username}}!\n\nВы указали этот адрес как новую почту аккаунта. Чтобы подтвердить смену, перейдите по ссылке:\n{{confirmUrl}}\n\nСсылка действует 24 часа. Если это были не вы — просто проигнорируйте письмо.'),
  email('auth.email_change', 'en', 'Confirm your new email address',
    'Hi {{username}},\n\nYou set this address as the new email for your account. Follow this link to confirm the change:\n{{confirmUrl}}\n\nThe link is valid for 24 hours. If it was not you, just ignore this email.'),
  email('auth.email_changed', 'ru', 'Почта аккаунта изменена',
    'Здравствуйте, {{username}}!\n\nПочта вашего аккаунта изменена на {{newEmail}}.\n\nЕсли это сделали не вы — немедленно сбросьте пароль и напишите в поддержку.'),
  email('auth.email_changed', 'en', 'Your account email was changed',
    'Hi {{username}},\n\nThe email for your account was changed to {{newEmail}}.\n\nIf this was not you, reset your password right away and contact support.'),
  email('auth.username_changed', 'ru', 'Логин аккаунта изменён',
    'Здравствуйте!\n\nЛогин вашего аккаунта изменён: {{oldUsername}} → {{newUsername}}. Входите с новым логином.\n\nЕсли это сделали не вы — немедленно смените пароль.'),
  email('auth.username_changed', 'en', 'Your username was changed',
    'Hi,\n\nYour username was changed: {{oldUsername}} → {{newUsername}}. Use the new one to sign in.\n\nIf this was not you, change your password right away.'),

  email('license.issued', 'ru', 'Лицензия {{productName}} активирована',
    'Здравствуйте, {{username}}!\n\nЛицензия на {{productName}} ({{planName}}) выдана.\nЗаказ: {{orderNumber}}\n\nКлюч лицензии: {{licenseKey}}\nЕго нужно ввести в загрузчике при запуске.\n\nСрок действия: {{expiresAt}}'),
  email('license.issued', 'en', '{{productName}} license activated',
    'Hi {{username}},\n\nYour {{productName}} license ({{planName}}) has been issued.\nOrder: {{orderNumber}}\n\nLicense key: {{licenseKey}}\nEnter it in the launcher when it starts.\n\nValid: {{expiresAt}}'),
  telegram('license.issued', 'ru',
    '🟢 <b>{{productName}}</b> · {{planName}}\nЛицензия выдана. Ключ: <code>{{maskedKey}}</code>\nЗаказ: {{orderNumber}}\n\nПолный ключ — в письме и в разделе «Мои лицензии»: /licenses'),
  telegram('license.issued', 'en',
    '🟢 <b>{{productName}}</b> · {{planName}}\nLicense issued. Key: <code>{{maskedKey}}</code>\nOrder: {{orderNumber}}\n\nThe full key is in the email and under “My licenses”: /licenses'),

  email('license.expiring', 'ru', 'Лицензия {{productName}} истекает через {{daysLeft}} дн.',
    'Здравствуйте, {{username}}!\n\nВаша лицензия на {{productName}} истекает {{expiresAt}}.\nПродлить: {{renewUrl}}'),
  email('license.expiring', 'en', '{{productName}} license expires in {{daysLeft}} days',
    'Hi {{username}},\n\nYour {{productName}} license expires on {{expiresAt}}.\nRenew: {{renewUrl}}'),
  telegram('license.expiring', 'ru',
    '⏳ Лицензия на <b>{{productName}}</b> истекает через {{daysLeft}} дн. — {{expiresAt}}.\n\nПродление — это новая покупка. Каталог: /products'),
  telegram('license.expiring', 'en',
    '⏳ Your <b>{{productName}}</b> license expires in {{daysLeft}} day(s) — {{expiresAt}}.\n\nRenewal means a new purchase. Catalogue: /products'),

  email('license.revoked', 'ru', 'Доступ к {{productName}} отозван',
    'Здравствуйте, {{username}}!\n\nЛицензия на {{productName}} отозвана.\nПричина: {{reason}}.\n\nЕсли вы считаете это ошибкой — ответьте на это письмо.'),
  email('license.revoked', 'en', '{{productName}} access revoked',
    'Hi {{username}},\n\nYour {{productName}} license has been revoked.\nReason: {{reason}}.\n\nIf you believe this is a mistake, reply to this email.'),
  telegram('license.revoked', 'ru',
    '⚫️ Лицензия на <b>{{productName}}</b> отозвана.\nКлюч: <code>{{maskedKey}}</code>\nПричина: {{reason}}\n\nСчитаете это ошибкой — напишите нам: /support'),
  telegram('license.revoked', 'en',
    '⚫️ Your <b>{{productName}}</b> license has been revoked.\nKey: <code>{{maskedKey}}</code>\nReason: {{reason}}\n\nIf you believe this is a mistake, write to us: /support'),

  email('hwid.reset', 'ru', 'Привязка к устройству сброшена',
    'Привязка лицензии {{licenseKey}} сброшена {{resetAt}} (инициатор: {{actor}}).\nОсталось сбросов: {{resetsLeft}}.\n\nЕсли это были не вы — немедленно смените пароль.'),
  email('hwid.reset', 'en', 'Device binding reset',
    'The device binding for license {{licenseKey}} was reset on {{resetAt}} by {{actor}}.\nResets left: {{resetsLeft}}.\n\nIf this was not you, change your password immediately.'),
  telegram('hwid.reset', 'ru',
    '🔓 Привязка к компьютеру сброшена {{resetAt}}.\nКлюч: <code>{{maskedKey}}</code>\nОсталось сбросов: {{resetsLeft}}\n\nЕсли это были не вы — смените пароль на сайте.'),
  telegram('hwid.reset', 'en',
    '🔓 Device binding reset on {{resetAt}}.\nKey: <code>{{maskedKey}}</code>\nResets left: {{resetsLeft}}\n\nIf this was not you, change your password on the website.'),

  // Письма о привязке бота уходят всегда: почта — единственный якорь
  // восстановления. {{username}} здесь — @username Telegram, а не логин.
  email('telegram.linked', 'ru', 'Telegram-бот подключён к аккаунту',
    'К вашему аккаунту подключён Telegram-бот.\nЧат: {{username}}\nПривязка действует до: {{expiresAt}}\n\nЕсли это были не вы — отключите бота в кабинете (Аккаунт → Telegram) и смените пароль. Бот не умеет менять пароль и отключать 2FA, но видит ваши лицензии и умеет сбрасывать привязку к компьютеру.'),
  email('telegram.linked', 'en', 'Telegram bot connected to your account',
    'A Telegram bot has been connected to your account.\nChat: {{username}}\nThe link is valid until: {{expiresAt}}\n\nIf this was not you, disconnect the bot in your cabinet (Account → Telegram) and change your password. The bot cannot change your password or disable 2FA, but it does see your licenses and can reset device bindings.'),
  telegram('telegram.linked', 'ru',
    '🔗 Бот подключён к вашему аккаунту. Чат: <b>{{username}}</b>\nПривязка действует до {{expiresAt}}.\n\nПодключали не вы — отключите бота командой /unlink и смените пароль на сайте.'),
  telegram('telegram.linked', 'en',
    '🔗 The bot is connected to your account. Chat: <b>{{username}}</b>\nThe link is valid until {{expiresAt}}.\n\nIf this was not you, disconnect with /unlink and change your password on the website.'),

  email('telegram.unlinked', 'ru', 'Telegram-бот отключён от аккаунта',
    'Telegram-бот отключён от вашего аккаунта.\nПричина: {{reason}}\n\nКоды причин:\n· user_request — команда /unlink в чате\n· site_request — отключение в кабинете\n· evicted — подключили другой чат\n· expired — истёк срок привязки\n· chat_not_found — чат удалён\n\nЕсли отключали не вы — подключите бота заново в кабинете и смените пароль.'),
  email('telegram.unlinked', 'en', 'Telegram bot disconnected from your account',
    'The Telegram bot has been disconnected from your account.\nReason: {{reason}}\n\nReason codes:\n· user_request — /unlink in the chat\n· site_request — disconnected in the cabinet\n· evicted — another chat was connected\n· expired — the link expired\n· chat_not_found — the chat no longer exists\n\nIf this was not you, reconnect the bot in your cabinet and change your password.'),
  telegram('telegram.unlinked', 'ru',
    '🚫 Бот отключён от вашего аккаунта.\nПричина: {{reason}}\n\nПодключить заново можно только на сайте: Аккаунт → Telegram.'),
  telegram('telegram.unlinked', 'en',
    '🚫 The bot has been disconnected from your account.\nReason: {{reason}}\n\nYou can reconnect only on the website: Account → Telegram.'),

  email('telegram.link_expiring', 'ru', 'Привязка Telegram истекает {{expiresAt}}',
    'Привязка Telegram-бота к вашему аккаунту истекает {{expiresAt}} — осталось дней: {{daysLeft}}.\n\nСама она не продлевается. Продлить можно в кабинете: Аккаунт → Telegram.'),
  email('telegram.link_expiring', 'en', 'Your Telegram link expires on {{expiresAt}}',
    'The Telegram bot link for your account expires on {{expiresAt}} — {{daysLeft}} day(s) left.\n\nIt is never renewed silently. Renew it in your cabinet: Account → Telegram.'),
  telegram('telegram.link_expiring', 'ru',
    '⌛️ Привязка Telegram истекает {{expiresAt}} — осталось дней: {{daysLeft}}.\n\nСама она не продлевается. Продлить: Аккаунт → Telegram на сайте.'),
  telegram('telegram.link_expiring', 'en',
    '⌛️ Your Telegram link expires on {{expiresAt}} — {{daysLeft}} day(s) left.\n\nIt is never renewed silently. Renew it under Account → Telegram on the website.'),

  email('order.rejected', 'ru', 'Оплата заказа {{orderNumber}} не подтверждена',
    'Оплата заказа {{orderNumber}} ({{productName}}) не подтверждена.\nПричина: {{reason}}\n\nЕсли вы уверены, что оплатили, — ответьте на это письмо и приложите данные перевода.'),
  email('order.rejected', 'en', 'Payment for order {{orderNumber}} was not confirmed',
    'Payment for order {{orderNumber}} ({{productName}}) was not confirmed.\nReason: {{reason}}\n\nIf you are sure you paid, reply to this email with the transfer details.'),

  // Алерт администраторам: оплату нужно подтвердить руками (крипта по адресу).
  email('order.awaiting_confirmation', 'ru', 'Заказ {{orderNumber}} ждёт подтверждения оплаты',
    'Заказ {{orderNumber}}: {{productName}} ({{planName}}), {{amount}} {{currency}}.\nСпособ оплаты: {{method}}\n{{details}}\n\nПроверьте поступление и подтвердите заказ: {{adminUrl}}'),
  email('order.awaiting_confirmation', 'en', 'Order {{orderNumber}} awaits payment confirmation',
    'Order {{orderNumber}}: {{productName}} ({{planName}}), {{amount}} {{currency}}.\nPayment method: {{method}}\n{{details}}\n\nCheck the payment and confirm the order: {{adminUrl}}'),
  telegram('order.awaiting_confirmation', 'ru',
    '🧾 Заказ <b>{{orderNumber}}</b> ждёт подтверждения\n{{productName}} · {{planName}} · {{amount}} {{currency}}\nСпособ: {{method}}\n{{details}}\n\nПодтвердить: {{adminUrl}}'),
  telegram('order.awaiting_confirmation', 'en',
    '🧾 Order <b>{{orderNumber}}</b> awaits confirmation\n{{productName}} · {{planName}} · {{amount}} {{currency}}\nMethod: {{method}}\n{{details}}\n\nConfirm: {{adminUrl}}'),

  // Алерт тем, кто подтверждает пополнения реселлеров.
  email('reseller.topup.awaiting', 'ru', 'Реселлер {{resellerName}} пополняет баланс на {{amount}} {{currency}}',
    'Реселлер {{resellerName}} сообщил о переводе: {{method}}\n{{details}}\n\nПроверьте поступление и подтвердите пополнение: {{adminUrl}}'),
  email('reseller.topup.awaiting', 'en', 'Reseller {{resellerName}} tops up {{amount}} {{currency}}',
    'Reseller {{resellerName}} reported a transfer: {{method}}\n{{details}}\n\nCheck the payment and confirm the top-up: {{adminUrl}}'),
  telegram('reseller.topup.awaiting', 'ru',
    '💰 Реселлер <b>{{resellerName}}</b> пополняет баланс на {{amount}} {{currency}}\nСпособ: {{method}}\n{{details}}\n\nПодтвердить: {{adminUrl}}'),
  telegram('reseller.topup.awaiting', 'en',
    '💰 Reseller <b>{{resellerName}}</b> tops up {{amount}} {{currency}}\nMethod: {{method}}\n{{details}}\n\nConfirm: {{adminUrl}}'),
  email('reseller.topup.confirmed', 'ru', 'Баланс пополнен на {{amount}} {{currency}}',
    'Пополнение подтверждено: зачислено {{amount}} {{currency}}. Баланс: {{balance}} {{currency}}.'),
  email('reseller.topup.confirmed', 'en', 'Your balance was topped up by {{amount}} {{currency}}',
    'The top-up is confirmed: {{amount}} {{currency}} credited. Balance: {{balance}} {{currency}}.'),
  email('reseller.topup.rejected', 'ru', 'Пополнение баланса не подтверждено',
    'Заявка на пополнение на {{amount}} {{currency}} не подтверждена.\nПричина: {{reason}}\n\nЕсли вы уверены, что перевели деньги, — ответьте на это письмо и приложите данные перевода.'),
  email('reseller.topup.rejected', 'en', 'Your top-up was not confirmed',
    'The top-up request for {{amount}} {{currency}} was not confirmed.\nReason: {{reason}}\n\nIf you are sure you paid, reply to this email with the transfer details.'),
];

// ===========================================================================

async function main() {
  console.log(`· permissions (${PERMISSIONS.length})`);
  for (const [slug, group, description] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { slug },
      update: { group, description },
      create: { id: uuidv7(), slug, group, description },
    });
  }
  // Права, убранные из списка выше, удаляются вместе с привязками к ролям.
  await prisma.permission.deleteMany({
    where: { slug: { notIn: PERMISSIONS.map(([slug]) => slug) } },
  });
  const allPermissions = await prisma.permission.findMany();
  const permissionBySlug = new Map(allPermissions.map((p) => [p.slug, p.id]));

  console.log(`· roles (${ROLES.length})`);
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { slug: r.slug },
      update: { name: r.name, description: r.description, priority: r.priority, isSystem: true },
      create: {
        id: uuidv7(),
        slug: r.slug,
        name: r.name,
        description: r.description,
        priority: r.priority,
        isSystem: true,
      },
    });

    // '*' — все права, кроме панели реселлера: это не полномочие, а признак
    // «у аккаунта есть своя торговая точка», и без карточки реселлера панель
    // у администратора была бы пустой.
    const slugs =
      r.permissions === '*'
        ? allPermissions.map((p) => p.slug).filter((s) => s !== 'reseller.panel')
        : r.permissions;
    // Набор прав роли пересобирается целиком.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: slugs
        .map((s) => permissionBySlug.get(s))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  for (const [retired, replacement] of Object.entries(RETIRED_ROLES)) {
    const old = await prisma.role.findUnique({ where: { slug: retired }, include: { users: true } });
    if (!old) continue;
    const target = await prisma.role.findUniqueOrThrow({ where: { slug: replacement } });
    await prisma.userRole.createMany({
      data: old.users.map((u) => ({ userId: u.userId, roleId: target.id, grantedById: u.grantedById })),
      skipDuplicates: true,
    });
    await prisma.role.delete({ where: { id: old.id } });
    console.log(`  роль ${retired} заменена на ${replacement} (${old.users.length} польз.)`);
  }

  console.log(`· settings (${SETTINGS.length})`);
  // Ключи, которые код больше не читает, иначе висели бы в панели настроек.
  await prisma.setting.deleteMany({ where: { key: { notIn: SETTINGS.map((s) => s.key) } } });
  for (const s of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { category: s.category, description: s.description, isSecret: s.isSecret ?? false },
      // value не обновляем: повторный сид не должен затирать правки из панели.
      create: {
        id: uuidv7(),
        key: s.key,
        value: s.value as never,
        category: s.category,
        isSecret: s.isSecret ?? false,
        description: s.description,
      },
    });
  }

  console.log(`· correlation rules (${CORRELATION_RULES.length})`);
  for (const rule of CORRELATION_RULES) {
    const exists = await prisma.correlationRule.findFirst({ where: { name: rule.name }, select: { id: true } });
    if (exists) continue;
    await prisma.correlationRule.create({
      data: { id: uuidv7(), enabled: false, ...rule, distinctField: rule.distinctField ?? null, blockHours: rule.blockHours ?? null },
    });
  }

  console.log(`· payment methods (${PAYMENT_METHODS.length})`);
  for (const m of PAYMENT_METHODS) {
    await prisma.paymentMethodConfig.upsert({
      where: { provider: m.provider },
      update: {},
      create: m,
    });
  }

  console.log('· super admin');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@license-platform.local';

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    // Существующего админа не трогаем: пароль меняют в панели, не сидом.
    update: {},
    create: {
      id: uuidv7(),
      username: 'admin',
      email: adminEmail,
      passwordHash: await hash(adminPassword, ARGON2_OPTS),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      locale: 'ru',
    },
  });

  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { slug: 'super_admin' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: superAdminRole.id },
  });

  console.log(`· notification templates (${NOTIFICATION_TEMPLATES.length})`);
  // Шаблоны принадлежат сиду: снятые отсюда удаляются и из базы.
  const templateIds = new Set(NOTIFICATION_TEMPLATES.map((t) => `${t.key}|${t.locale}|${t.channel}`));
  const stale = (await prisma.notificationTemplate.findMany({ select: { id: true, key: true, locale: true, channel: true } }))
    .filter((t) => !templateIds.has(`${t.key}|${t.locale}|${t.channel}`));
  await prisma.notificationTemplate.deleteMany({ where: { id: { in: stale.map((t) => t.id) } } });
  for (const t of NOTIFICATION_TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { key_locale_channel: { key: t.key, locale: t.locale, channel: t.channel } },
      update: { subject: t.subject, body: t.body },
      create: { id: uuidv7(), ...t },
    });
  }

  await prisma.auditLog.create({
    data: {
      id: uuidv7(),
      actorType: ActorType.SYSTEM,
      actorLabel: 'seed',
      action: 'system.seed',
      after: { seededAt: new Date().toISOString() },
    },
  });

  console.log('\n✓ seed завершён');
  console.log(`  логин:  admin`);
  console.log(`  email:  ${adminEmail}`);
  console.log(`  пароль: ${adminPassword}  (если админ уже был — пароль прежний)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
