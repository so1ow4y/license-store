# План первой версии фронтенда `apps/web`

Источники: фактическая карта контроллеров (`apps/api/src/modules/**/*.controller.ts`), TZ-требования по кабинету, состояние машины. Все машинные коды ниже взяты из кода (`throw ... code: 'X'`), не придуманы.

---

## 0. Исходные константы, от которых всё считается

| Что | Значение | Откуда |
|---|---|---|
| Базовый URL API | `http://localhost:3000/api/v1` (глобальный префикс `api` + URI-версия `1`) | `main.ts:137-138` |
| Health вне версии | `/health/live`, `/health/ready` | `main.ts:137` (exclude) |
| Origin фронта | **строго** `http://localhost:5173` | CORS `main.ts:119`, сид `prisma/seed.ts:22,274,276` |
| Разрешённые заголовки | `Content-Type, Authorization, X-Api-Key, X-Signature, X-Timestamp, X-Client-Version, Accept-Language` | `main.ts:122-130` |
| Конверт ошибки | `{ statusCode, code, message, details? }`, `details` — либо массив строк валидации, либо все «лишние» поля исключения (напр. `nextAllowedAt`) | `all-exceptions.filter.ts:60-110` |
| Cookie | сервер **не ставит ни одной** — токены только в теле ответа | — |

Стек: **Vite 7 + React 19 + TS + Tailwind v4 + shadcn/ui, TanStack Router (file-based) + TanStack Query, react-hook-form + zod, npm.**
При `npm i` заранее разрешить postinstall для `esbuild` и `@tailwindcss/oxide` (`onlyBuiltDependencies` в `apps/web/package.json`), иначе установка пройдёт молча, а `vite build` упадёт.

---

## 1. Приоритет: что разблокирует живых пользователей

**Волна 0 — без неё регистрация физически не завершается.** Письма уже уходят и содержат ссылки `${frontendUrl}/verify-email?token=...` (`auth.service.ts:155`) и `${frontendUrl}/reset-password?token=...` (`auth.service.ts:545`). Сегодня обе дают 404. Это два самых дешёвых экрана в проекте и одновременно самые блокирующие — делать первыми, до дизайна, до кабинета, до всего.

Далее по убыванию: вход → просмотр лицензий → активация покупки (единственный денежный путь) → HWID → безопасность → админ-минимум по зависшим сделкам.

---

## 2. Общий каркас

### 2.1 Хранение токенов

Cookie сервер не ставит, `refreshToken` принимается **в теле** `POST /auth/refresh` — значит хранение целиком на клиенте, вариантов «httpOnly» нет.

- `accessToken` — **только в памяти** (модульная переменная в `lib/auth/token-store.ts`), никогда не в storage.
- `refreshToken` — `localStorage` под одним ключом `lp.rt`. Это сознательный компромисс: без персистентности выживание сессии между перезагрузками невозможно. Ограничить ущерб: единственный модуль-владелец ключа, никаких токенов в Redux/Query-кеше, CSP на nginx (в API она выключена намеренно, `main.ts:110-112`).
- На старте приложения — «холодный» `refresh`: если `lp.rt` есть, дергаем `/auth/refresh`, до ответа рисуем сплэш, не рендерим защищённые маршруты.

### 2.2 Обновление по истечении и single-flight

`POST /api/v1/auth/refresh` ротирует пару. Отсюда — **обязательна очередь**: два параллельных 401 не должны вызвать два refresh, второй получит `TOKEN_REUSED` и убьёт всю сессию.

```
refreshPromise: Promise|null   // один на всё приложение
401 → если refreshPromise есть — ждём его, иначе создаём
успех → подменяем токены, повторяем исходный запрос ровно один раз
провал → hardLogout()
```

Реакция на коды из `token.service.ts` / `jwt-auth.guard.ts`:

