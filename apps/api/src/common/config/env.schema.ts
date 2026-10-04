import { z } from 'zod';

/**
 * Схема переменных окружения.
 *
 * Проверяется один раз при старте приложения. Если конфигурация неверна,
 * процесс не поднимается вообще — это намеренно. Альтернатива хуже:
 * приложение стартует, работает, а в три часа ночи первый запрос на сброс
 * пароля падает, потому что SMTP_HOST оказался пустой строкой.
 *
 * Отдельно проверяется, что криптографические секреты не остались
 * дефолтными из .env.example — самая частая ошибка при первом деплое.
 */

const hex32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'должен быть 64 hex-символа (openssl rand -hex 32)');

const placeholderPattern = /^CHANGE_ME/i;

/**
 * Потолок открытого текста payload'а §12 — 8 МиБ.
 *
 * Константа, а не свободная настройка: ровно это же число зашито в клиенте
 * (Platform/Config.h, kMaxPayloadResponseBytes), и загрузчик его не читает
 * ниоткуда. Поднять значение на сервере значит получить ответ, который
 * клиент оборвёт на своём капе с «повреждёнными данными», — расхождение
 * бесшумное. Поэтому PAYLOAD_MAX_BYTES из окружения можно только ОПУСТИТЬ:
 * верхняя граница закреплена схемой.
 */
export const MAX_PAYLOAD_PLAINTEXT_BYTES = 8 * 1024 * 1024;

/**
 * Разбор булева значения из окружения.
 *
 * z.coerce.boolean() здесь непригоден: под капотом это Boolean(value),
 * а непустая строка истинна — значит SMTP_SECURE=false превращается
 * в true. Ошибка тихая и проявляется далеко от места: nodemailer поднимает
 * TLS на открытом порту и падает с «wrong version number», что выглядит
 * как проблема сети, а не конфигурации.
 *
 * Неизвестные значения отвергаем, а не считаем ложью: опечатка вроде
 * SMTP_SECURE=ture должна останавливать старт, а не молча выключать TLS.
 */
