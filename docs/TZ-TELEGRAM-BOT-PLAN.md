# Реализация бота: план, сборка, разборы


# === PLAN ===

# ПОФАЙЛОВЫЙ ПЛАН РЕАЛИЗАЦИИ TELEGRAM-БОТА — 6 ПАКЕТОВ С НЕПЕРЕСЕКАЮЩИМИСЯ ФАЙЛАМИ

Все пути абсолютные от `C:/Users/user/work/kwork/license-platform`. Ни один файл не встречается в двух пакетах — проверено построчно, сводная таблица владения в конце.

---

# 0. РЕШЕНИЯ ПО ПРИЛОЖЕНИЮ A И ДОПУЩЕНИЯ (принимаются всеми пакетами как данность)

| # | Вопрос | РЕШЕНИЕ |
|---|---|---|
| A1 | Модуль API или отдельный сервис | **Модуль** `apps/api/src/modules/telegram-bot/`. Бот зовёт сервисы напрямую, HTTP-слой и гварды не участвуют |
| A2 | Очередь апдейтов | **Redis-список** `tg:queue` (LPUSH/BRPOP-эмуляция через RPOP в `@Interval`), TTL на весь список 3600 с |
| A3 | Часовой пояс тихих часов | **МСК для всех** (`MSK_OFFSET_MIN = 180`), поле таймзоны в `User` не добавляем |
| A4 | Настройки `telegram.*` в БД | **ENV — единственный источник правды для бота.** Строки `seed.ts:329-331` НЕ удаляются: `settings.service.ts:100` не считает пустой плейсхолдер значением, а `:112` уже даёт откат на ENV, поэтому удаление ничего не чинит, а лишь убирает строки из будущей админки. Это единственное отступление от буквы рекомендации A4 (её суть — «читать из ENV» — соблюдена) |
| A5 | `register-with-key` из чата | **Нет.** Регключ принимается только для УЖЕ привязанного аккаунта (`RegistrationKeyService.redeemForUser`) |
| A6 | Настоящее продление | **Не делаем** (С7 вне объёма). Экран `/renew` говорит правду про вторую лицензию |
| A7 | Тексты поддержки в БД | **Не храним.** В `TelegramSupportThread` только номер, ссылка на сообщение в админ-чате и идентификаторы |
| A8 | `TELEGRAM_ADMIN_CHAT_ID` | **Группа.** Значение — отрицательное число, тип в коде `bigint` |

**Собственные допущения (заявляю явно, чтобы исполнители не выдумывали):**

1. **С3 (одноразовая ссылка «ключ на сайте») не делается** — она P1, а пакета под неё нет. Кнопка `🌐 Открыть на сайте` в E-07 ведёт на `${APP_URL}/licenses/${id}` (страница кабинета, требует входа) и **стоит первой**, как велит ТЗ. Ссылка одноразовой станет отдельной задачей.
2. **`AuthenticatedUser.sessionId` у бота синтетический** — `link.id` (uuid `TelegramLink`). Проверено: `AuditService.record` (`audit.service.ts:133`) поле `sessionId` не пишет вовсе, FK нет, ломаться нечему.
3. **Лаг блокировки — до 60 с, явной инвалидации `tg:actor` из `auth.service.ts` НЕ делаем.** Причина: инъекция `BotActorService` в `AuthService` даёт цикл `AuthModule → TelegramBotModule → AuthModule`. Вместо этого `BotActorService.assertNotBlocked(userId)` перечитывает `User.status/deletedAt` мимо кэша **перед каждым необратимым действием** (сброс HWID, показ ключа, активация) — там лаг нулевой. Опциональная однострочная правка `auth.service.ts` вынесена в список агента сборки как P2.
4. **`HwidHistory.ip` — тип `@db.Inet` (`schema.prisma:953`).** Бот **обязан** передавать `ip: undefined` в `HwidService.resetBySelf`. Строка вида `telegram:123` уронит вставку.
5. **`TelegramLink.locale` — `@db.VarChar(8)`, а не `VarChar(5)` из §3.5 ТЗ.** Согласовано с `User.locale` (`schema.prisma:266`), иначе `ru-RU` не влезет в одно поле и влезет в другое.
6. **Тихие часы реализуются полем `Notification.scheduledAt`**, а не пропуском строки в процессоре. Иначе отложенная строка перечитывалась бы каждым тиком до 08:00.
7. **`enqueue → enqueueMulti` на существующих семи точках вызова делает АГЕНТ СБОРКИ**, а не пакет 4 и не пакет 5: эти строки лежат в файлах пакета 5 (`licenses.service.ts`, `digiseller.service.ts`) и в `hwid.service.ts`, а метода до пакета 4 не существует. Точный текст правок — в разделе 7.
8. **ESLint/Prettier в проекте нет.** Проверка каждого пакета: `cd apps/api && npx tsc --noEmit` и `npx vitest run`. Docker не поднимаем.

---

# ПАКЕТ 0 — СХЕМА (делается первым, остальные ждут)

## Создаёт

### `C:/Users/user/work/kwork/license-platform/apps/api/prisma/migrations/20260811120000_telegram_bot/migration.sql`
Каталог именуется вручную (круглый timestamp, как `20260802150000_payload_builds`). Файл начинается шапкой-комментарием по-русски по образцу `20260805190000_digiseller_redeem_by_order/migration.sql:1-9`: зачем таблицы, почему `BIGINT` для идентификаторов Telegram, почему состояние FSM тут отсутствует.

