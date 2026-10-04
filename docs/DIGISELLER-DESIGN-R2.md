# Digiseller — проект после ревизии (раунд 2)

> Первый проект имел 16 критичных дефектов. Три агента переработали
> сломанные узлы, результат сведён и проверен теми же четырьмя линзами.
>
> **Итог: было 16 критичных / 19 важных, стало 13 / 15.** Часть закрыта,
> часть создана заново попытками закрыть старые. Требуется раунд 3 с
> явной установкой: сложность — тоже дефект.

## Решения владельца (получены, не обсуждаются)

| Вопрос | Ответ | Следствие |
|---|---|---|
| Структура витрины Digiseller | **Отдельная карточка на каждый срок** (1д/7д/30д/90д/180д/бессрочно) | Один товар = один тариф. `digisellerProductId Int? @unique` подходит как есть. Дефект про options/variant_id снят: вариантов у товара не будет. |
| Домен API | `api.digiseller.com` | `.ru` работает, но не задокументирован. Переключено в .env, .env.example и env.schema.ts. |
| Права токена | `view_invoice` + `token_get_perms` + `description_view` | Проверено живым запросом. `sales_statistics_view` и `content_change` НЕ выданы — поллинг возвратов идёт поштучно через `purchase/info`. |
| Срок жизни токена | 120 минут, из `valid_thru` | Проверено живым входом. Константа `DIGISELLER_TOKEN_CACHE_TTL=6600` — только страховка, если поле не придёт. |

## Проект

# Единый проект модуля Digiseller

Сведены три ревизии. Швы проверены чтением кода; там, где ревизии противоречат друг другу, противоречие разрешено явно (см. `decisions`). Одно утверждение исходного документа оказалось УСТАРЕВШИМ — оно было опорой для двух ревизий и переигрывается ниже.

---

## 0. ПОПРАВКА К ИСХОДНОМУ ДОКУМЕНТУ (обязательно к прочтению)

**Утверждение «сид создаёт `digiseller.*` со значением `''`, поэтому ветка `process.env` недостижима и env-переменные Digiseller мертвы» — БОЛЬШЕ НЕ ВЕРНО.**

`apps/api/src/common/settings/settings.service.ts:100` теперь читает
`if (row && !this.isPlaceholder(row.value))`, а `settings.service.ts:212-214`:
```ts
private isPlaceholder(raw: unknown): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}
```
Пустая строка НЕ считается значением, и `get()` идёт дальше в `process.env`. Комментарий в самом коде (строки 84-98) прямо описывает этот дефект как исправленный.

Следствия, отменяющие решения черновика и ревизии «защита»:
- **Решение №13 черновика («удалить `DIGISELLER_SELLER_ID` и `DIGISELLER_API_KEY` из `env.schema.ts` — мертвы, доказано») ОТМЕНЯЕТСЯ.** Переменные живые и остаются. Порядок разрешения конфигурации: непустая строка в `settings` → `process.env` → `NOT_CONFIGURED`.
- Тест `digiseller-config.spec.ts`, который «фиксирует, что env действительно мёртв», переписывается в зеркальный: при `digiseller.api_key = ''` и заполненном `DIGISELLER_API_KEY` конфигурация читается как **OK**.
- `env.schema.ts:169` уже имеет `DIGISELLER_API_BASE` с умолчанием `https://api.digiseller.com` — решение №22 черновика УЖЕ реализовано, менять нечего.
- `DECRYPT_FAILED` по-прежнему отличим: `safeDecryptSecret` возвращает `null` (а не `''`/`undefined`), и `null` кешируется и возвращается, не проваливаясь в env.
- Удаляются только `DIGISELLER_TOKEN_CACHE_TTL` (TTL считается из `valid_thru`) и `DIGISELLER_POLL_INTERVAL` (вытеснен `digiseller.poll_interval_sec`).

---

## 1. Ядро: две сущности вместо одной

| | `digiseller_claims` (НОВАЯ) | `digiseller_orders` (существующая) |
|---|---|---|
| смысл | «пользователь U предъявил код C» | «код C — реальная покупка, счёт inv» |
| кардинальность | N на код, 1 на (код, пользователь) | ровно 1 на код |
| когда создаётся | ДО сети, после формат-гейта, дешёвого счётчика и резерва UC | ТОЛЬКО из проверенного ответа площадки |
| уникальность | `(code_hash, claimed_by_user_id)` | `code_hash`, `inv_id` |

`code_hash = sha256(lower(normalizeCode(code)))`, `char(64)`.
`normalizeCode` = trim + удаление пробельных и zero-width; **регистр не трогается** (решение №21 черновика сохранено).

Это расщепление одно закрывает Д9, Д4, Д8, Д29, Д2, Д19 и делает `inv_id NOT NULL` возможным (Д1).

### Автомат claim — 8 состояний, 2 терминальных

`PENDING_VERIFY, AWAITING_OWNER, PENDING_FULFILL, BLOCKED_UNMAPPED, BLOCKED_INPUT, STALLED` + терминальные `FULFILLED, REJECTED`.

Удалены из черновика: `VERIFIED` (тупик, Д2), `FAILED_PERMANENT` (Д3, Д6), `QUARANTINED` (расщеплён на `BLOCKED_UNMAPPED`/`BLOCKED_INPUT`), `REFUND_PENDING`/`REFUNDED` (это состояния СДЕЛКИ, не попытки).

Отсутствие тупиков — констрейнт, а не дисциплина:
```sql
CHECK ( (state IN ('FULFILLED','REJECTED')) = (next_attempt_at IS NULL) )
CHECK ( state <> 'REJECTED' OR reject_reason IS NOT NULL )
CREATE INDEX digiseller_claims_due_idx ON digiseller_claims (next_attempt_at)
  WHERE next_attempt_at IS NOT NULL;
```

### Полный список переходов
```
(нет строки) --формат-гейт fail--> 400 CODE_MALFORMED, строка НЕ создаётся
(нет строки) --активных claim >= max_open_claims_per_user--> 429, строка НЕ создаётся
(нет строки) --резерв UC не выдан--> 429/503, строка НЕ создаётся
(нет строки) --ok--> PENDING_VERIFY (escalate_at = now + 72ч, next_attempt_at = now + 30с)

PENDING_VERIFY --OK + preflight ok + email_match--> PENDING_FULFILL
PENDING_VERIFY --OK + preflight ok + !email_match + оспорен--> AWAITING_OWNER
PENDING_VERIFY --OK + preflight ok + !email_match + не оспорен--> PENDING_FULFILL
PENDING_VERIFY --OK, сделка погашена мной--> FULFILLED
PENDING_VERIFY --OK, сделка погашена другим--> REJECTED(TAKEN_BY_OTHER)
PENDING_VERIFY --OK, preflight: тариф нет/неактивен--> BLOCKED_UNMAPPED
PENDING_VERIFY --OK, preflight: inv/qty/currency/hash/goods--> BLOCKED_INPUT
PENDING_VERIFY --retval ∈ digiseller.reject_retvals--> REJECTED(CODE_INVALID)
PENDING_VERIFY --RETRYABLE/AUTH/undecidable--> PENDING_VERIFY (бэкофф по причине, verify_attempts+1)
PENDING_VERIFY --НАШ отказ (breaker/бакет/NOT_CONFIGURED/DECRYPT_FAILED/DENIED)-->
                 PENDING_VERIFY (бэкофф, upstream_refusals+1, verify_attempts НЕ растёт)
PENDING_VERIFY --now() > escalate_at--> STALLED(UPSTREAM_UNREACHABLE|UNDECIDABLE_RESPONSE|LOCAL_DEGRADED)

AWAITING_OWNER --грейс истёк, совпадающего claim нет--> PENDING_FULFILL
AWAITING_OWNER --появился живой claim с email_match--> AWAITING_OWNER (продление)
AWAITING_OWNER --сделку погасил другой--> REJECTED(TAKEN_BY_OTHER)
AWAITING_OWNER --now() > escalate_at--> STALLED(OWNERSHIP_CONTESTED)

PENDING_FULFILL --коммит--> FULFILLED             (переход В ТОЙ ЖЕ транзакции)
PENDING_FULFILL --откат: таймаут/дедлок/пул--> PENDING_FULFILL (компенсирующий UPDATE отдельной tx)
PENDING_FULFILL --откат: детерминированная ошибка данных--> BLOCKED_INPUT
PENDING_FULFILL --шаг 1 count=0, погасил я--> FULFILLED
PENDING_FULFILL --шаг 1 count=0, погасил другой--> REJECTED(TAKEN_BY_OTHER)
PENDING_FULFILL --now() > escalate_at--> STALLED

BLOCKED_UNMAPPED --тариф появился и активен--> PENDING_FULFILL  (автоматически, раз в 600 с)
BLOCKED_UNMAPPED --админ: снять товар--> REJECTED(PRODUCT_WITHDRAWN)
BLOCKED_UNMAPPED --тик без изменений--> BLOCKED_UNMAPPED (+10 мин; алерт после 2 ч)

BLOCKED_INPUT --админ: resolve с override--> PENDING_FULFILL
BLOCKED_INPUT --админ: закрыть--> REJECTED(ADMIN_CLOSED)
BLOCKED_INPUT --суточный тик--> BLOCKED_INPUT (переалерт)

STALLED --медленная полоса (6 ч), площадка ответила OK--> ветвление как из PENDING_VERIFY
STALLED --покупатель нажал «повторить»--> PENDING_VERIFY (next_attempt_at = now(), стоит UC)
STALLED --админ: resolve--> PENDING_VERIFY (счётчики и escalate_at пересчитываются)
STALLED --админ: закрыть--> REJECTED(ADMIN_CLOSED)
STALLED --иначе--> STALLED (+6 ч, под breaker-гейтом)

FULFILLED / REJECTED --> терминал. Возврат живёт на СДЕЛКЕ и claim не переоткрывает.
REJECTED(CODE_INVALID) старше claim_ttl_days (30) чистится ночным job.
```

### Горизонт и бэкофф
Горизонт — **календарный**: `escalate_at = created_at + digiseller.retry_horizon_hours` (72). Числа попыток нет ни в одном условии перехода. `escalate_at` не убивает claim, а меняет наблюдателя (→ STALLED).

Бэкофф — **по причине отказа**:
| причина | лестница |
|---|---|
| breaker ОТКРЫТ | строка не берётся вовсе |
| сеть/5xx/HTML при закрытом breaker | 30 с, 2 м, 5 м, потолок 15 мин |
| ответ не классифицируется (`undecidable_streak`) | 5 подряд → 1 ч, 12 → 6 ч |
| НАШ отказ (бакет, NOT_CONFIGURED, DECRYPT_FAILED, DENIED) | 60 с, потолок 5 мин, `verify_attempts` не растёт |
| отказ исполнения (фаза C) | 5 с, 30 с, 2 м, потолок 15 мин, **0 обращений наверх** |
| STALLED | 6 ч, бесконечно |

### Лизинг (закрывает Д7 и гонку Д19 конструктивно)
Процессор ДО начала работы делает
```sql
UPDATE digiseller_claims SET next_attempt_at = now() + lease_sec, leased_until = now() + lease_sec
WHERE id = $1 AND next_attempt_at <= now()
```
и работает только при `count = 1`. Падение процесса, исключение до `try`, откат транзакции стоят максимум одного лизинга, а не 240 запросов в час. Тот же лизинг — мьютекс между HTTP-путём и воркером.

**Следствие для Redis-лока процессоров:** корректность держится на построчном лизинге, а не на локе. Поэтому лок остаётся вежливостью: захват ВНУТРЬ `try`, снятие — обычный `DEL`, Lua не вводится (в проекте нет ни одного Lua-скрипта). Два одновременных исполнителя безопасны по построению.

---

## 2. Preflight — ДО открытия денежной транзакции

Всё, что не лечится временем, выясняется здесь, а не внутри транзакции (Д5, Д7, Д25, Д37):
1. `parseInv(raw)` → `bigint > 0`, иначе `BLOCKED_INPUT / INV_UNPARSEABLE`.
2. `id_goods` присутствует и целое, иначе `BLOCKED_INPUT / GOODS_ID_MISSING`.
3. `plan = licensePlan.findUnique({ digisellerProductId })`; `null` → `BLOCKED_UNMAPPED / PRODUCT_UNMAPPED`; `isActive === false` → `BLOCKED_UNMAPPED / PLAN_INACTIVE`. **Активность проверяем сами:** `licenses.service.ts:71-73` тянет `isActive` в `select` и не использует его — единственная проверка `plan.productId !== params.productId` (строка 76-81).
4. `productId := plan.productId` → `PLAN_MISMATCH` внутри денежной транзакции невозможен физически.
5. `resolveQuantity(cnt_goods, max)`: целое `1..max` → quantity; `null`/`0`/отсутствует/не-число → 1; **дробное → `BLOCKED_INPUT / QUANTITY_FRACTIONAL`** (Д37); `> max` → `QUANTITY_OUT_OF_RANGE`.
6. валюта: не матчит `^[A-Z]{2,8}$` → `BLOCKED_INPUT / CURRENCY_UNREPRESENTABLE` (Д25).
7. `code_hash` уже в сделках, но с ДРУГИМ `inv` → `BLOCKED_INPUT / CODE_HASH_COLLISION` с обоими payload.
8. `inv` уже в сделках, но с другим `code_hash` → `BLOCKED_INPUT / INV_CONFLICT` + ERROR в лог. Это чистый ассерт-инвариант: Д39 доказан по Swagger (`CartItemModel = {invoice_id, item_id, amount, currency}` — у каждой позиции корзины свой `invoice_id`), ветка недостижима и ключ до `(inv, id_goods)` НЕ расширяется.

`BLOCKED_UNMAPPED` — наша операционная ошибка: покупателю 202 `ACCEPTED_DELAYED` + письмо `order.delayed`, `redeemedAt` НЕ ставится никогда, сделка создаётся с `paymentId = NULL` (схема это разрешает намеренно: `schema.prisma:1113`). Процессор переразрешает тариф раз в 600 с, поэтому заведение тарифа админом лечит ВСЕ ждущие claim без действия по каждому. Очередь группируется по `digisellerProductId`.

---

## 3. Фаза C — ровно одна транзакция, сети нет

```ts
await prisma.$transaction(async (tx) => {
  // 1
  const claimed = await tx.digisellerOrder.updateMany({
    where: { id: dealId, redeemedAt: null },
    data:  { redeemedAt: now, redeemedByUserId: userId },
  });
  if (claimed.count === 0) throw DEAL_TAKEN;      // внутренний маркер, разбирается СНАРУЖИ
  // 2  number НЕ передаём — оживлённый DB-default next_order_number()
  const order = await tx.order.create({ data: { status: 'PAID', source: 'DIGISELLER',
      userId, productId: plan.productId, planId: plan.id, quantity,
      amount: plan.price.mul(quantity), currency: plan.currency, paidAt: now } });
  // 3  externalId в ТОМ ЖЕ INSERT
  const payment = await tx.payment.create({ data: { provider: 'DIGISELLER', status: 'CONFIRMED',
      orderId: order.id, externalId: invRef(inv), amount: order.amount, currency: order.currency,
      providerAmount, providerCurrency, method, rawPayload, confirmedAt: now } });
  // 4
  await tx.digisellerOrder.update({ where: { id: dealId }, data: { paymentId: payment.id } });
  // 5
  for (let i = 0; i < quantity; i++)
    await this.licenses.issue({ userId, productId: plan.productId, planId: plan.id, orderId: order.id }, tx);
  // 6
  const d = await tx.order.updateMany({ where: { id: order.id, status: 'PAID' },
                                        data: { status: 'DELIVERED', deliveredAt: now } });
  assert(d.count === 1);
  // 7  терминал claim коммитится ВМЕСТЕ с деньгами — отдельного теряемого шага нет
  await tx.digisellerClaim.update({ where: { id: claimId },
    data: { state: 'FULFILLED', nextAttemptAt: null, uniqueCode: null, digisellerOrderId: dealId } });
});
```
Компенсирующая запись при откате — ОТДЕЛЬНОЙ транзакцией после отката.

**Инвариант модуля** (в `apps/api/src/modules/payments/CLAUDE.md` + исполняемый тест): ни одного HTTP-вызова к площадке при открытой транзакции Prisma. Основание: таймаут транзакции 10 с против 14-секундного таймаута площадки за DDoS-Guard; зависший Digiseller выест пул и положит `POST /launcher/check` уже заплатившим.

---

## 4. Однократность без захвата — пять слоёв

1. `@@unique([code_hash, claimed_by_user_id])` на claim — идемпотентность на пользователя. Регистровые варианты своего кода схлопываются в ОДНУ строку (Д29).
2. `UNIQUE(code_hash)` на сделке, вставка через `createMany({skipDuplicates:true})` + перечитывание. P2002 наружу не выходит никогда.
3. `redeemedAt IS NULL` в WHERE самого UPDATE + проверка `count` — эталон `registration-key.service.ts:255-265, 302-312` (EvalPlanQual при READ COMMITTED).
4. `inv_id BigInt NOT NULL @unique` + `CHECK (inv_id > 0)` + на платежах `CHECK (provider <> 'DIGISELLER' OR external_id ~ '^[1-9][0-9]{0,18}$')`.
5. Условный `PAID → DELIVERED` с assert `count = 1` в той же транзакции.

**Владение** выясняется при верификации:
`email_match = (user.emailVerifiedAt IS NOT NULL AND lower(user.email) = lower(deal.buyerEmail))`.
Неподтверждённая почта совпадением не считается — иначе владение крадётся сменой email в профиле.
- `email_match` → сразу `PENDING_FULFILL`, и он выигрывает у несовпадающего независимо от порядка прихода;
- `!email_match` без конкурента → `PENDING_FULFILL` (решение №20 `require_email_match=false` сохранено), расхождение в аудит;
- `!email_match` при живом чужом claim → `AWAITING_OWNER` на `owner_grace_sec` (900).

---

## 5. Анти-оракул (единая формулировка, разрешает шов LC↔Z)

**`POST /redeem` НИКОГДА не отдаёт вердикт о коде.** Всегда 202 + непрозрачный `claim_id` (uuid v7) + одинаковый `Retry-After` — при любом исходе. Вердикт публикуется только на `GET /claims/:claimId`.

Отличающиеся коды на POST допустимы ТОЛЬКО там, где ответ не зависит от существования кода: 400 `CODE_MALFORMED` (формат), 429 (потолок открытых claim / лимиты), 503 (`PROVIDER_UNAVAILABLE`, `DIGISELLER_NOT_CONFIGURED`).

Таблица статуса (`GET /claims/:claimId`, доступ только заявителю):
| состояние claim | ответ |
|---|---|
| `PENDING_VERIFY` / `AWAITING_OWNER` / `PENDING_FULFILL` | 202 `PENDING`, `retryAfterSec` |
| `BLOCKED_UNMAPPED` / `BLOCKED_INPUT` / `STALLED` | 202 `ACCEPTED_DELAYED`; для STALLED — `canRetry` |
| `FULFILLED` | **200** + `orderNumber` + `licenseKeys` (перечитаны по `orderId`) |
| `REJECTED(CODE_INVALID)` и `REJECTED(TAKEN_BY_OTHER)` | 404 `CODE_INVALID`, один конверт, не раньше `notBefore` |
| `REJECTED(TAKEN_BY_OTHER)` при подтверждённом совпадении почты | 409 `CODE_TAKEN_BY_OTHER` + тикет (Д20) |
| `REJECTED(ADMIN_CLOSED / PRODUCT_WITHDRAWN)` | 409 с текстом обращения |

`notBefore = created_at + digiseller.verdict_dwell_sec` (15) — единый таймер выдержки для ВСЕХ отрицательных вердиктов. Положительный публикуется сразу (успех и есть раскрытие, получить его можно только владея кодом).

**Инвариант анти-оракула формулируется проверяемо, а не «побайтово»:** равны HTTP-статус, `code`, `message` и отсутствие `details`; различаются только `requestId` и `timestamp` (`all-exceptions.filter.ts:19-29` кладёт их по построению). Задержка обоих отрицательных исходов попадает в один диапазон, потому что публикация идёт по таймеру, а не по времени вычисления.

Дорогой бюджет списывается на интейке, ДО того как выяснится, какой это случай — иначе противник читает существование кода по остатку своей квоты.

---

## 6. Лимиты: единица — UC (upstream call)

Один HTTP-запрос к площадке от лица нашего продавца. Пороги заданы в UC, а не в предъявлениях (Д12).

| настройка | значение | смысл |
|---|---|---|
| `limits.digiseller.malformed_per_ip_per_10min` | 20 | дешёвый счётчик, 0 UC |
| `limits.digiseller.uc_per_user_per_hour` | 60 | |
| `limits.digiseller.uc_per_ip_per_hour` | 120 | |
| `limits.digiseller.uc_per_subnet_per_hour` | 240 | /24 |
| `limits.digiseller.uc_reserve_per_claim` | 6 | резервируется на интейке; остаток возвращается при терминальном исходе |
| `digiseller.max_open_claims_per_user` | 3 | считаются ТОЛЬКО состояния, способные породить обращение наверх |
| `limits.digiseller.upstream_interactive_per_min` (FAST) | 40 | только свежие claim покупателей |
| `limits.digiseller.upstream_background_per_min` (BACKGROUND) | 20 | ретраи 50 / deliver 30 / поллинг 20 |
| `limits.digiseller.upstream_control_per_min` (CONTROL) | 5 | apilogin и token/perms, не делится ни с кем |
| `limits.digiseller.max_quantity` | 20 | потолок `cnt_goods` |

**Разрешение шва «резерв 6 против ~15 обращений за 72 ч»:** резерв финансирует ТОЛЬКО полосу FAST. Исчерпав резерв, claim не умирает — он переходит на медленную полосу, финансируемую BACKGROUND. Поэтому оба числа верны и не противоречат друг другу: 6 обращений покупатель оплачивает своим бюджетом, остальные идут из фонового, ограниченного глобально.

**Разрешение шва «потолок открытых claim бьёт по реселлеру»:** в потолок считаются только `PENDING_VERIFY` и `STALLED`. `PENDING_FULFILL`, `AWAITING_OWNER` и `BLOCKED_*` обращений наверх не порождают (фаза C сети не имеет, переразрешение тарифа локально), поэтому не занимают квоту. Пачка успешно проверенных кодов больше не упирается в потолок.

**Fail-политика при недоступности Redis — по каждому лимиту отдельно; fail-closed ОТМЕНЁН:**
- дешёвый счётчик malformed — fail-OPEN с WARN (прецедент `payload.service.ts:483-492`; по IP подпирает nginx `api_zone 300r/m`, `default.conf.template:50`);
- пер-пользовательский/пер-IP/глобальные полосы — **fail-DEGRADED**: процессный токен-бакет на `local_fallback_fraction=0.25` от общего бюджета (прецедент процессного состояния — Map-кеш `settings.service.ts:25-31`);
- breaker при потере состояния считается ЗАКРЫТЫМ; проба half-open идёт МИМО любого бакета;
- отрицательный кеш — fail-open, это кеш.
Обоснование отмены fail-closed: Redis поднят как кеш, чьё падение по прямому заявлению проекта не должно ронять API (`redis.service.ts:38-42`); перезапуск Redis не имеет права останавливать единственный платёжный канал. Практика: ioredis отклоняет команду ~1,2 с (`maxRetriesPerRequest: 3`, `retryStrategy` — `redis.service.ts:30-34`), поэтому переход в деградированный режим залипающий на несколько секунд, а не проверяется на каждый запрос.

**Отрицательный кеш** — `digiseller:neg:<sha256(точный нормализованный код)>`, EX 3600. Ключ НЕ приводится к нижнему регистру (спор с Д36 разрешён в пользу ревизии «защита»). Порядок конвейера: формат-гейт → дешёвый счётчик → **резерв UC** → отрицательный кеш. Попадание в кеш инкрементит дешёвый счётчик и учитывается порогом `CODE_BRUTEFORCE` (первая половина Д36 принята).
**Честная оговорка:** кеш хранит только терминальные вердикты, а терминальный REJECT достижим лишь через `digiseller.reject_retvals`, по умолчанию пустой. До реальной тестовой покупки кеш ПУСТ по построению, и стоимость перебора держат формат-гейт, дешёвый счётчик, резерв UC и потолок открытых claim.

---

## 7. Аутентификация к площадке

`ts = max(floor(Date.now()/1000), lastTs + 1)` — настоящее время всегда база, монотонность только страховка от совпадения внутри секунды (Д14). `lastTs` в Redis (`digiseller:apilogin:last_ts`) — нижняя граница, НЕ источник значения: при `allkeys-lru` (`docker-compose.yml:69-73`) ключ может быть вытеснен в любой момент, и правило `max(now, …)` делает его отсутствие эквивалентным «взять now», а не «начать с 1».
Второй слой: `SET digiseller:apilogin:ts:{ts} NX EX 300` — приём уже дважды применён в проекте (`signature.service.ts:124`, `launcher.service.ts:521`). Третий: `retval -4` → `ts+1` и повтор, до 3 раз, без бэкоффа.

Разбор кодов apilogin (таблица документирована полностью, поэтому разбирается явно):
`-1` — повтор ЗАПРЕЩЁН, `INVALID_CREDENTIALS`, алерт, 503 (цикл ретраев на -1 своими руками приводит к -2 «аккаунт заблокирован»); `-2` — жёсткая пауза 15 мин, алерт; `-3` — бэкофф, максимум 2, дальше breaker; сеть/не-JSON — бэкофф, дальше breaker; неизвестный — как `-3`. Каждая попытка ВСЕГДА пересчитывает и `ts`, и подпись.

Кеш токена: Redis `digiseller:token`, `TTL = min(valid_thru − now, 7200с) − 300с`. Член `min(…, 7200)` обязателен: разность считается по НАШИМ часам, и при отставании на час кеш держал бы мёртвый токен. Непарсящийся `valid_thru`, TTL ≤ 0 или > 7200 → пол 600 с + признак деградации, но НИКОГДА не возврат к константе 6600. Single-flight: `SET digiseller:token:lock NX EX 15`, проигравшие ждут появления токена до 10 с и НЕ логинятся сами.

Дрейф часов ИЗМЕРЯЕТСЯ: `drift = (valid_thru − 120 мин) − наш now`. `|drift| > 120 с` → WARN + `CLOCK_DRIFT` в health; `> 600 с` → алерт. `ts` не имеет права уйти вперёд настенного времени больше чем на `ts_forward_cap = 60 с`; если монотонная страховка потребовала бы большего (шаг NTP назад, восстановление снапшота ВМ) — логины ОСТАНАВЛИВАЮТСЯ с `CLOCK_SUSPECT`.

**Права токена — по НАБЛЮДАЕМОМУ поведению, а не по `token/perms`** (Д33). Для каждого из трёх каналов состояние `UNKNOWN → OK / DENIED`; в `DENIED` переводит только права-ошибка от самого метода (HTTP 403 либо документированный `retval -5` у deliver). `GET /api/token/perms` дёргается на старте и в health ИСКЛЮЧИТЕЛЬНО как пояснение для человека: сам метод требует права `token_get_perms`, и ключ со всеми тремя рабочими правами, но без права читать список прав, был бы прочитан как «прав нет». Деградация точечная: нет `view_invoice` → redeem 503; нет `content_change` → deliver-процессор выключен, health degraded; нет `sales_statistics_view` → health КРАСНЫЙ (невозможность обнаруживать возвраты ≠ невозможность продавать).

---

## 8. Деньги: два автомата площадки, а не один (Д15)

**Автомат А — `unique_code_state` (доставка). Денег не содержит ВООБЩЕ.**
`1` — не проверен; `2` — доставлен, не подтверждён/не опровергнут (**в него сделку переводит НАШ `PUT .../deliver`**, и именно из него покупателю доступна кнопка «не получил»); `3` — подтверждён (снимаем с наблюдения за СПОРОМ, но НЕ за деньгами — правка самого Д15 в этой части ОТКЛОНЕНА); `4` — опровергнут → `DISPUTED`: уведомление админа, аудит `digiseller.delivery_refuted`, горячий тир поллинга, **лицензия работает**; `5` — наш дефект недозвона deliver, алерт.

**Автомат Б — `content.invoice_state` из `purchase/info`. Единственный источник денежной правды.**
`1/2/4` по УЖЕ исполненной сделке → `ACCOUNTING_ANOMALY` в админскую очередь **без автоотзыва** (вероятнее наша ошибка разбора, чем неоплаченная выдача); `3` — оплачено (с оговоркой про `lock_state`/`day_lock`); `35` — `REFUND_PENDING`, уведомление, **отзыва нет** (решение №10 черновика сохранено); `5` — **единственный триггер денежной реакции**.

`rows[].returned` из `seller-sells/v2` — только повод немедленно опросить `purchase/info`, никогда не вердикт: денежный вердикт обязан иметь ровно один источник.

**Суммы (разрешение Д25 + Д38 + Д30):**
- `Order.amount/currency` = снимок НАШЕГО прайса (`plan.price × quantity`, валюта тарифа) — решение №3 черновика в этой части сохранено;
- **`Payment.amount/currency` = ТО ЖЕ, что у заказа** (изменение относительно черновика);
- **новые `Payment.providerAmount Decimal(24,8)` и `Payment.providerCurrency VarChar(8)`** — сумма и валюта площадки в её собственной точности.
Почему так: `Decimal(12,2)` молча округляет `0.00042 BTC` (WMX) до `0.00`, и запись, названную в схеме «единственным источником правды при разборе споров», нечем сверять; кроме того `CHECK (refunded_amount <= amount)` при `amount = 0.00` отверг бы любой возврат по крипто-сделке. Разведение колонок делает инвариант возвратов осмысленным в одной когерентной валюте и сохраняет сумму площадки без потерь.
`mapCurrency` — полное объединение документированных значений трёх методов: `WMZ→USD, WMR→RUB, WME→EUR, WMU→UAH, WMX→BTC, WMT→WMT`; `currency_unmapped` пишется только вне этого объединения (Д38).

---

## 9. Возвраты: наблюдение → факт → реакция (Д10)

**Шаг 1 (сеть, транзакции нет).** `GET /api/purchase/info/{inv}`. Парсится отдельным парсером `PurchaseInfoResponse` (обёртка `content`, поля `currency_type`/`item_id`/`buyer_info.email`; `invoice_id` в ответе НЕТ — несётся из запроса). Ничего не решает.

**Шаг 2 (микро-транзакция).** Запись ФАКТА:
```ts
const written = await prisma.digisellerEvent.createMany({
  data: [{ id: uuidv7(), provider: 'DIGISELLER',
           externalId: `dgs:inv:${inv}:invoice_state:${n}`,   // либо :code_state:${m}
           eventType, digisellerOrderId, payload: raw, receivedAt: now }],
  skipDuplicates: true,
});
```
`createMany({skipDuplicates:true})` (Prisma 6.3 + Postgres, `package.json:52,75`), НЕ `create`+catch: P2002 внутри интерактивной транзакции переводит транзакцию Postgres в aborted, и все следующие запросы падают с 25P02. Управление потоком через исключения на денежном пути запрещено.
`written.count === 0` означает «факт уже известен» и больше ничего. **Сравнения «изменилось ли состояние» нет вообще** — детектор изменения и ключ дедупликации это ОДИН уникальный индекс, и щели между ними не существует. `DigisellerOrder.providerInvoiceState` понижен до проекции, обновляемой той же транзакцией, что и реакция.

**Шаг 3 (дренаж, одна транзакция на событие, сети нет).** `WHERE processed_at IS NULL AND next_attempt_at <= now()`:
1. `refunds.createMany({skipDuplicates:true})`; `count === 0` → факт уже применён, реакции НЕТ, сразу к шагу 8;
2. `payment.update({ refundedAmount: { increment: a } })` → `SET refunded_amount = refunded_amount + $1`, под READ COMMITTED параллельные инкременты складываются корректно, перебор ловит `CHECK`;
3. по агрегату: `>= amount` → `REFUNDED` + `refundedAt` условно `WHERE status IN ('CONFIRMED','PARTIALLY_REFUNDED')`; иначе `PARTIALLY_REFUNDED`;
4. `Order` — та же логика условным `updateMany`, `count = 0` не ошибка;
5. **захват `currentDeviceId`/`hwidHash` СЕЛЕКТОМ ДО отзыва** — `licenses.service.ts:294` обнуляет `currentDeviceId` (Д21);
6. отзыв только при полном возврате: `licenses.revoke(id, reason, actor?, tx)` с guard по статусу;
7. побочные эффекты ВНУТРИ транзакции: `notifications.enqueue(…, tx)`, `audit.record(…, tx)`, `antiFraudEvent.create({…}, tx)`;
8. `digisellerEvent.update({ processedAt })` + `digisellerOrder.updateMany({ where:{id, refundedAt:null}, data:{ refundedAt, providerInvoiceState } })`.

**Правило модуля: никакой дедуп-маркер не продвигается раньше, чем закоммичена реакция.** Единственный маркер прогресса — `processed_at`. Отказ дренажа: `attempts+1`, экспонента, `lastError`; после N подряд — в админскую очередь; `processed_at` не двигается никогда.

Очередь уведомлений годится как outbox без новой машинерии: проект уже решил, что очередь — таблица `notifications`, а не брокер (`notification.service.ts:8-19`), и её разбирает `notification.processor.ts:37-52`.

**Дедупликация ручного и автоматического путей (Д13, Д17).** Ключ = `(payment_id, external_ref)`, где `external_ref` детерминирован от ФАКТА ПЛОЩАДКИ:
| факт | external_ref |
|---|---|
| `invoice_state = 5` | `dgs:inv:{inv}:refund` — ровно один на счёт |
| возврат вне площадки | `manual:{paymentId}:{clientRef}` |
Форма ручного возврата по DIGISELLER-платежу содержит обязательный выбор из двух; «проведён на площадке» — вариант по умолчанию и даёт ТОТ ЖЕ ключ. Ветка «отказ при `invId IS NULL`» из ревизии «деньги» УДАЛЕНА как недостижимая: `inv_id` теперь `NOT NULL`.
Проигравший гонку (`count = 0`) не создаёт вторую строку и не выполняет реакцию вовсе. Если проигравший — админ, а выигравшая строка `ASSUMED_FULL`: корректировка суммы ТОЙ ЖЕ строки через `increment`/`decrement` под тем же CHECK, аудит `refund.amount_corrected`. Если корректировка снижает возврат до частичного, а лицензии отозваны — автоматического «разотзыва» НЕТ и он не изобретается (`licenses.service.ts:281-318`; `extend()` прямо отказывает отозванной, 162-167): ответ явно перечисляет админу отозванные лицензии и предлагает ручную перевыдачу.

**Возврат — операция над ПЛАТЕЖОМ:** `POST /api/v1/payments/:paymentId/refund`. `Order.payments` — список (`schema.prisma:1063`), поэтому `manualRefund(orderId, …)` из черновика в принципе не адресует деньги. Сервис сам поднимает `Order` и `DigisellerOrder` по `payment_id` (уникален, `schema.prisma:1113`) и в ТОЙ ЖЕ транзакции ставит `digiseller_orders.refunded_at` — иначе курсор поллера строку не снимает (Д17).

