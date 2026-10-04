# Разбор после первого живого прогона

> 2026-08-02. Загрузчик впервые прошёл полный круг: вход → проверка
> лицензии → payload → расшифровка в памяти → инъекция в FC26.exe.
> Инъекция успешна, процесс жив. Ниже — что при этом осталось
> неправильным. Шесть проверяющих, каждый со своим углом, плюс критик
> полноты. Все находки подтверждены запросами и чтением кода, а не
> рассуждением.

| Тяжесть | Штук |
|---|---|
| критично | 3 |
| важно | 14 |
| мелочь | 6 |
| наблюдение | 12 |

## Что подтвердилось как исправное

**журнал.** ОКНО: 2026-08-02 13:00–13:05 UTC, пользователь live78674 (019fc284-7f9f-7402-bf96-5e6719e26353), лицензия 019fc284-84c0-73bc-9079-dd7e896c2ee4 (FC26-VQH6-UKKR-M2TC-TMZW), устройство 019fc291-1751-76cd-956d-4bbc54c206c5.

ЧТО ЗАПРАШИВАЛ (все через `docker exec -i lp-postgres psql -U lp -d license_platform`):
1) `\d payload_issues`, `\d devices`, `\d hwid_history`, `\d login_history` — схемы и индексы.
2) SELECT всех колонок payload_issues за окно + LIMIT 20 по всей таблице.
3) JOIN payload_issues -> devices по device_id с явным сравнением `pi.hwid_hash = d.hwid_hash` и length() обоих.
4) SELECT по licenses / devices / hwid_history / login_history / audit_logs / anti_fraud_events / launcher_log_batches за окно.
5) Агрегаты: заполненность полей по result; NULL-счётчики country/os_info/device_id по всей БД; покрытие enum PayloadIssueResult.
6) Redis: `docker exec lp-redis redis-cli -a lp_dev_password --no-auth-warning --scan --pattern ...` + TTL/GET по payload:rate:*, payload:sk:*, license:*.
7) Лог сервера ...\tasks\bqnb6wieo.output, строки 5755–5815 — порядок запросов и req.id.
8) Код: launcher/payload-issues.service.ts, payload.service.ts, launcher.service.ts, launcher.controller.ts, hwid/hwid.service.ts, licenses.service.ts (activate), common/audit/audit.interceptor.ts, common/logger/logger.module.ts, common/crypto/crypto.service.ts (hashHwid), apps/api/prisma/schema.prisma (model PayloadIssue).

ЧТО ПОДТВЕРДИЛОСЬ КАК ИСПРАВНОЕ (негативных находок тут нет):
- hwid_hash СОЕДИНЯЕТСЯ. payload_issues.hwid_hash = 7ba5e3f9...654c, devices.hwid_hash того же устройства = ровно то же, `hash_equal = t`, обе колонки char(64), длина 64 у обеих (паддинга bpchar нет). По всей таблице: 12 строк ISSUED, у 12 из 12 хеш совпал с хешем связанного устройства, ни одной строки ISSUED с отсутствующим устройством. Хеш вычисляется одной функцией CryptoService.hashHwid (HMAC-SHA256 с HWID_PEPPER, crypto.service.ts:211) и в payload_issues, и в devices, и в hwid_history.
- ПОРЯДОК И МОМЕНТ АКТИВАЦИИ. Лог: 13:01:56.395 POST /auth/login 200 → 13:01:56.446 «первая привязка лицензии FC26-VQH6...» в POST /launcher/license/check → 13:01:56.457 check 200 → 13:01:56.497 POST /launcher/payload 200. В БД: devices.first_seen_at 13:01:56.434, hwid_history 13:01:56.438, licenses.activated_at 13:01:56.441, licenses.updated_at 13:01:56.451, payload_issues.created_at 13:01:56.494. Отсчёт стартовал в проверке лицензии, за 53 мс ДО выдачи payload. expires_at = 2026-09-01 13:01:56.441 = activated_at + ровно 30 дней (durationDays тарифа). licenses.activate() берёт `new Date()` в момент вызова (licenses.service.ts:121-129) — не дату создания и не дату выдачи.
- FIRST_BIND. hwid_history: ровно 1 строка, reason=FIRST_BIND, actor_label='launcher', actor_type=USER, actor_id=019fc284-7f9f... (владелец), ip=172.22.0.1, new_device_id и new_hwid_hash заполнены, old_* NULL. Совпадает с hwid.service.ts:160-169.
- LOGIN_HISTORY. Ровно 1 строка: success=t, method=password, identifier_used=live78674, user_agent=PlatformLauncher/1.0, client_version=1.0.0, ip=172.22.0.1, session_id=019fc291-1719-767b-bfc4-2ea9815a06c4.
- ДУБЛЕЙ НЕТ. За окно: 1 payload_issues, 1 hwid_history, 1 devices, 1 login_history, 0 launcher_log_batches, 0 anti_fraud_events. Строк «от payload» там, где их быть не должно, нет: payload шёл с allowFirstBind:false/touchDevice:false, и devices.last_seen_at остался равен first_seen_at (13:01:56.434) — то есть выдача payload устройство не «трогала».
- AUDIT НЕ ЗАДВОИЛСЯ И НЕ ПОЯВИЛСЯ. `SELECT count(*) FROM audit_logs WHERE created_at >= '13:00' AND < '13:05'` → 0. @Audit на POST /launcher/payload действительно нет (launcher.controller.ts, декоратора нет, есть только комментарий-запрет). `SELECT count(*) FROM audit_logs WHERE after::text ILIKE '%sessionKey%'` → 0.
- REDIS ЧИСТЫЙ. payload:rate:019fc284-84c0... val=2 ttl=3127 (EXPIRE поставлен на первой единице и окно не ползёт), payload:sk:* — 6 ключей с TTL, license:touch: и license:online: на месте. Осиротевших ключей без TTL нет.
- ПОВТОРНЫЙ ЗАПУСК 13:08:48 (уже вне окна, другой агент) ничего не сломал: activated_at остался 13:01:56.441, устройство переиспользовано (нет второй строки в devices), второй FIRST_BIND не записан, last_check_at обновился корректно после истечения 5-минутного троттла.
- FK у payload_issues нет вовсе (`\d` не показал ни одного FOREIGN KEY) — журнал переживает удаление лицензии/сборки, как и задумано для append-only.
- 5 строк DENIED_HWID имеют hwid_hash, которого нет ни в одном devices — это ожидаемо: отвергнут чужой Disk ID.

**крипто-состояние.** Все команды выполнены фактически, Redis требует AUTH (пароль lp_dev_password из .env).

1) Инвентаризация ключей и TTL:
- `redis-cli --scan --pattern '*'` -> 132..139 ключей: apikey:*, license:touch:*, license:online:*, payload:rate:*, payload:sk:*, session:revoked:* (~128), sig:nonce:*, user:permissions:*.
- `INFO keyspace` -> `db0:keys=139,expires=139` — у ВСЕХ ключей выставлен TTL.
- Контрольная проверка через `EVAL` (перебор всех ключей, отбор тех, у кого `TTL == -1`) -> пустой ответ. Ключей без TTL нет ни одного.
- `CONFIG GET maxmemory-policy` -> allkeys-lru; `maxmemory` -> 536870912; `appendonly` -> yes; `save` -> 3600 1 300 100 60 10000.

2) Одноразовость sessionKey (§7.2.1):
- Код: apps/api/src/modules/launcher/payload.service.ts:82 `SESSION_KEY_PREFIX='payload:sk:'`, :92 `SESSION_KEY_WINDOW_SEC=3600`, :426 `SET key '1' EX 3600 NX` по `sha256(sessionKey)`.
- Факт: `GET payload:sk:52facbdf...` -> `1`, `TTL` -> 3207 (при TIME 1785676107, т.е. поставлен в 13:01:56 — момент живого запуска). Ключ — 64 hex = хеш, значение — "1". Сам sessionKey в Redis не лежит.
- `grep -ac sessionKey /data/appendonlydir/appendonly.aof.1.incr.aof` -> 0 (за всю историю AOF открытого sessionKey не было).

3) Nonce подписи (§3.3):
- Код: common/crypto/signature.service.ts:124 `SET sig:nonce:<nonce> '1' EX windowSec NX`, windowSec = настройка `security.request_signature.window_sec`.
- Настройка в БД: `SELECT key,value FROM settings ...` -> `security.request_signature.window_sec = 300`.
- Факт: `TTL sig:nonce:6801256238b9...` -> 37, второй nonce уже истёк (-2). TTL совпадает с окном, ставится в момент ПРИЁМА запроса, т.е. всегда >= остатка валидности метки времени.

4) Счётчик выдач на лицензию:
- Код: payload.service.ts:95 `RATE_PREFIX='payload:rate:'`, :96 окно 3600; :510 `INCR`, :513 `EXPIRE` только при count===1; чтение порога в :471-472 (`GET`+`TTL`).
- Факт замер 1 (TIME 1785676107): `GET payload:rate:019fc284-84c0-73bc-9079-dd7e896c2ee4` -> `1`, TTL 3208.
- В БД на тот момент: `SELECT result,count(*) FROM payload_issues WHERE license_id='019fc284-...'` -> ISSUED 2 (13:01:56.494 и 13:08:48.084).
- Факт замер 2 (TIME 1785676258, после второй выдачи): `GET` -> `2`, `TTL` -> 3057. Счётчик = числу состоявшихся выдач, окно НЕ поехало вперёд (привязано к первой выдаче 13:01:55).

5) Payload в Redis (запрет проекта):
- Код: payload-cache.service.ts — кэш открытых байт живёт в памяти процесса (Map + LRU по байтам), Redis используется только как шина инвалидации (`PUBLISH payload:invalidate`).
- Факт: `redis-cli --bigkeys` -> «Biggest string found "apikey:lp_39ca7fad" has 188 bytes», 139 strings суммарно 2213 байт, 0 lists/hashes/streams. Байт payload'а (593920) в Redis нет.
- `grep -ac 'payload:body\|payload:bytes\|MZ' AOF` -> 0.

6) Инвентарь всех записей в Redis по коду: `grep -rn "redis.client.(set|setex|incr|expire|del|publish)" src` — 22 места; у всех `set` есть `EX`, единственный `INCR` без атомарного TTL — payload.service.ts:510.

7) Кэш проверки лицензии:
- `grep -rn "license:check\|CHECK_CACHE_PREFIX" src` -> только объявление (launcher.service.ts:24) и `DEL` (launcher.service.ts:302). Ни одной записи.
- Факт: `--scan --pattern 'license:check:*'` -> 0 ключей; `grep -ac "license:check:" AOF` -> 0 за всю историю файла (2.5 МБ, с 30 июля).
- Для сравнения `grep -ac "license:online:" AOF` -> 31, и ключ `license:online:019fc284-...` живой (TTL 54 -> 120с = `limits.license.check_cache_ttl_sec`(=60) * 2).

8) Кэш секрета ключа сборки:
- Код: launcher/guards/signature.guard.ts:26-27 (`apikey:`, TTL 300), :117 `crypto.decrypt(...)`, :132 `SET apikey:<prefix> JSON.stringify({id, signingSecret, scopes}) EX 300`.
- Факт: `docker inspect lp-redis` -> том `license-platform_redis_data` -> /var/lib/docker/volumes/.../\_data.
- `grep -c signingSecret /data/appendonlydir/appendonly.aof.1.incr.aof` -> 15; `strings /data/dump.rdb | grep -c signingSecret` -> 1.
- Извлечено из AOF (RESP): ключ `apikey:lp_39ca7fad`, значение `$188` = `{"id":"019fc284-7e2f-77fb-91c0-835e050dff06","signingSecret":"VvuUQUZmWzJSlNNwwf...` — это ровно тот ключ API, которым подписан живой запуск.
- В Postgres то же поле зашифровано: `SELECT prefix,left(signing_secret_enc,45) FROM api_keys` -> `v1.J3RH4bpoq-iLZEK1.spFqsdjbkAxGr4DzBaiqhQ.Uo...` (AES-GCM, 101 символ).