Порядок: `CREATE TYPE` (3 enum'а) → `CREATE TABLE` (4 таблицы) → индексы → `ALTER TABLE notifications ADD COLUMN scheduled_at` → индекс на него.

### `C:/Users/user/work/kwork/license-platform/apps/api/src/common/utils/license-key.ts`
Единственный файл вне prisma в этом пакете. **Причина: его импортируют пакеты 3, 4 и 5 — если отдать его любому из них, остальные два будут ждать или создадут дубль.** Пакет 0 завершается раньше всех, поэтому файл достаётся ему.

```ts
/**
 * Маска ключа лицензии.
 *
 * Полный ключ — предъявительский документ: кто его видит, тот им и владеет.
 * Поэтому по умолчанию наружу уходит маска, а полное значение — только по
 * явному запросу владельца через отдельную ручку с аудитом (§7 ТЗ бота).
 *
 * Формат ключа: FC26-1A2B-3C4D-5E6F-9F3A. Короткие и нестандартные строки
 * маскируются целиком: попытка «умно» разобрать неизвестный формат — это
 * способ однажды показать три четверти ключа.
 */
export function maskLicenseKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length < 12) return '****';
  return `${key.slice(0, 4)}-****-****-****-${key.slice(-4)}`;
}

/** Регулярка ключа для цензора логов и для проверки «не ключ ли это?» во вводе бота. */
export const LICENSE_KEY_RE = /\b[A-Z0-9]{2,6}(-[A-Z0-9]{4}){4}\b/g;
```

## Меняет

### `C:/Users/user/work/kwork/license-platform/apps/api/prisma/schema.prisma`

1. **Enum'ы** — рядом с `NotificationChannel` (153-158):
```prisma
enum TelegramLinkScope { USER ADMIN }
enum TelegramNotifyCategory { LICENSE EXPIRY SECURITY DEVICE ADMIN }
```
2. **Модель `User` (233-304)**, блок relations (283-297) — две строки:
```prisma
  telegramLink      TelegramLink?
  telegramLinkCodes TelegramLinkCode[]
```
3. **Модель `Notification` (1252-1288)** — новое поле после `locale` (1270):
```prisma
  /// Отложенная отправка. Тихие часы Telegram (23:00–08:00 МСК) реализованы
  /// именно так: без этого поля отложенная строка перечитывалась бы
  /// процессором на каждом тике до самого утра.
  scheduledAt DateTime? @map("scheduled_at") @db.Timestamptz(3)
```
плюс индекс к существующим (1284-1286): `@@index([channel, status, scheduledAt])`.
4. **Четыре новые модели** — отдельным разделом после `NotificationTemplate` (после 1306), с баннером-комментарием. Состав — ровно из §3.5 ТЗ, с тремя правками:
   - `TelegramLink.locale String @default("ru") @db.VarChar(8)` (согласовано с `User.locale`);
   - `TelegramLinkCode` получает связь с `User` по образцу `VerificationToken` (`schema.prisma:445-476`): `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`;
   - у всех четырёх моделей `id String @id @db.Uuid` **без `@default`** — идентификаторы генерирует приложение через `uuidv7()` (шапка схемы 5-7).

**Ловушка `ticketNo`:** `Int @unique @default(autoincrement()) @map("ticket_no")` на не-`@id` поле. Если `npx prisma validate` это отвергнет — убрать `@default`, а в миграции создать `CREATE SEQUENCE telegram_support_ticket_no_seq` и `ALTER TABLE telegram_support_threads ALTER COLUMN ticket_no SET DEFAULT nextval(...)`, в Prisma оставить `@default(dbgenerated())`. Решение принимает исполнитель по факту вывода `validate`, оба варианта допустимы.

## Предоставляет другим
Типы Prisma Client: `TelegramLink`, `TelegramLinkCode`, `TelegramNotificationPref`, `TelegramSupportThread`, `TelegramLinkScope`, `TelegramNotifyCategory`; поле `notification.scheduledAt`; функцию `maskLicenseKey` и константу `LICENSE_KEY_RE` из `@common/utils/license-key`.

## Зависит от
Ничего.

## НЕ имеет права трогать
`prisma/seed.ts` (пакет 4), `src/common/config/env.schema.ts` (пакет 1), любой файл в `src/modules/`, `.env*`, `prisma/sql/01_partitioning.sql`.

## Проверка
```
cd apps/api && npx prisma validate && npx prisma generate && npx tsc --noEmit
```
`prisma migrate dev` НЕ запускать — БД не поднята; SQL пишется руками после `db:migrate:create` либо целиком вручную.

---

# ПАКЕТ 1 — ТРАНСПОРТ

## Меняет

### `C:/Users/user/work/kwork/license-platform/apps/api/src/common/config/env.schema.ts`
**Эксклюзивный владелец этого файла — только пакет 1.** Никакому другому пакету новых переменных не требуется (пакет 2 берёт `APP_URL` и `TELEGRAM_BOT_USERNAME` — они уже есть).

В блок `// --- OAuth ---` (223-228), сразу под `TELEGRAM_BOT_USERNAME`:
```ts
    /** Рубильник бота. При false модуль не принимает апдейты и не шлёт сообщения. */
    TELEGRAM_BOT_ENABLED: boolFromEnv(false),
    /** Секрет пути И заголовка вебхука. НЕ токен бота: 32 байта CSPRNG в base64url. */
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    /** Чат владельца (группа) для алертов и тредов поддержки. Отрицательное число. */
    TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
```
Именно `boolFromEnv(false)` — `z.coerce.boolean()` запрещён (`env.schema.ts:33-44`).

Новый `.superRefine` в конец цепочки, по образцу 336-353:
```ts
  .superRefine((env, ctx) => {
    if (!env.TELEGRAM_BOT_ENABLED) return;
    // Без токена вебхук примет апдейт и не сможет ответить ни одному человеку:
    // бот будет выглядеть живым и молчать. Падение на старте честнее.
    if (!env.TELEGRAM_BOT_TOKEN) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TELEGRAM_BOT_TOKEN'], message: 'бот включён (TELEGRAM_BOT_ENABLED=true), но токен пуст' });
    if (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 32) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TELEGRAM_WEBHOOK_SECRET'], message: 'секрет вебхука короче 32 символов — путь и заголовок перестают быть защитой' });
    if (!env.TELEGRAM_BOT_USERNAME) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TELEGRAM_BOT_USERNAME'], message: 'без username нельзя собрать deep link t.me/<username>?start=' });
  })
```

## Создаёт

### `.../src/modules/telegram-bot/telegram-bot.config.ts` — `TelegramBotConfig`
`@Injectable()`, `constructor(@Inject(ENV) private readonly env: Env)`. Только `ENV`, не `ConfigService` (`env.schema.ts:399-408`).
```ts
get enabled(): boolean
get token(): string          // бросает, если пуст — вызывать только при enabled
get username(): string
get webhookSecret(): string
get adminChatId(): bigint | null
get appUrl(): string
deepLink(token: string): string   // `https://t.me/${username}?start=${token}`
```

### `.../src/modules/telegram-bot/telegram-api.module.ts` — `TelegramApiModule`
Лёгкий модуль **без единой доменной зависимости**: `providers: [TelegramBotConfig, TelegramApiService, BotRateService]`, `exports: [TelegramBotConfig, TelegramApiService, BotRateService]`.
**Почему отдельный от `TelegramBotModule`:** его импортирует `NotificationsModule` (пакет 4). Если бы пакет 4 импортировал полный `TelegramBotModule`, получился бы цикл `NotificationsModule → TelegramBotModule → BillingModule → NotificationsModule` (`billing.module.ts` импортирует `NotificationsModule` явно). Этот комментарий обязан быть в шапке файла.

### `.../src/modules/telegram-bot/telegram.api.ts` — `TelegramApiService`
```ts
export interface TgSendResult { messageId: number }
export class TelegramSendError extends Error {
  readonly kind: 'chat_blocked' | 'chat_not_found' | 'rate_limited' | 'transient' | 'bad_request';
  readonly retryAfterSec?: number;
}

async sendMessage(chatId: bigint, text: string, opts?: { keyboard?: InlineKeyboard; replyToMessageId?: number; disableNotification?: boolean }): Promise<TgSendResult>
async editMessageText(chatId: bigint, messageId: number, text: string, opts?: { keyboard?: InlineKeyboard }): Promise<void>
async deleteMessage(chatId: bigint, messageId: number): Promise<void>
async answerCallbackQuery(id: string, opts?: { text?: string; showAlert?: boolean }): Promise<void>
async leaveChat(chatId: bigint): Promise<void>
async call<T>(method: string, body: Record<string, unknown>): Promise<T>   // для скриптов setWebhook/setMyCommands
```
Обязательное поведение: `parse_mode: 'HTML'` и `disable_web_page_preview: true` на всех отправках; таймаут 10 с (`AbortSignal.timeout`); ретраи только сеть/`5xx`, до 3, паузы 1/3/9 с; `429` → читать `parameters.retry_after`; лимитер **≤25 msg/с суммарно и ≤1 msg/с в чат** (внутренняя очередь на промисах + Redis-ключ `tg:sendlock:<chatId>` EX 1).

**Учёт отказов доставки живёт здесь, а не в пакете 4** (иначе `NotificationsModule` пришлось бы связывать с `BotLinkService` и получить цикл):
- `403 bot was blocked` → `prisma.telegramLink.updateMany({ where: { chatId }, data: { chatBlocked: true } })`, бросить `TelegramSendError{kind:'chat_blocked'}`;
- `400 chat not found` → `revokedAt = now(), revokeReason = 'chat_not_found'` + `notifications.enqueue({ templateKey: 'telegram.unlinked', channel: EMAIL, userId })`. `NotificationService` инжектируется напрямую — `NotificationsModule` глобальный, импорта не требует, обратной зависимости не создаёт.

### `.../src/modules/telegram-bot/telegram-html.ts`
```ts
export function escapeHtml(value: unknown): string   // & < > " → сущности
export function truncate(value: string, max: number): string
```
Импортируется пакетом 3 и пакетом 4 — только на чтение.

### `.../src/modules/telegram-bot/dto/telegram-update.types.ts`
Классов DTO НЕ объявлять. Причина записана в карте соглашений: `forbidNonWhitelisted: true` отвергнет тело апдейта, где десятки необъявленных полей. Здесь — только `interface`'ы (`TgUpdate`, `TgMessage`, `TgCallbackQuery`, `TgUser`, `TgChat`, `TgChatMemberUpdated`) и функция:
```ts
export function parseUpdate(raw: unknown): TgUpdate | null   // ручная валидация, null на мусор
```
Числа `chat.id`/`from.id` разбирать **в `bigint`**; JSON.parse даёт `number`, поэтому парсер обязан работать с сырой строкой тела либо принимать потерю точности осознанно — берём сырое тело: контроллер отдаёт очереди строку, а `parseUpdate` вызывается уже на распарсенном объекте, а идентификаторы читаются регуляркой по сырой строке — **проще и надёжнее: парсить через `JSON.parse` с reviver, превращающим `id`/`chat_id`/`update_id` в `bigint` по имени поля.** Это правило записать комментарием.

### `.../src/modules/telegram-bot/bot-router.interface.ts`
**Это шов между пакетами 1 и 3.** Пакет 1 не должен импортировать ни одного файла пакета 3.
```ts
export const BOT_ROUTER = Symbol('BOT_ROUTER');
export interface BotRouter {
  handleUpdate(update: TgUpdate): Promise<void>;
}
```

### `.../src/modules/telegram-bot/telegram-webhook.controller.ts`
```ts
@ApiExcludeController()
@Public()
@Controller('telegram/webhook')
export class TelegramWebhookController {
  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async receive(@Param('secret') secret: string, @Headers('x-telegram-bot-api-secret-token') header: string | undefined, @Body() update: unknown): Promise<void>
}
```
Правила: оба значения сравниваются `crypto.timingSafeEqual` (готовый приём — `oauth/telegram.provider.ts:121-124`, скопировать, не изобретать); расхождение → `throw new NotFoundException()` (**404, не 403**); при `!config.enabled` → тоже 404; тело кладётся в `TelegramUpdateQueue.push` и метод возвращается — никакой работы в обработчике запроса. Возврат `void` + `@HttpCode(200)` даёт пустое тело.

### `.../src/modules/telegram-bot/telegram-update.queue.ts` — `TelegramUpdateQueue`
```ts
async push(raw: unknown): Promise<'queued' | 'duplicate' | 'dropped'>
async pop(max: number): Promise<TgUpdate[]>
```
`push`: идемпотентность `SET tg:upd:<update_id> 1 EX 3600 NX` — уже есть → `'duplicate'`; иначе `RPUSH tg:queue <json>` + `EXPIRE tg:queue 3600`; при длине списка > 10000 → `'dropped'` + `logger.warn`. Redis недоступен → `'dropped'` + `warn` (fail-open по образцу `payload.service.ts:485-515`: очередь — инструмент, а не рубеж безопасности).

### `.../src/modules/telegram-bot/telegram-update.processor.ts` — `TelegramUpdateProcessor`
`@Interval(1000)`, блокировка реплики `SET tg:updates:lock 1 EX 30 NX` со снятием в `finally` (образец `notification.processor.ts:86-101`). На каждый апдейт: `SET tg:chat-lock:<chatId> 1 EX 10 NX`, не взяли — вернуть апдейт в конец списка; затем `@Inject(BOT_ROUTER) router.handleUpdate(update)` в `try/catch` — исключение обработчика гасится и логируется, апдейт не переотправляется (Telegram уже получил 200). Логировать: `update_id`, `telegramUserId`, длительность, код ошибки. **Не логировать тело апдейта.**

### `.../src/modules/telegram-bot/bot-rate.service.ts` — `BotRateService`
Общий счётчик скользящих окон для пакетов 2 и 3 (образец `digiseller.service.ts:1316-1337`):
```ts
async hit(key: string, limit: number, windowSec: number): Promise<boolean>   // true = разрешено
async peek(key: string): Promise<number>
async reset(key: string): Promise<void>
```
Ключи передаёт вызывающий: `tg:linkfail:<chatId>` 5/ч, `tg:linkcode:<userId>` 5/ч, `tg:keyreveal:<chatId>` 3/ч, `tg:activate:<userId>` 10/ч, `tg:support:<userId>` 3/ч, `tg:msg:<chatId>` 20/мин, `tg:notify:<userId>` 10/ч. Redis недоступен → `true` (пропускаем).

### `.../apps/api/scripts/telegram-webhook.ts`
Разовый скрипт деплоя (рядом с существующим `scripts/generate-payload-vectors.ts`, запуск через `tsx`). Аргументы: `set` | `delete` | `info`. `set` шлёт `setWebhook` с `url = ${APP_URL}/api/v1/telegram/webhook/${TELEGRAM_WEBHOOK_SECRET}`, `secret_token`, `allowed_updates: ["message","callback_query","my_chat_member"]`, `max_connections: 40`, `drop_pending_updates: true`. **Токен и секрет читаются только из `process.env`, в аргументы командной строки не принимаются** (аргументы видны в `ps` и в истории оболочки).

### Тесты
`.../apps/api/test/telegram-webhook.spec.ts` — 404 при неверном пути, 404 при неверном заголовке, 404 при выключенном рубильнике, 200 при верных обоих.
`.../apps/api/test/telegram-api.spec.ts` — `escapeHtml`, разбор `429 retry_after`, классификация 403/400 в `TelegramSendError.kind`.
Мокать конструктором с `as unknown as`, `Test.createTestingModule` не использовать (в проекте не применяется нигде).

## Предоставляет другим
`TelegramApiService`, `TelegramBotConfig`, `BotRateService`, `escapeHtml`/`truncate`, типы `TgUpdate`/`TgMessage`/`TgCallbackQuery`, токен `BOT_ROUTER` и интерфейс `BotRouter`, модуль `TelegramApiModule`.

## Зависит от
Пакета 0 — нет (типы Prisma нужны только для `telegramLink.updateMany`, то есть после пакета 0).

## НЕ имеет права трогать
`telegram-bot.module.ts` (пишет агент сборки), `app.module.ts`, `notifications/*` (пакет 4), `bot-link.service.ts`/`bot-actor.service.ts` (пакет 2), `screens/*`, `i18n/*` (пакет 3), `logger.module.ts` (агент сборки), `.env*` (агент сборки).

---

# ПАКЕТ 2 — ПРИВЯЗКА

## Создаёт

### `.../src/common/rbac/actor-profile.ts`
```ts
/**
 * Профиль актора: права, приоритет роли, признак 2FA.
 *
 * ЧТО К ПРОБЛЕМЕ ВЕЛО: логика жила приватным методом JwtAuthGuard.loadProfile.
 * Боту нужен тот же профиль, и второй его экземпляр разошёлся бы с первым
 * при первой же правке ролей — заблокированный админ остался бы админом
 * ровно в том канале, куда правку не донесли.
 */
export async function loadActorProfile(
  prisma: PrismaService,
  redis: RedisService,
  userId: string,
): Promise<{ permissions: Set<string>; rolePriority: number; twoFactorEnabled: boolean }>
```
Тело — дословный перенос `jwt-auth.guard.ts:110-171`, включая формат кэша `"приоритет|2fa|право,право"`, ключ `user:permissions:<userId>` и TTL 300 с. Поведение не меняется ни на бит.

### `.../src/modules/telegram-bot/bot-actor.service.ts` — `BotActorService`
```ts
export interface BotActor {
  user: AuthenticatedUser;      // sessionId = link.id (см. допущение 2)
  link: { id: string; chatId: bigint; telegramUserId: bigint; scope: TelegramLinkScope; locale: string; expiresAt: Date | null };
  blocked: boolean;             // true → доступны только /help и /support
}

async resolve(telegramUserId: bigint): Promise<BotActor | null>
async assertNotBlocked(userId: string): Promise<void>   // мимо кэша, перед необратимым
async touch(linkId: string, chatId: bigint, username?: string): Promise<void>  // lastSeenAt, снятие chatBlocked, обновление кэша @username
async invalidate(userId: string): Promise<void>
```
Кэш `tg:actor:<userId>` TTL **60 с**. `expiresAt` в прошлом → вернуть `null` (бот предложит перепривязаться). Права собираются вызовом `loadActorProfile` — своей копии быть не должно.

### `.../src/modules/telegram-bot/bot-link.service.ts` — `BotLinkService`
```ts
async initForUser(params: { userId: string; scope: TelegramLinkScope; totpCode?: string; ip?: string }): Promise<{ token: string; deepLink: string; expiresAt: Date }>
async stateFor(userId: string): Promise<{ linked: boolean; username: string | null; linkedAt: Date | null; expiresAt: Date | null; scope: TelegramLinkScope | null; chatBlocked: boolean }>
async revokeFromSite(userId: string, actor: AuthenticatedUser): Promise<void>
async revokeFromChat(linkId: string): Promise<void>
async confirm(rawToken: string, from: TgUser, chat: TgChat): Promise<{ ok: true; link: TelegramLink; username: string; expiresAt: Date } | { ok: false; reason: 'invalid' }>
```
Правила, отступать нельзя:
- токен — `randomBytes(32).toString('base64url')` (43 символа, влезает в лимит 64 у `start`); в БД только `sha256(token)` hex в `codeHash`; сам токен нигде не хранится и **не логируется**;
- `expiresAt = now + 600 с`; лимит выпуска `BotRateService.hit('tg:linkcode:' + userId, 5, 3600)` → `429 RATE_LIMITED`;
- **step-up 2FA**: если `user.twoFactorEnabled` ИЛИ `scope === ADMIN` → обязателен `totpCode`, проверяется `TwoFactorService.verify(userId, code)` (`two-factor.service.ts:190`); нет кода → `401 TWO_FACTOR_REQUIRED`;
- `scope = ADMIN` разрешается только при `actor.permissions.has('licenses.create.any')`, срок привязки **30 дней**; иначе `USER`, **90 дней**;
- **гашение атомарное**, одним `UPDATE ... WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, scope` через `prisma.$queryRaw`. Отдельный `SELECT` + `UPDATE` — гонка, по которой один токен гасится дважды;
- ноль строк → `{ ok: false, reason: 'invalid' }` — **один результат на все три причины** (использован / просрочен / не существует), иначе получается оракул;
- вытеснение: если у `userId` есть активная привязка к другому чату **или** у `telegramUserId` — к другому аккаунту, старая получает `revokedAt = now(), revokeReason = 'evicted'`, в старый чат уходит прощальное сообщение, на почту — `telegram.unlinked`;
- создание `TelegramLink` + пять строк `TelegramNotificationPref` (`ADMIN` создаётся только при `scope=ADMIN`) в одной `prisma.$transaction(async (tx) => ...)`, `id` — `uuidv7()`;
- `AuditService.record({ action: 'telegram.link.confirm', actorType: ActorType.USER, actorLabel: 'telegram:' + telegramUserId, entityType: 'telegram_link', entityId: link.id })`. Аналогично `telegram.link.init`, `telegram.link.revoke`, `telegram.link.evict`;
- отвязка с сайта и из чата **не трогает `OAuthAccount` провайдера `TELEGRAM`** — это разные сущности, комментарий обязателен.

### `.../src/modules/telegram-bot/telegram-link.controller.ts`
```ts
@ApiTags('telegram')
@Controller('auth/telegram/link')
export class TelegramLinkController {
  @Post('init')  @HttpCode(HttpStatus.OK) @ApiBearerAuth('jwt') @Audit({ action: 'telegram.link.init', entityType: 'user', entityIdFrom: 'result:userId' })
  @Get()         @ApiBearerAuth('jwt')
  @Delete()      @HttpCode(HttpStatus.OK) @ApiBearerAuth('jwt') @Audit({ action: 'telegram.link.revoke', entityType: 'user' })
}
```
**`auth.controller.ts` не трогается** — отдельный контроллер даёт те же пути `/api/v1/auth/telegram/link*` и не создаёт конфликта файлов. `@RequirePermissions` не ставится (эндпоинт кабинета, владельца проверяет сервис — так же как в `hwid.controller.ts`). Коды ошибок: `TWO_FACTOR_REQUIRED` (есть), `RATE_LIMITED` (есть), новые `TELEGRAM_DISABLED`, `TELEGRAM_NOT_LINKED`, `TELEGRAM_ALREADY_LINKED` — с занятыми не пересекаются (проверено по списку).

### `.../src/modules/telegram-bot/dto/telegram-link.dto.ts`
`InitTelegramLinkDto { @IsOptional() @IsString() @Matches(/^\d{6}$|^[A-Za-z0-9-]{8,32}$/) @MaxLength(32) totpCode?: string; @IsOptional() @IsIn(['USER','ADMIN']) scope?: string }` + response-DTO `TelegramLinkStateDto`, `TelegramLinkInitDto` (только ради Swagger, как `TokenPairDto`). Сообщения валидаторов — по-русски.

### `.../src/modules/telegram-bot/telegram-link.processor.ts` — `TelegramLinkProcessor`
`@Cron(CronExpression.EVERY_HOUR)` + Redis-лок `tg:links:lock` EX 300:
- привязки с `expiresAt < now()` и `revokedAt IS NULL` → отозвать (`revokeReason = 'expired'`), письмо `telegram.unlinked`;
- привязки, истекающие через 7 дней, без ранее отправленного напоминания → `telegram.link_expiring`;
- удаление `TelegramLinkCode` с `expiresAt < now() - 24 ч`.
Батч `take: 500`.

### Тест
`.../apps/api/test/bot-link.service.spec.ts` — хеширование токена (в БД не попадает сырой), один и тот же текст ошибки на три причины, вытеснение старой привязки, отказ без TOTP при `twoFactorEnabled`.

## Меняет

### `.../src/modules/auth/guards/jwt-auth.guard.ts`
Единственная правка: приватный `loadProfile` (110-171) удаляется, вместо него `return loadActorProfile(this.prisma, this.redis, userId);`. Константы `PERMISSIONS_PREFIX`/`PERMISSIONS_TTL_SEC` переезжают в `actor-profile.ts`. Поведение неизменно. **Файл эксклюзивен для пакета 2.**

## Предоставляет другим
Пакету 3: `BotActorService.resolve/assertNotBlocked/touch`, `BotLinkService.confirm/revokeFromChat`, тип `BotActor`.
Пакету 4: ничего (пакет 4 читает `telegram_links` сам, через Prisma).

## Зависит от
Пакет 0 (модели), пакет 1 (`BotRateService`, `TelegramApiService` для прощального сообщения, типы `TgUser`/`TgChat`, `TelegramBotConfig.deepLink`).

## НЕ имеет права трогать
`auth.controller.ts`, `auth.service.ts`, `auth.module.ts` (экспорт `RegistrationKeyService` добавит агент сборки), `oauth/*` (OAuth-привязка Telegram — другая сущность, её не трогаем вовсе), `permissions.service.ts`, `permissions.guard.ts`, `screens/*`, `i18n/*`, `notifications/*`, `seed.ts`, `env.schema.ts`.

---

# ПАКЕТ 3 — КОМАНДЫ И ЭКРАНЫ

## Создаёт

### `.../src/modules/telegram-bot/i18n/en.ts`, `i18n/ru.ts`, `i18n/index.ts`
`en.ts` — источник истины, `ru.ts` — рядом, идентичный набор ключей. Плоский объект `Record<string, string>`, значения — HTML-строки с плейсхолдерами `{{name}}`.

Полный список ключей (ни одного лишнего, ни одного пропущенного):
`screen.welcome_unlinked`, `screen.link_success`, `screen.root`, `screen.licenses.list`, `screen.licenses.empty`, `screen.licenses.card`, `screen.hwid.confirm`, `screen.hwid.done`, `screen.key.confirm`, `screen.key.reveal`, `screen.activate.choose`, `screen.activate.ask_code`, `screen.activate.ask_order`, `screen.activate.ask_regkey`, `screen.activate.success`, `screen.account`, `screen.notify`, `screen.products.list`, `screen.products.card`, `screen.support.ask`, `screen.support.sent`, `screen.help`, `screen.renew`, `screen.unlink.confirm`, `screen.unlink.done`, `screen.language`;
`btn.*` для всех кнопок; `err.not_linked`, `err.link_invalid`, `err.link_rate`, `err.account_blocked`, `err.expired_action`, `err.hwid_cooldown`, `err.hwid_limit`, `err.not_bound`, `err.digiseller_invalid`, `err.digiseller_used`, `err.digiseller_rate`, `err.digiseller_pending`, `err.key_reveal_limit`, `err.password_required`, `err.server`, `err.private_only`; `msg.cancelled`, `msg.security_always_on`.

`index.ts`:
```ts
export type Locale = 'ru' | 'en';
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string
export function pickLocale(raw: string | null | undefined): Locale   // 'ru*' → ru, иначе en
```
Подстановка `{{var}}`; **все значения переменных перед подстановкой пропускаются через `escapeHtml`** из пакета 1 — это правило и есть защита от HTML-инъекции через username.

### `.../src/modules/telegram-bot/bot-format.ts`
```ts
export function statusIcon(status: LicenseStatus): string        // ACTIVE 🟢 PENDING ⚪️ EXPIRED 🔴 BLOCKED ⛔️ REVOKED ⚫️
export function expiryLine(locale, license): string
export function maskEmail(email: string | null): string          // g***j@gmail.com
export function formatDate(locale, date: Date | null): string
export function durationText(locale, durationDays: number | null): string
export function looksLikeLicenseKey(input: string): boolean      // по LICENSE_KEY_RE из @common/utils/license-key
```
Маску ключа **не переопределять** — брать `maskLicenseKey` из `@common/utils/license-key` (пакет 0).

### `.../src/modules/telegram-bot/bot-keyboard.ts`
```ts
export interface InlineKeyboard { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }
export function kb(rows: Array<Array<{ text: string; cb?: string; url?: string }>>): InlineKeyboard
export function paginate(page: number, pages: number, prefix: string): Row
```
Ограничение: **максимум 6 кнопок на экран, 1-2 в ряд** — проверяется в `kb()`, превышение → `logger.warn` и обрезка (лучше потерять кнопку, чем получить нечитаемый экран на телефоне).

### `.../src/modules/telegram-bot/bot-state.service.ts` — `BotStateService`
```ts
export type BotStateName = 'idle' | 'awaiting_digiseller_code' | 'awaiting_order_data' | 'awaiting_registration_key' | 'awaiting_support_text' | 'awaiting_hwid_confirm' | 'awaiting_key_confirm';
export interface BotState { s: BotStateName; since: number; ctx?: Record<string, string> }

async get(chatId: bigint): Promise<BotState>
async set(chatId: bigint, state: BotStateName, ctx?: Record<string, string>): Promise<void>
async clear(chatId: bigint): Promise<void>
async newNonce(chatId: bigint, state: BotStateName, ctx: Record<string,string>): Promise<string>   // 8 символов base32
async consumeNonce(chatId: bigint, expected: BotStateName, nonce: string): Promise<Record<string,string> | null>
```
Ключ `tg:state:<chatId>`, TTL по состоянию: 300 / 300 / 300 / 900 / 120 / 120 с. **Только Redis, ни строки в БД** — состояние обязано протухать само. **По таймауту бот молчит.**

### `.../src/modules/telegram-bot/bot-router.service.ts` — `BotRouterService implements BotRouter`
Единственная точка входа: `handleUpdate(update: TgUpdate)`.
- `message.chat.type !== 'private'` или `chat.id !== from.id` → `err.private_only` (для группы — молча `leaveChat`);
- `my_chat_member` о добавлении в группу → `leaveChat`, без сообщений;
- лимит `tg:msg:<chatId>` 20/мин — превышение обрабатывается **молчанием**;
- `/start <token>` → **немедленный `deleteMessage` входящего**, затем `BotLinkService.confirm(...)`, при провале `BotRateService.hit('tg:linkfail:<chatId>', 5, 3600)`;
- `BotActorService.resolve(from.id)` → `null` ⇒ доступны только E-00, `cb:products`, `cb:help`; `blocked` ⇒ только `/help` и `/support`;
- любая команда меню (`/start`, `/licenses`, `/activate`, `/products`, `/account`, `/support`, `/help`, `/language`, `/unlink`, `/renew`, `/cancel`, `/admin`) сбрасывает состояние в `idle`;
- разбор `callback_data`: `cb:root|licenses|lic:<id>|hwid:<id>|hwid_go:<id>:<nonce>|key:<id>|key_go:<id>:<nonce>|activate|act_code|act_order|act_regkey|products|prod:<id>|account|notify|notify_toggle:<CAT>|lang|lang_set:<loc>|unlink|unlink_go:<nonce>|support|help|page:<screen>:<n>` — **строго по списку**, неизвестное → `err.expired_action`;
- на каждый `callback_query` обязателен `answerCallbackQuery` (иначе у пользователя вечные часики);
- один экран = одно сообщение (`editMessageText`); новое сообщение только для: показа ключа, уведомлений, ответа поддержки.

### `.../src/modules/telegram-bot/screens/*.screen.ts` (9 файлов)
`root.screen.ts` (E-00, E-01, E-02, справка по продлению E-renew), `licenses.screen.ts` (E-03, E-04), `hwid.screen.ts` (E-05, E-06), `activate.screen.ts` (E-08), `account.screen.ts` (E-09, E-10, язык, отвязка), `products.screen.ts` (E-11), `support.screen.ts` (E-12), `help.screen.ts` (E-13), `admin.screen.ts` (`/admin`: зависшие сделки через `DigisellerService`, право проверяется **в момент вызова**, не по `scope` привязки).

Каждый экран — `@Injectable()` класс с методами `render(actor, ctx): Promise<{ text: string; keyboard: InlineKeyboard }>` и `handle(...)`. Данные берутся **только** через сервисы:
- `LicensesService.list(actor, { take: 25 })` и `LicensesService.findById(id, actor)` — **`search` из пользовательского ввода НЕ передаётся никогда** (для не-админа он ищет подстроку ключа: оракул + фрагменты ключей в логах). Поиск — только кнопками;
- `HwidService.statusFor(licenseId, userId)` → `{ bound, boundAt, resetsUsed, resetsLeft, lastResetAt, nextResetAvailableAt }`;
- `HwidService.resetBySelf(licenseId, userId, undefined)` — **третий аргумент строго `undefined`** (поле `@db.Inet`); перед вызовом `SET tg:hwid-lock:<licenseId> 1 EX 30 NX`;
- `LicensesService.revealKey(licenseId, actor)` (пакет 5) — только по E-07, лимит `tg:keyreveal:<chatId>` 3/ч, ответ **отдельным новым сообщением**, `deleteMessage` через 90 с (`setTimeout` + запись в Redis `tg:keymsg:<chatId>` на случай рестарта);
- `DigisellerService.redeem(userId, code, { sourceKey: 'telegram:' + telegramUserId })` и `redeemByOrder(userId, invoice, email, { sourceKey })` (поле добавляет пакет 5). **Перед вызовом — проверка `looksLikeLicenseKey(code)`: похоже на ключ ⇒ в API не отправлять** (иначе ключ уедет в лог Digiseller как неудачная попытка);
- `RegistrationKeyService.redeemForUser(code, userId)` → `{ licenseKey: string | null }` — **`licenseKey` вырезается сразу, до логирования и до рендера**, наружу идёт только `maskLicenseKey(...)`;
- `ProductsService.listPublic()` / `findBySlug(slug)`; HIDDEN/ARCHIVED не показываются;
- **входящее сообщение с кодом Digiseller, номером заказа+почтой, регключом удаляется `deleteMessage` ДО обработки и ДО любого логирования.**

Двухшаговость необратимого: `nonce` из `BotStateService.newNonce`, старая кнопка из истории → `err.expired_action`. Текст второго шага обязан называть цену: «использовано 1 из 3, останется 2».

### `.../src/modules/telegram-bot/bot-support.service.ts` — `BotSupportService`
```ts
async open(actor: BotActor, text: string): Promise<{ ticketNo: number }>
async relayAdminReply(update: TgUpdate): Promise<boolean>
```
Текст обращения уходит в `TELEGRAM_ADMIN_CHAT_ID` **и в БД не сохраняется** (решение A7); в `TelegramSupportThread` — только `ticketNo`, `linkId`, `userId`, `adminChatId`, `adminMessageId`. Ответ администратора реплаем в админ-чате находит тред по `(adminChatId, adminMessageId)` и пересылается пользователю новым сообщением. Лимит `tg:support:<userId>` 3/ч. К обращению автоматически прикладываются логин и список лицензий **масками**.

### `.../apps/api/scripts/telegram-commands.ts`
`setMyCommands` двумя вызовами: без `language_code` (описания из `i18n/en.ts`) и с `language_code: 'ru'` (из `ru.ts`). Список — семь команд меню из §1.1.

### Тесты
`.../apps/api/test/bot-i18n.spec.ts` — наборы ключей `ru` и `en` совпадают до символа; ни один шаблон не содержит `{{licenseKey}}`.
`.../apps/api/test/bot-format.spec.ts` — маска, `maskEmail`, `looksLikeLicenseKey`.
`.../apps/api/test/bot-state.service.spec.ts` — nonce гасится ровно один раз.

## Предоставляет другим
`BotRouterService` (агент сборки привяжет к токену `BOT_ROUTER`).

## Зависит от
Пакет 0 (`maskLicenseKey`), пакет 1 (`TelegramApiService`, `escapeHtml`, типы, `BotRateService`, `BOT_ROUTER`), пакет 2 (`BotActorService`, `BotLinkService`), пакет 5 (`LicensesService.revealKey`, `RedeemContext.sourceKey`, поле `maskedKey` в ответах `list`/`findById`).

## НЕ имеет права трогать
`licenses.service.ts`, `hwid.service.ts`, `digiseller.service.ts`, `products.service.ts`, `registration-key.service.ts` — **только вызывать**. Если чего-то не хватает — в отчёт, правку сделает владелец файла. Также запрещены: `telegram.api.ts`, `bot-link.service.ts`, `bot-actor.service.ts`, `notification*.ts`, `seed.ts`, `env.schema.ts`, `telegram-bot.module.ts`.

---

# ПАКЕТ 4 — УВЕДОМЛЕНИЯ

## Меняет

### `.../src/modules/notifications/notification.service.ts`
1. **`resolveRecipient` (155-178)**, ветка `TELEGRAM` вместо `return null` (175-177):
```ts
    if (params.channel === NotificationChannel.TELEGRAM) {
      // Адрес — chat_id из telegram_links, а НЕ provider_user_id из oauth_accounts:
      // последний идентифицирует пользователя виджета, а не чат, и отправка по нему
      // молча уходит в никуда.
      const link = await this.prisma.telegramLink.findFirst({
        where: { userId: params.userId, revokedAt: null, chatBlocked: false,
                 OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { chatId: true },
      });
      return link ? String(link.chatId) : null;
    }
```
Комментарий «Discord и Telegram появятся вместе с OAuth» удалить.
2. **Новый метод `enqueueMulti`**:
```ts
  /**
   * Одно событие — письмо всегда, Telegram по возможности.
   *
   * Письмо не зависит от настроек бота намеренно: почта — единственный якорь
   * восстановления доступа. Дать её отключить — дать угонщику обрубить тревогу.
   */
  async enqueueMulti(params: {
    templateKey: string;
    userId: string;
    locale?: string;
    payload?: Record<string, unknown>;
    emailRecipient?: string;
  }): Promise<{ email: string | null; telegram: string | null }>
```
Внутри: `enqueue({channel: EMAIL, ...})` всегда; затем — только если `TelegramBotConfig.enabled`, есть активная привязка, категория включена в `TelegramNotificationPref` (`SECURITY` игнорирует выключение), пройдены дедуп и потолок — `enqueue({channel: TELEGRAM, payload: telegramPayload, scheduledAt})`.
3. **Вспомогательные константы и приватные методы в этом же файле:**
```ts
const TEMPLATE_CATEGORY: Record<string, TelegramNotifyCategory> = {
  'license.issued': 'LICENSE', 'license.revoked': 'LICENSE', 'license.expiring': 'EXPIRY',
  'hwid.reset': 'DEVICE', 'telegram.linked': 'SECURITY', 'telegram.unlinked': 'SECURITY',
  'telegram.link_expiring': 'SECURITY', 'digiseller.pending': 'ADMIN', 'antifraud.alert': 'ADMIN',
};
const TELEGRAM_FORBIDDEN_PAYLOAD_FIELDS = ['licenseKey', 'key', 'code', 'password', 'token', 'secret'];
const QUIET_FROM_HOUR = 23, QUIET_TO_HOUR = 8, MSK_OFFSET_MIN = 180;
const TELEGRAM_DEDUP_HOURS = 6, TELEGRAM_CAP_PER_HOUR = 10;
```
- `sanitizeTelegramPayload(payload)`: вырезает поля из списка; если был `licenseKey` — подставляет `maskedKey: maskLicenseKey(...)` (`@common/utils/license-key`). **Ни один Telegram-шаблон не имеет права получить полный ключ, и это гарантируется здесь, а не дисциплиной авторов шаблонов.**
- `quietDelay(category)`: `SECURITY`/`ADMIN` → `null`; иначе, если по МСК сейчас 23:00-08:00, вернуть `Date` ближайших 08:00 МСК;
- дедуп `(userId, templateKey, licenseId)` не чаще 1/6 ч — Redis `tg:dedup:<userId>:<templateKey>:<licenseId>` `SET NX EX 21600`;
- потолок `BotRateService.hit('tg:notify:' + userId, 10, 3600)` — сверх лимита **молча в лог**.
4. В `enqueue` добавить необязательный `scheduledAt?: Date | null` и писать его в `create`.

### `.../src/modules/notifications/notification.processor.ts`
1. Выборка `PENDING` — добавить условие `OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }]`.
2. **`deliver` (193-219)**: `case NotificationChannel.TELEGRAM: await this.telegram.send(recipient, rendered); return;`. `case DISCORD` остаётся с `throw` (иначе фраза «ещё не реализован» станет неправдой ещё раз). Комментарий на 216 переписать.
3. В `catch` (167-189): отказ вида `chat_blocked` считать **окончательным** (как `isPermanentSmtpError`) — ретраи в заблокированный чат бессмысленны; `rate_limited` — отложить через `scheduledAt = now + retryAfter`, попытку не считать.

### `.../src/modules/notifications/notifications.module.ts`
`imports: [TelegramApiModule]`, `providers: [..., TelegramChannelService]`. Модуль остаётся `@Global()`. В шапке — комментарий, почему импортируется лёгкий `TelegramApiModule`, а не `TelegramBotModule` (цикл через `BillingModule`).

### `.../apps/api/prisma/seed.ts`
1. **17 новых шаблонов `channel: 'TELEGRAM'`** в массив `NOTIFICATION_TEMPLATES` (370-488): по паре `ru`+`en` для `license.issued`, `license.revoked`, `license.expiring`, `hwid.reset`, `telegram.linked`, `telegram.unlinked`, `telegram.link_expiring`, `digiseller.pending` (16 записей) + недостающая `antifraud.alert` в `locale: 'en'` (без неё откат `render()` на дефолтную локаль будет срабатывать всегда). Тексты короче письменных, HTML, **только `{{maskedKey}}`, никогда `{{licenseKey}}`**.
2. **Одна строка настройки для пакета 5** (пакет 5 в `seed.ts` не заходит):
```ts
  { key: 'limits.digiseller.attempts_per_source_per_hour', value: 60, category: 'limits', description: 'Попыток активации покупки с одного источника (IP или чата Telegram) в час' },