**Частичный возврат.** Площадка не сообщает сумму возврата ни одним из трёх методов (`purchase/info` — состояние; `unique-code` и `seller-sells` — суммы ПЛАТЕЖА; `amount_in`/`amount_out` как «сколько вернули» нигде не документированы). Поэтому: поллер способен породить только полный (`amount = payment.amount`, `amountConfidence = 'ASSUMED_FULL'` — допущение записывается в колонку, а не прячется); частичный вводит человек (`REPORTED`). Реакция определяется агрегатом `Payment.refundedAmount`, а не строкой, поэтому применение фактов в любом порядке даёт один исход.

**Рецидив.** `count(distinct payment_id)` среди ПОЛНЫХ возвратов `kind='PROVIDER'` в скользящем окне `digiseller.reversal_window_days = 180`. Субъект — сопоставленный `user_id`; `buyerEmail` только MEDIUM-сигнал в `details` (почта нами намеренно не сверяется — решение №20). Споры о доставке и возвраты «вне площадки» не считаются. Снятие отметки уже выражено схемой: `AntiFraudEvent.resolvedAt/resolvedById/resolution` (`schema.prisma:1385-1387`) — отдельной таблицы банов нет.

---

## 10. Поллинг (Д22, Д34, Д35)

- `next_poll_at` продвигается **БЕЗУСЛОВНО**, включая неуспех (Д22); `poll_failures` на строку с потолком → админская очередь после N подряд.
- Профиль наблюдения затухающий и посчитанный: < 24 ч — раз в 15 мин; ≤ 7 суток — раз в час; дальше — раз в сутки. На 1350 сделках это ~200 обращений в час против 1200, которые даёт BACKGROUND (Д35).
- Горизонт наблюдения = `content.day_lock` по конкретной сделке + `digiseller.refund_watch_margin_days`, с полом и потолком в settings — а не константа 90, взятая с потолка.
- Число строк за тик ограничено (`digiseller.poll_batch_size`).
- `seller-sells/v2` честно назван **детектором свежих возвратов**: окно фильтрует по дате ПРОДАЖИ, поэтому развёртка ловит только возвраты первых 48 часов (Д34). Полнота перенесена на поштучный `purchase/info`. Даты запроса — `'yyyy-MM-dd HH:mm:ss'` в МСК (UTC+3), единственное место в системе, где время не UTC.
- health отдаёт не «время последнего тика», а **МАКСИМАЛЬНЫЙ возраст `next_poll_at` среди наблюдаемых строк** и число строк с `poll_failures > 0` — только это отличает «поллинг идёт» от «поллинг крутится на одной строке».

---

## 11. Deliver-процессор (Д24, Д32) — ни одна ревизия его не спроектировала

Таблица кодов у `deliver` документирована ПОЛНОСТЬЮ, поэтому правило «никогда REJECT» на него НЕ распространяется — оно остаётся только у `searchuniquecode`.

`digiseller_orders`: `deliver_state`, `deliver_attempts`, `next_deliver_at`, `deliver_notified_at`, `deliver_error`.
`CHECK ((deliver_state IN ('DELIVERED','DENIED','CODE_REJECTED','GIVEN_UP')) = (next_deliver_at IS NULL))` — тот же приём, что у claim.
Тот же лизинг. Полоса BACKGROUND, вес 30.

| retval | реакция |
|---|---|
| `0`, `4` | `DELIVERED`, `deliver_notified_at = now()`, терминал |
| `3` | наш баг порядка вызовов: ERROR в лог, бэкофф, повтор |
| `-3`, `-4` | инвалидация токена, один релогин, повтор |
| `-5` | **терминально** `DENIED` + capability `content_change = DENIED` + алерт + health degraded |
| `-2`, `1`, `2` | **терминально** `CODE_REJECTED` + админская очередь |
| сеть/HTML/неизвестный | бэкофф с потолком; календарный горизонт → `GIVEN_UP` в админскую очередь |

Аналогично для `purchase/info` и `seller-sells/v2`: любой `retval != 0` — ошибка ЗАПРОСА (детали из `errors`/`retdesc`), а не сетевой сбой. Опечатка в формате `date_start` даёт `retval 11` громко, а не молча вечно.

---

## 12. Правки схемы — миграция `20260803120000_digiseller_payments`

Таблицы `orders`, `payments`, `digiseller_orders` пусты, модуля нет — миграция бесплатна.

**Новая `digiseller_claims`:**
```
id                    uuid PK (uuid v7 — он же публичный claim_id)
code_hash             char(64) NOT NULL              -- sha256(lower(normalizeCode(code)))
unique_code           varchar(64) NULL               -- литерал; NULL после терминала
claimed_by_user_id    uuid NOT NULL FK users ON DELETE CASCADE
digiseller_order_id   uuid NULL FK digiseller_orders ON DELETE SET NULL
state                 DigisellerClaimState NOT NULL
stall_reason          DigisellerStallReason NULL
block_code            DigisellerBlockCode NULL
reject_reason         DigisellerRejectReason NULL
email_match           boolean NULL
verify_attempts       int NOT NULL DEFAULT 0
upstream_refusals     int NOT NULL DEFAULT 0
fulfill_attempts      int NOT NULL DEFAULT 0
undecidable_streak    int NOT NULL DEFAULT 0
uc_reserved           int NOT NULL DEFAULT 0
uc_spent              int NOT NULL DEFAULT 0
response_fingerprint  char(64) NULL                  -- группировка мусора в очереди
next_attempt_at       timestamptz NULL
not_before            timestamptz NOT NULL           -- таймер выдержки анти-оракула
escalate_at           timestamptz NOT NULL
leased_until          timestamptz NULL
ip                    inet NULL
last_error            text NULL
created_at, updated_at, resolved_at

UNIQUE (code_hash, claimed_by_user_id)
INDEX (next_attempt_at) WHERE next_attempt_at IS NOT NULL
INDEX (state, created_at) WHERE state IN ('BLOCKED_UNMAPPED','BLOCKED_INPUT','STALLED')
INDEX (digiseller_order_id)
INDEX (claimed_by_user_id, state)
INDEX (response_fingerprint) WHERE response_fingerprint IS NOT NULL
CHECK ((state IN ('FULFILLED','REJECTED')) = (next_attempt_at IS NULL))
CHECK (state <> 'REJECTED' OR reject_reason IS NOT NULL)
```

**`digiseller_orders`:**
- `+ code_hash char(64) NOT NULL UNIQUE` — настоящий ключ однократности;
- **`unique_code` УДАЛЯЕТСЯ целиком** (литерал живёт только на claim и обнуляется в терминале — минус одно место экспозиции против всех трёх ревизий);
- `inv_id`: `BigInt?` → **`BigInt NOT NULL @unique`** + `CHECK (inv_id > 0)`;
- `redeemed_by_user_id` → FK на `users` `ON DELETE SET NULL` + индекс (пробел, уже закрытый для `registration_keys.used_by_user_id`);
- `+ provider_invoice_state Int?`, `provider_code_state Int?`, `disputed_at`, `provider_paid_at`, `cart_uid`, `lock_state`, `day_lock`;
- `+ deliver_state`, `deliver_attempts`, `next_deliver_at`, `deliver_notified_at`, `deliver_error`, `leased_until`;
- `+ next_poll_at`, `poll_failures`;
- `+ INDEX (created_at) WHERE redeemed_at IS NULL` — свипер осиротевших сделок;
- `+ INDEX (next_poll_at) WHERE redeemed_at IS NOT NULL AND refunded_at IS NULL`;
- `+ INDEX (next_deliver_at) WHERE next_deliver_at IS NOT NULL`;
- `+ INDEX (digiseller_product_id)`, `INDEX (verified_at)`;
- **НЕ добавляются:** `state`, `claimed_by_user_id`, `verify_attempts`, `quarantine_code`, `last_error` — перенесены в claim;
- **НЕ добавляется `UNIQUE (lower(unique_code))`** — пункт 5 «Правок схемы» черновика отменён целиком (его роль исполняет `code_hash`, его вред — Д4, Д8, Д29 — исчезает вместе с ним).

**`payments`:**
- `+ provider_amount Decimal(24,8) NULL`, `+ provider_currency VarChar(8) NULL`;
- `+ refunded_amount Decimal(12,2) NOT NULL DEFAULT 0` + `CHECK (refunded_amount >= 0 AND refunded_amount <= amount)`;
- `CHECK (provider <> 'DIGISELLER' OR external_id ~ '^[1-9][0-9]{0,18}$')` — настоящая версия п.2 черновика; запрет ведущих нулей обязателен, иначе `42` и `042` дают два ключа на один счёт.

**Новая `refunds`:** `id, payment_id FK Restrict, order_id FK Restrict, amount Decimal(12,2), currency VarChar(3), kind RefundKind, amount_confidence RefundAmountConfidence, external_ref VarChar(191), reason, created_by_id, created_at`; `@@unique([paymentId, externalRef])`, `@@index([orderId])`, `@@index([createdAt])`.
Обоснование отдельной сущности (шесть фактов схемы): возвратов 0..N, а `Payment.refundedAt`/`Order.refundedAt`/`DigisellerOrder.refundedAt` — по одному Timestamptz (`1094`, `1058`, `1135`); суммы нет нигде (`PaymentStatus` — enum без значения, `116-121`); ни актора, ни причины (только `comment` `1061` и `errorMessage` `1095`, при собственной конвенции `License.blockedAt/Reason/ById` `841-843`); свободного уникального слота на `payments` нет (`@@unique([provider, externalId])` `1102` занят идентичностью платежа); `ResellerTransaction` не подходит (`resellerId NOT NULL` `1005-1006`, ноль уникальных ключей, `orderId`/`licenseId` без FK и индексов `1015-1016`); `rawPayload` перезаписывается (`1127`).

**Новая `digiseller_events`:** `id, provider, external_id, event_type, digiseller_order_id FK, payload JsonB, received_at, processed_at, attempts, next_attempt_at, last_error`; `@@unique([provider, externalId])`; частичный индекс `(next_attempt_at) WHERE processed_at IS NULL`.

**Новая `blocked_hwids`:** `hwid_hash char(64) PK, reason, severity, created_at, created_by_id, lifted_at, lifted_by_id, lifted_reason`.

**Enum'ы:** `OrderStatus += PARTIALLY_REFUNDED`; `PaymentStatus += PARTIALLY_REFUNDED`; `AntiFraudType += CODE_BRUTEFORCE, PAYMENT_REVERSAL` (`ALTER TYPE … ADD VALUE`, отдельной транзакцией миграции); новые `DigisellerClaimState`, `DigisellerStallReason`, `DigisellerBlockCode`, `DigisellerRejectReason`, `DigisellerDeliverState`, `RefundKind`, `RefundAmountConfidence`.

**`Order.number`:** `@default(dbgenerated("next_order_number()"))` — оживляет уже созданный сиквенс (`catchup_audit_gaps/migration.sql:145-154` против `schema.prisma:1034`). Плюс `Order @@index([status, createdAt])`.

**Сид:** шаблоны `order.delayed`, `order.refunded`, `license.revoked` (ru/en, EMAIL) — их нет (`seed.ts:333-396` содержит только `license.issued`, `license.expiring`, `hwid.reset`, `order.delivered`). Отсутствие шаблона = тихая потеря письма: `render()` бросает, процессор наращивает `attempts` и через 5 попыток ставит FAILED, а FAILED никем не переоткрывается (`notification.processor.ts:95-111`).
Новое право `billing.digiseller.operate` (категория `billing`) → `super_admin`, `admin`.
Настройки: `digiseller.retry_horizon_hours=72`, `owner_grace_sec=900`, `unmapped_recheck_sec=600`, `unmapped_alert_hours=2`, `max_open_claims_per_user=3`, `claim_ttl_days=30`, `reject_retvals=[]`, `self_retry_per_claim_per_hour=2`, `verdict_dwell_sec=15`, `reversal_window_days=180`, `refund_watch_margin_days=14`, `poll_batch_size=200`, `max_quantity=20`, `ts_forward_cap_sec=60`, весь блок `limits.digiseller.*`.

**`env.schema.ts`:** оставить `DIGISELLER_SELLER_ID`, `DIGISELLER_API_KEY` (**живые**, см. §0), `DIGISELLER_API_BASE` (умолчание уже `.com`); удалить `DIGISELLER_TOKEN_CACHE_TTL`, `DIGISELLER_POLL_INTERVAL`; добавить `DIGISELLER_TIMEOUT_MS=10000`, `DIGISELLER_FALLBACK_BASE=https://oplata.info`.

---

## 13. Файлы

```
apps/api/src/modules/payments/
  CLAUDE.md                              инварианты модуля
  payments.module.ts
  orders.controller.ts / orders.service.ts
  payments.controller.ts
  refunds.service.ts
  reconciliation.processor.ts            @Cron(EVERY_DAY_AT_3AM) — суточная сверка (Д30)
  dto/{orders,payments,refunds,digiseller}.dto.ts
  digiseller/
    digiseller.controller.ts             redeem, claims, queue, health
    digiseller-claim.service.ts          интейк (фаза A) + разбор вердикта (фаза B)
    digiseller-fulfillment.service.ts    фаза C — ЕДИНСТВЕННАЯ транзакция
    digiseller-preflight.service.ts      parseInv/plan/quantity/currency ДО транзакции
    digiseller-queue.service.ts          админская очередь + resolve/close/fingerprint
    digiseller-config.service.ts         OK | NOT_CONFIGURED | DECRYPT_FAILED | capabilities
    digiseller-token.service.ts          Redis-кеш + single-flight + ts = max(now, last+1)
    digiseller-budget.service.ts         UC: резерв, возврат, три полосы, fail-degraded
    digiseller.client.ts                 DigisellerHttpClient implements DigisellerApi
    digiseller.mapper.ts                 ЧИСТЫЕ функции (см. сигнатуры)
    digiseller.types.ts                  ТРИ разных типа ответа (Д31)
    digiseller-claim.processor.ts        @Interval(15_000) — единственный воркер claim
    digiseller-deliver.processor.ts      @Interval(60_000) — дозвон deliver
    digiseller-poll.processor.ts         @Cron(EVERY_5_MINUTES) — наблюдение
    digiseller-event.processor.ts        @Interval(10_000) — дренаж digiseller_events
    digiseller-orphan.processor.ts       @Cron(EVERY_HOUR) — осиротевшие сделки
    digiseller.constants.ts
apps/api/src/modules/security/blocked-hwid.service.ts        (+ контроллер снятия)
apps/api/prisma/migrations/20260803120000_digiseller_payments/migration.sql
apps/api/test/digiseller-*.spec.ts
```
Правки существующих: `licenses.service.ts` (`revoke(…, tx?)` + guard), `notification.service.ts` (`enqueue(params, tx?)`), `audit.service.ts` (`record(entry, tx?)`), `hwid.service.ts` (проверка `blocked_hwids` в ОБЕИХ ветках), `schema.prisma`, `seed.ts`, `env.schema.ts`, `app.module.ts`, `main.ts` (`process.on('unhandledRejection'|'uncaughtException')` — их в проекте нет ни одного).

---

## 14. Сигнатуры

```ts
// digiseller.mapper.ts — чистые функции, таблично тестируются без сети
export function parseInv(raw: unknown): { ok: true; inv: bigint } | { ok: false; reason: string };
export function invRef(inv: bigint): string;            // ЕДИНСТВЕННЫЙ способ получить строку счёта
export function normalizeCode(raw: string): string;     // trim + \s + zero-width; регистр НЕ трогаем
export function codeHash(normalized: string): string;   // sha256(lower(normalized))
export function mapCurrency(code: string): { code: string; mapped: boolean };
export function resolveQuantity(cnt: unknown, max: number):
  { quantity: number } | { block: 'QUANTITY_FRACTIONAL' | 'QUANTITY_OUT_OF_RANGE' };
export function classifyUniqueCode(r: RawHttp): UniqueCodeVerdict;   // OK даёт УЖЕ распарсенный inv: bigint
export function classifyDeliver(r: RawHttp): DeliverVerdict;         // документированная таблица, терминалы есть
export function parsePurchaseInfo(r: RawHttp): PurchaseInfoVerdict;  // обёртка content
export function parseSellerSells(r: RawHttp): SellerSellsVerdict;

// digiseller.client.ts
export interface DigisellerApi {
  login(sellerId: string, apiKey: string, ts: number): Promise<LoginVerdict>;
  getPurchaseByUniqueCode(code: string, token: string): Promise<UniqueCodeVerdict>;
  markDelivered(code: string, token: string): Promise<DeliverVerdict>;
  getPurchaseInfo(inv: bigint, token: string): Promise<PurchaseInfoVerdict>;
  listReturnedSales(p: { from: Date; to: Date; page: number; rows: number }, token: string): Promise<SellerSellsVerdict>;
  getPerms(token: string): Promise<string[] | null>;
}
export const DIGISELLER_API = Symbol('DIGISELLER_API');   // в тестах — FakeDigisellerApi

// digiseller-claim.service.ts
type ClaimAck = { claimId: string; retryAfterSec: number };            // ОДИН конверт на все исходы
type ClaimStatus =
  | { state: 'PENDING' | 'ACCEPTED_DELAYED'; retryAfterSec: number; canRetry?: boolean }
  | { state: 'FULFILLED'; orderId: string; orderNumber: string; licenseKeys: string[] }
  | { state: 'REJECTED'; code: 'CODE_INVALID' | 'CODE_TAKEN_BY_OTHER' | 'CLOSED'; ticket?: string };
class DigisellerClaimService {
  async redeem(rawCode: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<ClaimAck>;
  async status(claimId: string, actor: AuthenticatedUser): Promise<ClaimStatus>;
  async selfRetry(claimId: string, actor: AuthenticatedUser): Promise<ClaimAck>;
}

// digiseller-fulfillment.service.ts — идемпотентен, зовётся из HTTP и из воркера
class DigisellerFulfillmentService { async fulfill(claimId: string): Promise<ClaimStatus>; }

// refunds.service.ts
class RefundsService {
  async applyProviderRefund(i: { paymentId: string; inv: bigint; eventId: string }, tx: Prisma.TransactionClient): Promise<void>;
  async manualRefund(paymentId: string, dto: ManualRefundDto, actor: AuthenticatedUser): Promise<void>;
}

// ПРАВКИ существующих
async revoke(licenseId: string, reason: string, actor?: AuthenticatedUser, tx?: Prisma.TransactionClient)
async enqueue(params: EnqueueParams, tx?: Prisma.TransactionClient): Promise<string | null>
async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void>
```

**Ловушка, обязательная к знанию реализатора:** `enqueue` и `record` сегодня ГЛОТАЮТ ошибку (`notification.service.ts:74-81`, `audit.service.ts:151-157`). Внутри транзакции это опаснее, чем снаружи: упавший INSERT переводит транзакцию Postgres в aborted, и все последующие запросы падают с 25P02 — проглоченная ошибка превращается в необъяснимый отказ ЧЕРЕЗ несколько шагов. Правило: **при переданном `tx` обе функции обязаны ПРОБРАСЫВАТЬ ошибку; глотание сохраняется только для вызовов без `tx`.**

`revoke` с guard:
```ts
const claimed = await db.license.updateMany({
  where: { id: licenseId, status: { not: LicenseStatus.REVOKED } },
  data: { status: 'REVOKED', revokedAt: now, revokedReason: reason, currentDeviceId: null },
});
if (claimed.count === 0) return null;   // тихий no-op: ни письма, ни аудита, ни анти-фрод события
```

---

## 15. Эндпоинты

| Метод | Путь | Доступ | Лимиты | Ответы |
|---|---|---|---|---|
| POST | `/api/v1/billing/digiseller/redeem` | JWT | malformed 20/IP/10мин (0 UC); резерв 6 UC с user/ip/subnet; max_open_claims 3 | **всегда 202 + claimId** / 400 CODE_MALFORMED / 429 / 503 |
| GET | `/api/v1/billing/digiseller/claims/:claimId` | JWT, только заявителю | дешёвый счётчик | таблица §5 |
| POST | `/api/v1/billing/digiseller/claims/:claimId/retry` | JWT, только заявителю | `self_retry_per_claim_per_hour=2`, стоит UC | 202 / 429 |
| GET | `/api/v1/billing/digiseller/queue` | `orders.read.any` | — | BLOCKED_UNMAPPED (сгруппировано по `digisellerProductId`), BLOCKED_INPUT, STALLED (сгруппировано по `response_fingerprint`), ORPHANED_DEAL, ACCOUNTING_ANOMALY, DISPUTED, deliver GIVEN_UP/DENIED |
| POST | `/api/v1/billing/digiseller/queue/claims/:claimId/resolve` | `billing.digiseller.operate`, `@Audit` | — | override quantity/inv/currency/plan; «проверить сейчас» |
| POST | `/api/v1/billing/digiseller/queue/claims/:claimId/close` | `billing.digiseller.operate`, `@Audit` | — | → REJECTED(ADMIN_CLOSED / PRODUCT_WITHDRAWN) |
| POST | `/api/v1/billing/digiseller/queue/fingerprints/:fp/terminal` | `billing.digiseller.operate`, `@Audit` | — | добавляет retval в `digiseller.reject_retvals` через `SettingsService.set` |
| GET | `/api/v1/billing/digiseller/health` | `payments.read` | — | конфигурация, capabilities, breaker, дрейф часов, срез по `state`, `oldest_unmapped_age_sec`, `max_next_poll_age_sec`, `poll_failing_rows`, `orphaned_deals`, `unprocessed_events`. **В `/health/ready` НЕ включается** |
| POST | `/api/v1/billing/digiseller/health/reset` | `billing.digiseller.operate`, `@Audit` | — | сброс breaker и отрицательного кеша (Д26) |
| GET | `/api/v1/orders`, `/orders/:id` | `resolveScope(actor,'orders.read')` | — | |
| GET | `/api/v1/payments` | `payments.read` | — | |
| POST | `/api/v1/payments/:paymentId/refund` | `orders.refund`, `@Audit` | — | ручной возврат |
| GET/POST/DELETE | `/api/v1/security/blocked-hwids[/:hash]` | `licenses.block`, `@Audit` | — | список / блокировка / снятие |

`GET /redeem/:code/status` из черновика **УДАЛЁН**: код в URL попадает сразу в два журнала — nginx `'"uri":"$request_uri"'` (`default.conf.template:22-33`, `access_log` на `:163`) и `${request.method} ${request.url}` в обеих ветках фильтра (`all-exceptions.filter.ts:46,50`; сериализатор pino отдаёт `url` целиком, `logger.module.ts:88-98`). Код едет только телом POST под именем `uniqueCode`, которое УЖЕ стоит в redact-списке (`logger.module.ts:73`) — то есть тело как транспорт было предусмотрено заранее.
Отдельно: наш ИСХОДЯЩИЙ URL к площадке содержит `?token=` по требованию контракта, поэтому логирование исходящих запросов и текст любых ошибок клиента обязаны маскировать параметр `token`.

Входящего вебхука и `supplier-callback` в v1 нет.

---

## 16. HTTP-клиент

Внутри модуля, не в `common/` (кодирует специфику площадки, а не транспорт). Голый `fetch` + `AbortSignal.timeout` по образцу `discord.provider.ts:88-99`; готового клиента в проекте нет.
Обязательное: проверка `Content-Type` ДО парсинга (DDoS-Guard отдаёт HTML при HTTP 200); нормализация трёх несовместимых схем ошибок (HTTP 200 + `retval<0`; HTTP 400 + `{retval,retdesc}`; HTTP 401 с пустым телом либо `[]`); default-ветка «неизвестный retval → RETRYABLE, никогда не REJECT» **только для `searchuniquecode`**; ретраи только для идемпотентных GET (макс 2, backoff 300/900 мс с джиттером); на 401 — ровно одна принудительная инвалидация токена и один повтор, повторный 401 → RETRYABLE; `apilogin` не ретраится с тем же timestamp никогда.
Breaker на хост в Redis, **half-open задан явно**: одна пробная попытка раз в `breaker_probe_sec`, брейкер закрывается на первом успехе, проба идёт МИМО любого бакета (Д26).
Failover на `oplata.info` ТОЛЬКО для семейства unique-code (check + deliver) — для остальных методов резерв не документирован, слепой failover даст загадочные 404. Токен валиден на обоих хостах, перелогин не нужен.

---

## 17. Тесты — включая сквозняк БЕЗ живой площадки

Ключ к «без площадки»: `DIGISELLER_API` — Nest-токен, в тестах `FakeDigisellerApi`. Чтобы фейк не разъехался с реальностью, вводится **contract-fixtures**: `test/fixtures/digiseller/*.json` — литеральные JSON из примеров документации, ОТДЕЛЬНО на каждый метод (`unique-code` плоский, `purchase/info` в обёртке `content`, `seller-sells/v2` со своими именами полей). `digiseller-contract.spec.ts` утверждает, что фейк отдаёт ровно эти формы и парсеры их читают — это исполняемая защита от Д31, которую невозможно получить на общей схеме.

- `digiseller-mapper.spec.ts` — `parseInv` таблицей: `{undefined, null, '', 'undefined', 0, '0', '042', '12 34', '1e5', 1.5, -1, '9223372036854775808', 42, '42', {}, []}`. `normalizeCode`: пробелы, U+200B/U+FEFF удаляются, регистр НЕ меняется (assert на точное равенство букв). `mapCurrency`: WMZ/WMR/WME/WMU/WMX/WMT → mapped, прочее → `mapped:false`. `resolveQuantity`: `{undefined, null, 0, 1, 1.0, 2.5, 20, 21, '3', NaN, Infinity}`. `classifyUniqueCode` семь конвертов: retval 0; HTTP 400 `{-4, "неверно задан параметр token"}` → AUTH; HTTP 401 пустое тело → AUTH; HTTP 401 `[]` → AUTH; HTTP 200 + `text/html` → RETRYABLE и парсер не бросает; HTTP 200 `retval=99` → RETRYABLE, НЕ REJECT; retval из `reject_retvals` → REJECT.
- `digiseller-signature.spec.ts` — эталонная пара вход/выход: `sha256(apiKey + timestamp)` hex, конкатенация без разделителя, без `seller_id`, порядок ключ→timestamp.
- `digiseller-no-http-in-tx.spec.ts` — **исполняемая форма главного инварианта**: шпион на `PrismaService.$transaction` взводит флаг, `FakeDigisellerApi` бросает при взведённом флаге. Прогнать redeem, дренаж возврата, все четыре процессора.
- `digiseller-race.spec.ts` (РЕАЛЬНЫЙ Postgres — вся защита это уникальный индекс и EvalPlanQual) — 20 итераций × 20 параллельных redeem одного кода от РАЗНЫХ пользователей: ровно 1 `orders`, 1 `payments`, 1 `digiseller_orders`, ровно `quantity` лицензий; ровно один claim FULFILLED; **ноль ответов 500 и ноль 409 на POST**; ни одной `orders`/`payments` без `digiseller_orders`.
- `digiseller-race.spec.ts` — регистр: `'abc…'` и `'ABC…'` от ОДНОГО пользователя дают ОДИН claim (та же строка, тот же claim_id); от РАЗНЫХ — два независимых claim, один FULFILLED, второй REJECTED(TAKEN_BY_OTHER). Ни одной карантинной записи.
- `digiseller-redeem.spec.ts` — повтор формы: два вызова подряд и два параллельно → один и тот же `claimId`, статус 200 с ОДНИМ набором ключей, одна лицензия. **Ни при каких условиях второй вызов не отдаёт 409 тому же пользователю.**
- `digiseller-antioracle.spec.ts` — несуществующий код и чужой погашенный: POST оба раза 202 с телами, различающимися только `claimId`; статус после `verdict_dwell_sec` — одинаковые статус/`code`/`message`/отсутствие `details`, задержки в одном диапазоне. Плюс: расход UC-бюджета одинаков в обоих случаях.
- `digiseller-claim.spec.ts` — таймаут посреди проверки (транспорт не резолвится): 202 за бюджет `AbortSignal.timeout`, `PENDING_VERIFY`, `verify_attempts=1`, `next_attempt_at` в будущем, лицензий и заказа нет. Транспорт чинится, тик → ровно одна лицензия.
- `digiseller-claim.spec.ts` — пять тиков подряд при успешном транспорте: одна лицензия, `redeemedAt` не менялся.
- `digiseller-claim.spec.ts` — площадка недоступна 72 ч (виртуальные часы): `STALLED`, `redeemed_at` NULL, claim в очереди, `canRetry`, самообслуживание работает. **Ни одного перехода в терминал.**
- `digiseller-claim.spec.ts` — НАШ отказ (бакет/breaker/NOT_CONFIGURED): `upstream_refusals` растёт, `verify_attempts` НЕ растёт, UC не тратится.
- `digiseller-claim.spec.ts` — **лизинг:** процесс убивается сразу после лизинга; следующий тик не берёт строку раньше `lease_sec`; за час на детерминированно падающей строке не более `3600/lease_sec` обращений (утверждение против Д7).
- `digiseller-fulfillment.spec.ts` — откат: `licenses.issue` бросает на второй лицензии при `quantity=2` → ни одного Order/Payment/License; claim вернулся в `PENDING_FULFILL` с `fulfill_attempts=1` и сдвинутым `next_attempt_at`; `redeemed_at` NULL; повторный прогон выдаёт ровно одну партию.
- `digiseller-fulfillment.spec.ts` — счастливый путь: `orders` DELIVERED, `number` вида `ORD-2026-NNNNNN` из сиквенса, `amount = plan.price × quantity` в валюте тарифа; `payments` CONFIRMED, `external_id = invRef(inv)`, `provider_amount/provider_currency` заполнены; claim FULFILLED с `unique_code IS NULL`.
- `digiseller-preflight.spec.ts` — несмапленный товар → `BLOCKED_UNMAPPED/PRODUCT_UNMAPPED`, 202, `verified_at` есть, `redeemed_at` и `payment_id` NULL, `orders/payments/licenses` пусты, письмо `order.delayed` одно. Затем админ проставляет `digisellerProductId` — **и ВСЕ ждущие claim по этому `id_goods` выдаются САМИ на ближайшем тике, без единого resolve** (утверждение против Д5). Отдельно `isActive=false` → `PLAN_INACTIVE`.
- `digiseller-preflight.spec.ts` — `inv=undefined` → ни одной строки в `payments`, 202, `BLOCKED_INPUT/INV_UNPARSEABLE`, `redeemed_at` NULL; после resolve с ручным вводом inv — ровно одна лицензия.
- `digiseller-deliver.spec.ts` — обрыв после коммита: `deliver_notified_at` NULL → тик → заполнен. `retval 4` → повторного вызова нет. `retval 3` → ERROR, повтор с бэкоффом. **`retval -5` → терминальный `DENIED`, capability `content_change=DENIED`, строка ВЫХОДИТ из выборки, health degraded** (утверждение против Д32/Д24): прогнать 100 тиков и убедиться, что обращений после терминала ноль.
- `digiseller-poll.spec.ts` — возврат и идемпотентность: `invoice_state=5`, тик дважды. После первого: license REVOKED со снятым `currentDeviceId`, order/payment REFUNDED, `refunded_at`, одна строка `refunds`, одна `digiseller_events`, одно письмо, одна запись аудита. После второго — ни один счётчик не изменился. Повторить дренаж пять раз — то же.
- `digiseller-poll.spec.ts` — **переигрываемость (Д10):** событие записано, дренаж НЕ вызван (имитация падения) → прогнать дренаж → возврат обработан ровно один раз.
- `digiseller-poll.spec.ts` — `unique_code_state=4`: лицензия ACTIVE, `refunds` пуст, payment CONFIRMED, `disputed_at` проставлен, админ уведомлён. Затем `invoice_state=5` по тому же inv → отзыв ровно один раз.
- `digiseller-poll.spec.ts` — `invoice_state ∈ {1,2,4}` по исполненной сделке → `ACCOUNTING_ANOMALY`, **отзыва нет**.
- `digiseller-poll.spec.ts` — **вечно падающая сделка (Д22):** одна строка всегда не-OK. Утверждение: `next_poll_at` продвинулся, остальные строки опрошены, `poll_failures` растёт, после N строка ушла в очередь, health показывает ненулевой `poll_failing_rows`.
- `digiseller-poll.spec.ts` — формат дат `seller-sells/v2`: `'yyyy-MM-dd HH:mm:ss'` в UTC+3, отдельно окно через полночь МСК и через полночь UTC.
- `digiseller-refund.spec.ts` — межисточниковая дедупликация: ручной «на площадке», затем два тика → одна строка `refunds`, одно письмо, одно анти-фрод событие, `digiseller_orders.refunded_at` проставлен ручным путём. Зеркально: поллер первый, админ вторым с другой суммой → одна строка, сумма скорректирована, `refund.amount_corrected` в аудите.
- `digiseller-refund.spec.ts` — рецидив: один возврат, обнаруженный обоими путями → `count(distinct payment_id)=1` → бана НЕТ. Два разных платежа в окне → бан. Два в 200 днях при окне 180 → бана нет.
- `digiseller-refund.spec.ts` — частичный: 30% → `PARTIALLY_REFUNDED`, лицензии ACTIVE; затем 80% → CHECK отвергает (23514), откат, событие в очередь, `refundedAmount` остался 30%.
- `digiseller-refund.spec.ts` — откат не оставляет письма: заставить падать последний шаг → ноль строк `license.revoked` в `notifications`, ноль `license.revoke` в `audit_logs` (Д18/Д23).
- `digiseller-refund.spec.ts` — WMX: `provider_amount=0.00042`, `provider_currency='BTC'`, `payment.amount` = наш прайс; полный возврат срабатывает (Д25).
- `digiseller-limits.spec.ts` — опечатка честного покупателя: три кода длиной 15/17/вне charset, затем верный → 400,400,400,202; **НОЛЬ обращений к fake на первых трёх**; дорогой счётчик не увеличился; дешёвый увеличился трижды.
- `digiseller-limits.spec.ts` — перебор: 200 формально корректных кодов из одного аккаунта → fake получил не более `uc_per_user_per_hour` вызовов, дальше 429 с `Retry-After`, ровно ОДИН `AntiFraudEvent(CODE_BRUTEFORCE)` на пересечении мягкого порога, в `details` только sha256.
- `digiseller-limits.spec.ts` — честный покупатель во время шторма с другого IP/аккаунта проходит.
- `digiseller-limits.spec.ts` — **полосы:** насытить BACKGROUND ретраями и поллингом → свежий redeem проходит (FAST не тронут); насытить FAST → apilogin проходит (CONTROL не делится).
- `digiseller-limits.spec.ts` — **fail-degraded:** Redis недоступен → malformed fail-open с WARN; дорогие лимиты и полосы ограничивают процессным бакетом (поток конечен и ненулевой); **503 из-за исчерпания глобального бакета НЕ возникает**; проба half-open проходит.
- `digiseller-limits.spec.ts` — отрицательный кеш: один терминально отвергнутый код (при заполненном `reject_retvals`) десять раз → одно обращение, девять из кеша, дешёвый счётчик +10, порог `CODE_BRUTEFORCE` учитывает попадания. Сетевой сбой в кеш НЕ попадает. Регистровый вариант кеш НЕ подавляет (утверждение против ошибочной половины Д36).
- `digiseller-token.spec.ts` — стадо: 50 параллельных операций при пустом кеше → РОВНО один `apilogin`, ни одного `-4`. Два логина в одну секунду → РАЗНЫЕ ts, оба ≥ настенного времени.
- `digiseller-token.spec.ts` — **Д14 напрямую:** Redis очищен (имитация LRU-eviction) → следующий ts ≈ `Date.now()/1000`, а НЕ 1. Через «месяц» виртуального времени ts по-прежнему равен настенному ±1.
- `digiseller-token.spec.ts` — часы шагнули назад на час → логины ОСТАНОВЛЕНЫ, `CLOCK_SUSPECT`, алерт; ts не ушёл вперёд больше `ts_forward_cap`.
- `digiseller-token.spec.ts` — TTL из `valid_thru`, а не из константы; `valid_thru` абсурдный → пол 600 с; 401 → одна инвалидация + один повтор; повторный 401 → RETRYABLE, не цикл; `-4` → пересчитаны И ts, И подпись.
- `digiseller-client.spec.ts` — failover: 500 на `.com`, успех на `oplata.info`; breaker пометил хост; `apilogin`/`purchase/info`/`seller-sells` на `oplata.info` НЕ уходили. Пять провалов → breaker открыт; **half-open проба закрывает его**; `POST /health/reset` тоже.
- `digiseller-config.spec.ts` — **переписан под §0:** `digiseller.api_key=''` в settings + заполненный `DIGISELLER_API_KEY` в окружении → конфигурация **OK**, redeem работает. Отдельно: шифротекст, записанный в обход `set()` → `safeDecryptSecret` вернул `null` → `DECRYPT_FAILED` (а не NOT_CONFIGURED), ERROR в логе, redeem 503. Отдельно: обе строки пусты и env пуст → `NOT_CONFIGURED`, **строка claim НЕ создаётся**.
- `digiseller-capabilities.spec.ts` — 403 на `seller-sells` → поллер стоит, health КРАСНЫЙ, redeem работает; `-5` на deliver → deliver выключен, health degraded; 403 на `unique-code` → redeem 503. `token/perms` отдаёт `[]` → **каналы НЕ выключаются**, только пояснение в health (утверждение против рецепта Д33).
- `hwid-block.spec.ts` — **Д11/Д21:** заблокировать `hwid_hash`, купить вторую лицензию, попытаться привязать ту же машину → отказ В ВЕТКЕ ПЕРВОЙ ПРИВЯЗКИ, строка `devices` НЕ создана. `setManually` отказывает при заблокированном железе (кроме отдельного права). Реакция на рецидив: `deviceId`/`hwidHash` в анти-фрод событии НЕ NULL (утверждение, что захват идёт ДО `revoke`). Снятие блокировки работает эндпоинтом, без SQL.
- `reconciliation.spec.ts` — **Д30:** суточная сверка `sum(payments.provider_amount)` против выписки-фикстуры и `sum(refunds.amount)` против `payments.refunded_amount`; расхождение → строка в очередь. Отдельно: 100 покупок с расхождением > X% на одну почту за сутки → аномалия.
- `digiseller-rbac.spec.ts` — redeem без JWT → 401; чужой `claimId` → 404 (не 403 — иначе это оракул существования заявки); `/orders` обычным пользователем только свои; `/payments` без `payments.read` → 403; `POST /payments/:id/refund` без `orders.refund` → 403; `queue/resolve` без `billing.digiseller.operate` → 403; `/health/ready` НЕ деградирует при мёртвой площадке.
- `digiseller-e2e.spec.ts` — сквозняк до лаунчера: redeem → claim → статус FULFILLED → лицензия PENDING с `expiresAt=null` → `POST /launcher/license/check` с подписью и HWID → `activate`, `status=ACTIVE`, `expiresAt` от `durationDays` и от момента ПЕРВОЙ проверки (не от оплаты); при `durationDays=NULL` остаётся NULL; в `hwid_history` запись FIRST_BIND. Затем возврат → повторный check отказывает, привязка снята.
- `schema-invariants.spec.ts` (SQL после миграции) — CHECK отвергает `payments(provider='DIGISELLER', external_id='undefined')` и `'042'`; `INSERT INTO orders` без `number` даёт `ORD-2026-NNNNNN` (три подряд); FK `digiseller_orders.redeemed_by_user_id → users` с `ON DELETE SET NULL` и индексом; **индекса `lower(unique_code)` НЕ существует**; `digiseller_orders.inv_id` NOT NULL; CHECK claim не даёт вставить `FULFILLED` с непустым `next_attempt_at` и `REJECTED` без `reject_reason`; EXPLAIN воркера использует частичный индекс `(next_attempt_at) WHERE NOT NULL`.
- `invariants.helper.ts` — после КАЖДОГО сценария: ноль `payments` DIGISELLER с NULL/битым `external_id`; для каждой `digiseller_orders` с `redeemed_at` — ровно один payment и один order; число лицензий заказа = `order.quantity`; ноль `orders` в `PAID` старше минуты; ноль claim в терминале с непустым `next_attempt_at`; ноль claim в нетерминале с пустым `next_attempt_at`; `sum(refunds.amount) = payments.refunded_amount` по каждому платежу; **ноль появлений литерала кода в перехваченном логе и в `anti_fraud_events.details`**.