const boolFromEnv = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      if (typeof value === 'boolean') return value;

      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ожидалось true/false, получено "${value}"`,
      });
      return z.NEVER;
    });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_URL: z.string().url(),
    FRONTEND_URL: z.string().url(),

    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_URL: z.string().startsWith('redis://'),

    // --- Криптография ---------------------------------------------------
    // Сроки жизни токенов живут в settings (auth.*), а не здесь.
    JWT_SECRET: z.string().min(32),

    /**
     * Соль хеширования HWID. Менять после запуска в прод нельзя: все
     * существующие привязки станут несопоставимыми, и каждый пользователь
     * одновременно получит «устройство не совпадает».
     */
    HWID_PEPPER: hex32,

    /**
     * Текущий ключ шифрования полей БД. Им шифруются все новые записи.
     */
    ENCRYPTION_KEY: hex32,
    /**
     * Номер версии текущего ключа. Пишется в колонки *_key_ver рядом
     * с зашифрованным значением.
     */
    ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    /**
     * Выведенные из обращения ключи в формате "1:hex,2:hex".
     * Используются ТОЛЬКО для расшифровки старых записей.
     *
     * Ротация выглядит так: старый ключ переезжает сюда, в ENCRYPTION_KEY
     * кладётся новый, ENCRYPTION_KEY_VERSION увеличивается. Сервис при этом
     * не останавливается — старые записи продолжают читаться, а фоновая
     * задача перешифровывает их по мере обращения.
     */
    ENCRYPTION_KEYS_RETIRED: z
      .string()
      .regex(
        /^(\d+:[0-9a-fA-F]{64})(,\d+:[0-9a-fA-F]{64})*$/,
        'формат "версия:hex64" через запятую, например "1:ab12…,2:cd34…"',
      )
      .optional(),

    // --- Argon2id -------------------------------------------------------
    // Главный потребитель CPU при логине. Значения ниже рекомендованных
    // OWASP (19 МБ / t=2) не пропускаем — при 64 МБ и t=3 один хеш занимает
    // около 70 мс, и именно от этого числа считается размер сервера.
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

    // --- S3 -------------------------------------------------------------
    /** Адрес хранилища для самого сервера. В контейнере — http://s3:9000. */
    S3_ENDPOINT: z.string().url(),
    /**
     * Адрес, для которого подписываются presigned-ссылки, уходящие наружу.
     * Подпись привязана к хосту, поэтому он обязан открываться из браузера.
     * Не задан — используется S3_ENDPOINT (разработка, где адрес один).
     */
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_BUCKET_RELEASES: z.string().min(1),
    /**
     * Бакет payload'а §7. Обязательно отдельный от releases: на releases
     * выдаются presigned-ссылки, на payload — никогда, и запрет в
     * StorageService держится на различии имён (проверяется ниже).
     */
    S3_BUCKET_PAYLOADS: z.string().min(1).default('payloads'),
    S3_FORCE_PATH_STYLE: boolFromEnv(true),

    /**
     * Таймауты S3-клиента. Без них @smithy/node-http-handler работает
     * с requestTimeout = 0 («ждать вечно»), и хранилище, принимающее
     * соединение, но не отвечающее, подвешивает запрос навсегда.
     * connect держим коротким: успешное соединение с хранилищем занимает
     * миллисекунды, а секунды ожидания здесь означают, что узел мёртв.
     */
    S3_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3_000),
    S3_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    /**
     * Общий дедлайн на чтение объекта целиком: head + get + вычитывание
     * тела. Отдельно от S3_REQUEST_TIMEOUT_MS, потому что таймаут запроса
     * у smithy заканчивается на получении ответа и НЕ покрывает цикл
     * чтения стрима — хранилище, отдающее по байту в минуту, проходит
     * мимо него незамеченным.
     */
    S3_READ_DEADLINE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),

    // --- SMTP -----------------------------------------------------------
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: boolFromEnv(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().min(1),

    /**
     * Подпись писем DKIM.
     *
     * ЗАЧЕМ. Gmail с 2024 года не принимает письма вовсе, если отправитель
     * не прошёл ни SPF, ни DKIM — проверено живой отправкой, отказ
     * «550 5.7.26 sender is unauthenticated». Одного SPF хватает, чтобы
     * письмо приняли, но не хватает, чтобы оно легло во «Входящие»: тоже
     * проверено, легло в «Спам». А от доставки письма зависит регистрация.
     *
     * Подписывает сам nodemailer — отдельный демон (opendkim) не нужен.
     *
     * Все три поля необязательные и работают только вместе: заполнены —
     * письма подписываются, пусты — уходят как раньше. Так локальная
     * разработка с почтовой ловушкой не требует ключей.
     */
    DKIM_DOMAIN: z.string().optional(),
    /**
     * Селектор — имя ключа. Позволяет держать несколько ключей сразу и
     * менять их без простоя: публикуешь второй под новым селектором,
     * переключаешь отправку, потом убираешь старый.
     * Ищется в DNS как <селектор>._domainkey.<домен>.
     */
    DKIM_SELECTOR: z.string().optional(),
    /**
     * Закрытый ключ в PEM. Переводы строк допускаются как \n — в .env
     * многострочное значение хранить нельзя, поэтому оно разворачивается
     * при чтении (см. mail.service.ts).
     */
    DKIM_PRIVATE_KEY: z.string().optional(),

    // --- Digiseller -----------------------------------------------------
    // Единственный платёжный канал (уточнение У-1). На старте могут быть
    // пустыми: до первой продажи система работает и без них.
    DIGISELLER_SELLER_ID: z.string().optional(),
    DIGISELLER_API_KEY: z.string().optional(),
    DIGISELLER_API_BASE: z.string().url().default('https://api.digiseller.com'),
    DIGISELLER_TOKEN_CACHE_TTL: z.coerce.number().int().default(6600),

    // --- OAuth ----------------------------------------------------------
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    DISCORD_REDIRECT_URI: z.string().url().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),

    // --- Telegram-бот ---------------------------------------------------
    // Токен и username выше общие с Login Widget: Bot API и виджет
    // используют один и тот же токен, второго заводить негде.

    /**
     * Рубильник бота. При false модуль не принимает апдейты и не шлёт
     * сообщений — вебхук отвечает 404, обработчик очереди не просыпается.
     *
     * boolFromEnv, а не z.coerce.boolean(): последний считает истиной любую
     * непустую строку, то есть TELEGRAM_BOT_ENABLED=false включил бы бота.
     */
    TELEGRAM_BOT_ENABLED: boolFromEnv(false),
    /**
     * Секрет ПУТИ вебхука. Это НЕ токен бота: 32 байта CSPRNG
     * в base64url (openssl rand -base64 32 | tr '+/' '-_' | tr -d '=').
     */
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    /**
     * Секрет ЗАГОЛОВКА X-Telegram-Bot-Api-Secret-Token. Отдельное случайное
     * значение, НЕ копия предыдущего: путь попадает в логи прокси, заголовок — нет.
     */
    TELEGRAM_WEBHOOK_HEADER_SECRET: z.string().optional(),
    /**
     * Чат владельца (группа) для алертов и тредов поддержки. У группы
     * идентификатор отрицательный, поэтому строка, а не число: разбирается
     * в bigint (см. TelegramBotConfig.adminChatId).
     *
     * Именно группа, а не личный чат: она переживает потерю доступа
     * к одному аккаунту и допускает второго администратора.
     */
    TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),

    // --- Payload §7 -----------------------------------------------------
    // Значения по умолчанию для горячего пути выдачи payload'а. Пороги
    // выдач на лицензию живут в settings (limits.payload.*) — их меняют
    // без перезапуска; здесь только то, что задаёт РАЗМЕР потребляемой
    // памяти, то есть определяется сайзингом контейнера, а не бизнесом.

    /** Потолок открытого текста. Опустить можно, поднять выше §12 — нет (см. константу). */
    PAYLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAYLOAD_PLAINTEXT_BYTES)
      .default(MAX_PAYLOAD_PLAINTEXT_BYTES),

    /**
     * Суммарный объём LRU открытых payload'ов в памяти процесса.
     * Ограничение по БАЙТАМ, а не по числу записей: «LRU на 100 записей»
     * при потолке 8 МиБ — это 800 МБ RSS, о которых никто не думал.
     * 0 выключает удержание в кэше (single-flight при этом работает).
     */
    PAYLOAD_CACHE_MAX_BYTES: z.coerce.number().int().min(0).default(64 * 1024 * 1024),
    /**
     * Страховочный TTL записи кэша. 60 секунд взяты по прецеденту
     * settings.service: инвалидация идёт через Redis pub/sub, а он
     * at-most-once — реплика, переподключавшаяся в момент публикации,
     * сообщение теряет молча, и TTL остаётся единственным backstop'ом.
     */
    PAYLOAD_CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    /**
     * Байтовый бюджет одновременных выдач (admission control).
     * По байтам, а не по числу запросов: 200 запросов по 600 КБ и 200 по
     * 3 МБ различаются в пять раз, и один числовой лимит означал бы
     * разное потребление памяти.
     */
    PAYLOAD_INFLIGHT_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024 * 1024)
      .default(128 * 1024 * 1024),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // В проде дефолтные значения из .env.example — это готовая
    // компрометация: они лежат в git и известны всем.
    const secrets = {
      JWT_SECRET: env.JWT_SECRET,
      HWID_PEPPER: env.HWID_PEPPER,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
    };

    for (const [key, value] of Object.entries(secrets)) {
      if (placeholderPattern.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `в production нельзя оставлять значение из .env.example — сгенерируй: openssl rand -hex 32`,
        });
      }
    }

    if (env.HWID_PEPPER === env.ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HWID_PEPPER'],
        message: 'HWID_PEPPER и ENCRYPTION_KEY должны быть разными: компрометация одного не должна вскрывать второе',
      });
    }
  })
  .superRefine((env, ctx) => {
    // Запрет presigned-ссылок на payload отбивает по ИМЕНИ бакета, поэтому
    // совпадение с releases сняло бы защиту.
    if (env.S3_BUCKET_PAYLOADS === env.S3_BUCKET_RELEASES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET_PAYLOADS'],
        message: 'бакет payload должен отличаться от S3_BUCKET_RELEASES (ТЗ §7.1)',
      });
    }

    // Бюджет меньше одного объекта — это вечный 503 на каждом запросе:
    // ни одна выдача не поместится в допуск, и обнаружится это только
    // в бою, потому что на пустом стенде запросов нет вовсе.
    if (env.PAYLOAD_INFLIGHT_MAX_BYTES < env.PAYLOAD_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYLOAD_INFLIGHT_MAX_BYTES'],
        message: `бюджет выдач (${env.PAYLOAD_INFLIGHT_MAX_BYTES}) меньше одного payload'а (${env.PAYLOAD_MAX_BYTES}) — ни один запрос не пройдёт допуск`,
      });
    }

    // 0 — осознанное «кэш выключен». А вот ненулевое значение меньше
    // одного объекта означает кэш, который никогда ничего не удержит:
    // выглядит настроенным, промахивается всегда.
    if (env.PAYLOAD_CACHE_MAX_BYTES > 0 && env.PAYLOAD_CACHE_MAX_BYTES < env.PAYLOAD_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYLOAD_CACHE_MAX_BYTES'],
        message: `кэш (${env.PAYLOAD_CACHE_MAX_BYTES}) меньше одного payload'а (${env.PAYLOAD_MAX_BYTES}) — ни одна запись не поместится; 0 = выключить явно`,
      });
    }
  })
  .superRefine((env, ctx) => {
    if (!env.ENCRYPTION_KEYS_RETIRED) return;

    const retired = parseRetiredKeys(env.ENCRYPTION_KEYS_RETIRED);

    // Текущая версия среди выведенных — значит, при ротации забыли поднять
    // номер, и новые записи будут помечены версией ключа, который уже
    // объявлен устаревшим.
    if (retired.has(env.ENCRYPTION_KEY_VERSION)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY_VERSION'],
        message: `версия ${env.ENCRYPTION_KEY_VERSION} есть среди выведенных ключей — подними номер текущей версии`,
      });
    }

    // Тот же ключ и как текущий, и как выведенный — ротацию не довели
    // до конца, и старый ключ продолжает шифровать новые записи.
    for (const [version, key] of retired) {
      if (key.toLowerCase() === env.ENCRYPTION_KEY.toLowerCase()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENCRYPTION_KEYS_RETIRED'],
          message: `ключ версии ${version} совпадает с текущим ENCRYPTION_KEY — ротация не завершена`,
        });
      }
    }
  })
  .superRefine((env, ctx) => {
    // Пока бот выключен, пустые значения законны: это состояние по умолчанию
    // на любой машине разработчика, и требовать там секрет вебхука незачем.
    if (!env.TELEGRAM_BOT_ENABLED) return;

    // Без токена вебхук примет апдейт и не сможет ответить ни одному
    // человеку: бот будет выглядеть живым и молчать. Падение на старте
    // честнее — оно случается на выкладке, а не у пользователя в чате.
    if (!env.TELEGRAM_BOT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_BOT_TOKEN'],
        message: 'бот включён (TELEGRAM_BOT_ENABLED=true), но токен пуст',
      });
    }

    // Короткий секрет превращает и путь, и заголовок в формальность:
    // адрес вебхука публичен по построению, и подобрать к нему восемь
    // символов — вопрос минут. 32 символа base64url ≈ 24 байта энтропии.
    if (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_WEBHOOK_SECRET'],
        message: 'секрет пути вебхука короче 32 символов — путь перестаёт быть защитой',
      });
    }

    if (!env.TELEGRAM_WEBHOOK_HEADER_SECRET || env.TELEGRAM_WEBHOOK_HEADER_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_WEBHOOK_HEADER_SECRET'],
        message: 'секрет заголовка вебхука короче 32 символов',
      });
    }

    // Совпадение двух секретов сводит защиту к одному значению: см. описание
    // TELEGRAM_WEBHOOK_HEADER_SECRET выше. Падение на старте здесь уместнее
    // предупреждения в логе — предупреждение прочитают после инцидента.
    if (
      env.TELEGRAM_WEBHOOK_SECRET &&
      env.TELEGRAM_WEBHOOK_HEADER_SECRET === env.TELEGRAM_WEBHOOK_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_WEBHOOK_HEADER_SECRET'],
        message:
          'секрет заголовка совпадает с секретом пути — два места защиты превращаются в одно',
      });
    }

    // Deep link собирается как t.me/<username>?start=<token>. Без username
    // привязать аккаунт нельзя вообще: кнопка на сайте вести некуда.
    if (!env.TELEGRAM_BOT_USERNAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_BOT_USERNAME'],
        message: 'без username нельзя собрать deep link t.me/<username>?start=',
      });
    }
  });