| Код | Статус | Действие фронта |
|---|---|---|
| `TOKEN_EXPIRED` | 401 | тихий refresh, повтор запроса |
| `UNAUTHORIZED` | 401 | тихий refresh, повтор запроса |
| `TOKEN_REUSED` | 401 | `hardLogout()` + баннер «сессия завершена из соображений безопасности, войдите заново» — вся цепочка погашена, повтор бессмыслен |
| `TOKEN_REVOKED`, `SESSION_REVOKED` | 401 | `hardLogout()`, текст «сессия завершена» (типично после смены пароля или отключения 2FA) |
| `TOKEN_INVALID` | 401 | `hardLogout()` без объяснений |
| `FORBIDDEN` | 403 | экран «недостаточно прав», **не** разлогинивать |
| `TWO_FACTOR_SETUP_REQUIRED` | 403 | редирект на `/settings/security/2fa` — привилегированная операция требует включённого второго фактора (`permissions.guard.ts:106`) |
| `DATABASE_UNAVAILABLE`, `INTERNAL_ERROR` | 5xx | тост «сервис недоступен», retry только для GET |

`hardLogout()` = очистить память + `localStorage`, `queryClient.clear()`, редирект на `/login?reason=...`.

### 2.3 Защищённые маршруты и гейтинг меню

Единственный источник — `GET /api/v1/auth/me` (`auth.controller.ts:415-432`): `{id, sessionId, permissions[], hasPassword, requiresPassword, providers[], twoFactorEnabled}`.

- `beforeLoad` в корневом защищённом layout: нет пользователя → редирект на `/login` с `redirect=`.
- Пункты меню и кнопки скрываются по `permissions.includes(...)`, а не по роли — **роли в ответе нет**.
- Глобальный блокирующий баннер при `requiresPassword === true`: «без пароля лицензия не выдаётся и лаунчер не запускается» (прямая формулировка из `auth.controller.ts:411-413`), CTA → `/settings/security/password`.
- **Шапка профиля с именем в V1 невозможна**: `/auth/me` не отдаёт ни `username`, ни `email`, ни аватар. Рисуем нейтральный аватар-инициал по `id`, поле имени не проектируем (см. раздел 4).

### 2.4 Ветка второго фактора при входе

`POST /auth/login` даёт одну из двух форм:
- `{twoFactorRequired: false, accessToken, refreshToken, user}` → сохранить, редирект в кабинет;
- `{twoFactorRequired: true, challengeToken, expiresIn}` → **challengeToken держать только в памяти роутер-стейта**, никакого storage; переход на `/login/2fa`. Прямой заход на `/login/2fa` без challenge в памяти → редирект на `/login`.

На `/login/2fa`: таймер по `expiresIn`, локальный счётчик попыток (их ровно 5, `auth.service.ts:430` → `TWO_FACTOR_ATTEMPTS_EXCEEDED`), после исчерпания или `CHALLENGE_INVALID` (`:401,:458`) — сброс на шаг 1 с текстом «время сессии подтверждения истекло, введите пароль заново».

### 2.5 Слой запросов

- Один `apiFetch` поверх `fetch`: базовый URL, `Authorization`, разбор конверта ошибки в класс `ApiError {status, code, message, details}`.
- TanStack Query: `retry: (n, e) => e.status >= 500 && n < 2` — 4xx не ретраить никогда (идемпотентность `redeem` защищена сервером, но лишние попытки жрут `TOO_MANY_ATTEMPTS`).
- Единый компонент-маппер `<ApiErrorText error={e} fallback=... />` со словарём `code → текст`; неизвестный код показывает `message` сервера (он уже по-русски).

---

## 3. Экраны первой версии

### Волна 0 — разблокировка регистрации (2 экрана, оба публичные)

#### 3.1 Подтверждение почты
- **Маршрут:** `/verify-email?token=` — адрес зафиксирован письмом, менять нельзя.
- **Запросы:** `POST /api/v1/auth/verify-email` `{token}` сразу при монтировании.
- **Показывает:** спиннер → «почта подтверждена» + кнопка «Войти».
- **Ошибки:** `TOKEN_INVALID` (`auth.service.ts:180,202`) → «ссылка недействительна или уже использована», ссылка на `/login`; токена нет в URL → сразу тот же экран; 5xx → «повторить».

#### 3.2 Установка нового пароля по ссылке
- **Маршрут:** `/reset-password?token=` — адрес зафиксирован письмом.
- **Запросы:** `POST /api/v1/auth/password-reset/confirm` `{token, password, twoFactorCode?}`.
- **Показывает:** новый пароль + повтор; поле кода 2FA появляется по ответу `TWO_FACTOR_REQUIRED` (`auth.service.ts:594`) и форма пересабмитится с кодом.
- **Ошибки:** `TOKEN_INVALID` → «ссылка истекла, запросите новую» + ссылка на `/forgot-password`; `TWO_FACTOR_REQUIRED` → раскрыть поле кода, не считать ошибкой; `TWO_FACTOR_INVALID` (`two-factor.service.ts:126,260`) → «неверный код»; ошибки валидации — из `details[]`.