```
3. Строки `telegram.*` (329-331) **не трогать** (решение A4).

## Создаёт

### `.../src/modules/notifications/telegram-channel.service.ts` — `TelegramChannelService`
```ts
async send(recipient: string, rendered: { subject: string | null; body: string }): Promise<void>
```
Тонкая обёртка: `BigInt(recipient)` → `TelegramApiService.sendMessage`. Тему письма в Telegram не отправляет (там нет темы) — при непустом `subject` он идёт первой строкой `<b>…</b>`. Ошибки пробрасывает как есть — классификацию делает `TelegramSendError` пакета 1.

### `.../apps/api/test/notification-telegram.spec.ts`
`resolveRecipient` возвращает `chatId` и `null` при `chatBlocked`; `sanitizeTelegramPayload` вырезает `licenseKey` и подставляет `maskedKey`; тихие часы дают `scheduledAt` для `EXPIRY` и не дают для `SECURITY`.

## Предоставляет другим
`NotificationService.enqueueMulti` (сигнатура выше) — её будет звать агент сборки на семи существующих точках.

## Зависит от
Пакет 0 (`scheduledAt`, `TelegramNotifyCategory`, `maskLicenseKey`), пакет 1 (`TelegramApiModule`, `TelegramApiService`, `TelegramBotConfig`, `BotRateService`).

## НЕ имеет права трогать
`mail.service.ts`, `licenses.service.ts`, `hwid.service.ts`, `digiseller.service.ts`, `auth.service.ts` (переключение точек `enqueue` — агент сборки), любой файл в `modules/telegram-bot/`, `schema.prisma`, `env.schema.ts`.

---

# ПАКЕТ 5 — ДЫРЫ СЕРВЕРА (C1 + C2)

## Меняет

### `.../src/modules/licenses/licenses.service.ts`
1. **`list()` (331-403)** — `include` (393-397) заменить на `select` с явным перечислением. `key: true` селектится, но **в возвращаемый объект не попадает**: строка мапится в `{ ...rest, maskedKey: maskLicenseKey(key) }`. Комментарий обязан начинаться с «**ЧТО К ПРОБЛЕМЕ ВЕЛО:** `include` возвращает все скалярные поля модели, поэтому полный ключ уходил клиенту на каждом открытии списка — включая админский список чужих лицензий».
2. **`findById()` (405-422)** — то же самое для `findUnique` (406-414). Дополнительно:
   - `plan: true` (410) сузить `select`'ом до `{ slug, name, durationDays }` — сейчас наружу уезжают `price`, `currency`, `digisellerProductId`;
   - `user` (411) — убрать `email` из `select` для не-админа (реселлер видит почту владельца);
   - **`hwidHistory` (412) перевести на тот же `select`, что `hwid.service.ts:492-501`** — сейчас `include` без `select` отдаёт `oldHwidHash`/`newHwidHash` (`@db.Char(64)`) и `ip`, то есть `GET /licenses/:id` обходит защиту, специально написанную в `GET /licenses/:id/hwid/history` с комментарием «Хеши не отдаём даже админу». Это находка сверх §8 ТЗ, чинится тем же заходом.
3. **Новый метод**:
```ts
  /**
   * Полный ключ по явному запросу владельца.
   *
   * Отдельная ручка, а не поле в списке: показ ключа — событие, которое
   * должно попадать в аудит поимённо. В списке оно происходило бы неявно
   * и десятками за минуту.
   */
  async revealKey(licenseId: string, actor: AuthenticatedUser, source: 'web' | 'telegram' = 'web'): Promise<{ key: string }>