### Решения

#### 1. ШОВ 1. Есть ли у digiseller_orders колонка state? Ревизия «жизненный цикл» её убирает («НЕ добавляются: state, claimed_by_user_id, quarantine_code…»), ревизия «деньги» на неё опирается (CHECK (state <> 'FULFILLED' OR inv_id IS NOT NULL) и DigisellerOrder.quarantineCode).

**Выбор.** Колонки state на сделке НЕТ. Состояние процесса живёт только на claim. CHECK из ревизии «деньги» заменяется более сильным ограничением inv_id BIGINT NOT NULL, а quarantineCode со сделки удаляется — карантинные коды (block_code) живут на claim.

**Почему.** Расщепление на попытку и сделку — единственное, что закрывает Д9/Д4/Д8/Д29 одним ходом, и оно ломается, если сделка снова начинает нести состояние процесса. При этом CHECK ревизии «деньги» становится не отброшен, а поглощён: он требовал «FULFILLED ⇒ inv_id IS NOT NULL», а NOT NULL требует того же безусловно. Сделка создаётся только из проверенного ответа площадки (там уже есть inv и buyerEmail), поэтому спекулятивных строк без inv не бывает по построению.

#### 2. ШОВ 2. inv_id nullable (ревизия «деньги»: CHECK (inv_id IS NULL OR inv_id > 0)) или NOT NULL (ревизия «жизненный цикл»)?

**Выбор.** NOT NULL @unique + CHECK (inv_id > 0). Как следствие, ветка ревизии «деньги» «при выборе „возврат проведён на площадке“ и invId IS NULL операция ОТКАЗЫВАЕТСЯ» УДАЛЯЕТСЯ как недостижимая.

**Почему.** Д1 держался на том, что «UNIQUE(inv_id) в Postgres допускает сколько угодно NULL — слой выключен молча». NOT NULL закрывает это типом колонки, а не соглашением. Ключ возврата ревизии «деньги» — dgs:inv:{inv}:refund — сам ТРЕБУЕТ валидного inv; с NOT NULL он всегда вычислим, и защитный контур возвратов перестаёт зависеть от качества разбора. Возможность стала возможна ровно потому, что сделка больше не создаётся до сети.

#### 3. ШОВ 3. Регулярка CHECK на payments.external_id: '^[0-9]+$' (ревизия «жизненный цикл») или '^[1-9][0-9]{0,18}$' (ревизия «деньги»)?

**Выбор.** '^[1-9][0-9]{0,18}$'.

**Почему.** Без запрета ведущих нулей один счёт даёт два разных ключа ('42' и '042'), и уникальный индекс их не связывает — ключ обязан быть каноническим. Ограничение длины 19 цифр держит значение в диапазоне bigint. С invRef(inv: bigint) = inv.toString() ведущие нули невозможны по построению, поэтому CHECK работает как страховка от будущей правки, а не как рабочая ветка.

#### 4. ШОВ 4. Ключ отрицательного кеша: sha256(lower(code)) — как требует Д36 и повторяет ревизия «жизненный цикл», или sha256 точного нормализованного кода — как настаивает ревизия «защита»?

**Выбор.** Точный нормализованный код. Вторая половина Д36 признана ОШИБОЧНОЙ. К lower() приводятся только ключ claim и счётчики стоимости.

**Почему.** Регистрозависимость кодов площадки не подтверждена (признано в разделе «Факты»). Если коды регистрозависимы, кеш по lower() означает, что отказ по 'abc…' подавит проверку ДРУГОГО, законного 'ABC…', и заплативший покупатель получит CODE_INVALID из нашего кеша, ни разу не дойдя до площадки — это отказ в выдаче оплаченного товара. Цена альтернативы асимметрично мала: противник тратит по одной единице UC на регистровый вариант, а UC и так ограничен резервированием. Требование Д36 «быть совместимым с lower()-индексом» относится к дедупликации и учёту, где худший исход — лишняя единица стоимости противнику, а не отказ покупателю.

#### 5. ШОВ 5. Что отдаёт POST /redeem? Ревизия «жизненный цикл» даёт таблицу с 200/202/404/409 прямо на redeem; ревизия «защита» требует всегда 202 + непрозрачный claim_id.

**Выбор.** POST /redeem всегда 202 + claimId. Таблица ответов ревизии «жизненный цикл» переносится ЦЕЛИКОМ на GET /claims/:claimId. Отличающиеся коды на POST допустимы только там, где ответ не зависит от существования кода: 400 CODE_MALFORMED, 429, 503.

**Почему.** Требование Д16/Д28 не допускает промежуточного варианта, а Д19 требует, чтобы повтор формы никогда не давал 409 своему же покупателю — оба выполняются одновременно, если POST идемпотентен по (code_hash, user) и возвращает ТОТ ЖЕ claimId, а вердикт публикуется на статусе. Инвариант формулируется проверяемо: равенство статуса, code, message и отсутствия details — побайтовое равенство недостижимо, потому что ApiErrorBody по построению содержит requestId и timestamp (all-exceptions.filter.ts:19-29), и тест на него провалился бы всегда и был бы отключён.

#### 6. ШОВ 6 (арифметический, самый опасный). Ревизия «защита» резервирует uc_reserve_per_claim=6 обращений на claim; ревизия «жизненный цикл» рассчитывает, что мусорный код обходится примерно в 15 обращений за 72 часа. Числа не сходятся.

**Выбор.** Резерв финансирует ТОЛЬКО полосу FAST. Исчерпав резерв, claim не умирает и не встаёт — он переходит на медленную полосу, финансируемую бюджетом BACKGROUND, с календарным горизонтом. Оба числа верны и описывают разные бюджеты.

**Почему.** Если бы резерв ограничивал общее число обращений, claim заплатившего покупателя вставал бы на шестой попытке при суточной аварии площадки — то есть возвращался бы Д6 под другим именем. Если бы резерва не было вовсе, вернулся бы Д12 («10 предъявлений разрешают ~70 обращений»). Разделение бюджетов удовлетворяет обоим требованиям: покупатель платит своей квотой за интерактивную часть, а долгое ожидание аварии финансируется общим фоновым лимитом, который ограничен глобально и не может отказать живому покупателю, потому что фон физически не имеет доступа к FAST.

#### 7. ШОВ 6-бис. max_open_claims_per_user=3 бьёт по реселлеру, гасящему пачку кодов — это названо риском в самой ревизии «жизненный цикл».

**Выбор.** В потолок считаются ТОЛЬКО состояния, способные породить обращение наверх: PENDING_VERIFY и STALLED. PENDING_FULFILL, AWAITING_OWNER и оба BLOCKED_* не считаются.

**Почему.** Потолок существует ради ограничения стоимости у третьей стороны, а не ради ограничения покупок. Фаза C сети не имеет вообще (все данные площадки уже в digiseller_orders.raw_payload), переразрешение тарифа в BLOCKED_UNMAPPED локально, AWAITING_OWNER — таймер. Считать их значит наказывать за успешную проверку. Это ровно тот вариант, который автор ревизии назвал предпочтительным, и он выражается предикатом, а не замером.

#### 8. ШОВ 7 (Д25, не разрешён ни одной ревизией до конца). Payment.amount = сумма площадки означает, что 0.00042 BTC (WMX) записывается в Decimal(12,2) как 0.00, и CHECK (refunded_amount <= amount) отвергает любой возврат по крипто-сделке.

**Выбор.** Payment.amount/currency = НАШ прайс (совпадает с Order). Добавляются Payment.providerAmount Decimal(24,8) и Payment.providerCurrency VarChar(8) — сумма и валюта площадки в её собственной точности. Решение №3 черновика в части «Payment.amount = сумма площадки» отменяется.

**Почему.** Три требования выполняются одновременно только так: (1) сумма площадки не теряется — она в providerAmount с точностью, достаточной для BTC; (2) инвариант возвратов sum(refunds) <= payment.amount живёт в одной когерентной валюте, поэтому CHECK осмыслен и ASSUMED_FULL = payment.amount корректен по определению; (3) сверка с выпиской ведётся по providerAmount/providerCurrency + rawPayload. Прежний вариант делал запись, названную в схеме «единственным источником правды при разборе споров» (schema.prisma:1084-1085), нечем сверять, а ветку PARTIALLY_REFUNDED — неработающей для крипты в принципе. VarChar(8) вместо VarChar(3) снимает и вторую половину Д25: четырёхсимвольный код площадки больше не даёт ошибку 22001 внутри денежной транзакции.

#### 9. ШОВ 8. Deliver-процессор: ревизия «жизненный цикл» объявляет его соседним узлом, «деньги» его не касаются, «защита» только гасит его при DENIED. Д24 и Д32 остаются без проекта.

**Выбор.** Deliver спроектирован здесь: deliver_state + deliver_attempts + next_deliver_at, тот же лизинг, тот же CHECK «терминал ⇔ next_deliver_at IS NULL», календарный горизонт и ЯВНЫЙ разбор документированных retval с настоящими терминалами (-5 → DENIED, -2/1/2 → CODE_REJECTED). Полоса BACKGROUND, вес 30.

**Почему.** Правило «неизвестный retval → RETRYABLE, никогда REJECT» обосновано неполнотой таблицы у searchuniquecode, где документирован единственный retval=0. У deliver таблица документирована ПОЛНОСТЬЮ (0, -5, -4, -3, -2, 1, 2, 3, 4), поэтому распространять на него правило значит превращать «доступ запрещён» в вечный цикл: 50 строк × 60 запросов в час = 72 000 бесполезных обращений в сутки за DDoS-Guard. Без этого проекта горячий цикл, изгнанный из verify лизингом, просто переезжает в deliver, и Д24/Д32 остаются открытыми при формально сведённом проекте.

#### 10. ШОВ 9. Курсор поллинга и его бюджет (Д22, Д34, Д35) — ни одна ревизия не спроектировала.

**Выбор.** next_poll_at продвигается БЕЗУСЛОВНО, включая неуспех; заводится poll_failures с потолком и переводом в админскую очередь; профиль затухающий (сутки — 15 мин, 7 суток — час, дальше — сутки); горизонт наблюдения выводится из content.day_lock по конкретной сделке + запас, а не из константы 90 дней; seller-sells/v2 честно назван детектором СВЕЖИХ возвратов; health отдаёт МАКСИМАЛЬНЫЙ возраст next_poll_at и число строк с poll_failures>0.

**Почему.** Обе ветки Д22 плохи именно потому, что поведение last_polled_at при неуспехе не задано: продвигать только на успехе — одна мёртвая сделка съедает курсор и возвраты по всей базе перестают обнаруживаться; продвигать всегда без счётчика — строка тихо крутится до конца горизонта. Безусловное продвижение ПЛЮС счётчик снимают оба исхода. Затухающий профиль даёт ~200 обращений в час на 1350 сделках против 5400 при равномерном опросе (Д35). Горизонт из day_lock — единственное число в этом узле, которое не взято с потолка: площадка сама сообщает срок холдирования.

#### 11. ШОВ 10. Снятие Redis-лока процессоров: черновик требует Lua compare-and-delete, ревизия «защита» отказывается вводить Lua (в проекте нет ни одного скрипта).

**Выбор.** Lua не вводится. Захват лока переносится ВНУТРЬ try, снятие — обычный DEL. Корректность обеспечивается построчным лизингом, а не локом.

**Почему.** После введения лизинга (UPDATE … WHERE next_attempt_at <= now() с проверкой count=1) двойной исполнитель безвреден по построению: вторая реплика просто не получит ни одной строки. Значит лок деградирует из механизма корректности в механизм экономии, и «снял чужой лок» перестаёт быть дефектом. Это устраняет и претензию черновика (безусловный del снимает чужой лок), и претензию ревизии (новый механизм ради одного места). Захват внутри try остаётся обязательным: ioredis отклоняет промис после maxRetriesPerRequest:3 (redis.service.ts:30), а обработчиков process-уровня в проекте нет ни одного.

#### 12. ШОВ 11 (поправка к источнику истины). Черновик и ревизия «защита» опираются на факт «сид создаёт digiseller.* со значением '' → ветка process.env недостижима → env-переменные мертвы» и требуют удалить DIGISELLER_SELLER_ID/API_KEY из env.schema.ts.

**Выбор.** Утверждение УСТАРЕЛО и переигрывается. settings.service.ts:100 читает `if (row && !this.isPlaceholder(row.value))`, а isPlaceholder (212-214) считает пустую строку отсутствием значения. Env живой. Переменные ОСТАЮТСЯ. Решение №13 черновика отменяется, тест «фиксирует, что env мёртв» переписывается в зеркальный.

**Почему.** Правило задания требует проверять утверждения чтением кода, и этот код изменился после написания документа — комментарий в самом файле (строки 84-98) прямо описывает прежнее поведение как дефект и объясняет исправление. Реализация по документу удалила бы рабочие переменные и вернула ровно ту проблему, которую проект уже вылечил: «человек вписывал ключ в .env, сервис молча продолжал видеть пустоту, и выяснялось это на первой реальной покупке». Различение DECRYPT_FAILED при этом сохраняется: safeDecryptSecret возвращает null, а null не является плейсхолдером и в env не проваливается.

#### 13. ШОВ 12. Где живёт литерал 16-значного кода? Ревизия «жизненный цикл» кладёт его в ДВЕ таблицы (claim — чтобы спросить площадку, сделка — для поддержки) и сама называет это риском.

**Выбор.** Литерал живёт ТОЛЬКО в digiseller_claims.unique_code и обнуляется при переходе в терминал (в той же транзакции фазы C, шаг 7). Со сделки колонка unique_code удаляется целиком, её место занимает code_hash char(64) NOT NULL UNIQUE.

**Почему.** Ключ поддержки на сделке — это inv, а не код: по нему сделка находится и у нас, и в кабинете продавца. Хранить сверх этого предъявительский документ означает расширять поверхность экспозиции без функции. Обнуление в терминале убирает код из БД в тот момент, когда он перестаёт быть нужен для вопроса площадке, и делает риск, названный самой ревизией, меньше исходного черновика, а не больше.

#### 14. ШОВ 13. Терминальный REJECT недостижим, пока digiseller.reject_retvals пуст, а заполнить его можно только реальной тестовой покупкой. Отрицательный кеш при этом пуст по построению, и КАЖДЫЙ неверный код живёт 72 часа.

**Выбор.** Принято как есть (ложный REJECT дороже ложного ожидания), но добавлен операционный рычаг, которого не было ни в одной ревизии: очередь STALLED группируется по response_fingerprint, и POST /queue/fingerprints/:fp/terminal одним действием добавляет наблюдённый retval в digiseller.reject_retvals через SettingsService.set.

**Почему.** Иначе неопределённость контракта превращается в постоянный поток мусора в админской очереди, а единственный способ её снять — «сделать тестовую покупку», то есть внешнее событие, которого может не быть месяцами. Группировка по отпечатку ответа сводит тысячи одинаковых мусорных ответов к одному элементу со счётчиком, а рычаг переводит вопрос из режима «ждём владельца» в режим «админ увидел один и тот же ответ сто раз и объявил его терминальным». Ложный REJECT при этом остаётся невозможен автоматически — решение принимает человек.

#### 15. ШОВ 14. Д30 (нет гейта по сумме, аудит-событие без читателя, отчёт по Order.amount маскирует недоплату) не закрыт ни одной из трёх ревизий.

**Выбор.** Закрывается двумя дешёвыми контролями вместо порога: суточный reconciliation.processor сверяет sum(payments.provider_amount) с выпиской и sum(refunds.amount) с payments.refunded_amount, расхождение — строкой в ту же админскую очередь; плюс счётчик «покупок с расхождением > X% на пользователя/почту за сутки» с аномалией. Колонка providerAmount делает оба отчёта возможными.

**Почему.** Возражение против жёсткого порога 0.5 верное: площадка штатно поддерживает promo_code и bonus_code, и порог отправлял бы в карантин честные акционные покупки. Но из «порог неверен» не следует «контроля нет вовсе». Суточная сверка не трогает горячий путь и ловит систематику (утёкший промокод, сломанный маппинг cnt_goods), а счётчик на пользователя отличает массовое злоупотребление от единичной акционной покупки. Отсутствие внешнего мониторинга остаётся вопросом владельца, но данные для него теперь существуют, а не только аудит-событие, у которого читателя заведомо нет.

#### 16. ШОВ 15. Запись digiseller_events через create+catch(P2002) или createMany(skipDuplicates)?

**Выбор.** createMany({skipDuplicates:true}) с проверкой count. Управление потоком через исключения на денежном пути запрещено правилом модуля.

**Почему.** P2002 внутри интерактивной транзакции Prisma переводит транзакцию Postgres в состояние aborted, и все последующие запросы падают с 25P02 — то есть ловля исключения даёт не ветвление, а отказ через несколько шагов с диагнозом, не указывающим на причину. Prisma 6.3 + Postgres поддерживают skipDuplicates (package.json:52,75). Тот же приём применяется к вставке сделки и к вставке refunds, поэтому правило единообразно и проверяемо грепом.

#### 17. ШОВ 16. Три ревизии по-разному называют одни и те же колонки claim (code_hash / codeHashLower; verdictCode против reject_reason+block_code+stall_reason; attempts против четырёх счётчиков).

**Выбор.** Единая схема: code_hash; три раздельные колонки причин (stall_reason, block_code, reject_reason) под три разных класса; четыре раздельных счётчика (verify_attempts, upstream_refusals, fulfill_attempts, undecidable_streak); из ревизии «защита» берутся uc_reserved/uc_spent, not_before и ip.

**Почему.** Единый счётчик attempts запрещён требованием Д3/Д12: отказ НАШЕЙ стороны (бакет, breaker, NOT_CONFIGURED) не имеет права списывать попытку заплатившего, иначе локальная перегрузка доводит законную покупку до эскалации при живой площадке. Единый verdictCode запрещён тем, что три класса причин ведут к трём разным очередям и трём разным реакциям админа. uc_reserved/uc_spent обязаны жить на строке, потому что возврат неизрасходованного резерва при терминальном исходе иначе не вычислим; not_before — единственное место, где реализуется таймер выдержки анти-оракула.

### Что автор считает закрытым