---

### Волна 1 — вход и регистрация

#### 3.3 Вход, шаг 1
- **Маршрут:** `/login`
- **Запросы:** `POST /auth/login`; `GET /auth/discord/url` (лениво, по клику на кнопку Discord); Telegram Login Widget — скриптом провайдера.
- **Показывает:** одно поле «логин или email» (сервер сам делает OR, `auth.service.ts:233-238`), пароль, кнопки Discord и Telegram, ссылки «Забыли пароль», «Регистрация», «У меня ключ».
- **Ошибки:** `INVALID_CREDENTIALS` (`:259`) → **единый** текст «неверный логин или пароль», без уточнения, какая половина неверна; `EMAIL_NOT_VERIFIED` (`:846`) → отдельный блок «подтвердите почту», без кнопки повторной отправки (маршрута нет); `ACCOUNT_BLOCKED` (`:839`) → «аккаунт заблокирован, обратитесь в поддержку»; 429 → «слишком много попыток, подождите».

#### 3.4 Вход, шаг 2 — второй фактор
- **Маршрут:** `/login/2fa` (challenge только в памяти)
- **Запросы:** `POST /auth/2fa/verify` `{challengeToken, code}`.
- **Показывает:** поле на 6 цифр с автопереходом, переключатель «ввести код восстановления» (тогда поле свободного формата), таймер `expiresIn`, счётчик «осталось попыток: N».
- **Ошибки:** `TWO_FACTOR_INVALID` → «неверный код», уменьшить счётчик; повторное использование того же шага TOTP (`two-factor.service.ts:209-221`) — текст **«этот код уже использован, дождитесь следующего»**, а не «неверный»; `TWO_FACTOR_ATTEMPTS_EXCEEDED` и `CHALLENGE_INVALID` → на `/login`.

#### 3.5 Регистрация по логину/паролю
- **Маршрут:** `/register` → `/register/check-email`
- **Запросы:** `POST /auth/register`.
- **Показывает:** логин, email, пароль; после успеха — терминальный экран «письмо отправлено», без автологина (токен уходит только письмом).
- **Ошибки:** `ALREADY_EXISTS` (`auth.service.ts:102`) → «логин или email уже заняты»; массив `details[]` из ValidationPipe → под соответствующие поля формы.

#### 3.6 Регистрация по ключу
- **Маршрут:** `/register/key`
- **Запросы:** `POST /auth/register-with-key`.
- **Показывает:** ключ, логин, пароль, email **необязателен**; подтверждение почты не требуется — сразу логин; если ключ нёс продукт+тариф, показать выданную лицензию.
- **Ошибки:** `KEY_INVALID`, `KEY_ALREADY_USED`, `KEY_EXPIRED` (`registration-key.service.ts:333-341`) — три разных текста; `ALREADY_EXISTS` → занят логин.

#### 3.7 Запрос сброса пароля
- **Маршрут:** `/forgot-password`
- **Запросы:** `POST /auth/password-reset/request`.
- **Показывает:** одно поле, после сабмита **всегда** «если такой адрес есть, письмо отправлено» — сервер намеренно всегда отвечает успехом.
- **Ошибки:** только 429 и 5xx.

#### 3.8 Приёмник Discord
- **Маршрут:** `/oauth/discord/callback?code&state`
- **Запросы:** `POST /auth/discord/callback` `{code, state}`.
- **Ошибки:** `OAUTH_STATE_INVALID` (`oauth.service.ts:46`) → «сессия входа истекла, начните заново»; `EMAIL_TAKEN_LINK_MANUALLY` (`:193`) → **важно**: текст сервера советует «привяжите аккаунт в настройках», но привязки в V1 нет (см. раздел 4) → показать свой текст: «этот email уже зарегистрирован, войдите паролем»; `ACCOUNT_BLOCKED` (`:164,:201`); `OAUTH_EXCHANGE_FAILED`, `OAUTH_PROFILE_FAILED` (`discord.provider.ts:106,117,129`) → «Discord недоступен, повторите»; `OAUTH_NOT_CONFIGURED` (`:154`) → кнопку Discord вообще не рисовать, если пришёл этот код (кешировать в сессии).