**логи.** Смещение времени: лог API в UTC (строка `[13:01:56.395] INFO: request completed ... POST /api/v1/auth/login` совпадает с записью nginx `"time":"2026-08-02T13:01:56+00:00" ... /api/v1/auth/login`); локальное время хоста — UTC+4 (mtime исходников `+0400`). Смещение = 0.

Что делал:
1. Прочитал целиком C:/Users/user/AppData/Local/Temp/claude/C--Users-user-work-kwork/47b7fbe6-897e-4593-992a-8101b06452e2/tasks/bqnb6wieo.output (6247 строк на момент чтения): старт, все WARN/ERROR, окно 13:00–13:05, хвост.
2. `docker logs lp-nginx` целиком: 289 строк, из них 33 JSON-записи access-лога, 105 [error], 103 [warn], 38 [notice].
3. `docker exec lp-nginx nginx -T` — полный конфиг, включая location payload.
4. `docker exec lp-nginx sh -c 'find /var/cache/nginx -type f | wc -l'` → 0.
5. `docker exec lp-nginx getent ahosts host.docker.internal` и `ip -o addr show` — резолв апстрима и наличие IPv6 в контейнере.
6. `docker inspect lp-nginx --format '{{json .State.Health}}'` → healthy, FailingStreak 0.
7. Активная проверка: POST /api/v1/launcher/payload телом 20000 байт через 127.0.0.1:8080 → зафиксировал статус, Content-Type и тело.
8. Чтение кода: apps/api/src/common/logger/logger.module.ts, main.ts, modules/launcher/{launcher.module.ts, guards/api-scope.guard.ts, payload*.service.ts}.
9. Изолированный тест установленного pino-http 10.5.0 (Node-скрипт в scratchpad) на работоспособность autoLogging.ignore и на мутацию opts.

Отдельно: в окне 13:00–13:05 в логе приложения нет ни одного WARN/ERROR. Ближайший WARN до окна — 12:47:01 (`GET /api/v1/health → 404 NOT_FOUND`), после окна до конца файла — ничего. Временных файлов в /var/cache/nginx нет. Также вижу вторую полную выдачу payload в 13:08:48 (200, 593920 байт, UA PlatformLauncher/1.0) — уже за пределами разбираемого окна; две записи 413 в 13:08:52 — мои проверочные.

**гигиена.** ЧТО ПРОВЕРЯЛ ФАКТИЧЕСКИ (запросы и их вывод)

1. Формат hwid во всех таблицах
- `SELECT table_name, column_name FROM information_schema.columns WHERE column_name ILIKE '%hwid%' OR column_name ILIKE '%disk%'` → поля hwid* есть только в devices (hwid_hash, hwid_enc, hwid_enc_key_ver), hwid_history (old/new_hwid_hash), payload_issues (hwid_hash). В anti_fraud_events, launcher_log_batches, login_history, audit_logs полей hwid* НЕТ вообще.
- devices: 18 строк, все hwid_hash длиной ровно 64, все hwid_enc вида `v1.<nonce>.<ct>` при key_ver=1. Ни одного значения с буквами/дефисами вне hex.
- hwid_history: 30 строк, все old/new_hwid_hash — 64 hex или NULL.
- payload_issues: hwid_hash везде 64 hex, включая строку живого прогона 019fc291-178d… (ISSUED, 1.0.3310, 593920 байт, request_id 019fc291-1772…).

2. Поиск НАСТОЯЩЕГО Disk ID этой машины во всей БД
- Снял реальные серийники хоста: Get-PhysicalDisk / Win32_DiskDrive → K200427Y0SNLM7S (Samsung PSSD T7), 0000_0000_0000_0000_6479_A7A7_BAC0_352F. (MSI M560 2TB); серийники томов 3998354654, 1246167210, 1917756804.
- Сделал полный `pg_dump --data-only --inserts` (982 КБ) и грепнул по всем шести значениям + PHYSICALDRIVE + модели дисков → 0 совпадений. Настоящий серийник в базу не попал.
- Тот же дамп грепнул по ключам вида `"...disk...": "..."` → нашлись 12 вхождений diskId в audit_logs (см. находку 1). По `"...hwid...": "..."` → 0.

3. Секреты в логе приложения (bqnb6wieo.output, 6076 строк)
- Серийники дисков: 0. Пароль LiveRun!2026: 0. signingSecret: 0. JWT (eyJ): 0. 'Bearer ': 0. x-api-key: 0. refreshToken: 0. diskId: 0. WD-WCC4N / SEAGATE-Z: 0.
- sessionKey упоминается 4 раза — только как текст сообщения «повторный sessionKey от пользователя <uuid>», без значения.
- Отдельно: `grep -oE '[0-9a-f]{64}'` по всему файлу → НИ ОДНОЙ 64-hex строки. То есть ни sessionKey, ни hwid_hash, ни sha256 payload'а в лог не попадают. Ложных срабатываний разбирать не пришлось.
- Единственная утечка — ключи лицензий в тексте сообщений (находка 2).

4. Логи nginx
- `docker logs lp-nginx` — access-лог в JSON без тел запросов. За окно 13:01–13:05 UTC ровно три записи: POST /api/v1/auth/login (200, 635 б), POST /api/v1/launcher/license/check (200, 221 б), POST /api/v1/launcher/payload (200, 593920 б). Никаких GET на хранилище, никаких presigned-ссылок.
- Остальное в error-логе — шум healthcheck по IPv6.

5. Payload на диске
- nginx: конфиг location `^/api/v\d+/launcher/payload$` содержит `proxy_buffering off; proxy_max_temp_file_size 0; proxy_cache off;` — временный файл запрещён дважды. Фактически: `docker exec lp-nginx find /var/cache/nginx /tmp -type f` → пусто; `find / -xdev -size +500k -size -700k -newermt "2026-08-02 12:00"` внутри контейнера → пусто.
- Контейнера API нет вообще: `docker ps` показывает lp-nginx/lp-postgres/lp-redis/lp-minio/lp-rabbitmq/lp-mailpit, а upstream в конфиге — host.docker.internal:3000, то есть API работает нативно на хосте.
- Хост: рекурсивный поиск файлов 585–600 КБ с LastWriteTime ≥ 12:30 по всему C:\Users\user → только кэши Chrome/Edge/npm, ничего рядом с загрузчиком. Целевой поиск 580–610 КБ за сегодня в C:\Users\user\work\gripulialoader, %TEMP% и в репозитории платформы → пусто.

6. Presigned на payload
- apps/api/src/common/storage/storage.service.ts:179-185 — `createDownloadUrl` первым делом бросает InternalServerErrorException PRESIGNED_FORBIDDEN, если bucket === bucketPayloads. Запрет именно в коде, не в комментарии.
- Вызывающих у метода нет ни одного (grep по всему src даёт только определение и два упоминания в комментариях).
- За окно запуска presigned не выдавался: в access-логе nginx только три запроса (см. п.4), обращений к download-эндпоинтам нет.
- Оговорка: `createUploadUrl` (storage.service.ts:145) такого запрета НЕ имеет — presigned PUT в бакет payloads формально возможен. Это запись, а не чтение, так что утечкой байт не является; отмечаю как факт, а не как находку.

7. Redis
- `redis-cli --scan` (пароль из .env): 139 ключей вида session:revoked:*, payload:rate:<licenseId>, payload:sk:<64hex>, sig:nonce:*, apikey:lp_<prefix>, user:permissions:*.
- Проверил, что payload:sk — это НЕ сам sessionKey: payload.service.ts:422 кладёт `SESSION_KEY_PREFIX + sha256(sessionKey)`, комментарий на :420-421 объясняет почему. Ключи живого прогона уже истекли (TTL 3600 с, прогон в 13:01).

8. Прочие таблицы на предмет секретов в снимках
- `SELECT action, after FROM audit_logs WHERE action IN ('apikey.create','registration_key.issue','license.issue')` → только name/prefix/scopes/ID. Ни ключа API, ни signingSecret в аудите нет.
- launcher_log_batches: 4 строки, file_id пуст, summary — человекочитаемые фразы («не удалось прочитать Disk ID» — это текст ошибки, не значение).

**ресурсы.** Живая выдача: 2026-08-02 13:01:56.497 UTC, POST /api/v1/launcher/payload → 200, 31 мс, req id 019fc291-1772-7278-b9a1-0881c1e4655e (лог bqnb6wieo.output). Проверял на 13:07 UTC, через ~5.5 мин после выдачи.

КОД: полностью прочитаны payload-admission.service.ts, payload-cache.service.ts, payload.service.ts, launcher.controller.ts, health.controller.ts, env.schema.ts (строки 188-231), docker-compose.yml (блок api, строки 161-200).

ЗАПРОСЫ И ИХ ВЫВОД:
1. Освобождение слота. `grep -c "удерживался дольше" bqnb6wieo.output` → 0. Страховочный таймер MAX_HOLD_MS=60_000 (payload-admission.service.ts:187-194) не сработал ни разу за весь лог; сработал бы в 13:02:56, если бы release не пришёл. Значит слот на 593920×3 = 1 781 760 байт освободился из слушателя 'close' на reply.raw. Бюджет вернулся к нулю занятых байт.
2. Postgres. `select state,count(*) from pg_stat_activity where datname='license_platform' group by state` → active 1 (мой же запрос), idle 2. Ни одного 'idle in transaction'. Пофоново: pid 31531, backend_start 13:01:56.415+00, последний запрос UPDATE api_keys SET last_used_at — соединение того самого запроса, живо и свободно.
3. Redis. `client list` → ровно 3 соединения приложения: 1 командное (cmd=del) + 2 подписчика (settings:invalidate и payload:invalidate). `info clients` → connected_clients:4 (четвёртое — мой redis-cli), pubsub_clients:2, blocked_clients:0. Дубликат-соединение из PayloadCacheService.onModuleInit не размножилось.
4. Сокеты процесса. `netstat -ano | grep -c " 43556$"` → 7 всего: 3×Redis(6389), 2×Postgres(5442), listener :3000, 1 входящее от nginx. К MinIO (9000) ни одного висящего — соединение чтения объекта закрыто.
5. Память. pid 43556 (`node --enable-source-maps dist/main`, слушает :3000, старт 11:51:06 UTC, аптайм ~76 мин): WorkingSet 161.5 МБ, Private 208.3 МБ. Для NestJS+Fastify+Prisma это обычная база; payload 580 КБ = 0.36% от неё и отдельно не различим (см. находку про наблюдаемость).
6. Сессии. `select ... from sessions s join users u ... where u.username='live78674'` → ровно 1 строка: 019fc291-1719-767b-bfc4-2ea9815a06c4, created_at 13:01:56.378, expires_at 2026-09-01, revoked_at пуст, device 'Launcher 1.0.0'. refresh_tokens → ровно 1 строка на ту же сессию, revoked_at пуст, replaced_by_id пуст (ротации не было), used_at пуст. Лишнего не наплодилось.
7. Redis-ключи выдачи. `keys payload:*` → payload:rate:019fc284-84c0-73bc-9079-dd7e896c2ee4 val=1 ttl=3256 (окно 3600 с, EXPIRE поставлен на первой единице — корректно), payload:sk:<хеш> val=1 ttl=233. TTL проставлены на обоих классах ключей, вечных записей нет.
8. Настройки. `select key,value from settings where key like 'limits.payload%'` → inflight_bytes_max=134217728, cache_bytes_max=67108864, soft=20, hard=60.
9. Наблюдаемость. `grep -rn "\.stats\(" .` по всему репо кроме node_modules → No matches. `grep -rn "metrics|prom-client|Prometheus" apps/api/src` → пусто. HTTP-эндпоинтов кроме /health/live и /health/ready нет; ни один из них не отдаёт ни reserved, ни entries.

---

## Находки