```
Внутри: `findUnique({ select: { id, key, userId, resellerId, status } })` → `assertCanTouch(license, actor, 'licenses.read')` (512-535) → `AuditService.record({ action: 'license.key.reveal', actorType: USER, entityType: 'license', entityId, after: { source } })` — **фиксируется факт, значение ключа в аудит не пишется**. Логировать только `licenseId` (`licenses.service.ts:308-316` — там же объяснение, почему нельзя интерполировать ключ в строку лога).
4. **`revoke()` (281)** — добавить отсутствующее уведомление: `await this.notifications.enqueue({ templateKey: 'license.revoked', channel: NotificationChannel.EMAIL, userId: license.userId, payload: { productName, maskedKey } })`. Сейчас `license.revoked` уходит только по пути возврата денег Digiseller (`digiseller.service.ts:855`), а ручной отзыв человека не извещает. Пишется через существующий `enqueue`; на `enqueueMulti` его переведёт агент сборки.
5. **`RedeemContext`-аналогов тут нет** — ничего больше не менять.

### `.../src/modules/licenses/licenses.controller.ts`
Новый метод после `byId` (41-52):
```ts
  @Get(':id/key')
  @ApiBearerAuth('jwt')
  @RequirePermissions('licenses.read.any', 'licenses.read.own')
  @Audit({ action: 'license.key.reveal', entityType: 'license', entityIdFrom: 'param:id' })
  @ApiOperation({ summary: 'Полный ключ лицензии', description: 'Каждый вызов попадает в журнал аудита. В списке и карточке ключ отдаётся только маской.' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — чужая лицензия' })
  async key(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<{ key: string }>
```

### `.../src/modules/licenses/dto/licenses.dto.ts`
Response-DTO `LicenseKeyDto { @ApiProperty() key!: string }` — только для Swagger, как `TokenPairDto`.

### `.../src/modules/billing/digiseller.service.ts`
1. `RedeemContext` (149-153) — новое поле:
```ts
  /**
   * Ось второго счётчика попыток. Для HTTP — адрес, для бота — чат.
   * У бота один IP на всех пользователей: без своей оси шестьдесят попыток
   * в час делились бы на всю аудиторию, и активация ложилась бы целиком
   * после нескольких десятков покупок.
   */
  sourceKey?: string;
```
2. `checkAttemptLimit` (1304-1314) — второй счётчик строится из источника, префикс `ip:` **выносится из тела метода** (сейчас вшит в строку на 1313, иначе `telegram:<id>` попадёт в пространство `ip:`):
```ts
    const source = ctx.sourceKey ?? (ctx.ip ? `ip:${ctx.ip}` : null);
    if (source) {
      const limit = await this.settings.getNumber('limits.digiseller.attempts_per_source_per_hour', 60);
      await this.bumpAttemptCounter(`${ATTEMPT_PREFIX}${source}`, limit, cost);
    }
```
Сигнатура метода меняется с `(userId, ip?)` на `(userId, ctx: RedeemContext, cost = 1)`. Вызовов ровно два — `redeem()` (210) и `redeemByOrder()` (439), третьего нет.
3. Уведомления на 855 и 1017 остаются `enqueue` — переключит агент сборки.

### `.../src/modules/billing/billing.controller.ts`
Правок, скорее всего, не требуется (контроллер продолжает передавать `ip`, откат на `ip:` собирается в сервисе). **Файл зарезервирован за пакетом 5** на случай, если `sourceKey` понадобится протащить явно.

## Создаёт
`.../apps/api/test/licenses-reveal.spec.ts` — `list`/`findById` не содержат поля `key` и содержат `maskedKey`; `revealKey` без прав бросает `FORBIDDEN`.
`.../apps/api/test/digiseller-source-limit.spec.ts` — при `sourceKey` счётчик идёт по `digiseller:attempts:telegram:<id>`, при его отсутствии — по `digiseller:attempts:ip:<ip>`.

## Предоставляет другим
Пакету 3: `LicensesService.revealKey(licenseId, actor, 'telegram')`, поле `maskedKey` в результатах `list`/`findById`, поле `RedeemContext.sourceKey`.

## Зависит от
Пакет 0 (`maskLicenseKey`).

## НЕ имеет права трогать
`hwid.service.ts` (утечка хешей чинится внутри `licenses.service.ts`, в чужой файл заходить не нужно), `seed.ts` (строку настройки добавляет пакет 4), `notification*.ts`, `apps/web/**` (фронт правит агент сборки), любой файл в `modules/telegram-bot/`.

---

# 6. СВОДНАЯ ТАБЛИЦА ВЛАДЕНИЯ (проверка непересечения)

| Файл | Пакет |
|---|---|
| `apps/api/prisma/schema.prisma` | 0 |
| `apps/api/prisma/migrations/20260811120000_telegram_bot/migration.sql` | 0 |
| `apps/api/src/common/utils/license-key.ts` | 0 |
| `apps/api/src/common/config/env.schema.ts` | 1 |
| `apps/api/src/modules/telegram-bot/telegram-bot.config.ts` | 1 |
| `.../telegram-api.module.ts` | 1 |
| `.../telegram.api.ts` | 1 |
| `.../telegram-html.ts` | 1 |
| `.../dto/telegram-update.types.ts` | 1 |
| `.../bot-router.interface.ts` | 1 |
| `.../telegram-webhook.controller.ts` | 1 |
| `.../telegram-update.queue.ts` | 1 |
| `.../telegram-update.processor.ts` | 1 |
| `.../bot-rate.service.ts` | 1 |
| `apps/api/scripts/telegram-webhook.ts` | 1 |
| `apps/api/test/telegram-webhook.spec.ts`, `test/telegram-api.spec.ts` | 1 |
| `apps/api/src/common/rbac/actor-profile.ts` | 2 |
| `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` | 2 |
| `.../telegram-bot/bot-actor.service.ts` | 2 |
| `.../telegram-bot/bot-link.service.ts` | 2 |
| `.../telegram-bot/telegram-link.controller.ts` | 2 |
| `.../telegram-bot/dto/telegram-link.dto.ts` | 2 |
| `.../telegram-bot/telegram-link.processor.ts` | 2 |
| `apps/api/test/bot-link.service.spec.ts` | 2 |
| `.../telegram-bot/bot-router.service.ts` | 3 |
| `.../telegram-bot/bot-state.service.ts` | 3 |
| `.../telegram-bot/bot-keyboard.ts`, `bot-format.ts` | 3 |
| `.../telegram-bot/bot-support.service.ts` | 3 |
| `.../telegram-bot/screens/*.screen.ts` (9) | 3 |
| `.../telegram-bot/i18n/{en,ru,index}.ts` | 3 |
| `apps/api/scripts/telegram-commands.ts` | 3 |
| `apps/api/test/bot-i18n.spec.ts`, `bot-format.spec.ts`, `bot-state.service.spec.ts` | 3 |
| `apps/api/src/modules/notifications/notification.service.ts` | 4 |
| `.../notifications/notification.processor.ts` | 4 |
| `.../notifications/notifications.module.ts` | 4 |
| `.../notifications/telegram-channel.service.ts` | 4 |
| `apps/api/prisma/seed.ts` | 4 |
| `apps/api/test/notification-telegram.spec.ts` | 4 |
| `apps/api/src/modules/licenses/licenses.service.ts` | 5 |
| `.../licenses/licenses.controller.ts` | 5 |
| `.../licenses/dto/licenses.dto.ts` | 5 |
| `.../billing/digiseller.service.ts` | 5 |
| `.../billing/billing.controller.ts` | 5 (резерв) |
| `apps/api/test/licenses-reveal.spec.ts`, `digiseller-source-limit.spec.ts` | 5 |

**Ничьи файлы (только агент сборки):** `app.module.ts`, `telegram-bot.module.ts`, `auth.module.ts`, `logger.module.ts`, `audit.service.ts`, `hwid.service.ts`, `auth.service.ts`, `package.json`, `.env*`, `apps/web/**`.

---

# 7. ПРАВКИ АГЕНТА СБОРКИ (общие файлы, делаются в конце)

### 7.1 `apps/api/src/modules/telegram-bot/telegram-bot.module.ts` — СОЗДАЁТ агент сборки (полный текст)
```ts
import { Module } from '@nestjs/common';

import { AuthModule } from '@modules/auth/auth.module';
import { BillingModule } from '@modules/billing/billing.module';
import { HwidModule } from '@modules/hwid/hwid.module';
import { LicensesModule } from '@modules/licenses/licenses.module';
import { ProductsModule } from '@modules/products/products.module';

import { BotActorService } from './bot-actor.service';
import { BotLinkService } from './bot-link.service';
import { BOT_ROUTER } from './bot-router.interface';
import { BotRouterService } from './bot-router.service';
import { BotStateService } from './bot-state.service';
import { BotSupportService } from './bot-support.service';
import { TelegramApiModule } from './telegram-api.module';
import { TelegramLinkController } from './telegram-link.controller';
import { TelegramLinkProcessor } from './telegram-link.processor';
import { TelegramUpdateProcessor } from './telegram-update.processor';
import { TelegramUpdateQueue } from './telegram-update.queue';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { AccountScreen } from './screens/account.screen';
import { ActivateScreen } from './screens/activate.screen';
import { AdminScreen } from './screens/admin.screen';
import { HelpScreen } from './screens/help.screen';
import { HwidScreen } from './screens/hwid.screen';
import { LicensesScreen } from './screens/licenses.screen';
import { ProductsScreen } from './screens/products.screen';
import { RootScreen } from './screens/root.screen';
import { SupportScreen } from './screens/support.screen';

/**
 * Telegram-бот как модуль API, а не отдельный сервис (решение 0.1 ТЗ).
 *
 * Доменные модули импортируются ради их публичных сервисов: бот не ходит
 * в собственный HTTP-API. Отдельный процесс потребовал бы пары JWT на каждого
 * пользователя, а refresh одноразовый — два быстрых тапа в чате выкидывали бы
 * человека с TOKEN_REUSED.
 *
 * TelegramApiModule отделён намеренно: его же импортирует NotificationsModule,
 * а импорт оттуда полного TelegramBotModule дал бы цикл через BillingModule.
 */
@Module({
  imports: [TelegramApiModule, AuthModule, LicensesModule, HwidModule, BillingModule, ProductsModule],
  controllers: [TelegramWebhookController, TelegramLinkController],
  providers: [
    TelegramUpdateQueue, TelegramUpdateProcessor, TelegramLinkProcessor,
    BotActorService, BotLinkService, BotStateService, BotSupportService, BotRouterService,
    RootScreen, LicensesScreen, HwidScreen, ActivateScreen, AccountScreen, ProductsScreen, SupportScreen, HelpScreen, AdminScreen,
    { provide: BOT_ROUTER, useExisting: BotRouterService },
  ],
  exports: [BotLinkService],
})
export class TelegramBotModule {}
```

### 7.2 `apps/api/src/app.module.ts`
Добавить `TelegramBotModule` в `imports` **после** `BillingModule` (то есть после `AuthModule` и `RbacModule` — глобальные guard'ы вызываются в порядке регистрации).

### 7.3 `apps/api/src/modules/auth/auth.module.ts`
`exports: [AuthService, TokenService, TwoFactorService, RegistrationKeyService]` — экран активации бота зовёт `RegistrationKeyService.redeemForUser`, сейчас сервис не экспортирован.

### 7.4 Переключение `enqueue → enqueueMulti` (4 строки в 3 файлах + 1 новая)
| Файл | Строка (до правок) | Действие |
|---|---|---|
| `modules/billing/digiseller.service.ts` | 855 | `license.revoked` → `enqueueMulti` |
| `modules/billing/digiseller.service.ts` | 1017 | `license.issued` → `enqueueMulti`, **из payload убрать `licenseKey`, добавить `maskedKey`** |
| `modules/hwid/hwid.service.ts` | 564 | `hwid.reset` → `enqueueMulti` |
| `modules/licenses/licenses.service.ts` | 482 | `license.expiring` → `enqueueMulti` |
| `modules/licenses/licenses.service.ts` | новый вызов в `revoke()` от пакета 5 | → `enqueueMulti` |
**Не переключать** `auth.service.ts:157, 298, 632` — `auth.email_verify` и `auth.password_reset` содержат ссылки восстановления и обязаны идти только почтой.

### 7.5 `apps/api/src/common/logger/logger.module.ts`
1. В `redact.paths` (58-79) добавить: `'req.body.totpCode'`, `'req.body.code'`, `'req.params.secret'`, `'req.headers["x-telegram-bot-api-secret-token"]'`.
2. **Цензор ключей в сериализаторе сообщений** (§7.6 ТЗ, условие выпуска — 0 совпадений грепом по суточным логам): в `formatters.log`/кастомном сериализаторе прогонять строку через `LICENSE_KEY_RE` (`@common/utils/license-key`) с заменой на `***`. Ставится именно в сериализаторе, а не по местам вызова: `redact` в pino работает по путям структурированных полей и текст сообщения не трогает.

### 7.6 `apps/api/src/common/audit/audit.service.ts`
В `REDACTED_FIELD_NAMES` (41-101) добавить: `'totpcode'`, `'linktoken'`, `'codehash'`, `'uniquecode'`, `'registrationkey'`, `'webhooksecret'`.

### 7.7 `.env.example` (корень), `.env`, `.env.production`
Три переменные в блок «Telegram»/«Уведомления» (`TELEGRAM_ADMIN_CHAT_ID` уже есть в `.env.example:171`, но отсутствует в `env.schema.ts` — после пакета 1 будет валидироваться):
```
TELEGRAM_BOT_ENABLED=false
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ADMIN_CHAT_ID=
```
В `docker-compose.yml`/`.prod.yml` **ничего не добавлять**: сервис `api` объявлен с `env_file: .env` (`docker-compose.yml:168`), а значения в `environment:` сильнее `env_file` (`docker-compose.yml:182-189`).

### 7.8 `apps/api/package.json`
```
"tg:webhook": "tsx scripts/telegram-webhook.ts",
"tg:commands": "tsx scripts/telegram-commands.ts"
```

### 7.9 Фронт (`apps/web`) — следствие C1, 7 файлов
`features/licenses/api.ts:49,80` (`key` → `maskedKey`), `features/licenses/license-card.tsx:114,118`, `routes/_app/licenses.$licenseId.tsx:153,155`, `features/admin-licenses/api.ts:45` (+ комментарий 39-41 ссылается на `licenses.service.ts:388-398` — обновить), `features/admin-licenses/licenses-table.tsx:236,238`, `features/admin-licenses/block-dialog.tsx:84`. Везде: показывать `maskedKey`, копирование и показ полного значения — через новый `GET /licenses/:id/key`.

### 7.10 P2, по желанию: `apps/api/src/modules/auth/auth.service.ts:917-932`
Одна строка `await this.redis.client.del('tg:actor:' + userId);` при переводе пользователя в `BLOCKED` — снимает 60-секундный лаг полностью. Инъекцию `BotActorService` **не делать** (цикл `AuthModule ↔ TelegramBotModule`).

---

# 8. ПОРЯДОК ЗАПУСКА И ПРОВЕРКИ

1. **Пакет 0** — один, до всех. Финиш: `npx prisma validate && npx prisma generate && npx tsc --noEmit` чисто.
2. **Пакеты 1-5 параллельно.** Каждый проверяет себя `npx tsc --noEmit` и `npx vitest run`. Ожидаемые и НЕ подлежащие починке ошибки на этом этапе: у пакетов 3 и 4 — «Cannot find module» на файлы соседей и отсутствие `enqueueMulti`/`revealKey`; тесты, требующие живых Postgres/Redis, падают всегда.
3. **Агент сборки** — раздел 7, затем финальный `npx tsc --noEmit && npx vitest run` уже без ожидаемых ошибок.
4. Выпуск: `npm run tg:webhook set` → `npm run tg:commands` → `TELEGRAM_BOT_ENABLED=true` → рестарт.

# === INTEGRATION ===

Everything is green. Final state verified: API tsc clean, both apps build, 208/213 tests pass.

---

# ОТЧЁТ АГЕНТА СБОРКИ

## Результаты проверок

| Проверка | Результат |
|---|---|
| `npx tsc --noEmit` (apps/api) | **exit 0, чисто** |
| `npx nest build -b swc` | **успешно, 118 файлов** |
| `npx tsc -b` + `vite build` (apps/web) | **успешно** |
| `npx prisma validate` | **схема валидна** |
| `npx vitest run` | **208 passed, 5 failed** (17 файлов: 16 зелёных, 1 красный) |
| ESLint | **не звал — в проекте не настроен** (нет конфига, только скрипт в package.json). Вместо него — вычитка новых файлов и проверка длины строк |

**Падают 5 тестов, все в `test/signature.service.spec.ts`** — им нужен живой Redis (`new Redis(process.env.REDIS_URL!)`, таймауты по 20 с). Падение пред-существующее, ко всей этой работе отношения не имеет, не чинил.

## Что свёл

**Создано:** `apps/api/src/modules/telegram-bot/telegram-bot.module.ts` (§7.1) — 6 импортов, 2 контроллера, 18 провайдеров, `BOT_ROUTER` через `useExisting`.

**Правки по §7:** `app.module.ts` (модуль после `BillingModule`), `auth.module.ts` (экспорт `RegistrationKeyService` — без него `ActivateScreen` не поднялся бы в DI), `package.json` (`tg:webhook`, `tg:commands`), `logger.module.ts`, `audit.service.ts`, `.env.example`, `.env.production`.

**§7.4 `enqueue → enqueueMulti`** — 4 точки: `licenses.service.ts` (`revoke`, `notifyExpiring`), `digiseller.service.ts` (`license.issued`), `hwid.service.ts` (`hwid.reset`). `auth.service.ts` не трогал. В три payload'а добавил `licenseId` — это ось дедупликации Telegram-копий, без неё у человека с тремя лицензиями два уведомления из трёх съедало бы окно в 6 часов.

## Конфликты и ошибки, которые пришлось разрешить

**1. Дублирующееся письмо об отзыве.** Пакет 5 перенёс уведомление `license.revoked` внутрь `LicensesService.revoke()`, но `digiseller.service.ts:867` шлёт его сам сразу после вызова `revoke()`. При возврате средств человек получил бы **два письма и два сообщения в чат** на каждую лицензию. Убрал копию в digiseller — вариант из `revoke()` богаче (там есть `productName`, `username`, `maskedKey`, которых в digiseller взять неоткуда: `findMany` выбирает только `id` и `userId`). Добавил тест-страж: `expect(notifications.enqueue).not.toHaveBeenCalled()`.

**2. Секрет вебхука утекал в логи открытым.** §7.5 предписывал `redact: ['req.params.secret']`, но это не работает: секрет — **сегмент пути**, а сериализатор `req` пишет `url` целиком. Хуже: `all-exceptions.filter.ts:47` печатает `${method} ${url} → ${status}` одной строкой мимо сериализатора, а контроллер отвечает **404 при выключенном рубильнике** — то есть на боевом сервере без токена каждый настоящий апдейт Telegram писал бы действующий секрет в лог. Вырезаю в двух местах: в сериализаторе `req` и в хуке цензора.

**3. Фронт молча ломался.** Пакет 5 сменил контракт `key` → `maskedKey`, но `apps/web` **компилировался без ошибок** (свои локальные типы) и показывал бы `undefined` вместо ключа во всех списках и карточках. Свёл §7.9: 7 файлов. Полный ключ теперь берётся по нажатию через `GET /licenses/:id/key` — `CopyButton` научился принимать `() => Promise<string>`, чтобы ключ не оседал в кеше react-query и в состоянии страницы.

**4. `TelegramLinkProcessor` не знал про рубильник** и падал бы `unhandledRejection` при недоступном Redis (`set` вне `try`). Добавил `if (!this.config.enabled) return` и `.catch()` на взятие/снятие блокировки.

**5. Цензор ключей поставлен в `hooks.logMethod`, а не в `formatters.log`** — `redact` в pino работает по путям структурированных полей и текст сообщения не трогает вовсе. Проверил эмпирически, что pino-http не вызывает хук дважды.

## Рубильник `TELEGRAM_BOT_ENABLED=false` — проверено

Написал `test/app-module-boot.spec.ts`: собирает **весь граф `AppModule`** через `Test.createTestingModule().compile()`. Тест зелёный и **не требует БД и Redis** — подключения живут в `onModuleInit`, а `compile()` его не вызывает. Это то, чего `tsc` не проверяет в принципе: забытый провайдер и неэкспортированный сервис компилируются идеально и роняют процесс на старте.

Рубильник держится на четырёх границах: вебхук → 404, оба процессора → выход на первой строке, `initForUser` → `TELEGRAM_DISABLED`. Модуль регистрируется **всегда**: условная регистрация убрала бы контроллер привязки из маршрутов, и кабинет получал бы 404 вместо внятного кода ошибки. Токен при `enabled=false` никто не спрашивает (`config.token` бросает только при обращении) — тест это фиксирует.

## Владельцу — руками

**Переменные.** Корневого `.env` в проекте **нет вообще** — создать из `.env.example`. В `.env.production` вписаны только пустые ключи и инструкция, секретов я туда не писал:

1. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` — от @BotFather (токен лежит в `fif.txt`, я его не открывал).
2. `TELEGRAM_WEBHOOK_SECRET` — `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Не короче 32 символов, иначе API не стартует.
3. `TELEGRAM_ADMIN_CHAT_ID` — id группы, число отрицательное.
4. Только после этого `TELEGRAM_BOT_ENABLED=true` и рестарт.

`docker-compose` править не нужно: сервис `api` объявлен с `env_file`.

**Миграция.** `20260811120000_telegram_bot` написана, но **не применена** — Docker не поднимал по вашему правилу. Нужно `npm run db:deploy`, затем `npm run db:seed` (46 шаблонов уведомлений, дублей `(key, locale, channel)` нет — проверил).

**Вебхук.** `npm run tg:webhook set` → `npm run tg:commands`. Оба скрипта читают токен только из окружения.

## Осталось нерешённым (нужно ваше решение)

**Полный ключ лицензии лежит открытым в `notifications.payload`** — находка пакета 5, я её не закрывал. `hwid.service.ts` и `digiseller.service.ts` кладут `licenseKey` в payload, потому что **письменные** шаблоны его показывают (`seed.ts:412,422`). Санитайзер чистит только Telegram-копию. Для `license.issued` это оправдано — покупателю надо что-то ввести в загрузчик. Для `hwid.reset` ключ нужен лишь чтобы опознать лицензию, и там маски хватило бы — но это правка текста письма, то есть продуктовое решение, а не сборка. Не стал менять молча.

**`HwidService.statusFor` не отдаёт `maxResets`/`cooldownHours`** (просьба пакета 3). Из-за этого экран E-05 подписывает кулдаун глобальным значением, а не продуктовым `Product.hwidResetCooldownHours`. Точная дата (`nextResetAvailableAt`) верна всегда — расходится только словесная подпись у продукта с собственным кулдауном.

**§7.10 (сброс кэша `tg:actor` при блокировке) неисполним как написан.** Плана ссылался на `auth.service.ts:917-932`, но это проверка статуса **при входе**, а не момент блокировки. Грепом подтвердил: **кода, который переводит пользователя в `BLOCKED`, в проекте нет вовсе** — блокировка делается руками в БД. Когда появится ручка блокировки, в неё надо добавить `redis.del('tg:actor:' + userId)`. Пока лаг до 60 с закрыт тем, что `assertNotBlocked` читает мимо кэша перед каждым необратимым действием.

# === SECURITY ===

# Состязательный разбор безопасности Telegram-бота

Читал код, не отчёт. Находки есть — восемь, из них две серьёзные. Ниже по убыванию.

---

## 1. Реселлер выгружает полные ключи чужих лицензий кнопкой в чате

**Файлы:** `apps/api/src/modules/telegram-bot/screens/licenses.screen.ts:157`, `apps/api/src/modules/licenses/licenses.service.ts:569-602` и `718-741`, `apps/api/prisma/seed.ts:168-181`

`LicensesScreen.card()` добавляет кнопку «Показать ключ» **безусловно** — строка 157, никакой проверки владельца. Дальше `keyReveal` → `LicensesService.revealKey` → `assertCanTouch(license, actor, 'licenses.read')`, а он на строке 729-735 пропускает актора, если `license.resellerId` совпадает с его записью реселлера. У роли `reseller` (seed.ts:177) есть `licenses.read.own`, значит `resolveScope` = `'own'`, значит ветка реселлера срабатывает.

**Сценарий.** Реселлер продал 500 лицензий. Привязывает свой Telegram, жмёт `/licenses` — `LicensesService.list` (строки 477-479) подмешивает `{ resellerId }`, и в списке лежат лицензии его ПОКУПАТЕЛЕЙ. Тапает карточку → «Показать ключ» → получает полный ключ чужого человека. По коду же (`common/utils/license-key.ts:5-6`) ключ — предъявительский документ без привязки к аккаунту: кто увидел, тот и владеет.

**Что именно сломается.** Реселлер угоняет доступ у собственных покупателей. Лимит `tg:keyreveal:<chatId>` = 3/час его тормозит, но тот же `revealKey` доступен ему по HTTP на `GET /licenses/:id/key` (licenses.controller.ts:55-74) **вообще без лимита частоты** — 500 ключей одним скриптом. Бот здесь не источник дыры, но он единственное место, где эта возможность оформлена кнопкой.

Комментарий на licenses.screen.ts:299-304 факт «реселлер видит проданные им» проговаривает — и тут же на 157 даёт по ним кнопку раскрытия.

---

## 2. Лимит попыток привязки не работает: `confirm` вызывается ДО проверки

**Файл:** `apps/api/src/modules/telegram-bot/bot-router.service.ts:307-341`

```
313:    const result = await this.links.confirm(token, from, message.chat);
315:    if (!result.ok) {
317:      const withinLimit = await this.rate.hit(`tg:linkfail:${chatId}`, LINK_FAIL_LIMIT, ...);
326:        text: t(locale, withinLimit ? 'err.link_invalid' : 'err.link_rate'),
```

Гашение токена выполняется **всегда**. `rate.hit` стоит после и влияет ровно на одно: какую из двух строк показать. Лимита «5 неудач в час» (§7.5, комментарий на строке 52-54) в системе нет — он декоративный. Единственный настоящий потолок — `tg:msg:<chatId>` 20/мин (строка 185), и он снимается заведением второго Telegram-аккаунта.

**Что сломается.** Токен — 32 байта CSPRNG, перебрать его нельзя, поэтому это не пробитие, а отсутствующий рубеж. Но следствие конкретное: `/start <любая строка>` бесплатно и неограниченно вызывает `$queryRaw UPDATE telegram_link_codes` (bot-link.service.ts:385-392) — то есть запись в БД на каждое сообщение постороннего, без всякого бюджета. Плюс любое будущее сокращение токена (например, до кода из чата) окажется незащищённым, потому что защита выглядит написанной.

---

## 3. Два «независимых» секрета вебхука — на самом деле один

**Файлы:** `apps/api/src/modules/telegram-bot/telegram-webhook.controller.ts:22-37, 80`, `apps/api/scripts/telegram-webhook.ts:127-132`

Контроллер сверяет сегмент пути и заголовок `X-Telegram-Bot-Api-Secret-Token`, сравнение постоянное по времени (`timingSafeEqual`, строки 110-115), длина сравнивается заранее и её утечка обоснована. **Проверки как таковые в порядке.**

Но скрипт установки кладёт в оба места **одно значение**:
```
127:    const url = `${appUrl}/api/v1/telegram/webhook/${secret}`;
132:      secret_token: secret,
```

А комментарий контроллера (строки 25-29) обосновывает пару ровно тем, что «путь протекает в журналы обратного прокси… заголовок туда не попадает».

**Сценарий.** Тот, кто получил доступ к логам nginx / трассировкам / метрикам с URL (подрядчик, стажёр, утёкший бакет с логами), видит секрет пути — и он же есть секрет заголовка. Отправляет `POST /api/v1/telegram/webhook/<секрет>` с этим заголовком и телом любого апдейта. Дальше он **произвольный Telegram-пользователь**: подставляет `message.from.id` привязанного человека и получает его меню, `/licenses`, и — через `cb:key`→`cb:key_go` — полный ключ. Никакой подписи тела Telegram не ставит, проверять больше нечего.

Защита от этого в проекте есть — `maskWebhookSecret` в `common/logger/logger.module.ts:28-32` и в хуке `logMethod` (строки 200-215), — но она закрывает только СВОИ логи. Логи прокси и всё, что смотрит на URL снаружи процесса, ей не покрыты, а именно ими комментарий и оправдывает вторую копию секрета. Второй секрет обязан быть отдельным случайным значением.

---

## 4. `/admin` не проверяет область привязки — обход step-up и 30-дневного срока

**Файлы:** `apps/api/src/modules/telegram-bot/bot-router.service.ts:289-294`, `screens/admin.screen.ts:44`, `bot-link.service.ts:184-213`

`initForUser` требует TOTP всегда для `scope=ADMIN` (строка 205) и даёт такой привязке 30 дней вместо 90 (строки 57-58). Но `runCommand` в ветке `'admin'` зовёт `adminScreen.pending(ctx)`, а тот проверяет **только право** `licenses.create.any` — про `ctx.actor.link.scope` не спрашивает никто.

**Сценарий.** У администратора не включена 2FA (для `scope=USER` step-up тогда не требуется — строка 205 условия не выполняет). Угнана его веб-сессия. Атакующий шлёт `POST /auth/telegram/link/init` с `scope: "USER"` — ни кода, ни подтверждения — привязывает свой Telegram и получает `/admin` на **90 дней**, переживающих смену пароля. Ровно то, от чего step-up и заводился (комментарий строки 201-204).

Экран отдаёт только зависшие сделки Digiseller (номера счетов, суммы, id товаров) и кнопки выдачи не имеет — ущерб ограничен разглашением. Но контроль обойдён полностью, и следующий админский экран унаследует дыру молча.

Отдельно: `permissions` берутся из `loadActorProfile` с кэшем 300 с (`common/rbac/actor-profile.ts:23`), так что обещание admin.screen.ts:13 «право проверяется в момент вызова» выполняется с точностью до пяти минут.

---

## 5. Бот различает «лицензии нет» и «лицензия есть, но не ваша» — прямой ответ на п.8

**Файл:** `apps/api/src/modules/telegram-bot/bot-router.service.ts:654-671`

```
657:    if (code === 'NOT_FOUND') return this.expired(locale);   // «Действие устарело»
659:    const level = code === 'FORBIDDEN' ? 'error' : 'warn';
668:      text: t(locale, 'err.server'),                          // «Ошибка сервера»
```

`cb:lic:<uuid>` → `LicensesService.findById` бросает `NOT_FOUND` на несуществующую и `FORBIDDEN` на чужую (licenses.service.ts:548-553). Пользователь получает **два разных экрана**. То же на `cb:hwid:<uuid>` и `cb:key:<uuid>`.

Комментарий на строках 650-653 утверждает обратное — «ему общий текст, нам строка в журнале», — но общего текста нет: тексты разные.

**Что сломается.** Идентификатор, попавший на скриншот в поддержку или в чужой браузерной истории (`/licenses/<id>`), проверяется на существование одним нажатием. Перебором это не берётся — uuidv7 даёт ~74 бита случайности, — так что это оракул подтверждения, а не поиска. Плюс каждая такая проверка пишет `logger.error` (строка 664), то есть посторонний управляет уровнем error в журнале.

---

## 6. Бот сообщает, что код Digiseller настоящий и уже погашен другим человеком

**Файл:** `apps/api/src/modules/telegram-bot/screens/activate.screen.ts:112-116` и `303-308`, `apps/api/src/modules/billing/digiseller.service.ts:1085-1093`

Одинаковый текст `err.digiseller_used`, но **разные клавиатуры**:

| Состояние кода | Ответ бота |
|---|---|
| площадка не подтвердила | `err.digiseller_invalid` + [Активировать, Меню] |
| погашен ДРУГИМ аккаунтом (`CODE_ALREADY_USED`) | `err.digiseller_used` + [Поддержка, Меню] |
| погашен ВАМИ (`ALREADY_YOURS`) | `err.digiseller_used` + [Мои лицензии] |

Комментарий на строках 280-286 обещает: «`err.digiseller_invalid` не различает „код не существует“ и „код не ваш“». В коде «код не ваш» идёт по другой ветке (303) и в `err.digiseller_invalid` не попадает вовсе.

**Сценарий.** То же на пути «номер заказа + почта»: `parseOrderInput` (строка 217) принимает `^\d{4,20}$`, номера счетов Digiseller последовательны. Перебирая номера, атакующий отделяет реальные проданные заказы (`ORDER_ALREADY_USED`) от несуществующих (`ORDER_EMAIL_MISMATCH` → `err.digiseller_invalid`). Потолок — 60/час на Telegram-аккаунт (`digiseller:attempts:telegram:<id>`), так что это разведка, а не массовая выгрузка. Но состав валидных номеров плюс утёкшая почта покупателя = присвоение чужой покупки, потому что `redeemByOrder` больше ничего не требует.

---

## 7. Сообщение с полным ключом может остаться в переписке навсегда

**Файл:** `apps/api/src/modules/telegram-bot/screens/licenses.screen.ts:58-59, 355-368`

```
59: const KEY_MESSAGES_TTL_SEC = 900;
367:  setTimeout(...).unref();
```

Реестр неудалённых сообщений живёт в Redis 15 минут, таймер — в памяти процесса, подметание (`sweepKeyMessages`) идёт только на следующем апдейте **из этого чата**.

**Сценарий.** Человек раскрыл ключ, закрыл Telegram. Через 10 секунд выкладка/рестарт воркера — таймер потерян. Человек вернулся в бота через 20 минут: ключ в Redis уже истёк, реестр пуст, `sweepKeyMessages` находить нечего. Сообщение с рабочим ключом остаётся в облаке Telegram **навсегда**, и следа об этом нигде нет.

Обещание в шапке (строки 49-56) — «список в Redis переживает рестарт» — верно только первые 15 минут. TTL реестра обязан быть заметно больше `KEY_MESSAGE_TTL_SEC` и покрывать реальный интервал возвращения человека (часы, не минуты); плюс нужен фоновый проход, не зависящий от прихода апдейта.

---

## 8. Отвязать чат с сайта нельзя — интерфейса нет

**Файлы:** `apps/api/src/modules/telegram-bot/telegram-link.controller.ts:77-92`, `apps/web/src/routes/_app/`

Ручка `DELETE /api/v1/auth/telegram/link` написана и работает. Но во фронте Telegram-бота нет вообще: `grep -i telegram` по `apps/web/src` даёт три совпадения, и все — название OAuth-провайдера в списке входов. Маршрутов `/account`, `/account/telegram`, `/downloads` в `apps/web/src/routes/_app/` не существует.

**Что сломается.** Кнопки самого бота ведут в 404: `bot-router.service.ts:328` и `:632` (`/account/telegram`), `screens/account.screen.ts:70` (`/account`), `screens/activate.screen.ts:266` (`/downloads`). Работает только `screens/licenses.screen.ts:348` (`/licenses/:id`).

**Ответ на п.7 по существу.** Человек, потерявший доступ к Telegram, отвязать чат **через интерфейс не может** — только руками через API с Bearer-токеном. Привязку создать он тоже не может: единственный способ выпустить токен — тот же ручной вызов `POST /auth/telegram/link/init`.

**«Если аккаунт Telegram сменил владельца»** — не происходит ничего. `BotActorService.resolve` (bot-actor.service.ts:86-129) проверяет `revokedAt` и `expiresAt` и больше ничего: повторной проверки владения Telegram-аккаунтом в системе нет ни одной. Новый владелец номера получает список лицензий, полные ключи (3/час), сбросы HWID, обращения в поддержку и отвязку — до конца 90-дневного срока. `username` в кабинете обновляется через `touch()`, но при `username = undefined` (bot-actor.service.ts:181) сохраняется старое значение, так что даже этот слабый сигнал может не появиться.

---

## Что проверено и дыр не нашлось

**П.3, маска.** `maskLicenseKey` (`common/utils/license-key.ts:97-124`) — настоящая маска: проверка длины ≥ 12 стоит ДО разбора, четыре группы обязаны быть ровно по 4 символа (иначе uuid отдавался бы наполовину), неизвестный формат маскируется целиком. `toLicenseView` (bot-format.ts:275-285) применяет её повторно поверх сервисной. В логах бота полного ключа нет: `keyReveal` пишет только id (licenses.screen.ts:264), `submitRegistrationKey` не присваивает `licenseKey` переменной (activate.screen.ts:189), обращение в поддержку показывает владельцу маску (bot-support.service.ts:206). Хук `logMethod` (logger.module.ts:200-215) вычищает ключи из ТЕКСТА сообщений — то, чего `redact` не делает в принципе. `sanitizeTelegramPayload` (notification.service.ts:389-407) режет `licenseKey/key/code/password/token/secret` и дополнительно прогоняет остаток через цензор; `render` (строка 491) чистит уже отрендеренный текст — второй рубеж на случай `enqueue({channel: TELEGRAM})` напрямую.
*Остаётся* известная по отчёту сборки вещь: полный ключ лежит открытым в `notifications.payload` для писем. Наружу через API он не выходит — контроллера у модуля уведомлений нет.

**П.4, пароли и 2FA.** Бот их не принимает ни в одном сценарии. Состояний свободного ввода четыре (`bot-state.service.ts:54-62`): код Digiseller, номер заказа, регключ, текст обращения. Смены пароля и настроек 2FA в `AccountScreen` нет (комментарий строки 20-24 соблюдён). TOTP приходит только по HTTPS на `POST /auth/telegram/link/init`, вырезан и из логов (`logger.module.ts` — `req.body.totpCode`), и из аудита (`audit.service.ts:113-114` — `totpCode`/`totp_code` в `REDACTED_FIELD_NAMES`), что критично: `AuditInterceptor` кладёт в `after` **всё тело запроса целиком**.

**П.5, лимит Digiseller.** Общего бюджета нет. `RedeemContext.sourceKey` (digiseller.service.ts:163) заполняется как `telegram:<telegramUserId>` (activate.screen.ts:109 и 155), а вторая ось `checkAttemptLimit` (строка 1359) больше не хардкодит IP. Один человек чужой бюджет не съедает: 60/час на Telegram-аккаунт и 30/час на аккаунт сайта, независимо друг от друга. Перепривязка того же Telegram к свежесозданному аккаунту сайта обнуляет `tg:activate:<userId>` и `digiseller:attempts:<userId>`, но ось `telegram:<id>` при этом не меняется и держит потолок.
*Оговорка, которую надо знать:* `BotRateService.hit` (bot-rate.service.ts:55-62) и `bumpAttemptCounter` (digiseller.service.ts:1372-1378) при недоступном Redis возвращают «разрешено». При падении Redis **все** бюджеты попыток исчезают одновременно — и бота, и Digiseller. Раскрытие ключа при этом, наоборот, перестаёт работать (`consumeNonce`, bot-state.service.ts:174-184, fail-closed) — здесь размен выбран правильно.

**П.2, привязка чужого чата.** Гашение кода атомарное — один `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING` (bot-link.service.ts:385-392), гонка двух нажатий Start закрыта на уровне строки БД. В БД только `sha256(token)` (строка 219), TTL 10 минут, срок и повторное использование проверяются внутри того же UPDATE. `confirm` требует `chat.type === 'private' && chat.id === from.id` (строка 366). Выпуск кодов ограничен 5/час на аккаунт **до** проверки TOTP (строка 160) — то есть эндпоинт не превращается в стенд для перебора шестизначных кодов. Вытеснение чужой привязки шлёт и письмо, и прощание в чат (строки 446-467). Причины отказа сведены в один текст (строки 355-360) — здесь оракула нет, в отличие от п.5 и п.6 выше.

**П.6, логи.** Текстов сообщений, `callback_data`, кодов активации и `@username` в логах нет: процессор пишет `update_id` и id автора (telegram-update.processor.ts:101-115), маршрутизатор логирует только ИМЯ действия без идентификаторов (`callbackName`, строка 704), поддержка пишет номер обращения и id пользователя, но не текст (bot-support.service.ts:107-108). `chatId` в логи попадает — в ключах счётчиков (`bot-rate.service.ts:57`), при уходе из группы (`bot-router.service.ts:146`), при `chat_not_found` (`telegram.api.ts:480`) и у получателя уведомления (`telegram-channel.service.ts:60`). Токен бота живёт только в URL внутри `TelegramApiService.request` (telegram.api.ts:305) и никуда не печатается; `AbortSignal.timeout` и ошибки undici URL в `message` не несут.

**Разбор апдейтов.** `quoteLossyIntegers` (dto/telegram-update.types.ts:115-181) — честный сканер со знанием строковых литералов, а не регулярка по именам полей; глубина `reply_to_message` ограничена одним уровнем (строка 283), `callback_data` длиннее 64 байт отбрасывается (строка 303), текст режется до 4096 (строка 278). Очередь дедуплицирует по `update_id` через `SET NX` и имеет потолок 10 000.

# === CORRECTNESS ===

# Состязательный разбор Telegram-бота: корректность и полнота

Проверено чтением кода (не отчётов). `npx tsc --noEmit` в `apps/api` — чисто; `test/app-module-boot.spec.ts`, `telegram-webhook.spec.ts`, `bot-i18n.spec.ts`, `notification-telegram.spec.ts` — 48/48 зелёные.

---

## 1. Требование → файл → есть/нет

### Команды (§1.1)

| Требование | Файл | Есть |
|---|---|---|
| `/start` без payload → E-00 | `bot-router.service.ts:231` → `screens/root.screen.ts:33` | да |
| `/start <token>` → привязка | `bot-router.service.ts:214,307` → `bot-link.service.ts:362` | да |
| `/licenses` → E-03 | `screens/licenses.screen.ts:86` | да |
| `/activate` → E-08 | `screens/activate.screen.ts:57` | да |
| `/products` → E-11 | `screens/products.screen.ts:41` | да |
| `/account` → E-09 | `screens/account.screen.ts:51` | да |
| `/support` → E-12 | `screens/support.screen.ts:24` | да |
| `/help` → E-13 | `screens/help.screen.ts:24` | да |
| `/language` | `screens/account.screen.ts:136,158` | да |
| `/unlink` | `screens/account.screen.ts:181,197` | да |
| `/cancel` | `bot-router.service.ts:288` | да |
| `/admin` | `screens/admin.screen.ts:43` | да |
| `setMyCommands` ×2 (en + ru) | `scripts/telegram-commands.ts:103,107` | да |
| `/renew` (экран продления) | `screens/root.screen.ts:95` | **код есть, недостижим** — не в `setMyCommands`, нет в `screen.help`, ни одна кнопка не ведёт |

### Экраны (§1.3)

| Экран | Файл | Есть |
|---|---|---|
| E-00…E-02 | `root.screen.ts:33,45,59` | да |
| E-03, E-04 | `licenses.screen.ts:86,143` | да |
| E-05, E-06 | `hwid.screen.ts:46,103` | да |
| E-07 (confirm + reveal + автоудаление 90 с) | `licenses.screen.ts:188,225,355` | да |
| E-08 (3 способа) | `activate.screen.ts:57,89,127,178` | да |
| E-09, E-10 | `account.screen.ts:51,81,108` | да |
| E-11 | `products.screen.ts:41,72` | да |
| E-12, E-13 | `support.screen.ts:24,34`, `help.screen.ts:24` | да |

### Инфраструктура и §8

| Требование | Файл | Есть |
|---|---|---|
| Вебхук: два секрета, `timingSafeEqual`, 404 | `telegram-webhook.controller.ts:80,110` | да |
| Идемпотентность `SET NX tg:upd:` | `telegram-update.queue.ts:93` | да |
| `tg:chat-lock` / `tg:hwid-lock` | `telegram-update.processor.ts:87`, `hwid.screen.ts:239` | да |
| Все 7 лимитов §7.5 | `bot-rate.service.ts:13-19` + вызовы | да, все |
| FSM в Redis, TTL по состояниям | `bot-state.service.ts:27-40` | да |
| `allowed_updates`, `drop_pending_updates` | `scripts/telegram-webhook.ts:135,140` | да |
| **C1** явный select без `key` + `GET /licenses/:id/key` | `licenses.service.ts:569` | да |
| **C2** ось лимита `telegram:<id>` | `digiseller.service.ts:163,1359` | да |
| **C3** одноразовая ссылка на ключ | `licenses.screen.ts:344` — **нет**, ведёт в кабинет (задокументировано) | нет (P1) |
| **C4** эндпоинты привязки | `telegram-link.controller.ts` | да |
| **C5** канал TELEGRAM | `notification.service.ts:218`, `notification.processor.ts:305`, `telegram-channel.service.ts` | да |
| **C6** миграция | `prisma/migrations/20260811120000_telegram_bot/` | да |
| **Страница привязки в ЛК (§3.4 шаг 1)** | `apps/web/src/routes/` — маршрута нет | **НЕТ** |
| Telegram-копии `telegram.linked/unlinked/link_expiring` | шаблоны засеяны (`seed.ts:635-668`), enqueue только EMAIL | **нет** |
| `antifraud.alert` / `digiseller.pending` enqueue | нигде | нет (P2, по ТЗ) |
| `BotActorService.assertNotBlocked` | `bot-actor.service.ts:139` — **нигде не вызывается** | мёртвый код |

---

## 2. Находки

### F1 (блокер). Бота невозможно подключить: страницы `/account/telegram` во фронте не существует
`apps/web/src/routes/` содержит `_app/index, activate, catalog, licenses.$licenseId, admin.*, settings.security.*` — маршрутов `/account`, `/account/telegram`, `/downloads` нет вообще. Грep по `apps/web/src` на `telegram` даёт только метки OAuth-провайдера входа.

Куда ведут кнопки бота:
- `screens/root.screen.ts:37`, `help.screen.ts:28`, `bot-router.service.ts:328,632` → `{APP_URL}/account/telegram` — **404**;
- `screens/account.screen.ts:70` («Открыть кабинет») → `{APP_URL}/account` — **404**;
- `screens/activate.screen.ts:266` («Скачать») → `{APP_URL}/downloads` — **404**.

Сценарий: новый пользователь пишет `/start` → E-00 → «🔗 Подключить аккаунт» → страница не найдена. Единственный разрешённый путь привязки (§0.2 «строго сайт → бот») отсутствует, `POST /auth/telegram/link/init` не вызывается ниоткуда. Бот в проде бесполезен для 100 % пользователей. Косвенное подтверждение: `apps/web/src/lib/i18n/messages/ru.ts:567` до сих пор гласит, что «отдельной кнопки привязки из кабинета сервер пока не поддерживает».

### F2. `assertNotBlocked` не вызывается — заблокированный пользователь до 60 с делает необратимые действия
`bot-actor.service.ts:139` определён, `grep assertNotBlocked` по всему `src/` даёт только определение и комментарий. Комментарий `bot-actor.service.ts:30-32` («перечитывает статус мимо кэша перед каждым необратимым действием») — неверен.

Сценарий: админ ставит `users.status = BLOCKED` в БД. Кэш `tg:actor:<userId>` = `CACHED_LIVE` живёт ещё до 60 с (`ACTOR_TTL_SEC = 60`, строка 35). В это окно `actor.blocked === false`, и пользователь проходит `bot-router.service.ts:490` → жмёт «🔓 Сбросить привязку» → `hwid.screen.ts:119` `resetBySelf` выполняется; так же проходят `keyReveal` (полный ключ в чат) и `digiseller.redeem`. Ни `revealKey`, ни `resetBySelf` статус пользователя не проверяют.

### F3. Врёт про поддержку: «я их всё равно не передам»
`i18n/ru.ts:121`: «Пароли, коды и ключи присылать не нужно — **я их всё равно не передам**». `i18n/en.ts:142`: «I will not pass them on anyway».

`bot-support.service.ts:219` кладёт текст целиком: `escapeHtml(text)`. Фильтрации нет — доккомментарий `screens/support.screen.ts:13-14` сам это подтверждает («он не фильтрует и не должен»).

Сценарий: пользователь пишет в `/support` «мой пароль Qwerty!234 не подходит» → сообщение уходит в админ-чат дословно и остаётся в переписке владельца навсегда. Обещание в предыдущем сообщении прямо противоположно.

### F4. Врёт в E-01: «перейдите по ссылке в письме» и «я напомню»
`i18n/ru.ts:29-32` / `en.ts:34-37`:
- «Мы отправили письмо — если подключение делали не вы, **перейдите по ссылке в письме** и отключите бота». Шаблон `telegram.linked` EMAIL (`seed.ts:521,526`) **не содержит ни одной ссылки**, он отсылает в «Аккаунт → Telegram» — страницу из F1, которой нет. Жертва угона, которой сообщение реально адресовано, ссылки не находит и отключить бота не может ничем, кроме `/unlink` в чужом чате.
- «Ближе к этой дате **я напомню** продлить его». Напоминание ставится только в почту: `telegram-link.processor.ts:142` `enqueue({channel: EMAIL})`. В чат оно не придёт никогда.

### F5. Telegram-копии трёх SECURITY-событий засеяны, но не отправляются
`telegram-link.processor.ts:142,207`, `bot-link.service.ts:331,461,469`, `telegram.api.ts:472` — везде `enqueue({channel: NotificationChannel.EMAIL})`, `enqueueMulti` не используется. Шаблоны `telegram.linked`, `telegram.unlinked`, `telegram.link_expiring` для `channel: TELEGRAM` (`seed.ts:635,650,660`) — мёртвые строки. §6.1 требует эти три события как канал TELEGRAM.

Сценарий: за 7 дней до истечения привязки человек не получает предупреждения в том самом чате, который вот-вот отключится. Только письмо, которое можно пропустить, и в нём — ссылка на несуществующую страницу (F1).

### F6. Двойная доставка уведомления при недоступном Telegram/SMTP
`notification.processor.ts:56` `LOCK_TTL_SEC = 30`, тик каждые 5 с (`:13`). Одна отправка в Telegram при мёртвом API занимает до **53 с**: `telegram.api.ts:23` таймаут 10 с × 4 попытки + паузы `RETRY_DELAYS_MS = [1000,3000,9000]` (`:30`). Пакет — 20 строк (`:15`), то есть до 17 минут.

Замок протухает через 30 с, следующий тик берёт его заново. Выборка `:160-167` содержит условие `{ attempts: attemptsDone, failedAt: null }`, а `:193-196` увеличивает `attempts` **до** отправки и не пишет `failedAt`. Значит строка, которая прямо сейчас висит в `deliver()` (`attempts = 1`, `failedAt = null`, `status = PENDING`), попадает в выборку второго прохода и **отправляется повторно**. Дополнительно `finally` на `:140` делает `del(LOCK_KEY)` без проверки владельца и снимает замок уже с чужого прохода.

Сценарий: `api.telegram.org` недоступен 20 минут → письмо «лицензия отозвана» уходит пользователю 2-3 раза; при восстановлении Telegram то же самое приходит дублями в чат.

### F7. Отброшенный апдейт теряется навсегда, комментарий утверждает обратное
`telegram-update.queue.ts:100-108`: ключ идемпотентности `tg:upd:<id>` ставится **до** `lpush`. При переполнении (`:103`, `MAX_QUEUE_LEN = 10000`) или недоступности Redis (`:111`) возвращается `dropped`, а `telegram-webhook.controller.ts:97-99` на это лишь пишет `warn` и **отвечает 200**. Telegram считает апдейт доставленным и не повторит его. Комментарии `:44` («Telegram повторит то, что мы потеряли») и `:112-113` («Telegram повторит апдейт») неверны.

Сценарий: Redis моргнул на секунду → нажатие «Да, сбросить» исчезает бесследно, бот молчит, часики у пользователя крутятся до таймаута клиента.

### F8. E-05 называет неверный кулдаун для продукта с собственной настройкой
`hwid.screen.ts:233-235` берёт **глобальную** `limits.hwid.reset_cooldown_hours` (по умолчанию 24). Фактический кулдаун считается по `Product.hwidResetCooldownHours` (`hwid.service.ts:638-651`).

Сценарий: у продукта `hwidResetCooldownHours = 72`. Экран подтверждения (`hwid.screen.ts:87`) говорит «Следующий сброс будет доступен не раньше чем через 24 часа», и то же неверное число подставляется в `err.hwid_cooldown` (`:71,171`). Человек сжигает сброс, приходит через сутки и получает отказ. Дата `nextResetAvailableAt` при этом верна — экран противоречит сам себе.

### F9. Русская фраза в английском письме о выдаче лицензии
`digiseller.service.ts:1053`: `expiresAt: 'начнётся с первого запуска'` — жёстко зашитая русская строка в payload. Шаблон `license.issued/en/EMAIL` (`seed.ts:448`) подставляет её в «Valid: {{expiresAt}}».

Сценарий: покупатель с `locale = en` получает письмо «Valid: начнётся с первого запуска».

### F10. `{{resetAt}}` в чат уходит ISO-строкой
`hwid.service.ts:575` `resetAt: new Date().toISOString()`; шаблон `seed.ts:626` — «Привязка к компьютеру сброшена {{resetAt}}». В чате: «сброшена 2026-08-10T12:34:56.789Z». Все остальные даты бот форматирует через `bot-format.ts:143` с поясом.

### F11. Полный ключ может остаться в чате навсегда
`licenses.screen.ts:59` `KEY_MESSAGES_TTL_SEC = 900`: реестр неудалённых сообщений живёт 15 минут, а подметание (`:275`) срабатывает только на следующем апдейте из этого чата (`bot-router.service.ts:192,436`).

Сценарий: пользователь раскрыл ключ, процесс перезапущен через 10 с (выкладка) — `setTimeout` (`:365`) умер вместе с процессом. Пользователь возвращается в чат через час — реестр в Redis уже истёк, `readKeyMessages` возвращает `[]`. Сообщение с полным ключом остаётся в переписке навсегда, вопреки обещанию «Удалю через 90 сек» (`i18n/ru.ts:77`).

### F12. `answerCallbackQuery` не в `finally`
`bot-router.service.ts:450-455`: если `editScreen` бросит (Telegram 400/таймаут), исключение уходит наверх и `answerCallbackQuery` не вызывается. У пользователя крутятся часики до таймаута клиента. Дополнительно `handleCommand:255-260` в `catch` вызывает `sendScreen` ещё раз — при мёртвом Telegram это второй цикл ретраев, ~106 с на одну команду.

### F13. Карточка продукта с 6+ тарифами теряет кнопку «Назад»
`products.screen.ts:113` `kb([...buyButtons, [назад]], { max: 6 })`, `bot-keyboard.ts:78-81` при превышении обрезает хвост. У продукта с шестью тарифами кнопка «⬅️ К каталогу» отбрасывается — с экрана нет выхода, кроме ввода команды.

### F14. `TelegramSupportThread` осиротеет при вытеснении привязки
`bot-link.service.ts:561` `deleteMany` физически удаляет вытесненную привязку, а у `telegram_support_threads` внешнего ключа нет (осознанно, `schema.prisma:1495`). `bot-support.service.ts:149-156` ищет `telegramLink.findUnique({ id: thread.linkId })` → `null` → ответ владельца по открытому обращению не доставляется, пишется `warn`.

---

## 3. Ответы на вопросы 3–8

**3. Недоступный Telegram API.** Обработка **не виснет** и апдейты **не теряются** (кроме F7): `request()` ограничен 4 обменами (`telegram.api.ts:308-350`), бесконечных повторов нет, `takeGlobalSlot` завершается всегда. Но: одна отправка стоит до 53 с; `tg:chat-lock` живёт 10 с (`telegram-update.processor.ts:43`), `tg:updates:lock` — 30 с (`:31`), то есть при недоступном API оба замка протухают под работающим обработчиком и каждые 30 с стартует ещё один параллельный разбор пакета — рост числа висящих запросов в памяти. Уведомления не теряются (8 попыток / ~8 ч), но дублируются (F6). Отдельно: `classify()` (`:402-430`) отправляет любой нераспознанный 4xx, включая **401 «Unauthorized» при смене токена бота**, в `bad_request` → `notification.processor.ts:260` считает отказ окончательным → все Telegram-уведомления немедленно `FAILED` без повтора.

**4. Путь уведомления.** Работает целиком: `enqueueMulti` (`notification.service.ts:178`) → `enqueueTelegram` (`:218`, фильтры: рубильник → категория → привязка → scope ADMIN → подписка → дедуп 6 ч → потолок 10/ч) → `recipient = String(link.chatId)` (`:280`) → строка в `notifications` → `processor.deliver` (`:305`) → `TelegramChannelService.send` → `TelegramApiService.sendMessage`. **Пользователь без чата получает молчание, не ошибку**: `:243` `if (!link) return null`, письмо при этом уходит всегда (`:186`). Прямой `enqueue({channel: TELEGRAM})` без привязки — `resolveRecipient` (`:562`) вернёт `null`, `:130-133` пишет `warn` и возвращает `null`, строка не создаётся. Ключ вырезается механизмом (`:389-407`) и повторно цензурируется после рендера (`:491`).

**5. Двойная доставка апдейтов.** Защита есть и работает: `SET NX tg:upd:<update_id> EX 3600` (`telegram-update.queue.ts:93`), дубль отбрасывается молча. Второй рубеж — `consumeNonce` через атомарный `GETDEL` (`bot-state.service.ts:175`), третий — `tg:hwid-lock` (`hwid.screen.ts:239`). Одно и то же сообщение дважды не обработается. Обратная сторона — F7: ключ дедупликации ставится до постановки в очередь, поэтому потерянный при переполнении/сбое Redis апдейт не будет повторён ни Telegram (мы ответили 200), ни нами.

**6. Тексты.** Полностью двуязычны. Скриптовая сверка `i18n/en.ts` и `i18n/ru.ts`: **по 131 ключу, расхождений 0**, наборы плейсхолдеров `{{…}}` совпадают в каждом ключе. Тип `Record<MessageKey, string>` (`ru.ts:15`) ловит расхождение на компиляции. Проверка HTML-разметки — все теги закрыты, недопустимых для Telegram нет. Забытых односторонних строк нет. Мёртвые ключи (объявлены в обоих словарях, не используются нигде): `btn.buy`, `err.password_required`.

**7. `TELEGRAM_BOT_ENABLED=false`.** API стартует и ничего не требует — подтверждено запуском `test/app-module-boot.spec.ts` (собирает весь граф `AppModule`, зелёный). `env.schema.ts:418` `if (!env.TELEGRAM_BOT_ENABLED) return` — токен/секрет/username не проверяются. Рубильник держится на четырёх границах: вебхук → 404 (`telegram-webhook.controller.ts:70`), `TelegramUpdateProcessor.tick` → выход (`:58`), `TelegramLinkProcessor.run` → выход (`:79`), `initForUser` → `TELEGRAM_DISABLED` (`bot-link.service.ts:147`), плюс `TelegramApiService.request` → `bad_request` (`:298`). `config.token` бросает только при обращении (`telegram-bot.config.ts:38`), в конструкторах не трогается. Замечание: оба процессора бота берут замок через `.catch(() => null)`, а `NotificationProcessor.tick:130` — нет, поэтому недоступный Redis даёт там необработанное отклонение внутри `@Interval`.

**8. Миграция.** Применится на боевой базе с данными. `20260811120000_telegram_bot/migration.sql`: два новых enum, четыре новые таблицы, индексы и FK — на существующие данные не влияют. Единственная правка существующей таблицы — `ALTER TABLE "notifications" ADD COLUMN "scheduled_at" TIMESTAMPTZ(3)` — **nullable, без DEFAULT**, то есть метаданная операция без переписывания таблицы. **NOT NULL без значения по умолчанию на непустой таблице нет ни одного.** Схема и SQL согласованы (`schema.prisma:1311,1332` ↔ SQL). Единственный эксплуатационный нюанс: `CREATE INDEX "notifications_channel_status_scheduled_at_idx"` идёт без `CONCURRENTLY` (и не может — Prisma гоняет миграцию в транзакции) и на время построения блокирует запись в `notifications`, то есть все `enqueue()` подвиснут. На миллионах строк это заметно; лучше выкладывать в окно.

# === FINAL ===

All checks pass. Final state: `tsc --noEmit` clean, API builds (118 files), web builds, 211/211 tests green (signature.service.spec — 5 pre-existing failures, требует живой Redis, не трогал).

---

# ОТЧЁТ: ПОЧИНКА НАХОДОК РАЗБОРОВ

## 1. Что реализовано (коротко)

| Пакет | Суть |
|---|---|
| **Доступ к ключам** | Полный ключ лицензии больше не отдаётся реселлеру — ни по HTTP, ни кнопкой в боте |
| **Вебхук** | Два секрета стали двумя РАЗНЫМИ значениями (новая переменная), совпадение отвергается схемой окружения |
| **Привязка** | Лимит неудач стал настоящим; `/admin` требует область привязки ADMIN; ответы бота перестали быть оракулами |
| **Блокировка** | `assertNotBlocked` включён в четыре необратимых сценария |
| **Очереди** | Потерянный апдейт → 503 вместо 200; двойная доставка уведомлений закрыта владением замка |
| **Ключи в чате** | Реестр живёт 48 ч (потолок Bot API), заведён фоновый проход раз в минуту |
| **Тексты** | Убраны три обещания, которых код не исполнял |
| **Фронт** | Создана страница `/account/telegram` — единственный вход в сценарий привязки |

---

## 2. Находки: что подтвердилось, что отклонено

### Подтверждено и починено (19)

**Безопасность**

| № | Находка | Проверка | Правка |
|---|---|---|---|
| S1 | Реселлер выгружает полные ключи покупателей | Подтверждено: роль `reseller` имеет `licenses.read.own` (`seed.ts:177`), `assertCanTouch` пропускает по `resellerId` (`licenses.service.ts:729-735`), `list` подмешивает ему лицензии покупателей | `revealKey` теперь требует владельца или `licenses.read.any`. Кнопка «Показать ключ» рисуется только владельцу, `keyConfirm` проверяет владельца повторно (callback_data присылает клиент) |
| S2 | Лимит попыток привязки декоративен | Подтверждено: `rate.hit` стоял ПОСЛЕ `links.confirm` и влиял только на текст | Бюджет списывается ДО гашения кода; успех обнуляет счётчик |
| S3 | Два секрета вебхука — на самом деле один | Подтверждено: `scripts/telegram-webhook.ts:127,132` подставлял одно значение | Заведена `TELEGRAM_WEBHOOK_HEADER_SECRET`. Схема окружения падает при совпадении и при длине < 32. Тест «секрет пути в заголовке → 404» |
| S4 | `/admin` не проверяет область привязки | Подтверждено: `admin.screen.ts:44` смотрел только право | Добавлена проверка `link.scope === ADMIN` перед проверкой права |
| S5 | Бот различает «нет лицензии» и «не ваша» | Подтверждено: `NOT_FOUND` → «устарело», `FORBIDDEN` → «ошибка сервера» | Один экран на оба кода; в журнал уровень `warn`, а не `error` (посторонний больше не управляет уровнем error) |
| S6 | Оракул по номерам заказов Digiseller | Подтверждено: `CODE_ALREADY_USED`/`ORDER_ALREADY_USED` имели свой текст И свою клавиатуру | Слиты с остальными отказами: один текст, одна клавиатура (кнопка поддержки теперь во всех). `ALREADY_YOURS` осталась отдельной — она про свой же аккаунт, оракулом не является |
| S7 | Ключ может остаться в переписке навсегда | Подтверждено: реестр 900 с, подметание только на апдейте из того же чата | TTL реестра = 48 ч (потолок `deleteMessage` у Bot API), заведён индекс чатов `tg:keymsg:chats` и фоновый проход раз в минуту, не зависящий от возвращения человека |

**Корректность**

| № | Находка | Правка |
|---|---|---|
| F1 | Страницы `/account/telegram` нет — бота невозможно подключить | Создана страница + `features/telegram/api.ts` + пункт меню. Кнопки «Открыть кабинет» и «Скачать» перенаправлены на существующие адреса |
| F2 | `assertNotBlocked` не вызывается нигде | Вызывается перед `hwid_go`, `key_go`, `unlink_go` и перед тремя состояниями свободного ввода. Код `ACCOUNT_BLOCKED` рисует свой экран |
| F3 | «Пароли я всё равно не передам» — неправда | Текст заменён на честный в обеих локалях |
| F4 | E-01: «ссылка в письме» (её нет) и «я напомню» (только почта) | Текст исправлен; напоминание теперь действительно приходит в чат (см. F5) |
| F5 | Telegram-копии SECURITY-событий не отправляются | `telegram.link_expiring` переведён на `enqueueMulti`. Два других — отклонено, см. ниже |
| F6 | Двойная доставка уведомлений | Замок помечается случайным токеном, продлевается перед каждым уведомлением, снимается только владельцем (Lua). `failedAt` проставляется в момент НАЧАЛА попытки — строка в полёте больше не подходит под выборку |
| F7 | Отброшенный апдейт теряется навсегда | `push` различает `invalid` (200) и `unavailable` (503). Ключ идемпотентности снимается, если апдейт не попал в очередь — иначе повтор Telegram отбросился бы как дубль |
| F8 | E-05 называет неверный кулдаун | `statusFor` отдаёт `maxResets` и `cooldownHours` (продуктовые, с откатом к глобальным); экраны берут их оттуда |
| F9 | Русская фраза в английском письме | Подпись выбирается по `user.locale` |
| F10 | `{{resetAt}}` уходит ISO-строкой | Формат `2026-08-10 12:34 UTC` |
| F11 | = S7 | |
| F12 | `answerCallbackQuery` не в `finally` | Обёрнут в `try/finally`, сам вызов с `.catch` |
| F13 | Карточка с 6 тарифами теряет «Назад» | Кнопки покупки режутся по 5, потолок считается от факта (`buyButtons.length + 1`) |
| F14 | Осиротевший тред поддержки | `deliveryLink` ищет по `linkId`, при промахе — по `userId`: адресат ответа это человек, а не строка привязки |
| — | `/renew` недостижим | Добавлен в `screen.help` (в `setMyCommands` не выводим — там семь ежедневных команд) |
| — | 401 от Bot API → `bad_request` → мгновенный FAILED всех уведомлений | 401 классифицируется как `transient`: ротация токена больше не сжигает очередь за один тик |
| — | `NotificationProcessor.tick` брал замок без `.catch` | Добавлен — недоступный Redis больше не даёт `unhandledRejection` внутри `@Interval` |

### Отклонено

**F5 в части `telegram.linked` и `telegram.unlinked` как канал TELEGRAM.** Разбор предлагает перевести обе на `enqueueMulti`. Проверено по коду — правка была бы вредной:

- **`telegram.linked`**: единственный получатель канала TELEGRAM для этого пользователя — привязка, созданная строкой выше, то есть ТОТ ЖЕ чат, куда маршрутизатор через миг рисует экран E-01 с тем же смыслом. Человек получил бы «✅ Готово, бот подключён» и следом «🔗 Бот подключён» подряд. §3.4 ТЗ (`docs/TZ-TELEGRAM-BOT.md:671`) предписывает здесь именно письмо. Я сначала сделал `enqueueMulti`, затем откатил и оставил разбор в комментарии.
- **`telegram.unlinked`**: к моменту отправки привязка уже отозвана, `resolveRecipient` вернёт `null`, строка не создастся вовсе — это ровно то, о чём говорит комментарий в `seed.ts:648-652`. Роль копии в чате исполняют `screen.unlink.done` и `sayFarewell`.

**Кэш прав 300 с у `/admin`** (замечание в разборе безопасности п.4). Факт верен: `loadActorProfile` кэширует права на пять минут, и «право проверяется в момент вызова» выполняется с этой точностью. Не чинил: экран отдаёт только зависшие сделки и кнопок не имеет, а сброс кэша прав — это отдельный механизм инвалидации на всю платформу, а не правка бота.

---

## 3. Изменённые и созданные файлы

**API — исходники**

```
C:/Users/user/work/kwork/license-platform/apps/api/src/common/config/env.schema.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/licenses/licenses.service.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/hwid/hwid.service.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/billing/digiseller.service.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/notifications/notification.processor.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/telegram-bot.config.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/telegram-webhook.controller.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/telegram-update.queue.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/telegram-update.processor.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/telegram-link.processor.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/telegram.api.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/bot-router.interface.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/bot-router.service.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/bot-link.service.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/bot-support.service.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/screens/licenses.screen.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/screens/hwid.screen.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/screens/activate.screen.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/screens/admin.screen.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/screens/products.screen.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/screens/account.screen.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/i18n/en.ts
C:/Users/user/work/kwork/license-platform/apps/api/src/modules/telegram-bot/i18n/ru.ts
C:/Users/user/work/kwork/license-platform/apps/api/scripts/telegram-webhook.ts
```

**API — тесты**

```
C:/Users/user/work/kwork/license-platform/apps/api/test/telegram-webhook.spec.ts   (переписан: 11 тестов, +«секрет пути в заголовке НЕ подходит», +503/200)
C:/Users/user/work/kwork/license-platform/apps/api/test/licenses-reveal.spec.ts    (+2: реселлеру ключ не отдаётся, карточка ему по-прежнему отдаётся)
C:/Users/user/work/kwork/license-platform/apps/api/test/env.schema.spec.ts         (+5: пара секретов, совпадение, пустой, короткий)
```

**Фронт — создано**

```
C:/Users/user/work/kwork/license-platform/apps/web/src/features/telegram/api.ts
C:/Users/user/work/kwork/license-platform/apps/web/src/routes/_app/account.telegram.tsx
```

**Фронт — изменено**

```
C:/Users/user/work/kwork/license-platform/apps/web/src/components/app-shell.tsx
C:/Users/user/work/kwork/license-platform/apps/web/src/lib/api/error-codes.ts
C:/Users/user/work/kwork/license-platform/apps/web/src/lib/i18n/messages/en.ts
C:/Users/user/work/kwork/license-platform/apps/web/src/lib/i18n/messages/ru.ts
C:/Users/user/work/kwork/license-platform/apps/web/src/routeTree.gen.ts   (сгенерирован `tsr generate`)
```

**Корень**

```
C:/Users/user/work/kwork/license-platform/.env.example
C:/Users/user/work/kwork/license-platform/.env.production
```

---

## 4. Что осталось незакрытым

**Нельзя проверить без живого сервера.** Ни одна правка не проверена в бою: Docker не поднимал (ваше правило), миграция не применена, вебхук не зарегистрирован. Статически проверено всё, динамически — только то, что покрыто тестами. Конкретно НЕ проверено вживую:

- фоновая уборка сообщений с ключами (`sweepTick`) — правильность `srandmember` по индексу и поведение `deleteMessage` на сообщении старше 48 часов;
- продление замка очереди уведомлений через Lua (`eval` с одним ключом) — сценарий «медленная отправка дольше 30 с»;
- ответ 503 на вебхук: то, что Telegram действительно повторит апдейт с нарастающей паузой, а не отвалится, взято из документации Bot API, а не из наблюдения;
- страница `/account/telegram` целиком: собирается и типизируется, но ни один запрос по ней не выполнялся.

**Не чинил намеренно (осознанные ограничения, а не пропуски):**

1. **Смена владельца аккаунта Telegram не отслеживается.** `BotActorService.resolve` проверяет только `revokedAt` и `expiresAt`. Новый владелец номера получает список лицензий и сбросы HWID до конца 90-дневного срока. Механизма повторной проверки владения в Telegram не существует в принципе — только сокращение срока привязки.
2. **`GET /licenses/:id/key` без лимита частоты.** После правки владелец может выгружать только СВОИ ключи, поэтому угрозы больше нет, но потолка на ручке по-прежнему нет.
3. **Полный ключ в `notifications.payload`** — письменные шаблоны его показывают. Telegram-копию чистит санитайзер. Для `hwid.reset` ключ нужен лишь для опознания и маски хватило бы, но это правка текста письма — продуктовое решение (см. п. 5).
4. **`antifraud.alert` и `digiseller.pending` не ставятся в очередь нигде** (P2 по ТЗ, §6.1). Шаблоны засеяны, кода нет.
5. **C3 — одноразовая ссылка на ключ** (P1). Кнопка «Открыть на сайте» ведёт в кабинет; страница требует входа, поэтому утёкшая из переписки ссылка ключа не открывает.
6. **Мёртвые ключи i18n бота**: `btn.buy`, `btn.download`, `err.password_required`. `btn.download` осиротел моей правкой — раздела загрузок в проекте нет вовсе.
7. **Кэш прав 300 с** у `/admin` (см. «Отклонено»).

---

## 5. ЧТО ДОЛЖЕН СДЕЛАТЬ ВЛАДЕЛЕЦ РУКАМИ

### Переменные окружения — ИЗМЕНИЛОСЬ

Корневого `.env` в проекте нет — создать из `.env.example`.

**Секретов вебхука теперь ДВА, и они обязаны различаться.** Старый набор переменных API не примет: при `TELEGRAM_BOT_ENABLED=true` схема окружения падает на старте, если `TELEGRAM_WEBHOOK_HEADER_SECRET` пуст, короче 32 символов или равен `TELEGRAM_WEBHOOK_SECRET`.

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # → TELEGRAM_WEBHOOK_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # → TELEGRAM_WEBHOOK_HEADER_SECRET
```

Порядок целиком:

1. `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` — от @BotFather (токен в `fif.txt`, я его не открывал).
2. Два секрета выше, **разными вызовами команды**.
3. `TELEGRAM_ADMIN_CHAT_ID` — id группы, число отрицательное.
4. Только после этого `TELEGRAM_BOT_ENABLED=true` и рестарт `api`.

`docker-compose` править не нужно: сервис `api` объявлен с `env_file`, новая переменная подхватится сама.

### Миграция и сид

`20260811120000_telegram_bot` по-прежнему **не применена**. Нужно `npm run db:deploy`, затем `npm run db:seed`. Выкладывать лучше в окно: `CREATE INDEX notifications_channel_status_scheduled_at_idx` идёт без `CONCURRENTLY` (Prisma гоняет миграцию в транзакции) и на время построения блокирует запись в `notifications`.

### Вебхук

`npm run tg:webhook set` → `npm run tg:commands`. Скрипт теперь требует ОБЕ переменные и сам отказывается работать, если значения совпали.

### Решения, которые ждут вашего ответа

1. **Ключ лицензии в письме о сбросе HWID.** Сейчас `hwid.reset` кладёт в payload полный ключ, потому что письменный шаблон его показывает (`seed.ts:412,422`). Для опознания лицензии хватило бы маски. Менять текст письма — ваше решение, я не стал делать это молча.
2. **Срок привязки 90 дней.** Единственная защита от «номер Telegram сменил владельца» — истечение срока. Если считаете риск существенным, срок надо сокращать (константа `USER_LINK_DAYS` в `bot-link.service.ts`); никакого технического способа перепроверить владение чужим аккаунтом Telegram не существует.
3. **Раздел загрузок.** Кнопка «Скачать» после активации теперь ведёт на страницу лицензии, потому что `/downloads` нет ни во фронте, ни в API. Если раздел планируется — верните `btn.download` и адрес.