Telegram обрабатывается тем же экраном логина: виджет отдаёт подписанные данные → `POST /auth/telegram/callback`. Ошибки: `OAUTH_SIGNATURE_INVALID`, `OAUTH_PAYLOAD_EXPIRED`, `OAUTH_INVALID_PAYLOAD`, `OAUTH_NOT_CONFIGURED` (`telegram.provider.ts:63-101`).

---

### Волна 2 — кабинет

#### 3.9 Мои лицензии
- **Маршрут:** `/` (внутри защищённого layout)
- **Запросы:** `GET /api/v1/licenses?status&productId&search&skip&take` (take ≤ 200; ответ `{items,total,skip,take}` c `product/plan/user`).
- **Показывает:** карточки — продукт (`slug` + `name`), тариф (`name`, `durationDays`), статус, дата активации, дата окончания. **Статус `PENDING` рисуется отдельным состоянием: «срок начнёт идти с первого запуска лаунчера»** — иначе пользователь решит, что купил и теряет дни (`licenses.service.ts:57-100`). Пустое состояние ведёт на `/activate`.
- **Ошибки:** 403 `FORBIDDEN` → пустой экран с объяснением; пагинация — «показать ещё» по `total`.

#### 3.10 Карточка лицензии
- **Маршрут:** `/licenses/$licenseId`
- **Запросы:** `GET /licenses/:id`; `GET /licenses/:licenseId/hwid`; условно `GET /licenses/:licenseId/hwid/history`.
- **Показывает:** реквизиты лицензии, ключ с кнопкой «копировать», историю привязок (последние 20 приходят вместе с карточкой).
- **Ошибки:** 403 `FORBIDDEN` (`licenses.service.ts:532`) на чужую → «лицензия не найдена» (не раскрывать существование); 404 `NOT_FOUND`.

#### 3.11 Блок «Привязка к устройству»
- **Внутри** `/licenses/$licenseId`.
- **Запросы:** `GET /licenses/:licenseId/hwid`; `POST /licenses/:licenseId/hwid/reset`.
- **Показывает:** ровно `bound, boundAt, lastSeenAt, resetsUsed, resetsLeft, lastResetAt, nextResetAvailableAt`. **Состав HWID показывать запрещено — сервер его и не отдаёт.** Обязательная сноска: счётчик сбросов общий, сброс силами поддержки тоже его расходует.
- **Ошибки:** `HWID_RESET_COOLDOWN` (`hwid.service.ts:277`) → обратный отсчёт по `details.nextAllowedAt` (кулдаун 24 ч), кнопка disabled; `HWID_RESET_LIMIT` (`:265`) → кнопка недоступна, «лимит исчерпан, обратитесь в поддержку»; `NOT_BOUND` (`:256`) → кнопка вообще не рисуется; `FORBIDDEN` (`:246`).

#### 3.12 История привязок
- **Внутри** `/licenses/$licenseId`, вкладка.
- **Запросы:** `GET /licenses/:licenseId/hwid/history`.
- **Показывает:** `reason` (FIRST_BIND / USER_RESET / ADMIN_RESET / ADMIN_MANUAL_SET / RESELLER_RESET), `actorType`, `actorLabel`, `comment`, `createdAt`. Колонок под хеши и Disk ID не заводить — их нет в ответе. **Колонку IP не делать**: заполняется только при первой привязке из лаунчера, у остальных NULL (`hwid.controller.ts:69,87,104` не передают ip).
- **Гейтинг — расхождение с ТЗ:** маршрут закрыт `@RequirePermissions('hwid.history.read')` (`hwid.controller.ts:128`), а не проверкой владельца. Вкладку показывать **только** при `permissions.includes('hwid.history.read')`, иначе рядовой пользователь получит 403. Если по ТЗ история положена владельцу — это правка сервера, не фронта.

---

### Волна 3 — деньги и активация (критично: без этого платформа не продаёт)