### 1. [КРИТИЧНО] [журнал] У ВСЕХ отказных строк payload_issues license_id, device_id и product_id = NULL. Журнал соединяется с лицензией и устройством только на успешных выдачах; половина таблицы, ради которой она заводилась («тот, кому двести раз отказали по HWID_MISMATCH»), не привязана ни к чему.

**Доказательство.**

```
SQL: SELECT result, count(*) rows, count(license_id), count(device_id), count(product_id) FROM payload_issues GROUP BY result;
ISSUED               | 12 | 12 | 12 | 12
DENIED_LICENSE       | 10 |  0 |  0 |  0
DENIED_HWID          |  5 |  0 |  0 |  0
DENIED_NOT_BOUND     |  5 |  0 |  0 |  0
DENIED_NOT_ACTIVATED |  5 |  0 |  0 |  0
25 отказов из 25 — без license_id/device_id/product_id.
Причина в коде, payload.service.ts:177-189: `const resolved = await this.launcher.resolveForLauncher({...}); ctx.productId = resolved.product.id; ctx.licenseId = resolved.license.id; ctx.deviceId = ...`. Присваивание идёт ПОСЛЕ await. Все отказы LICENSE_EXPIRED / LICENSE_BLOCKED / LICENSE_REVOKED / LICENSE_NOT_FOUND / LICENSE_NOT_BOUND / LICENSE_NOT_ACTIVATED / HWID_MISMATCH / DEVICE_BLOCKED бросаются ВНУТРИ resolveForLauncher (launcher.service.ts:139-198), то есть до присваивания, и recordDenial (payload.service.ts:551-570) пишет ctx.licenseId === undefined → NULL. При этом резолвер в момент броска уже держит и product.id (строка 133), и license.id (строка 142), и license.currentDeviceId — просто выбрасывает их вместе с исключением.
```

**Влияние.** Индекс payload_issues_license_id_created_at_idx (schema.prisma:776) для отказов бесполезен: запрос «покажи все попытки по лицензии X» вернёт только успехи, а именно серия отказов и есть сигнал. Сценарий из докстринга payload-issues.service.ts (шаринг: одна лицензия — двадцать человек, ловится счётом в разрезе лицензии/HWID/IP) для отказной половины не работает. Аналогично не работает разрез по продукту и по устройству: DENIED_HWID нельзя соотнести с заблокированным/подменённым устройством, DEVICE_BLOCKED теряет device_id, который резолвер вернул бы в bind.deviceId. Остаётся только user_id + hwid_hash, а при нескольких лицензиях одного пользователя на разные продукты они не разделяются вообще.

**Правка.** Заполнять ctx до броска: либо передавать в resolveForLauncher мутируемый объект-контекст и писать в него product.id / license.id / currentDeviceId сразу после чтения строк, либо прикреплять эти идентификаторы к выбрасываемым ForbiddenException/NotFoundException (в поле response) и разбирать их в recordDenial рядом с codeOf(). Ретроспективно 25 существующих строк восстановлению не подлежат.

### 2. [КРИТИЧНО] [крипто-состояние] Секрет подписи API-ключа кладётся в Redis в ОТКРЫТОМ виде и через AOF/RDB попадает на диск — ровно то, чего проект избегает для sessionKey. В Postgres то же поле хранится зашифрованным, то есть шифрование at-rest обходится кэшем.

**Доказательство.**

```
Код: apps/api/src/modules/launcher/guards/signature.guard.ts:117-132 — `const signingSecret = this.crypto.decrypt(key.signingSecretEnc, ...)`, затем `await this.redis.client.set(cacheKey, JSON.stringify({id, signingSecret, scopes}), 'EX', 300)`.
Факт на диске (том license-platform_redis_data -> /var/lib/docker/volumes/license-platform_redis_data/_data):
  docker exec lp-redis sh -c 'grep -c signingSecret /data/appendonlydir/appendonly.aof.1.incr.aof' -> 15
  strings /data/dump.rdb | grep -c signingSecret -> 1
  tr '\r' '\n' < AOF | grep -A4 'apikey:lp_39ca7fad' ->
    apikey:lp_39ca7fad
    $188
    {"id":"019fc284-7e2f-77fb-91c0-835e050dff06","signingSecret":"VvuUQUZmWzJSlNNwwf... (обрезано)
Это api-ключ живого запуска (X-Api-Key lp_39ca7fad).
В БД то же значение зашифровано: SELECT prefix,left(signing_secret_enc,45) FROM api_keys ORDER BY created_at DESC LIMIT 3 ->
  lp_39ca7fad | v1.J3RH4bpoq-iLZEK1.spFqsdjbkAxGr4DzBaiqhQ.Uo | 101
В AOF лежат 15 РАЗНЫХ секретов (по одному на ключ сборки), т.е. это накопительная утечка, а не разовая.
Противоречие с собственным решением проекта — payload.service.ts:423-425: «В Redis уходит ХЕШ: сам sessionKey — ключ к содержимому ответа, и его место не в кэше с allkeys-lru, дамп которого никем не считается секретом».
```