- Д1 [КРИТ, однократность] inv не валидируется, String(inv) даёт 'undefined' — ЗАКРЫТ. Тотальная функция parseInv с явной веткой отказа; VerifiedPurchase.inv объявлен bigint, поэтому String(undefined) не проходит компиляцию; единственный способ получить строку — invRef(inv: bigint). Непарсящийся inv → BLOCKED_INPUT/INV_UNPARSEABLE, 202, redeemedAt остаётся NULL, выход через resolve с ручным вводом inv (не REJECT и не RETRYABLE: покупатель заплатил, а площадка ОТВЕТИЛА). В БД: digiseller_orders.inv_id BIGINT NOT NULL @unique + CHECK (inv_id > 0) — возможно потому, что сделка больше не создаётся спекулятивно; на payments CHECK (provider <> 'DIGISELLER' OR external_id ~ '^[1-9][0-9]{0,18}$') вместо бесполезного IS NOT NULL. Запрет ведущих нулей добавлен сверх правки дефекта.
- Д2 [КРИТ, однократность] VERIFIED — тупик — ЗАКРЫТ удалением состояния. Проверенные данные durable в digiseller_orders.raw_payload, поэтому «проверено, но делать нечего» не существует: успешная проверка сразу ведёт в PENDING_FULFILL / AWAITING_OWNER / BLOCKED_UNMAPPED / BLOCKED_INPUT. Тупики исключены КОНСТРЕЙНТОМ CHECK ((state IN ('FULFILLED','REJECTED')) = (next_attempt_at IS NULL)) плюс единственный частичный индекс (next_attempt_at) WHERE NOT NULL и единственный воркер по нему — состояние без забирающего не проходит INSERT. Ветка повторного предъявления определена для КАЖДОГО состояния таблицей §5.
- Д3 [КРИТ, однократность] FAILED_PERMANENT за 6,5 минуты, горизонт по числу попыток — ЗАКРЫТ. FAILED_PERMANENT удалён. Горизонт календарный: escalate_at = created_at + retry_horizon_hours (72), числа попыток нет ни в одном условии перехода, escalate_at меняет наблюдателя (→STALLED), а не исход. verify_attempts инкрементится ТОЛЬКО когда площадка реально ответила; отказ бакета, breaker'а, NOT_CONFIGURED, DECRYPT_FAILED и DENIED идут в отдельный upstream_refusals и в stall_reason=LOCAL_DEGRADED, не стоят ни UC, ни попытки.
- Д4 [КРИТ, однократность] Рецепт восстановления фазы A не работает для lower()-индекса — ЗАКРЫТ РАСТВОРЕНИЕМ ПРИЧИНЫ. UNIQUE(lower(unique_code)) отменён целиком (пункт 5 «Правок схемы» черновика снят), его роль исполняет code_hash. Перечитывание идёт по code_hash, а не по литералу, поэтому разыменования null нет. Остаточный случай «два РАЗНЫХ кода с одинаковым lower» детектируется сравнением inv в preflight и записывается как BLOCKED_INPUT/CODE_HASH_COLLISION с обоими payload. Тест schema-invariants утверждает, что индекса lower() НЕ существует.
- Д5 [КРИТ, однократность] Нет карантина и предпроверки для «товар не сопоставлен с тарифом» — ЗАКРЫТ. Тариф резолвится в preflight ДО открытия транзакции; отсутствие → BLOCKED_UNMAPPED/PRODUCT_UNMAPPED, неактивность → PLAN_INACTIVE (активность проверяем сами: licenses.service.ts:71-73 тянет isActive в select и не использует его, единственная проверка — plan.productId !== params.productId, строки 76-81). productId берётся из найденного плана, поэтому PLAN_MISMATCH внутри денежной транзакции невозможен физически. Покупателю 202 ACCEPTED_DELAYED + письмо order.delayed, redeemedAt НЕ ставится никогда. Главное сверх правки дефекта: заведение тарифа админом лечит ВСЕ ждущие claim автоматически (переразрешение раз в 600 с), resolve остаётся как «проверить сейчас», очередь группируется по digisellerProductId, эскалация через 2 часа, выход через REJECTED(PRODUCT_WITHDRAWN).
- Д6 [КРИТ, внешний-отказ] FAILED_PERMANENT терминален и без выхода — ЗАКРЫТ. Его роль занял STALLED: в админской очереди, с автоповтором на медленной полосе 6 ч, с самообслуживанием покупателя (кнопка «повторить», отдельный рейт-лимит self_retry_per_claim_per_hour=2), с админским resolve. Ни сетевой сбой, ни 5xx, ни HTML от DDoS-Guard, ни открытый breaker, ни исчерпанный бакет, ни NOT_CONFIGURED, ни DECRYPT_FAILED не ведут в терминал НИКОГДА. Терминалов ровно два, и REJECT достижим только из документированного вердикта площадки (digiseller.reject_retvals), решения админа или факта «сделку погасил другой».
- Д7 [КРИТ, внешний-отказ] Горячий цикл 240 запросов/час у фазы C — ЗАКРЫТ тремя независимыми мерами. (1) ЛИЗИНГ: процессор сдвигает next_attempt_at условным UPDATE ДО начала работы и работает при count=1, поэтому падение процесса, исключение до try или откат транзакции стоят максимум одного лизинга. (2) Фаза C не ходит в сеть ВООБЩЕ — все данные площадки уже в digiseller_orders.raw_payload, значит ретрай исполнения стоит НОЛЬ обращений наверх. (3) Заведены fulfill_attempts и next_attempt_at, продвигаемые компенсирующим UPDATE в ОТДЕЛЬНОЙ транзакции после отката, а не внутри аборченной. Детерминированные ошибки (тариф, quantity, inv, currency, длина валюты) выясняются в preflight ДО транзакции. Тест утверждает потолок обращений на детерминированно падающей строке.
- Д8 [КРИТ, внешний-отказ] Карантин CODE_CASE_COLLISION невозможно записать — ЗАКРЫТ РАСТВОРЕНИЕМ ПРИЧИНЫ вместе с Д4: индекса, который блокировал запись, больше нет. Любая карантинная запись живёт в claim-таблице, которую никакой индекс кода не блокирует, и claim создаётся ДО сети, поэтому факт предъявления не теряется ни в одном сценарии.
- Д9 [КРИТ, внешний-отказ] Первое предъявление = вечный эксклюзивный захват — ЗАКРЫТ. Claim уникален по (code_hash, claimed_by_user_id): у каждого пользователя своя строка, предъявление неисключительно, посторонний никому не мешает. Уникальность кода перенесена на сделку, которая создаётся ТОЛЬКО из проверенного ответа площадки, где уже известны inv и buyerEmail. Эксклюзивность привязана к ПОГАШЕНИЮ через redeemedAt IS NULL в WHERE условного UPDATE (эталон registration-key.service.ts:255-265, 302-312). Приоритет владельца выражен подтверждённым email и грейсом при оспаривании, а не порядком прихода.
- Д10 [КРИТ, внешний-отказ] Реакция на возврат непереигрываема — ЗАКРЫТ КОНСТРУКТИВНО. Сравнение «сменилось ли состояние» убрано вовсе: ключ события выводится из САМОГО ФАКТА ('dgs:inv:{inv}:invoice_state:{n}'), поэтому детектор изменения и ключ дедупликации — один и тот же уникальный индекс, и щели между ними не существует. DigisellerOrder.providerInvoiceState понижен до проекции, обновляемой той же транзакцией, что и реакция. Единственный маркер прогресса — processed_at, выставляемый ТОЙ ЖЕ транзакцией; дренаж WHERE processed_at IS NULL с attempts/next_attempt_at/lastError. Правило модуля: никакой дедуп-маркер не продвигается раньше коммита реакции.
- Д11 [КРИТ, злоупотребление] Device.isBlocked не удорожает повтор — ЗАКРЫТ. Диагноз подтверждён чтением: @@unique([licenseId, hwidHash]) (schema.prisma:927) делает устройство сущностью в разрезе лицензии; ветка первой привязки (hwid.service.ts:129-135) ищет строку по паре licenseId_hwidHash и не смотрит на isBlocked ни разу; единственная проверка стоит на сверке текущего устройства (hwid.service.ts:187); setManually при upsert ЯВНО сбрасывает isBlocked в false (hwid.service.ts:340). Правка: новая таблица blocked_hwids по hwid_hash и проверка в ОБЕИХ ветках bindOrVerify, обязательно ДО создания строки devices (индекс @@index([hwidHash]) уже есть, стоит один индексный поиск). setManually отказывает при заблокированном железе, кроме отдельного права.
- Д12 [КРИТ, злоупотребление] Лимиты считают предъявления, а стоимость измеряется обращениями — ЗАКРЫТ. Введена единица UC = одно обращение к площадке; пороги заданы прямо в UC (60/пользователь/час, 120/IP, 240//24). На интейке резервируется uc_reserve_per_claim=6, остаток возвращается при терминальном исходе — «10 предъявлений = до 70 обращений» становится невозможным арифметически. Потолок открытых claim (3) считает только состояния, способные породить обращение наверх. Полоса BACKGROUND отделена от FAST, поэтому очередь ретраев не может вынести бюджет живых покупателей. Отказ НАШЕЙ стороны не тратит ни UC, ни попытку.
- Д13 [КРИТ, злоупотребление] Один возврат даёт две строки refunds; рецидив без базы и окна — ЗАКРЫТ. Дедупликация по ДЕНЬГАМ: (payment_id, external_ref), где external_ref детерминирован от факта площадки 'dgs:inv:{inv}:refund' и ручной путь обязан вычислять ТУ ЖЕ строку; 'manual:{paymentId}:{clientRef}' остаётся только для возвратов вне площадки. Проигравший гонку (count=0) не создаёт вторую строку и не выполняет реакцию вовсе; если проигравший админ, а выигравшая строка ASSUMED_FULL — корректировка суммы той же строки под тем же CHECK. Рецидив переопределён: count(distinct payment_id) по ПОЛНЫМ возвратам kind='PROVIDER' в скользящем окне 180 дней, субъект — user_id (buyerEmail только MEDIUM-сигнал: почта нами намеренно не сверяется по решению №20), споры о доставке и возвраты вне площадки не считаются, снятие — резолв анти-фрод события (AntiFraudEvent.resolvedAt/resolvedById/resolution, schema.prisma:1385-1387).
- Д14 [КРИТ, контракт] timestamp монотонным счётчиком вместо текущего времени — ЗАКРЫТ. Счётчик убран как ИСТОЧНИК значения: ts = max(floor(Date.now()/1000), lastTs+1), настоящее время всегда база, монотонность только страховка внутри секунды. lastTs в Redis — нижняя граница, не значение, поэтому при allkeys-lru (docker-compose.yml:69-73) вытеснение ключа даёт «взять now», а не «начать с 1» (второй сценарий дефекта закрыт по построению). Маркер SET digiseller:apilogin:ts:{ts} NX EX 300 — приём уже дважды в проекте (signature.service.ts:124, launcher.service.ts:521). retval -4 → ts+1 и повтор, до 3 раз. Сверх дефекта: дрейф измеряется как (valid_thru − 120 мин) − наш now и уходит в health; ts_forward_cap=60 с, при превышении логины останавливаются с CLOCK_SUSPECT.
- Д15 [КРИТ, контракт] unique_code_state=4 трактуется как возврат денег — ЗАКРЫТ. Разобраны два независимых автомата. unique_code_state 1..5 — жизненный цикл ДОСТАВКИ и денег не содержит вообще; критично, что в состояние 2 сделку переводит НАШ собственный PUT deliver, и именно из него покупателю доступна кнопка «не получил» — то есть черновик построил автоотзыв на кнопке, которую сам же и открыл заплатившему. 4 → DISPUTED: уведомление, аудит digiseller.delivery_refuted, горячий тир поллинга, ЛИЦЕНЗИЯ РАБОТАЕТ. 5 → наш дефект недозвона deliver. Деньги выражает только content.invoice_state: 5 — единственный триггер отзыва, 35 — REFUND_PENDING без отзыва (решение №10 сохранено), 1/2/4 по исполненной сделке — ACCOUNTING_ANOMALY без автоотзыва. Правка самого Д15 в части «state=3 снимать с наблюдения раньше» ОТКЛОНЕНА: подтверждение доставки о деньгах не говорит ничего, возврат и чарджбек после него возможны; снимается только наблюдение за спором.
- Д16 [КРИТ, контракт] Анти-оракул не выполняется (разные ответы на несуществующий и чужой погашенный код) — ЗАКРЫТ по-настоящему, без промежуточного варианта. POST /redeem не отдаёт вердикт ни при каком исходе: всегда 202 + непрозрачный claimId + одинаковое тело. Быстрого 404 из БД не остаётся ни на одном пути: «кода нет» и «погашен другим» идут по ОДНОМУ пути (оба создают claim, оба приходят к терминалу через тот же автомат) и публикуются одним кодом CODE_INVALID не раньше not_before = created_at + verdict_dwell_sec (15). Стоимостной канал утечки закрыт: дорогой бюджет списывается на интейке, ДО того как выяснится, какой это случай. Инвариант переформулирован проверяемо (равенство статуса, code, message и отсутствия details), потому что побайтовое равенство недостижимо: ApiErrorBody содержит requestId и timestamp (all-exceptions.filter.ts:19-29).
- Д17 [ВАЖНО, однократность] Ручной возврат не гасит поллер — ЗАКРЫТ. Возврат переведён в операцию над ПЛАТЕЖОМ (POST /payments/:paymentId/refund): Order.payments — список (schema.prisma:1063), поэтому manualRefund(orderId) в принципе не адресует деньги. Ручной путь в ТОЙ ЖЕ транзакции ставит digiseller_orders.refunded_at, поэтому курсор поллера строку снимает. revoke получает guard по статусу (updateMany WHERE status <> REVOKED, count=0 → тихий no-op без письма, аудита и анти-фрод события) по эталону registration-key.service.ts:255-265 — сейчас revoke делает безусловный license.update (licenses.service.ts:288-297).
- Д18 [ВАЖНО, однократность] revoke(...,tx) и enqueue пишут мимо транзакции — ЗАКРЫТ. enqueue(params, tx?) и record(entry, tx?) расширяются симметрично issue(params, tx?); очередь-таблица (notification.service.ts:8-19) работает как готовый outbox без новой машинерии. Добавлено требование, которого нет ни в одном дефекте: при переданном tx обе функции обязаны ПРОБРАСЫВАТЬ ошибку, а не глотать (notification.service.ts:74-81, audit.service.ts:151-157) — проглоченный сбой INSERT переводит транзакцию Postgres в aborted, и отказ проявится через несколько шагов с кодом 25P02, то есть глотание внутри транзакции опаснее проброса.
- Д19 [ВАЖНО, однократность] Два взаимоисключающих ответа на свой погашенный код, утечка 409 — ЗАКРЫТ. Одно правило: POST всегда 202 с ТЕМ ЖЕ claimId (идемпотентность по (code_hash, user)), статус при FULFILLED всегда 200 с ключами, перечитанными по orderId. ConflictException и P2002 из внутренностей фазы C наружу не выходят ни в одной ветке: count=0 на шаге 1 даёт внутренний маркер DEAL_TAKEN, разбираемый СНАРУЖИ перечитыванием сделки. Гонка HTTP-пути с воркером исключена ЛИЗИНГОМ (мьютекс), фора next_attempt_at = now()+30 с оставлена как вежливость к латентности, а не как механизм корректности.
- Д20 [ВАЖНО, однократность] Настоящий покупатель получает неотличимую 404, хотя buyerEmail у нас есть — ЗАКРЫТ. На ветке «погашен другим» сравнивается ПОДТВЕРЖДЁННАЯ почта заявителя (emailVerifiedAt IS NOT NULL) с deal.buyerEmail. Совпало → 409 CODE_TAKEN_BY_OTHER с тикетом; не совпало → 404 в том же конверте, но аудит-запись с sha256 кода и обоими user id пишется ВСЕГДА. Оракула не создаёт: чтобы получить 409, надо уже владеть почтой реальной сделки, что перебирающему недоступно по определению. Условие на emailVerifiedAt обязательно, иначе владение крадётся сменой email в профиле.
- Д21 [ВАЖНО, внешний-отказ] Device.isBlocked не блокирует, и порядок шагов гарантирует, что блокировать нечего — ЗАКРЫТ вместе с Д11. Дополнительно: hwidHash и currentDeviceId захватываются SELECT'ом ДО вызова revoke, который их обнуляет (licenses.service.ts:294) — тест утверждает, что deviceId в анти-фрод событии не NULL. Заведены эндпоинты снятия блокировки железа и запрета по почте под правом администратора: любой ложный рецидив без них — терминальный экран, из которого выходят только SQL'ем в проде.
- Д22 [ВАЖНО, внешний-отказ] Курсор поллинга не защищён от вечно падающей сделки — ЗАКРЫТ (спроектирован здесь, ни одна ревизия его не брала). next_poll_at продвигается БЕЗУСЛОВНО, включая неуспех; заведён poll_failures на строку с потолком и переводом в админскую очередь после N подряд; health отдаёт не время последнего тика, а МАКСИМАЛЬНЫЙ возраст next_poll_at среди наблюдаемых строк и число строк с poll_failures>0 — только такой показатель отличает «поллинг идёт» от «поллинг крутится на одной строке». Обе ветки дефекта (ставить last_polled_at только на успехе / всегда) сняты одновременно.
- Д23 [ВАЖНО, внешний-отказ] enqueue и audit.record не принимают транзакцию — ЗАКРЫТ тем же изменением, что и Д18; побочные эффекты (письмо, аудит, анти-фрод событие) живут ВНУТРИ транзакции реакции, поэтому откат не оставляет письма об отзыве работающей лицензии и аудит не врёт в сторону «мы отозвали». Тест: заставить падать последний шаг → ноль строк license.revoked в notifications и ноль license.revoke в audit_logs.
- Д24 [ВАЖНО, внешний-отказ] deliver-процессор — цикл без счётчика, без бэкоффа и без терминала — ЗАКРЫТ (спроектирован здесь). Заведены deliver_state, deliver_attempts, next_deliver_at с экспонентой и потолком, терминальные DELIVERED / DENIED / CODE_REJECTED / GIVEN_UP, CHECK «терминал ⇔ next_deliver_at IS NULL», тот же построчный лизинг, календарный горизонт. Бюджеты разведены: deliver ходит через полосу BACKGROUND с весом 30 и физически не имеет доступа к FAST, поэтому фон не может отказать живому покупателю. Тест прогоняет 100 тиков после терминала и утверждает ноль обращений.
- Д25 [ВАЖНО, внешний-отказ] Payment.amount Decimal(12,2) под сумму площадки, WMX→BTC пишется как 0.00 — ЗАКРЫТ решением, которого не было ни в одной ревизии: Payment.amount/currency = НАШ прайс, а сумма и валюта площадки переезжают в новые providerAmount Decimal(24,8) и providerCurrency VarChar(8). Тогда CHECK (refunded_amount >= 0 AND refunded_amount <= amount) осмыслен в одной когерентной валюте и ветка PARTIALLY_REFUNDED работает и для крипты, а сверка с выпиской идёт по providerAmount без потери величины. Вторая половина дефекта (currency VarChar(3) при «неизвестный код пишем как есть» даёт 22001 внутри транзакции) закрыта дважды: VarChar(8) на колонке и preflight-проверка ^[A-Z]{2,8}$ ДО открытия транзакции.
- Д26 [ВАЖНО, внешний-отказ] Breaker + fail-closed бакет = «продажи остановлены» без условия выхода — ЗАКРЫТ. Fail-closed ОТМЕНЁН целиком: все дорогие лимиты переходят в fail-DEGRADED (процессный токен-бакет на 0.25 общего бюджета, прецедент процессного состояния — settings.service.ts:25-31), поэтому лимит становится грубее, но никогда не исчезает и никогда не останавливает единственный платёжный канал. Half-open задан явно: одна проба раз в breaker_probe_sec, закрытие на первом успехе, проба идёт МИМО любого бакета (иначе брейкер не закроется при деградировавшем Redis). Breaker при потере состояния считается ЗАКРЫТЫМ. Заведён POST /billing/digiseller/health/reset под правом администратора. Поллер при NOT_CONFIGURED/DECRYPT_FAILED не встаёт молча: health КРАСНЫЙ, потому что невозможность обнаруживать возвраты — не то же самое, что невозможность продавать.
- Д27 [ВАЖНО, злоупотребление] Код покупки в URL утекает в два журнала — ЗАКРЫТ сменой транспорта, а не глушением логов. GET /redeem/:code/status УДАЛЁН; статус запрашивается по непрозрачному claimId; код едет только телом POST под именем uniqueCode, которое УЖЕ стоит в redact-списке проекта (logger.module.ts:73) — то есть тело как транспорт было предусмотрено заранее. Утечка подтверждена как двойная: '"uri":"$request_uri"' в nginx (default.conf.template:22-33, access_log на :163) и ${request.method} ${request.url} в обеих ветках фильтра (all-exceptions.filter.ts:46,50) при сериализаторе pino, отдающем url целиком (logger.module.ts:88-98). Сверх дефекта: наш исходящий URL к площадке содержит ?token= по требованию контракта, поэтому логирование исходящих запросов и тексты ошибок клиента обязаны маскировать token. Плюс литерал кода теперь хранится в ОДНОЙ таблице и обнуляется в терминале.
- Д28 [ВАЖНО, злоупотребление] Анти-оракул: различие и по коду ответа, и по задержке на два-три порядка — ЗАКРЫТ вместе с Д16. Различие по коду снято тем, что POST не отдаёт вердикт вовсе; различие по задержке — тем, что оба отрицательных исхода публикуются по ОДНОМУ таймеру выдержки (not_before), а не по времени вычисления; различие по стоимости — тем, что резерв UC списывается на интейке до выяснения случая. Тест сравнивает пару ответов по статусу/code/message/отсутствию details и по попаданию задержки в один диапазон.
- Д29 [ВАЖНО, злоупотребление] Case-варианты своего же кода дают тикет и заваливают очередь — ЗАКРЫТ РАСТВОРЕНИЕМ. Регистровые варианты одного кода у одного пользователя схлопываются в ОДНУ claim-строку (ключ по sha256(lower(normalizeCode(code)))), то есть повторная отправка формы безобидна ПО ПОСТРОЕНИЮ, а не по дополнительной проверке claimed_by_user_id. Массовая накачка очереди case-вариантами невозможна: карантинных записей от коллизий больше не существует как класса, а каждый вариант от разных пользователей — обычный claim, ограниченный резервом UC и потолком открытых claim.
- Д30 [ВАЖНО, злоупотребление] Гейт по сумме снят, у заменяющего аудит-события нет потребителя, Order.amount маскирует недоплату — ЗАКРЫТ (не брала ни одна ревизия). Порог на выдачу по-прежнему не ставится (возражение про promo_code/bonus_code верное), но вводятся два дешёвых контроля: (1) reconciliation.processor @Cron(EVERY_DAY_AT_3AM) сверяет sum(payments.provider_amount) с выпиской и sum(refunds.amount) с payments.refunded_amount, расхождение — строкой в админскую очередь; (2) счётчик «покупок с расхождением > X% на пользователя/почту за сутки» с аномалией, ловящий массовое использование утёкшего промокода и не трогающий единичную акционную покупку. Новая колонка providerAmount делает оба отчёта возможными: раньше суммы площадки в пригодном для сверки виде просто не существовало (Д25). Остаток — отсутствие внешнего мониторинга — вынесен владельцу.
- Д31 [ВАЖНО, контракт] purchase/info завёрнут в content и использует другие имена полей — ЗАКРЫТ. Три отдельных типа и три отдельных парсера: UniqueCodeResponse (плоский: inv/id_goods/type_curr/email), PurchaseInfoResponse (обёртка {retval, retdesc, errors, content}, внутри currency_type/item_id/buyer_info.email; invoice_id в ответе НЕТ — несётся из запроса), SellerSellsRow (invoice_id/product_id/amount_in/amount_out/amount_currency). mapCurrency принимает уже извлечённый код, а не «поле type_curr». Сверх правки дефекта заведён contract-fixtures: test/fixtures/digiseller/*.json — литеральные JSON из примеров документации по одной фикстуре на метод, и digiseller-contract.spec.ts утверждает, что FakeDigisellerApi отдаёт ровно эти формы. Без этого фейк, собранный по одной схеме, скрыл бы дефект от всех тестов — что дефект и предсказывает.
- Д32 [ВАЖНО, контракт] Правило «никогда REJECT» распространено на deliver/purchase-info/seller-sells, где коды документированы и терминальны — ЗАКРЫТ. Правило оставлено ТОЛЬКО для searchuniquecode, где таблица действительно содержит один retval=0. Для deliver документированные коды разобраны явно: 0/4 — успех; 3 — ERROR порядка вызовов с повтором; -3/-4 — инвалидация токена и один релогин; -5 — ТЕРМИНАЛЬНО DENIED + capability content_change=DENIED + алерт + строка выходит из выборки; -2/1/2 — ТЕРМИНАЛЬНО CODE_REJECTED в админскую очередь. Для purchase/info и seller-sells любой retval != 0 — ошибка ЗАПРОСА (детали из errors/retdesc), а не сетевой сбой, поэтому опечатка в формате date_start даёт retval 11 громко, а не молча на каждом тике.
- Д33 [ВАЖНО, контракт] Трёхзначное состояние конфигурации не выражает «настроено, но прав не хватает» — ЗАКРЫТ, но НЕ предложенным способом. Гейтинг строится на НАБЛЮДАЕМОМ поведении методов (capability UNKNOWN → OK/DENIED; в DENIED переводит только 403 от самого метода или документированный retval -5 у deliver), а GET /api/token/perms дёргается лишь как пояснение для человека. Рецепт самого дефекта содержит собственный отказ: token/perms требует права token_get_perms, и «пустой массив означает отсутствие доступа», поэтому ключ со всеми тремя рабочими правами, но без права читать список прав, был бы прочитан как «прав нет» — и мы выключили бы работающие каналы. Точечная деградация сохранена полностью: нет sales_statistics_view → поллер стоит и health КРАСНЫЙ; нет content_change → deliver выключен, health degraded; нет view_invoice → redeem 503.
- Д34 [ВАЖНО, контракт] Окно poll_window_hours фильтрует по дате ПРОДАЖИ — ЗАКРЫТ переименованием роли + переносом полноты. seller-sells/v2 честно назван детектором СВЕЖИХ возвратов и лишён статуса денежного вердикта вовсе: rows[].returned — только повод немедленно опросить purchase/info по этому invoice_id (денежный вердикт обязан иметь ровно один источник, иначе развёртка, поштучный опрос и ручной путь породят три несводимых факта об одном возврате). Полнота перенесена на поштучный purchase/info с пересчитанным бюджетом (см. Д35). Вариант «строить окно на весь горизонт с постраничным обходом» отвергнут: он стоит дороже поштучного опроса и всё равно не даёт даты возврата, которой в ответе нет.
- Д35 [ВАЖНО, контракт] Поштучный поллинг 90-дневного горизонта не помещается в бакет, приоритета нет — ЗАКРЫТ. Бюджеты разведены на три полосы с закреплёнными долями: FAST 40/мин (только свежие claim покупателей), BACKGROUND 20/мин (ретраи 50 / deliver 30 / поллинг 20), CONTROL 5/мин (apilogin и token/perms, не делится ни с кем). Фон физически не имеет доступа к FAST. Профиль наблюдения затухающий и посчитанный: сутки — раз в 15 мин, до 7 суток — раз в час, дальше — раз в сутки; на 1350 сделках это ~200 обращений в час против 1200, которые даёт BACKGROUND. Число строк за тик ограничено poll_batch_size. Сверх дефекта: горизонт наблюдения выводится из content.day_lock по конкретной сделке + запас, а не из константы 90 дней, взятой с потолка. Полоса CONTROL — добавление сверх дефекта: без неё исчерпание бакета фоном лишает нас возможности обновить токен, и канал умирает целиком с диагнозом, похожим на отказ авторизации.
- Д36 [МЕЛОЧЬ, злоупотребление] Отрицательный кеш — ЗАКРЫТ ЧАСТИЧНО; вторая половина ПРИЗНАНА ЛОЖНОЙ. Принято: попадание в кеш обязано быть наблюдаемым — оно инкрементит дешёвый счётчик и учитывается порогом CODE_BRUTEFORCE, иначе повторное предъявление отвергнутых кодов невидимо для антифрода; резерв дорогого бюджета переносится ПЕРЕД кешем (иначе стоимость запроса зависит от того, известен ли код, и противник читает существование кода по остатку своей квоты). ОТВЕРГНУТО как ошибочное и опасное: требование ключевать кеш по sha256(lower(code)). Регистрозависимость кодов не подтверждена, и при регистрозависимых кодах отказ по 'abc…' подавил бы проверку законного 'ABC…' — заплативший покупатель получил бы CODE_INVALID из НАШЕГО кеша, ни разу не дойдя до площадки. Кеш вердиктов ключуется по точному нормализованному коду; к lower() приводятся только ключ claim и счётчики стоимости, где худший исход — лишняя единица стоимости противнику. Отдельно зафиксировано: кеш ПУСТ по построению, пока digiseller.reject_retvals пуст, потому что кешируются только терминальные вердикты.
- Д37 [МЕЛОЧЬ, контракт] cnt_goods объявлен как double, ветки для дробного нет — ЗАКРЫТ. resolveQuantity получает явную ветку Number.isInteger(cnt) === false → BLOCKED_INPUT/QUANTITY_FRACTIONAL с приложенным сырым значением; решение принимает админ через resolve с override. Проверка стоит в preflight ДО открытия денежной транзакции, поэтому дробное значение не может ни привести к тихой недовыдаче, ни упасть на Order.quantity Int уже после успешной проверки кода. Табличный тест фиксирует {undefined, null, 0, 1, 1.0, 2.5, 20, 21, '3', NaN, Infinity}.
- Д38 [МЕЛОЧЬ, контракт] Словари валют не совпадают, WMT документирован и mapCurrency его не знает — ЗАКРЫТ. Таблица достроена до полного объединения документированных значений всех трёх методов: WMZ→USD, WMR→RUB, WME→EUR, WMU→UAH, WMX→BTC, WMT→WMT, покрыта табличным тестом; событие currency_unmapped остаётся только для кодов ВНЕ этого объединения, поэтому сигнал, заведённый под аномалию, перестаёт срабатывать на норме. Валюта возврата не принимается от вызывающего, а копируется из Payment (refunds.currency = payment.currency), поэтому платёж и возврат по одному счёту всегда сводятся между собой.
- Д39 [МЕЛОЧЬ, контракт] Ветка INV_CONFLICT построена на неверном допущении о корзине — ДЕФЕКТ ПРИЗНАН ВЕРНЫМ и использован как основание. Swagger подтверждает: CartItemModel = {invoice_id, item_id, amount, currency}, то есть у КАЖДОЙ позиции корзины свой invoice_id, а cart_uid лишь группирует. Следствия: UNIQUE(inv_id) корректен как глобальный денежный ключ; расширение ключа до (inv, id_goods) НЕ делается; пункт «требует реальной корзинной покупки» снимается с плана проверок; ветка INV_CONFLICT остаётся чистым ассерт-инвариантом в preflight (BLOCKED_INPUT + ERROR в лог, без сценария восстановления). cart_uid сохраняется на сделке по назначению — как признак соседних позиций при разборе спора и частичного возврата.

### Риски, названные автором

- ПОПРАВКА §0 — самый важный риск сведения. Утверждение источника истины «env-переменные Digiseller мертвы» опровергнуто чтением settings.service.ts:100 и 212-214: код изменился после написания документа. Если документ содержит и другие утверждения о коде, устаревшие таким же образом, они не обнаружены здесь и обнаружатся при реализации. Перед началом работ реализатору следует перепроверить чтением все ссылки вида файл:строка из раздела «Факты», а не только те, что перечислены в этом проекте.
- Автоматический REJECT недостижим, пока digiseller.reject_retvals пуст, а заполнить его можно только реальной тестовой покупкой (п.5 владельца). До этого КАЖДЫЙ неверно введённый код, прошедший формат-гейт, живёт 72 часа и уходит в STALLED. Смягчения: формат-гейт снимает большинство опечаток без строки, группировка очереди по response_fingerprint сводит тысячи одинаковых ответов к одному элементу, max_open_claims_per_user=3 ограничивает поток на аккаунт, а рычаг «объявить отпечаток терминальным» позволяет закрыть вопрос без тестовой покупки. Но очередь всё равно будет содержать мусор — это осознанный размен на запрет ложного REJECT.
- Все параметры бэкоффа, полос и горизонтов (FAST 40, BACKGROUND 20, CONTROL 5, потолки 15 мин / 1 ч / 6 ч, пороги undecidable_streak 5 и 12, горизонт 72 ч, грейс 900 с, uc_reserve 6, verdict_dwell 15 с) — НАШИ оценки, а не измеренные значения. Лимиты частоты у площадки не документированы ни на одной странице и не отдаются заголовками (ни X-RateLimit-*, ни Retry-After), а API стоит за DDoS-Guard. Реальный порог, за которым начнётся challenge, мы узнаем по HTML вместо JSON в проде. Все значения вынесены в settings и обязаны быть пересмотрены после первого месяца по фактическому распределению uc_spent.
- Fail-degraded через процессный бакет даёт потолок, завышенный ровно во столько раз, сколько реплик API работает: при четырёх репликах и доле 0.25 суммарный поток равен номинальному, при восьми — вдвое выше. Сознательный размен (перерасход в разы лучше и остановки продаж, и неограниченного потока), но при росте числа реплик долю надо пересчитывать, а автоматического механизма для этого нет.
- Решение №20 (require_email_match=false) сохранено, поэтому НЕоспоренный посторонний, предъявивший чужой код первым, всё ещё получает лицензию. Грейс-окно owner_grace_sec помогает только если настоящий покупатель придёт в течение 900 с. Полное закрытие требует коммерческого решения владельца (жёсткая сверка почты либо переход на supplier-callback).
- Глобальная блокировка HWID поднимает стоимость повтора схемы «купил → скачал → вернул» с НУЛЯ до стоимости смены накопителя или подделки Disk ID — и только. Источник HWID — серийный номер накопителя через DeviceIoControl (комментарий к Device.hwidHash), он подделываем в пользовательском режиме, а виртуальная машина обходит его без всякой подделки. Санкции по платёжному инструменту невозможны в принципе (площадка не отдаёт ни отпечатка карты, ни идентификатора плательщика). Бан по почте обходится за один запрос, а аккаунт через Discord OAuth создаётся сразу ACTIVE (oauth.service.ts:251). Скорость отзыва защитой не является — payload уже скачан. Единственная структурная защита — не выдавать ценный артефакт до закрытия окна возвратов — решение владельца, не инженера.
- Ложная блокировка железа — новый класс инцидента: заблокированный hwid_hash перекрывает ПЕРВУЮ привязку любой будущей лицензии на этой машине, включая честно купленную. Эндпоинты снятия обязательны и заведены, но риск ложного бана добросовестного покупателя остаётся ненулевым, и его цена выше, чем у прежней неработающей санкции.
- Ключ денежного факта 'dgs:inv:{inv}:refund' исходит из того, что площадка способна сообщить не более одного возврата на счёт (invoice_state — один бит). Если у Digiseller окажутся последовательные частичные возвраты по одному счёту, второй не будет записан вовсе: createMany(skipDuplicates) вернёт count=0 и реакции не будет. Диагностируется расхождением суточной сверки; лечится расширением ключа значением суммы, но только после подтверждения, что такое поведение существует.
- Сумма возврата площадкой не сообщается ни одним из трёх методов, поэтому поллер пишет refunds.amount = payment.amount с amountConfidence='ASSUMED_FULL'. Если частичные возвраты реальны и часты, автоматика будет отзывать лицензии по частично возвращённым деньгам до корректировки админом. Обратного «разотзыва» в LicensesService нет и он здесь не изобретается (licenses.service.ts:281-318; extend() отказывает отозванной, 162-167) — корректировка явно перечисляет админу отозванные лицензии и предлагает ручную перевыдачу.
- Дедупликация ручного и автоматического путей держится на том, что админ честно отметит «возврат проведён на площадке». Ошибочный выбор «вне площадки» породит два денежных факта на один возврат. Смягчение: для DIGISELLER-платежа «на площадке» — вариант по умолчанию, а «вне площадки» требует ввода причины и попадает в аудит.
- Событие 4→3→4 по unique_code_state дедуплицируется: повторный спор после подтверждения доставки второго уведомления не породит. Приемлемо, но это осознанная потеря сигнала; если споры окажутся массовыми, в ключ придётся добавлять порядковый номер наблюдения, и тогда дедупликация по факту перестанет быть полной.
- Инвариант sum(refunds) <= payment.amount выражен через денормализованную колонку Payment.refundedAmount: CHECK связывает только колонки одной строки. Запись в refunds в обход сервиса (миграция данных, ручной SQL) разъедется молча. Ровно поэтому суточная сверка sum(refunds.amount) против payments.refunded_amount заведена как ОБЯЗАТЕЛЬНАЯ часть проекта, а не как пожелание.
- Порядок фаз в реакции требует, чтобы licenses.revoke вызывался ПОСЛЕ захвата currentDeviceId/hwidHash. Это соглашение, а не ограничение БД: перестановка строк в будущем рефакторинге снова сделает блокировку устройства пустой операцией. Закрывается только тестом, утверждающим, что deviceId в анти-фрод событии не NULL.
- UNIQUE(code_hash) на сделке исходит из того, что коды, различающиеся только регистром, — один и тот же код. Если площадка регистрозависима И выдаст два кода, различающихся только регистром, вторая сделка попадёт в BLOCKED_INPUT/CODE_HASH_COLLISION. Это не потеря (обе покупки записаны, обе видны админу), но разбор ручной. Вероятность крайне мала, цена альтернативы (двойная выдача) выше. Зеркальный размен принят и в отрицательном кеше, но там — в противоположную сторону (ключ по точному коду), потому что там цена ошибки другая.
- Отрицательный кеш ключуется по точному коду, поэтому противник, шлющий регистровые варианты одной строки, обходит кеш и тратит по одному UC на вариант. Осознанный размен в пользу заплатившего покупателя. Если реальная регистрозависимость будет подтверждена тестовой покупкой, решение надо пересмотреть в сторону lower() и зафиксировать отдельно.
- Допустимое расхождение часов с площадкой не документировано, и кода ошибки «устаревший timestamp» в контракте нет — есть только -1/-2/-3/-4. Отказ по причине дрейфа придёт как -1 «неверный логин или подпись», то есть автоматически отличить «неверный ключ» от «уехали часы» нельзя. Измеренный дрейф из valid_thru и признак CLOCK_DRIFT в health позволят человеку поставить диагноз за минуту, но не позволят системе.
- GET /api/token/perms используется как пояснение, а не как гейт, поэтому состояние «прав не хватает» обнаруживается только на первом реальном вызове метода. Для deliver это первая продажа, для поллинга — первый цикл наблюдения. Между запуском и первым вызовом существует окно, в котором система выглядит здоровой.
- Свипер осиротевших сделок (verified, не погашена, живых claim нет, возраст > 24 ч), детектор ACCOUNTING_ANOMALY, очередь BLOCKED_INPUT (продвигается только админом), суточная сверка и переалерты — всё пишет в админскую очередь и в /billing/digiseller/health, который надо кем-то опрашивать. Метрик, алертов и счётчика подряд идущих падений в проекте нет (п.8 владельца), и модуль их не создаёт. Это самый широкий незакрытый риск проекта: почти все новые детекторы наследуют отсутствие читателя.
- Утечка кода покупки закрыта на двух известных путях (nginx access.log и лог приложения) и дополнительно сокращена хранением литерала в одной таблице с обнулением в терминале. НЕ закрыты и не проверялись: история браузера и Referer при переходе со страницы погашения, тело запроса в APM/трейсинге, если он появится, и содержимое писем покупателю. Первое снимается тем, что код больше не в URL; остальное требует отдельного правила при подключении трейсинга.
- Связка Order.quantity ↔ число выданных лицензий в БД по-прежнему не выражена: License.orderId — обычный nullable FK без уникальности. Условный переход PAID→DELIVERED закрывает путь Digiseller, но ручная админская выдача по уже DELIVERED-заказу создаст лишнюю лицензию. Смягчение — утверждение в invariants.helper.ts, прогоняемое после каждого сценария; в проде читателя у него нет.
- Баланс реселлера остаётся незащищённым: Reseller.balance без версии, у reseller_transactions нет ни одного уникального ключа, licenseId/orderId — голые Uuid без FK и индексов (schema.prisma:1003-1025). Канал Digiseller его не трогает, поэтому в v1 это за скобками, но любой сценарий «возврат средств реселлеру» через ResellerTxType.REFUND будет удваиваться при повторном прогоне дренажа.
- Токен площадки хранится в Redis, то есть credential живёт в общем кеше, доступ к которому шире доступа к БД. Смягчение — короткий срок жизни, requirepass и запрет логировать значение. Полностью снять это можно только хранением в памяти процесса, но тогда возвращается стадо логинов на N реплик и серия retval -4, что дороже.
- Единый платёжный канал: при недоступности Digiseller новых продаж нет (принятый заказчиком риск У-1, TZ.md:191-192). Интейк-вперёд смягчает — предъявленный код не теряется и досчитывается воркером в течение 72 часов, — но обойти это нечем.
- Горизонт наблюдения за возвратами теперь выводится из content.day_lock, а не из константы 90 дней. Это честнее, но day_lock описывает срок ХОЛДИРОВАНИЯ средств, а не окно возвратов и чарджбеков — они могут быть длиннее. Реальный горизонт может назвать только владелец аккаунта (п.2 владельца), и до этого настройка refund_watch_margin_days остаётся нашей оценкой.

---

## Дефекты, оставшиеся после ревизии

| Тяжесть | Штук |
|---|---|
| критично | 13 |
| важно | 15 |
| мелочь | 6 |

### Р2-1. [КРИТИЧНО] [однократность] STALLED вечен, считается в потолок открытых claim и не имеет способа быть отменённым покупателем — три опечатки навсегда закрывают человеку возможность погасить реальную покупку. Д6 закрыт заменой «терминала без выхода» на «нетерминал без выхода», который вдобавок съедает квоту.

**Сценарий.** Покупатель трижды ошибается в одном символе 16-значного кода. Формат-гейт (16 символов, charset) опечатку не ловит — длина сохранена. По каждому коду создаётся claim → PENDING_VERIFY. Площадка на несуществующий код отвечает недокументированным retval (сам документ, строка 191: таблица retval у searchuniquecode содержит только «0», коды для несуществующего кода можно лишь предполагать по deliver). `digiseller.reject_retvals` по умолчанию пуст (сид: `reject_retvals=[]`), значит правило «неизвестный retval → RETRYABLE, никогда не REJECT» отправляет все три claim в бесконечный бэкофф. Через 72 часа: `PENDING_VERIFY --now() > escalate_at--> STALLED`. Дальше: (1) STALLED терминалом не является и по ШОВ 6-бис ПРЯМО считается в `max_open_claims_per_user=3`; (2) ночной job чистит только `REJECTED(CODE_INVALID)` старше 30 дней — STALLED не чистится никогда; (3) в §15 нет ни одного эндпоинта отмены/отказа от claim — только redeem, status, retry, админские queue/*. Покупатель оплачивает товар на Digiseller, вводит НАСТОЯЩИЙ код и получает 429 на `POST /redeem`, строка не создаётся вовсе. Навсегда. 429 по правилу анти-оракула не объясняет причину, `GET /claims/:claimId` про новый код ничего не знает (claim не создан), в админскую очередь ничего не попадает — там лежат старые три STALLED, а не факт отказа. Заплатил, не получил ничего, и ни один детектор проекта этого не видит.

**Правка.** Развести две роли потолка. (1) Ввести `DELETE /claims/:claimId` (или `POST /claims/:claimId/abandon`) для заявителя: перевод в `REJECTED(ABANDONED)` — терминал, освобождающий и квоту, и резерв UC. Это ровно то самообслуживание, которое автор дал STALLED в виде «повторить», но не дал в виде «отпустить». (2) Дать STALLED календарный горизонт второго уровня: `stalled_ttl_days` (например 7) → автоматический `REJECTED(STALE)` с публикацией того же конверта CODE_INVALID и попаданием под ночную чистку — иначе множество STALLED монотонно растёт по построению. (3) Убрать STALLED из счёта `max_open_claims_per_user`, оставив там только PENDING_VERIFY: STALLED уже ограничен глобальной полосой BACKGROUND (одно обращение в 6 часов), поэтому его вклад в стоимость у площадки ничтожен, а вклад в отказ покупателю — тотальный. Тест: три claim в STALLED + `POST /redeem` с валидным кодом обязан вернуть 202, а не 429.

**Доказательство.** Автомат: «PENDING_VERIFY --now() > escalate_at--> STALLED», «STALLED --иначе--> STALLED (+6 ч, бесконечно)». ШОВ 6-бис: «В потолок считаются ТОЛЬКО состояния, способные породить обращение наверх: PENDING_VERIFY и STALLED». §1: «REJECTED(CODE_INVALID) старше claim_ttl_days (30) чистится ночным job» — только CODE_INVALID. §15: эндпоинта отмены claim нет. Сид: `reject_retvals=[]`. DIGISELLER-DESIGN.md:191 — формат ответа «код не найден» не документирован.

### Р2-2. [КРИТИЧНО] [однократность] `escalate_at` вычисляется один раз от `created_at` и пересчитывается ТОЛЬКО в переходе «STALLED --админ: resolve». Любой claim, вышедший из BLOCKED_* позже 72 часов, попадает в вечный цикл PENDING_FULFILL ⇄ STALLED и не выдаётся никогда. Это прямо опровергает заявленное закрытие Д5.

**Сценарий.** Владелец выставил новый товар на Digiseller раньше, чем завёл LicensePlan — исходный сценарий Д5 дословно. Покупатель платит, код проверяется OK, preflight не находит тариф → `BLOCKED_UNMAPPED/PRODUCT_UNMAPPED`, 202 ACCEPTED_DELAYED, письмо `order.delayed`. У BLOCKED_UNMAPPED нет перехода по escalate_at, поэтому claim спокойно ждёт. Админ заводит тариф на пятый день (совершенно рутинно: `unmapped_alert_hours=2` алертит в очередь, у которой по признанию самого автора нет читателя). Срабатывает `BLOCKED_UNMAPPED --тариф появился и активен--> PENDING_FULFILL`. Но `escalate_at = created_at + 72ч` истёк ещё на четвёртые сутки и нигде не пересчитан. Следующий тик: `PENDING_FULFILL --now() > escalate_at--> STALLED`. Медленная полоса через 6 часов: `STALLED --площадка ответила OK--> ветвление как из PENDING_VERIFY` → preflight теперь проходит (тариф есть) → PENDING_FULFILL → escalate_at ВСЁ ЕЩЁ в прошлом → STALLED. Петля замкнулась: каждые 6 часов один UC наверх, ни одной лицензии, вечно. CHECK-констрейнты её не ловят — оба состояния нетерминальны и оба обязаны иметь непустой next_attempt_at. Хуже: STALLED считается в `max_open_claims_per_user`, поэтому каждый такой claim ещё и постоянно занимает квоту покупателя (см. дефект выше). Заявление автора «заведение тарифа админом лечит ВСЕ ждущие claim без действия по каждому» и его исполняемый тест `digiseller-preflight.spec.ts` («ВСЕ ждущие claim выдаются САМИ на ближайшем тике, без единого resolve») верны только для claim моложе 72 часов — то есть ровно для тех, где Д5 и не был проблемой. Тот же цикл получается из `BLOCKED_INPUT --админ: resolve с override--> PENDING_FULFILL`: у этого перехода пересчёт escalate_at тоже не описан, поэтому ручное решение админа по claim старше трёх суток внешне не срабатывает.

**Правка.** Сделать пересчёт `escalate_at` свойством ВХОДА в PENDING_FULFILL/PENDING_VERIFY, а не свойством одного админского перехода: при любом переходе из BLOCKED_UNMAPPED, BLOCKED_INPUT и STALLED в рабочее состояние выставлять `escalate_at = now() + retry_horizon_hours`. Формально: горизонт отсчитывается от момента, когда claim СТАЛ дееспособным, а не от момента предъявления — иначе календарный горизонт наказывает за нашу же операционную задержку. Дополнительно завести констрейнт-ловушку на петлю: счётчик `stall_cycles`, инкрементируемый на переходе PENDING_FULFILL→STALLED; при `stall_cycles >= 2` строка идёт в админскую очередь с отдельным кодом `HORIZON_EXHAUSTED`, а не крутится молча. Тест `digiseller-preflight.spec.ts` обязан выставлять виртуальные часы на created_at + 96ч ПЕРЕД тем, как админ проставит `digisellerProductId` — в нынешней формулировке он проверяет только благополучный случай и петлю не увидит.

### Р2-3. [КРИТИЧНО] [однократность] `POST /queue/fingerprints/:fp/terminal` пишет наблюдённый retval в ГЛОБАЛЬНЫЙ `digiseller.reject_retvals`, а REJECTED не имеет ни одного обратного перехода. Один клик админа превращает системный отказ нашей стороны в вечный CODE_INVALID для всех будущих заплативших покупателей — и закрепляет его в отрицательном кеше.

**Сценарий.** У API-ключа отозвано право `view_invoice`, либо аккаунт продавца получил ограничение, либо площадка ввела недокументированный retval со смыслом «счёт на удержании». Метод `searchuniquecode` начинает отдавать HTTP 200 с одним и тем же ненулевым retval на ВСЕ коды. По правилу «неизвестный retval → RETRYABLE, никогда не REJECT» каждый claim идёт в бэкофф и через 72 ч в STALLED. Очередь STALLED группируется по `response_fingerprint` — и именно системный отказ даёт то, что автор описал как сигнал к действию: «админ увидел один и тот же ответ сто раз и объявил его терминальным» (ШОВ 13). Заметьте асимметрию: мусорные коды от опечаток дают ОДИНАКОВЫЙ отпечаток низкой частоты, системный отказ — одинаковый отпечаток высокой частоты. Рычаг по построению наводит админа на системный случай. Админ жмёт «объявить терминальным». `SettingsService.set` добавляет retval в `digiseller.reject_retvals` — глобально, для всех кодов, бессрочно, без указания отпечатка. С этого момента: (1) все STALLED с этим ответом схлопываются в `REJECTED(CODE_INVALID)`, а из REJECTED в автомате НЕ ВЕДЁТ НИ ОДИН переход — админского resolve у REJECTED нет, в отличие от STALLED; (2) каждый НОВЫЙ покупатель, оплативший товар, получает `PENDING_VERIFY --retval ∈ reject_retvals--> REJECTED(CODE_INVALID)` → 404 «код неверен» после 15 секунд выдержки; (3) вердикт терминален, значит попадает в отрицательный кеш `digiseller:neg:<sha256>` на час, и повторное предъявление того же кода даже не доходит до площадки. Права восстановили через сутки — ничего не изменилось: retval остался в настройке, все claim за сутки уже в терминале без возврата, деньги получены, лицензий нет. Это ровно тот исход, который автор запретил себе в ШОВ 4 («заплативший покупатель получил бы CODE_INVALID из НАШЕГО кеша, ни разу не дойдя до площадки»), впущенный обратно через админскую дверь.

**Правка.** Три правки, любая из которых снимает катастрофичность, все три — правильный минимум. (1) Терминальность объявлять ПО ОТПЕЧАТКУ, а не по retval: хранить `digiseller.reject_fingerprints` (список `response_fingerprint`), а не голые числа. Отпечаток включает форму всего ответа, поэтому смена причины отказа его меняет и старое решение перестаёт применяться автоматически. (2) Дать REJECTED ровно один обратный переход `REJECTED --админ: reopen--> PENDING_VERIFY` с пересчётом счётчиков и escalate_at, под тем же правом `billing.digiseller.operate` и `@Audit`. Терминалов без выхода в этом проекте уже не должно быть — это буквально диагноз Д6, применённый к другому состоянию. (3) Сделать действие обратимым и обозримым: перед записью показать админу число claim, которые будут переведены в терминал, и число обращений, из которых сложился отпечаток; запись снабдить `expires_at` (например 30 суток), после которого retval выпадает из reject_retvals и класс ответов снова становится RETRYABLE. Плюс инвалидировать отрицательный кеш при ЛЮБОМ изменении `reject_retvals` — сейчас это не описано, и час после отката решения площадка не опрашивается вовсе.

**Доказательство.** §15: «добавляет retval в `digiseller.reject_retvals` через SettingsService.set». Автомат: «PENDING_VERIFY --retval ∈ digiseller.reject_retvals--> REJECTED(CODE_INVALID)»; «FULFILLED / REJECTED --> терминал» — обратных переходов нет, тогда как у STALLED есть «админ: resolve». §6: отрицательный кеш «хранит только терминальные вердикты», EX 3600.

### Р2-4. [КРИТИЧНО] [деньги] Дренаж событий (§9 шаг 3) не диспетчеризуется по классу факта: шаг 1 (refunds.createMany) и шаг 8 (refunded_at) безусловны, а шаг 2 пишет событие на ЛЮБОЕ наблюдённое invoice_state/code_state. §8 описывает ветвление по состояниям только прозой; исполняемый конвейер ветвления не содержит.

**Сценарий.** Здоровая сделка, покупатель заплатил, лицензия выдана. Первый же плановый опрос purchase/info возвращает content.invoice_state = 3 («успешная оплата»). §9 шаг 2 записывает digiseller_events с externalId = 'dgs:inv:{inv}:invoice_state:3' — «сравнения, изменилось ли состояние, нет вообще», значит событие пишется. Дренаж берёт его и идёт по единственному описанному пути: шаг 1 создаёт строку refunds с external_ref = 'dgs:inv:{inv}:refund' (ключ НЕ содержит номера состояния, поэтому он вычислим и для состояния 3), count = 1 → реакция выполняется; шаг 2 увеличивает payment.refundedAmount на payment.amount; шаг 3 переводит платёж в REFUNDED; шаг 6 отзывает лицензии; шаг 7 внутри той же транзакции ставит письмо license.revoked. Заплативший теряет доступ примерно через 300 с (проверка лаунчера), в книге появляется полный возврат, которого не было. Тот же путь срабатывает на code_state=4 (спор о доставке) — то есть Д15 возвращается не через триггер, а через дренаж.

**Правка.** Ввести явный switch по классу факта ДО шага 1: денежная реакция только для invoice_state=5; 35 → REFUND_PENDING без записи в refunds и без refunded_at; 1/2/4 → ACCOUNTING_ANOMALY; 3 → только обновление проекции; code_state:* → ветка спора (disputed_at, уведомление), которая к refunds не прикасается. Ключ external_ref денежного факта обязан быть вычислим ТОЛЬКО в ветке invoice_state=5.

**Доказательство.** §9 шаг 2 («Сравнения „изменилось ли состояние“ нет вообще»), §9 шаг 3 п.1 и п.8 без единого условия по eventType; §8 задаёт разные реакции на 3/35/5/code_state=4 только текстом.

### Р2-5. [КРИТИЧНО] [деньги] Шаг 8 дренажа безусловно ставит digiseller_orders.refunded_at, а refunded_at — одновременно денежный факт, предикат наблюдения поллера и рукопожатие ручного пути. Первое же непреобразованное в деньги событие навсегда снимает сделку с наблюдения за возвратом.

**Сценарий.** Покупатель открыл возврат на площадке и не довёл его: purchase/info отдаёт invoice_state = 35. По решению №10 лицензию не отзываем — правильно. Но событие 'dgs:inv:{inv}:invoice_state:35' проходит дренаж, и шаг 8 выполняет digisellerOrder.updateMany({ where: { id, refundedAt: null }, data: { refundedAt, providerInvoiceState } }) — count = 1, refunded_at проставлен. Частичный индекс наблюдения объявлен как (next_poll_at) WHERE redeemed_at IS NOT NULL AND refunded_at IS NULL — строка из выборки выпадает. Через сутки покупатель доводит возврат, площадка ставит invoice_state = 5. Никто этого не увидит: сделка больше не опрашивается, health по max_next_poll_age_sec считает только наблюдаемые строки и остаётся зелёным. Деньги возвращены полностью, payment CONFIRMED, order DELIVERED, лицензия работает бессрочно. Зеркальный случай — событие count=0 («факт уже известен», «сразу к шагу 8») тоже доходит до шага 8 и стирает наблюдение.

**Правка.** Разделить роли: завести отдельный refund_watch_until / watch_stopped_at либо строить предикат поллера от факта денежного возврата (наличие строки refunds kind='PROVIDER' на полную сумму), а digiseller_orders.refunded_at ставить ИСКЛЮЧИТЕЛЬНО в ветке invoice_state=5 и в ручном полном возврате. Ветка count=0 обязана обновлять только processed_at.

**Доказательство.** §9 шаг 3 п.8; §12, индекс «+ INDEX (next_poll_at) WHERE redeemed_at IS NOT NULL AND refunded_at IS NULL»; §10 «health отдаёт МАКСИМАЛЬНЫЙ возраст next_poll_at среди наблюдаемых строк».

### Р2-6. [КРИТИЧНО] [деньги] Возврат по проверенной, но НЕ исполненной сделке не наблюдается ничем и записать его невозможно; последующее исполнение выдаёт лицензию за уже возвращённые деньги, а фаза C по инварианту не имеет права переспросить площадку.

**Сценарий.** Покупатель платит, вводит код. Preflight: тариф не заведён → BLOCKED_UNMAPPED. Сделка создана (inv, buyerEmail, raw_payload), redeemed_at NULL, payment_id NULL. Поллинг её не берёт — предикат требует redeemed_at IS NOT NULL. Свипер осиротевших сделок её не берёт — у неё живой claim. Алерт через 2 ч уходит в админскую очередь, у которой, по признанию самого проекта, читателя нет. На вторые сутки покупатель просит возврат на площадке и получает деньги (invoice_state = 5) — записать этот факт нельзя даже руками: refunds.payment_id — FK NOT NULL, а платежа ещё не существует; POST /payments/:paymentId/refund адресовать нечем; queue/close даёт REJECTED(ADMIN_CLOSED) и сделку не трогает. На пятые сутки админ заводит тариф → BLOCKED_UNMAPPED → PENDING_FULFILL → фаза C, в которой «сети нет ВООБЩЕ» и никакой проверки refunded_at/invoice_state не предусмотрено. Создаются order PAID→DELIVERED, payment CONFIRMED с confirmedAt = now и amount = наш прайс, выдаются лицензии. В книге — подтверждённый платёж за деньги, вернувшиеся к покупателю трое суток назад. BLOCKED_INPUT ещё хуже: у него нет календарного горизонта вовсе («продвигается только админом»), и resolve через два месяца выдаст лицензию, когда горизонт наблюдения day_lock + margin от даты покупки уже истёк, то есть возврат не будет обнаружен уже никогда.

**Правка.** Наблюдать за возвратом с момента появления сделки, а не с момента погашения: предикат поллинга по verified_at IS NOT NULL AND refunded_at IS NULL. Перед коммитом фазы C перечитывать provider_invoice_state/refunded_at сделки и при 5/35 уходить в BLOCKED_INPUT/REFUND_PENDING вместо выдачи (данные локальные, инвариант «нет сети в транзакции» не нарушается). Разрешить запись возврата по сделке без платежа — сделать refunds.payment_id nullable при NOT NULL digiseller_order_id либо ввести отдельный факт deal_refunded, снимающий claim в REJECTED(DEAL_REFUNDED). Задать BLOCKED_INPUT календарный потолок.

**Доказательство.** §2 («сделка создаётся с paymentId = NULL», «redeemedAt НЕ ставится никогда»); §3 (фаза C без сети и без проверки состояния сделки); §12 индекс поллинга и «refunds: payment_id FK Restrict»; §5 таблица переходов BLOCKED_INPUT — только админский выход.

### Р2-7. [КРИТИЧНО] [внешний-отказ] Вся конструкция fail-DEGRADED («перезапуск Redis не имеет права останавливать единственный платёжный канал») опровергается инфраструктурой, которую проект не тронул: readiness-проба уже отдаёт 503 при недоступности Redis, а контейнер API не стартует, пока Redis не healthy.

**Сценарий.** Redis перезапускается (или падает на 2 минуты). GET /health/ready на КАЖДОЙ реплике бросает ServiceUnavailableException, потому что redis.ping() упал. Балансировщик/оркестратор, для которого эта проба и написана (комментарий в самом файле: «По этой пробе балансировщик убирает инстанс из ротации»), снимает все реплики — POST /billing/digiseller/redeem недоступен целиком, ни 202, ни 503, ни процессного бакета. Ни один тест digiseller-limits.spec «fail-degraded» этого не увидит: он дёргает сервис в процессе, минуя пробу и балансировщик. Второй ход того же сценария: после отказа Redis админ делает `docker compose up -d` (или нода перезапускает стек) — api не поднимается вовсе, `depends_on: redis: condition: service_healthy` держит его до восстановления Redis. То есть «продажи остановлены отказом кеша» происходит ровно в том виде, ради отмены которого был отменён fail-closed.

**Правка.** Развести readiness на обязательные и необязательные зависимости: Postgres — обязателен, Redis — только строка в теле со статусом degraded, код 200. Поменять depends_on redis на service_started. Добавить в digiseller-limits.spec проверку не сервисного метода, а HTTP-пути: при мёртвом Redis GET /health/ready = 200 и POST /redeem = 202.

**Доказательство.** C:/Users/user/work/kwork/license-platform/apps/api/src/modules/health/health.controller.ts:62-86 (в ready() redis.ping() в том же Promise.all, что и postgres, любой down → 503 NOT_READY); C:/Users/user/work/kwork/license-platform/docker-compose.yml:197-205 (api depends_on redis condition: service_healthy). В проекте про /health/ready сказано только «digiseller health в /health/ready НЕ включается» и «/health/ready НЕ деградирует при мёртвой площадке» — про Redis не сказано ничего.

### Р2-8. [КРИТИЧНО] [внешний-отказ] Токен площадки, single-flight-лок и lastTs живут ТОЛЬКО в Redis. При отказе Redis канал не деградирует, а обваливается: либо ~1 логин в минуту на процесс (значит ~1 проверка кода в минуту), либо стадо логинов с коллизиями ts.

**Сценарий.** Redis недоступен 10 минут, площадка жива. Кеш `digiseller:token` не читается и не пишется, `digiseller:token:lock` не берётся, `digiseller:apilogin:last_ts` недоступен. Каждый UC теперь требует своего apilogin (кешировать некуда). Полоса CONTROL (5/мин, «apilogin и token/perms, не делится ни с кем») в деградированном режиме превращается в процессный бакет 0.25×5 = 1.25 логина в минуту на реплику. Значит пропускная способность проверки кодов падает до ~1 в минуту на процесс — заплативший покупатель ждёт десятки минут, а очередь claim растёт; ровно то состояние «продажи стоят», которое проект объявил недопустимым. Если же реализатор, увидев это, выключит CONTROL-бакет при деградации, получится зеркальная беда: N реплик логинятся на каждый запрос, ts у них считается от одного и того же настенного времени, а второй слой уникальности (`SET digiseller:apilogin:ts:{ts} NX`) тоже в Redis и не работает, — две реплики в одну секунду дают один ts и retval -4, до 3 повторов каждая, а частые логины на площадке с недокументированным лимитом за DDoS-Guard — это прямой путь к challenge и к -2.

**Правка.** Второй ярус кеша токена в памяти процесса (тот же TTL из valid_thru), процессный single-flight (одно in-flight обещание логина на процесс) и процессный монотонный lastTs — включаются автоматически, когда Redis недоступен. Отдельно зафиксировать в digiseller-token.spec: Redis выключен → 50 параллельных операций дают не более одного apilogin на процесс и ни одного -4.

**Доказательство.** Проект: «Кеш токена: Redis `digiseller:token`… Single-flight: `SET digiseller:token:lock NX EX 15`», «lastTs в Redis (`digiseller:apilogin:last_ts`)», «полоса CONTROL 5/мин», «пер-пользовательский/пер-IP/глобальные полосы — fail-DEGRADED: процессный токен-бакет на local_fallback_fraction=0.25». Про поведение самого токена при недоступности Redis не сказано ничего; в рисках хранение токена в памяти процесса явно отвергнуто.

### Р2-9. [КРИТИЧНО] [внешний-отказ] Утверждение «ioredis отклоняет команду ~1,2 с, поэтому деградация залипающая» неверно: при затянувшемся отказе Redis каждая команда отклоняется до ~15 с, интейк делает несколько таких команд подряд, и POST /redeem упирается в proxy_read_timeout nginx — покупатель получает 504 вместо 202.

**Сценарий.** Redis мёртв уже минуту (не первые секунды). retryStrategy = min(times*200, 5000), а `times` растёт и обнуляется только при успешном коннекте, поэтому задержки давно на потолке 5000 мс; maxRetriesPerRequest=3 при enableOfflineQueue=true означает, что команда лежит в offline-очереди и отклоняется примерно через 3×5 с. Интейк redeem по проекту делает подряд: дешёвый счётчик malformed → резерв UC (user/ip/subnet) → отрицательный кеш (+ чтение состояния breaker). Это 4+ последовательных обращения к Redis, каждое ждёт своего отказа. Запрос живёт больше 45 с, nginx рвёт его на 30-й секунде (proxy_read_timeout 30s) и отдаёт 504. Fail-open/fail-degraded формально написаны в catch, но до catch управление доходит позже, чем истекает HTTP. Побочно: те же зависшие обещания держат воркеры процесса, и деградирует не только digiseller, а весь API.

**Правка.** Каждое обращение к Redis на платёжном пути обернуть в Promise.race с таймером 100-200 мс и считать таймаут отказом; при отказе взводить процессный флаг degraded на 10-30 с, чтобы последующие запросы вообще не ходили в Redis. В digiseller-limits.spec «fail-degraded» добавить утверждение о ЛАТЕНТНОСТИ: p99 POST /redeem при мёртвом Redis < 1 с.

**Доказательство.** C:/Users/user/work/kwork/license-platform/apps/api/src/common/redis/redis.service.ts:30-34 (maxRetriesPerRequest: 3, retryStrategy (times) => Math.min(times * 200, 5000), enableOfflineQueue: true, connectTimeout: 5000); C:/Users/user/work/kwork/license-platform/docker/nginx/templates/default.conf.template:211 (proxy_read_timeout 30s); прецедент fail-open без таймаута — apps/api/src/modules/launcher/payload.service.ts:475-492 (await redis без гонки с таймером). Тест проекта «503 из-за исчерпания глобального бакета НЕ возникает» проверяет код ответа, но не время ответа.

### Р2-10. [КРИТИЧНО] [внешний-отказ] Единственный самообслуживаемый выход из STALLED (кнопка «повторить»), которым закрывается Д6, не работает после суточной аварии: escalate_at при нём не пересчитывается, поэтому claim возвращается в STALLED на первом же тике, потратив UC.

**Сценарий.** Площадка недоступна 4 суток (DDoS-Guard блокирует наш IP). Claim создан в момент T, escalate_at = T+72 ч, к моменту восстановления now() > escalate_at. Покупатель видит ACCEPTED_DELAYED с canRetry и жмёт «повторить»: переход STALLED → PENDING_VERIFY с next_attempt_at = now() и списанием UC. Воркер берёт строку и до/после обращения применяет правило «PENDING_VERIFY --now() > escalate_at--> STALLED», которое выполняется всегда, потому что escalate_at остался в прошлом. Если проверка горизонта стоит до вызова (а она дешевле сетевого вызова, и реализатор поставит её именно туда), покупатель вообще не доходит до площадки: два клика в час, каждый сжигает UC и возвращает тот же экран. Формально состояние не терминальное, практически это тупик, из которого выходит только админ — то есть Д6 закрыт для 72 часов и открыт заново для всего, что дольше.

**Правка.** В selfRetry пересчитывать escalate_at (now + retry_horizon_hours) и undecidable_streak так же, как это делает админский resolve; иначе — запретить показывать canRetry, когда escalate_at в прошлом. Тест: авария 96 ч, ретрай покупателя, площадка отвечает OK → claim обязан дойти до FULFILLED без участия админа.

**Доказательство.** Проект, полный список переходов: «STALLED --покупатель нажал «повторить»--> PENDING_VERIFY (next_attempt_at = now(), стоит UC)» — против соседней строки «STALLED --админ: resolve--> PENDING_VERIFY (счётчики и escalate_at пересчитываются)». Контраст явный: пересчёт горизонта прописан только для админа. Тест «площадка недоступна 72 ч → STALLED, canRetry, самообслуживание работает» останавливается на 72 часах и не проверяет ретрай ПОСЛЕ истечения горизонта.

### Р2-11. [КРИТИЧНО] [контракт] Гейтинг прав построен на HTTP 403, но документация площадки прямо говорит, что отсутствие права приходит как 401 ИЛИ 403. Для двух из трёх каналов (view_invoice, sales_statistics_view) документированного retval-эквивалента нет вообще, поэтому состояние DENIED недостижимо, а 401 попадает в ветку «токен протух» — с принудительной инвалидацией ОБЩЕГО токена и релогином на каждом вызове.

**Сценарий.** Владелец создал API-ключ без права «Статистика продаж». Поллер тикает раз в 5 минут с poll_batch_size=200. Каждый вызов seller-sells/v2 и purchase/info отвечает HTTP 401 → клиент делает «ровно одну принудительную инвалидацию токена и один повтор» → повторный 401 → RETRYABLE. Итог за один тик: до 200 инвалидаций общего Redis-ключа digiseller:token и до 200 попыток apilogin при полосе CONTROL 5/мин. Полоса CONTROL выедается фоном (ради чего её и заводили — и это не помогает, потому что источник шторма сам сидит в CONTROL), токен для redeem получить нечем, живой покупатель получает 503/зависший claim. Capability sales_statistics_view навсегда остаётся UNKNOWN, health НЕ становится красным (как обещано в §7), а digiseller-capabilities.spec.ts зелёный, потому что FakeDigisellerApi отдаёт 403, которого в реальности не будет. Тот же путь на view_invoice: redeem никогда не отдаёт обещанные 503, claim ретраится 72 часа и уходит в STALLED.

**Правка.** Различать 401-протух и 401-нет-права не по статусу, а по факту: инвалидация токена разрешена не чаще одного раза на поколение токена (сравнивать issued_at токена, из которого пришёл 401, с текущим кешем; повторный 401 на СВЕЖЕВЫДАННОМ токене = права, а не срок). Второй 401 подряд после успешного релогина переводит канал в DENIED, а не в RETRYABLE. Плюс в FakeDigisellerApi и digiseller-capabilities.spec.ts добавить ветку 401 с пустым телом и 401 с [] — иначе тест продолжит проверять несуществующее поведение.

**Доказательство.** docs/DIGISELLER-DESIGN.md:143 — «пустой массив означает отсутствие доступа (http status 401 или 403)» и «при 401 стоит различать „токен протух“ и „у ключа нет права“»; там же:137 — purchase/info с неверным токеном отдаёт HTTP 401 с пустым телом, token/perms — 401 и []. Проверено на живой документации (my.digiseller.com/inside/api_general.asp#get_perms): «empty array means no access (http status 401 or 403)». Проект: §7 «в DENIED переводит только права-ошибка от самого метода (HTTP 403 либо документированный retval -5 у deliver)»; §16 «на 401 — ровно одна принудительная инвалидация токена и один повтор, повторный 401 → RETRYABLE».

### Р2-12. [КРИТИЧНО] [контракт] Товар площадки сопоставляется с тарифом ТОЛЬКО по id_goods, при том что документированный ответ отдаёт options[{id,name,value,variant_id}] и это официальный способ выразить вариант товара. При digisellerProductId Int? @unique один товар физически не может быть сопоставлен нескольким тарифам, а ТЗ требует линейку сроков.

**Сценарий.** Владелец заводит на площадке один товар «Лицензия FC26» с параметром «Срок: 30 / 90 / 180 дней» (штатная и самая частая конфигурация Digiseller, дешевле и удобнее, чем шесть отдельных карточек). Покупатель берёт 180 дней, получает код, гасит его у нас. Preflight находит plan по digisellerProductId — он ровно один — и выдаёт лицензию с durationDays того тарифа, который админ привязал к карточке (например, 30 дней). Ни одна проверка не срабатывает: BLOCKED_UNMAPPED нет (план найден), сумма в Order берётся из НАШЕГО прайса (§8), поэтому расхождение с оплаченным не видно даже в суточной сверке, а cnt_goods=1 корректен. Покупатель молча недополучает 150 дней; обратный случай (взял 30, получил 180) — молчаливый убыток. Никакой строки в админской очереди не появляется.

**Правка.** Либо (а) ввести таблицу сопоставления (digiseller_product_id, variant_id|option value) → plan и BLOCKED_UNMAPPED/VARIANT_UNMAPPED при непустом options[] без сопоставления; либо (б) сознательно запретить варианты: если options[] непустой — BLOCKED_UNMAPPED, а не тихая выдача. Молча игнорировать документированное поле, определяющее ЧТО куплено, нельзя ни в одном из вариантов.

**Доказательство.** docs/DIGISELLER-DESIGN.md:59,65 — в ответе unique-code есть options[{id,name,value,variant_id}], и документ прямо пишет: «Товар → id_goods (+ options[] с выбранными покупателем параметрами и variant_id)». Проверено на живой документации: options — «only for products with additional parameters», покупательские опции есть и в purchase/info. apps/api/prisma/schema.prisma:800 — digisellerProductId Int? @unique (один товар ↔ один тариф). docs/TZ.md:214 (У-5) — тарифы 1/7/30/90/180/lifetime привязаны к товару Digiseller. В проекте слова options/variant_id не встречаются ни в preflight, ни в mapper, ни в схеме claim.

### Р2-13. [КРИТИЧНО] [контракт] digiseller.reject_retvals — плоский список чисел без привязки к методу, а рычаг POST /queue/fingerprints/:fp/terminal позволяет админу одним кликом объявить терминальным ответ, который на самом деле является ошибкой аутентификации. Одни и те же числа у разных методов означают разное.

**Сценарий.** У ключа отозвали право «Детали счета» (или ключ перевыпустили и .env не обновили). Каждый вызов unique-code отвечает HTTP 400 {retval:-4,retdesc:"отсутствует или неверно задан параметр token"}. Claim'ы копятся в STALLED, все с ОДНИМ response_fingerprint. Админ видит в очереди один элемент со счётчиком «наблюдался 800 раз», выполняет ровно то, что предписывает ШОВ 13 («админ увидел один и тот же ответ сто раз и объявил его терминальным»), и -4 уходит в digiseller.reject_retvals через SettingsService.set. С этого момента переход «PENDING_VERIFY --retval ∈ reject_retvals--> REJECTED(CODE_INVALID)» срабатывает на КАЖДОМ предъявлении, включая честно оплаченные коды: покупатель получает 404 CODE_INVALID, отрицательный кеш на час запоминает вердикт, и это масштабируется на всех покупателей до починки ключа. Обратная сторона того же дефекта: -4 у apilogin означает «не уникальный timestamp», -3 у apilogin — «ошибка в процессе выполнения», а у unique-code -3 — «отсутствует параметр token»; список без указания метода склеивает эти смыслы.

**Правка.** (1) Ключевать reject_retvals методом: {"searchuniquecode": [...]} — площадка переиспользует числа между методами. (2) Жёсткий denylist на уровне кода: -3, -4, -5 и любой ответ, классифицированный как AUTH или как HTTP 401/403, не может быть добавлен в reject_retvals ни человеком, ни настройкой. (3) Проверку reject_retvals выполнять СТРОГО после классификации и только для ветки «ответ распознан как вердикт о коде».

**Доказательство.** docs/DIGISELLER-DESIGN.md:89 — «без token → HTTP 400, {retval:-3}; с неверным token → HTTP 400, {retval:-4}» у unique-code; там же:35 — у apilogin -3 «ошибка в процессе выполнения», -4 «не выполнено условие уникальности timestamp». Проект: §1 переход по reject_retvals, §15 эндпоинт fingerprints/:fp/terminal, §12 «reject_retvals=[]» как обычная настройка. Ни denylist кодов, ни требования «отпечаток не должен быть классифицирован как AUTH» в проекте нет; порядок «проверка reject_retvals против классификации AUTH» тоже не задан.

### Р2-14. [ВАЖНО] [однократность] Д20 закрыт для меньшинства и объявлен закрытым вообще: тикет выдаётся только при ПОДТВЕРЖДЁННОМ совпадении почты, хотя весь остальной проект построен на допущении, что почты не совпадают. Один и тот же сигнал признан достаточным, чтобы ВЫДАТЬ лицензию постороннему, и недостаточным, чтобы принять жалобу настоящего покупателя.

**Сценарий.** Исходный сценарий Д20 дословно: посторонний X предъявляет код Y первым. По решению №20 (`require_email_match=false`, сохранено явно) и по переходу «PENDING_VERIFY --OK + preflight ok + !email_match + не оспорен--> PENDING_FULFILL» X получает лицензию — сверка почты для ВЫДАЧИ не требуется. Настоящий покупатель Y приходит через час (грейс 900 с давно истёк). Y покупал на Digiseller по почте, отличной от почты аккаунта в лаунчере — обычнейшее дело, и именно это допущение обосновывает решение №20. Либо почта та же, но `emailVerifiedAt IS NULL`, потому что аккаунт создан через Discord OAuth и, по признанию самого документа, «создаётся сразу ACTIVE». В обоих случаях `email_match = false`. Claim Y → `REJECTED(TAKEN_BY_OTHER)` → по §5 «404 CODE_INVALID, один конверт». Y слышит «такого кода не существует». Тикета нет, в админскую очередь `/queue` он не попадает (там BLOCKED_*, STALLED, ORPHANED_DEAL, ACCOUNTING_ANOMALY, DISPUTED, deliver — REJECTED не перечислен), 409 не выдаётся. Единственный след — аудит-запись, у которой по признанию автора нет читателя. Итог: Y заплатил, получил «кода нет» и не имеет способа сообщить о проблеме через продукт. Разница с исходным Д20 — только в том, что теперь есть аудит-строка. Асимметрия видна в одной фразе: несовпадающая почта считается достаточным основанием, чтобы отдать лицензию чужому, и недостаточным, чтобы завести тикет своему.

**Правка.** Разделить «право на лицензию» и «право на разбор». Условие на `emailVerifiedAt` оставить только для АВТОМАТИЧЕСКОГО приоритета владения (там оно обязательно — иначе владение крадётся сменой email). Для жалобы завести отдельный, всегда доступный путь: при `REJECTED(TAKEN_BY_OTHER)` ЛЮБОЙ claim получает `ticket` в теле статуса и порождает строку в админской очереди `/queue` с новым классом `CONTESTED_REDEMPTION` (sha256 кода, оба user_id, `deal.buyerEmail` в маскированном виде, `email_match`), сгруппированную по `digiseller_order_id`. Оракула это не создаёт: тикет виден только заявителю, который уже прошёл интейк и потратил резерв UC, а сам факт «код существовал и был погашен» из 404-конверта по-прежнему не следует — тикет выдаётся и на `REJECTED(CODE_INVALID)`, поэтому его наличие ничего не различает. Именно поэтому тикет надо выдавать на ОБЕ отрицательные ветки, а не на одну — иначе он сам становится оракулом. Тест `digiseller-antioracle.spec.ts` расширить: несуществующий код и чужой погашенный обязаны отдавать одинаково заполненное поле `ticket`.

### Р2-15. [ВАЖНО] [однократность] BLOCKED_INPUT — единственное нетерминальное состояние без автоматического выхода, без горизонта и без самообслуживания: выйти из него может только админ. Для заплатившего покупателя это функционально тот же тупик, что и снятый FAILED_PERMANENT, замаскированный ответом 202 ACCEPTED_DELAYED.

**Сценарий.** Площадка отвечает OK, но `type_curr` отсутствует в ответе — сам документ (строки 171-175) предупреждает: таблица полей у unique-code богаче JSON-примера, поля надо читать как optional, а в Swagger схема ответа этого метода вообще пустая. Preflight пункт 6: значение не матчит `^[A-Z]{2,8}$` → `BLOCKED_INPUT/CURRENCY_UNREPRESENTABLE`. То же самое даёт `cnt_goods` дробным (Д37: поле объявлено как double, и что приходит для товара с фиксированной ценой — не документировано, строка 199) и `inv` непарсящимся (Д1). Дальше сравните с соседним состоянием: у BLOCKED_UNMAPPED есть автопереразрешение раз в 600 с и алерт через 2 ч, у STALLED — медленная полоса, кнопка «повторить» у покупателя и админский resolve, у PENDING_* — переход по escalate_at. У BLOCKED_INPUT из трёх переходов два требуют админа, третий — `суточный тик --> BLOCKED_INPUT` — не делает ничего. Перехода по escalate_at нет. `canRetry` по §5 отдаётся только для STALLED, значит кнопки у покупателя нет. Покупатель видит вечное 202 ACCEPTED_DELAYED — ответ, неотличимый от «подождите, скоро выдадим». Выход упирается в админа, который должен вручную вписать номер счёта или валюту по конкретной строке, в очереди, про которую автор сам пишет: «Метрик, алертов и счётчика подряд идущих падений в проекте нет, и модуль их не создаёт. Это самый широкий незакрытый риск проекта». Если поле отсутствует систематически (изменение на стороне площадки), в BLOCKED_INPUT уходит ВЕСЬ поток продаж, и наружу это выглядит как «всё принято, обрабатывается».

**Правка.** BLOCKED_INPUT — состояние про ДАННЫЕ, а не про наш отказ, значит у него обязан быть тот же наблюдатель, что у остальных: (1) добавить переход `BLOCKED_INPUT --now() > escalate_at--> STALLED`, чтобы строка попадала в состояние, у которого есть и самообслуживание, и медленная полоса, и в котором покупателю честно показывают `canRetry`; (2) для кодов, зависящих от ответа площадки (CURRENCY_UNREPRESENTABLE, QUANTITY_FRACTIONAL, INV_UNPARSEABLE), завести автоперепроверку по образцу BLOCKED_UNMAPPED — повторный `searchuniquecode` раз в N минут на полосе BACKGROUND: ответ площадки может измениться, а нынешняя схема на это не рассчитана вовсе; (3) статус для BLOCKED_INPUT отличать от «скоро выдадим»: отдельный `state: 'NEEDS_REVIEW'` с тикетом, иначе покупатель не обращается в поддержку, потому что интерфейс сообщает ему, что всё идёт по плану; (4) счётчик `blocked_input_rows` вывести в `/health` рядом с `oldest_unmapped_age_sec` — сейчас он туда не выведен, в отличие от BLOCKED_UNMAPPED, и системный сбой разбора невидим.

### Р2-16. [ВАЖНО] [однократность] Нет констрейнта, гарантирующего непустой `unique_code` у нетерминального claim, хотя фаза B без литерала физически неработоспособна. Компенсирующий UPDATE поверх фактически закоммиченной фазы C возвращает claim в рабочее состояние с уже обнулённым кодом — и claim становится неизлечимым.

**Сценарий.** Автор объявил принципом «отсутствие тупиков — констрейнт, а не дисциплина» и завёл два CHECK: на next_attempt_at и на reject_reason. Третий, столь же дешёвый, не заведён. Путь: фаза C доходит до COMMIT, шаг 7 в той же транзакции пишет `state='FULFILLED', next_attempt_at=NULL, unique_code=NULL`. Обрыв соединения с Postgres ровно на COMMIT — классическая in-doubt ситуация; клиент видит ошибку, БД коммит применяет. Приложение отрабатывает описанную реакцию: «откат: таймаут/дедлок/пул --> PENDING_FULFILL (компенсирующий UPDATE отдельной tx)». Условие у этого UPDATE в проекте не задано, поэтому он перетирает FULFILLED на PENDING_FULFILL с непустым next_attempt_at — CHECK это пропускает, оба поля согласованы. Обычно строка чинится сама (шаг 1 даёт count=0, «погасил я» → FULFILLED). Но если `escalate_at` к этому моменту истёк — а он истёк, если claim жил трое суток из-за BLOCKED_UNMAPPED или аварии площадки, — следующий тик даёт `PENDING_FULFILL --now() > escalate_at--> STALLED`. Покупатель, которому статус показал 202, жмёт «повторить»: `STALLED --> PENDING_VERIFY, next_attempt_at = now()`, тратится UC. Воркер берёт строку и идёт в фазу B — а `unique_code IS NULL`. Запрос уходит как `GET /api/purchases/unique-code/null?token=…` либо падает раньше. Ответ не классифицируется → `undecidable_streak` → 1 ч, 12 подряд → 6 ч → escalate_at → STALLED → покупатель снова жмёт «повторить». Строка не может ни выдать лицензию, ни дойти до терминала, при этом навсегда занимает слот в `max_open_claims_per_user` и тратит UC каждые 6 часов. Лицензия при этом ВЫДАНА и лежит в БД — покупатель её просто никогда не увидит, потому что статус читается по claim.

**Правка.** (1) Констрейнт на месте дисциплины, ровно по методу автора: `CHECK (state IN ('FULFILLED','REJECTED') OR unique_code IS NOT NULL)`. Он делает описываемый сценарий невозможным на уровне БД: компенсирующий UPDATE, пытающийся вернуть терминальную строку в работу, упадёт с 23514, ошибка попадёт в лог и в админскую очередь вместо тихой порчи. (2) Сделать компенсирующий UPDATE условным — `WHERE id = $1 AND state = 'PENDING_FULFILL'` с проверкой count: если count = 0, значит транзакция на самом деле закоммитилась, и трогать строку нельзя. Это тот же приём, которым проект защищает деньги (`redeemedAt IS NULL` в WHERE), не применённый к собственной служебной записи. (3) Перед выходом в сеть в фазе B добавить явную ветку `unique_code IS NULL` → `BLOCKED_INPUT/CODE_LOST` с тикетом, а не молчаливый запрос с литералом «null» — сейчас у клиента нет ни одной проверки на это.

### Р2-17. [ВАЖНО] [деньги] Ключ дедупликации возврата (payment_id, 'dgs:inv:{inv}:refund') не содержит суммы, а проигравший гонку «не выполняет реакцию вовсе». Ручной ЧАСТИЧНЫЙ возврат навсегда занимает единственный слот провайдерского возврата и глушит последующий реальный полный.

**Сценарий.** Покупатель договорился о частичном возврате. Админ открывает форму по DIGISELLER-платежу, оставляет вариант по умолчанию «возврат проведён на площадке» (проект прямо делает его дефолтным) и вводит 30% с amountConfidence = REPORTED. Ключ строки — 'dgs:inv:{inv}:refund'. refundedAmount = 30%, payment PARTIALLY_REFUNDED, лицензии живые — пока корректно. Через час площадка проводит возврат полностью (invoice_state — один бит, суммы она не сообщает, что проект признаёт сам). Поллер пишет событие, дренаж на шаге 1 делает refunds.createMany({skipDuplicates:true}) с ТЕМ ЖЕ ключом → count = 0 → по правилу «проигравший не создаёт вторую строку и не выполняет реакцию вовсе» переход сразу к шагу 8. Итог: в книге возвращено 30%, фактически возвращено 100%, payment остался PARTIALLY_REFUNDED, лицензии не отозваны, покупатель бесплатно пользуется продуктом. Ни один контроль этого не видит: сверка sum(refunds.amount) против payments.refunded_amount совпадает (обе величины 30%). Проект описывает только зеркальный порядок (поллер первым с ASSUMED_FULL, админ вторым — корректировка), а этот не рассматривает.

**Правка.** Считать провайдерский факт неисчерпанным, пока amountConfidence='REPORTED' не подтверждён: при count=0 сверять сумму выигравшей строки с payment.amount и, если она меньше, доводить до полной корректировкой той же строки (increment) плюс дозапуск реакции отзыва, с аудитом refund.amount_upgraded. Либо запретить админу вводить частичную сумму с признаком «проведён на площадке» до появления провайдерского факта.

**Доказательство.** §9, таблица external_ref и абзац «Проигравший гонку (count = 0) не создаёт вторую строку и не выполняет реакцию вовсе»; §9 «Частичный возврат… частичный вводит человек (REPORTED)».

### Р2-18. [ВАЖНО] [деньги] Ни одна колонка не хранит фактически возвращённую площадкой сумму: refunds.amount — наш прайс. Суточная сверка (Д30) в возвратной части тавтологична, а в платёжной арифметически бессмысленна, поэтому расхождение книги с реальностью не детектируется.

**Сценарий.** Покупка по promo_code: наш прайс 1000 RUB, площадка получила 500 RUB (проект прямо отказывается от гейта по сумме именно потому, что промокоды штатны). Payment.amount = 1000 (наш прайс), provider_amount = 500. Площадка возвращает покупателю 500. Поллер пишет refunds.amount = payment.amount = 1000, ASSUMED_FULL. В книге возвращено 1000 при фактических 500 — фантомные 500 на каждой акционной покупке. Контроли не срабатывают: (1) sum(refunds.amount) против payments.refunded_amount совпадает по построению — шаг 2 дренажа поддерживает refunded_amount как сумму строк refunds, то есть сверяются две записи одного и того же числа; (2) sum(payments.provider_amount) складывает провайдерские суммы в разных валютах (RUB, USD, EUR, UAH, BTC, WMT — mapCurrency допускает все шесть) в одно число, поэтому 10 рублёвых продаж и одна WMX-продажа дают 10000.00042, что не сверяется ни с какой выпиской; (3) та же сумма — брутто, а выписка нетто, и возвраты из неё не вычитаются, потому что провайдерской суммы возврата нет вовсе, — значит расхождение будет ненулевым каждый день и контроль превратится в постоянный ложный сигнал.

**Правка.** Завести refunds.providerAmount Decimal(24,8) + providerCurrency VarChar(8) (при ASSUMED_FULL — payment.provider_amount/provider_currency) и сверять с выпиской именно их, с группировкой по валюте. Возвратную ветку сверки заменить на сверку с выпиской, а тождество sum(refunds)=refunded_amount оставить как отдельный ассерт целостности, не выдавая его за финансовый контроль.

**Доказательство.** §8 «Payment.amount/currency = ТО ЖЕ, что у заказа», §9 «поллер способен породить только полный (amount = payment.amount, ASSUMED_FULL)», §12 refunds без провайдерских колонок; решение по ШОВ 14 и §13 reconciliation.processor.

### Р2-19. [ВАЖНО] [деньги] Д25 закрыт только на payments. На digiseller_orders остались amount Decimal(12,2) и currency VarChar(3), preflight при этом явно пропускает валюты длиной до 8 символов, и проект нигде не говорит, кто и что пишет в сумму сделки.

**Сценарий.** Покупка в WMX. Preflight проверяет валюту регуляркой ^[A-Z]{2,8}$ и пропускает её. Далее из проверенного ответа площадки создаётся строка digiseller_orders — проект перечисляет правки этой таблицы исчерпывающе (code_hash, inv_id, provider_invoice_state, deliver_*, next_poll_at и т.д.) и amount/currency не трогает, оставляя их прежними: schema.prisma:1122 amount Decimal(12,2), schema.prisma:1123 currency VarChar(3). Если реализатор запишет туда сумму площадки (что естественно для строки, названной «код C — реальная покупка, счёт inv», и ровно так делал черновик), 0.00042 BTC снова станет 0.00 — то есть Д25 воспроизведён в другой колонке; а любой пропущенный preflight-ом четырёх-восьмисимвольный код валюты даст 22001 на вставке сделки, то есть до создания claim-овой сделки, из-за чего claim будет вечно повторять проверку и жечь UC до STALLED, а заплативший покупатель не получит ничего. Если же колонки не пишутся, они остаются мёртвыми полями в денежной таблице — но проект и этого не фиксирует.

**Правка.** В миграции либо расширить digiseller_orders.amount до Decimal(24,8) и currency до VarChar(8) симметрично payments.provider_*, либо удалить обе колонки и записать в CLAUDE.md модуля, что сумма площадки живёт только в payments.provider_amount/provider_currency и в raw_payload. Заодно сузить preflight-регулярку до фактически допустимой длины хранения.

**Доказательство.** apps/api/prisma/schema.prisma:1122-1123; §2 п.6 preflight ^[A-Z]{2,8}$; §12, список правок digiseller_orders.

### Р2-20. [ВАЖНО] [внешний-отказ] Deliver-процессор вводит терминал GIVEN_UP, достижимый ОДНОЙ ЛИШЬ недоступностью площадки, без автоповтора и без единого эндпоинта возврата в работу — тот самый класс дефекта, который для claim объявлен закрытым навсегда.

**Сценарий.** Площадка лежит дольше календарного горизонта deliver (значение вообще не заведено в settings). Все сделки, погашенные до аварии, уходят в GIVEN_UP: CHECK «терминал ⇔ next_deliver_at IS NULL» гарантирует, что строка больше НИКОГДА не будет взята процессором. Площадка возвращается — а мы ей так и не сообщили о доставке: unique_code_state остаётся 1/5, покупателю в кабинете площадки доступна кнопка «товар не получен», деньги на холде уходят в возврат, лицензия у нас выдана. Восстановление невозможно интерфейсом: в таблице эндпоинтов есть resolve/close только для claim (`/queue/claims/:claimId/...`), для строк digiseller_orders (deliver GIVEN_UP/DENIED, ORPHANED_DEAL, ACCOUNTING_ANOMALY, DISPUTED) и для застрявших digiseller_events нет ни одного POST — лечится UPDATE'ом в проде, ровно тем, что Д21 назвал недопустимым.

**Правка.** GIVEN_UP сделать не терминалом, а суточной медленной полосой (как STALLED у claim), либо завести POST /queue/deals/:dealId/redeliver и /queue/events/:eventId/retry под тем же правом billing.digiseller.operate. Значение deliver-горизонта вынести в settings. Тест: авария площадки длиннее горизонта → после восстановления deliver_notified_at заполняется без ручного вмешательства.

**Доказательство.** Проект §11: «сеть/HTML/неизвестный — бэкофф с потолком; календарный горизонт → GIVEN_UP в админскую очередь», CHECK ((deliver_state IN ('DELIVERED','DENIED','CODE_REJECTED','GIVEN_UP')) = (next_deliver_at IS NULL)); §15: очередь GET перечисляет deliver GIVEN_UP/DENIED и ORPHANED_DEAL, а POST-эндпоинты заведены только для claims и fingerprints. Одновременно про claim заявлено: «Ни сетевой сбой, ни 5xx, ни HTML от DDoS-Guard… не ведут в терминал НИКОГДА».

### Р2-21. [ВАЖНО] [внешний-отказ] Capability-состояние DENIED односторонне: обратного перехода в OK/UNKNOWN нет ни автоматического, ни ручного, а источником DENIED может быть чужой 403 от DDoS-Guard — одна ошибка WAF выключает продажи навсегда.

**Сценарий.** DDoS-Guard перед api.digiseller.com отдаёт нам HTTP 403 с HTML-страницей челленджа (штатное поведение защиты, которое сам проект ожидает: «DDoS-Guard отдаёт HTML при HTTP 200» — 403 тем более). Правило проекта: «в DENIED переводит только права-ошибка от самого метода (HTTP 403 либо документированный retval -5)». Отличить 403 площадки от 403 защиты нечем — тела у них разные, но правило сформулировано по коду. Capability view_invoice уходит в DENIED, и с этого момента redeem отдаёт 503 ВСЕМ покупателям. Выхода нет: POST /health/reset по описанию сбрасывает breaker и отрицательный кеш, capability в списке нет; автоматической пробы (аналога half-open) для capability не предусмотрено; где вообще живёт это состояние — в Redis или в памяти — не сказано, то есть даже перезапуск как лекарство не гарантирован. Зеркально: -5 у deliver навсегда гасит deliver-процессор, и после того как продавец выдал право content_change в кабинете, ничего не включится само.

**Правка.** Сделать DENIED «залипающим, но проверяемым»: пробный вызов раз в capability_probe_sec (по образцу half-open breaker'а), первый успех переводит в OK; добавить capability в POST /health/reset; переводить в DENIED только при 403 с распознанным JSON площадки, 403 с text/html классифицировать как RETRYABLE. Тест: 403 с HTML → redeem продолжает работать, capability не меняется.

**Доказательство.** Проект §7: «Для каждого из трёх каналов состояние UNKNOWN → OK / DENIED; в DENIED переводит только права-ошибка от самого метода (HTTP 403 либо документированный retval -5 у deliver)» — стрелки из DENIED нет; §15: «POST /health/reset — сброс breaker и отрицательного кеша (Д26)»; §16 требует проверять Content-Type до парсинга, но классификация 403 идёт по статусу.

### Р2-22. [ВАЖНО] [внешний-отказ] Бэкофф «НАШЕГО отказа» (60 с, потолок 5 мин) короче сетевого (потолок 15 мин) и сбрасывает его, поэтому деградация собственной инфраструктуры УТРАИВАЕТ частоту тиков; плюс при открытом breaker'е строка не берётся и next_attempt_at не двигается вовсе, а размера пачки у claim-процессора нет.

**Сценарий.** Площадка недоступна сутки, к третьему часу накоплено 3000 claim, бюджет BACKGROUND насыщен. Строка получает попеременно то сетевой отказ (ставит +15 мин), то отказ бакета (ставит +60 с…5 мин и обнуляет эффективную выдержку). Установившийся режим — тик каждые 1-5 минут вместо каждых 15: то есть чем нам хуже, тем чаще мы дёргаем сами себя. Каждый тик — это UPDATE лизинга плюс UPDATE бэкоффа, 3000 строк × 12 в час = 36 000 транзакций в час на реплику, при том что полезной работы ноль. Параллельно вторая ветка: при ОТКРЫТОМ breaker'е по проекту «строка не берётся вовсе», то есть next_attempt_at не сдвигается, и запрос воркера `WHERE next_attempt_at <= now()` каждые 15 секунд возвращает ВЕСЬ накопленный backlog — ограничителя пачки нет (poll_batch_size заведён только для поллера). Четыре раза в минуту на каждой реплике вычитывается и выбрасывается многотысячная выборка.

**Правка.** Бэкофф хранить как единый next_attempt_at и НИКОГДА не уменьшать его при отказе своей стороны (брать max(текущий, ладдер отказа)); потолок «нашего» бэкоффа поднять минимум до сетевого. При открытом breaker'е строку всё же лизировать и сдвигать next_attempt_at на breaker_probe_sec. Завести claim_batch_size и явный ORDER BY next_attempt_at. Тест: 3000 просроченных claim при открытом breaker'е → не более N выборок и нулевой рост числа UPDATE'ов.

**Доказательство.** Проект, таблица бэкоффа: «сеть/5xx/HTML при закрытом breaker | 30 с, 2 м, 5 м, потолок 15 мин» против «НАШ отказ (бакет, NOT_CONFIGURED, DECRYPT_FAILED, DENIED) | 60 с, потолок 5 мин»; там же «breaker ОТКРЫТ | строка не берётся вовсе»; в списке настроек есть digiseller.poll_batch_size и нет claim_batch_size, lease_sec, breaker_probe_sec, local_fallback_fraction.

### Р2-23. [ВАЖНО] [внешний-отказ] Потолок max_open_claims_per_user=3 считает PENDING_VERIFY, а во время аварии площадки ВСЕ claim именно в этом состоянии — поэтому потолок бьёт ровно тогда, когда обращений наверх и так нет, и обещание «предъявленный код не теряется» отменяется четвёртым кодом.

**Сценарий.** Площадка лежит сутки. Покупатель (или мелкий реселлер) гасит четыре купленных кода. Первые три создают claim в PENDING_VERIFY и там висят — площадка не отвечает. Четвёртый предъявленный код получает 429, и по явному правилу «строка НЕ создаётся». Код не записан нигде: интейк-вперёд, который в рисках назван смягчением единственного платёжного канала («предъявленный код не теряется и досчитывается воркером в течение 72 часов»), в аварии не работает. Дополнительный поворот: при открытом breaker'е строки вообще не берутся, то есть стоимость этих трёх claim у площадки РОВНО НОЛЬ — потолок, заведённый ради ограничения стоимости у третьей стороны, ограничивает то, что ничего не стоит.

**Правка.** Считать не строки, а израсходованный бюджет: потолок по sum(uc_spent) за окно, либо не учитывать claim, у которых последняя причина отказа — upstream/наша (upstream_refusals > 0 или stall_reason = UPSTREAM_UNREACHABLE), либо снимать потолок при открытом breaker'е. В любом случае при 429 строку claim создавать и ставить в очередь, а не терять код. Тест: площадка недоступна, пять кодов подряд от одного пользователя → пять claim, после восстановления пять лицензий.

**Доказательство.** Проект, переходы: «(нет строки) --активных claim >= max_open_claims_per_user--> 429, строка НЕ создаётся»; ШОВ 6-бис: «В потолок считаются ТОЛЬКО состояния, способные породить обращение наверх: PENDING_VERIFY и STALLED»; таблица бэкоффа: «breaker ОТКРЫТ | строка не берётся вовсе»; риски: «Интейк-вперёд смягчает — предъявленный код не теряется».

### Р2-24. [ВАЖНО] [контракт] Вторая половина Д25 закрыта только для payments. Миграция не трогает digiseller_orders.currency VarChar(3) и digiseller_orders.amount Decimal(12,2), хотя preflight сознательно пропускает валюту длиной до 8 символов, а сделка пишется РАНЬШЕ платежа.

**Сценарий.** Площадка отдаёт type_curr длиной 4+ (ровно тот случай, ради которого в проекте появилось VarChar(8) и регулярка ^[A-Z]{2,8}$ — например WMTZ или новый код 2026 года). Preflight пропускает значение, фаза B создаёт digiseller_orders с currency = 'WMTZ' → Postgres 22001 «value too long for type character varying(3)». Это НЕ денежная транзакция, ветки обработки нет, исключение уходит наверх; claim остаётся в PENDING_VERIFY, следующий тик снова идёт в площадку (каждая попытка — реальный UC и реальное обращение), и так 72 часа до STALLED. Покупатель заплатил, лицензии нет, в очереди — «непонятный отпечаток». Отдельно: для WMX сумма 0.00042 в digiseller_orders.amount Decimal(12,2) по-прежнему записывается как 0.00 — то есть колонка, которая существует и заполняется, продолжает врать, а проект перечисляет для digiseller_orders десяток новых колонок и про эти две не говорит ничего.

**Правка.** В той же миграции: digiseller_orders.currency → VarChar(8), amount → Decimal(24,8) (либо удалить обе как дубль rawPayload/payments.provider_*). Плюс schema-invariants.spec.ts должен вставлять сделку с восьмисимвольной валютой и суммой 0.00042 и утверждать, что значения сохранились без потерь.

**Доказательство.** apps/api/prisma/schema.prisma:1122-1123 — amount Decimal? @db.Decimal(12,2), currency String? @db.VarChar(3) в модели DigisellerOrder. Проект §12 «digiseller_orders:» перечисляет добавляемые/удаляемые колонки — currency и amount там не упомянуты; §2 п.6 гейт ^[A-Z]{2,8}$; §8 «VarChar(8) вместо VarChar(3) снимает и вторую половину Д25».

### Р2-25. [ВАЖНО] [контракт] Payment.method заполнить нечем: способ оплаты не возвращается методом unique-code (прямой факт документации), фаза C сети не имеет по инварианту модуля, а поллер purchase/info method не переносит. При этом фаза C передаёт method в payment.create как известную величину, а ТЗ-уточнение У-1 держится именно на этом поле.

**Сценарий.** Любая покупка через Digiseller. В фазе C доступен только raw_payload от unique-code, где способа оплаты нет; PaymentMethod имеет @default(OTHER), поэтому ошибки не будет — все платежи навсегда становятся OTHER. Следствие: уточнение У-1 («сущность CryptoPayments не создаётся — крипта это payments.method = CRYPTO») не выполняется ни в одном сценарии, то есть отменённое требование ТЗ п.1/п.17 о криптоплатежах не замещено ничем; виджет ТЗ п.18 по способам оплаты показывает 100% OTHER; при разборе спора «каким инструментом платили» ответа в БД нет. Поллинг purchase/info по этой же сделке идёт с первого часа и содержит buyer_info.payment_method и payment_aggregator, но шаг 8 дренажа обновляет только providerInvoiceState и refunded_at.

**Правка.** Парсер parsePurchaseInfo обязан извлекать buyer_info.payment_method/payment_aggregator, а первый успешный тик поллинга — обновлять payments.method (мэппинг строк площадки в enum с fallback OTHER и событием method_unmapped, потому что список значений площадкой не документирован). В фазе C method не передавать вовсе — пусть работает DB-default, иначе поле выглядит заполненным осмысленно.

**Доказательство.** docs/DIGISELLER-DESIGN.md:69-71 — «КОД ПОКУПКИ — способа оплаты в ответе НЕТ… нужен второй вызов GET /api/purchase/info/{invoice_id}: content.buyer_info.payment_method, payment_aggregator»; docs/TZ.md У-1 — «крипта это payments.method = CRYPTO»; apps/api/prisma/schema.prisma:1079 — method PaymentMethod @default(OTHER). Проект §3 шаг 3 передаёт method в payment.create; §9 шаг 8 method не пишет; §14 в PurchaseInfoVerdict способ оплаты не упомянут.

### Р2-26. [ВАЖНО] [контракт] Оба контроля, которыми объявлен закрытым Д30, невычислимы как описано: сверка идёт против неверного поля площадки, а порог «расхождение > X%» сравнивает суммы в разных валютах без единого источника курса.

**Сценарий.** (1) Ночная сверка сравнивает sum(payments.provider_amount) с выпиской. Если provider_amount = amount («сумма, зачисленная на счёт»), то выписка/выплата всегда меньше на комиссию площадки → расхождение возникает КАЖДУЮ ночь на любом объёме продаж, строка в админской очереди становится постоянной и её перестают читать через неделю. Если provider_amount = profit, то с ним нельзя сверять сумму возврата покупателю. Проект нигде не называет, какое из трёх полей (amount / amount_usd / profit) попадает в providerAmount. (2) Счётчик «покупок с расхождением > X% на пользователя за сутки» сравнивает сумму площадки в WMZ/WMR/WMX с plan.price в RUB. Курса нет ни в схеме, ни в настройках, ни в сигнатурах; для WMX (BTC) сравнение с рублёвым прайсом бессмысленно в принципе. Порог либо не реализуется, либо реализуется на несопоставимых числах и срабатывает на всех покупках подряд.

**Правка.** Зафиксировать в mapper'е три отдельные колонки/поля (provider_amount = amount, provider_amount_usd = amount_usd, provider_profit = profit) и сверять выписку именно с profit. Порог расхождения считать только внутри одной валюты — либо через amount_usd против прайса, приведённого к USD по явно заданному в settings курсу с датой, либо отказаться от порога и оставить только сверку. Иначе Д30 закрыт декларацией.

**Доказательство.** docs/DIGISELLER-DESIGN.md:65 — «Сумма → amount (зачислено вам) и amount_usd (сумма платежа в USD); profit — за вычетом комиссий» (подтверждено на живой документации: profit = «amount credited to your account (net of commissions)»). Проект §8 — «Payment.providerAmount … сумма и валюта площадки в её собственной точности», без указания поля; §12/ШОВ 14 — сверка sum(payments.provider_amount) с выпиской и порог «> X%»; mapCurrency отдаёт код валюты, но ни одной функции пересчёта в сигнатурах §14 нет.

### Р2-27. [ВАЖНО] [контракт] Утверждение «токен валиден на обоих хостах, перелогин не нужен» про oplata.info — недоказанная гарантия. Проверено было только совпадение бэкендов api.digiseller.ru и api.digiseller.com; oplata.info живыми запросами не проверялся ни разу.

**Сценарий.** api.digiseller.com отдаёт HTML от DDoS-Guard, breaker открывается, клиент уходит на oplata.info. Если токен там не принимается, ответ будет HTTP 400 {retval:-4,"неверно задан параметр token"} — то есть ровно тот конверт, который classifyUniqueCode обязан классифицировать как AUTH. Дальше срабатывает «на AUTH — принудительная инвалидация токена и релогин»: каждый запрос к резервному хосту выбрасывает рабочий токен основного и запускает apilogin. Failover, задуманный как смягчение аварии, превращает частичную недоступность в полную: токена нет ни у redeem, ни у deliver, полоса CONTROL забита, а причина в логах выглядит как «площадка не принимает наши учётные данные» (то есть как -1/невалидный ключ), что уводит дежурного не туда.

**Правка.** До релиза сделать один живой запрос unique-code на oplata.info с валидным токеном и записать результат в «Факты». В коде: на fallback-хосте вести ОТДЕЛЬНОЕ состояние токена и запретить инвалидацию основного токена по AUTH-ответу, пришедшему с fallback-хоста; при AUTH с fallback — сразу помечать failover как непригодный и оставаться на breaker'е.

**Доказательство.** docs/DIGISELLER-DESIGN.md:47 — «Проверено: https://api.digiseller.ru/api/apilogin отвечает корректным JSON и разделяет состояние с .com»; про oplata.info там же сказано только, что это «отдельно документирован резервный адрес именно для методов unique-code» — ни одной проверки токена. Проект §16: «Токен валиден на обоих хостах, перелогин не нужен».

### Р2-28. [ВАЖНО] [контракт] CLOCK_SUSPECT останавливает логины при штатной коррекции часов назад, хотя площадка требует уникальности timestamp, а не монотонности. Проект сам построил себе отказ авторизации на ровном месте.

**Сценарий.** NTP корректирует часы назад на 120 секунд (обычное дело после длительной работы ВМ или переезда на другой гипервизор). Теперь now < lastTs, и правило ts = max(now, lastTs+1) даёт значение на ~120 с впереди настенного времени, что больше ts_forward_cap = 60 с → «логины ОСТАНАВЛИВАЮТСЯ с CLOCK_SUSPECT». Текущий токен доживает максимум до valid_thru, после чего все методы отвечают 401, обновить токен нечем: redeem уходит в 503/бесконечный PENDING, поллинг возвратов встаёт, deliver встаёт. Продажи стоят до ручного вмешательства — при полностью исправной площадке, которая приняла бы ts = now без единого возражения, потому что это значение ни разу не использовалось (и Redis-маркер digiseller:apilogin:ts:{ts} NX это же и подтверждает).

**Правка.** Источником уникальности сделать маркер занятости, а не монотонность: ts = now; если SET digiseller:apilogin:ts:{ts} NX не прошёл — пробовать ts+1, ts+2 … (не более ts_forward_cap шагов), а при часах, ушедших назад, спокойно переиспользовать незанятые значения из прошлого. CLOCK_SUSPECT оставить как WARN/health-признак, но не как стоп-кран единственного платёжного канала.

**Доказательство.** docs/DIGISELLER-DESIGN.md:29 — Swagger: timestamp «must be unique in each request», повтор даёт retval -4 «Не уникальный timestamp!»; требования монотонности в контракте нет. Проект §7: «ts не имеет права уйти вперёд настенного времени больше чем на ts_forward_cap = 60 с; если монотонная страховка потребовала бы большего … логины ОСТАНАВЛИВАЮТСЯ с CLOCK_SUSPECT».

### Р2-29. [МЕЛОЧЬ] [однократность] `resolve` с override `inv` не проверяет, что введённый номер счёта не принадлежит уже существующей сделке. Опечатка админа отдаёт покупку одного покупателя другому, и обе стороны остаются в согласованном с точки зрения инвариантов состоянии.

**Сценарий.** Claim A в `BLOCKED_INPUT/INV_UNPARSEABLE`: сделка не создана вообще (колонка `inv_id BIGINT NOT NULL` этого не позволяет), поэтому у claim A нет `digiseller_order_id`. Единственный описанный выход — «resolve с ручным вводом inv». Админ берёт номер счёта из кабинета продавца и промахивается цифрой, попав в inv соседней покупки — покупки покупателя B, который в этот момент ждёт в BLOCKED_UNMAPPED (его сделка создана, `redeemed_at IS NULL`, `payment_id IS NULL` — схема это разрешает намеренно). Claim A уходит в PENDING_FULFILL. Фаза C, шаг 1: `updateMany where { id: dealId, redeemedAt: null }` по сделке B → count = 1, потому что сделка B честно не погашена. Дальше выдаётся лицензия пользователю A по чужому счёту, платёж получает `external_id = invRef(inv_B)`. Когда админ заведёт тариф и claim B оживёт, шаг 1 даст count = 0 → «погасил другой» → `REJECTED(TAKEN_BY_OTHER)` → 404 «код неверен» покупателю B (почта не сверяется, см. дефект про Д20). Ни один инвариант из `invariants.helper.ts` не срабатывает: сделка одна, платёж один, заказ один, число лицензий равно quantity. Ни `UNIQUE(inv_id)`, ни `UNIQUE(code_hash)` не нарушены — code_hash сделки остался от B, и это единственный след. Проверки preflight 7 и 8 (коллизия code_hash / INV_CONFLICT) на пути ручного override не описаны вовсе, а сам автор объявил INV_CONFLICT «недостижимой веткой» и снял её с плана проверок.

**Правка.** Прогонять ручной override через ТОТ ЖЕ preflight, а не в обход него, и добавить к нему проверку, которой в автоматическом пути не нужно: при override `inv` отвергать операцию, если по этому inv уже есть сделка с ДРУГИМ `code_hash` (это и есть ветка INV_CONFLICT, объявленная недостижимой — на ручном пути она достижима и обязательна). Плюс запретить override, если найденная по inv сделка имеет живой claim другого пользователя. Форму resolve дополнить обязательным показом того, что мы нашли по введённому inv (id_goods, дата, маскированная почта покупателя) с явным подтверждением — админ обязан узнать чужую покупку до записи. И включить эту ветку в `digiseller-preflight.spec.ts`: сейчас там проверяется только успешный ручной ввод inv.

### Р2-30. [МЕЛОЧЬ] [деньги] Корректировка суммы возврата описана как операция «над ТОЙ ЖЕ строкой refunds», тогда как CHECK и вся логика статусов живут на payments.refunded_amount. Синхронность двух записей нигде не потребована.

**Сценарий.** Поллер записал ASSUMED_FULL на 1000 и отозвал лицензии. Админ выясняет, что площадка вернула 300, и делает корректировку: по тексту проекта это decrement суммы той же строки refunds «под тем же CHECK». Если реализатор поймёт это буквально и не тронет payments.refunded_amount, инвариант sum(refunds.amount) = payments.refunded_amount ломается молча (CHECK связывает только колонки одной строки payments и нарушения не заметит), payment остаётся REFUNDED вместо PARTIALLY_REFUNDED, а единственный ассерт целостности начинает срабатывать на каждой суточной сверке и быстро перестаёт читаться.

**Правка.** Явно записать корректировку как атомарную пару: refunds.amount decrement + payments.refundedAmount decrement на ту же дельту в одной транзакции, с последующим пересчётом статуса payment/order по агрегату и аудитом refund.amount_corrected.

**Доказательство.** §9, абзац «корректировка суммы ТОЙ ЖЕ строки через increment/decrement под тем же CHECK»; §12, CHECK (refunded_amount >= 0 AND refunded_amount <= amount).

### Р2-31. [МЕЛОЧЬ] [внешний-отказ] Не сказано, ходит ли интейк POST /redeem в сеть синхронно; из текста следуют оба ответа, и при «да» суточная авария площадки превращает каждый redeem в зависший на 10-31 с запрос и 504 вместо 202.

**Сценарий.** Проект пишет, что лизинг — «мьютекс между HTTP-путём и воркером», что полоса FAST обслуживает «только свежие claim покупателей», и что next_attempt_at = now + 30 с — «фора… как вежливость к латентности». Всё это читается как «интейк сам делает первый UC». Тогда при мёртвой площадке запрос ждёт DIGISELLER_TIMEOUT_MS = 10 000 мс, а с двумя разрешёнными ретраями идемпотентного GET (300/900 мс джиттер) — до ~31 с, что больше proxy_read_timeout 30 s: покупатель получает 504, claimId в ответе не приходит, а отдельного «списка моих claim» в API нет — единственный способ вернуть себе claimId — снова ввести код. Плюс на каждый висящий redeem занят обработчик и, если он открывал транзакцию/соединение, — коннект пула.

**Правка.** Записать инвариантом рядом с «нет HTTP при открытой транзакции»: интейк НИКОГДА не обращается к площадке; 202 отдаётся сразу после INSERT claim, первый UC делает воркер. Тест: площадка не резолвится → p99 POST /redeem < 300 мс и всегда 202. Отдельно завести GET /claims (свои, постранично), чтобы потерянный ответ не был единственным ключом к вердикту.

**Доказательство.** Проект §1 (лизинг как мьютекс с HTTP-путём), §6 (FAST — «только свежие claim покупателей»), §16 (ретраи только для идемпотентных GET, макс 2, 300/900 мс), §12 (DIGISELLER_TIMEOUT_MS=10000); C:/Users/user/work/kwork/license-platform/docker/nginx/templates/default.conf.template:211 (proxy_read_timeout 30s); таблица эндпоинтов не содержит GET списка claim пользователя.

### Р2-32. [МЕЛОЧЬ] [контракт] Формат-гейт отвергает коды «вне charset», хотя алфавит unique_code документацией не задан вообще — задана только длина 16. Отказ при этом безследный: 400 без создания claim, без записи, без админской очереди.

**Сценарий.** Площадка выдаёт код, содержащий символ, не попавший в нашу (нигде не описанную и не вынесенную в settings) регулярку — дефис, подчёркивание, кириллицу, что угодно. Покупатель, который реально заплатил, получает 400 CODE_MALFORMED. Строка claim не создаётся («строка НЕ создаётся» — §1), в дешёвый счётчик malformed уходит инкремент, в очередь не уходит ничего. Ни один из заведённых детекторов (STALLED, BLOCKED_*, ORPHANED_DEAL) такого покупателя не показывает: с точки зрения системы его не было. Диагностика возможна только по nginx-логу, где кода нет по построению (Д27).

**Правка.** Гейт ограничить длиной 16 после normalizeCode. Если алфавит всё же нужен — вынести в settings (digiseller.code_charset) с дефолтом «любые непробельные печатные», а каждый отказ формат-гейта писать счётчиком по конкретной причине в health, чтобы «мы сами отвергли валидный код» было видно без разбора инцидента.

**Доказательство.** docs/DIGISELLER-DESIGN.md:53 — «unique_code — строка ровно из 16 символов» и больше ничего о составе; проект §15/§17 — «три кода длиной 15/17/вне charset → 400,400,400», при этом в списке настроек §12 никакого параметра алфавита нет.

### Р2-33. [МЕЛОЧЬ] [контракт] unique_code_state = 5 трактуется как «наш дефект недозвона deliver, алерт», хотя по контракту это штатное промежуточное состояние между нашей проверкой кода и нашим PUT .../deliver.

**Сценарий.** Покупка исполнена в 12:00:10, deliver-процессор тикает раз в 60 с, поллер — раз в 15 минут для сделок младше суток. Если тик поллера попадает в окно до успешного deliver (а также всегда, когда deliver ушёл в GIVEN_UP по сети или в DENIED из-за отсутствия content_change), purchase/info честно вернёт state = 5, и по таблице §8 будет записано событие dgs:inv:{inv}:code_state:5 и поднят алерт «наш дефект». На части нормальных сделок админ получает ложное срабатывание, а при отключённом deliver-канале — по одному ложному алерту на каждую продажу.

**Правка.** Алерт по state=5 поднимать только при deliver_state ∈ {DELIVERED} (реальное расхождение) или при возрасте сделки больше N × интервала deliver-процессора; при deliver_state ∈ {PENDING, DENIED, GIVEN_UP} состояние 5 — ожидаемое, и сигнал уже выражен самим deliver_state.

**Доказательство.** docs/DIGISELLER-DESIGN.md:77 — «5 — уникальный код проверен, товар не доставлен»; там же:95 — deliver зовётся только ПОСЛЕ успешной проверки кода (retval 3 = «код ещё не был проверен»). Проект §8: «5 — наш дефект недозвона deliver, алерт»; §11 — deliver-процессор @Interval(60_000), §10 — поллинг 15 минут.

### Р2-34. [МЕЛОЧЬ] [контракт] Ключ события строится из необязательного поля без тотального парсера — тот же класс, что Д1 (String(undefined)), для inv закрытый функцией parseInv, а для состояний не закрытый ничем. Плюс в обязательных требованиях к HTTP-клиенту не назван заголовок Accept, документированный площадкой.

**Сценарий.** (1) Поле unique_code_state в ответе документировано как необязательное и может отсутствовать. Ключ dgs:inv:{inv}:code_state:${m} при m = undefined даёт валидную строку 'dgs:inv:123:code_state:undefined', которая один раз запишется как «факт», займёт место в дедупликации и попадёт в дренаж как событие неизвестного типа; сигнатуры §14 не содержат ни одной функции разбора состояний (в отличие от parseInv/resolveQuantity). (2) Клиент §16 обязан проверять Content-Type до парсинга, но не обязан посылать Accept: application/json; при согласовании text/xml (ASP.NET-стек это умеет) Content-Type-гейт классифицирует КАЖДЫЙ ответ как RETRYABLE, и ни один claim никогда не дойдёт до вердикта — при формально исправной площадке.

**Правка.** Ввести parseState(raw): {ok,state:1..5} | {ok:false} и не писать событие при неразобранном состоянии (только WARN + response_fingerprint). В клиенте явно проставлять Accept: application/json на всех вызовах и добавить в digiseller-contract.spec.ts проверку заголовков исходящего запроса.

**Доказательство.** docs/DIGISELLER-DESIGN.md:77 — «Само поле unique_code_state помечено как необязательное — его может не быть в ответе»; там же:17,53,95 — «Заголовки: Content-Type: application/json + Accept: application/json (альтернатива text/xml)». Проект §9 — externalId `dgs:inv:${inv}:invoice_state:${n}` либо `:code_state:${m}`; §14 — парсера состояний нет; §16 — список обязательных требований клиента без Accept.

---

## Промежуточные переработки (для контекста)

### Жизненный цикл погашения кода Digiseller — переработка

# Жизненный цикл погашения кода: переработка

## 0. Корневая причина, из-за которой черновик развалился

В черновике ОДНА строка `digiseller_orders` несёт два несовместимых смысла:
«кто-то предъявил эту строку символов» (попытка — их много на код и много на пользователя)
и «этот код израсходован ровно один раз» (факт уровня кода — он один).
Из этого совмещения механически следуют Д9 (захват до проверки владельца),
Д4/Д8 (карантинную запись блокирует тот самый индекс, который вызвал коллизию),
Д29 (свой же код в другом регистре = тикет), Д2 (VERIFIED — состояние процесса,
записанное в таблицу факта), Д19 (409 заплатившему).

**Решение: расщепить на две сущности.**

| | `digiseller_claims` (НОВАЯ) — попытка | `digiseller_orders` (существующая) — сделка |
|---|---|---|
| смысл | «пользователь U предъявил код C» | «код C — реальная покупка площадки, счёт inv» |
| кардинальность | N на код, 1 на (код, пользователь) | ровно 1 на код |
| когда создаётся | ДО сети, после формат-гейта и лимитов | ТОЛЬКО после успешной проверки у площадки |
| несёт | state, счётчики, next_attempt_at, escalate_at, тикет, ошибку | inv, id_goods, email, rawPayload, verifiedAt, redeemedAt, paymentId |
| уникальность | `(code_hash, claimed_by_user_id)` — идемпотентность на пользователя | `code_hash`, `inv_id` — однократность выдачи |

`code_hash = sha256(lower(normalizeCode(code)))`. Литерал кода лежит в claim
(он нужен, чтобы задать вопрос площадке) и в сделке (для поддержки), но
уникальным не является ни там, ни там.

Что это даёт сразу, без единой дополнительной строки логики:
- **захвата нет** — уникален не код, а пара (код, пользователь); посторонний
  создаёт СВОЮ строку и никому не мешает (Д9);
- **`CODE_CASE_COLLISION` как понятие исчезает** — регистровые варианты одного
  кода у одного человека схлопываются в одну claim-строку (хеш по lower),
  а у разных людей это просто две независимые попытки; писать карантин больше
  некуда и незачем (Д4, Д8, Д29);
- **повтор исполнения не ходит в сеть** — проверенный ответ площадки durable
  лежит в сделке, поэтому откат фазы C переигрывается по БД, ноль обращений
  наверх; горячий цикл Д7 обесточен в корне;
- **`inv_id` становится `NOT NULL`** — сделка не создаётся спекулятивно, значит
  «сколько угодно NULL под UNIQUE» из Д1 закрыто типом колонки, а не соглашением.

## 1. Состояния claim и кто их забирает (требование 1)

Enum `DigisellerClaimState` — 8 значений, терминальных ровно 2, оба по существу.
Удалены: `VERIFIED`, `FAILED_PERMANENT`, `QUARANTINED`, `REFUND_PENDING`,
`REFUNDED` (последние два — состояния СДЕЛКИ, не попытки).

**Структурная гарантия отсутствия тупиков — констрейнт, а не дисциплина:**

```sql
CHECK ( (state IN ('FULFILLED','REJECTED')) = (next_attempt_at IS NULL) )
CHECK ( state <> 'REJECTED' OR reject_reason IS NOT NULL )
CREATE INDEX digiseller_claims_due_idx
  ON digiseller_claims (next_attempt_at) WHERE next_attempt_at IS NOT NULL;
```

Состояние без забирающего физически непредставимо в БД: либо оно терминально,
либо у него есть `next_attempt_at`, и тогда его видит единственный воркер
`digiseller-claim.processor` по единственному индексу. Тупик уровня Д2 больше
не «забыли покрыть» — он не проходит INSERT.

| Состояние | Кто продвигает | По какому индексу | Что при отказе |
|---|---|---|---|
| `PENDING_VERIFY` | HTTP-путь inline + `digiseller-claim.processor` | `(next_attempt_at) WHERE NOT NULL` | лизинг УЖЕ сдвинул время; ответ площадки не-терминальный → `verify_attempts+1`, `undecidable_streak+1`, бэкофф по причине; отказ НАШЕЙ стороны (breaker/бакет/`NOT_CONFIGURED`) → `upstream_refusals+1`, бэкофф, `verify_attempts` НЕ трогается; `now() > escalate_at` → `STALLED` |
| `AWAITING_OWNER` | тот же процессор | тот же | грейс продлевается; `now() > escalate_at` → `STALLED(OWNERSHIP_CONTESTED)` |
| `PENDING_FULFILL` | HTTP-путь inline + тот же процессор, **сети нет вообще** | тот же | `fulfill_attempts+1`, экспонента с потолком 15 мин; детерминированная ошибка → `BLOCKED_INPUT`; сделка занята другим → `FULFILLED`/`REJECTED(TAKEN_BY_OTHER)`; `now() > escalate_at` → `STALLED` |
| `BLOCKED_UNMAPPED` | тот же процессор — переразрешает тариф раз в `unmapped_recheck_sec` (600) + админ | `(next_attempt_at)` + `(state, created_at)` для очереди | тариф всё ещё не заведён → `next_attempt_at += 10 мин`, бесконечно; возраст > `unmapped_alert_hours` (2) → алерт + degraded health. **Терминала нет** |
| `BLOCKED_INPUT` | админ через `POST /quarantine/:id/resolve` с override; процессор — суточный тик переалерта | `(state, created_at)` | переалерт раз в сутки, чтобы очередь нельзя было молча забыть. **Терминала нет** |
| `STALLED` | тот же процессор на медленной полосе (6 ч) + админ + сам покупатель кнопкой «повторить» | `(next_attempt_at) WHERE NOT NULL` | остаётся `STALLED`, бэкофф 6 ч; при открытом breaker строка вообще не берётся и бюджет не тратит |
| `FULFILLED` | никто — **терминал по существу**: лицензия выдана | — | — |
| `REJECTED` | никто — **терминал по существу**: кода не существует / погашен другим / решение админа | — | — |

Сделка (`digiseller_orders`) тоже не имеет тупика: строка
`verified_at IS NOT NULL AND redeemed_at IS NULL`, у которой не осталось ни
одного живого claim и возраст > 24 ч, забирается свипером
`digiseller-orphan.processor` по частичному индексу
`(created_at) WHERE redeemed_at IS NULL` и уходит в админскую очередь как
`ORPHANED_DEAL` — это детектор «деньги у площадки, покупка подтверждена,
лицензии нет ни у кого».

## 2. Терминальность (требование 2)

Терминальны ровно два состояния, и оба выражают решение по существу:
- `FULFILLED` — выдача состоялась;
- `REJECTED` с `reject_reason ∈ {CODE_INVALID, TAKEN_BY_OTHER, ADMIN_CLOSED, PRODUCT_WITHDRAWN}`.

`CODE_INVALID` достижим ТОЛЬКО из документированного терминального вердикта
площадки. Поскольку у `searchuniquecode` документирован один-единственный
retval=0 (раздел «Факты»), список терминальных retval вынесен в настройку
`digiseller.reject_retvals` со значением по умолчанию `[]`. До реальной тестовой
покупки (п.5 раздела владельца) автоматический REJECT просто не срабатывает —
и это правильно: ложный REJECT стоит чарджбека, ложное ожидание стоит тикета.
Ни сетевой сбой, ни 5xx, ни HTML от DDoS-Guard, ни открытый breaker, ни
исчерпанный бакет, ни `NOT_CONFIGURED`, ни `DECRYPT_FAILED` не ведут в
терминал НИКОГДА — они ведут в `STALLED`, из которого есть три выхода
(автоповтор, админ, покупатель).

**`FAILED_PERMANENT` удалён из проекта.** Его роль занял `STALLED`, который:
в админской очереди, с автоповтором на медленной полосе, с самообслуживанием
покупателя, без единого пути в терминал без человеческого решения.

## 3. Горизонт повторов — календарный (требование 3)

Два независимых механизма, которые в черновике были склеены в один счётчик:

**Горизонт — календарь.** Колонка `escalate_at = created_at + digiseller.retry_horizon_hours`
(по умолчанию 72 ч, ТЗ У-1 закладывается на суточную недоступность).
`escalate_at` не убивает claim — он лишь переводит его в `STALLED`, то есть
меняет того, кто смотрит, а не исход. Числа попыток нет ни в одном условии
перехода; `verify_attempts`/`fulfill_attempts`/`upstream_refusals` — диагностика
и вход в формулу бэкоффа, не более.

**Бэкофф — по ПРИЧИНЕ отказа**, и именно это снимает противоречие между Д3
(горизонт должен быть сутками) и Д12 (ретраи стоят обращений наверх):

| причина отказа | лестница | стоимость за 72 ч |
|---|---|---|
| площадка недоступна, breaker ОТКРЫТ | строка не берётся вообще, пока breaker открыт | ~0 обращений |
| площадка недоступна, breaker закрыт (сеть/5xx/HTML) | 30 с, 2 м, 5 м, 15 м, далее потолок 15 мин | ≤ ~290, но реально breaker срезает почти всё |
| ответ понят, но не классифицируется (`undecidable_streak`) | после 5 подряд потолок → 1 ч, после 12 → 6 ч | ~15–20 |
| отказ НАШЕЙ стороны (бакет, `NOT_CONFIGURED`) | 60 с, потолок 5 мин, `verify_attempts` не растёт | дешёво, наверх не ходит |
| отказ исполнения (фаза C) | 5 с, 30 с, 2 м, потолок 15 мин | **0 обращений наверх** — сети в фазе C нет |
| `STALLED` | ровно 6 ч, бесконечно, под breaker-гейтом | ≤ 12 |

Мусорный код обходится примерно в 15 обращений за трое суток, а код, застрявший
из-за суточного падения площадки, — почти в ноль и оживает сам в момент
восстановления.

**Против горячего цикла — лизинг, а не дисциплина (Д7).** Процессор сначала
делает `UPDATE ... SET next_attempt_at = now() + lease_sec, leased_until = now() + lease_sec
WHERE id = ? AND next_attempt_at <= now()` и работает только при `count = 1`.
Время сдвинуто ДО начала работы, поэтому падение процесса, исключение до `try`,
откат транзакции или забытая ветка стоят максимум одного лизинга, а не
240 запросов в час. Тот же лизинг служит мьютексом между HTTP-путём и
воркером — гонка из Д19 исключена конструкцией, а не «форой в 30 секунд»
(фора остаётся, но как вежливость к латентности, а не как корректность).

## 4. Однократность без захвата (требование 4)

Пять слоёв, и ни один из них не привязывает код к первому предъявителю:

1. **`@@unique([code_hash, claimed_by_user_id])` на claim** — идемпотентность на
   пользователя. Повтор формы, F5, регистровый вариант — та же строка, тот же
   ответ. Это НЕ эксклюзивность: у другого пользователя своя строка.
2. **`UNIQUE(code_hash)` на сделке**, вставка через `ON CONFLICT DO NOTHING` +
   перечитывание. Сделка создаётся только из проверенного ответа площадки,
   то есть только когда уже известно, кому код принадлежит (`buyerEmail` в ответе).
   P2002 наружу не выходит никогда.
3. **`redeemedAt IS NULL` в WHERE самого UPDATE + проверка count** — эталон
   проекта, `registration-key.service.ts:255-265`. Победитель забирает,
   проигравший перечитывает и отвечает по существу, а не голой 409-кой.
4. **`inv_id BigInt NOT NULL @unique`** + `CHECK (inv_id > 0)` + на платежах
   `CHECK (provider <> 'DIGISELLER' OR external_id ~ '^[0-9]+$')`. `inv`
   валидируется в preflight ДО открытия транзакции.
5. **Условный `PAID → DELIVERED`** с assert count=1 в той же транзакции.

**Владение выясняется при верификации, и только тогда возникает приоритет.**
`email_match = (user.emailVerifiedAt IS NOT NULL AND lower(user.email) = lower(deal.buyerEmail))`.
Неподтверждённая почта совпадением не считается — иначе владение крадётся
сменой email в профиле.

- `email_match = true` → сразу `PENDING_FULFILL`.
- `email_match = false` и других живых claim на этот `code_hash` нет →
  сразу `PENDING_FULFILL` (решение №20 `require_email_match=false` сохранено:
  платить с другого адреса — норма), расхождение пишется в аудит.
- `email_match = false` и есть живой claim другого пользователя →
  `AWAITING_OWNER` на `digiseller.owner_grace_sec` (900). Плюс жёсткое правило:
  **несовпадающий заявитель не исполняется, пока существует НЕтерминальный
  claim с `email_match = true`** — совпадение почты выигрывает независимо от
  порядка прихода.

Позднему настоящему покупателю, чей код уже погасил посторонний, ответ не
лживый: если его подтверждённая почта равна `deal.buyerEmail` — 409
`CODE_TAKEN_BY_OTHER` с тикетом и уликой в аудите (обоими user id и sha256
кода). Оракула это не создаёт: чтобы получить 409, надо уже владеть почтой
реальной сделки (закрывает Д20).

**Ответ определён для КАЖДОГО состояния — «ветки не определено вовсе» из Д2 больше нет:**

| состояние claim | `POST /redeem` и `GET .../status` |
|---|---|
| `PENDING_VERIFY` / `AWAITING_OWNER` / `PENDING_FULFILL` | 202 `PENDING`, `retryAfterSec`, `claimId` |
| `BLOCKED_UNMAPPED` / `BLOCKED_INPUT` / `STALLED` | 202 `ACCEPTED_DELAYED`, `claimId` как номер обращения; для `STALLED` — ещё и признак `canRetry` |
| `FULFILLED` | **200** + `orderNumber` + `licenseKeys`, перечитанные по `orderId` |
| `REJECTED(CODE_INVALID)` и `REJECTED(TAKEN_BY_OTHER)` | 404 `CODE_INVALID`, **побайтово одинаковый конверт** |
| `REJECTED(TAKEN_BY_OTHER)` при подтверждённом совпадении почты | 409 `CODE_TAKEN_BY_OTHER` + тикет |
| `REJECTED(ADMIN_CLOSED / PRODUCT_WITHDRAWN)` | 409 с текстом обращения |

Ни `ConflictException` из шага 1 фазы C, ни P2002 не доходят до покупателя на
денежном пути ни в одной ветке (Д19).

Это же расщепление даёт анти-оракулу опору, которой у него не было (Д16, Д28):
«кода не существует» и «код погашен другим» теперь идут по ОДНОМУ пути —
оба создают claim, оба отвечают 202 при первом предъявлении, оба приходят к
терминалу через тот же автомат. Мгновенного 404 из БД против медленного 202
из сети больше нет структурно. Финальная выравнивающая задержка — зона узла
злоупотреблений, но лестница состояний ей больше не мешает.

## 5. «Товар не сопоставлен ни с одним тарифом» (требование 5)

Это НАША операционная ошибка. Покупатель не виноват, деньги у площадки,
код настоящий и проверен. Правило: **`redeemedAt` в этой ветке не ставится
никогда** (прямое требование раздела «Факты», строка про схему: иначе покупатель
заплатил, товар не смапен, и повторить он уже не сможет).

**Preflight — до открытия денежной транзакции, сразу после успешного `classify()`.**
Всё, что не лечится временем, обязано быть выяснено здесь, а не внутри транзакции:

1. `inv` → целое > 0, иначе `BLOCKED_INPUT / INV_UNPARSEABLE` (Д1).
2. `id_goods` присутствует и целое, иначе `BLOCKED_INPUT / GOODS_ID_MISSING`.
3. `plan = licensePlan.findUnique({ digisellerProductId: id_goods })`.
   `plan === null` → `BLOCKED_UNMAPPED / PRODUCT_UNMAPPED`.
   `plan.isActive === false` → `BLOCKED_UNMAPPED / PLAN_INACTIVE`
   (проверяем сами: `licenses.service.ts:71-81` тянет `isActive` в select и
   НЕ использует его — опираться на чужую проверку нельзя).
4. `productId` берётся из `plan.productId`, поэтому `PLAN_MISMATCH` внутри
   денежной транзакции невозможен в принципе (`licenses.service.ts:76-81`).
5. `cnt_goods`: целое `1..max_quantity` → quantity; `null`/`0`/отсутствует/
   не-число → 1; **дробное → `BLOCKED_INPUT / QUANTITY_FRACTIONAL`** (Д37);
   `> max` → `BLOCKED_INPUT / QUANTITY_OUT_OF_RANGE`.
6. валюта: длина > 3 → `BLOCKED_INPUT / CURRENCY_UNREPRESENTABLE` (иначе
   ошибка 22001 внутри транзакции и откат, Д25).
7. `code_hash` уже есть в сделках, но с ДРУГИМ `inv` → `BLOCKED_INPUT /
   CODE_HASH_COLLISION` с обоими payload — это единственный настоящий остаток
   вопроса о регистрозависимости, и он записываем, потому что claim-таблицу
   ничто не блокирует.

**Что происходит с покупателем в `BLOCKED_UNMAPPED`:**
- 202 `ACCEPTED_DELAYED` + номер обращения. Формулировка честная: «оплата
  подтверждена, выдача задержана на нашей стороне». Не 404, не 400, не «неверный код».
- разовое письмо по новому шаблону `order.delayed` (ru/en, EMAIL) в сид.
- сделка создаётся: `verifiedAt`, `invId`, `buyerEmail`, `digisellerProductId`,
  полный `rawPayload`, `paymentId = NULL`, `redeemedAt = NULL` — ровно то, что
  схема разрешает намеренно (`DigisellerOrder.paymentId` nullable).

**Что происходит у нас:**
- **самоизлечение, а не ручной resolve.** Процессор переразрешает тариф раз в
  10 минут. Как только админ проставил `digisellerProductId` и активировал
  тариф, ВСЕ ждущие claim по этому `id_goods` уходят в `PENDING_FULFILL` сами,
  без единого действия по каждому. `POST /quarantine/:id/resolve` остаётся как
  «проверить сейчас» (`next_attempt_at = now()`), а не как единственный путь.
  Именно этого сценария в черновике не существовало (Д5).
- админская очередь **группируется по `digisellerProductId`**: одна несмапленная
  позиция = один элемент очереди со счётчиком покупателей и возрастом старейшего
  claim, а не N одинаковых строк.
- уведомление админу — на ПЕРВОМ claim по данному `id_goods`, дальше только счётчик.
- эскалация: возраст > `unmapped_alert_hours` (2) → аудит-событие + degraded
  в `/billing/digiseller/health` (`unmapped_claims`, `oldest_unmapped_age_sec`).
- выход, если владелец решил товар не продавать: админ закрывает как
  `REJECTED(PRODUCT_WITHDRAWN)`, покупатель уведомляется, возврат делается
  вручную на площадке — `inv` и `email` у нас есть в сделке. Это решение
  человека по существу, поэтому терминал законен.

## 6. Полный список переходов, включая переходы из каждого состояния отказа

```
(нет строки) --формат-гейт ok, лимиты ok, лизинг--> PENDING_VERIFY
(нет строки) --формат-гейт fail--> 400, строка НЕ создаётся
(нет строки) --открытых claim у пользователя >= max_open_claims_per_user--> 429, строка НЕ создаётся

PENDING_VERIFY --вердикт OK, preflight ok, email_match--> PENDING_FULFILL
PENDING_VERIFY --вердикт OK, preflight ok, !email_match, оспорен--> AWAITING_OWNER
PENDING_VERIFY --вердикт OK, preflight ok, !email_match, не оспорен--> PENDING_FULFILL
PENDING_VERIFY --вердикт OK, сделка уже погашена мной--> FULFILLED
PENDING_VERIFY --вердикт OK, сделка погашена другим--> REJECTED(TAKEN_BY_OTHER)
PENDING_VERIFY --вердикт OK, preflight: тариф--> BLOCKED_UNMAPPED
PENDING_VERIFY --вердикт OK, preflight: inv/qty/currency/hash--> BLOCKED_INPUT
PENDING_VERIFY --вердикт REJECT (retval из digiseller.reject_retvals)--> REJECTED(CODE_INVALID)
PENDING_VERIFY --RETRYABLE / AUTH / undecidable--> PENDING_VERIFY (бэкофф по причине)
PENDING_VERIFY --наш отказ: breaker, бакет, NOT_CONFIGURED, DECRYPT_FAILED--> PENDING_VERIFY (бэкофф, verify_attempts НЕ растёт)
PENDING_VERIFY --now() > escalate_at--> STALLED(UPSTREAM_UNREACHABLE | UNDECIDABLE_RESPONSE | LOCAL_DEGRADED)

AWAITING_OWNER --грейс истёк, совпадающего claim нет--> PENDING_FULFILL
AWAITING_OWNER --появился живой claim с email_match--> AWAITING_OWNER (продление)
AWAITING_OWNER --сделку погасил другой--> REJECTED(TAKEN_BY_OTHER)
AWAITING_OWNER --now() > escalate_at--> STALLED(OWNERSHIP_CONTESTED)

PENDING_FULFILL --транзакция закоммичена--> FULFILLED           (переход пишется В ТОЙ ЖЕ транзакции)
PENDING_FULFILL --откат: таймаут/дедлок/пул/serialization--> PENDING_FULFILL (компенсирующий UPDATE, fulfill_attempts+1, бэкофф)
PENDING_FULFILL --откат: детерминированная ошибка данных--> BLOCKED_INPUT
PENDING_FULFILL --шаг 1 count=0, погасил я--> FULFILLED
PENDING_FULFILL --шаг 1 count=0, погасил другой--> REJECTED(TAKEN_BY_OTHER)
PENDING_FULFILL --now() > escalate_at--> STALLED

BLOCKED_UNMAPPED --тариф появился и активен--> PENDING_FULFILL   (автоматически, раз в 10 мин)
BLOCKED_UNMAPPED --админ: снять товар с продажи--> REJECTED(PRODUCT_WITHDRAWN)
BLOCKED_UNMAPPED --тика без изменений--> BLOCKED_UNMAPPED (+10 мин, алерт после 2 ч)

BLOCKED_INPUT --админ: resolve с override (quantity / inv / currency / выбранный тариф)--> PENDING_FULFILL
BLOCKED_INPUT --админ: закрыть--> REJECTED(ADMIN_CLOSED)
BLOCKED_INPUT --суточный тик--> BLOCKED_INPUT (переалерт)

STALLED --медленная полоса, площадка ответила OK--> ветвление как из PENDING_VERIFY
STALLED --покупатель нажал «повторить» (рейт-лимит отдельный)--> PENDING_VERIFY (next_attempt_at = now())
STALLED --админ: resolve--> PENDING_VERIFY (счётчики и escalate_at пересчитываются)
STALLED --админ: закрыть--> REJECTED(ADMIN_CLOSED)
STALLED --настроен digiseller.reject_retvals, ответ подошёл--> REJECTED(CODE_INVALID)
STALLED --иначе--> STALLED (+6 ч)

FULFILLED --> терминал (возврат живёт на СДЕЛКЕ и claim не переоткрывает)
REJECTED  --> терминал; чистка строк REJECTED(CODE_INVALID) старше claim_ttl_days (30) ночным job
```

## 7. Фаза C — ровно одна транзакция, сети нет, терминал claim внутри неё

1. `tx.digisellerOrder.updateMany({ where: { id: dealId, redeemedAt: null }, data: { redeemedAt, redeemedByUserId } })` → `count===0` → внутренний маркер `DEAL_TAKEN`, разбирается СНАРУЖИ, наружу не течёт.
2. `tx.order.create({ status: PAID, source: DIGISELLER, userId, productId: plan.productId, planId: plan.id, quantity, amount: plan.price × quantity, currency: plan.currency })` — `number` не передаём (оживлённый DB-default).
3. `tx.payment.create({ provider: DIGISELLER, status: CONFIRMED, externalId: inv.toString(), amount/currency площадки, rawPayload })` — `externalId` в ТОМ ЖЕ INSERT.
4. `tx.digisellerOrder.update({ paymentId })`.
5. `licenses.issue({ userId, productId, planId, orderId }, tx)` × quantity.
6. `tx.order.updateMany({ where: { id, status: 'PAID' }, data: { status: 'DELIVERED', deliveredAt } })`, assert `count===1`.
7. **`tx.digisellerClaim.update({ where: { id: claimId }, data: { state: 'FULFILLED', nextAttemptAt: null, digisellerOrderId: dealId } })`** — терминальный переход коммитится вместе с деньгами, отдельного шага, который можно потерять, нет.

Компенсирующая запись при откате — ОТДЕЛЬНОЙ транзакцией после отката, а не
внутри аборченной (иначе она откатывается вместе со всем). Инвариант модуля
«ни одного HTTP-вызова к площадке при открытой транзакции Prisma» сохранён и
усилен: в фазе C сети нет даже потенциально, потому что все данные площадки
уже в `digiseller_orders.raw_payload`.

## 8. Правки схемы (точно, минимально)

**Новая таблица `digiseller_claims`:**
```
id uuid PK
code_hash            char(64) NOT NULL          -- sha256(lower(normalizeCode(code)))
unique_code          varchar(64) NOT NULL       -- литерал покупателя, НЕ уникален
claimed_by_user_id   uuid NOT NULL FK users ON DELETE CASCADE
digiseller_order_id  uuid NULL FK digiseller_orders ON DELETE SET NULL
state                DigisellerClaimState NOT NULL
stall_reason         DigisellerStallReason NULL
block_code           DigisellerBlockCode NULL
reject_reason        DigisellerRejectReason NULL
email_match          boolean NULL
verify_attempts      int NOT NULL DEFAULT 0
upstream_refusals    int NOT NULL DEFAULT 0
fulfill_attempts     int NOT NULL DEFAULT 0
undecidable_streak   int NOT NULL DEFAULT 0
response_fingerprint char(64) NULL              -- группировка мусора в очереди
next_attempt_at      timestamptz NULL
escalate_at          timestamptz NOT NULL
leased_until         timestamptz NULL
last_error           text NULL
created_at, updated_at timestamptz NOT NULL

UNIQUE (code_hash, claimed_by_user_id)
INDEX (next_attempt_at) WHERE next_attempt_at IS NOT NULL
INDEX (state, created_at) WHERE state IN ('BLOCKED_UNMAPPED','BLOCKED_INPUT','STALLED')
INDEX (digiseller_order_id)
INDEX (claimed_by_user_id, state)                -- лимит открытых claim
CHECK ((state IN ('FULFILLED','REJECTED')) = (next_attempt_at IS NULL))
CHECK (state <> 'REJECTED' OR reject_reason IS NOT NULL)
```

**`digiseller_orders` (таблица пуста, модуля нет — миграция бесплатна):**
- `+ code_hash char(64) NOT NULL UNIQUE` — настоящий ключ однократности;
- `unique_code`: снять `@unique`, оставить обычный индекс (литерал для поддержки);
- `inv_id`: `BigInt?` → **`BigInt NOT NULL @unique`** + `CHECK (inv_id > 0)`;
- `redeemed_by_user_id` → FK на `users` `ON DELETE SET NULL` + индекс;
- `+ INDEX (created_at) WHERE redeemed_at IS NULL` — свипер осиротевших сделок;
- **НЕ добавляются** (перенесены в claim): `state`, `claimed_by_user_id`,
  `verify_attempts`, `next_attempt_at`, `quarantine_code`, `last_error`;
- **НЕ добавляется** `UNIQUE (lower(unique_code))` — пункт 5 «Правок схемы»
  черновика отменён целиком: его роль исполняет `code_hash`, а его вред (Д4,
  Д8, Д29) исчезает вместе с ним.

**На `payments`:** `CHECK (provider <> 'DIGISELLER' OR external_id ~ '^[0-9]+$')`
вместо `IS NOT NULL` (Д1).

**Настройки (settings):** `digiseller.retry_horizon_hours=72`,
`digiseller.owner_grace_sec=900`, `digiseller.unmapped_recheck_sec=600`,
`digiseller.unmapped_alert_hours=2`, `digiseller.max_open_claims_per_user=3`,
`digiseller.claim_ttl_days=30`, `digiseller.reject_retvals=[]`,
`digiseller.self_retry_per_claim_per_hour=2`.
**Сид:** шаблон `order.delayed` (ru/en, EMAIL).

## 9. Что этот узел отдаёт наружу (границы)

- **health** от этого узла: срез по `state`, `oldest_unmapped_age_sec`,
  `oldest_blocked_input_age_sec`, `stalled_by_reason`, `claims_past_escalate_at`,
  `orphaned_deals`. Только эти показатели отличают «поллинг идёт» от «система
  копит непогашенные оплаты».
- **возвраты и `deliver`** живут на СДЕЛКЕ, не на claim. `FULFILLED` возвратом
  не переоткрывается. Но тот же приём — лизинг + `CHECK (терминал ⇔ next_at IS NULL)`
  + календарный горизонт + терминальный разбор документированных retval —
  обязан быть применён к `deliver`-процессору (Д24, Д32), иначе горячий цикл
  просто переезжает туда.
- **лимиты и анти-оракул** — соседние узлы; этот узел им даёт две опоры:
  ключ по `sha256(lower(code))` (совместим с отрицательным кэшем, Д36) и
  единый путь для «нет кода»/«погашен другим» (Д16, Д28).

### Узел «идемпотентность, возвраты и бухгалтерия»

# Узел: идемпотентность, возвраты и бухгалтерия

Три узла черновика переделаны по сути, а не залатаны:

1. **Ключ идемпотентности перестаёт быть строкой.** `inv` — это распарсенный `bigint > 0` или отказ; `String()` над данными площадки запрещён на уровне типов и подпёрт CHECK-регуляркой в БД.
2. **Возврат перестаёт быть булевым полем.** Вводится журнал денежных фактов `refunds` + `Payment.refundedAmount`, а дедупликация делается по ДЕНЬГАМ (платёж + факт площадки), а не по каналу обнаружения.
3. **Наблюдение отделяется от реакции, но дедуп-ключ и детектор изменения — это ОДИН И ТОТ ЖЕ уникальный индекс**, поэтому щели, в которую провалился Д10, не существует конструктивно. Единственный маркер прогресса — `processed_at` строки события, и он выставляется той же транзакцией, что и реакция.

Плюс `unique_code_state.state = 4` полностью убран из денежных триггеров.

---

## 1. Валидация ключа идемпотентности (закрывает Д1)

### Почему сегодня дыра

- `invId BigInt? @unique` — `prisma/schema.prisma:1119`. В Postgres NULL ≠ NULL, поэтому строк с `inv_id IS NULL` можно вставить сколько угодно: слой «два разных кода на один счёт» выключается молча.
- `externalId String? @db.VarChar(128)` + `@@unique([provider, externalId])` — `prisma/schema.prisma:1088, 1102`. `String(undefined)` даёт литерал `"undefined"` — непустую строку, которую формулировка `CHECK (external_id IS NOT NULL)` из п.2 «Правок схемы» пропускает. Первый покупатель занимает `(DIGISELLER,'undefined')`, каждый следующий получает P2002 → `src/common/filters/all-exceptions.filter.ts:151-159` → 409 ALREADY_EXISTS с текстом «Запись с такими данными уже существует». Канал умирает после первой продажи.

### Правило: ключ валидируется ДО того, как станет ключом

**`parseInv(raw: unknown): { ok: true; inv: bigint } | { ok: false; reason: string }`** — тотальная функция, живёт в `digiseller.mapper.ts`, тестируется таблицей без сети:

| вход | исход |
|---|---|
| `number`, `Number.isSafeInteger`, `> 0` | ok |
| `string`, после `trim()` матчит `^[1-9][0-9]{0,18}$` | ok |
| `undefined`, `null`, `''`, `'undefined'`, `'0'`, `'042'`, `'12 34'`, `'1e5'`, дробное, отрицательное, `NaN`, `> 2^63−1`, объект/массив | **not ok** |

Три следствия, каждое обязательное:

1. **Тип делает вырождение непредставимым.** `VerifiedPurchase.inv` объявлен как `bigint` (не `number | string | undefined`). `classify()` выдаёт вердикт `OK` ТОЛЬКО с уже распарсенным `inv`. Значит `String(inv)` в фазе C не может получить `undefined` — компилятор не даст. Единственный способ получить строку счёта — функция `invRef(inv: bigint): string { return inv.toString() }`; прямой `String()`/`Number()`/`parseInt()` над полями площадки запрещён правилом модуля (записывается в `apps/api/src/modules/payments/CLAUDE.md` рядом с инвариантом «нет HTTP при открытой транзакции»).
2. **Отсутствующий/битый `inv` — это не REJECT и не RETRYABLE.** Покупатель заплатил, значит REJECT недопустим; площадка ОТВЕТИЛА, значит повтор даст тот же ответ и RETRYABLE только сожжёт попытки (ровно механика Д3/Д6). Исход — `QUARANTINED`, новый код `INV_UNPARSEABLE`, HTTP 202, тикет админу, **`redeemedAt` остаётся NULL** — код не сожжён. Карантинная строка пишется отдельным UPDATE в существующую интейк-строку (она уже создана фазой A), а не внутри денежной транзакции.
3. **Выход из карантина без SQL.** `POST /billing/digiseller/quarantine/:id/resolve` принимает `inv`, введённый админом из кабинета продавца (номер счёта там виден), прогоняет его через тот же `parseInv` и перезапускает обычный `fulfill`. Никакой отдельной ветки выдачи — иначе она разъедется с основной.

### Страховка в БД (тип соврать не может, но парсер может)

```sql
ALTER TABLE digiseller_orders ADD CONSTRAINT digiseller_orders_inv_positive
  CHECK (inv_id IS NULL OR inv_id > 0);

-- настоящая версия п.2 «Правок схемы»: IS NOT NULL не защищает ни от чего
ALTER TABLE payments ADD CONSTRAINT payments_digiseller_external_id_numeric
  CHECK (provider <> 'DIGISELLER' OR external_id ~ '^[1-9][0-9]{0,18}$');

-- FULFILLED без номера счёта — это утечка бухгалтерии, а не «ещё не узнали»
ALTER TABLE digiseller_orders ADD CONSTRAINT digiseller_orders_fulfilled_has_inv
  CHECK (state <> 'FULFILLED' OR inv_id IS NOT NULL);
```

Регулярка именно `^[1-9][0-9]{0,18}$`, а не `^[0-9]+$`: без запрета ведущих нулей один и тот же счёт даёт два разных ключа (`42` и `042`), и уникальный индекс их не свяжет. Ключ обязан быть каноническим.

### То же правило на остальные поля-ключи

Любое поле площадки, которое становится **ключом, деньгами или количеством**, разбирается тотальной функцией с явной веткой отказа; отказ = карантин, никогда не молчаливый default: `id_goods` (ключ маппинга тарифа), `cnt_goods` (Д37 — дробное в карантин), `type_curr`/`currency_type` (Д38), `amount`. Молчаливое `?? 0`, `?? 1`, `String()`, `Number()` над ответом площадки — запрещённые конструкции модуля.

### Что это даёт для корзины

Д39 доказывает по Swagger (`CartItemModel = {invoice_id, item_id, amount, currency}`), что у КАЖДОЙ позиции корзины свой `invoice_id`, а `cart_uid` только группирует. Значит `UNIQUE(inv_id)` — корректный глобальный денежный ключ, расширять его до `(inv, id_goods)` не нужно, и ветка `INV_CONFLICT` остаётся чистым ассерт-инвариантом (лог ERROR + карантин), а не сценарием.

---

## 2. Состояния сделки: где ДЕНЬГИ, а где СПОР О ДОСТАВКЕ (закрывает Д15)

Площадка ведёт **два независимых автомата** в двух разных методах, и черновик их смешал.

### Автомат А — `unique_code_state.state` (жизненный цикл НАШЕЙ выдачи). Денег не содержит вообще

| state | смысл | это деньги? | наша реакция |
|---|---|---|---|
| 1 | уникальный код не проверен | нет | ничего |
| 2 | товар доставлен, доставка не подтверждена и не опровергнута | нет | **это состояние, в которое сделку переводит НАШ `PUT .../deliver`** — норма |
| 3 | доставка подтверждена покупателем | нет | снять с наблюдения за СПОРОМ; наблюдение за ДЕНЬГАМИ продолжается |
| 4 | товар доставлен, но опровергнут («не получил») | **нет — это спор о доставке** | `DISPUTED`: уведомление админа, аудит `digiseller.delivery_refuted`, перевод сделки в горячий тир поллинга. **Лицензия работает.** |
| 5 | код проверен, товар не доставлен | нет | наш операционный дефект: `deliver` не дозвонился. Алерт, перевзвод deliver-процессора. Не деньги. |

Ключевой факт, который делает черновик разрушительным: **в состояние 2 сделку переводим мы сами**, вызывая `deliver` (документация метода: коды 3 «код ещё не был проверен» и 4 «сообщение о доставке уже поступало»). Из состояния 2 покупателю доступна кнопка «не получил» → state=4. То есть черновик построил автоотзыв на кнопке, которую сам же и открыл заплатившему человеку: один клик по ошибке → `refunds` на полную сумму, `Payment=REFUNDED`, `Order=REFUNDED`, `licenses.revoke` (`src/modules/licenses/licenses.service.ts:281-318` — обнуляет `currentDeviceId`, строка 294), письмо «лицензия отозвана», а при повторе — рецидив и бан. Денег при этом никто не возвращал.

Отказ от `deliver` — не решение: это единственный способ сообщить площадке о выдаче и он участвует в разборе споров. Решение — не считать 4 деньгами.

### Автомат Б — `content.invoice_state` из `/api/purchase/info` (деньги). Единственный источник денежной правды

| invoice_state | смысл | реакция |
|---|---|---|
| 1 | ожидается оплата | денег нет |
| 2 | отказ от оплаты | денег нет |
| 3 | успешная оплата | деньги получены — но см. холд ниже |
| 4 | оплата просрочена | денег нет |
| 35 | возврат начат, покупателем не завершён | `REFUND_PENDING`: уведомление админа, **отзыва нет** (решение черновика №10 сохраняю) |
| **5** | **возврат** | **единственный триггер денежной реакции** |

Отдельно: `content.lock_state` (`free`/`locked`) и `content.day_lock` — деньги получены, но на удержании. Практический вывод для бухгалтерии: «оплачено» становится окончательным только после разблокировки, и **минимальный обоснованный горизонт наблюдения = `day_lock` + запас**, читаемый из `purchase/info` по конкретной сделке, а не константа `refund_watch_days=90`, взятая с потолка.

### Аномалии, которые обязаны быть громкими, но не должны отзывать

Если по УЖЕ исполненной сделке приходит `invoice_state ∈ {1,2,4}` — это противоречие (мы выдали лицензию по счёту, который не оплачен). Реакция: `ACCOUNTING_ANOMALY` → админская очередь, **без автоотзыва**. Причина: асимметрия цены ошибки та же, что и в решении №6 черновика — вероятнее наша ошибка разбора (`Д31`: у `purchase/info` ответ завёрнут в `content` и поля названы иначе), чем неоплаченная выдача. Отзывать по подозрению на собственный баг — отъём доступа у заплатившего.

### Корректировка к правке самого Д15

Д15 предлагает «state=3 снимать с наблюдения раньше остальных». **Не согласен и не делаю.** Подтверждение доставки покупателем не говорит о деньгах ничего: возврат и чарджбек после подтверждённой доставки возможны. state=3 снимает сделку с наблюдения за СПОРОМ (автомат А), из наблюдения за ДЕНЬГАМИ (автомат Б) — нет. Иначе получится слепая зона ровно по самым «спокойным» сделкам.

### Флаг возврата в `seller-sells/v2` — подсказка, а не вердикт

`rows[].returned = 1` не становится денежным триггером ни при каких условиях: он служит только поводом немедленно опросить `purchase/info` по этому `invoice_id`. Причина — не только Д34 (окно фильтрует по дате ПРОДАЖИ, поэтому развёртка ловит лишь возвраты первых 48 часов), но и требование бухгалтерии: **денежный вердикт обязан иметь ровно один источник**, иначе ручной путь, развёртка и поштучный опрос породят три несводимых факта об одном возврате. Один источник — `content.invoice_state`.

---

## 3. Продвижение состояния и реакция: и одна транзакция, И переигрываемость (закрывает Д10)

### Где именно сеть

Возврат — редкий случай, где сеть не мешает: **нам нечего сообщать площадке о возврате** (эндпоинта нет ни в одном источнике). Единственный сетевой шаг — НАБЛЮДЕНИЕ (`GET /api/purchase/info/{inv}`), а оно идемпотентно по определению. Значит вся реакция локальна и целиком помещается в транзакцию. Инвариант модуля «ни одного HTTP при открытой транзакции Prisma» сохраняется без компромисса.

### Конвейер: наблюдение → факт → реакция

**Шаг 1 (сеть, транзакции нет).** Поллер читает `purchase/info` по `inv`. Парсит `content.invoice_state` и `content.unique_code_state.state` отдельными парсерами (Д31). Ничего не решает.

**Шаг 2 (микро-транзакция).** Запись ФАКТА:

```ts
const written = await prisma.digisellerEvent.createMany({
  data: [{ id: uuidv7(), provider: 'DIGISELLER',
           externalId: `dgs:inv:${inv}:invoice_state:${n}`,   // либо :code_state:${m}
           eventType, digisellerOrderId, payload: raw, receivedAt: now }],
  skipDuplicates: true,
});
```

`createMany({skipDuplicates:true})` (Prisma 6.3 + Postgres — `apps/api/package.json:52,75`) вместо `create`+catch: исключение P2002 внутри интерактивной транзакции Prisma переводит транзакцию Postgres в aborted, и все следующие запросы падают с 25P02. Управление потоком через исключения на денежном пути запрещено.

`written.count === 0` означает «этот факт уже известен» — и **больше ничего не означает**. Никакого сравнения «а изменилось ли состояние» нет вообще.

**Шаг 3 (дренаж, одна транзакция на событие).** Отдельный воркер берёт `WHERE processed_at IS NULL AND next_attempt_at <= now()` и в ОДНОЙ транзакции без сети применяет реакцию И выставляет `processed_at`.

### Почему Д10 закрыт конструктивно, а не аккуратностью

Дефект возник из связки «дедуп по одному маркеру + реакция по другому»: черновик писал событие «только на СМЕНУ состояния» и продвигал `DigisellerOrder.invoiceState` отдельно от реакции — перезапуск между ними прятал возврат навсегда.

В новой схеме:
- **Детектор изменения и ключ дедупликации — один и тот же уникальный индекс** `digiseller_events (provider, external_id)`, где `external_id` выводится ИЗ САМОГО ФАКТА (`inv` + значение состояния), а не из счётчика, не из времени и не из сравнения с предыдущим. Между ними физически нет двух записей, между которыми можно упасть.
- **`DigisellerOrder.providerInvoiceState` — проекция, а не гейт.** Обновляется той же транзакцией, что и реакция, и не участвует в решении «создавать ли событие».
- **Единственный маркер прогресса — `processed_at`.** Падение до шага 2 → следующий опрос даст то же `invoice_state` и тот же ключ. Падение между 2 и 3 → строка `processed_at IS NULL`, дренаж её возьмёт. Падение внутри 3 → откат целиком, `processed_at` остался NULL.
- **Правило модуля:** *никакой дедуп-маркер не продвигается раньше, чем закоммичена реакция.*

Осцилляция состояний обрабатывается корректно: `35 → 5` — два разных ключа, два факта. `4 → 3 → 4` — повторный 4 дедуплицируется, что и нужно (второе уведомление о том же споре не требуется).

### Состав транзакции реакции на `invoice_state=5`

Порядок обязателен, всё — условные записи, ни одного сетевого вызова:

1. `refunds.createMany({ data:[…], skipDuplicates:true })`. `count === 0` → факт уже применён другим путём → **реакции нет**, сразу к шагу 8. Это и есть межисточниковая дедупликация (§4).
2. `payment.update({ data: { refundedAmount: { increment: a } } })` — компилируется в `SET refunded_amount = refunded_amount + $1`, под READ COMMITTED перечитывает строку после снятия блокировки, поэтому параллельные инкременты складываются корректно, а перебор ловит `CHECK (refunded_amount BETWEEN 0 AND amount)`.
3. По возвращённому `refundedAmount`: `>= amount` → `Payment.status=REFUNDED` + `refundedAt` условно `WHERE status IN ('CONFIRMED','PARTIALLY_REFUNDED')`; иначе `PARTIALLY_REFUNDED`.
4. `Order`: та же логика условным `updateMany`, `count=0` — не ошибка, а «уже».
5. **Захват `currentDeviceId` / `hwidHash` СЕЛЕКТОМ до отзыва** — `licenses.service.ts:294` обнуляет `currentDeviceId`, поэтому после `revoke` блокировать уже нечего (порядковый дефект из Д21).
6. Отзыв — только при полном возврате: `licenses.revoke(id, reason, actor?, tx)` с guard по статусу (§9).
7. Побочные эффекты **внутри** транзакции через расширенные подписи: `notifications.enqueue(…, tx)`, `audit.record(…, tx)`, `antiFraudEvent.create({…}, tx)`.
8. `digisellerEvent.update({ processedAt: now })` + `digisellerOrder.updateMany({ where:{ id, refundedAt:null }, data:{ refundedAt, providerInvoiceState } })`.

Отказ дренажа: `attempts+1`, `next_attempt_at` с экспонентой и потолком, `lastError`; после N подряд — в ту же админскую очередь, что и карантин. **`processed_at` при отказе не двигается никогда.**

Почему очередь уведомлений годится как outbox: проект уже принял решение, что очередь — таблица `notifications`, а не брокер (`src/modules/notifications/notification.service.ts:8-19`), и её разбирает `notification.processor.ts:37-52` с `attempts`/`MAX_ATTEMPTS=5`. Строка, созданная в той же транзакции, — это готовый outbox без новой машинерии.

---

## 4. Дедупликация возвратов между ручным путём и поллингом (закрывает Д13, Д17)

### Ключ — по деньгам, не по каналу

Черновик дедуплицировал по `@@unique([paymentId, externalRef])`, но `externalRef` вычислялся из канала обнаружения (`poll:{inv}:5` против «ручного»), поэтому ключи по построению не совпадали.

**Ключ идемпотентности возврата = `(payment_id, external_ref)`, где `external_ref` детерминирован от ФАКТА ПЛОЩАДКИ, и ручной путь обязан вычислять ТУ ЖЕ строку, а не свою.**

Каноническая форма ровно двух видов:

| факт | external_ref | сколько может быть |
|---|---|---|
| площадка сообщила о возврате по счёту (`invoice_state=5`) | `dgs:inv:{inv}:refund` | ровно один на счёт — площадка отдаёт один бит на счёт, не поток событий |
| возврат вне площадки (компенсация с нашей стороны) | `manual:{paymentId}:{clientRef}` | сколько угодно, `clientRef` обязателен в запросе админа (Idempotency-Key формы) |

Форма ручного возврата по DIGISELLER-платежу содержит обязательный выбор из двух и ничего больше: **«возврат проведён на площадке»** (по умолчанию — деньги двигаются там) → `external_ref = dgs:inv:{inv}:refund`; **«вне площадки»** → ручной ключ. При выборе «на площадке» и `invId IS NULL` операция ОТКАЗЫВАЕТСЯ с явным сообщением — без валидного `inv` общего ключа не существует. Это второе, независимое от §1, следствие того, что номер счёта обязан быть проверен: непроверенный `inv` ломает не только `payments`, но и весь контур возвратов.

### Ручной путь обязан гасить наблюдение

`manualRefund` в ТОЙ ЖЕ транзакции ставит `digiseller_orders.refunded_at` условным UPDATE. Иначе курсор поллера `redeemed_at IS NOT NULL AND refunded_at IS NULL` строку не снимает, и через 5 минут возврат обрабатывается второй раз (Д17). Отсюда правка сигнатуры: **возврат — операция над ПЛАТЕЖОМ, а не над заказом.** `Order.payments` — это список (`prisma/schema.prisma:1063`), у заказа может быть несколько платежей, и `manualRefund(orderId, …)` из черновика в принципе не адресует деньги. Итог: `POST /api/v1/payments/:paymentId/refund` (право `orders.refund` уже засеяно — `prisma/seed.ts:96,144`), сервис сам поднимает `Order` и `DigisellerOrder` по `payment_id` (`digiseller_orders.payment_id` уникален — `schema.prisma:1113`).

### Гонка ручного пути и поллера

Оба делают `createMany(skipDuplicates)` по одному ключу:

- **Победитель** (`count=1`) владеет фактом и выполняет реакцию целиком.
- **Проигравший** (`count=0`) **не создаёт вторую строку и не выполняет реакцию** — ни второго письма, ни второго `revoke`, ни второго анти-фрод события. Всё, потому что письмо и аудит теперь внутри той же транзакции (§9).
- Если проигравший — админ, и в выигравшей строке `amountConfidence='ASSUMED_FULL'` (поллер не знал суммы, см. §5), а админ ввёл другую сумму: применяется **корректировка той же строки** — дельта через `increment`/`decrement` `Payment.refundedAmount` под тем же CHECK, аудит `refund.amount_corrected`. Строка остаётся одна.
- Если корректировка снижает возврат до частичного, а лицензии уже отозваны — **автоматического «разотзыва» нет и не изобретается**: `LicensesService` обратной операции не имеет (`licenses.service.ts:281-318`, и `extend()` прямо отказывает отозванной — строки 162-167). Ответ на корректировку явно перечисляет админу отозванные лицензии и предлагает ручную перевыдачу. Тихо оставить рассинхрон нельзя.

### Правило рецидива — переопределено (вторая половина Д13)

Черновик считал «≥2 возврата по одному `buyerEmail` или пользователю» по строкам, которых при одном возврате получалось две, и без окна. Новое правило:

- **База подсчёта:** `count(distinct payment_id)` среди возвратов с `kind='PROVIDER'` и `refundedAmount >= amount` (полных). Не строки `refunds`, не строки `AntiFraudEvent`, не события.
- **Спор о доставке (`code_state=4`) в счётчик НЕ входит** — это прямое следствие §2.
- **Возврат «вне площадки» не входит**: деньги вернули мы сами, покупатель ни при чём.
- **Окно скользящее**, настройка `digiseller.reversal_window_days = 180`. Без окна два законных возврата за два года дают вечный бан.
- **Субъект — сопоставленный `user_id`.** `buyerEmail` идёт только в `details` как MEDIUM-сигнал: почта на площадке нами не проверена и по решению №20 черновика намеренно не сверяется (`require_email_match=false`), а платят с чужого адреса регулярно. Банить по неподтверждённому идентификатору нельзя.
- **Снятие отметки уже выражено схемой:** `AntiFraudEvent.resolvedAt / resolvedById / resolution` (`prisma/schema.prisma:1385-1387`). Предикат запрета формулируется как «есть НЕразрешённое событие `PAYMENT_REVERSAL` severity ≥ HIGH», админ снимает его резолвом. Отдельного вечного флага и отдельной таблицы банов не заводится.
- Санкция как таковая (`Device.isBlocked`) не действует — это Д11/Д21 и чужой узел; мой узел фиксирует только базу, окно, субъект и обратимость.

---

## 5. Частичный возврат

**Главный факт, который меняет постановку: площадка не сообщает сумму возврата ни одним из трёх используемых методов.** `purchase/info` отдаёт `invoice_state` (состояние, не сумма) и `amount/amount_usd/currency_type` — это суммы ПЛАТЕЖА; `unique-code` — `amount/amount_usd/profit` платежа; `seller-sells/v2` — флаг `returned` (0|1) и `amount_in/amount_out`, семантика которых как «сколько вернули» нигде не документирована и потому в денежную логику не берётся (правило 2 задания). Поля даты возврата в ответах тоже нет.

Отсюда прямые следствия:

1. **Автоматическое обнаружение частичного возврата невозможно.** Поллер способен породить только полный: `invoice_state=5` → `refunds.amount = payment.amount`, `amountConfidence = 'ASSUMED_FULL'`. Допущение записывается в колонку, а не прячется: бухгалтерия не должна утверждать знание, которого нет.
2. **Частичный возврат входит в систему только человеком** — через `POST /payments/:id/refund` с явной суммой (`amountConfidence='REPORTED'`), где источник числа — кабинет/выписка.
3. **Реакция определяется агрегатом, а не строкой.** После каждой записи пересчитывается `Payment.refundedAmount`:
   - `refundedAmount >= amount` → `Payment/Order = REFUNDED`, **отзыв лицензий**;
   - `0 < refundedAmount < amount` → `Payment/Order = PARTIALLY_REFUNDED`, **отзыва нет**, задача админу. Правило распределения «сколько лицензий отозвать при возврате трети» остаётся коммерческим решением владельца (п.3 раздела владельца) — код за него не решает.
   Агрегат монотонен, все переходы условные, поэтому применение фактов в любом порядке даёт один исход.
4. **Инвариант `sum(refunds.amount) <= payment.amount` живёт в БД**, а не в приложении: `CHECK (refunded_amount >= 0 AND refunded_amount <= amount)` на `payments`. Перебор → 23514 → откат транзакции реакции → событие в админскую очередь с `lastError`. Fail-loud в правильную сторону.
5. **Валюта не принимается от вызывающего**: `refunds.currency` копируется из `Payment` (`schema.prisma:1085`). Сверка возврата идёт ТОЛЬКО против `Payment` (валюта площадки); `Order.amount` — наш прайс в валюте тарифа, его никто не пересчитывает, никакой межвалютной арифметики в контуре возвратов нет.

---

## 6. Нужна ли отдельная сущность под возвраты — ДА. Обоснование фактами схемы

Полей в существующих таблицах не хватает по шести независимым причинам:

1. **Кардинальность.** Возвратов на платёж 0..N, а всё существующее — 1:1 со строкой: `Payment.refundedAt DateTime?` (`schema.prisma:1094`), `Order.refundedAt` (`1058`), `DigisellerOrder.refundedAt` (`1135`). Второй частичный возврат затирает время первого, и второй суммы положить некуда.
2. **Суммы нет вообще.** `PaymentStatus` — enum без значения (`schema.prisma:116-121`), колонки «сколько вернули» не существует. Возврат сегодня выразим только как булев исход.
3. **Ни актора, ни причины.** У `Order` есть `comment` (`1061`), у `Payment` — `errorMessage` (`1095`); это свободный текст, а не атрибуция. Сравните с собственной конвенцией проекта: `License.blockedAt / blockedReason / blockedById` — тройка (`schema.prisma:841-843`), причём у отзыва даже там нет актора (`848-849`), и комментарий прямо в схеме признаёт проблему: «Разбор чарджбека без даты и причины отзыва превращается в гадание» (`schema.prisma:847`).
4. **Ключу идемпотентности негде жить.** Мне нужен `UNIQUE(payment_id, external_ref)`. На `payments` единственный уникальный слот `@@unique([provider, externalId])` (`1102`) занят идентичностью самого платежа. Свободного слота нет — нужна строка.
5. **`ResellerTransaction` подменой не работает:** `resellerId String NOT NULL` с FK (`1005-1006`) — возврат Digiseller туда физически не ложится; уникальных ключей нет ни одного, `licenseId`/`orderId` — голые Uuid без FK и без индекса (`1015-1016`, индексы `1022-1024`). Тот же двойной прогон удваивал бы баланс.
6. **Истории ответов площадки нет:** `DigisellerOrder.rawPayload Json?` (`1127`) — одно поле, перезаписывается, хранит только последний ответ.

**Минимальный набор правок (и ничего сверх):**

```prisma
model Refund {
  id         String   @id @db.Uuid
  paymentId  String   @map("payment_id") @db.Uuid          // FK → payments, Restrict
  orderId    String   @map("order_id")   @db.Uuid          // FK → orders, Restrict (денормализация под отчёт)
  amount     Decimal  @db.Decimal(12, 2)                    // ТА ЖЕ точность, что Payment.amount
  currency   String   @db.VarChar(3)                        // копируется из Payment
  kind       RefundKind                                     // PROVIDER | MANUAL_OUT_OF_BAND
  amountConfidence RefundAmountConfidence                   // REPORTED | ASSUMED_FULL
  externalRef String  @map("external_ref") @db.VarChar(191)
  reason      String?
  createdById String? @map("created_by_id") @db.Uuid        // NULL = SYSTEM (поллер)
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  @@unique([paymentId, externalRef])
  @@index([orderId])
  @@index([createdAt])
  @@map("refunds")
}
```

- `Payment.refundedAmount Decimal(12,2) @default(0)` + `CHECK (refunded_amount >= 0 AND refunded_amount <= amount)`.
- `OrderStatus += PARTIALLY_REFUNDED`, `PaymentStatus += PARTIALLY_REFUNDED` (`schema.prisma:82-89, 116-121`).
- `AntiFraudType += PAYMENT_REVERSAL` (`schema.prisma:183-194` — значения нет).
- `digiseller_events (id, provider, external_id, event_type, digiseller_order_id FK, payload JsonB, received_at, processed_at, attempts, next_attempt_at, last_error)`, `@@unique([provider, external_id])`, частичный индекс `(next_attempt_at) WHERE processed_at IS NULL`.
- `DigisellerOrder`: `providerInvoiceState Int?`, `providerCodeState Int?`, `disputedAt DateTime?` (спор о доставке — отдельно от `refundedAt`, это и есть кодификация §2), `quarantineCode`.
- Три CHECK из §1.
- Сид: шаблоны `license.revoked` и `order.refunded` (ru/en, EMAIL) — их нет (`prisma/seed.ts:353,381` содержат только `order.delivered`); настройка `digiseller.reversal_window_days=180`. Отсутствие шаблона = тихая потеря письма: `render()` бросает, процессор наращивает `attempts` и через 5 попыток ставит FAILED (`notification.processor.ts:95-111`), а FAILED никем не переоткрывается.

**Чего НЕ добавляю:** `CHARGEBACK` в `OrderStatus` (нечем отличить от возврата — площадка такого признака не отдаёт), `refundedById` на `Order`/`Payment` (актор теперь живёт в `refunds.createdById`), отдельной таблицы банов (см. §4 — резолв анти-фрод события уже выражает снятие), расширения ключа `inv` до `(inv, id_goods)` (Д39).

---

## 7. Правки существующих сервисов и одна неочевидная ловушка

| что | почему | файл:строка |
|---|---|---|
| `NotificationService.enqueue(params, tx?)` | сейчас пишет через `this.prisma` мимо любой транзакции | `notification.service.ts:60` |
| `AuditService.record(entry, tx?)` | то же; иначе четвёртый параметр `tx` у `revoke` даёт ложное ощущение атомарности | `audit.service.ts:133-135` |
| `LicensesService.revoke(licenseId, reason, actor?, tx?)` + guard по статусу | сейчас безусловный `update` без проверки статуса — повторный прогон затирает исходный `revokedAt` и шлёт второе письмо | `licenses.service.ts:281-318`, эталон guard'а — `registration-key.service.ts:255-265, 303-310` |

**Ловушка, которую обязан знать реализатор:** и `enqueue`, и `record` сегодня ГЛОТАЮТ ошибку (`notification.service.ts:74-81`, `audit.service.ts:151-157`). Внутри транзакции это опаснее, чем снаружи: упавший INSERT переводит транзакцию Postgres в состояние aborted, и все последующие запросы падают с 25P02 — то есть проглоченная ошибка превращается в необъяснимый отказ ЧЕРЕЗ несколько шагов. Правило: **при переданном `tx` обе функции обязаны пробрасывать ошибку; глотание сохраняется только для вызовов без `tx`** (там оно осмысленно — «неудача письма не откатывает выдачу лицензии»).

`revoke` с guard'ом:

```ts
const claimed = await db.license.updateMany({
  where: { id: licenseId, status: { not: LicenseStatus.REVOKED } },
  data: { status: 'REVOKED', revokedAt: now, revokedReason: reason, currentDeviceId: null },
});
if (claimed.count === 0) return null;   // тихий no-op: ни письма, ни аудита, ни анти-фрод события
```

---

## 8. Проверки, которые обязаны быть исполняемыми

- `parseInv` таблицей: `{undefined, null, '', 'undefined', 0, '0', '042', '12 34', 1.5, -1, '9223372036854775808', 42, '42'}` → ожидаемый исход на каждый; отдельный тест: при `inv=undefined` в ответе фейка **ни одной строки в `payments`**, ответ 202 `INV_UNPARSEABLE`, `redeemed_at IS NULL`, повторный redeem после `resolve` выдаёт ровно одну лицензию.
- SQL-утверждение: `INSERT INTO payments (provider='DIGISELLER', external_id='undefined')` отвергается CHECK'ом; `'042'` тоже.
- `state=4` (`unique_code_state`): лицензия остаётся ACTIVE, `refunds` пуст, `Payment` CONFIRMED, `disputedAt` проставлен, админ уведомлён. Затем по тому же `inv` приходит `invoice_state=5` — отзыв срабатывает ровно один раз.
- Переигрываемость: убить процесс между записью события и дренажом (тест — не вызывать дренаж), затем прогнать дренаж → возврат обработан ровно один раз. Повторить дренаж пять раз → счётчики `refunds`, `notifications`, `audit_logs`, `anti_fraud_events` не изменились.
- Межисточниковая дедупликация: ручной возврат «на площадке», затем два тика поллера → одна строка `refunds`, одно письмо, одно анти-фрод событие, `digiseller_orders.refunded_at` проставлен ручным путём. И зеркально: поллер первый, админ вторым с другой суммой → одна строка, сумма скорректирована, `refund.amount_corrected` в аудите.
- Рецидив: один экономический возврат, обнаруженный обоими путями → `count(distinct payment_id) = 1` → бана НЕТ. Два разных платежа в окне → бан. Два в 200 днях при окне 180 → бана нет.
- Частичный: возврат 30% → `PARTIALLY_REFUNDED` на обоих, лицензии ACTIVE; затем ещё 80% → CHECK отвергает, транзакция откатывается, событие в админскую очередь, `refundedAmount` остался 30%.
- Откат реакции не оставляет письма: заставить падать последний шаг → в `notifications` ноль строк `license.revoked`, в `audit_logs` ноль `license.revoke`.

### Аутентификация к Digiseller, стоимостные лимиты и утечка информации

Узел переделан, а не залатан. Пять сломанных мест и что с ними стало.

**1. Аутентификация.** Монотонный счётчик как источник timestamp убран целиком: он подменял семантику поля («время запроса», api_general.asp#token) на счётчик и через месяц отставал на 2,6 млн секунд (Д14). Новая схема — три слоя, все на уже применяемых в проекте примитивах, без Lua: (а) `ts = max(floor(Date.now()/1000), lastTs+1)` — база всегда настоящее время, монотонность только как страховка от совпадения внутри секунды; (б) маркер занятости `SET digiseller:apilogin:ts:{ts} NX EX 300` — тот же приём, которым уже защищён sessionKey (`signature.service.ts:124`) и throttle лаунчера (`launcher.service.ts:521`); (в) retval -4 обрабатывается как сигнал «взять ts+1 и повторить», а не как авария. Потеря ключа в Redis больше не катастрофична: при `allkeys-lru` (`docker-compose.yml:69-73`) счётчик может быть вытеснен в любой момент, и правило `max(now, …)` делает отсутствие ключа эквивалентным «взять now», а не «начать с 1». Логинов ~12/сутки, поэтому цена всех трёх слоёв нулевая.

Кеш токена больше не опирается ни на какую константу: `DIGISELLER_TOKEN_CACHE_TTL=6600` (`env.schema.ts:170`) удаляется, TTL = `min(valid_thru − now, 7200с) − 300с`. Второй член `min` не косметика: он делает TTL устойчивым к нашему же отставанию часов — при часах, отстающих на час, разность `valid_thru − now` дала бы TTL на час длиннее реального срока и гарантированный 401 на живом токене.

Рассинхронизация часов измеряется, а не предполагается: дрейф = `(valid_thru − 120 мин) − наш now`, оба значения документированы (валидность 120 минут и поле valid_thru, api_general.asp#token). Дрейф уходит в health и в алерт. Расхождение ts с настенным временем жёстко ограничено сверху (60 с): попытка уйти дальше — громкая остановка логинов, а не тихое сползание.

**2. Анти-оракул выполняется по-настоящему.** Промежуточного варианта нет. `POST redeem` НИКОГДА не отдаёт вердикт: всегда 202 + непрозрачный `claim_id`, при любом исходе — код не существует, код чужой погашенный, код свой, площадка лежит. Вердикт публикуется только через статус заявки, и все три отрицательных исхода публикуются одним кодом `CODE_INVALID` не раньше единого «выдерживания» (`verdict_dwell_sec`=15). Быстрого 404 из БД не существует больше нигде, потому что именно он и был оракулом (Д16, Д28). Это оказалось почти бесплатно: durable-заявка, claim_id вместо кода в URL и асинхронный досчёт нужны модулю и без анти-оракула (Д2, Д3, Д6, Д19, Д27), поэтому «сделать честно» дешевле, чем «отказаться и записать риск».

**3. Лимиты считают то, что дорого.** Введена единица — **UC (upstream call)**, один HTTP-запрос к площадке от лица нашего продавца. Пороги заданы прямо в UC, а не в предъявлениях. На интейке резервируется полная стоимость заявки `uc_reserve_per_claim = 6` (первая проверка + пять ретраев), неизрасходованное возвращается при терминальном исходе. Мусорное предъявление стоит противнику ровно столько, сколько оно стоит нам; «10 в час», которые на деле разрешали ~70 обращений (Д12), исчезли как класс.

**4. Fail-политика разобрана по каждому лимиту отдельно, и главное — fail-closed на глобальном бакете отменён.** Выбор «нет лимита или нет продаж» ложный. При недоступности Redis каждый бакет деградирует к процессному токен-бакету на консервативную долю от общего бюджета (прецедент процессного состояния — Map-кеш `settings.service.ts:25-31`). Лимит становится грубее, но никогда не исчезает и никогда не превращается в отказ единственного платёжного канала.

**5. Санкция против «купил → скачал → вернул» переделана.** `Device.isBlocked` действительно не удорожает повтор ни на сколько: уникальность составная `@@unique([licenseId, hwidHash])`, ветка первой привязки (`hwid.service.ts:118-184`) вообще не смотрит на блокировку, а проверка стоит только на сверке текущего устройства (`hwid.service.ts:187`) — вторая покупка заводит чистую строку с тем же железом (Д11, Д21). Вводится глобальная таблица `blocked_hwids` по `hwid_hash` с проверкой в обеих ветках bindOrVerify. И отдельно, честно: это поднимает стоимость повтора с нуля до «сменить/подделать Disk ID», а не до бесконечности — и всё, что можно сделать техникой. Единственная структурная защита — не отдавать payload до закрытия окна возвратов — это решение владельца, не инженера.