#### 3.13 Активация кода покупки Digiseller
- **Маршрут:** `/activate` (таб «Код покупки»)
- **Запросы:** `POST /api/v1/billing/digiseller/redeem` `{code}`.
- **Показывает:** одно поле; при успехе — выданную лицензию прямо на экране. Ответ `ALREADY_YOURS` (повторный сабмит того же кода тем же пользователем) — **успех**, а не ошибка: «этот код уже активирован вами», показать лицензию.
- **Ошибки** (`billing.controller.ts:34-37`, `digiseller.service.ts`):
  - `CODE_MALFORMED` (400) → «проверьте формат кода»;
  - `CODE_NOT_ACCEPTED` (400) → «площадка не подтвердила код»;
  - `TOO_MANY_ATTEMPTS` (400, `:555`) → «слишком много попыток, попробуйте позже»;
  - `CODE_ALREADY_USED` (409, `:513`) → «код активирован другим аккаунтом, обратитесь в поддержку»;
  - `PRODUCT_NOT_MAPPED` (409, `:158`) → **обязательно нейтральный текст «оплата принята, лицензия будет выдана в ближайшее время»** и никакого красного цвета: деньги у площадки, сделка припаркована и ждёт админа;
  - `PROVIDER_UNAVAILABLE` (503, `:124`) → «площадка недоступна, повторите через минуту» с кнопкой повтора.

#### 3.14 Активация регистрационного ключа
- **Маршрут:** `/activate` (таб «Ключ»)
- **Запросы:** `POST /auth/redeem-key` `{key}` → возвращает `licenseKey` или `null`.
- **Ошибки:** `KEY_INVALID`, `KEY_EXPIRED`, `KEY_ALREADY_USED` (409, погашение атомарное); `KEY_WITHOUT_LICENSE` (`registration-key.service.ts:297`) → «ключ активирован, но лицензии не содержит» — не ошибка.

---

### Волна 4 — безопасность аккаунта

#### 3.15 Пароль
- **Маршрут:** `/settings/security/password`
- **Запросы:** `POST /auth/password/change` `{currentPassword, newPassword}` **или** `POST /auth/password/set` — ветка выбирается по `hasPassword`/`requiresPassword` из `/auth/me`.
- **Показывает:** предупреждение «смена завершит остальные сессии»; после успеха — «завершено N других сессий» по `revokedSessions`. Для OAuth-аккаунтов — объяснение, зачем пароль вообще нужен.
- **Ошибки:** `INVALID_CREDENTIALS` (`auth.service.ts:667`) → «текущий пароль неверен»; `PASSWORD_UNCHANGED` (`:674`) → «новый пароль совпадает со старым»; `PASSWORD_ALREADY_SET` (409, `:716`) → перезапросить `/auth/me` и перерисовать форму в режим смены.

#### 3.16 Двухфакторная аутентификация
- **Маршрут:** `/settings/security/2fa`
- **Запросы:** `POST /auth/2fa/setup` → `POST /auth/2fa/enable` → (отдельно) `POST /auth/2fa/disable`.
- **Показывает:** мастер из трёх шагов. **QR рисуется на фронте** из `otpauth`-URI (сервер картинку не отдаёт) — библиотека `qrcode`; secret текстом для ручного ввода. После `enable` — экран кодов восстановления, показываются **один раз**, с кнопками «скачать/копировать» и обязательным чекбоксом «я сохранил», без него закрыть нельзя. Отключение требует одновременно пароль **и** код, предупреждение «все сессии будут завершены» → после успеха фронт сам делает `hardLogout()`.
- **Ошибки:** `TWO_FACTOR_ALREADY_ENABLED` (`two-factor.service.ts:83`) → перезагрузить `/auth/me`; `TWO_FACTOR_INVALID`; `TWO_FACTOR_NOT_SET_UP` (`:202,:285`) → вернуть на шаг 1; `INVALID_CREDENTIALS` при disable.

#### 3.17 Способы входа
- **Маршрут:** `/settings/security/logins`
- **Запросы:** `GET /auth/me` (providers, hasPassword); `DELETE /auth/oauth/:provider`.
- **Показывает:** список привязанных провайдеров + пароль как способ входа. **Кнопки «Привязать» нет** — маршрута не существует (см. раздел 4).
- **Ошибки:** `LAST_LOGIN_METHOD` (`oauth.service.ts:133`) → **пояснение, а не ошибка**: «это единственный способ входа, сначала задайте пароль»; `UNKNOWN_PROVIDER` (`auth.controller.ts:245`).