**Влияние.** Кто получил дамп Redis, бэкап тома или доступ к контейнеру lp-redis — получает секреты подписи ВСЕХ сборок загрузчика в открытом виде, без ключа шифрования приложения. С ними подделываются любые подписанные запросы к /api/v1/launcher/* от имени легальной сборки: обходится гейт §3.3/п.14 ТЗ, и в частности можно самому запрашивать payload. Шифрование api_keys.signing_secret_enc (AES-GCM с AAD table/column/rowId) перестаёт что-либо защищать: копия открытого текста лежит рядом на том же хосте. RDB/AOF переживают перезапуск, так что срок жизни утечки — не 300 секунд TTL, а срок жизни файла.

**Правка.** Не хранить открытый секрет в Redis. Варианты по возрастанию затрат: (1) кэшировать в памяти процесса, как уже сделано для payload'а в payload-cache.service.ts (тот же аргумент «RDB и AOF кладут актив на диск» дословно применим здесь); (2) если кэш обязан быть общим — класть в Redis ШИФРОТЕКСТ signingSecretEnc и расшифровывать на каждое попадание (экономится запрос в Postgres, секрет на диск не уезжает); (3) как минимум отключить persistence для этой роли Redis (appendonly no + save ""), раз redis.service.ts:16-20 сам утверждает, что «ни одна из ролей не требует сохранности данных».

### 3. [КРИТИЧНО] [гигиена] Сырой Disk ID пишется в БД открытым текстом: audit_logs.after хранит тело запроса POST /api/licenses/:id/hwid/set целиком, вместе с полем diskId. 12 строк уже лежат в базе.

**Доказательство.**

```
SQL: `SELECT count(*) FROM audit_logs WHERE after ? 'diskId';` → 12.
Содержимое: `SELECT action, after FROM audit_logs WHERE action='hwid.set_manual' ORDER BY created_at DESC LIMIT 4;` →
  019fc24c-689a… | hwid.set_manual | {"diskId": "SEAGATE-Z1234567"}
  019fc24c-6893… | hwid.set_manual | {"deviceId": "019fc24c-688c-70e7-a50c-643199ea0bd2"}
  019fc24c-64bb… | hwid.set_manual | {"diskId": "  wd-wcc4n 1234567  "}
(видно, что на одно действие пишутся ДВЕ записи: безопасная из сервиса и «сырая» из интерцептора)

Механизм — C:/Users/user/work/kwork/license-platform/apps/api/src/common/audit/audit.interceptor.ts:46:
  `after: request.body ?? null,`  с комментарием «Секреты вырезает AuditService».
Но в C:/Users/user/work/kwork/license-platform/apps/api/src/common/audit/audit.service.ts:28-52 список REDACTED_FIELDS содержит 'hwidEnc'/'hwid_enc', но НЕ содержит 'diskId' и не содержит 'hwid'. Значит вырезать нечего.

Ирония в том, что сервисный путь сделан правильно и знает про запрет — C:/Users/user/work/kwork/license-platform/apps/api/src/modules/hwid/hwid.service.ts:385-387:
  «Сам Disk ID в аудит НЕ пишем: по ТЗ п.7 он не показывается даже владельцу…»
  `after: { deviceId: device.id },`
а декоратор @Audit на C:/Users/user/work/kwork/license-platform/apps/api/src/modules/hwid/hwid.controller.ts:94 рядом же кладёт тело с diskId в обход этого решения.

В живом прогоне значения тестовые (WD-WCC4N1234567 / SEAGATE-Z1234567), потому что через этот эндпоинт ходили тесты, а не загрузчик. Настоящих серийников машины в базе нет: полный pg_dump проверен на K200427Y0SNLM7S, 0000_0000_0000_0000_6479_A7A7_BAC0_352F, серийники томов 3998354654/1246167210/1917756804 — 0 совпадений. То есть дефект не в том, что утекло сейчас, а в том, что утечёт при первом же реальном обращении в поддержку.
```

**Влияние.** Журнал аудита хранится годами и читается людьми (по замыслу — сотрудниками поддержки). Любой сотрудник с правом чтения аудита получает сырой Disk ID чужой машины — ровно то, что ТЗ п.7 запрещает показывать даже владельцу лицензии. Из сырого Disk ID тривиально считается hwid_hash (HMAC на стороне сервера), то есть аудит становится обходом всей схемы «в базе только хеш и шифротекст». Дополнительно: любой будущий эндпоинт с @Audit, принимающий diskId/hwid в теле, унаследует ту же дыру молча.

**Правка.** 1) Добавить в REDACTED_FIELDS (apps/api/src/common/audit/audit.service.ts:28) поля 'diskId', 'disk_id', 'hwid', 'hwidHash', 'hwid_hash'. Список и так объявлен избыточным намеренно — это его прямое назначение.
2) Почистить историю: `UPDATE audit_logs SET after = jsonb_set(after, '{diskId}', '"[REDACTED]"') WHERE after ? 'diskId';` (12 строк).
3) Отдельно решить дублирование: на hwid.set_manual пишутся две записи (интерцептор + сервис). Либо снять @Audit с контроллера (hwid.controller.ts:94), раз сервис пишет аудит сам, либо дать декоратору белый список полей тела вместо «всё тело целиком».

### 4. [ВАЖНО] [журнал] Кэша проверки лицензии в Redis не существует: launcher.service.ts объявляет CHECK_CACHE_PREFIX и удаляет ключ, но никто его никогда не создаёт. Два заявленных в докстринге свойства (бюджет 150 мс без пересчёта из базы и «кратковременная недоступность Postgres не останавливает всех пользователей разом») сегодня ложны.

**Доказательство.**

```
grep по apps/api/src: 'license:check:' встречается ровно дважды — launcher.service.ts:24 (объявление константы) и launcher.service.ts:302 (`await this.redis.client.del(`${CHECK_CACHE_PREFIX}${licenseId}`)`). Ни одного SET/SETEX. Эмпирически после ДВУХ успешных license/check (13:01:56 и 13:08:48) по этой лицензии: `redis-cli --scan --pattern 'license:*'` → только license:touch:019fc284-84c0... и license:online:019fc284-84c0..., ключа license:check: нет. Комментарий-обещание — launcher.service.ts:11-22.
```

**Влияние.** Каждая проверка лицензии идёт в Postgres минимум тремя запросами (product.findUnique, license.findFirst, license.findUniqueOrThrow внутри hwid.bindOrVerify). При падении Postgres останавливаются ВСЕ пользователи сразу — ровно тот режим отказа, который докстринг объявляет закрытым; льготного периода на сервере нет. Метод invalidate(), вызываемый при отзыве/блокировке/сбросе HWID, — no-op, что маскирует проблему (выглядит так, будто кэш есть и корректно инвалидируется).

**Правка.** Либо реализовать запись кэша (SET license:check:<id> с TTL limits.license.check_cache_ttl_sec и учётом того, что привязка всё равно проверяется каждый раз), либо удалить CHECK_CACHE_PREFIX/invalidate() и привести докстринг launcher.service.ts:11-22 в соответствие с фактом.

### 5. [ВАЖНО] [журнал] Задвоение аудита в системе есть — но не на payload. Пять действий пишутся в audit_logs дважды: интерцептором по @Audit и вручную из сервиса, причём две строки взаимно неполные, ни одна не содержит всех полей.

**Доказательство.**

```
SQL по всей таблице:
apikey.create       | без entity_id 17 | без actor_label 17 | всего 34
apikey.revoke       | 0 | 13 | 26
hwid.set_manual     | 0 | 12 | 24
hwid.counter_adjust | 0 |  4 |  8
license.revoke      | 0 |  4 |  8
Пара из окна запуска, действие одно, строк две:
12:48:10.873 apikey.create actor_label=NULL entity_id=019fc284-7e2f-77fb-91c0-835e050dff06 ip=NULL   (из api-key.service.ts:69-76)
12:48:10.877 apikey.create actor_label='admin:019fb31a-...' entity_id=NULL ip=127.0.0.1        (из AuditInterceptor по @Audit auth.controller.ts:440 — у декоратора нет entityIdFrom)
Парные объявления: @Audit auth.controller.ts:440,473 vs audit.record в api-key.service.ts:70,117; @Audit hwid.controller.ts:94,111 vs hwid.service.ts:380,423; @Audit licenses.controller.ts:132 vs licenses.service.ts:299. Отдельно расходятся имена: сервис пишет hwid.reset.user_reset / hwid.reset.admin_reset (hwid.service.ts:573, `hwid.reset.${reason.toLowerCase()}`), а декоратор — hwid.reset.user / hwid.reset.staff (hwid.controller.ts:59,76); в таблице лежат все четыре: user_reset 4, user 4, admin_reset 4, staff 4.
На payload задвоения нет: audit_logs за 13:00–13:05 → 0 строк, @Audit на POST /launcher/payload отсутствует.
```

**Влияние.** Счётчики действий в админке и отчётах завышены ровно вдвое по этим пяти действиям. Расследование по одной строке даёт неполную картину: у «сервисной» строки нет ни актора-подписи, ни IP, у «интерцепторной» apikey.create — нет entity_id, то есть непонятно, какой ключ выпустили. Разные имена одного действия (hwid.reset.user и hwid.reset.user_reset) ломают фильтр по action.

**Правка.** Оставить один источник на действие: либо снять @Audit с этих четырёх контроллеров, либо убрать audit.record из сервисов и дописать декораторам entityIdFrom/before-after. Имена hwid.reset.* привести к одному словарю.

### 6. [ВАЖНО] [крипто-состояние] Кэш проверки лицензии `license:check:*` не существует: код только УДАЛЯЕТ этот ключ, записи нет ни одной. Заявленная роль №1 Redis и льготный период при недоступности Postgres (§6.2.1) не реализованы, а invalidate() при отзыве/блокировке — no-op.

**Доказательство.**

```
grep -rn "license:check\|CHECK_CACHE_PREFIX" apps/api/src ->
  launcher.service.ts:24  const CHECK_CACHE_PREFIX = 'license:check:';
  launcher.service.ts:302 await this.redis.client.del(`${CHECK_CACHE_PREFIX}${licenseId}`);
Больше вхождений нет — ни одного SET.
Факт в Redis: redis-cli --scan --pattern 'license:check:*' -> 0 ключей.
Факт за всю историю: grep -ac "license:check:" /data/appendonlydir/appendonly.aof.1.incr.aof -> 0 (файл 2 535 178 байт, ведётся с 30 июля).
Для контраста соседний ключ той же функции пишется и виден: grep -ac "license:online:" AOF -> 31, живой ключ license:online:019fc284-84c0-73bc-9079-dd7e896c2ee4, TTL 54.
При этом launcher.service.ts:14-21 документирует: «Бюджет ответа — 150 мс, поэтому результат проверки кэшируется в Redis, а не пересчитывается из базы на каждый запрос... кратковременная недоступность Postgres не останавливает всех пользователей разом».
```

**Влияние.** Каждый /license/check ходит в Postgres целиком (resolveForLauncher + pickLicense + hwid + updateInfo). При 1000 онлайн с recheckAfterSec=60 это ~17 rps сложных запросов в БД вместо попаданий в кэш — бюджет 150 мс держится только на текущей пустой нагрузке. Главное: при падении Postgres проверка лицензии падает у ВСЕХ сразу, льготного периода §6.2.1 нет — он описан в комментарии, но не в коде. Плюс LauncherService.invalidate() (отзыв, блокировка, сброс HWID) удаляет несуществующий ключ, то есть выглядит как инвалидация, но ничего не инвалидирует — если кэш когда-нибудь допишут, тест на отзыв будет проходить и в сломанном виде.

**Правка.** Либо реализовать запись кэша в LauncherService.check() (SET license:check:<licenseId> с TTL = limits.license.check_cache_ttl_sec, сейчас 60) и чтение в начале check(), либо удалить CHECK_CACHE_PREFIX и invalidate() вместе с комментарием про 150 мс и льготный период, чтобы документ не описывал несуществующее свойство. Промежуточный вариант хуже всего: сейчас читатель кода уверен, что кэш есть.

### 7. [ВАЖНО] [логи] nginx на каждом третьем коннекте бьётся в мёртвый IPv6-адрес апстрима и спасается прозрачным ретраем; запрос payload прошёл с первой попытки по удаче, а не потому что схема здорова

**Доказательство.**

```
docker logs lp-nginx: 103 строки `connect() to [fdc4:f303:9324::254]:3000 failed (101: Network unreachable) while connecting to upstream` + 103 парных `upstream server temporarily disabled`, первая в 11:53:46 (POST /api/v1/auth/register), последняя в 13:09:33; за ~76 мин аптайма при пробах раз в 15 с это ~1/3 всех коннектов. `docker exec lp-nginx getent ahosts host.docker.internal` → `192.168.65.254` И `fdc4:f303:9324::254`; `ip -o addr show` в контейнере: на eth0 только `172.22.0.5/16`, глобального IPv6 нет → connect по AAAA всегда ENETUNREACH. В конфиге `upstream api_upstream { server host.docker.internal:3000; keepalive 32; }` — без параметров, т.е. max_fails=1, fail_timeout=10s. Ретрай виден прямо в access-логе по двойному значению: `"uri":"/api/v1/auth/register","status":201,"upstream_time":"0.000, 0.072"`, `"uri":"/api/v1/auth/login","upstream_time":"0.000, 0.079"`, `"uri":"/api/v1/auth/refresh","upstream_time":"0.000, 0.019"` (13:08:47) — 3 записи из 33. У самого разбираемого payload'а `"upstream_time":"0.044"` — одно значение, ретрая не было.
```

**Влияние.** Сейчас маскируется ретраем на connect-фазе (POST при этом безопасен: nginx по умолчанию не переотправляет неидемпотентный запрос после его передачи бэкенду, так что двойной выдачи payload это не даёт). Но max_fails=1 на ЖИВОМ peer'е означает: одна транзиентная ошибка коннекта к API снимает его на 10 секунд, второй peer мёртв всегда → «no live upstreams» → 502 всем запускающимся в течение этих 10 секунд. Плюс лог nginx на 70% состоит из этого шума, и настоящая ошибка апстрима в нём не заметна.

**Правка.** Задать API_UPSTREAM в IPv4-виде (`server 192.168.65.254:3000` / имя без AAAA), либо явно `server host.docker.internal:3000 max_fails=3 fail_timeout=5s;`. Проверять после правки по отсутствию запятой в $upstream_time.

### 8. [ВАЖНО] [логи] Ошибки, порождённые самим nginx, кроме 429 и 503, приходят клиенту HTML-страницей вместо ApiErrorBody — вопреки тому, что конфиг сам про себя пишет

**Доказательство.**

```
Активная проверка: `curl -X POST http://127.0.0.1:8080/api/v1/launcher/payload -H 'Content-Type: application/json' --data-binary @big.bin` (20000 байт) → `HTTP/1.1 413 Request Entity Too Large`, `Content-Type: text/html`, тело `<html><head><title>413 Request Entity Too Large</title></head>...`. В access-логе это `"status":413,"bytes":176,"upstream_time":""` — до приложения не дошло, в логе API следа нет. В nginx -T объявлены только `error_page 429 = @json429;` и (в location payload) `error_page 503 = @json503;`; для 413/502/504 ничего нет, при том что комментарий в конфиге утверждает: «Форма тела совпадает с ApiErrorBody приложения, поэтому клиент разбирает её тем же кодом».
```

**Влияние.** Загрузчик, разбирающий тело как ApiErrorBody, на 413 (тело запроса > 8k в location payload) и на 502/504 (достижимы, см. находку про IPv6-апстрим) покажет «неизвестную ошибку» вместо внятного текста. Заголовок Cache-Control: no-store при этом на месте — ломается только разбор тела.

**Правка.** Добавить в server-блок `error_page 400 405 408 413 414 431 500 502 503 504 = @jsonerr;` с named location, отдающим ту же форму {statusCode, code, message, requestId, timestamp}, подставляя $status.

### 9. [ВАЖНО] [логи] Фильтр шума /health в логгере приложения не работает: 73% лога — успешные health-пробы, ровно то, от чего он должен был защищать

**Доказательство.**

```
В файле лога 432 строки «request completed», из них 314 с `"url": "/health/live"`. Идут прямо сейчас, раз в 15 с: последние — 13:11:04, 13:11:19, 13:11:34, 13:11:49, 13:12:04. При этом в apps/api/src/common/logger/logger.module.ts:104-109 стоит `autoLogging: { ignore: (req) => (req as {url?:string}).url ?? '' ).startsWith('/health') }`. Файл изменён 2026-08-01 04:38 (+04), процесс поднят 2026-08-02 11:51 UTC — код в процессе актуальный, дело не в устаревшей сборке. Проверил ту же опцию на установленном pino-http 10.5.0 (apps/api/node_modules/pino-http, version 10.5.0) отдельным Node-скриптом с голым http-сервером: /health/live корректно НЕ логируется, логируется только /api/v1/x. Также проверил гипотезу о мутации opts (`delete opts.autoLogging` в logger.js:65) — pino-http копирует опции, повторный вызов ignore не теряет. Значит предикат в связке Nest+Fastify получает req без ожидаемого url.
```

**Влияние.** В окне 13:00–13:05 полезных строк 4, шумовых health — 20. При разборе инцидента лог приходится грепать, а при ротации по объёму реальные события вытесняются пробами в 4 раза быстрее. Это ровно тот исход, который описан в комментарии над самой опцией («Без этого 90% лога — успешные /health»), то есть защита формально есть и не действует.

**Правка.** Перейти на модульную опцию nestjs-pino `exclude` (LoggerModule.js:76 её принимает: `LoggerModule.forRootAsync({ ..., exclude: [{ path: 'health/(.*)', method: RequestMethod.ALL }] })`), либо в предикате читать url устойчиво: `const u = req.originalUrl ?? req.url ?? req.raw?.url ?? ''`. После правки проверить, что новых строк с /health/live в логе не появляется.

### 10. [ВАЖНО] [логи] Стартовый WARN про fail-open ключей API остался незамеченным и актуален прямо сейчас

**Доказательство.**

```
[11:51:07.671] WARN (context ApiScopeGuard): «ключей API без ограничения по scope: 3 — lp_d88eaa92 (diag), lp_980dcba0 (C++ smoke 847308373), lp_9f21e699 (C++ smoke 712021601). Пустой scopes трактуется как «все эндпоинты» (переходное правило). Пока такие ключи существуют, @RequireApiScope их не ограничивает.» Комментарий в api-scope.guard.ts:40-54 сам называет это fail-open и просит не забыть. Ключи не отозваны: guard выбирает их через `where: { revokedAt: null, scopes: { isEmpty: true } }`.
```

**Влияние.** Три живых ключа сборки, два из которых — мусор от smoke-тестов, подписывают ЛЮБОЙ эндпоинт, включая POST /api/v1/launcher/payload. Ограничение по scope на ревью выглядит включённым, но на этих ключах не действует.

**Правка.** Отозвать lp_980dcba0 и lp_9f21e699 (smoke-мусор), lp_d88eaa92 (diag) — либо отозвать, либо проставить scopes. По Д12 в docs/PAYLOAD-DESIGN.md способа проставить scopes существующему ключу сегодня нет — это и есть блокер выхода из fail-open.

### 11. [ВАЖНО] [гигиена] Ключ лицензии в открытом виде уходит в лог приложения на уровне INFO — при том что политика логирования этого же проекта явно относит его к секретам.

**Доказательство.**

```
Лог C:/Users/user/AppData/Local/Temp/claude/C--Users-user-work-kwork/47b7fbe6-897e-4593-992a-8101b06452e2/tasks/bqnb6wieo.output, строка 5777 (живой прогон, 13:01:56):
  `[13:01:56.446] INFO: первая привязка лицензии FC26-VQH6-UKKR-M2TC-TMZW`
Всего в файле 5 разных ключей: FC26-2RQC-E7DQ-74Q8-E6PZ, FC26-4W6W-AHDA-Y8QK-GJN3, FC26-AZWH-FDZA-82GW-TKUW, FC26-VQH6-UKKR-M2TC-TMZW, FC26-W6RF-JGAZ-DGKR-47XK.
Принадлежность подтверждена: `SELECT l.key, u.username FROM licenses l JOIN users u ON u.id=l.user_id WHERE l.key='FC26-VQH6-UKKR-M2TC-TMZW';` → live78674.

Источник — C:/Users/user/work/kwork/license-platform/apps/api/src/modules/hwid/hwid.service.ts:177:
  `this.logger.log(\`первая привязка лицензии ${license.key}\`);`
и ещё 4 таких же места: hwid.service.ts:206, :433, :582, licenses.service.ts:308.

Противоречие с собственной политикой: C:/Users/user/work/kwork/license-platform/apps/api/src/common/logger/logger.module.ts:74 включает 'req.body.licenseKey' в redact с комментарием на строках 55-57: «hwid и licenseKey здесь не паранойя: … ключ лицензии — это, по сути, предъявительский документ». redact в pino работает по путям структурированных полей и НЕ трогает текст сообщения, поэтому интерполяция в строку проходит мимо цензора.
```

**Влияние.** Ключ лицензии попадает в архив логов и в любой сборщик логов, куда этот JSON уедет на проде. Доступ к логам обычно шире, чем доступ к БД (dev, SRE, внешний сервис агрегации), а ключ по замыслу проекта — предъявительский документ. Побочно: 5 ключей в одном тестовом прогоне показывают, что на живом трафике лог превратится в готовый список ключей.

**Правка.** Логировать licenseId вместо license.key во всех пяти местах (hwid.service.ts:177,206,433,582; licenses.service.ts:308) — идентификатор ищется по базе и ничего не открывает. Если нужен человекочитаемый маркер — маскированный хвост (`…TMZW`). Заодно стоит понимать, что redact-пути 'req.body.*' в logger.module.ts сегодня мертвы: сериализатор req (logger.module.ts:85-98) тело вообще не включает, так что от интерполяции в сообщение не защищает ничто.

### 12. [ВАЖНО] [ресурсы] За бюджетом допуска и кэшем нельзя наблюдать вообще: stats() у обоих сервисов — мёртвый код, метрик в проекте нет, живая выдача не оставила ни одной строки от этих сервисов.

**Доказательство.**

```
grep -rn "\.stats\(" по всему C:/Users/user/work/kwork/license-platform (исключая node_modules) → "No matches found", при том что методы объявлены: payload-admission.service.ts:132 `stats(): { reservedBytes; queued; budgetBytes }` и payload-cache.service.ts:176 `stats(): { entries; bytes; inFlight }` с комментарием «Диагностика для тестов и логов». Ни тестов, ни логов, ни эндпоинта. grep -rn "metrics|prom-client|Prometheus" по apps/api/src → пусто. В health.controller.ts только live (uptimeSec) и ready (postgres/redis up/down) — ни байт, ни очереди. В логе вокруг живой выдачи 13:01:56.497 единственная строка — «request completed / statusCode 200 / responseTime 31»; строк с context PayloadAdmissionService или PayloadCacheService в файле нет ни одной (grep по обоим именам → пусто).
```

**Влияние.** Исчерпаемый ресурс (128 МиБ байтового бюджета) не имеет ни одного индикатора. Утечка слота обнаруживается только тогда, когда пользователи начинают получать 503 SERVICE_UNAVAILABLE, причём /health/ready при этом остаётся зелёным (он проверяет только доступность Postgres и Redis). Отличить «сервер перегружен» от «учёт поехал» дежурный не сможет ничем, кроме перезапуска процесса. Тот же слепой угол у кэша: размер, число записей и число зависших полётов невидимы.

**Правка.** Поднять MetricsModule (или хотя бы периодический INFO-лог раз в N секунд / расширить /health/ready полем diagnostics) и вывести туда reservedBytes, budgetBytes, queued, entries, bytes, inFlight. Признано в docs/PAYLOAD-DESIGN.md:427 как отложенное («MetricsModule отделим, но алерты обязаны появиться ДО включения в проде») — то есть это гейт на прод, а не косметика.

### 13. [ВАЖНО] [ресурсы] Настройка limits.payload.cache_bytes_max — мёртвая ручка: она засеяна, лежит в БД, задокументирована, и не читается ни одной строкой кода.

**Доказательство.**

```
grep -rn "cache_bytes_max" по репо даёт ровно три места: apps/api/prisma/seed.ts:236 (засев значения 67_108_864 с описанием «Размер кэша payload в памяти процесса»), docs/PAYLOAD-DESIGN.md:370 (обещание, что настройка добавляется) — и всё. В БД значение есть: select key,value from settings → limits.payload.cache_bytes_max | 67108864 | 2026-08-02 11:40:31.352+00. При этом PayloadCacheService не получает SettingsService вообще (конструктор payload-cache.service.ts:115-119 принимает только ENV, StorageService, RedisService), а потолок берётся из окружения: строка 348 `const max = this.env.PAYLOAD_CACHE_MAX_BYTES`. Контраст в соседнем файле: PayloadAdmissionService свою настройку ЧИТАЕТ — payload-admission.service.ts:145 `this.settings.getNumber('limits.payload.inflight_bytes_max', ...)`.
```

**Влияние.** Администратор меняет размер кэша payload в панели настроек, значение сохраняется, никакой ошибки не показывается — и ничего не происходит до передеплоя с новым PAYLOAD_CACHE_MAX_BYTES. Ровно тот сценарий, ради которого настройки и заводились («их меняют без перезапуска», env.schema.ts:188-191). Особенно неприятно при разборе инцидента с памятью: единственный доступный рычаг («срезать кэш») выглядит применённым и не применён.

**Правка.** Либо внедрить SettingsService в PayloadCacheService и читать limits.payload.cache_bytes_max в store() тем же способом, что admission читает свой ключ (с падением на env при недоступности БД), либо убрать ключ из seed.ts и из PAYLOAD-DESIGN.md:370, чтобы ручки, которой нет, не существовало и в панели.

### 14. [ВАЖНО] [критик] Вывод «настоящий серийник диска в базу не попал» неверен: devices.hwid_enc расшифровывается в точный серийник этой машины. Проверка была сделана плоским грепом по дампу, который по шифротексту не сработает никогда.

**Доказательство.**

```
SELECT hwid_enc FROM devices WHERE id='019fc291-1751-76cd-956d-4bbc54c206c5' → v1.2yMqihgk4qlQk6Fo.-33FG7mIXdXjw2CIGw4xqA.JOPyqHin_IhCLyeJ7i_o8xaNdKYwA0kNiH4mXlpCqRT4kQWCNtd2lw. Расшифровка AES-256-GCM ключом ENCRYPTION_KEY из ./.env с AAD 'devices.hwid_enc:019fc284-84c0-73bc-9079-dd7e896c2ee4' → PLAINTEXT_LEN=40, значение побайтово равно выводу Get-CimInstance Win32_DiskDrive для MSI M560 2TB (включая хвостовую точку). Запись делается hwid.service.ts:142 и :342 через crypto.encrypt(normalizeDiskId(diskId)).
```

**Влияние.** Дамп базы плюс файл ./.env, лежащий в том же каталоге репозитория, дают открытые Disk ID всех пользователей. Это штатное поведение схемы (поле заведено ровно для этого), но зафиксировано оно было как «серийника в базе нет», то есть риск снят с учёта на основании проверки, которая физически не могла его увидеть. Вместе с уже найденным plaintext-diskId в audit_logs это два независимых места хранения одного идентификатора.

**Правка.** Переписать вывод: серийник в базе есть в devices.hwid_enc (обратимо) и в audit_logs.after (открыто). Проверять его наличие расшифровкой, а не грепом. Отдельно — развести ENCRYPTION_KEY и место хранения дампов, иначе шифрование поля не даёт ничего сверх обфускации.

### 15. [ВАЖНО] [критик] Периодической перепроверки лицензии в живом потоке не происходит ни разу: загрузчик завершается через ~10 секунд после инъекции и Recheck() не вызывает. Требование ТЗ §6.2.1 («очередная периодическая проверка не прошла — работа прекращается немедленно») в реальном запуске не работает, потому что очередной проверки нет.

**Доказательство.**

```
grep по Griloder.cpp: используются только session.Begin() (строка 260) и session.FetchPayload() (строка 321); вызова .Recheck() нет ни одного (Session.cpp:295 — это внутренний однократный повтор внутри FetchPayload, а не таймер). Клиентский лог: 17:02:07.857 SUCCESS → 17:02:17.961 «Target alive 10s after injection» → «Driver connection closed» → Session End, процесс вышел. Серверный лог 13:02–13:08: между запусками только health-пробы каждые 15 с, ни одного POST /launcher/license/check. licenses.last_check_at меняется только в моменты запусков (13:01:56 → 13:08:48 → 13:15:01).
```

**Влияние.** Отзыв, блокировка или истечение лицензии в середине сессии не останавливают продукт: DLL уже в процессе игры, а загрузчика больше нет. Единственный рубеж — следующий запуск. recheckAfterSec=300, который сервер честно считает и отдаёт, никто не потребляет; строгий режим §6.2.1 существует только в коде класса Session.

**Правка.** Либо оставить загрузчик живым на время работы продукта и завести таймер Recheck() с остановкой по §6.2.1, либо честно записать в ТЗ, что проверка одноразовая на запуск, и убрать из контракта recheckAfterSec — сегодня документ обещает то, чего в сборке нет.

### 16. [ВАЖНО] [критик] Кэш открытых байт payload'а не дал ни одного попадания ни на одном из трёх реальных запусков: TTL записи 60 секунд, а запуски идут раз в 6-7 минут. Каждый запуск — это полное чтение объекта из MinIO и пересчёт sha256 на 580 КБ.

**Доказательство.**

```
env.schema.ts:214 PAYLOAD_CACHE_TTL_MS default 60_000; в ./.env нет ни одной переменной PAYLOAD_* (греп → 0). payload-cache.service.ts:152 отдаёт запись только при Date.now()-storedAt < TTL, иначе drop и повторный fill. Выдачи: 13:01:56.494, 13:08:48.084, 13:15:01.681 — интервалы 412 и 374 с. responseTime в логе сервера: 31, 32, 31 мс — одинаковые, без ускорения на втором и третьем запросе. Сборка 1.0.3310 опубликована в 12:48, первая её выдача — 13:01:56, то есть и первый запуск был холодным.
```

**Влияние.** Свойство «500 одновременных запусков дают 1 GET» верно только внутри 60-секундного окна. Реальный профиль (пользователи запускаются вразнобой) даёт hit ratio 0: N запусков = N запросов в хранилище и N пересчётов sha256. Наблюдать это нечем — stats() мёртвый код, метрик нет, ни строки в логе от кэша. Настройка limits.payload.cache_bytes_max при этом вообще не читается, а память под просроченной записью удерживается до следующего обращения по тому же ключу.

**Правка.** Поднять TTL до величины, соизмеримой с интервалом между запусками (инвалидация и так идёт через pub/sub, TTL нужен только как backstop на потерянное сообщение), и вывести hit/miss наружу хотя бы строкой лога на промахе — сейчас отличить попадание от промаха можно только по косвенному времени ответа.

### 17. [ВАЖНО] [критик] Шлюз слушает 0.0.0.0:8080 открытым HTTP без TLS и без ограничений по адресу. Изоляция канала, на которую прямо ссылается комментарий в сборке загрузчика, не обеспечена ничем, кроме предположения о том, куда подключится клиент.

**Доказательство.**

```
netstat -ano → TCP 0.0.0.0:8080 LISTENING (плюс [::]:8080). docker exec lp-nginx nginx -T → в конфиге только 'listen 80' и 'listen [::]:80', ни одной директивы ssl/allow/deny. Config.h:31 загрузчика: kBaseOrigin = L"http://100.87.228.44:8080" с комментарием «HTTP тут без TLS, а sessionKey едет в теле запроса — на открытом канале любой на пути выводит тот же ключ и расшифровывает payload. WireGuard закрывает канал целиком».
```

**Влияние.** Любой, кто достаёт до этой машины по LAN-адресу, получает тот же API открытым текстом: пароль в теле POST /auth/login, sessionKey в теле POST /launcher/payload и, следовательно, ключ расшифровки ответа. Вся модель угроз документа построена на «том же TLS-соединении», которого в этой установке нет; живой прогон это не выявил только потому, что клиент и сервер оказались на одной машине.

**Правка.** Либо привязать публикацию порта к интерфейсу Tailscale (ports: 100.87.228.44:8080:80 вместо 8080:80), либо поставить TLS. До этого не считать доказанным ни одно утверждение о конфиденциальности sessionKey.

### 18. [МЕЛОЧЬ] [журнал] Колонка payload_issues.country не заполняется никогда и заполниться не может: у неё нет ни одного производителя. То же у devices.last_country, licenses.last_check_country и login_history.country.

**Доказательство.**

```
SQL по всей БД: payload_issues 0 из 36 непустых country; devices 0 из 18 last_country; licenses 0 из 38 last_check_country; login_history 0 из 532 country. В коде: PayloadIssueEntry.country объявлен (payload-issues.service.ts:50) и записывается (строка 124), но IssueContext в payload.service.ts:104-117 поля country НЕ имеет вовсе, и recordDenial/recordIssued его не передают — то есть по этому пути значение структурно недостижимо. LauncherController.check (launcher.controller.ts) вызывает launcher.check({... ip: req.ip}) без country, хотя параметр в сигнатуре есть (launcher.service.ts:216). Сервиса геолокации в проекте нет: grep по apps/api/src/common на geo|GeoIp|geoip не нашёл ни одного файла.
```

**Влияние.** Гео-корреляция как инструмент антифрода не существует, при этом колонки в четырёх таблицах создают впечатление, что данные собираются. Аналитик, построивший отчёт «выдачи по странам», получит пустой результат и не поймёт, что источника нет.

**Правка.** Либо подключить резолвер страны (по ip в middleware, одно место на все четыре журнала) и добавить country в IssueContext, либо снести колонки/параметры, чтобы схема не обещала того, чего нет.

### 19. [МЕЛОЧЬ] [журнал] IP в журнале и IP в логе приложения для ОДНОГО И ТОГО ЖЕ запроса — разные значения, поэтому сверить журнальную строку с логом по адресу нельзя.

**Доказательство.**

```
Один и тот же запрос payload, request id 019fc291-1772-7278-b9a1-0881c1e4655e:
— лог (bqnb6wieo.output, 13:01:56.497): "ip": "127.0.0.1";
— payload_issues.ip = 172.22.0.1 (и то же в devices.last_ip, licenses.last_check_ip, login_history.ip).
Причина: сериализатор pino пишет req.remoteAddress (logger.module.ts:97 — сырой адрес пира), а все журналы БД пишут req.ip, который при trustProxy:true (main.ts:47) берётся из X-Forwarded-For (payload.service.ts:154, auth.controller.ts:494). Дефект Д15 (docs/PAYLOAD-DESIGN.md:610) описывает подконтрольность req.ip клиенту, но не отмечает, что доверенный адрес пира пишется только в лог и в БД не попадает ни в одну колонку.
```

**Влияние.** При разборе инцидента по строке payload_issues адрес из журнала никогда не найдётся грепом по логу — совпадает только request_id (проверено: совпадает точно). Отличить запрос, пришедший через nginx, от запроса, пришедшего мимо прокси прямо на :3000 (а значит, с полностью выдуманным X-Forwarded-For), по содержимому БД невозможно вовсе.

**Правка.** Либо писать в лог req.ip рядом с remoteAddress (два поля под разными именами), либо добавить в payload_issues отдельную колонку с адресом пира. Минимум — согласовать имя поля, чтобы 'ip' в логе и 'ip' в журнале означали одно и то же.

### 20. [МЕЛОЧЬ] [логи] Все 220 строк стартового лога склеены в одну миллисекунду — время загрузки по логу восстановить нельзя

**Доказательство.**

```
С [11:51:07.670] по [11:51:07.671] идут подряд: инициализация всех модулей, «ключей в связке: 1», «загружено настроек: 49», «SMTP-соединение проверено», маппинг всех роутов, «Nest application successfully started», «API слушает http://localhost:3000/api/v1». Следующая строка — только [11:51:16.336]. Проверка SMTP и загрузка 49 настроек из БД физически не укладываются в 1 мс. Причина в коде: apps/api/src/main.ts:92 `bufferLogs: true`, main.ts:103 `app.useLogger(app.get(Logger))` — pino проставляет время в момент слива буфера, а не в момент события.
```

**Влияние.** Нельзя увидеть, что тормозит на старте (SMTP, БД, миграции), нельзя измерить время подъёма, нельзя соотнести стартовое событие с внешним инцидентом. Порядок строк сохраняется, тайминги — фикция.

**Правка.** Либо принять и задокументировать, либо убрать bufferLogs и настроить pino до NestFactory.create, чтобы стартовые строки шли с настоящим временем.

### 21. [МЕЛОЧЬ] [логи] ApiScopeGuard создаётся в двух экземплярах: onModuleInit отрабатывает дважды, лишний запрос в БД на старте и дублированный WARN

**Доказательство.**

```
В логе строки 219 и 221 — две ПОБУКВЕННО одинаковые WARN-записи «ключей API без ограничения по scope: 3 …» с одинаковым `context: "ApiScopeGuard"` и одинаковым временем 11:51:07.671. Причина: класс объявлен и провайдером модуля (apps/api/src/modules/launcher/launcher.module.ts:26 `ApiScopeGuard,`), и подключён как enhancer на методе (launcher.controller.ts:94 `@UseGuards(ApiScopeGuard)`). Каждый экземпляр реализует OnModuleInit (api-scope.guard.ts:32,56).
```

**Влияние.** Два `prisma.apiKey.findMany` на старте вместо одного и удвоенное предупреждение — на глаз читается как «две разные проблемы». На обработку запроса не влияет: guard на методе вызывается один раз. Отдельно: WARN LegacyRouteConverter про «/api/*» тоже задвоен (строки 57 и 59) — это два вхождения шаблона, другая причина.

**Правка.** Убрать ApiScopeGuard из providers модуля (enhancer инстанцируется сам), либо перенести проверку scopes из onModuleInit guard'а в отдельный сервис, который заведомо синглтон.

### 22. [МЕЛОЧЬ] [ресурсы] TTL записи кэша ленивый — просроченная запись не освобождает память, пока за тем же ключом не придут снова. Запись живой выдачи просрочена больше пяти минут назад и, судя по коду, всё ещё в Map.

**Доказательство.**

```
PAYLOAD_CACHE_TTL_MS = 60_000 по умолчанию (env.schema.ts:214), в .env не переопределён (grep "PAYLOAD" .env → ни одной строки). Выдача была в 13:01:56 UTC, проверка в 13:07 UTC — запись просрочена на ~4.5 минуты. В payload-cache.service.ts нет ни setInterval, ни setTimeout на выселение: drop() (строка 370) зовётся только из get() при попадании в просроченную запись (строка 158), из store() (строка 356) и из forget() (строки 396, 404). Никакого сборщика. Тот же класс у карты corrupt: отметка с CORRUPT_TTL_MS снимается только при обращении к ТОМУ ЖЕ ключу (строки 144-148) или по forget().
```

**Влияние.** Открытые байты payload'а — по §7/§11.3 самый ценный актив системы — живут в памяти процесса не 60 секунд, как записано в комментарии к настройке («страховочный TTL»), а до вытеснения по объёму или до перезапуска. При заявленной нагрузке 0.03 rps (комментарий payload-cache.service.ts:25-26) следующий запрос того же ключа может не прийти часами. Утечка ограничена сверху потолком LRU (64 МиБ), то есть процесс не съест память бесконечно — но заявленный backstop на потерянное сообщение об инвалидации по факту не работает: мёртвые байты уходят не по времени, а только под давлением новых записей, которого в этом профиле нагрузки не бывает.

**Правка.** Либо периодический сборщик (unref'нутый setInterval раз в TTL, проходящий по entries и corrupt), либо честно переписать комментарий: «TTL проверяется только при обращении, освобождение памяти происходит по вытеснению LRU». Второе дешевле и не врёт.

### 23. [МЕЛОЧЬ] [критик] В боевом каталоге лежат пять смоук-фикстур с version_code до 9 893 000 против 1 003 310 у настоящей сборки, а выбор сборки — это максимальный version_code среди опубликованных. Одна операция publish по любой из них молча переключит весь парк.

**Доказательство.**

```
SELECT version,version_code,is_published FROM payload_builds → 9.11.0/9011000/f, 9.893.0/9893000/f, 9.222.0/9222000/f, 9.169.0/9169000/f, 9.532.0/9532000/f, 1.0.3310/1003310/t. payloads.service.ts:643-648: findFirst where {isPublished:true} orderBy versionCode desc. publish() (:528) работает по where {id, isPublished:false}, то есть распубликованную строку можно опубликовать снова. В MinIO под эти фикстуры лежат пять лишних копий того же DLL (find по /data/payloads → 6 объектов part.1 по 593 952 байта); единственный планировщик в проекте — license-expiry.processor.ts:30, сборщика мусора объектов и строк files нет.
```

**Влияние.** Сегодня безвредно (у всех шести объектов один и тот же sha256), но правило «побеждает наибольший version_code» вместе с фикстурами из будущего означает, что случайный publish в админке отдаст всем пользователям тестовую сборку, и по журналу это будет выглядеть как штатная выдача. Плюс хранилище растёт от каждого смоука без обратного хода.

**Правка.** Удалить фикстуры из каталога (или увести их в отдельный продукт/канал), а смоук-скриптам выдавать version_code ниже боевого. Завести уборку объектов и строк files для сборок, которые никогда не были опубликованы.

### 24. [НАБЛЮДЕНИЕ] [журнал] Комментарий к колонке в схеме описывает не тот алгоритм: заявлен SHA-256, фактически HMAC-SHA256 с перцем.

**Доказательство.**

```
apps/api/prisma/schema.prisma:756-759: «/// SHA-256 от Disk ID...» над `hwidHash String? @map("hwid_hash") @db.Char(64)`. Фактически payload-issues.service.ts:149 зовёт crypto.hashHwid, а crypto.service.ts:205-212: `createHmac('sha256', this.hwidPepper).update(normalized,'utf8').digest('hex')`. Комментарий в самом сервисе (payload-issues.service.ts:140-145) написан правильно.
```

**Влияние.** Тот, кто будет писать разовый аналитический запрос или скрипт сверки по схеме, посчитает sha256(diskId) и получит ноль совпадений с журналом — при том что настоящая связка работает. Ошибка тихая: пустой результат выглядит как «выдач не было».

**Правка.** Поправить строку комментария в schema.prisma на «HMAC-SHA256 с HWID_PEPPER, тот же, что в devices.hwid_hash».

### 25. [НАБЛЮДЕНИЕ] [журнал] actor_label у FIRST_BIND — литерал 'launcher' без идентификатора, в отличие от всех остальных путей записи hwid_history.

**Доказательство.**

```
hwid_history за окно: actor_label='launcher', actor_id=019fc284-7f9f-7402-bf96-5e6719e26353. Код hwid.service.ts:167. Все прочие пути пишут подпись с идентификатором: `user:${userId}` (строка 287), `admin:${actor.id}` / `reseller:${actor.id}` (строки 309, 374). Докстринг writeHistory (hwid.service.ts:613-614) обосновывает подпись тем, что «через полгода в истории не должно остаться голого UUID».
```

**Влияние.** Мелкая несогласованность: при чтении истории глазами и при группировке по actor_label строки первой привязки сливаются в одну корзину 'launcher' для всех пользователей. Данные не потеряны — actor_id заполнен, — но правило подписи применено непоследовательно.

**Правка.** Либо `launcher:${license.userId}`, либо явно задокументировать, что для FIRST_BIND метка означает канал, а не актора.

### 26. [НАБЛЮДЕНИЕ] [крипто-состояние] Счётчик выдач payload:rate получает TTL отдельной командой после INCR — при обрыве между ними ключ остаётся БЕЗ TTL, и лицензия залипает в 429 навсегда (в текущем дампе таких ключей нет).

**Доказательство.**

```
apps/api/src/modules/launcher/payload.service.ts:508-514:
  count = await this.redis.client.incr(key);
  // EXPIRE только на первой единице...
  if (count === 1) await this.redis.client.expire(key, RATE_WINDOW_SEC);
Обе команды в одном try, но между ними ключ живёт без TTL. Падение процесса/обрыв соединения ровно там оставляет вечный ключ (allkeys-lru его выселит только под давлением памяти — maxmemory 536870912 при текущих 2213 байтах данных это никогда).
Читающая сторона усугубляет, payload.service.ts:469-477:
  ttl = seconds > 0 ? seconds : RATE_WINDOW_SEC;
при TTL == -1 клиенту уходит Retry-After: 3600, хотя ключ не истечёт никогда.
Проверено фактически: сейчас утечки нет — INFO keyspace -> db0:keys=139,expires=139, и EVAL-перебор всех ключей на TTL==-1 вернул пустой список. Сам счётчик работает верно: 2 записи ISSUED в payload_issues по лицензии 019fc284-84c0-73bc-9079-dd7e896c2ee4 (13:01:56.494 и 13:08:48.084) -> GET payload:rate:019fc284... = 2, TTL 3057, окно привязано к первой выдаче и не ползёт.
```

**Влияние.** Редкий, но невосстановимый сам по себе отказ: у пострадавшей лицензии счётчик достигает hard-порога (60) и остаётся там, assertUnderHardLimit начинает отдавать 429 RATE_LIMITED, а по приложению Б ТЗ код 429 клиенту повторять ЗАПРЕЩЕНО — пользователь получает терминальный экран и не выходит из него сам. Чинится только руками через DEL в Redis.

**Правка.** Сделать окно атомарным: `SET key 1 EX 3600 NX` + `INCR` (или Lua-скрипт `local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return c`). Дополнительно в assertUnderHardLimit трактовать TTL == -1 как аномалию: сбросить ключ и пропустить запрос, а не отдавать 429 с Retry-After 3600.

### 27. [НАБЛЮДЕНИЕ] [логи] Сам запрос payload по логам отработал штатно и с первой попытки; этапов внутри него в логах не видно

**Доказательство.**

```
nginx: `{"time":"2026-08-02T13:01:56+00:00","request_id":"2b759520ef308728009dbd9df6796a3e","remote_addr":"172.22.0.1","method":"POST","uri":"/api/v1/launcher/payload","status":200,"bytes":593920,"duration":0.044,"upstream_time":"0.044","user_agent":"PlatformLauncher/1.0"}` — один upstream, без ретрая; duration == upstream_time, значит при выключенной буферизации клиент забрал 580 КБ без задержки. API: `[13:01:56.497] INFO: request completed ... POST /api/v1/launcher/payload ... statusCode: 200, responseTime: 31`. Перед ним `[13:01:56.395] login, responseTime 100` и `[13:01:56.446] INFO: первая привязка лицензии FC26-VQH6-UKKR-M2TC-TMZW (HwidService)`, `[13:01:56.457] license/check, responseTime 58`. Весь запуск занял 102 мс.
```

**Влияние.** Разбивки 31 мс на этапы (поиск в кэше, тяга из MinIO, шифрование, запись в payload_issues) в логах нет — при деградации будет видно только «стало дольше», без места.

**Правка.** Добавить один INFO на успешную выдачу с полями buildId, bytes, cacheHit, msCache/msFetch/msEncrypt.

### 28. [НАБЛЮДЕНИЕ] [логи] Успешная выдача payload не пишет в лог приложения ни одной прикладной строки — ни версии сборки, ни размера, ни попадания/промаха кэша

**Доказательство.**

```
Грепом по apps/api/src/modules/launcher/{payload.service.ts, payload-cache.service.ts, payload-admission.service.ts, payload-issues.service.ts}: все вызовы логгера — только `logger.warn` и `logger.error` (payload.service.ts:347,428,438,479,515,662,696,721; payload-cache.service.ts:278,290,329; payload-admission.service.ts:103,153,189; payload-issues.service.ts:75,96). Ни одного logger.log/info. В логе за 13:01:56.497 действительно только «request completed». Для сравнения, license/check пишет прикладную строку «первая привязка лицензии …».
```

**Влияние.** На вопрос «взялись байты из кэша или из MinIO» и «какая сборка ушла пользователю» лог ответить не может — только БД и access-лог nginx. Смягчает то, что PayloadIssuesService.recordIssued сделан fail-closed («при невозможности записать строку тело НЕ отдаётся, а клиент получает 503»), т.е. след в payload_issues гарантирован.

**Правка.** См. предыдущую находку — один INFO на выдачу закрывает и это.

### 29. [НАБЛЮДЕНИЕ] [логи] Открытого payload'а на диске сервера нет, и по конфигу быть не может — но постфактумный find сам по себе это не доказывает

**Доказательство.**

```
`docker exec lp-nginx sh -c 'find /var/cache/nginx -type f | wc -l'` → 0 (все шесть подкаталогов proxy_temp/client_temp/… существуют и пусты). Гарантию даёт конфиг: в location `~ ^/api/v\d+/launcher/payload$` стоят `proxy_buffering off; proxy_max_temp_file_size 0; proxy_cache off;`, а для тела запроса `client_max_body_size 8k` при `client_body_buffer_size 16k` — буфер больше лимита, во временный файл тело не уедет. Дополнительно `gzip off` в этом location, и байты сходятся: body_bytes_sent 593920 = размер сборки.
```

**Влияние.** Требование §7/§11.3 «payload не на диске» выполняется. Замечание по методике: nginx удаляет временный файл сразу после отдачи, поэтому find через 7 минут после запроса ничего не доказал бы и при включённой буферизации — доказательство здесь конфигурационное, а не наблюдательное.

**Правка.** Не требуется. Если когда-нибудь понадобится вернуть буферизацию ради пропускной способности — оставить `proxy_max_temp_file_size 0` обязательным, как и написано в комментарии конфига.

### 30. [НАБЛЮДЕНИЕ] [логи] Access-лог nginx не пишет $upstream_addr и $upstream_status — факт ретрая восстанавливается только по запятой в upstream_time

**Доказательство.**

```
log_format json_combined содержит `"upstream_time":"$upstream_response_time"`, но ни $upstream_addr, ни $upstream_status. Именно поэтому ретрай в 11:53:46 виден лишь как `"upstream_time":"0.000, 0.072"` — узнать, на каком адресе он споткнулся, из access-лога нельзя, приходится идти в error.log.
```

**Влияние.** При разборе «почему запрос отработал не с первого раза» две половины ответа лежат в разных логах и связываются только по времени: request_id в error.log не попадает.

**Правка.** Добавить в json_combined `"upstream_addr":"$upstream_addr","upstream_status":"$upstream_status"`.

### 31. [НАБЛЮДЕНИЕ] [логи] Кто-то опрашивает несуществующий путь проб /api/v1/health

**Доказательство.**

```
nginx 12:47:01: `"uri":"/api/v1/health","status":404,"bytes":165,"user_agent":"curl/8.19.0"`; в логе API парные WARN на строках 4882 и 4903: `[12:47:01.661] WARN: GET /api/v1/health → 404 NOT_FOUND` и `[12:47:01.686] ... 404`. Реальные пробы вынесены из-под глобального префикса: main.ts:137 `app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] })`, в логе маппинга — `Mapped {/health/live, GET}` и `{/health/ready, GET}`.
```

**Влияние.** Само по себе безвредно (это была разовая ручная проверка), но если такой путь окажется в чьём-то мониторинге, сервис будет считаться мёртвым при полностью живом API.

**Правка.** Ничего не менять в API; проверить, что во внешних чек-листах и мониторинге указаны /health/live и /health/ready без префикса /api/v1.

### 32. [НАБЛЮДЕНИЕ] [гигиена] Redact-список тела запроса в pino-конфиге фактически неактивен — сериализатор req не логирует body вообще. Защита от секретов в логах держится только на дисциплине авторов сообщений, что уже один раз не сработало (см. находку про ключ лицензии).

**Доказательство.**

```
C:/Users/user/work/kwork/license-platform/apps/api/src/common/logger/logger.module.ts:58-79 задаёт redact.paths с 15 путями 'req.body.password', 'req.body.hwid', 'req.body.diskId', 'req.body.licenseKey' и т.д.
Но там же, строки 84-98, serializers.req возвращает только `{ id, method, url, userAgent, clientVersion, ip }` — поля body в объект лога не попадают никогда. Подтверждение из живого лога: во всех записях 'request completed' блок req содержит ровно эти шесть полей (строки 5778-5786 файла bqnb6wieo.output).
```

**Влияние.** Ложное чувство защищённости: список выглядит как рабочий барьер, поэтому при добавлении нового логирования никто не проверяет, не утечёт ли значение. Реальных утечек через этот путь сейчас нет — но и защиты нет.

**Правка.** Либо убрать мёртвые 'req.body.*' пути и записать в комментарии, что тело не логируется в принципе, либо (лучше) добавить lint-правило/ревью-чек на интерполяцию license.key / diskId / sessionKey в шаблонные строки логгера.

### 33. [НАБЛЮДЕНИЕ] [ресурсы] Граница, под которую подобран коэффициент амплификации k=3, в этой инсталляции не действует: процесс API работает на хосте, а не в контейнере с mem_limit.

**Доказательство.**

```
docker-compose.yml:161-196: сервис api объявлен с profiles: ["full"], mem_limit: 2g, NODE_OPTIONS=--max-old-space-size=1024, UV_THREADPOOL_SIZE=16. В docker ps контейнера lp-api нет. Порт 3000 держит хостовый процесс: netstat -ano → "TCP 0.0.0.0:3000 LISTENING 43556", cmd = `node --enable-source-maps C:\...\apps\api\dist\main`. grep "UV_THREADPOOL_SIZE|NODE_OPTIONS" .env .env.example apps/api/package.json → ни одного вхождения. То есть живой процесс работает с UV_THREADPOOL_SIZE=4 по умолчанию, без потолка кучи и без mem_limit — при том что комментарий payload-admission.service.ts:34-37 прямо говорит: «Единственная реальная граница здесь — mem_limit контейнера (задан в docker-compose). Коэффициент подобран под неё».
```

**Влияние.** Само по себе ничего не сломалось (одна выдача, 593920 байт). Но нагрузочная проверка бюджета допуска на этой конфигурации ничего не докажет про прод: там, где расчёт обещает управляемый отказ на границе 2 ГБ, здесь границы нет вовсе, а пул libuv вчетверо уже — то есть всплеск выдач будет упираться в 4 потока, деля их с Argon2 из логина (риск, записанный в PAYLOAD-DESIGN.md:794).

**Правка.** Для локальных прогонов, которые претендуют на выводы о ёмкости, поднимать api профилем full (docker compose --profile full up api) либо вынести UV_THREADPOOL_SIZE и NODE_OPTIONS в .env, чтобы хостовый запуск совпадал с контейнерным.

### 34. [НАБЛЮДЕНИЕ] [критик] Штатный канал диагностики §9 подключён ровно к двум исходам — провалу тега и расхождению sha256. Любой другой отказ живого запуска, включая провал самой инъекции, не оставляет на сервере ни строки.

**Доказательство.**

```
grep по клиенту: session.Report вызывается дважды, оба раза в Griloder.cpp (строки 361 и 364) — ChecksumMismatch и DecryptFailed. Ветки NetworkError, BuildDefect, ShowPurchase, OfferHwidReset, ReLogin и весь блок инъекции Report не зовут. В клиентском логе есть пример такого немого отказа: сессия 16:59:00 закончилась «Process not found → Driver connectivity test failed» — на сервере за это время ноль записей. launcher_log_batches в базе пуст, и это следствие не отсутствия сбоев, а узости канала.
```

**Влияние.** Самая частая на практике категория отказов (не нашли процесс, не сработала инъекция, не достучались до сервера) на сервере невидима. При разборе жалобы «не запускается» опереться будет не на что: в payload_issues строка ISSUED, в логах 200, а у пользователя ничего не работает.

**Правка.** Звать Report на терминальных исходах фазы инъекции и на NetworkError после исчерпания повторов, kind='error'/'diagnostic'. Поле summary уже режется до 500 символов и по §9.1 не содержит секретов.

### 35. [НАБЛЮДЕНИЕ] [критик] Клиентские артефакты живого прогона никем не просматривались, хотя они лежат на диске и содержат полный ход запуска. Секретов в них нет, но и проверено это не было.

**Доказательство.**

```
C:/Users/user/work/gripulialoader/Griloder/x64/Release/griloder_log.txt — 3135 строк, 256 326 байт, 12 сессий с 15 июля, дописывается без ротации; живой прогон в строках 2348-2610. Греп по файлу: серийник диска 0 совпадений, ключ лицензии FC26-VQH6-… 0, пароль 0, 'eyJ' 0; единственная 64-hex строка (971d87ff…) — это HWID-хеш из июльских сессий, в августовских сборках его больше не печатают. %LOCALAPPDATA%\Griloder\rt.bin — 294 байта, сигнатура 01 00 00 00 d0 8c 9d df (DPAPI CurrentUser, Session.cpp:116-124), открытых строк внутри нет, mtime 17:15:01 = момент третьего запуска.
```

**Влияние.** Гигиена клиента фактически в порядке: payload на диск не пишется (Griloder.cpp: «DLL: from memory, never written to disk», в DllInject.cpp нет ни одного CreateFile/WriteFile), refresh-токен лежит под DPAPI. Но файл лога растёт неограниченно и содержит адреса ядра, RVA и имена внутренних функций — при пересылке в поддержку это уезжает целиком.

**Правка.** Добавить ротацию griloder_log.txt по размеру. Отдельно решить, нужен ли пользователю на диске 30-дневный refresh-токен: сервер его не отзывает при выходе, End() зовётся только по ветке ReLogin.

---

## Что проверял критик полноты

ЧТО ЗАПУСКАЛ И ЧТО ВЕРНУЛОСЬ

1) КАТАЛОГ СБОРОК (не смотрел никто из пяти). `SELECT ... FROM payload_builds pb JOIN files f ON f.id=pb.file_id` → 6 строк, все sha256=61bd4658…1de88, size=593920, bucket=payloads, is_public=f, deleted_at пуст. Опубликована ровно одна — 1.0.3310, version_code 1003310. Пять фикстур (9.11.0, 9.893.0, 9.222.0, 9.169.0, 9.532.0) с version_code до 9 893 000, is_published=f, published_at ЗАПОЛНЕН (это осознанный маркер неизменяемости, payloads.service.ts:531-535 — не дефект). `docker exec lp-minio ls -laR /data/payloads` → 6 объектов part.1 по 593 952 байта, т.е. шесть копий одного DLL. Единственный @Cron в проекте — license-expiry.processor.ts:30; сборщика мусора объектов/файлов нет.

2) ВЫБОР СБОРКИ. payloads.service.ts:643-648 — `where {productId, channel, isPublished:true, fileId:{not:null}}, orderBy versionCode desc`. publish() (:528) принимает строку с is_published=false, то есть распубликованную фикстуру можно опубликовать снова.

3) ХРАНИЛИЩЕ РЕАЛЬНОГО HWID. Расшифровал devices.hwid_enc живого устройства (AES-256-GCM, ключ ENCRYPTION_KEY из ./.env, AAD `devices.hwid_enc:<licenseId>`): вернулось 40 символов, побайтово равных `Get-CimInstance Win32_DiskDrive` → SerialNumber MSI M560 2TB (включая хвостовую точку). То есть прямая проверка возможна и даёт результат, обратный выводу «гигиены».

4) КЛИЕНТ (не смотрел никто). Прочитал C:/Users/user/work/gripulialoader/Griloder/Platform/{Payload.cpp,Session.cpp,Config.h,Dpapi.cpp} и Griloder.cpp. Клиент сверяет sha256 расшифрованного текста с X-Payload-Sha256 (Payload.cpp:247-250, ChecksumMismatch) и sessionKey генерит BCryptGenRandom на каждый запрос (Payload.cpp:277-278) — известное ограничение «кап 2 МиБ» снято: Config.h:85 kMaxPayloadResponseBytes = 8 МиБ, Payload.cpp:294 его подставляет.

5) КЛИЕНТСКИЕ АРТЕФАКТЫ. C:/Users/user/work/gripulialoader/Griloder/x64/Release/griloder_log.txt — 3135 строк, 256 КБ, 12 сессий, живой прогон = «Griloder Session: Sun Aug 2 17:00:58 2026» (=13:00:58 UTC), строки 2348-2610: 17:01:56.457 «Licence OK: FC 26 (30 дней)», .464 «Valid until: 2026-09-01T13:01:56.441Z», .511 «Payload: 593920 bytes, build 1.0.3310», 17:02:07.857 SUCCESS, 17:02:17.961 «Target alive 10s». Греп по файлу: серийник 0, ключ лицензии 0, пароль 0, `eyJ` 0, 64-hex — одно значение и только в июльских сессиях (`[*] HWID: 971d87ff…`). %LOCALAPPDATA%\Griloder\rt.bin — 294 байта, первые байты 01 00 00 00 d0 8c 9d df (DPAPI-блоб), открытых строк внутри нет, mtime 17:15:01.

6) ВТОРОЙ И ТРЕТИЙ ЗАПУСК (ответ на вопрос 4 — проверено фактом, а не по коду). payload_issues: ISSUED в 13:01:56.494, 13:08:48.084, 13:15:01.681, все 1.0.3310/593920. Клиентский лог: сессии 17:08:13 и 17:15:00, обе «SUCCESS — DLL injected». Ни на чём не встало: Redis `payload:rate:019fc284-84c0…` = 3 при жёстком пороге 60, TTL 2350 (окно привязано к первой выдаче, не ползёт); три разных `payload:sk:*`, то есть sessionKey каждый раз новый; второй FIRST_BIND не записан, устройство переиспользовано; refresh_tokens — цепочка ротации 019fc291-171e → 019fc297-5ed5 → 019fc29d-122e в ОДНОЙ сессии 019fc291-1719 (второй и третий запуски пошли через /auth/refresh, не через login: лог 13:08:47.967 → check .054 → payload .088).

7) ГОРЯЧИЙ ПУТЬ И КЭШ. env.schema.ts:214 PAYLOAD_CACHE_TTL_MS default 60_000; в ./.env нет ни одной переменной PAYLOAD_* (греп → 0 совпадений). responseTime трёх выдач из лога сервера: 31, 32, 31 мс — одинаковые при интервалах 6-7 минут.

8) СЕТЬ. `netstat -ano | :8080` → 0.0.0.0:8080 LISTENING. `docker exec lp-nginx nginx -T | grep -E "allow|deny|ssl|listen"` → только `listen 80` и `listen [::]:80`, ни ssl, ни allow/deny. Config.h:31 клиента: kBaseOrigin = "http://100.87.228.44:8080" с комментарием «HTTP тут без TLS… WireGuard закрывает канал целиком».

9) КЛЮЧ СБОРКИ. `SELECT prefix,scopes,revoked_at,last_used_at FROM api_keys` → живой ключ lp_39ca7fad имеет scopes {launcher:payload,launcher:check,launcher:update,launcher:logs}, revoked_at пуст, last_used_at 13:15:01.655. То есть переходный fail-open «пустой scopes = все» на живом прогоне НЕ сработал — запрос прошёл по настоящему scope. Остальные 16 ключей — смоук-фикстуры, 14 из них с пустым scopes (3 из них не отозваны).

10) СОСТОЯНИЕ ПОСЛЕ ТРЁХ ЗАПУСКОВ. licenses: activated_at 13:01:56.441 неизменён, expires_at 2026-09-01 13:01:56.441, last_check_at 13:15:01.641, last_check_country пуст. anti_fraud_events: 39 строк, максимум created_at 12:11:43 — за все три запуска ни одного нового события. devices.last_seen_at 13:15:01.634, os_info пуст.

ОТВЕТЫ НА ВОПРОСЫ
1. Не покрыто вообще: каталог payload_builds и объекты в MinIO; клиентская сторона целиком (griloder_log.txt, rt.bin, Config.h, проверка sha256 на клиенте); периодическая перепроверка лицензии; сетевой периметр (binding, отсутствие TLS).
2. Слабо проверено: «настоящий серийник в базу не попал» — вывод по плоскому грепу дампа, при том что hwid_enc это шифротекст и прямая расшифровка была возможна (находка 1); «открытых байт payload'а на диске нет» — проверено постфактумным find по серверу, а прямое доказательство лежало в клиентском логе («DLL: from memory, never written to disk» + DllInject не открывает файлов); «запись кэша, судя по коду, всё ещё в Map» — TTL никто не назвал (60 с), а он меняет вывод (находка 3).
3. Держится на удаче/условиях стенда: (а) канал — плоский HTTP на 0.0.0.0, спасает только то, что подключались с той же машины/через Tailscale (находка 4); (б) 31 мс ответа — это холодное чтение MinIO на локальном диске, кэш не участвовал ни разу (находка 3); (в) единственный запрос за раз — допуск по байтам, single-flight и очередь ни разу не были под нагрузкой; (г) IPv6-ретрай nginx (находка «логов») прошёл с первой попытки случайно.
4. Второй запуск — см. пункт 6: фактически состоялся дважды и не встал ни на счётчике, ни на sessionKey, ни на привязке, ни на кэше.
5. Подтверждено фактом из PAYLOAD-DESIGN.md: IP в журнале бесполезен (везде 172.22.0.1 — адрес docker-шлюза, не пользователя); country не заполняется нигде; метрик нет и стадии выдачи в логе не видны; кэш проверки лицензии не реализован; «пустой scopes = fail-open» жив (14 ключей). Опровергнуто/снято: «клиент физически не примет ответ из-за капа 2 МиБ» — исправлено, в Config.h 8 МиБ.