/**
 * Разбирает "1:hex,2:hex" в карту версия → ключ.
 * Формат уже проверен схемой, поэтому здесь без обработки ошибок.
 */
export function parseRetiredKeys(raw: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const pair of raw.split(',')) {
    const [version, key] = pair.split(':');
    map.set(Number(version), key!);
  }
  return map;
}

export type Env = z.infer<typeof envSchema>;

/**
 * DI-токен для провалидированного окружения.
 *
 * Сервисы инжектируют его вместо ConfigService: тип получается прямой,
 * без вывода по строковым путям. У ConfigService.get с infer условные типы
 * на объекте такого размера разрешаются в широкое объединение, из-за чего
 * `Buffer.from(config.get('ENCRYPTION_KEY', { infer: true }), 'hex')`
 * перестаёт компилироваться. Здесь этой проблемы нет по построению.
 */
export const ENV = Symbol('ENV');

/** Результат валидации, захваченный при старте. */
let validated: Env | undefined;

/**
 * Валидатор для ConfigModule. Собирает ВСЕ ошибки разом, а не падает на
 * первой: иначе настройка окружения превращается в игру «запусти, почини
 * одну строчку, запусти снова».
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${details}\n`);
  }

  validated = parsed.data;
  return parsed.data;
}

/**
 * Провалидированное окружение. Доступно только после того, как
 * ConfigModule отработал валидацию — то есть в любой момент жизни
 * приложения, кроме кода на уровне модуля.
 */
export function getValidatedEnv(): Env {
  if (!validated) {
    throw new Error('окружение ещё не провалидировано — ConfigModule не инициализирован');
  }
  return validated;
}