#### 3.18 Выход
- Кнопка в меню: `POST /auth/logout` → `hardLogout()`. Гасит только текущую сессию. **Раздела «мои сессии» нет и в V1 не будет** — маршрутов `/sessions` не существует ни одного.

---

### Волна 5 — операционный минимум (без него зависают деньги)

#### 3.19 Зависшие сделки Digiseller
- **Маршрут:** `/admin/billing/pending`, виден при `permissions.includes('licenses.create.any')`
- **Запросы:** `GET /api/v1/billing/digiseller/pending`; `POST /api/v1/billing/digiseller/pending/:id/complete`.
- **Показывает:** таблицу оплаченных, но не выданных покупок. Это прямое следствие 3.13: пользователю сказали «лицензия будет выдана», кто-то обязан её выдать.
- **Ошибки:** `PRODUCT_NOT_MAPPED` (409, `:409`) → «сначала привяжите товар площадки к тарифу» (тариф правится через `POST /products/:id/plans` → `digisellerProductId`); `ALREADY_REDEEMED` (`:393,:450`) → строку убрать из списка; `NO_CLAIMANT` (`:397`) → «покупатель не определён».

#### 3.20 Состояние сервисов
- **Маршрут:** футер/`/status`, публичный.
- **Запросы:** `GET /health/ready` (без префикса и версии), интервал 30 с.
- **Показывает:** Postgres/Redis с латентностью. 503 + `code: NOT_READY` (`health.controller.ts:82`) — рисовать `details`, не считать сетевой ошибкой.

---

## 4. Требует доработки сервера — в план V1 не входит

| Экран из ТЗ | Чего не хватает | Что конкретно нужно |
|---|---|---|
| **Скачать лаунчер** | пользовательского маршрута выдачи дистрибутива нет вовсе | `GET /launcher/update` закрыт `SignatureGuard` (`X-Api-Key/X-Timestamp/X-Nonce/X-Signature`) и из браузера не подписывается; его ответ и так отбрасывает `sha256`, `size`, `changelog`, ссылку (`launcher.service.ts:484-489`), `StorageService.createDownloadUrl` не вызывается. Нужен bearer-маршрут «последняя опубликованная версия + presigned GET». Побочно: письмо `license.issued` уже подставляет `{{downloadUrl}}` (`seed.ts:354`) — подставлять нечего. |
| **История входов** | читателя нет | Данные пишутся в `login_history` (`auth.service.ts:851-876`), GET-маршрута нет. И даже после написания две колонки из пяти будут пустыми: `country` никто не заполняет (GeoIP в проекте отсутствует), `deviceId` в `recordLogin` не пишется — есть только `userAgent`. |
| **Мои сессии / завершить чужую сессию** | маршрутов нет | Сущность `Session` есть, HTTP-поверхности ноль. |
| **Привязка нового OAuth-провайдера** | метод есть, маршрута нет | `OAuthService.linkToCurrentUser` (`oauth.service.ts:89`) не вызывается ниоткуда, при этом текст ошибки `EMAIL_TAKEN_LINK_MANUALLY` уже советует «привяжите в настройках» (`:193-196`). Либо маршрут, либо правка текста ошибки. |
| **Шапка профиля с именем/email** | `/auth/me` их не отдаёт | Добавить `username`, `email`, `role` в ответ `/auth/me` (`auth.controller.ts:415-432`) — иначе UI не может поздороваться с пользователем и не может показать, на какой адрес ушло письмо. |
| **Повторная отправка письма подтверждения** | маршрута нет | Пользователь с `EMAIL_NOT_VERIFIED` и потерянным письмом в тупике. |
| **История привязок владельцу лицензии** | закрыта правом `hwid.history.read` | ТЗ предполагает доступ владельцу; сейчас нужно право. Либо смена гварда на проверку владельца, либо ТЗ признаёт вкладку админской. |

Скачивание payload'а в UI отсутствует **намеренно** — ссылки на скачивание не существует принципиально, кнопку не проектировать.

---

## 5. Параллельные куски работы

Корень: `C:\Users\user\work\kwork\license-platform\apps\web\`. Роутинг — **file-based TanStack Router**: каждый маршрут это отдельный файл, дерево генерируется, поэтому куски не конфликтуют по общему route-конфигу. Все пути ниже — от корня `apps/web`.

### K0 — Каркас (блокирует всё, один человек, 1 день)
```
package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, index.html,
.env.development, .env.example, .gitignore
src/main.tsx, src/styles/globals.css
src/routes/__root.tsx
src/routes/_public.tsx
src/routes/_app.tsx                      // защищённый layout + beforeLoad
src/lib/api/client.ts                    // apiFetch, ApiError
src/lib/api/error-codes.ts               // словарь code → текст
src/lib/api/query-client.ts
src/lib/auth/token-store.ts              // память + localStorage lp.rt
src/lib/auth/refresh.ts                  // single-flight
src/lib/auth/session.tsx                 // useSession, hardLogout, boot-refresh
src/lib/auth/permissions.ts              // has(perm)
src/components/ui/*                      // shadcn init (button,input,card,dialog,...)
src/components/api-error-text.tsx
src/components/app-shell.tsx             // меню, гейтинг по permissions
components.json
```

### K1 — Публичная авторизация (стартует сразу после K0)
```
src/routes/_public/login.tsx
src/routes/_public/login.2fa.tsx
src/routes/_public/register.tsx
src/routes/_public/register.key.tsx
src/routes/_public/register.check-email.tsx
src/routes/_public/verify-email.tsx
src/routes/_public/forgot-password.tsx
src/routes/_public/reset-password.tsx
src/features/auth/api.ts
src/features/auth/schemas.ts
src/features/auth/challenge-store.ts
```
> Внутри K1 файлы `verify-email.tsx` и `reset-password.tsx` — приоритет №1, их можно отдать отдельному человеку прямо параллельно с логином, они ни от чего не зависят кроме `apiFetch`.

### K2 — OAuth
```
src/routes/_public/oauth.discord.callback.tsx
src/features/oauth/api.ts
src/features/oauth/discord-button.tsx
src/features/oauth/telegram-widget.tsx
```

### K3 — Лицензии и HWID
```
src/routes/_app/index.tsx
src/routes/_app/licenses.$licenseId.tsx
src/features/licenses/api.ts
src/features/licenses/license-card.tsx
src/features/licenses/status-badge.tsx      // включая PENDING-объяснение
src/features/hwid/api.ts
src/features/hwid/binding-panel.tsx
src/features/hwid/reset-button.tsx          // кулдаун-таймер
src/features/hwid/history-table.tsx
```

### K4 — Активация
```
src/routes/_app/activate.tsx
src/features/billing/api.ts
src/features/billing/digiseller-form.tsx
src/features/keys/api.ts
src/features/keys/redeem-form.tsx
```

### K5 — Безопасность
```
src/routes/_app/settings.security.password.tsx
src/routes/_app/settings.security.2fa.tsx
src/routes/_app/settings.security.logins.tsx
src/features/security/api.ts
src/features/security/qr-code.tsx
src/features/security/recovery-codes-dialog.tsx
```

### K6 — Операционный минимум
```
src/routes/_app/admin.billing.pending.tsx
src/features/admin-billing/api.ts
```

### K7 — Инфраструктура вида (параллельно с K0 с первой минуты)
```
src/components/empty-state.tsx
src/components/data-table.tsx
src/components/copy-button.tsx
src/components/countdown.tsx
src/components/service-status.tsx        // GET /health/ready
src/lib/format/date.ts, src/lib/format/bytes.ts
src/lib/i18n/index.ts, src/lib/i18n/ru.json, src/lib/i18n/en.json
```
> i18n: только каркас и русская локаль. Остальные 4 языка из ТЗ — после того, как тексты перестанут меняться.

**Точки синхронизации, требующие одного владельца:** `src/lib/api/error-codes.ts` (словарь кодов — правится всеми, поэтому строго добавлением ключей, без переструктурирования) и `src/components/app-shell.tsx` (меню — каждый кусок присылает свой пункт одной строкой).

**Порядок:** K0 → (K1 ‖ K7) → (K2 ‖ K3 ‖ K4) → (K5 ‖ K6). Критический путь до «регистрация работает от письма до кабинета» — K0 + два файла из K1.