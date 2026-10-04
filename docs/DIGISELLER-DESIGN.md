# Digiseller: контракт площадки и проект модуля

> Собрано разбором из 11 агентов: контракт площадки взят из ДЕЙСТВУЮЩЕЙ
> документации и проверен живыми запросами, не из памяти. Три независимых
> проекта под разными углами, синтез, четыре оппонента.
>
> **СТАТУС: проект НЕ ГОТОВ к реализации.** Оппоненты нашли 16 критичных
> дефектов, часть класса «покупатель заплатил и не получил ничего».
> Требуется ревизия — см. раздел «Дефекты».

## Факты о площадке

### api:документация

**AUTH — эндпоинт и тело запроса токена**

POST https://api.digiseller.com/api/apilogin. Заголовки: Content-Type: application/json + Accept: application/json (альтернатива text/xml). Тело: {"seller_id": <int>, "timestamp": <int>, "sign": "<hex>"}. Swagger дополнительно объявляет необязательные поля login и id_seller у модели DigiAPI.Models.ApiLogin, но в документации и примерах используются только seller_id/timestamp/sign.

_Источник: https://my.digiseller.com/inside/api_general.asp#token ; https://api.digiseller.com/swagger/docs/v1 (definitions/DigiAPI.Models.ApiLogin) ; https://pay.digiseller.ru/Help/Api/POST-api-apilogin_

**AUTH — алгоритм подписи**

sign = SHA256(API_ключ + timestamp) — простая конкатенация без разделителя, без HMAC, без seller_id в строке. Хеш в hex. Порядок строго: 1) API-ключ продавца, 2) timestamp. Swagger уточняет источник ключа: «seller's API_GUID (received in WM message)», т.е. ключ выдаётся сообщением на WebMoney Keeper (также управляется в кабинете: /inside/api_keys.asp). Формат timestamp в документации не уточнён явно («время запроса»), в примере 1000111001 — Unix-секунды.

_Источник: https://my.digiseller.com/inside/api_general.asp#token ; https://api.digiseller.com/swagger/docs/v1 (ApiLogin.sign: "Format: SHA256(API_GUID + Timestamp)")_

**AUTH — требование уникальности timestamp (подтверждено эмпирически)**

Swagger: timestamp «must be unique in each request». Повтор того же timestamp даёт retval -4 «Не уникальный timestamp!». Проверено вживую: два подряд запроса с timestamp=1 на api.digiseller.ru и api.digiseller.com дали -1 (неверная подпись) и затем -4 — то есть счётчик уникальности общий для обоих доменов, backend один. Следствие: нельзя ретраить логин с тем же timestamp, при ретрае надо пересчитывать timestamp и sign.

_Источник: https://api.digiseller.com/swagger/docs/v1 (ApiLogin.timestamp) ; https://my.digiseller.com/inside/api_general.asp#token (retval -4)_

**AUTH — ответ и коды ошибок**

Ответ JSON: {retval, desc, endesc, token, seller_id, valid_thru}. retval: 0 — успех; -1 — неверный логин или подпись; -2 — аккаунт временно заблокирован; -3 — ошибка в процессе выполнения; -4 — не выполнено условие уникальности timestamp. desc — описание на русском, endesc — на английском (endesc есть в Swagger/Help и в реальном ответе, но отсутствует в таблице полей на странице документации). HTTP-статус при бизнес-ошибке — 200, ошибку видно только по retval. Проверено: {"retval":-1,"desc":"Неверный идентификатор продавца или подпись!","endesc":"Invalid seller id or signature!"} при HTTP 200.

_Источник: https://my.digiseller.com/inside/api_general.asp#token ; https://pay.digiseller.ru/Help/Api/POST-api-apilogin (ApiLoginResponse)_

**AUTH — срок жизни токена и сверка с DIGISELLER_TOKEN_CACHE_TTL=6600**

Документация: «токен действителен 2 часа после получения», поле valid_thru — «Время, до которого валиден токен (UTC). Срок действия: 120 минут» = 7200 секунд. Значит 6600 с (110 минут) корректно и даёт запас 600 с. Но канонический источник — поле valid_thru из ответа: правильнее кешировать до valid_thru минус запас, а не по константе. После истечения методы API возвращают HTTP 401 (Unauthorized) — на 401 нужно принудительно инвалидировать кеш и перелогиниться.

_Источник: https://my.digiseller.com/inside/api_general.asp#token ; C:\Users\user\work\kwork\license-platform\apps\api\src\common\config\env.schema.ts:170_

**AUTH — домен: docs говорят .com, проект использует .ru**

Вся действующая документация и Swagger указывают host api.digiseller.com (Swagger: "host": "api.digiseller.com"). В проекте DIGISELLER_API_BASE=https://api.digiseller.ru. Проверено: https://api.digiseller.ru/api/apilogin отвечает корректным JSON и разделяет состояние с .com (см. общий счётчик timestamp). Т.е. .ru рабочее зеркало, но не документированное — безопаснее переключиться на api.digiseller.com. Отдельно документирован резервный адрес именно для методов unique-code: https://oplata.info/api/purchases/unique-code/...

_Источник: https://api.digiseller.com/swagger/docs/v1 (host) ; https://my.digiseller.com/inside/api_general.asp#searchuniquecode ; C:\Users\user\work\kwork\license-platform\apps\api\src\common\config\env.schema.ts:169_

**КОД ПОКУПКИ — эндпоинт проверки**

GET https://api.digiseller.com/api/purchases/unique-code/{unique-code}?token={token} (резервный адрес: https://oplata.info/api/purchases/unique-code/{unique-code}?token={token}). Заголовок Accept: application/json или text/xml. unique_code — строка ровно из 16 символов, которую покупатель получает после оплаты. Минимальное разрешение токена: [Операции]: Детали счета (в /api/token/perms это view_invoice).

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode ; https://my.digiseller.com/inside/api_general.asp#get_perms_

**КОД ПОКУПКИ — полный список полей успешного ответа**

retval, retdesc, inv (уникальный номер оплаченного счёта), id_goods (id товара), amount (сумма, зачисленная на счёт), type_curr (валюта зачисления: WMZ|WMR|WME|WMX), amount_usd, profit (зачислено за вычетом комиссий), date_pay (дата и время заказа), email (email покупателя), name_invoice (наименование счёта), lang (языковая принадлежность покупателя), agent_id, agent_percent, query_string (base64 доп. параметров с вашего сайта), unit_goods, cnt_goods, promo_code, bonus_code, cart_uid, unique_code_state{state, date_check, date_delivery, date_confirmed, date_refuted}, options[{id, name, value, variant_id}].

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode_

**КОД ПОКУПКИ — что отвечает на вопросы «какой товар / сумма / валюта / почта / номер счёта»**

Товар → id_goods (+ options[] с выбранными покупателем параметрами и variant_id). Сумма → amount (зачислено вам) и amount_usd (сумма платежа в USD); profit — за вычетом комиссий. Валюта → type_curr, и документация ЯВНО предупреждает: «валюта платежа, зачисленного на ваш счет (не способ платежа!)». Почта → email. Номер счёта → inv. Количество → cnt_goods (документация: «обязательно проверяйте это значение!», помечено «только для товаров с нефиксированной ценой»).

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode_

**КОД ПОКУПКИ — способа оплаты в ответе НЕТ**

Метод unique-code не возвращает способ оплаты. Чтобы узнать метод оплаты, нужен второй вызов GET https://api.digiseller.com/api/purchase/info/{invoice_id}?token={token} по полученному inv: там content.buyer_info.payment_method (метод оплаты), content.buyer_info.payment_aggregator (платёжный провайдер), а также account (аккаунт WebMoney), phone, ip_address, external_order_id. Альтернатива — POST /api/seller-sells/v2 с полями method_pay и aggregator_pay. Значения этих полей в документации не перечислены (в примере: method_pay="Merchant", aggregator_pay="WebMoney").

_Источник: https://my.digiseller.com/inside/api_general.asp#purchase_info ; https://my.digiseller.com/inside/api_statistics.asp#statisticsells_

**КОД ПОКУПКИ — состояния сделки (unique_code_state.state)**

1 — уникальный код не проверен; 2 — товар доставлен, доставка не подтверждена и не опровергнута; 3 — товар доставлен, доставка подтверждена; 4 — товар доставлен, но отвергнут; 5 — уникальный код проверен, товар не доставлен. Даты: date_check, date_delivery, date_confirmed, date_refuted. Само поле unique_code_state помечено как необязательное — его может не быть в ответе.

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode_

**КОД ПОКУПКИ — «код уже использован» как состояния в API не существует**

В контракте нет флага «код израсходован». Есть только state 1..5 (проверен/доставлен/подтверждён/отвергнут). Защита от повторной выдачи лицензии полностью на нашей стороне: документация дважды повторяет — «настоятельно рекомендуем сохранять это значение (inv) в базе и каждый раз проверять его на уникальность, чтобы избежать двойных начислений». Т.е. идемпотентность строим по inv (а при корзинных покупках — по паре inv/cart_uid).

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode ; https://my.digiseller.com/inside/api_general.asp#deliveruniquecode_

**КОД ПОКУПКИ — ошибки: документировано только retval 0, остальное выяснено эмпирически**

Таблица ответов метода searchuniquecode перечисляет ТОЛЬКО «0 — запрос выполнен». Реальные проверки (curl, 2026-08-02): без token → HTTP 400, {"retval":-3,"retdesc":"отсутствует или неверно задан параметр token"}; с неверным token → HTTP 400, {"retval":-4,"retdesc":"отсутствует или неверно задан параметр token"}. Соседний метод deliver документирует коды: -5 доступ запрещен, -4 неверный токен, -3 неверный токен, -2 неверный код, 1 неверный код, 2 неверный код, 3 уникальный код ещё не был проверен, 4 сообщение о доставке уже ранее поступало. Скорее всего у searchuniquecode коды «неверный код» те же (-2/1/2), но документально это НЕ подтверждено.

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode ; https://my.digiseller.com/inside/api_general.asp#deliveruniquecode_

**КОД ПОКУПКИ — отметка «товар доставлен»**

PUT https://api.digiseller.com/api/purchases/unique-code/{unique-code}/deliver?token={token} (резерв: oplata.info). Разрешение: [Содержимое]: Редактировать (content_change). Ответ: retval, retdesc, inv, id_goods, cart_uid, unique_code_state{...}. Важные коды: 3 — «уникальный код ещё не был проверен» (значит deliver надо звать ПОСЛЕ успешной проверки кода), 4 — «сообщение о доставке уже ранее поступало» (безопасный повтор). Это единственный способ явно сообщить площадке, что лицензия выдана.

_Источник: https://my.digiseller.com/inside/api_general.asp#deliveruniquecode_

**ВОЗВРАТЫ — статусы счёта (основной способ узнать про отмену)**

GET https://api.digiseller.com/api/purchase/info/{invoice_id}?token={token}, поле content.invoice_state: 1 — ожидается оплата; 2 — отказ от оплаты; 3 — успешная оплата; 4 — оплата просрочена; 35 — возврат (не завершён покупателем); 5 — возврат. Дополнительно content.lock_state (free — разблокирован / locked — заблокирован) и content.day_lock (срок холдирования средств, дней) — по ним видно, что деньги ещё на удержании. Также content.unique_code_state.state=4 («товар доставлен, но отвергнут») + date_refuted — сигнал спора/отказа покупателя уже после выдачи.

_Источник: https://my.digiseller.com/inside/api_general.asp#purchase_info ; https://api.digiseller.com/swagger/docs/v1 (PurchaseModel.invoice_state)_

**ВОЗВРАТЫ — массовый поллинг через статистику продаж**

POST https://api.digiseller.com/api/seller-sells/v2?token={token}. Тело: {product_ids[], date_start, date_finish, returned, page, rows}. Параметр returned: 0 — включить возвраты, 1 — исключить возвраты, 2 — ТОЛЬКО возвраты. В каждой строке ответа есть rows[].returned (0|1), invoice_id, date_pay, email, amount_in, amount_out, amount_currency, method_pay, aggregator_pay, lang, owner. Даты запроса в формате 'yyyy-MM-dd HH:mm:ss' в московском времени UTC+03:00 (не UTC!). rows — по умолчанию 10, не более 1000; ответ пагинирован (total_rows, pages, page). Разрешение: [Статистика]: Статистика продаж. Это самый дешёвый способ регулярно вылавливать возвраты пачкой — returned=2 за окно последних N суток.

_Источник: https://my.digiseller.com/inside/api_statistics.asp#statisticsells_

**ВОЗВРАТЫ — вебхуки существуют, но их формат за логином**

В оглавлении API есть раздел «Вебхуки» с двумя пунктами: «Продажа товара» → /inside/notify_settings.asp?view=url и «Сообщения» → /inside/notify_settings.asp?view=urlMessage. Обе страницы — настройки в кабинете продавца и требуют авторизации (анонимный запрос редиректит на форму входа), публичного описания payload'а нет. Название пункта — «Продажа товара», то есть уведомление привязано к факту продажи; отправляет ли Digiseller уведомление при ВОЗВРАТЕ — из публичных источников не подтверждается. Планировать надо на поллинг, вебхук — как ускоритель по продажам.

_Источник: https://my.digiseller.com/inside/api.asp (раздел «Вебхуки») ; https://my.digiseller.com/inside/notify_settings.asp?view=url_

**ВОЗВРАТЫ/ВЫДАЧА — отдельный механизм «API продавца» (Digiseller дёргает нас)**

Если товар настроен на выдачу через наш сервер, Digiseller сам делает POST на наш URL: {id, inv, amount, type_curr, sign, options[{id,user_data}]}, Content-Type application/json или text/xml. Подпись входящего запроса — MD5 от строки "id" + ":" + "inv" + ":" + "ваш пароль на сервисе" (MD5, не SHA256 — отличается от apilogin). Ответ: {id, inv, goods, error}. Документация прямо предупреждает: «С одним и тем же inv могут быть повторные запросы… следует выдавать одно и то же содержимое». Ретраи: если вернуть id/inv без goods и error — запрос повторяется с интервалом от 10 секунд до 5 минут, до 50 попыток в течение ~3 часов; то же при отсутствии ответа за 14 секунд или HTTP-ошибке. Это канал ВЫДАЧИ, не возвратов.

_Источник: https://my.digiseller.com/inside/api_supplier.asp#order_

**ОГРАНИЧЕНИЯ — лимиты частоты нигде не документированы**

Ни на одной публичной странице документации (api_general, api_payment, api_account, api_statistics, api_catgoods, api_goods) нет ни слова про rate limit, квоты, «не более N запросов», 429 или Retry-After. В реальных ответах api.digiseller.com нет заголовков X-RateLimit-*/Retry-After. Единственные явные ограничения объёма: rows ≤ 1000 в seller-sells/v2 и agent-sales/v2, top по умолчанию 1000 в seller-last-sales, до 200 файлов в ZIP при загрузке содержимого. Значение DIGISELLER_POLL_INTERVAL=900 в проекте ни на чём документированном не основано — это наше решение, а не требование площадки.

_Источник: https://my.digiseller.com/inside/api_statistics.asp ; https://my.digiseller.com/inside/api_general.asp_

**ОГРАНИЧЕНИЯ — API за DDoS-Guard, поведение при недоступности**

api.digiseller.com и api.digiseller.ru отдают заголовок Server: ddos-guard и ставят куки __ddg1_/__ddg8_/__ddg9_/__ddg10_ (проверено). Практический вывод: при агрессивном трафике/нестандартном клиенте возможен challenge или блок — тогда вместо JSON придёт HTML, и парсер обязан это переживать (проверять Content-Type, а не слепо JSON.parse). Стек — ASP.NET (X-AspNet-Version: 4.0.30319). Требований к User-Agent в документации нет; запрос с пустым User-Agent прошёл нормально. Из инфраструктурной отказоустойчивости документирован только резервный домен oplata.info для методов unique-code.

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode (резервный адрес oplata.info)_

**ОГРАНИЧЕНИЯ — коды ошибок непоследовательны между методами**

Три разных схемы в одном API, обрабатывать надо все: (1) apilogin — HTTP 200 + retval<0 (бизнес-ошибка не влияет на статус); (2) purchases/unique-code — HTTP 400 + JSON {retval,retdesc} при проблеме с токеном; (3) purchase/info с неверным токеном — HTTP 401 с ПУСТЫМ телом; token/perms с неверным токеном — HTTP 401 и тело []. Все четыре случая проверены curl'ом 2026-08-02. Плюс у purchase/info и purchase/cart своя схема: retval 0/1 + массив errors[{code,message}].

_Источник: https://my.digiseller.com/inside/api_general.asp#purchase_info ; https://my.digiseller.com/inside/api_general.asp#get_perms_

**ОГРАНИЧЕНИЯ — разрешения токена (важно при 401/403)**

GET https://api.digiseller.com/api/token/perms?token={token} возвращает массив строк-разрешений. Для нашего сценария нужны: view_invoice ([Операции]: Детали счета) — для unique-code и purchase/info; content_change ([Содержимое]: Редактировать) — для deliver; sales_statistics_view ([Статистика]: Статистика продаж) — для seller-sells/v2. Документация: «пустой массив означает отсутствие доступа (http status 401 или 403)» и «токен нужно получить с использованием API ключа, который имеет доступ к получению списка разрешений токена». Т.е. права привязаны к конкретному API-ключу — при 401 стоит различать «токен протух» и «у ключа нет права».

_Источник: https://my.digiseller.com/inside/api_general.asp#get_perms_

**ЯЗЫК — параметра языка у unique-code и purchase/info НЕТ**

Параметр запроса lang (ru-RU по умолчанию | en-US) документирован только для каталожных и платёжных методов: /api/products/list, /api/products/{id}/data, поиск, precheck, purchases/options, переход к оплате. У /api/purchases/unique-code/{code} и /api/purchase/info/{id} параметра языка ответа нет — управлять локалью ответа этих методов нельзя.

_Источник: https://my.digiseller.com/inside/api_catgoods.asp#product_info ; https://my.digiseller.com/inside/api_payment.asp#precheck ; https://my.digiseller.com/inside/api_general.asp#searchuniquecode_

**ЯЗЫК — какие поля приходят локализованными**

(1) apilogin: desc — русский текст ошибки, endesc — английский; можно выбирать. (2) unique-code: retdesc приходит только по-русски (проверено: «отсутствует или неверно задан параметр token»), английского варианта нет. (3) unique-code возвращает поле lang — «языковая принадлежность покупателя»; в статистике rows[].lang явно ограничен значениями ru-RU или en-US — по нему определяем, на каком языке слать письмо/лицензию покупателю. (4) name_invoice / product_name — наименование счёта и товара, локаль зависит от языка покупателя/товара. Кодировка ответов — UTF-8 (явно объявлена для методов статистики и каталога).

_Источник: https://my.digiseller.com/inside/api_statistics.asp#statisticsells ; https://my.digiseller.com/inside/api_general.asp#searchuniquecode ; https://pay.digiseller.ru/Help/Api/POST-api-apilogin_

**ЯЗЫК/ВРЕМЯ — часовые пояса разные в разных методах**

valid_thru у токена — UTC (ISO 8601, пример «2019-06-17T12:35:39.8385039Z»; в Help-странице пример с офсетом +03:00). Даты в seller-sells/v2 и agent-sales/v2 (и в запросе, и в ответе) — 'yyyy-MM-dd HH:mm:ss' в МОСКОВСКОМ времени UTC+03:00. А для date_pay/purchase_date в unique-code и purchase/info формат и часовой пояс в документации вообще не указаны. Смешивать эти даты без нормализации нельзя.

_Источник: https://my.digiseller.com/inside/api_statistics.asp#statisticsells ; https://my.digiseller.com/inside/api_general.asp#token_

**НЕСОГЛАСОВАННОСТЬ — словари валют разные в трёх методах**

unique-code: type_curr = WMZ | WMR | WME | WMX. purchase/info: currency_type = WMT | WMZ | WME | WMU. seller-sells/v2: amount_currency = WMZ | WMR | WME | WMU | WMX. purchase/cart: currency = RUB | USD. Четыре разных набора для одной сущности; WMT и WMU против WMR и WMX явно противоречат друг другу. Маппинг валюты нельзя писать по одному методу — нужен словарь-объединение и fallback на неизвестное значение.

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode ; https://my.digiseller.com/inside/api_general.asp#purchase_info ; https://my.digiseller.com/inside/api_statistics.asp#statisticsells ; https://my.digiseller.com/inside/api_general.asp#purchase_cart_info_

**НЕСОГЛАСОВАННОСТЬ — таблица полей unique-code богаче JSON-примера**

В таблице параметров ответа searchuniquecode описаны name_invoice (наименование счёта), lang (языковая принадлежность покупателя) и query_string (base64), но в приведённом JSON-примере ответа этих трёх полей НЕТ. Считать их гарантированно присутствующими нельзя — читать как optional.

_Источник: https://my.digiseller.com/inside/api_general.asp#searchuniquecode_

**УСТАРЕВШЕЕ — legacy XML-метод проверки кода удалён**

Старый эндпоинт https://shop.digiseller.ru/xml/uniquecode.asp (id_seller + unique_code + sign, MD5-подпись), который до сих пор встречается в сторонних SDK и статьях, отдаёт 404 (проверено 2026-08-02) и отсутствует в текущем оглавлении документации. Единственный действующий способ — токен-метод /api/purchases/unique-code/. Ориентироваться на примеры из npm-пакета digiseller и старых PHP-обёрток нельзя.

_Источник: https://my.digiseller.com/inside/api.asp (оглавление действующих методов)_

**СПРАВОЧНОЕ — машиночитаемая спецификация**

Swagger 2.0: https://api.digiseller.com/swagger/docs/v1 (UI: https://api.digiseller.com/swagger/ui/index), 67 путей, host api.digiseller.com, securityDefinitions: token как apiKey в query. Второй генератор — ASP.NET Help Pages на https://pay.digiseller.ru/Help (описания моделей на английском). Внимание: у /api/purchases/unique-code/{unique_code} в Swagger схема ответа объявлена как пустой type: object / IHttpActionResult — поля ответа там НЕ описаны, единственный источник по ним — HTML-страница api_general.asp.

_Источник: https://api.digiseller.com/swagger/docs/v1 ; https://pay.digiseller.ru/Help/Api/GET-api-purchases-unique-code-unique_code_token_

**Открытые вопросы:**

- Формат ответа «код не найден» у GET /api/purchases/unique-code/{code} НЕ документирован: таблица retval содержит только «0 — запрос выполнен». Эмпирически удалось получить только ошибки токена (-3 отсутствует, -4 неверный, оба HTTP 400). Коды для несуществующего/битого кода можно только предполагать по соседнему методу deliver (-2, 1, 2 — «неверный код»). Нужно проверить на реальной покупке или запросом в поддержку до релиза — иначе первый же неверно введённый покупателем код уронит обработчик.
- «Код уже использован» как состояние в API отсутствует вовсе. Есть только unique_code_state.state 1..5. Не подтверждено, меняется ли что-то в ответе после нашего PUT .../deliver и можно ли по ответу отличить «этот код мы уже отоварили» от «код свежий» — судя по контракту, нет, и защиту от повторной выдачи придётся строить исключительно на уникальности inv у нас в БД.
- Payload вебхука «Продажа товара» (/inside/notify_settings.asp?view=url) публично недоступен — страница за авторизацией в кабинете продавца. Неизвестны: состав полей, метод (GET/POST), подпись, ретраи, требования к ответу. Нужен доступ в кабинет продавца, чтобы прочитать.
- Ключевой вопрос задачи — уведомляет ли Digiseller вебхуком о ВОЗВРАТЕ/отмене уже после выдачи — по публичным источникам не подтверждается. Пункт называется «Продажа товара», признаков события возврата нет. До проверки в кабинете надо исходить из того, что возвраты ловятся только поллингом (purchase/info invoice_state 5/35 или seller-sells/v2 с returned=2).
- Лимиты частоты запросов не документированы нигде и не отдаются заголовками. Неизвестно, есть ли скрытый троттлинг на уровне DDoS-Guard и при какой частоте поллинга начнутся блокировки. Значение DIGISELLER_POLL_INTERVAL=900 выбрано нами, а не взято из документации.
- Формат и часовой пояс полей date_pay / purchase_date / date_check / date_delivery / date_confirmed / date_refuted в методах unique-code и purchase/info не указаны вообще (в отличие от статистики, где явно 'yyyy-MM-dd HH:mm:ss' MSK). Нельзя парсить как UTC без проверки на реальных данных.
- Формат timestamp в apilogin явно не назван («время запроса»); из примера 1000111001 следует Unix-время в секундах, но документация этого не утверждает. Не описано и допустимое расхождение часов клиента с сервером.
- Расхождение доменов: документация и Swagger — api.digiseller.com, в проекте прописан api.digiseller.ru (работает, но нигде не документирован). Нужно решение: переключиться на .com или сознательно оставить недокументированное зеркало.
- cnt_goods и unit_goods в unique-code помечены «только для товаров с нефиксированной ценой», при этом тут же требование «обязательно проверяйте это значение!». Что приходит в этих полях для товара с фиксированной ценой (null, 0, 1) — не сказано.
- Не описано, обязателен ли вызов PUT .../deliver для нормального завершения сделки и влияет ли он на холдирование средств (day_lock/lock_state) и на споры. Из документации следует только, что deliver нельзя звать до проверки кода (retval 3).
- Списки допустимых значений buyer_info.payment_method и payment_aggregator (а также method_pay/aggregator_pay в статистике) нигде не перечислены — есть только примеры «Merchant» и «WebMoney». Маппинг способов оплаты придётся собирать по реальным данным.
- Противоречивые словари валют между методами (WMZ|WMR|WME|WMX vs WMT|WMZ|WME|WMU vs RUB|USD) — какой набор актуален для новых сделок 2026 года и как ложатся на них рублёвые/карточные платежи, документация не объясняет.

### код:схема-и-модули

**Order — точная структура**

model Order @@map("orders"). Поля: id String @id @db.Uuid (uuid v7 из приложения); number String @unique @db.VarChar(32) — NOT NULL, без @default в схеме; userId String? → User onDelete SetNull; resellerId String? → Reseller onDelete SetNull; productId String NOT NULL → Product onDelete Restrict; planId String NOT NULL → LicensePlan onDelete Restrict; quantity Int @default(1); amount Decimal(12,2) NOT NULL; currency String @default("RUB") VarChar(3); status OrderStatus @default(PENDING); source OrderSource NOT NULL БЕЗ default; createdAt @default(now()); paidAt/deliveredAt/cancelledAt/refundedAt — все nullable Timestamptz(3); updatedAt @updatedAt; comment String?. Обратные связи: payments Payment[], licenses License[]. Уникальные ключи: только number. Индексы: (user_id, created_at DESC), (reseller_id, created_at DESC), (status), (created_at), (product_id, created_at DESC). Заметь: productId и planId — NOT NULL с FK Restrict. Заказ физически невозможно создать, не зная тариф.

_Источник: C:/Users/user/work/kwork/license-platform/apps/api/prisma/schema.prisma:1031-1072_

**Order.number — расхождение схемы и миграции (ловушка при реализации)**

В миграции catchup заведён sequence + функция и поставлен DB-default: CREATE SEQUENCE order_number_seq; CREATE FUNCTION next_order_number() RETURNS TEXT AS $fn$ SELECT 'ORD-'||to_char(CURRENT_DATE,'YYYY')||'-'||lpad(nextval('order_number_seq')::text,6,'0') $fn$; ALTER TABLE "orders" ALTER COLUMN "number" SET DEFAULT next_order_number(). Но в schema.prisma поле объявлено как `number String @unique @db.VarChar(32)` БЕЗ @default(dbgenerated(...)). Следствие: в сгенерированном клиенте OrderCreateInput.number — ОБЯЗАТЕЛЬНОЕ поле, prisma.order.create() всегда шлёт колонку явно, и DB-default никогда не срабатывает. Модуль оплаты либо продублирует формат номера в TypeScript (и разъедется с сиквенсом), либо надо добавить @default(dbgenerated("next_order_number()")) в схему. Это не косметика: два источника номера = коллизии по orders_number_key.

_Источник: prisma/migrations/20260731143000_catchup_audit_gaps/migration.sql:145-154 против prisma/schema.prisma:1034_

**Payment — точная структура**

model Payment @@map("payments"). id @id Uuid; orderId String NOT NULL → Order onDelete Cascade (удаление заказа стирает платежи); provider PaymentProvider NOT NULL без default; method PaymentMethod @default(OTHER); status PaymentStatus @default(PENDING); amount Decimal(12,2) NOT NULL; currency @default("RUB"); externalId String? VarChar(128) — NULLABLE; rawPayload Json? @db.JsonB; confirmedAt/failedAt/refundedAt nullable; errorMessage String?; createdAt/updatedAt. Обратная 1:1 — digisellerOrder DigisellerOrder?. Уникальный ключ: @@unique([provider, externalId]) = payments_provider_external_id_key. Индексы: (order_id), (status).

_Источник: prisma/schema.prisma:1075-1105; prisma/migrations/20260730125712_init/migration.sql:423-440, 818-824_

**Payment.@@unique([provider, externalId]) НЕ защищает при externalId = NULL**

externalId nullable, а в Postgres в обычном UNIQUE-индексе NULL не равен NULL. Значит строк (DIGISELLER, NULL) можно вставить сколько угодно — уникальность работает только когда externalId реально заполнен. Для MANUAL и RESELLER_BALANCE это, видимо, и задумано (внешнего id нет). Но для DIGISELLER это означает жёсткое требование к реализации: externalId обязан заполняться в том же INSERT, что создаёт платёж, иначе главный дедуп-ключ провайдера просто выключен. Constraint это не проверяет — нужен либо CHECK (provider <> 'DIGISELLER' OR external_id IS NOT NULL), либо NULLS NOT DISTINCT.

_Источник: prisma/schema.prisma:1088, 1102_

**DigisellerOrder — точная структура**

model DigisellerOrder @@map("digiseller_orders"). id @id Uuid; paymentId String? @unique → Payment onDelete SetNull (NULLABLE — сделка может существовать без платежа); uniqueCode String @unique VarChar(64) NOT NULL; invId BigInt? @unique (номер счёта Digiseller); digisellerProductId Int? — просто число, БЕЗ FK и БЕЗ индекса; amount Decimal(12,2)?; currency VarChar(3)?; buyerEmail VarChar(255)?; rawPayload Json? @db.JsonB; verifiedAt? (код проверен через API площадки); redeemedAt? (код погашен, лицензия выдана); redeemedByUserId String? Uuid — БЕЗ FK и БЕЗ индекса (в отличие от RegistrationKey.usedByUserId, у которого FK на users есть); refundedAt?; lastPolledAt?; createdAt/updatedAt. Уникальные ключи: payment_id, unique_code, inv_id — три штуки. Индексы: (redeemed_at), (last_polled_at). Связи с Order напрямую НЕТ — только через Payment.

_Источник: prisma/schema.prisma:1108-1146; prisma/migrations/20260730125712_init/migration.sql:444-462, 827-839_

**Reseller / ResellerTransaction — точная структура**

Reseller: id @id Uuid; userId String @unique NOT NULL → User onDelete Cascade (один аккаунт = один реселлер); displayName VarChar(128) NOT NULL; status ResellerStatus @default(ACTIVE); balance Decimal(12,2) @default(0); currency @default("RUB"); discountPercent Decimal(5,2) @default(0); creditLimit Decimal(12,2) @default(0) — допустимый овердрафт; allowedProductIds String[] @db.Uuid @default([]) (пустой = все продукты); hwidResetDailyLimit Int @default(10). Индекс: (status). ResellerTransaction: id; resellerId NOT NULL → Reseller Cascade; type ResellerTxType NOT NULL; amount Decimal(12,2) NOT NULL (знаковая: + пополнение, − списание); balanceAfter Decimal(12,2) NOT NULL; currency @default("RUB"); licenseId String? и orderId String? — ОБА без FK, без индекса, без unique; comment String?; createdById String?; createdAt. Индексы: (reseller_id, created_at DESC), (type). Уникальных ключей НЕТ вообще.

_Источник: prisma/schema.prisma:967-1025; prisma/migrations/20260730125712_init/migration.sql:382-395, 797-800_

**LicensePlan ↔ товар площадки**

LicensePlan: id; productId NOT NULL → Product onDelete Cascade; slug VarChar(64); name VarChar(128); durationDays Int? (NULL = Lifetime); price Decimal(12,2) @default(0); currency @default("RUB"); digisellerProductId Int? @unique @map("digiseller_product_id"); isActive @default(true); sortOrder. Уникальные ключи: @@unique([productId, slug]) и digisellerProductId. Индекс: (isActive). Ключевое: digisellerProductId — Int?, а не FK; со стороны DigisellerOrder.digisellerProductId это просто Int? без всякой связи. То есть отображение «товар площадки → тариф» существует ровно как один UNIQUE-индекс на license_plans и разрешается запросом findUnique({where:{digisellerProductId}}) в приложении. @unique означает: один товар Digiseller мапится максимум на ОДИН тариф; nullable означает: тариф может не продаваться на площадке (и таких может быть сколько угодно — NULL в Postgres не конфликтует).

_Источник: prisma/schema.prisma:786-815, 1121_

**License — то, что важно для оплаты**

key String @unique VarChar(64); userId String? → User SetNull (лицензия может быть ничьей); productId/planId NOT NULL → onDelete Restrict; status @default(PENDING); issuedAt @default(now()); activatedAt? ; expiresAt? (NULL = Lifetime); blockedAt/blockedReason/blockedById; revokedAt/revokedReason — ОТДЕЛЬНО от блокировки, намеренно; currentDeviceId String? @unique → Device SetNull (инвариант: одно устройство не может быть активной привязкой двух лицензий); orderId String? → Order onDelete SetNull; resellerId String? → Reseller SetNull; issuedById String? (без FK); notes String?. Индексы: (user_id,status), (product_id,status), (reseller_id), (status,expires_at), (expires_at), (order_id). Уникального ключа на orderId НЕТ — заказ может породить N лицензий, и ничто в БД не связывает N с Order.quantity.

_Источник: prisma/schema.prisma:821-887_

**Enum'ы — полные списки**

OrderStatus: PENDING, PAID, DELIVERED, CANCELLED, REFUNDED, FAILED (нет PARTIALLY_REFUNDED, нет CHARGEBACK). OrderSource: DIGISELLER, MANUAL, RESELLER, REGISTRATION_KEY. PaymentProvider: DIGISELLER, MANUAL, RESELLER_BALANCE (крипта — НЕ провайдер, см. комментарий и DATA_MODEL.md). PaymentMethod: CARD, SBP, CRYPTO, EWALLET, MOBILE, BALANCE, OTHER. PaymentStatus: PENDING, CONFIRMED, FAILED, REFUNDED (нет PARTIALLY_REFUNDED). ResellerStatus: ACTIVE, SUSPENDED, CLOSED. ResellerTxType: TOPUP, SALE, REFUND, ADJUSTMENT, COMMISSION. Смежные: LicenseStatus PENDING/ACTIVE/EXPIRED/BLOCKED/REVOKED; UserStatus PENDING_VERIFICATION/ACTIVE/BLOCKED/DELETED.

_Источник: prisma/schema.prisma:82-135, 34-39, 65-71_

**1. Путь данных при покупке, который предполагает схема**

Обязательный порядок диктуется NOT NULL + FK, а не соглашением. (а) User — должен существовать ДО заказа, если заказ именной: Order.userId nullable, поэтому заказ может быть создан и до опознания покупателя, но License.userId тоже nullable, и лицензия без владельца бесполезна. (б) LicensePlan — резолвится ПЕРВЫМ: без planId+productId Order физически не создать (обе колонки NOT NULL, FK Restrict). (в) Order — создаётся вторым, потому что Payment.orderId NOT NULL. (г) Payment — третьим, потому что DigisellerOrder.paymentId ссылается на него (правда, nullable — поэтому DigisellerOrder может быть создан и раньше, при первой проверке кода). (д) License — последней: License.orderId ссылается на Order. Транзакционная граница ровно одна и она обязана охватывать: погашение кода (UPDATE digiseller_orders SET redeemed_at) + создание/обновление Order.status=DELIVERED + создание License. Если License.create вынести за транзакцию, получается оплаченный код с redeemedAt и без лицензии — и повторить нельзя, код уже погашен. Образец такой транзакции уже написан в проекте: registration-key.service.ts:302-321 (redeemForUser) — updateMany с условием, проверка count, затем licenses.issue(..., tx) тем же tx.

_Источник: prisma/schema.prisma:1042-1045,1077,1113,863; src/modules/auth/registration-key.service.ts:302-321_

**2. Защита от двойной выдачи — конкретное ограничение**

Ограничение: CREATE UNIQUE INDEX "digiseller_orders_unique_code_key" ON "digiseller_orders"("unique_code") — из @unique на DigisellerOrder.uniqueCode. Оно работает В ДВА ЭТАПА, и оба обязательны. Этап 1 (гонка на создании строки): два запроса с одним кодом одновременно делают INSERT. Второй INSERT блокируется на уникальном индексе до коммита первого, затем получает 23505 → Prisma P2002 → AllExceptionsFilter превращает это в HTTP 409 ALREADY_EXISTS (в фильтре прямо написано, что самый частый случай — «повторное погашение кода Digiseller»). То есть даже наивный findUnique-then-create не даёт двух строк, но обязан ловить P2002 как «конкурент», а не как 500. Этап 2 (гонка на погашении уже существующей строки): условие redeemedAt IS NULL должно стоять В WHERE самого UPDATE — updateMany({where:{uniqueCode, redeemedAt:null}, data:{redeemedAt, redeemedByUserId}}). Второй UPDATE берёт row-level lock и ждёт коммита первого; при READ COMMITTED Postgres после разблокировки перечитывает новую версию строки и заново прогоняет WHERE (EvalPlanQual) — redeemedAt уже не NULL, строка не подходит, count = 0 → бросаем 409 и вся транзакция проигравшего откатывается вместе с недосозданной лицензией. Отдельный SELECT перед UPDATE эту гонку НЕ закрывает: между чтением и записью пролезет вторая транзакция. Serializable здесь не нужен — защита это одна строка под уникальным индексом плюс условный UPDATE, а не предикат по диапазону. Ровно эта схема уже реализована для регистрационных ключей и её надо скопировать, а не изобретать.

_Источник: prisma/schema.prisma:1117 + prisma/migrations/20260730125712_init/migration.sql:830; src/common/filters/all-exceptions.filter.ts:151-159; src/modules/auth/registration-key.service.ts:252-265; docs/DATA_MODEL.md:97-112_

**3. Код на товар, которого нет ни в одном тарифе**

Резолв идёт так: DigisellerOrder.digisellerProductId (Int?) → licensePlan.findUnique({where:{digisellerProductId}}) → (plan.productId, plan.id). Если тариф не найден, findUnique вернёт null, и дальше СОЗДАТЬ ЗАКАЗ НЕВОЗМОЖНО в принципе: orders.product_id и orders.plan_id — NOT NULL с FK ON DELETE RESTRICT; без Order нельзя создать Payment (payments.order_id NOT NULL). Что схема при этом РАЗРЕШАЕТ и что и надо делать: положить строку в digiseller_orders с verifiedAt, digisellerProductId, buyerEmail, полным rawPayload, при paymentId = NULL и redeemedAt = NULL — то есть карантин непривязанной сделки. Это работает, потому что paymentId объявлен nullable намеренно. Чего для карантина не хватает: у DigisellerOrder нет ни статусного поля, ни колонки ошибки — «непривязанный товар», «не прошёл проверку у площадки» и «просто ещё не погашен» выглядят в таблице одинаково. Найти такие строки можно только запросом WHERE redeemed_at IS NULL AND payment_id IS NULL, а индекс digiseller_orders_redeemed_at_idx — обычный по низкоселективной колонке, для этого разреза бесполезен: нужен частичный индекс WHERE redeemed_at IS NULL. Важное следствие для реализации: код НЕЛЬЗЯ помечать redeemedAt в этой ветке — иначе покупатель заплатил, товар не смапен, а повторить он уже не сможет.

_Источник: prisma/schema.prisma:800, 1042-1045, 1077, 1113, 1143_

**4. Что уже есть под возвраты и отзыв постфактум**

Данные: DigisellerOrder.refundedAt (комментарий прямо: «сделка отменена площадкой постфактум → лицензию отзываем») + lastPolledAt с индексом digiseller_orders_last_polled_at_idx — это готовый курсор для воркера поллинга; Order.status=REFUNDED/CANCELLED + refundedAt/cancelledAt; Payment.status=REFUNDED + refundedAt; License.status=REVOKED + revokedAt + revokedReason (отзыв намеренно отделён от BLOCKED: блокирует админ за нарушение, отзывает система за неоплату); ResellerTxType.REFUND для возврата денег на баланс. Настройки под воркер уже засеяны: digiseller.poll_interval_sec = 900, digiseller.poll_window_hours = 48. Право orders.refund засеяно и выдано super_admin/admin. Код: LicensesService.revoke(licenseId, reason, actor?) уже готов и вызывается без актора (пишет в аудит actorType SYSTEM), снимает currentDeviceId, логирует по id а не по key. Путь поиска что отзывать: digiseller_orders → payments (unique paymentId) → orders → licenses, и индекс licenses.order_id для последнего шага есть. Чего нет: суммы возврата (частичный возврат при quantity > 1 не выразим — REFUNDED это булев исход), актора возврата (нет refundedById ни на Order, ни на Payment), причины возврата на Order (только Payment.errorMessage), значений PARTIALLY_REFUNDED/CHARGEBACK в enum'ах, и шаблона уведомления license.revoked (в seed есть license.issued, license.expiring, hwid.reset, order.delivered — и всё).

_Источник: prisma/schema.prisma:1135,1138,1058,1094,848-849; src/modules/licenses/licenses.service.ts:281-318; prisma/seed.ts:244-247, 96, 353-359_

**5. Чего НЕ ХВАТАЕТ — идемпотентность вебхука**

Нет таблицы принятых вебхуков/событий. digiseller_orders.raw_payload хранит только ПОСЛЕДНИЙ payload (перезаписывается), и нет ни ключа доставки, ни подписи, ни nonce. UNIQUE(unique_code) закрывает ровно один сценарий — двойную выдачу лицензии. Он не закрывает повторную обработку смены статуса: ретрай уведомления «сделка возвращена» второй раз пройдёт весь путь возврата (второй ResellerTransaction.REFUND на баланс, второй revoke, второе письмо), потому что ни на Order.status, ни на Payment.status нет условного перехода в БД, а ResellerTransaction ничем не защищена от дубля. Нужна либо таблица webhook-событий с UNIQUE на (provider, event_id), либо условные UPDATE вида WHERE status = 'PAID' с проверкой count — но второе не спасает от двойного списания у реселлера.

_Источник: prisma/schema.prisma:1127, 1003-1025_

**5. Чего НЕ ХВАТАЕТ — защита баланса реселлера от двойного списания**

Reseller.balance — обычный Decimal без версии/optimistic lock, ResellerTransaction.balanceAfter вычисляется приложением. Уникальных ключей на reseller_transactions нет вообще, а licenseId и orderId — голые Uuid-колонки БЕЗ FK и БЕЗ индекса. Следствия: (1) два параллельных запроса на продажу прочитают один и тот же balance и запишут два balanceAfter из одного основания — creditLimit будет пробит молча; лечится только UPDATE resellers SET balance = balance - :amt WHERE id = :id AND balance - :amt >= -credit_limit RETURNING balance (условие в WHERE, проверка affected rows) либо SELECT ... FOR UPDATE; (2) ничто не мешает списать за один и тот же заказ дважды — нужен @@unique([resellerId, type, orderId]) или отдельный ключ идемпотентности; (3) сверка «что мы списали по этому заказу» — seq scan, нужен индекс на (order_id) и (license_id).

_Источник: prisma/schema.prisma:977-982, 1003-1025_

**5. Чего НЕ ХВАТАЕТ — связка Order↔выданные лицензии и quantity**

Order.quantity Int @default(1), но License.orderId — обычный nullable FK с SetNull, без уникальности и без счётчика. В БД нет ничего, что связывало бы число выданных лицензий с quantity: повторный вызов выдачи по уже DELIVERED-заказу (ручная админская выдача, ретрай внутреннего вызова, баг ретрай-политики HTTP-клиента) создаст вторую лицензию, и обнаружится это только глазами. UNIQUE(unique_code) тут не помогает — он на другом уровне и защищает только путь Digiseller. Нужен либо @@unique([orderId, ...]) под конкретную семантику, либо условный переход Order.status PAID→DELIVERED в том же UPDATE, что создаёт лицензию, с проверкой count.

_Источник: prisma/schema.prisma:1047, 863-864, 885_

**5. Чего НЕ ХВАТАЕТ — брутфорс по коду покупки и нормализация кода**

uniqueCode — предъявительский документ ровно того же класса, что RegistrationKey.code, но: (1) у DigisellerOrder нет счётчика попыток (у VerificationToken есть attempts, и им пользуются в 2FA), нет никакой сущности под rate-limit на эндпоинт ввода кода, а в AntiFraudType нет подходящего значения (ближайшее RATE_LIMIT_EXCEEDED — общее); (2) колонка объявлена VarChar(64), а не citext, и никакой нормализации в схеме не закодировано — 'abc' и 'ABC' дадут ДВЕ строки и обойдут UNIQUE. Для регистрационных ключей нормализация живёт в сервисе (code.trim().toUpperCase().replace(/\s/g,'')), и для digiseller-кодов нужно осознанное решение: коды площадки регистрозависимы, поэтому копировать toUpperCase() нельзя — но и оставлять без нормализации whitespace/регистр молча тоже нельзя.

_Источник: prisma/schema.prisma:1117, 183-194, 468; src/modules/auth/registration-key.service.ts:328_

**5. Чего НЕ ХВАТАЕТ — целостность DigisellerOrder.redeemedByUserId и разрезы для поиска**

redeemedByUserId — Uuid без FK и без индекса, при том что аналогичный RegistrationKey.usedByUserId имеет и FK на users (onDelete SetNull), и индекс registration_keys_used_by_user_id_idx, добавленный отдельной миграцией именно как «пробел аудита». digiseller_orders в число журнальных таблиц (которым FK не положены по соглашению из шапки схемы) не входит — это операционная таблица. Итог: битые ссылки на удалённых пользователей ничем не ловятся, а вопрос поддержки «какие сделки погасил этот человек» — seq scan. Там же нет индексов на digiseller_product_id и verified_at.

_Источник: prisma/schema.prisma:1133, 535-536, 544; prisma/migrations/20260731143000_catchup_audit_gaps/migration.sql:123_

**5. Чего НЕ ХВАТАЕТ — денежная согласованность и состояние заказа**

Нет ни одного CHECK: не проверяется amount = quantity * price (цена тарифа может измениться между созданием и оплатой — Order.amount как снимок это правильно, но никто не проверяет, что снимок вообще из этого тарифа); не проверяется совпадение currency между LicensePlan, Order, Payment, Reseller.balance и DigisellerOrder — все пять хранят свою VarChar(3) независимо; нет связи знака ResellerTransaction.amount с type (SALE с положительной суммой запишется молча); нет соответствия статуса и меток времени (status=PAID при paidAt IS NULL валиден для БД). Плюс нет составного индекса (status, created_at) — а «висящие PENDING старше N часов» это первый же фоновый job платёжного модуля; сейчас есть отдельно (status) и отдельно (created_at).

_Источник: prisma/schema.prisma:796-797,1048-1049,1084-1085,977-978,1122-1123,1068-1069_

**5. Чего НЕ ХВАТАЕТ — идентификация покупателя до регистрации**

Схема допускает покупку до заведения аккаунта: Order.userId и License.userId nullable, DigisellerOrder.buyerEmail есть. Но нет ни поля, ни механизма, чтобы связать неопознанного покупателя с будущим аккаунтом: buyerEmail лежит только на DigisellerOrder, у Order своего контакта нет, а VerificationToken.payload/type не имеют значения под «покупка ждёт привязки». Практически это означает решение на уровне архитектуры, а не полей: код погашается ТОЛЬКО авторизованным пользователем (тогда buyerEmail — справочное поле для поддержки), либо нужен отдельный сценарий с токеном привязки. Второй вариант в схеме сегодня не выражен.

_Источник: prisma/schema.prisma:1036,826,1124,163-168_

**Что модуль оплаты ОБЯЗАН переиспользовать: LicensesService**

LicensesService — единственное место в системе, где создаются строки licenses; это заявлено в docblock сервиса и в комментарии к exports модуля («для регистрации по ключу, оплаты Digiseller и Launcher API»), модуль уже экспортируется. issue(params, tx?) принимает {userId: string|null, productId, planId, resellerId?, orderId?, issuedById?, notes?} и ВТОРЫМ аргументом Prisma.TransactionClient — то есть встраивается в чужую транзакцию, ровно как это делает registration-key.service.ts. Внутри он сам проверяет plan.productId === params.productId и бросает BadRequest PLAN_MISMATCH, сам генерирует ключ вида SLUG-XXXX-XXXX-XXXX-XXXX через randomInt из node:crypto, сам ставит status=PENDING и expiresAt=null. Срок при выдаче НЕ начинается — это принципиально: activate() вызывается только из hwid.service при первой привязке. Модуль оплаты не должен ни создавать License напрямую, ни звать activate(), ни считать expiresAt. Для отзыва при возврате — LicensesService.revoke(licenseId, reason, actor?), он уже пишет аудит с actorType SYSTEM при отсутствии актора и снимает currentDeviceId.

_Источник: src/modules/licenses/licenses.service.ts:19-25,57-100,108-131,281-318; src/modules/licenses/licenses.module.ts:10-13; src/modules/hwid/hwid.service.ts:172,209,364_

**Что модуль оплаты ОБЯЗАН переиспользовать: заведение пользователя**

Пользователей заводят ТРИ существующих места, и все три делают одно и то же тремя строками, которые нельзя пропустить: user.create + userRole.create со slug='user' (роль читается findUniqueOrThrow по slug) + локаль из settings.getString('app.default_locale','ru'). (1) AuthService.register — status=PENDING_VERIFICATION + VerificationToken EMAIL_VERIFY, письмо ставится в очередь ПОСЛЕ коммита; (2) RegistrationKeyService.registerWithKey — status=ACTIVE сразу (ключ выдан админом/реселлером и сам по себе есть подтверждение права), emailVerifiedAt=null, resellerId проставляется из ключа, и порядок жёсткий: user создаётся ДО погашения ключа, потому что used_by_user_id — FK на users; (3) OAuthService.createFromProfile — passwordHash=null, отдельная allocateUsername. Вход завершается ТОЛЬКО через AuthService.completeLogin(userId, username, email, locale, ctx, method) — он выдаёт пару токенов через TokenService.issuePair, обновляет lastLoginAt/lastLoginIp и пишет LoginHistory. Модуль оплаты не должен создавать User сам: либо он работает только с уже авторизованным пользователем, либо переиспользует один из этих путей (ближайший аналог — registerWithKey, где создание аккаунта и погашение кода лежат в одной транзакции). AuthModule экспортирует AuthService и TokenService.

_Источник: src/modules/auth/auth.service.ts:85-160,303-340; src/modules/auth/registration-key.service.ts:198-289; src/modules/auth/oauth/oauth.service.ts:229-274; src/modules/auth/auth.module.ts:59_

**Что модуль оплаты ОБЯЗАН переиспользовать: инфраструктурные сервисы**

NotificationService.enqueue({templateKey, channel, recipient?, userId?, locale?, payload?}) — ставит в notifications, НЕ отправляет, никогда не бросает наружу (внутри try/catch, возвращает null); шаблоны order.delivered ({{orderNumber}},{{productName}},{{planName}},{{licenseKey}}) и license.issued уже засеяны на ru и en. AuditService.record({action, actorId, actorType, entityType, entityId, before, after}) — без FK, с запретительным списком редактируемых полей; в него уже попадают license.revoke/license.extend/license.block. SettingsService.get/getString/getNumber с прозрачной расшифровкой isSecret через CryptoService — ключи digiseller.seller_id, digiseller.api_key (оба isSecret), digiseller.poll_interval_sec=900, digiseller.poll_window_hours=48 уже засеяны. ВНИМАНИЕ на двойной источник конфигурации: те же значения есть и в env (DIGISELLER_SELLER_ID/API_KEY/API_BASE/TOKEN_CACHE_TTL/POLL_INTERVAL, все optional) — надо выбрать один, и по образцу app.frontend_url в AuthService правильный выбор это Settings. Права orders.read.any / orders.read.own / orders.refund / payments.read засеяны и разложены по ролям; область видимости строится через resolveScope(actor, 'orders.read') из @common/rbac/scope, как это сделано в LicensesService.list. Ошибки Prisma наружу переводит AllExceptionsFilter (P2002→409 ALREADY_EXISTS, P2025→404, P2003→400) — свои try/catch по P2002 не нужны, кроме случаев, где нужен свой код ошибки.

_Источник: src/modules/notifications/notification.service.ts:36-80; src/common/audit/audit.service.ts; src/common/settings/settings.service.ts:78-128,192; prisma/seed.ts:93-97,143-144,244-247,353-359; src/common/config/env.schema.ts:164-171; src/modules/licenses/licenses.service.ts:341_

**Открытые вопросы:**

- Может ли покупатель ввести код Digiseller НЕ будучи авторизованным? От ответа зависит, нужен ли механизм отложенной привязки (сегодня в схеме его нет: buyerEmail лежит только на DigisellerOrder, у Order своего контакта нет), или код погашается только из кабинета и Order.userId всегда заполнен.
- Order.number: добавляем @default(dbgenerated("next_order_number()")) в schema.prisma, чтобы заработал уже созданный сиквенс, или генерируем номер в TypeScript и убираем DB-default? Сейчас DB-default мёртв, потому что Prisma всегда шлёт колонку явно.
- Digiseller-код регистрозависим? Если да — нормализовать нельзя ничем, кроме trim/удаления пробелов, и UNIQUE(unique_code) надо оставить регистрозависимым; если нет — колонку надо переводить в citext, иначе 'abc' и 'ABC' обойдут единственную защиту от двойной выдачи.
- Возможны ли частичные возвраты и quantity > 1 в одном заказе? Если да — нужна отдельная сущность Refund с суммой; текущие REFUNDED/refundedAt выражают только «вернули всё».
- Конфигурация Digiseller берётся из Settings (digiseller.*, isSecret, меняется из админки) или из env (DIGISELLER_*)? Оба набора существуют и сейчас противоречат друг другу.
- Списание с баланса реселлера идёт условным UPDATE (balance - amt >= -credit_limit в WHERE) или SELECT FOR UPDATE? Нужно решить до реализации: сейчас ни версии строки, ни ключа идемпотентности на reseller_transactions нет, и двойное списание ничем не ловится.
- Где живёт карантин непривязанного товара — строкой в digiseller_orders с payment_id IS NULL (тогда нужен статус/поле ошибки и частичный индекс) или отдельной таблицей? Сегодня «непривязан», «не проверен» и «просто не погашен» в таблице неразличимы.
- Отзыв лицензии при возврате — сразу REVOKED или через ручное подтверждение админом? Права orders.refund засеяны только для super_admin/admin, а поллер работает без актора; шаблона уведомления license.revoked в seed нет вообще.

### код:инфраструктура

**Источник истины для секретов площадки: БД перекрывает env**

SettingsService.get() разрешает значение строго в порядке кэш → строка в таблице settings → process.env → fallback-аргумент. Строка в БД, если она есть, побеждает env всегда. Имя env-переменной выводится из ключа: `process.env[key.replace(/\./g,'_').toUpperCase()]`, то есть digiseller.api_key → DIGISELLER_API_KEY — имена в схеме и в сиде совпадают, это один и тот же слот. НО: сид уже создаёт строки digiseller.seller_id и digiseller.api_key со значением пустой строки, поэтому строка в БД СУЩЕСТВУЕТ, ветка с process.env не достигается, и get() вернёт '' даже при заполненном DIGISELLER_API_KEY в окружении. Env-значения Digiseller при этом нигде в src не читаются вообще (ни одной ссылки на DIGISELLER_* вне env.schema.ts).

_Источник: apps/api/src/common/settings/settings.service.ts:78-111 (порядок разрешения, строка 98 — маппинг ключа в имя env); apps/api/prisma/seed.ts:244-247_

**Шифрование секрет-настроек: только через SettingsService.set()**

Шифрование происходит ровно в одном месте — SettingsService.set(): при existing.isSecret значение прогоняется через crypto.encrypt(String(value), { table: 'settings', column: 'value', rowId: existing.id }); иначе кладётся как есть. set() бросает NotFoundException, если строки нет, — создавать настройки сервис не умеет, строка обязана прийти из сида. AAD привязан к id КОНКРЕТНОЙ строки, поэтому шифротекст нельзя перенести в другую настройку.

Код (settings.service.ts:137-160):
```ts
const stored = existing.isSecret
  ? this.crypto.encrypt(String(value), {
      table: 'settings', column: 'value', rowId: existing.id,
    })
  : value;
await this.prisma.setting.update({ where: { key }, data: { value: stored as never, updatedById: updatedById ?? null } });
this.cache.delete(key);
await this.redis.client.publish(INVALIDATION_CHANNEL, key);
```

_Источник: apps/api/src/common/settings/settings.service.ts:137-160_

**Расшифровка секрет-настроек: safeDecryptSecret, ошибка НЕ пробрасывается**

И get(), и reloadAll() для isSecret-строк зовут private safeDecryptSecret(key, rowId, raw). Он: (а) возвращает raw как есть, если это не строка или строка пустая — то есть засеянное '' проходит мимо расшифровки; (б) при ошибке расшифровки пишет logger.error и возвращает null, чтобы неудачная ротация ключа не роняла старт. Итог: потребитель получает либо строку, либо '' , либо null, и по значению не отличает «не настроено» от «не расшифровалось».

```ts
private safeDecryptSecret(key: string, rowId: string, raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return raw;
  try {
    return this.crypto.decrypt(raw, { table: 'settings', column: 'value', rowId });
  } catch (error) {
    this.logger.error(`не удалось расшифровать настройку ${key}: ...`);
    return null;
  }
}
```

_Источник: apps/api/src/common/settings/settings.service.ts:189-199 (вызовы — 89-91 и 171-173)_

**Формат шифротекста и связка ключей**

CryptoService.encrypt/decrypt: AES-256-GCM, IV 12 байт, тег 16 байт, конверт `v<версия>.<iv_b64url>.<tag_b64url>.<ct_b64url>`. Ключи держатся в keyRing: текущий из ENCRYPTION_KEY с версией ENCRYPTION_KEY_VERSION плюс выведенные из ENCRYPTION_KEYS_RETIRED («1:hex,2:hex»). decrypt берёт ключ по версии из конверта; отсутствие ключа в связке → InternalServerErrorException. AAD строится как `${table}.${column}:${rowId}`. Есть needsReencryption(envelope) для фоновой перешифровки. Колонка settings.value имеет тип Json/JsonB — шифротекст лежит там как JSON-строка.

_Источник: apps/api/src/common/crypto/crypto.service.ts:112-192, 462-464; apps/api/prisma/schema.prisma:1402-1419_

**Кэш настроек и инвалидация между репликами**

Кэш — Map в памяти процесса, TTL записи 60_000 мс (CACHE_TTL_MS). Расшифрованный секрет кладётся в кэш в открытом виде. Инвалидация — Redis pub/sub канал 'settings:invalidate': ключ → cache.delete(key), '*' → reloadAll(). Подписчик — отдельное соединение redis.client.duplicate() (клиент в режиме subscribe не выполняет обычные команды). Pub/sub at-most-once, поэтому 60-секундный TTL — единственный backstop при потере сообщения.

_Источник: apps/api/src/common/settings/settings.service.ts:25-31, 51-67, 166-182_

**Планировщик есть: @nestjs/schedule, ScheduleModule.forRoot()**

В зависимостях @nestjs/schedule ^6.1.3, ScheduleModule.forRoot() подключён в app.module.ts. Комментарий прямо в app.module.ts перечисляет назначение: «разбор очереди уведомлений, обслуживание партиций, поллинг Digiseller». Два рабочих примера в коде: @Cron(CronExpression.EVERY_HOUR) в LicenseExpiryProcessor и @Interval(5_000) в NotificationProcessor.

_Источник: apps/api/src/app.module.ts:4, 62-64; apps/api/package.json ("@nestjs/schedule": "^6.1.3")_

**Устоявшийся паттерн периодической задачи: Redis SET NX как лок между репликами**

Оба существующих процессора устроены одинаково: `const acquired = await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEC, 'NX'); if (acquired === null) return;` затем try { работа } catch { logger.error } finally { del(LOCK_KEY) }. Ключи и TTL: 'notifications:processor:lock' / 30 с, 'licenses:expiry:lock' / 300 с. Владелец лока не проверяется — в finally делается безусловный del.

_Источник: apps/api/src/modules/notifications/notification.processor.ts:23-52; apps/api/src/modules/licenses/license-expiry.processor.ts:18-50_

**Интервалы задач зашиты константами, настройки периода не читаются**

@Interval/@Cron получают literal-константу на этапе декорирования; SchedulerRegistry в проекте не используется ни разу (грепом по src совпадений нет), то есть менять период из настроек на лету сейчас нечем. При этом период поллинга задан ДВАЖДЫ и не читается никем: env DIGISELLER_POLL_INTERVAL (default 900) и настройка digiseller.poll_interval_sec (900); рядом лежит digiseller.poll_window_hours = 48 («глубина проверки заказов на возвраты») и DIGISELLER_TOKEN_CACHE_TTL = 6600.

_Источник: apps/api/src/common/config/env.schema.ts:164-171; apps/api/prisma/seed.ts:246-247_

**RabbitMQ поднят, но кодом не используется**

В docker-compose есть сервис rabbitmq (rabbitmq:4-management-alpine, порты 5672/15672, healthcheck, api зависит от него через depends_on: service_healthy), RABBITMQ_URL обязателен в env-схеме (startsWith 'amqp://'). При этом в package.json НЕТ ни amqplib, ни @nestjs/microservices, а в src единственное упоминание RABBITMQ_URL — сама строка схемы. Отложенных задач, DLQ, брокерных очередей в коде нет. NotificationService явно фиксирует решение: очередь — таблица notifications, а не брокер, «брокер понадобится, когда появится веерная рассылка».

_Источник: docker-compose.yml:88-107, 177, 197-205; apps/api/src/common/config/env.schema.ts:73; apps/api/src/modules/notifications/notification.service.ts:8-19_

**Отправка писем: очередь — таблица notifications**

NotificationService.enqueue({templateKey, channel, recipient?, userId?, locale?, payload?}) создаёт строку notifications со статусом PENDING и id uuidv7. Метод НИКОГДА не бросает: всё завёрнуто в try/catch, при ошибке logger.error и возврат null — чтобы неудача постановки в очередь не откатывала бизнес-операцию. Локаль: явная → локаль пользователя → настройка app.default_locale ('ru'). Получатель фиксируется в момент постановки в очередь (для EMAIL — user.email), а не при отправке.

_Источник: apps/api/src/modules/notifications/notification.service.ts:37-82, 155-178_

**Разбор очереди и повторы**

NotificationProcessor.tick() под @Interval(5_000): TICK_MS=5000, BATCH_SIZE=20. attempts инкрементируется ДО отправки (чтобы письмо, принятое SMTP но упавшее по таймауту, не уходило вечно). Успех → status SENT, sentAt, плюс сохраняются renderedSubject/renderedBody (история того, что реально отправили). Ошибка → errorMessage (обрезка до 500 символов) и status обратно PENDING, а при исчерпании попыток — FAILED + failedAt. FAILED никем не переоткрывается.

> ОБНОВЛЕНО вместе с переходом на свой postfix. Было: MAX_ATTEMPTS=5, выборка `attempts < 5`, БЕЗ бэкоффа — пять попыток подряд по 5 секунд, дальше FAILED навсегда. Это означало, что 25 секунд недоступного SMTP уничтожают письмо окончательно, а 25 секунд их даёт любая выкладка (пересоздание lp-opendkim при `milter_default_action = tempfail`). Стало: восемь попыток по нарастающей паузе (RETRY_BACKOFF_MS: 0, 1 мин, 5, 15, 30 мин, 1, 2, 4 ч — около восьми часов суммарно), `failedAt` пишется при КАЖДОЙ неудаче и служит отметкой «когда пробовали», а постоянный отказ 5xx уводит в FAILED сразу, не тратя восемь попыток на «такого ящика нет».

_Источник: apps/api/src/modules/notifications/notification.processor.ts:11-16, 37-113_

**Транспорт и рендеринг**

MailService — nodemailer createTransport с pool: true, maxConnections 3, maxMessages 100, connectionTimeout/greetingTimeout 10_000, socketTimeout 20_000; send() бросает при неудаче, повтор — забота вызывающего. На старте transport.verify() не бросает, только warn. Отправляется ТОЛЬКО text (не html). Рендеринг — NotificationService.render(): шаблон ищется в таблице notification_templates по составному ключу (key, locale, channel) с откатом на app.default_locale; неактивный или ненайденный шаблон → throw. Подстановка — регулярка /\{\{(\w+)\}\}/g, отсутствующая переменная заменяется пустой строкой + warn в лог. Каналы: EMAIL отправляется, INTERNAL — no-op (строка в БД и есть доставка), DISCORD/TELEGRAM бросают «ещё не реализован».

_Источник: apps/api/src/modules/notifications/mail.service.ts:23-66; apps/api/src/modules/notifications/notification.service.ts:91-138; apps/api/src/modules/notifications/notification.processor.ts:115-141_

**Шаблон «лицензия выдана после оплаты» уже засеян — заводить новый не нужно**

В сиде есть два подходящих ключа, оба в ru и en, канал EMAIL: (1) order.delivered — subject «Заказ {{orderNumber}} выполнен», body с переменными {{orderNumber}}, {{productName}}, {{planName}}, {{licenseKey}}; (2) license.issued — subject «Лицензия {{productName}} активирована», переменные {{username}}, {{productName}}, {{planName}}, {{expiresAt}}, {{downloadUrl}}. Секция сида так и подписана — «Лицензии и заказы». Чего НЕТ: варианта order.delivered для канала INTERNAL (для license.expiring и hwid.reset INTERNAL-варианты есть), и вообще нет ключей уровня order.paid / order.refunded / payment.*.

_Источник: apps/api/prisma/seed.ts:331-356, 360-384, 386-396_

**Готового HTTP-клиента для внешних API нет**

Ни axios, ни @nestjs/axios (HttpModule/HttpService), ни undici, ни got, ни node-fetch в package.json нет. В src ровно два вызова внешнего HTTP, оба — глобальный fetch в DiscordOAuthProvider: `fetch(TOKEN_URL, {..., signal: AbortSignal.timeout(10_000)})` и `fetch(USER_URL, {..., signal: AbortSignal.timeout(10_000)})`. Ретраев, бэкоффа, circuit breaker, общей обёртки, логирования исходящих запросов — нет. Единственный клиент с настроенными таймаутами — S3 (@aws-sdk/client-s3), и его таймауты заданы отдельными env-переменными S3_CONNECT_TIMEOUT_MS / S3_REQUEST_TIMEOUT_MS / S3_READ_DEADLINE_MS. Для Digiseller в env есть только DIGISELLER_API_BASE (default https://api.digiseller.ru), таймаутов площадки в схеме нет.

_Источник: apps/api/package.json (dependencies); apps/api/src/modules/auth/oauth/discord.provider.ts:88-99, 122-125; apps/api/src/common/config/env.schema.ts:145-154, 169_

**Фоновые ошибки: catch + logger.error, и ничего больше**

Обе периодические задачи ловят ошибку внутри себя и только пишут в лог: `catch (error) { this.logger.error('сбой обработки очереди: ...') }` / `'сбой обслуживания сроков: ...'`, лок снимается в finally. Ни алертов, ни метрик, ни записи в audit_logs / anti_fraud_events, ни DLQ, ни счётчика подряд идущих падений, ни healthcheck-сигнала о зависшей задаче. Упавшая задача просто пропускает такт и будет вызвана снова на следующем интервале. AllExceptionsFilter — глобальный APP_FILTER, он покрывает только HTTP-конвейер и к @Cron/@Interval отношения не имеет.

_Источник: apps/api/src/modules/notifications/notification.processor.ts:43-51; apps/api/src/modules/licenses/license-expiry.processor.ts:37-49; apps/api/src/app.module.ts:82-88_

**Незакрытый путь: исключение до входа в try + отсутствие process-level обработчиков**

Строка захвата лока `await this.redis.client.set(...)` стоит ВНЕ try в обоих процессорах. Если Redis отвергает команду (после maxRetriesPerRequest: 3 ioredis отклоняет промис), промис обработчика @Cron/@Interval отклоняется наружу и в catch не попадает. Обработчиков process.on('unhandledRejection') / ('uncaughtException') в src нет ни одного (грепом — 0 совпадений). Также: TTL лока уведомлений 30 с при батче в 20 писем с socketTimeout 20 с — батч может пережить лок, а finally делает безусловный del без проверки владельца.

_Источник: apps/api/src/modules/notifications/notification.processor.ts:24, 40-51; apps/api/src/common/redis/redis.service.ts:26-36; grep process.on по src — совпадений нет_

**Схема БД под оплату уже готова, кода нет**

В Prisma-схеме есть модели Order, Payment и DigisellerOrder. У DigisellerOrder: uniqueCode @unique (комментарий: «главная защита от двойной выдачи лицензии при ретраях вебхука»), invId @unique, digisellerProductId, amount/currency/buyerEmail, rawPayload Json, verifiedAt, redeemedAt, redeemedByUserId, refundedAt («сделка отменена площадкой постфактум → лицензию отзываем»), lastPolledAt с индексом, плюс индекс по redeemedAt. LicensePlan.digisellerProductId Int? @unique связывает тариф с товаром площадки; поле уже проброшено в ProductsService и DTO. Модуля orders/payments/digiseller в src/modules нет (там auth, health, hwid, launcher, licenses, notifications, products).

_Источник: apps/api/prisma/schema.prisma:1031, 1075, 1108-1146, 786-800; apps/api/src/modules/products/products.service.ts:254, 296, 318_

**Открытые вопросы:**

- Что считать источником истины для DIGISELLER_SELLER_ID / DIGISELLER_API_KEY: сид уже создал строки настроек с пустой строкой, и из-за этого env-ветка в SettingsService.get() недостижима — значит, ключи обязаны заводиться через админку (SettingsService.set шифрует), а env-переменные остаются мёртвыми. Оставляем env как есть, удаляем, или меняем поведение get() на «пустая строка в БД = проваливаемся в env»?
- Секрет, записанный в settings.value в обход SettingsService.set() (например, руками в SQL или повторным прогоном сида с непустым value), при чтении не расшифруется: crypto.decrypt бросит на формате конверта, safeDecryptSecret вернёт null и запишет error в лог. Отличить «не настроено» (пустая строка) от «сломано» (null) вызывающий код не может — нужно ли требование на явную проверку?
- Период поллинга задан в трёх местах (env DIGISELLER_POLL_INTERVAL, настройка digiseller.poll_interval_sec, и константа в декораторе @Interval/@Cron), но @nestjs/schedule без SchedulerRegistry читать настройку на лету не умеет. Что решает: фиксированный @Cron с игнорированием настройки, или SchedulerRegistry с перечиткой?
- RabbitMQ поднят в compose и обязателен по env-схеме, но кодом не используется вовсе. Он предназначен под поллинг/возвраты Digiseller, или остаётся неиспользуемым, а фон делается на @nestjs/schedule, как уже сделаны уведомления и сроки лицензий?
- Под сценарий возврата (DigisellerOrder.refundedAt → отзыв лицензии) шаблона письма нет: в сиде есть только order.delivered и license.issued. Нужен ли новый ключ (order.refunded / license.revoked) — по ТЗ или на усмотрение?
- Для внешних вызовов Digiseller нет ни клиента, ни таймаута в env-схеме (есть только DIGISELLER_API_BASE). Повторять паттерн discord.provider (голый fetch + AbortSignal.timeout, без ретраев) или заводить общий клиент — и если общий, в common/ или внутри модуля?
- Токен Digiseller: DIGISELLER_TOKEN_CACHE_TTL = 6600 подразумевает кэш токена, но в какой слой — Redis (RedisService.client есть, обёрток нет) или память процесса? Прецедента кэширования внешнего токена в проекте нет.
- Как должна вести себя периодическая задача поллинга при устойчивом недоступности API площадки: сейчас единственная реакция на любой сбой — logger.error, ни метрики, ни алерта, ни счётчика подряд идущих падений в проекте нет.

---

## Проект (черновик, требует ревизии)

# Итоговый проект

Синтез трёх вариантов. Каркас исполнения — В2 (интейк-вперёд, транзакция из 5 шагов, классификатор ответов), защитный контур — В3 (два счётчика вместо одного, глобальный бакет, анти-оракул, дедуп по inv как второй слой), недостающие сущности и наблюдаемость — В1 (`refunds`, `digiseller_events`, `deliverNotifiedAt`, частичные индексы). Ниже — то, что реально реализуется; спорные места разрешены проверкой кода, а не голосованием.

## Что проверено в репозитории (основание для решений)

| Факт | Место |
|---|---|
| `issue(params, tx?)` принимает чужую транзакцию, ставит `PENDING`/`expiresAt=null` | `apps/api/src/modules/licenses/licenses.service.ts:57-100` |
| `revoke(licenseId, reason, actor?)` — **tx НЕ принимает**, ходит через `this.prisma` | `apps/api/src/modules/licenses/licenses.service.ts:281-318` |
| Эталон условного погашения: `updateMany({where:{id, usedAt:null}})` + `count===0 → Conflict` | `apps/api/src/modules/auth/registration-key.service.ts:252-265, 302-321` |
| Ветка `process.env` достижима **только если строки в БД нет** | `apps/api/src/common/settings/settings.service.ts:94-101` |
| Сид создаёт `digiseller.seller_id`/`api_key` со значением `''` → env мёртв | `apps/api/prisma/seed.ts:244-245` |
| `safeDecryptSecret` возвращает `''` как есть и `null` при сбое расшифровки, наружу не бросает | `settings.service.ts:189-199` |
| DB-default `next_order_number()` существует, но в `schema.prisma:1034` нет `@default` → мёртв | `migrations/20260731143000_catchup_audit_gaps/migration.sql:145-154` |
| `AntiFraudType` не имеет значений под перебор кода и под возврат | `schema.prisma:182-194` |
| Паттерн лимита: INCR+EXPIRE, событие ровно на `soft+1`, fail-open с WARN, пороги через `limit(key, fallback)` | `apps/api/src/modules/launcher/payload.service.ts:466-537, 664-676` |
| Захват Redis-лока стоит **вне** `try`, снятие — безусловный `del` | `notification.processor.ts:39-51` |
| `trustProxy: true` — настоящий IP клиента доступен | `apps/api/src/main.ts:46` |
| Отзыв доезжает до лаунчера за `limits.license.check_cache_ttl_sec` (300 с) | `launcher.service.ts:292-304, 506` |
| P2002 → 409 `ALREADY_EXISTS` глобальным фильтром | `all-exceptions.filter.ts:151-159` |
| HTTP-клиента нет вовсе; прецедент — голый `fetch` + `AbortSignal.timeout` | `auth/oauth/discord.provider.ts:88-99` |

## Файлы

```
apps/api/src/modules/payments/
  payments.module.ts
  orders.controller.ts                 GET /orders, /orders/:id, POST /orders/:id/refund
  orders.service.ts                    чтение через resolveScope + ручной возврат
  payments.controller.ts               GET /payments
  refunds.service.ts                   applyProviderRefund / manualRefund
  dto/orders.dto.ts
  dto/digiseller.dto.ts
  digiseller/
    digiseller.controller.ts           redeem, status, quarantine, health
    digiseller-redeem.service.ts       фаза A (интейк) + фаза B (проверка)
    digiseller-fulfillment.service.ts  фаза C — ЕДИНСТВЕННАЯ транзакция
    digiseller-quarantine.service.ts   разбор зависших сделок админом
    digiseller-config.service.ts       трёхзначное состояние конфигурации
    digiseller-token.service.ts        Redis-кэш токена + single-flight + INCR-timestamp
    digiseller.client.ts               DigisellerHttpClient implements DigisellerApi
    digiseller.mapper.ts               ЧИСТЫЕ функции: classify/normalizeCode/mapCurrency/resolveQuantity
    digiseller.types.ts
    digiseller-limits.service.ts       два счётчика + глобальный бакет + отрицательный кэш
    digiseller-verify.processor.ts     @Interval(15_000) — досчитывает PENDING_VERIFY
    digiseller-deliver.processor.ts    @Interval(60_000) — дозвон PUT .../deliver
    digiseller-poll.processor.ts       @Cron(EVERY_5_MINUTES) — возвраты
    digiseller.constants.ts
apps/api/prisma/migrations/20260802120000_digiseller_payments/migration.sql
apps/api/test/digiseller-*.spec.ts     (см. testPlan)
```

Правки существующих файлов: `licenses.service.ts` (`revoke(..., tx?)`), `schema.prisma`, `seed.ts`, `env.schema.ts`, `app.module.ts` (импорт `PaymentsModule`), `main.ts` (`process.on('unhandledRejection'|'uncaughtException')`).

## Путь покупателя

**Фаза A — интейк, своя короткая транзакция, сети нет.**
`POST /api/v1/billing/digiseller/redeem` под JWT. `normalizeCode` (trim + удаление пробельных и zero-width, регистр НЕ трогаем) → формат-гейт (ровно 16 символов, charset `[A-Za-z0-9]`) → дешёвый счётчик malformed → отрицательный кэш → дорогие лимиты → `INSERT digiseller_orders (state=PENDING_VERIFY, claimed_by_user_id, next_attempt_at=now())`. P2002 — не ошибка: перечитываем строку и ветвимся по `state`.

**Фаза B — проверка, сети да, транзакции НЕТ.** `GET /api/purchases/unique-code/{code}?token=…`. `classify()` даёт `OK | RETRYABLE | AUTH | REJECT`. Не-OK → строка остаётся `PENDING_VERIFY` с `verify_attempts+1` и экспоненциальным `next_attempt_at`, покупателю **202**, досчитывает `digiseller-verify.processor`.

**Фаза C — исполнение, ровно одна транзакция** (`{ timeout: 10_000, maxWait: 5_000 }`, READ COMMITTED):
1. `tx.digisellerOrder.updateMany({ where: { id, redeemedAt: null, state: { in: ['PENDING_VERIFY','VERIFIED'] } }, data: { state: 'FULFILLED', redeemedAt, redeemedByUserId, invId, verifiedAt, rawPayload, buyerEmail, digisellerProductId } })` → `count !== 1` → `ConflictException` и откат.
2. `tx.order.create({ status: PAID, source: DIGISELLER, ... })` — `number` **не передаём**, работает DB-default.
3. `tx.payment.create({ provider: DIGISELLER, status: CONFIRMED, externalId: String(inv) в ТОМ ЖЕ INSERT, amount/currency площадки, rawPayload })`.
4. `tx.digisellerOrder.update({ paymentId })`.
5. `licenses.issue({ userId, productId, planId, orderId }, tx)` × `quantity`.
6. `tx.order.updateMany({ where: { id, status: 'PAID' }, data: { status: 'DELIVERED', deliveredAt } })` → `assert count === 1`.

**Инвариант модуля, записывается в `apps/api/src/modules/payments/CLAUDE.md` и покрывается тестом:** ни одного HTTP-вызова к площадке при открытой транзакции Prisma. Обоснование конкретное: таймаут транзакции 10 с против 14-секундного таймаута площадки за DDoS-Guard — зависший Digiseller выест пул соединений и положит `POST /launcher/check` для **уже заплативших**.

**Фаза D — после коммита, best-effort, но не «забыл»:** `notifications.enqueue('order.delivered')`, `audit.record('digiseller.redeem')`, `PUT .../deliver` с записью `deliverNotifiedAt`; недозвонившиеся строки добирает `digiseller-deliver.processor` (`redeemedAt IS NOT NULL AND deliver_notified_at IS NULL`). `retval 0` и `retval 4` — оба успех; `retval 3` — наш баг порядка вызовов, в лог ERROR.

**Дальше без нашего кода:** лицензия `PENDING`, `expiresAt = null`. Срок стартует только в `hwid.service` → `licenses.activate`. Модуль оплаты `activate()` не зовёт и `expiresAt` не считает.

## Ровно-однократность — четыре слоя

1. `UNIQUE(unique_code)` — гонка на создании строки в фазе A.
2. **Новый** `UNIQUE (lower(unique_code))` — закрывает дыру «`abc` и `ABC` = две строки». Коллизия по нему **не отказ**, а карантин `CODE_CASE_COLLISION`: если коды окажутся регистрозависимыми, законный покупатель попадёт в ручной разбор, а не получит «неверный код».
3. Условие `redeemedAt IS NULL` **в WHERE самого UPDATE** + проверка `count` — гонка на погашении. EvalPlanQual при READ COMMITTED перечитывает строку после разблокировки. Отдельный `SELECT` перед `UPDATE` эту гонку не закрывает; SERIALIZABLE не нужен — предикатных гонок по диапазону нет.
4. `UNIQUE(inv_id)` (остаётся nullable — на интейке inv ещё неизвестен) + `payments_provider_external_id_key` при `externalId = String(inv)`, подпёртый новым `CHECK`. Ловит два разных кода на один счёт и повторную выдачу кода поддержкой площадки.

Плюс условный переход `PAID → DELIVERED` — единственное, что связывает число лицензий с фактом выдачи по заказу.

## Деньги

- `Order.amount/currency` = снимок **нашего** прайса (`plan.price × quantity`, валюта тарифа). Отчётность по заказам остаётся в одной когерентной валюте.
- `Payment.amount/currency` = сумма и валюта **площадки**. `mapCurrency`: `WMZ→USD, WMR→RUB, WME→EUR, WMU→UAH, WMX→BTC`; неизвестный код (`WMT` и любой новый) — все они трёхсимвольные, поэтому пишется **как есть** + `audit.record('digiseller.currency_unmapped')`. Молчаливой подстановки RUB нет, но и выдачу неизвестная валюта не блокирует.
- Жёсткого гейта по сумме нет: `promo_code`/`bonus_code` площадка поддерживает штатно, и порог «заплатил меньше цены» ломается на них. Расхождение `payment.amount` с `plan.price` → аудит-событие.
- `quantity = cnt_goods`, если целое `1..limits.digiseller.max_quantity` (20); `null`/`0`/отсутствует/не-число → 1; больше максимума → карантин `QUANTITY_OUT_OF_RANGE`. Это и есть настоящая защита от «напечатали тысячу лицензий».
- Даты площадки (`date_pay` и прочие) — только в `rawPayload` и `providerPaidAt`. Весь автомат (`redeemedAt`, `refundedAt`, `deliverNotifiedAt`) движется нашим `now()`: формат и TZ этих полей документацией не заданы, и ошибка их разбора не смеет менять денежный исход.

## Возвраты

Обнаружение — только поллинг (`digiseller-poll.processor`, `@Cron(EVERY_5_MINUTES)` как фиксированный тик; настройка `digiseller.poll_interval_sec` определяет, какие строки **созрели** по `last_polled_at` — так три источника периода схлопываются в один без `SchedulerRegistry`, который в проекте не используется ни разу).

- Дешёвая развёртка: `POST /api/seller-sells/v2`, `returned=2`, окно `poll_window_hours=48`, даты `'yyyy-MM-dd HH:mm:ss'` в **МСК (UTC+3)** — единственное место в системе, где время не UTC.
- Точечная доводка: `GET /api/purchase/info/{inv}` по `redeemed_at IS NOT NULL AND refunded_at IS NULL`, курсор по `last_polled_at`, расписание затухающее (свежие — чаще, после `digiseller.refund_watch_days=90` снимаются с наблюдения).

Реакция, одна транзакция, вся на условных UPDATE:
- `invoice_state = 5` **или** `unique_code_state.state = 4` → `refunded_at` условно (`count=0` → уже отработано, молча выходим) → строка в `refunds` → `Payment REFUNDED WHERE status='CONFIRMED'` → `Order REFUNDED WHERE status IN ('PAID','DELIVERED')` → `licenses.revoke(id, reason, undefined, tx)` → `enqueue('license.revoked')` → `AntiFraudEvent(PAYMENT_REVERSAL)`.
- `invoice_state = 35` (возврат начат, покупателем не завершён) → **не отзываем**, `state=REFUND_PENDING` + уведомление админа. Отзыв здесь наказывает человека, который свою же заявку отменит.
- **Рецидив** (≥2 возврата по одному `buyerEmail` или пользователю) → `AntiFraudEvent(PAYMENT_REVERSAL, HIGH, actionTaken='blocked')`, `Device.isBlocked = true` для устройства активации, запрет погашения по этой почте. Скорость отзыва второстепенна — payload уже скачан; останавливать надо повторяемость схемы.
- **Частичный возврат** в v1 автоматически лицензии не отзывает: `refunds` фиксирует сумму, заказ переходит в `PARTIALLY_REFUNDED`, дальше — ручное решение админа. Алгоритм «отозвать `floor(returned/unit_price)` штук» из В1 отвергнут как спекулятивный: правило распределения при `quantity>1` — коммерческое решение владельца, а не техническое.

## Лимиты (все — строки `limits.digiseller.*` в settings, читаются паттерном `limit(key, fallback)`)

| Ключ | Значение | Смысл |
|---|---|---|
| `malformed_per_ip_per_10min` | 20 | **дешёвый** счётчик: формат не прошёл, в API не ходили. Опечатка честного покупателя стоит ему ноль из дорогого лимита |
| `redeem_per_user_per_hour` | 10 | дорогой (идём в API). Пробой → 429 + `Retry-After` |
| `redeem_soft_per_user_per_hour` | 5 | не отказ, `AntiFraudEvent(CODE_BRUTEFORCE, MEDIUM)` ровно на `soft+1` |
| `redeem_per_ip_per_hour` / `_per_subnet_per_hour` | 30 / 60 (/24) | реальный рубеж против фермы аккаунтов; берётся строжайший из трёх |
| `global_upstream_per_minute` | 60 | токен-бакет перед клиентом площадки. Исчерпан → 503 `PROVIDER_UNAVAILABLE`, дорогой счётчик пользователя **не** тратится |
| `max_quantity` | 20 | потолок `cnt_goods` |

Отрицательный кэш `digiseller:neg:<sha256(code)>` EX 3600 — только терминальные вердикты, не сетевые сбои. Лестница задержек 0,0,0,5,15,60,300 с. Ни капчи, ни блокировки аккаунта: аккаунтов у противника сколько угодно, а честному покупателю блокировка — терминальный экран.

**Fail-политика при недоступности Redis раздельная:** пер-пользовательский и пер-IP счётчики fail-**open** с WARN (как в `payload.service.ts` — это наблюдение, а не рубеж); глобальный бакет fail-**closed** → 503. Fail-open на глобальном означает, что падение Redis снимает единственную преграду перед потоком к площадке, а бан у DDoS-Guard — это отказ всех продаж (единственный канал по У-1).

**Анти-оракул:** «код не существует» и «код погашен ДРУГИМ» отвечают одинаково — 404 `CODE_INVALID`. 409 с номером заказа — только если код погасил сам запрашивающий (повторная отправка формы обязана быть безобидной).

## Эндпоинты

| Метод | Путь | Доступ | Ответы |
|---|---|---|---|
| POST | `/api/v1/billing/digiseller/redeem` | JWT | 200 FULFILLED / 202 PENDING_VERIFY / 202 QUARANTINED / 400 CODE_MALFORMED / 404 CODE_INVALID / 409 (свой погашенный) / 429 + Retry-After / 503 PROVIDER_UNAVAILABLE / 503 DIGISELLER_NOT_CONFIGURED |
| GET | `/api/v1/billing/digiseller/redeem/:code/status` | JWT, только заявителю | тот же конверт |
| GET | `/api/v1/orders`, `/orders/:id` | `orders.read.any`/`.own` через `resolveScope(actor,'orders.read')` | — |
| GET | `/api/v1/payments` | `payments.read` | — |
| POST | `/api/v1/orders/:id/refund` | `orders.refund`, `@Audit` | ручной рычаг рядом с поллером |
| GET | `/api/v1/billing/digiseller/quarantine` | `orders.read.any` | очередь зависших сделок |
| POST | `/api/v1/billing/digiseller/quarantine/:id/resolve` | `orders.refund` | после того как админ завёл тариф |
| GET | `/api/v1/billing/digiseller/health` | `payments.read` | состояние конфигурации/токена/breaker/счётчики по `state`/время последнего успешного поллинга. **В `/health/ready` НЕ включается** — готовность нашего API не должна зависеть от третьей стороны |

Входящего вебхука и `supplier-callback` в v1 нет (см. раздел владельца).

## Сигнатуры

```ts
// digiseller.mapper.ts — чистые функции, тестируются таблицей без сети
export type Verdict =
  | { kind: 'OK'; purchase: VerifiedPurchase }
  | { kind: 'RETRYABLE'; reason: string }
  | { kind: 'AUTH' }
  | { kind: 'REJECT'; code: 'CODE_INVALID' };
export function classify(raw: { status: number; contentType: string | null; body: string }): Verdict;
export function normalizeCode(raw: string): string;                     // trim + \s + zero-width, регистр не трогаем
export function mapCurrency(typeCurr: string): { code: string; mapped: boolean };
export function resolveQuantity(cntGoods: unknown, max: number):
  { quantity: number } | { quarantine: 'QUANTITY_OUT_OF_RANGE' };

// digiseller.client.ts
export interface DigisellerApi {
  login(sellerId: string, apiKey: string): Promise<{ token: string; validThru: Date }>;
  getPurchaseByUniqueCode(code: string, token: string): Promise<Verdict>;
  markDelivered(code: string, token: string): Promise<'OK' | 'ALREADY' | 'NOT_VERIFIED' | 'RETRYABLE'>;
  getPurchaseInfo(inv: bigint, token: string): Promise<PurchaseInfo | { kind: 'RETRYABLE' }>;
  listReturnedSales(p: { from: Date; to: Date; page: number; rows: number }, token: string): Promise<SellerSellsPage>;
}
export const DIGISELLER_API = Symbol('DIGISELLER_API');   // Nest-токен; в тестах — FakeDigisellerApi

// digiseller-token.service.ts
class DigisellerTokenService {
  async getToken(): Promise<string>;      // Redis digiseller:token, TTL = validThru − 300s, single-flight SET NX
  async invalidate(): Promise<void>;      // на 401
  private async nextTimestamp(): Promise<number>;  // INCR digiseller:token:ts, засеян now()
  private sign(apiKey: string, ts: number): string; // sha256(apiKey + ts), hex, конкатенация без разделителя
}

// digiseller-config.service.ts
type DigisellerConfigState =
  | { status: 'OK'; sellerId: string; apiKey: string }
  | { status: 'NOT_CONFIGURED' }      // '' в settings
  | { status: 'DECRYPT_FAILED' };     // null из safeDecryptSecret — ГРОМКО, не тихо
class DigisellerConfigService { async resolve(): Promise<DigisellerConfigState>; }

// digiseller-redeem.service.ts
type RedeemResult =
  | { state: 'FULFILLED'; orderId: string; orderNumber: string; licenseKeys: string[] }
  | { state: 'PENDING_VERIFY'; retryAfterSec: number }
  | { state: 'QUARANTINED'; ticket: string; reason: QuarantineCode };
class DigisellerRedeemService {
  async redeem(code: string, actor: AuthenticatedUser, ctx: RequestContext): Promise<RedeemResult>;
  async status(code: string, actor: AuthenticatedUser): Promise<RedeemResult>;
}

// digiseller-fulfillment.service.ts — идемпотентен, зовётся из HTTP и из воркера
class DigisellerFulfillmentService {
  async fulfill(claimId: string, purchase: VerifiedPurchase): Promise<RedeemResult>;
}

// refunds.service.ts
class RefundsService {
  async applyProviderRefund(i: { digisellerOrderId: string; amount: Prisma.Decimal; currency: string;
    externalRef: string; source: 'POLL' | 'MANUAL' }): Promise<void>;
  async manualRefund(orderId: string, dto: ManualRefundDto, actor: AuthenticatedUser): Promise<void>;
}

// licenses.service.ts — ПРАВКА существующего, симметрично issue(params, tx?)
async revoke(licenseId: string, reason: string, actor?: AuthenticatedUser, tx?: Prisma.TransactionClient)
```

## Правки схемы (`20260802120000_digiseller_payments`)

Блокирующие:
1. `Order.number` → `@default(dbgenerated("next_order_number()"))` — оживляет уже созданный сиквенс. Иначе модуль продублирует формат в TypeScript и разъедется по `orders_number_key`.
2. `CHECK (provider <> 'DIGISELLER' OR external_id IS NOT NULL)` на `payments` — без него `@@unique([provider, externalId])` на NULL не защищает ни от чего.
3. `DigisellerOrder.state` — новый enum `DigisellerClaimState { PENDING_VERIFY | VERIFIED | FULFILLED | QUARANTINED | REJECTED | REFUND_PENDING | REFUNDED | FAILED_PERMANENT }` + `quarantineCode`, `lastError`, `verifyAttempts Int @default(0)`, `nextAttemptAt`, `claimedByUserId`.
4. `DigisellerOrder.deliverNotifiedAt` + частичный индекс под дозвон.
5. `CREATE UNIQUE INDEX digiseller_orders_unique_code_lower_key ON digiseller_orders (lower(unique_code))`.
6. Таблица `digiseller_events (provider, event_type, external_id, payload JsonB, received_at, processed_at, process_error)` c `@@unique([provider, external_id])`; поллер пишет событие только на СМЕНУ состояния, `external_id = 'poll:{inv}:{invoice_state}'`.
7. Таблица `refunds (id, payment_id FK, order_id FK, amount, currency, source, external_ref, reason, created_by_id, created_at)` c `@@unique([paymentId, externalRef])`; `OrderStatus += PARTIALLY_REFUNDED`, `PaymentStatus += PARTIALLY_REFUNDED`.
8. `AntiFraudType += CODE_BRUTEFORCE, PAYMENT_REVERSAL`.

Целостность/производительность:
9. `DigisellerOrder.redeemedByUserId` → FK на `users` `onDelete: SetNull` + индекс (ровно тот пробел, что для `registration_keys.used_by_user_id` уже закрыли отдельной миграцией).
10. Частичные индексы: `(state, next_attempt_at) WHERE state='PENDING_VERIFY'`, `(created_at) WHERE redeemed_at IS NULL`, `(last_polled_at) WHERE redeemed_at IS NOT NULL AND refunded_at IS NULL`.
11. Индексы на `digiseller_product_id`, `verified_at`; `Order @@index([status, createdAt])`.
12. `DigisellerOrder.providerPaidAt`, `cartUid`, `invoiceState Int?`.

Сид: шаблоны `license.revoked` (ru/en, EMAIL), строки `limits.digiseller.*`, `digiseller.refund_watch_days=90`, `digiseller.max_quantity=20`.

`env.schema.ts`: **удалить** `DIGISELLER_SELLER_ID`, `DIGISELLER_API_KEY` (мертвы — доказано), `DIGISELLER_POLL_INTERVAL`, `DIGISELLER_TOKEN_CACHE_TTL`. Оставить `DIGISELLER_API_BASE` со сменой умолчания на `https://api.digiseller.com` и добавить `DIGISELLER_TIMEOUT_MS` (10000), `DIGISELLER_FALLBACK_BASE` (`https://oplata.info`).

## HTTP-клиент

`DigisellerHttpClient` живёт **внутри модуля**, а не в `common/`: он кодирует специфику площадки, а не транспорт. Голый `fetch` + `AbortSignal.timeout` по образцу `discord.provider.ts:88-99`, плюс обязательное: проверка `Content-Type` **до** парсинга (DDoS-Guard отдаёт HTML при HTTP 200); нормализация трёх несовместимых схем ошибок (HTTP 200 + `retval<0`; HTTP 400 + `{retval,retdesc}`; HTTP 401 с пустым телом); default-ветка «неизвестный retval → RETRYABLE, никогда не REJECT»; ретраи только для идемпотентных GET (макс 2, backoff 300/900 мс с джиттером); на 401 — ровно **одна** принудительная инвалидация токена и один повтор, дальше RETRYABLE; на 403 — однократный `GET /api/token/perms`, отсутствие права → `NOT_CONFIGURED` и алерт, а не ретрай; `apilogin` не ретраится с тем же timestamp никогда. Circuit breaker на хост в Redis; failover на `oplata.info` **только** для семейства unique-code (для остальных методов резерв не документирован — слепой failover даст загадочные 404). Ни токен, ни `api_key`, ни сам код покупки в логи не попадают (код — предъявительский документ, та же логика, что в `licenses.service.ts:313` про `license.key`).

Дефекты существующих процессоров не копируются: захват Redis-лока **внутрь** `try`, снятие — Lua compare-and-delete по случайному значению владельца. Заодно заводятся `process.on('unhandledRejection'|'uncaughtException')` в `main.ts` — их в проекте нет ни одного.

---

# Что требует решения ВЛАДЕЛЬЦА (кодом не берётся)

1. **Переключать ли товар на Digiseller в режим «выдача через наш сервер» (`supplier-callback`)?** Это меняет витрину: покупатель получал бы НАШ активационный токен вместо 16-значного кода площадки. Выигрыш крупный — перебор перестаёт стоить нам обращений к третьей стороне, опечатка ловится контрольным символом локально, а `inv` и email приходят к нам в момент продажи. Цена — настройка товара в кабинете, пароль на сервисе (`MD5(id:inv:пароль)`, при утечке — чеканка лицензий перебором последовательного `inv`) и новая публичная точка входа. Модуль спроектирован так, чтобы этот канал добавился поверх без переделки ядра. **Решение владельца, потому что оно меняет то, что видит покупатель.**
2. **Горизонт наблюдения за возвратами.** Мы снимаем сделку с поллинга через 90 дней (`digiseller.refund_watch_days`). Возврат или чарджбек после этого не будет обнаружен, и лицензия продолжит работать. Нужен реальный горизонт возвратов/чарджбеков у площадки — назвать его может только владелец аккаунта.
3. **Политика при частичном возврате и `quantity > 1`.** Вернули треть суммы за три лицензии — отзываем одну (какую?), все три или ни одной? Это коммерческое правило. v1 фиксирует сумму в `refunds`, ставит `PARTIALLY_REFUNDED` и останавливается на ручном решении.
4. **Доступ в кабинет продавца** — нужен, чтобы прочитать payload вебхука «Продажа товара» (`/inside/notify_settings.asp?view=url`) и подтвердить/опровергнуть, шлёт ли площадка событие ВОЗВРАТА. Пока не прочитано, время обнаружения возврата определяется только поллингом.
5. **Одна реальная тестовая покупка до релиза** — единственный способ закрыть три недокументированных вопроса: (а) что площадка отвечает на несуществующий код; (б) регистрозависимы ли коды; (в) формат и часовой пояс `date_pay`. Без неё мы страхуемся default-веткой, но живёт неопределённость.
6. **Заведение секретов площадки через админку.** `digiseller.seller_id` и `digiseller.api_key` обязаны быть введены через `SettingsService.set()` — шифрование живёт только там. Записать их руками в SQL нельзя: расшифровка упадёт, `safeDecryptSecret` вернёт `null`, и health покажет `DECRYPT_FAILED`. До заполнения `redeem` отдаёт 503 и коды **не принимает** — принимать то, что нельзя проверить, значит копить обещания перед покупателями.
7. **Кредитуется ли возврат на баланс реселлера.** Если да — до этого нужен `ResellerTransaction.idempotencyKey @unique` и условный `UPDATE ... WHERE balance - :amt >= -credit_limit`: сейчас ни версии строки, ни ключа идемпотентности нет, и двойное начисление не ловится ничем. Канал Digiseller баланс не трогает, поэтому в v1 это вынесено за скобки.
8. **Мониторинг.** В проекте нет ни метрик, ни алертов, ни счётчика подряд идущих падений фоновых задач. `GET /billing/digiseller/health` даёт данные, но их надо кем-то опрашивать. Пока внешнего мониторинга нет, суточная недоступность площадки будет замечена по жалобам покупателей.

### Решения

#### 1. Когда обращаться к Digiseller — до записи в нашу БД или после? (В2 против В1/В3)

**Выбор.** Интейк-вперёд, но только после формат-гейта и лимитов: строка digiseller_orders (state=PENDING_VERIFY) создаётся ДО сети, проверка идёт вторым шагом и вне транзакции. При недоступности площадки — 202 и досчёт воркером.

**Почему.** Деньги уже у Digiseller в момент, когда покупатель получил код; наша задача — не потерять факт предъявления. Классический порядок при таймауте посреди проверки (запрос ушёл, ответ не вернулся) оставляет нас без строки и без возможности отличить это от «кода не существует». Durable-строка делает повторный ввод идемпотентным чтением. Возражение В3 (перебор засорит таблицу) снимается тем, что интейк стоит ПОСЛЕ формат-гейта, отрицательного кэша и лимитов, а REJECTED-строки чистятся job'ом через 7 суток.

**Отвергнуто.** Проверить у площадки, потом записать себе (В1, В3): при таймауте покупатель получает 502, у нас не остаётся ни строки, ни следа, восстановление только ручным разбором в поддержке.

#### 2. Ключ идемпотентности — unique_code (В1/В2) или inv (В3)?

**Выбор.** Оба, слоями: UNIQUE(unique_code) + новый UNIQUE(lower(unique_code)) + UNIQUE(inv_id), причём inv_id ОСТАЁТСЯ nullable. Коллизия по lower() уводит в карантин CODE_CASE_COLLISION, а не в отказ.

**Почему.** В3 прав в главном: регистрозависимость кодов не подтверждена, и без защиты 'abc'/'ABC' дают две строки и две лицензии. Но его рецепт (inv BigInt NOT NULL как первичный ключ идемпотентности) несовместим с интейком-вперёд: inv становится известен только ПОСЛЕ проверки. Индекс по lower() закрывает ровно ту же дыру, работая на этапе, где inv ещё нет, а UNIQUE(inv_id) остаётся вторым слоем и ловит два разных кода на один счёт. Карантин вместо отказа снимает единственный минус lower(): если коды всё же регистрозависимы, законный покупатель попадает в ручной разбор, а не слышит «неверный код».

**Отвергнуто.** Только unique_code (В1/В2 без индекса по lower) — дыра остаётся. inv NOT NULL как единственный ключ (В3) — ломает интейк-вперёд и не выражает состояние «код предъявлен, площадка ещё не ответила».

#### 3. Что писать в Order.amount — сумму площадки (В1/В2) или наш прайс (В3)?

**Выбор.** Order.amount/currency = снимок нашего прайса (plan.price × quantity). Payment.amount/currency = сумма и валюта площадки с маппингом WM→ISO. Неизвестный трёхбуквенный код валюты пишется в Payment как есть + аудит, выдачу не блокирует.

**Почему.** Разделение по назначению записей. Order — наш коммерческий документ, он обязан быть в одной когерентной валюте, иначе дашборд «продажи по продуктам за период» (индекс под него уже заведён) складывает USD с RUB. Payment — запись о платеже провайдера, именно там место сумме площадки, рядом с externalId=inv и rawPayload, по которым и делается сверка с выпиской. В3 прав, что словари валют у площадки противоречат друг другу в четырёх методах; В1/В2 правы, что сумму площадки терять нельзя. Оба требования выполняются одновременно.

**Отвергнуто.** Order.amount = сумма площадки (В1/В2): смешивает валюту ЗАЧИСЛЕНИЯ (документация прямо предупреждает — не способ платежа) с прайсом и ломает отчётность. Терять сумму площадки вовсе (буквальный В3): сверка с выпиской становится невозможной. Карантин при неизвестной валюте (В1): все WM-коды трёхсимвольные и влезают в VarChar(3) как есть — блокировать выдачу незачем.

#### 4. Гейт по расхождению суммы с ценой тарифа (В1: порог 0.5 → карантин)?

**Выбор.** Гейта нет. Расхождение фиксируется аудит-событием. Жёсткий гейт ставится не на сумму, а на количество: cnt_goods вне 1..20 → карантин.

**Почему.** В3 привёл убивающее возражение: площадка штатно поддерживает promo_code и bonus_code, поэтому оплата вдвое ниже прайса — нормальный сценарий, и порог 0.5 будет отправлять в карантин честные акционные покупки. При этом реальный риск «сломанный маппинг напечатает лишнее» гораздо лучше ловится потолком на cnt_goods: документация сама требует «обязательно проверяйте это значение», а что приходит для товара с фиксированной ценой (null, 0, 1) — не сказано.

**Отвергнуто.** Порог price_mismatch_min_ratio (В1) — ломается на промокодах, то есть наказывает покупателя за нашу же акцию. Не проверять ничего — ошибка разбора cnt_goods однажды напечатает тысячу лицензий.

#### 5. Заказ рождается сразу DELIVERED (В1) или PAID с условным переходом в DELIVERED (В2/В3)?

**Выбор.** PAID, затем условный updateMany WHERE status='PAID' → DELIVERED с проверкой count, в той же транзакции, что создаёт лицензии.

**Почему.** Стоит один UPDATE, а покупает единственную в БД связку между фактом создания лицензий и состоянием заказа. В1 прав, что на пути Digiseller промежуточного состояния физически нет, но его вывод («значит переход не нужен») теряет проверяемый инвариант, который понадобится ручной админской выдаче и реселлерскому каналу — а там ничто не связывает число лицензий с Order.quantity.

**Отвергнуто.** Сразу DELIVERED (В1): экономит одну строку кода и убирает контрольную точку, на которой ловится повторная выдача по уже обслуженному заказу.

#### 6. Как классифицировать неизвестный retval, если документация для unique-code перечисляет только retval=0?

**Выбор.** Неизвестный retval → RETRYABLE, после исчерпания попыток → FAILED_PERMANENT + алерт админу. Никогда REJECT автоматически. Default-ветка обязательна и покрыта тестом.

**Почему.** Асимметрия цены ошибки. Ложный REJECT = покупатель заплатил и услышал «неверный код»: необратимый репутационный ущерб и гарантированный чарджбек. Ложный RETRYABLE = одна строка в карантине и тикет. Коды «неверный код» (-2/1/2) документированы только у соседнего метода deliver и на unique-code не подтверждены — строить автоотказ на переносе таблицы между методами нельзя.

**Отвергнуто.** Перенести коды из deliver на unique-code как есть (В3 допускал 404 CODE_INVALID в default-ветке): первый же неизвестный ответ площадки отклонит валидную покупку.

#### 7. Один счётчик попыток или два?

**Выбор.** Два раздельных: дешёвый malformed_per_ip_per_10min для локально отвергнутых запросов (длина ≠ 16, charset) и дорогой redeem_per_user/ip/subnet_per_hour для тех, что идут в API. Плюс глобальный токен-бакет перед клиентом площадки.

**Почему.** Это лучшая идея В3, и она решает конфликт «защита против UX» без компромисса: опечатка честного покупателя почти всегда ловится формат-гейтом и не стоит ему ни одной единицы дорогого лимита, а перебор упирается в потолок обращений к третьей стороне. Реальный ущерб от перебора — не кража кода (при 16 символах и ~10^5 живых кодов 1% шанс набирается веками), а исчерпание нашего бюджета у DDoS-Guard, то есть остановка ЕДИНСТВЕННОГО канала продаж.

**Отвергнуто.** Единый счётчик (В1, В2): опечатка честного покупателя расходует тот же ресурс, что попытка перебора, и три опечатки подряд приближают 429 у невиновного.

#### 8. Поведение лимитов при недоступности Redis — единая политика или раздельная?

**Выбор.** Раздельная: пер-пользовательский и пер-IP счётчики fail-open с WARN, глобальный бакет обращений к площадке fail-closed → 503 PROVIDER_UNAVAILABLE.

**Почему.** Fail-open на пер-пользовательском — прямое следование уже принятому в проекте решению (payload.service.ts:483-492: «счётчик — инструмент наблюдения, а не рубеж безопасности, и терять из-за него доступ у всех нельзя»). Но fail-open на глобальном бакете означает, что перезапуск Redis снимает единственную преграду перед неограниченным потоком к площадке, а бан продавца у DDoS-Guard дороже, чем отказ в погашении на время деградации.

**Отвергнуто.** Единая политика (В1, В2 не различают): какую ни выбери, один из двух случаев получается неправильным.

#### 9. Что отвечать на «код не найден» и «код погашен другим»?

**Выбор.** Одинаково: 404 CODE_INVALID. 409 с номером заказа — только если код погасил сам запрашивающий. Повторная отправка формы тем же пользователем → 200 с теми же ключами.

**Почему.** Разные ответы — оракул существования: он превращает перебор из поиска валидного кода в поиск любого существующего и резко удешевляет разведку. Для честного покупателя разница невидима: он либо ошибся, либо это его собственный код, и второй случай обслуживается полноценно.

**Отвергнуто.** Раздельные честные коды ошибок ради UX (В1, В2): выигрыш в UX нулевой — покупатель всё равно не отличает, — а проигрыш в разведке заметный.

#### 10. Автоотзыв при invoice_state=35 («возврат начат, покупателем не завершён»)?

**Выбор.** Нет. 35 → state=REFUND_PENDING + уведомление админа, лицензия работает. Автоотзыв только на invoice_state=5 и unique_code_state.state=4.

**Почему.** 35 означает, что покупатель начал возврат и не довёл. Отзыв на этом этапе наказывает человека, который свою же заявку отменит, а обратной операции «разотозвать» в LicensesService нет — только ручная выдача новой лицензии. Различить два состояния можно только имея поле state, которое мы и так вводим.

**Отвергнуто.** Считать любой признак возврата поводом к немедленному отзыву (В1 явного разделения не делает): быстрее в реализации, генератор жалоб от платящих клиентов.

#### 11. Как выразить частичный возврат?

**Выбор.** Таблица refunds (сумма, валюта, источник, external_ref, @@unique([paymentId, externalRef])) вводится сразу; PARTIALLY_REFUNDED добавляется в оба enum'а. Но автоматический отзыв части лицензий в v1 НЕ делается — частичный возврат уходит в ручное решение админа.

**Почему.** Данные надо уметь выразить сегодня (таблицы пусты, миграция бесплатна, право orders.refund уже засеяно — значит ручной возврат заведомо существует), а вот правило «сколько лицензий отозвать при возврате трети суммы» — коммерческое, а не техническое. Алгоритм В1 (floor(returned/unit_price), сначала неактивированные) выглядит убедительно, но выбирает за владельца.

**Отвергнуто.** Отложить таблицу целиком (В2/В3): второй частичный возврат затрёт первый, вопрос «сколько мы вернули по этому заказу» останется без ответа. Реализовать алгоритм распределения сразу (В1): принимает за владельца решение, которое стоит денег.

#### 12. Нужна ли таблица событий под идемпотентность?

**Выбор.** Да, digiseller_events с @@unique([provider, external_id]) создаётся сразу; поллер пишет событие ТОЛЬКО на смену состояния, external_id = 'poll:{inv}:{invoice_state}'. Условные UPDATE при этом остаются.

**Почему.** Возражение В2 («payload вебхука не видели, ключ придётся выдумать») бьёт мимо: поля таблицы (provider, event_type, external_id, payload, received_at, processed_at) не зависят от формы payload'а, а ключ для поллера детерминирован и не выдуман. Условные UPDATE спасают состояние заказа, но не спасают от повторного письма и повторного движения по балансу реселлера; журнал даёт ещё и разбор «что именно площадка сказала и когда» — сегодня raw_payload перезаписывается и хранит только последний ответ.

**Отвергнуто.** Отложить до вебхука (В2): повторная обработка события возврата второй раз пройдёт весь путь, и следа для разбора не останется.

#### 13. Источник конфигурации: env или settings?

**Выбор.** Только settings. DIGISELLER_SELLER_ID/API_KEY/POLL_INTERVAL/TOKEN_CACHE_TTL удаляются из env.schema.ts. Три состояния разбираются явно: непустая строка → OK; '' → NOT_CONFIGURED, redeem отдаёт 503 и коды НЕ принимает, поллер не стартует; null → DECRYPT_FAILED, громкая ошибка и degraded health.

**Почему.** Проверено чтением settings.service.ts:94-101 и seed.ts:244-245: строка в БД существует (со значением ''), поэтому ветка process.env недостижима, и env-переменные Digiseller мертвы. Держать мёртвую переменную в схеме — гарантированный день отладки «почему ключ не подхватывается». Различать '' и null обязательно: safeDecryptSecret возвращает null при сбое расшифровки и только пишет в лог, то есть неудачная ротация ключа иначе тихо останавливает все продажи. Принимать коды в состоянии NOT_CONFIGURED значит копить обещания, которые нельзя выполнить.

**Отвергнуто.** Чинить get() правилом «пустая строка → падаем в env» (обсуждалось во всех трёх): правка общего механизма ради одного модуля, ломает легитимный случай «настройка намеренно очищена через админку» — очистка молча вернёт старое значение из окружения.

#### 14. Где кэшировать токен площадки и как не нарваться на retval -4?

**Выбор.** Redis, ключ digiseller:token, TTL = valid_thru − 300 с. Single-flight через SET digiseller:token:lock NX EX 15. timestamp из INCR digiseller:token:ts (счётчик засеян now()), не из Date.now(). Ретрай логина ВСЕГДА с новым timestamp и новой подписью.

**Почему.** Уникальность timestamp глобальна у продавца и общая для доменов .com и .ru (подтверждено эмпирически, retval -4). Память процесса означает N логинов на N реплик и стадо из параллельных apilogin в одну секунду — то есть массовые -4. INCR даёт монотонность между репликами и переживает рестарт. valid_thru — канонический источник срока; константа 6600 это догадка о нём, и если площадка сократит срок жизни токена, константа сломается молча.

**Отвергнуто.** Кэш в памяти процесса + константа 6600 (следует из env-переменной): множит логины на число реплик. Ретрай логина с тем же timestamp: гарантированный -4.

#### 15. Три источника периода поллинга — что побеждает?

**Выбор.** @Cron(EVERY_5_MINUTES) как фиксированный тик; настройка digiseller.poll_interval_sec определяет, какие строки СОЗРЕЛИ (last_polled_at старше интервала). DIGISELLER_POLL_INTERVAL удаляется.

**Почему.** @nestjs/schedule получает литерал на этапе декорирования, а SchedulerRegistry в проекте не используется ни разу. Перенос настройки из «как часто тикать» в «что считать созревшим» делает её действующей без нового механизма и без рестарта, и схлопывает три источника в один. Молчаливо неработающая настройка, видная админу, хуже её отсутствия.

**Отвергнуто.** SchedulerRegistry с перечиткой: новый механизм ради одного значения. Игнорировать настройку: тогда её надо удалить из сида, иначе она врёт.

#### 16. Как строить фоновые задачи — по образцу существующих процессоров?

**Выбор.** По образцу, но с двумя исправлениями: захват Redis-лока переносится ВНУТРЬ try, снятие — Lua compare-and-delete по случайному значению владельца. Заодно заводятся process.on('unhandledRejection'|'uncaughtException') в main.ts.

**Почему.** Проверено: в notification.processor.ts:39 строка захвата стоит вне try, поэтому отказ Redis (ioredis отклоняет промис после maxRetriesPerRequest:3) даёт unhandled rejection, а обработчиков уровня процесса в проекте нет ни одного. Безусловный del в finally означает, что батч, переживший TTL лока, снимает чужой лок и запускает второго исполнителя. Для поллера возвратов второй исполнитель — это второй отзыв и второе письмо.

**Отвергнуто.** Скопировать существующий паттерн один в один ради единообразия: тиражирует дефект туда, где цена выше — у уведомлений дубль это лишнее письмо, у возвратов это двойной отзыв.

#### 17. Основной канал доставки: ввод кода площадки или supplier-callback с нашим токеном (В3)?

**Выбор.** v1 — ввод 16-значного кода площадки. supplier-callback спроектирован как добавляемый поверх без переделки ядра, но выносится в раздел решений владельца.

**Почему.** Аргумент В3 технически сильнейший в задаче (перебор перестаёт стоить обращений к третьей стороне, опечатка ловится контрольным символом локально, inv и email приходят в момент продажи). Но канал меняет то, что видит покупатель на витрине, требует перенастройки товара в кабинете и заводит пароль на сервисе, чья утечка при последовательном inv означает чеканку лицензий. Это коммерческое решение, а не инженерное. Одновременно два основных канала в v1 — двойная поверхность на денежном пути.

**Отвергнуто.** Сделать supplier-callback основным сразу (В3): выбирает за владельца формат покупки. Отказаться от него навсегда (В1/В2 не рассматривают вовсе): теряется единственный способ радикально снять поверхность перебора.

#### 18. Отзывать лицензию при возврате автоматически или после подтверждения админом?

**Выбор.** Автоматически и немедленно (кроме invoice_state=35), актор SYSTEM, письмо по новому шаблону license.revoked. Право orders.refund гейтит только ручной возврат. Плюс реакция на РЕЦИДИВ: ≥2 возврата по одной почте → AntiFraudEvent HIGH, Device.isBlocked, запрет погашения.

**Почему.** Деньги уже ушли обратно; ручная очередь по выходным даёт двое суток бесплатного доступа. revoke уже умеет работать без актора и снимает currentDeviceId, отзыв доезжает до лаунчера за 300 с (launcher.service.ts:506). Но В3 прав в главном: скорость отзыва — не защита, payload к этому моменту скачан; настоящая защита это стоимость ПОВТОРА схемы, и устройство — единственный дефицитный для противника ресурс (Device.isBlocked с индексом по hwidHash в схеме уже есть).

**Отвергнуто.** Ручное подтверждение как единственный путь: превращает выходные в окно злоупотребления. Мягкая деградация «оставить до конца срока»: для Lifetime это «навсегда».

#### 19. Держать ли транзакцию Prisma открытой во время вызова Digiseller?

**Выбор.** Категорически нет. Инвариант модуля, записывается в CLAUDE.md модуля и покрывается исполняемым тестом (шпион на $transaction взводит флаг, транспорт падает при взведённом флаге).

**Почему.** Таймаут транзакции 10 с против 14-секундного таймаута площадки за DDoS-Guard, пул соединений конечен. Зависший Digiseller × десяток параллельных погашений выедает пул и роняет POST /launcher/check — то есть отказ платёжной площадки превращается в отказ сервиса для УЖЕ ЗАПЛАТИВШИХ пользователей. Это худший сценарий во всей задаче, и вся архитектура интейк→проверка→исполнение существует ради него.

**Отвергнуто.** Одна большая транзакция «проверил и выдал»: читается проще, связывает время жизни соединения к БД со временем ответа третьей стороны, по которому нет SLA.

#### 20. Может ли неавторизованный покупатель ввести код?

**Выбор.** Нет. Погашение только под JWT. buyerEmail остаётся справочным полем для поддержки и на совпадение с почтой аккаунта не проверяется (digiseller.require_email_match=false), но расхождение пишется аудит-событием.

**Почему.** Механизма отложенной привязки в схеме нет вовсе: buyerEmail лежит только на DigisellerOrder, у Order своего контакта нет, VerificationToken не имеет типа под «покупка ждёт аккаунта». Анонимный эндпоинт — площадка для перебора без субъекта для счётчика. Жёсткая же проверка почты ломает законные покупки (платят с другого адреса постоянно) и обходится сменой почты в кабинете, а при споре «код увели» поддержке нужна улика — аудит-запись её даёт, ничего не ломая на горячем пути.

**Отвергнуто.** Анонимный ввод с привязкой по email из ответа площадки: требует новой сущности токена привязки и открывает захват чужой покупки. Требовать совпадения email: поток обращений в поддержку при нулевой защите.

#### 21. Нормализация кода: приводить ли регистр?

**Выбор.** Нет. Только trim + удаление пробельных и zero-width символов. В API уходит ровно то, что ввёл покупатель. Защита от регистровой развилки — уникальный индекс по lower(unique_code), а не изменение значения.

**Почему.** registration-key.service.ts:328 делает toUpperCase() потому, что мы САМИ генерируем ключи из алфавита без строчных букв. Коды генерирует площадка, её алфавит нам неизвестен, и приведение регистра у регистрозависимого кода схлопнет два разных кода в один — то есть отказ в выдаче оплаченной покупки. Индекс по lower() даёт ту же защиту, ничего не искажая на пути к площадке.

**Отвергнуто.** toUpperCase() по образцу регистрационных ключей: риск склеить разные покупки. citext на колонку: меняет семантику сравнения необратимо и до подтверждения регистрозависимости преждевременен. Ничего не делать: единственный барьер против двойной выдачи остаётся дырявым.

#### 22. Домен площадки и failover.

**Выбор.** Основной — api.digiseller.com (умолчание DIGISELLER_API_BASE меняется с .ru). Резерв — oplata.info и ТОЛЬКО для семейства unique-code (check + deliver). Circuit breaker на хост в Redis.

**Почему.** Swagger объявляет host api.digiseller.com, вся действующая документация — тоже; oplata.info документирован именно как резервный адрес и именно для этих методов, и эмпирически отдаёт тот же конверт. api.digiseller.ru работает и делит backend с .com (общий счётчик timestamp), но нигде не документирован — сломается молча. Токен, полученный на одном хосте, валиден на другом, поэтому failover не требует перелогина.

**Отвергнуто.** Оставить .ru: недокументированное зеркало на единственном платёжном канале. Гонять через oplata.info всё подряд: для apilogin, purchase/info и seller-sells резерв не документирован — слепой failover даст загадочные 404.

#### 23. Чем ходить в API площадки?

**Выбор.** Свой DigisellerHttpClient внутри модуля за интерфейсом DigisellerApi (Nest-токен, в тестах подменяется FakeDigisellerApi). Голый fetch + AbortSignal.timeout, проверка Content-Type до парсинга, нормализация трёх схем ошибок, ретраи только для идемпотентных GET, одна релогин-попытка на 401, разбор 403 через token/perms, circuit breaker.

**Почему.** Готового клиента в проекте нет ни одного (ни axios, ни @nestjs/axios, ни undici). API за DDoS-Guard: при блоке вместо JSON приходит HTML, и слепой JSON.parse превращает деградацию площадки в 500 у покупателя. Коды ошибок непоследовательны между методами — эту специфику нельзя вынести в общий транспорт. 403 отличается от 401 принципиально: «нет права» не лечится ни временем, ни повтором, и цикл ретраев будет вечно жечь запросы.

**Отвергнуто.** Голый fetch по образцу discord.provider без обвязки: ни ретраев, ни разбора трёх схем, ни защиты от HTML. Общий клиент в common/: обобщать нечего, второго платёжного провайдера по ТЗ не будет. Тянуть axios: лишняя зависимость на денежном пути.

#### 24. Order.number — сиквенс или генерация в TypeScript?

**Выбор.** Сиквенс: в schema.prisma добавляется @default(dbgenerated("next_order_number()")), модуль колонку не передаёт.

**Почему.** Миграция catchup_audit_gaps:145-154 уже создала sequence, функцию и DB-default, но в схеме @default отсутствует, поэтому Prisma всегда шлёт колонку явно и дефолт мёртв (проверено). Дублирование формата в TypeScript даёт второй источник номеров и коллизии на orders_number_key — при том что уникальный индекс это единственная защита.

**Отвергнуто.** Генерировать номер в приложении: требует своего распределённого счётчика, чтобы реплики не выдали один номер дважды, то есть переизобретения сиквенса поверх Redis.

#### 25. Как узнавать, сообщили ли мы площадке о выдаче?

**Выбор.** Колонка deliverNotifiedAt + отдельный процессор, добирающий redeemedAt IS NOT NULL AND deliver_notified_at IS NULL. retval 0 и 4 — оба успех, retval 3 — наш баг порядка вызовов (ERROR в лог).

**Почему.** PUT deliver — единственный способ явно сообщить площадке о выдаче, и он участвует в разборе споров. Без персистентного флага обрыв между коммитом и вызовом теряет сигнал навсегда, а отличить по ответу «мы уже отоварили» от «код свежий» контракт не позволяет.

**Отвергнуто.** Fire-and-forget после коммита (следует из В1 без флага): теряется при любом падении процесса. Внутри транзакции: сетевой вызов под row-lock.

#### 26. Новые значения AntiFraudType или переиспользовать RATE_LIMIT_EXCEEDED?

**Выбор.** Новые: CODE_BRUTEFORCE и PAYMENT_REVERSAL (ALTER TYPE ... ADD VALUE). Сам код покупки в события и логи не пишется — только sha256.

**Почему.** Писать перебор кода в RATE_LIMIT_EXCEEDED значит смешать его с sessionKey-повторами и выдачами payload и сделать таблицу бесполезной ровно для того расследования, ради которого она заведена. Код покупки — предъявительский документ того же класса, что license.key, а доступ к логам всегда шире доступа к БД (та же логика зафиксирована в licenses.service.ts:313).

**Отвергнуто.** Переиспользовать RATE_LIMIT_EXCEEDED (В1): дешевле на одну миграцию, дороже на каждом разборе инцидента.

#### 27. Расширять ли LicensesService.revoke транзакцией?

**Выбор.** Да: revoke(licenseId, reason, actor?, tx?) — четвёртый необязательный параметр, симметрично уже существующему issue(params, tx?).

**Почему.** Проверено: revoke на licenses.service.ts:281-318 ходит через this.prisma. Без правки отзыв лицензии и смена статусов заказа/платежа при возврате неатомарны, и падение между ними даёт заказ REFUNDED с работающей лицензией, которое поллер не переоткроет — refunded_at уже проставлен.

**Отвергнуто.** Оставить как есть и звать revoke после коммита: создаёт ровно то невосстановимое состояние, ради предотвращения которого вся транзакционная граница и рисуется.

### Риски, названные автором

- Формат ответа площадки на НЕСУЩЕСТВУЮЩИЙ код не документирован: таблица retval у searchuniquecode содержит только «0 — запрос выполнен», а эмпирически воспроизводятся только ошибки токена (-3/-4 при HTTP 400). Смягчение: default-ветка «неизвестный retval → RETRYABLE, никогда REJECT», покрытая тестом. Побочный эффект смягчения: пока коды неизвестны, каждый ошибочно введённый код будет висеть в ретраях до FAILED_PERMANENT и порождать тикет. Закрывается одной реальной тестовой покупкой до релиза.
- Регистрозависимость кодов площадки не подтверждена. Новый UNIQUE(lower(unique_code)) закрывает риск двойной выдачи, но если коды всё же регистрозависимы, пара реальных кодов, различающихся только регистром, уедет в карантин CODE_CASE_COLLISION вместо выдачи. Вероятность крайне мала, последствие — одно обращение в поддержку против цены двойной выдачи.
- Алфавит 16-символьного кода неизвестен. Расчёт стойкости сделан при худшем правдоподобном допущении (только цифры, 10^16). Если у кодов есть структура (префикс, контрольная сумма, последовательная часть), эффективное пространство меньше на порядки. Проверить на выборке реальных кодов; при плохом результате менять не длину (мы ей не управляем), а глобальный бюджет и переходить на supplier-callback.
- Лимиты частоты у площадки не документированы нигде и не отдаются заголовками (проверено: ни X-RateLimit-*, ни Retry-After), при этом API за DDoS-Guard. global_upstream_per_minute=60 и poll_interval_sec=900 выбраны нами. Реальный порог, за которым начнётся challenge или блок, выяснится только под нагрузкой, и узнаем мы о нём по HTML вместо JSON в проде.
- Корзинные покупки: один inv может покрывать несколько товаров (в ответе есть cart_uid). UNIQUE(inv_id) схлопнет корзину из N позиций в один заказ, и второй код получит P2002 внутри транзакции. Обработка: коллизия по inv_id уводит в карантин INV_CONFLICT, а не выдаёт вторую лицензию. Требует подтверждения реальной корзинной покупкой; если подтвердится — ключ расширяется до (inv, id_goods).
- Возврат позже digiseller.refund_watch_days (90) не будет обнаружен вовсе, и лицензия останется работать при возвращённых деньгах. Осознанный размен на стоимость поллинга (purchase/info — один запрос на сделку). Требует согласования реального горизонта возвратов и чарджбеков у площадки.
- Формат и часовой пояс date_pay / date_check / date_delivery / date_refuted в unique-code и purchase/info не указаны в документации вообще, тогда как в статистике явно МСК. Смягчение: провайдерские даты живут только в providerPaidAt и rawPayload, весь автомат движется нашим now(), поэтому ошибка их разбора не может изменить денежный исход. Но окно поллинга по seller-sells/v2 строится в МСК, и ошибка на 3 часа там реальна.
- Payload вебхука «Продажа товара» публично недоступен, и уведомляет ли площадка о ВОЗВРАТЕ — не подтверждается ничем. Вся детекция возвратов держится на поллинге. Пока вебхук не прочитан в кабинете, время между возвратом и отзывом определяется только интервалом поллинга плюс TTL проверки лицензии (~15-20 минут) — и это окно неустранимо в принципе, потому что возврат инициируем не мы.
- Частичный возврат в v1 автоматически лицензии не отзывает: заказ переходит в PARTIALLY_REFUNDED и ждёт админа. Если частичные возвраты окажутся частыми, а админ не разбирает очередь, лицензии по частично возвращённым деньгам продолжат работать.
- Единственный платёжный канал: при недоступности Digiseller продажи останавливаются полностью (принятый заказчиком риск У-1). Интейк-вперёд смягчает — предъявленный код не теряется и досчитывается воркером, — но новых покупок в это время не будет, и обойти это нечем.
- Fail-open пер-пользовательских счётчиков при недоступности Redis оставляет окно, в котором перебор ограничен только глобальным бакетом. Принято сознательно по образцу payload.service.ts, но это именно окно, а не его отсутствие.
- Связка Order.quantity ↔ число выданных лицензий в БД по-прежнему не выражена: License.orderId — обычный nullable FK без уникальности. Условный переход PAID→DELIVERED закрывает путь Digiseller, но ручная админская выдача по уже DELIVERED-заказу создаст лишнюю лицензию, и обнаружится это только глазами.
- Баланс реселлера остаётся незащищённым: Reseller.balance без версии, у reseller_transactions нет ни одного уникального ключа, а licenseId/orderId — голые Uuid без FK и индексов. Канал Digiseller его не трогает, но любой сценарий «возврат средств реселлеру» через ResellerTxType.REFUND будет удваиваться при повторном прогоне поллера.
- NotificationService.enqueue никогда не бросает и зовётся после коммита: падение процесса между коммитом и постановкой в очередь теряет письмо безвозвратно, переоткрытия FAILED-уведомлений в проекте нет. Деньгами это не является (лицензия видна в кабинете и возвращается прямо в ответе на redeem), но обращение в поддержку породит.
- Устойчивая недоступность площадки наблюдаема только через GET /billing/digiseller/health, который надо кем-то опрашивать: метрик, алертов и счётчика подряд идущих падений в проекте нет и модуль их не создаёт.

### План проверки

- digiseller-mapper.spec.ts — табличный тест classify() без сети, семь конвертов: retval=0 успех; HTTP 400 {"retval":-4,"retdesc":"отсутствует или неверно задан параметр token"} → AUTH; HTTP 200 {"retval":-4,"desc":"Не уникальный timestamp!"} → RETRYABLE с пересчётом timestamp; HTTP 401 с пустым телом → AUTH; HTTP 401 с телом [] → AUTH; HTTP 200 + Content-Type text/html (челлендж DDoS-Guard) → RETRYABLE, парсер не бросает; HTTP 200 retval=99 без inv → RETRYABLE, НЕ REJECT.
- digiseller-mapper.spec.ts — normalizeCode: ведущие/хвостовые пробелы, внутренние пробелы, U+200B/U+FEFF удаляются; регистр НЕ меняется (assert на точное равенство исходной последовательности букв). mapCurrency: WMZ→USD, WMR→RUB, WME→EUR, WMU→UAH, WMX→BTC, WMT→WMT с mapped=false. resolveQuantity: 3→3; null/undefined/0/'abc'→1; 21→quarantine QUANTITY_OUT_OF_RANGE.
- digiseller-signature.spec.ts — по образцу test/signature.service.spec.ts зафиксировать эталонной парой вход/выход: sign = sha256(apiKey + timestamp) в hex, простая конкатенация без разделителя, без seller_id, порядок строго ключ→timestamp. Тест страхует от молчаливого изменения алгоритма при рефакторинге.
- digiseller-no-http-in-tx.spec.ts — ИСПОЛНЯЕМАЯ форма главного инварианта: шпион на PrismaService.$transaction взводит флаг на входе и снимает на выходе; FakeDigisellerApi бросает, если флаг взведён. Прогнать полный сценарий redeem, прогон возврата и прогон verify-процессора — все три обязаны пройти.
- digiseller-race.spec.ts (РЕАЛЬНЫЙ Postgres, не мок Prisma — вся защита это уникальный индекс и EvalPlanQual) — 20 итераций по 20 параллельных POST /billing/digiseller/redeem с одним кодом от разных пользователей через Promise.allSettled. В каждой итерации: ровно 1 строка orders, 1 payments, 1 digiseller_orders, ровно quantity licenses; ровно один ответ FULFILLED, остальные 409/404; ноль ответов HTTP 500; ни одной строки orders или payments без соответствующей digiseller_orders.
- digiseller-race.spec.ts — обход регистром: fake отображает 'abc…' и 'ABC…' на ОДИН inv. Последовательно и параллельно. Ожидание: одна лицензия, вторая попытка уходит в карантин CODE_CASE_COLLISION, а не создаёт вторую строку. Доказывает работу UNIQUE(lower(unique_code)).
- digiseller-redeem.spec.ts — повторная отправка формы тем же пользователем: два вызова подряд и два параллельно. Оба раза 200 с ОДНИМ И ТЕМ ЖЕ набором ключей лицензий, в БД одна лицензия. Ни при каких условиях второй вызов не отдаёт 409 тому же пользователю.
- digiseller-redeem.spec.ts — анти-оракул: несуществующий код и код, погашенный ДРУГИМ пользователем, дают побайтово одинаковый ответ 404 CODE_INVALID (сравнить тела и статусы). Свой погашенный код даёт 409 с номером заказа.
- digiseller-verify.spec.ts — таймаут посреди проверки: транспорт никогда не резолвится. Ответ покупателю приходит за бюджет AbortSignal.timeout, код 202, state=PENDING_VERIFY, verify_attempts=1, next_attempt_at в будущем, лицензии и заказа нет. Затем транспорт чинится, тик воркера — выдана ровно одна лицензия.
- digiseller-verify.spec.ts — ретрай никогда не выдаёт вторую лицензию: прогнать DigisellerVerifyProcessor.tick() пять раз подряд при успешном транспорте. Одна лицензия, один заказ, один платёж, redeemed_at не менялся после первого прохода.
- digiseller-verify.spec.ts — площадка недоступна всё окно ретраев (транспорт всегда 503): state=FAILED_PERMANENT, last_error заполнен, уведомление админу в очереди, redeemed_at ПО-ПРЕЖНЕМУ NULL — код не сожжён и переоткрывается через /quarantine/:id/resolve.
- digiseller-fulfillment.spec.ts — транзакционный откат: подменить licenses.issue так, чтобы бросал на второй лицензии при quantity=2. Ожидание: ни одного Order, Payment, License; digiseller_orders.state вернулся в PENDING_VERIFY и redeemed_at остался NULL; повторный redeem тем же кодом проходит успешно.
- digiseller-fulfillment.spec.ts — счастливый путь: ровно одна orders (status DELIVERED после условного перехода из PAID, source DIGISELLER, amount = plan.price × quantity в валюте тарифа, number вида ORD-2026-NNNNNN из сиквенса), ровно одна payments (CONFIRMED, external_id = String(inv), amount и currency площадки), ровно одна digiseller_orders (state FULFILLED, redeemedAt, redeemedByUserId, paymentId связан), ровно quantity licenses в PENDING с expiresAt=NULL и orderId созданного заказа.
- digiseller-deliver.spec.ts — обрыв между коммитом и PUT deliver: стаб отдаёт 500. Лицензия выдана, ответ 200, deliver_notified_at=NULL. Тик процессора дозвона → deliver_notified_at заполнен. Второй прогон (стаб отдаёт retval 4 «сообщение уже поступало») → повторной записи и повторного вызова нет. Отдельно retval 3 → deliver_notified_at не ставится, ERROR в лог, попытка повторяется.
- digiseller-poll.spec.ts — возврат после выдачи и идемпотентность: fake отдаёт invoice_state=5 по inv. Тик поллера дважды. После первого: license REVOKED с revokedReason и снятым currentDeviceId, order REFUNDED, payment REFUNDED, digiseller_orders.refunded_at, одна строка refunds, одна строка digiseller_events, одно уведомление license.revoked, одна запись audit_logs на лицензию. После второго: счётчики refunds, digiseller_events, notifications, audit_logs не изменились.
- digiseller-poll.spec.ts — незавершённый возврат: purchase/info отдаёт invoice_state=35. state=REFUND_PENDING, лицензия ОСТАЁТСЯ ACTIVE, уведомление админу отправлено, отзыва нет. Затем тот же inv приходит с invoice_state=5 — только теперь отзыв срабатывает, ровно один раз.
- digiseller-poll.spec.ts — рецидив: два разных inv с одним buyerEmail, оба возвращены. На втором: AntiFraudEvent(PAYMENT_REVERSAL, HIGH, actionTaken='blocked'), Device.isBlocked=true у устройства активации, последующее погашение с этой почты отвергается.
- digiseller-poll.spec.ts — формат дат исходящего запроса: собрать тело POST /api/seller-sells/v2 для окна poll_window_hours и утверждать, что date_start/date_finish отформатированы как 'yyyy-MM-dd HH:mm:ss' в UTC+3, а НЕ в UTC. Отдельный случай — окно, пересекающее полночь по МСК, и переход через полночь UTC.
- digiseller-quarantine.spec.ts — несмапленный товар: fake возвращает id_goods, которого нет ни в одном license_plans. Ожидание: 202, state=QUARANTINED, quarantineCode=PLAN_NOT_MAPPED, verified_at проставлен, rawPayload сохранён, redeemed_at и payment_id остаются NULL, orders/payments/licenses пусты. Затем админ проставляет digisellerProductId тарифу и вызывает /quarantine/:id/resolve → лицензия выдаётся, ровно одна; повторный resolve → 409.
- digiseller-quarantine.spec.ts — количество: cnt_goods=3 → три лицензии; cnt_goods=0/null/отсутствует/строка → одна; cnt_goods=100000 → карантин QUANTITY_OUT_OF_RANGE и ни одной лицензии. Отдельно: неизвестная валюта WMT → выдача ПРОХОДИТ, payment.currency='WMT', записано аудит-событие digiseller.currency_unmapped, ни одной строки с молча подставленным RUB.
- digiseller-limits.spec.ts — опечатка честного покупателя: три запроса подряд с кодом длиной 15, с символом вне charset и с 17 символами, затем верный код. Ожидание: 400 на первых трёх, 200 на четвёртом, НОЛЬ обращений к fake на первых трёх (assert на счётчик вызовов транспорта), дорогой счётчик не увеличился ни разу, дешёвый увеличился трижды.
- digiseller-limits.spec.ts — перебор: 200 запросов со случайными формально корректными кодами из одного аккаунта и IP. Ожидание: fake получил не более redeem_per_user_per_hour вызовов, дальше 429 с Retry-After, ровно ОДИН AntiFraudEvent(CODE_BRUTEFORCE) на пересечении мягкого порога (а не поток событий), в details нет самого кода — только sha256.
- digiseller-limits.spec.ts — честный покупатель во время шторма: параллельно с предыдущим сценарием валидный код с ДРУГОГО IP и аккаунта проходит и получает 200. Доказывает, что защита не превратилась в отказ обслуживания.
- digiseller-limits.spec.ts — отрицательный кэш: один и тот же несуществующий код десять раз. Ровно одно обращение к fake, девять ответов из кэша, дорогой счётчик увеличился один раз. Отдельно: сетевой сбой в кэш НЕ попадает (после починки транспорта тот же код проверяется заново).
- digiseller-limits.spec.ts — политика при отказе Redis: при недоступном Redis пер-пользовательский лимит fail-open (запрос проходит, в логе WARN), глобальный бакет fail-closed (503 PROVIDER_UNAVAILABLE). Оба случая в одном тесте, чтобы зафиксировать асимметрию.
- digiseller-token.spec.ts — стадо за токеном: 50 параллельных операций при пустом кэше. Транспорт видел РОВНО один POST /api/apilogin, остальные дождались токена из кэша, ни одного retval -4. Отдельно: два логина в одну секунду прислали РАЗНЫЕ timestamp (проверка INCR-счётчика).
- digiseller-token.spec.ts — протухший токен: транспорт отдаёт 401 на первый бизнес-вызов и успех на второй. apilogin вызван ровно один раз дополнительно, кэш инвалидирован и перезаписан, бизнес-вызов повторён ровно один раз, покупатель получил 200 без задержки на бэкофф. Повторный 401 после релогина → RETRYABLE, а не цикл. TTL кэша вычислен из valid_thru, а не из константы.
- digiseller-token.spec.ts — retval -4 на apilogin: клиент пересчитывает И timestamp, И подпись и повторяет ровно один раз; в двух запросах разные timestamp и разные sign. Отдельно 403 → однократный GET /api/token/perms, отсутствие view_invoice → состояние NOT_CONFIGURED и алерт, БЕЗ ретраев.
- digiseller-client.spec.ts — failover: транспорт отдаёт 500 на api.digiseller.com и успех на oplata.info. Вызов unique-code успешен, breaker пометил основной хост открытым, следующий вызов сразу ушёл на резерв, а apilogin/purchase/info/seller-sells на oplata.info НЕ уходили. Пять подряд провалов → breaker открыт, следующий redeem отвечает 503 без обращения к транспорту.
- digiseller-config.spec.ts — digiseller.api_key = '' в settings при заполненном DIGISELLER_API_KEY в окружении: POST redeem отдаёт 503 DIGISELLER_NOT_CONFIGURED и НЕ создаёт строку digiseller_orders, поллер не стартует, health показывает NOT_CONFIGURED. Тест фиксирует, что env действительно мёртв. Отдельно: значение в settings.value, записанное в обход set() → safeDecryptSecret вернул null → health показывает DECRYPT_FAILED (а не NOT_CONFIGURED) и в логе ERROR.
- digiseller-rbac.spec.ts — redeem без JWT → 401; GET /orders обычным пользователем возвращает только его заказы (resolveScope 'own'), админом — все; GET /payments без payments.read → 403; POST /orders/:id/refund без orders.refund → 403; GET /billing/digiseller/health без payments.read → 403; /health/ready НЕ деградирует при неработающей площадке.
- digiseller-e2e.spec.ts — сквозной путь до лаунчера (реальная БД, FakeDigisellerApi): redeem → лицензия PENDING с expiresAt=null → POST /launcher/license/check с подписью и HWID → licenses.activate отработал, status=ACTIVE, activatedAt проставлен, expiresAt посчитан от durationDays тарифа и от момента ПЕРВОЙ проверки, а не от оплаты; для durationDays=NULL expiresAt остался NULL; в hwid_history запись FIRST_BIND. Затем сымитировать возврат и повторить check → отказ, привязка снята.
- schema-invariants.spec.ts (SQL-утверждения после миграции) — CHECK не позволяет вставить payments с provider='DIGISELLER' и external_id IS NULL; INSERT в orders без явного number получает ORD-2026-NNNNNN из сиквенса (три подряд, без нарушений orders_number_key); FK digiseller_orders.redeemed_by_user_id → users существует с ON DELETE SET NULL и имеет индекс; уникальный индекс по lower(unique_code) существует; EXPLAIN запроса воркера использует частичный индекс (state, next_attempt_at) WHERE state='PENDING_VERIFY'.
- invariants.helper.ts — общий хелпер, вызываемый после КАЖДОГО сценария: нет ни одной строки payments с provider=DIGISELLER и external_id IS NULL; для каждой строки digiseller_orders со state=FULFILLED существует ровно один payment и ровно один order; число лицензий заказа равно order.quantity; нет ни одной orders со status=PAID старше минуты (то есть условный переход в DELIVERED всегда состоялся).

---

## Дефекты

Найдены четырьмя оппонентами по линзам: однократность выдачи, отказы
внешней зависимости, злоупотребления, соответствие контракту площадки.
Каждый со сценарием. **Реализация до их закрытия не начинается.**

| Тяжесть | Штук |
|---|---|
| критично | 16 |
| важно | 19 |
| мелочь | 4 |

### Д1. [КРИТИЧНО] [однократность] `inv` нигде не валидируется перед тем, как стать ключом идемпотентности, и `externalId = String(inv)` превращает отсутствующее поле в валидную строку. Оба слоя защиты по счёту либо молча выключаются, либо схлопывают ВСЕ будущие покупки в один конфликт.

**Сценарий.** Ответ `/api/purchases/unique-code/{code}` отдаёт номер счёта под другим именем поля, или строкой с пробелом, или не отдаёт вовсе (схема ответа именно этого метода в документации не раскрыта — это признано в самом проекте). Фаза C, шаг 1: `invId = undefined` → колонка nullable, пишется NULL. `UNIQUE(inv_id)` в Postgres допускает сколько угодно NULL — слой 4 «два разных кода на один счёт» выключен полностью и молча. Шаг 3: `externalId: String(inv)` даёт литерал `"undefined"`, и новый `CHECK (provider <> 'DIGISELLER' OR external_id IS NOT NULL)` его пропускает — строка непустая. Первый покупатель занимает `payments_provider_external_id_key = (DIGISELLER, 'undefined')` и получает лицензию. ВТОРОЙ и каждый следующий покупатель: шаг 3 → P2002 → `all-exceptions.filter.ts:151-159` отдаёт 409 ALREADY_EXISTS «Запись с такими данными уже существует», транзакция откатывается, строка возвращается в PENDING_VERIFY, воркер добивает лестницу 0,0,0,5,15,60 с и ставит FAILED_PERMANENT. Канал продаж умирает целиком после первой же покупки, диагностируется только чтением БД, и все деньги за это время получены.

**Правка.** Валидировать `inv` в `classify()`, а не в транзакции: вердикт OK выдаётся, только если номер счёта распарсился в целое > 0; иначе — не OK, а QUARANTINE (`INV_UNPARSEABLE`), 202 покупателю и тикет админу. Перед открытием транзакции — `assert typeof inv === 'bigint' && inv > 0n`. В миграцию добавить `CHECK (inv_id IS NULL OR inv_id > 0)` и `CHECK (provider <> 'DIGISELLER' OR external_id ~ '^[0-9]+$')` — второй CHECK и есть настоящая версия пункта 2 «Правок схемы»: нынешняя формулировка `IS NOT NULL` не защищает ни от чего, ровно как признано про NULL в самом проекте.

**Доказательство.** prisma/schema.prisma:1119 `invId BigInt? @unique` (nullable, multiple NULLs allowed); src/common/filters/all-exceptions.filter.ts:151-159 (P2002 → 409 ALREADY_EXISTS с generic-сообщением)

### Д2. [КРИТИЧНО] [однократность] Состояние `VERIFIED` — тупик: оно есть в enum и в WHERE шага 1, но ни один процессор и ни один индекс его не покрывают. Строка, дошедшая до VERIFIED и упавшая на исполнении, не добирается ничем.

**Сценарий.** Покупатель предъявляет код, фаза B проходит успешно, строка помечается VERIFIED. Фаза C падает по любой из штатных причин: 10-секундный таймаут транзакции под нагрузкой, исчерпание пула, дедлок, P2002 на `payments`. Транзакция откатывается — но откат возвращает строку в VERIFIED, а не в PENDING_VERIFY. Частичный индекс из пункта 10 правок схемы — `(state, next_attempt_at) WHERE state='PENDING_VERIFY'` — и предикат `digiseller-verify.processor` покрывают ТОЛЬКО PENDING_VERIFY. Строку не берёт никто. В очередь карантина она тоже не попадает: `GET /quarantine` — это `state='QUARANTINED'`. Покупатель получил 500, повторно шлёт код → P2002 → перечитывание строки → `state='VERIFIED'`, а это не FULFILLED (вернуть ключи) и не PENDING_VERIFY (202) — ветка не определена вовсе. Заплатил, не получил ничего, ни в одной админской очереди не виден.

**Правка.** Либо вообще не персистить VERIFIED (переход строго PENDING_VERIFY → FULFILLED, а результат проверки жив только в памяти запроса — тогда убрать значение из enum и из WHERE шага 1), либо расширить и предикат воркера, и частичный индекс до `state IN ('PENDING_VERIFY','VERIFIED')` и явно определить ветку повторного предъявления для VERIFIED как «перезапустить fulfill». Третьего не дано: держать состояние, которое умеет принимать строку и не умеет её отдавать, — это утечка денег по определению.

### Д3. [КРИТИЧНО] [однократность] `FAILED_PERMANENT` достижим обычным получасовым простоем площадки и не имеет ни одного пути назад. Лестница ретраев ограничена числом попыток (~6,5 минуты суммарно), а не календарным горизонтом.

**Сценарий.** Лестница 0,0,0,5,15,60,300 с — семь попыток, суммарно около 380 секунд. Digiseller недоступен 10 минут (проект сам закладывается на СУТОЧНУЮ недоступность в разделе владельца). Каждый код, предъявленный в это окно, исчерпывает попытки и уходит в FAILED_PERMANENT. Обратного хода нет: `/quarantine` показывает QUARANTINED, `/quarantine/:id/resolve` описан под «админ завёл тариф», индекс воркера — только PENDING_VERIFY. Покупатель шлёт код заново → P2002 → строка в FAILED_PERMANENT → по правилу анти-оракула безопасный ответ 404 CODE_INVALID, то есть заплатившему человеку навсегда говорят «неверный код». Усугубление: глобальный бакет объявлен fail-CLOSED при недоступности Redis, а circuit breaker рубит запросы на хосте — если эти локальные отказы инкрементят `verify_attempts`, строка сожжёт все семь попыток, ни разу не дойдя до площадки, при полностью живом Digiseller.

**Правка.** 1) Ограничивать ретраи календарём, а не счётчиком: держать строку в PENDING_VERIFY до 24-72 ч с потолком backoff 15 мин. 2) `verify_attempts` инкрементить ТОЛЬКО когда площадка реально ответила; отказ глобального бакета, breaker'а и `NOT_CONFIGURED` не должны стоить попытки — это отказ нашей стороны. 3) FAILED_PERMANENT включить в выдачу `GET /quarantine` и разрешить `resolve` возвращать строку в PENDING_VERIFY с `verifyAttempts=0` — иначе «алерт админу» из решения по неизвестному retval некому исполнить.

### Д4. [КРИТИЧНО] [однократность] Рецепт восстановления фазы A («P2002 — перечитываем строку») физически не работает для нового индекса по `lower(unique_code)`, а объявленный карантин `CODE_CASE_COLLISION` под этим же индексом невозможно записать.

**Сценарий.** Коды площадки оказываются регистрозависимыми (проект честно признаёт, что это не подтверждено). Покупатель B предъявляет код, отличающийся от кода покупателя A только регистром. INSERT падает на `digiseller_orders_unique_code_lower_key`. Дальше по описанию: «перечитываем строку и ветвимся по state» — но перечитывание идёт по `findUnique({ uniqueCode: code })`, а в таблице лежит ДРУГОЙ литерал. Возвращается null → разыменование null → 500, либо, если код зациклен на повторный INSERT, бесконечный цикл. Второе, более серьёзное: заявленная реакция «коллизия по lower() уводит в карантин CODE_CASE_COLLISION» нереализуема — карантинная запись про код B — это строка в `digiseller_orders` с `unique_code = B`, а именно её только что запретил уникальный индекс по lower(). То есть B платит, получает 500, и даже в ручной разбор не попадает: следа его обращения нет нигде, кроме лога. Ровно тот сценарий, ради которого индекс и вводился, им же и заблокирован.

**Правка.** Различать ограничения по `e.meta.target` (для expression-индекса Prisma отдаёт ИМЯ индекса, а не список полей — обе ветки писать явно, на строковое сравнение с `digiseller_orders_unique_code_lower_key`). При коллизии по lower(): перечитывать через `$queryRaw ... WHERE lower(unique_code) = lower($1)`, и карантинный тикет заводить НЕ строкой в `digiseller_orders`, а отдельной сущностью (или снять с индекса свойство UNIQUE, заменив его на неуникальный + явную проверку с блокировкой). Плюс исполняемый тест: два кода, различающиеся только регистром, дают 202 QUARANTINED и видимую в `/quarantine` запись — сейчас этот тест провалится.

### Д5. [КРИТИЧНО] [однократность] Нет ни карантинного кода, ни предварительной проверки для случая «товар площадки не сопоставлен ни с одним тарифом» — при том что `POST /quarantine/:id/resolve` описан буквально как «после того как админ завёл тариф». Заявленный сценарий недостижим.

**Сценарий.** Владелец выставляет новый товар на Digiseller (или меняет `id_goods` у существующего) раньше, чем заводит `LicensePlan` с соответствующим `digisellerProductId`. Покупатель платит, код проверяется OK. Фаза C открывает транзакцию, ищет тариф по `LicensePlan.digisellerProductId` — ничего (или Prisma вообще не даст сделать findUnique при `id_goods = null`), либо тариф найден, но принадлежит другому продукту → `licenses.issue` бросает `BadRequestException PLAN_MISMATCH` ИЗНУТРИ транзакции → откат всей фазы C, включая проставленный на шаге 1 `redeemedAt`. Покупателю 400 «Тариф не принадлежит указанному продукту». Строка уходит в ретраи и оттуда в FAILED_PERMANENT (дефект выше). Перечисленные карантинные коды — CODE_CASE_COLLISION, QUANTITY_OUT_OF_RANGE, INV_CONFLICT — этот случай не покрывают, поэтому строка никогда не окажется в очереди `/quarantine`, и админу нечего резолвить.

**Правка.** Разрешать тариф ДО открытия транзакции, сразу после `classify()`: `LicensePlan.findFirst({ where: { digisellerProductId } })`. Если `id_goods` отсутствует, тариф не найден или `isActive=false` — `state=QUARANTINED`, новый код `PRODUCT_UNMAPPED`, HTTP 202, тикет. Заодно проверить `plan.productId` до вызова issue, чтобы PLAN_MISMATCH в принципе не мог возникнуть внутри денежной транзакции. Отдельно: `issue()` выбирает `isActive` в select и НЕ использует его (licenses.service.ts:70-79) — на это поведение опираться нельзя, проверку активности тарифа делать у себя.

**Доказательство.** licenses.service.ts:70-79 (`select` тянет isActive, проверка только `plan.productId !== params.productId`, иначе BadRequest PLAN_MISMATCH); prisma/schema.prisma:800 `digisellerProductId Int? @unique` — единственная точка сопоставления

### Д6. [КРИТИЧНО] [внешний-отказ] FAILED_PERMANENT — терминальное состояние без выхода, и лестница ретраев доводит до него за ~6 минут недоступности площадки. Заплативший покупатель получает вечный отказ, из которого система не выходит без SQL.

**Сценарий.** Digiseller (или DDoS-Guard перед ним) отдаёт HTML/5xx 10 минут — рутинный сценарий, который сам проект называет неизбежным («реальный порог, за которым начнётся challenge или блок, выяснится только под нагрузкой, и узнаем мы о нём по HTML вместо JSON в проде»). Покупатель вводит код, фаза A создаёт строку PENDING_VERIFY, фаза B получает RETRYABLE. Заявленная лестница 0,0,0,5,15,60,300 с исчерпывается за 380 секунд → строка уходит в FAILED_PERMANENT. Покупатель вводит код повторно через час: INSERT ловит UNIQUE(unique_code), перечитывание строки даёт state=FAILED_PERMANENT, вперёд из него не ведёт ни один переход. Очередь карантина (GET /quarantine, POST /quarantine/:id/resolve) описана для QUARANTINED — FAILED_PERMANENT в неё не попадает. «Алерт админу» не существует: раздел владельца п.8 сам признаёт, что метрик, алертов и счётчика подряд идущих падений в проекте нет, а /health в /health/ready не включён и никем не опрашивается. Итог: деньги у площадки, лицензии нет, состояние обнаруживается только по жалобе и чинится только руками в БД. Ровно тот исход, ради предотвращения которого выбран интейк-вперёд («наша задача — не потерять факт предъявления»), — обещание живёт 6 минут.

**Правка.** 1) Сетевые/5xx/breaker-open вердикты вообще не должны вести к FAILED_PERMANENT — только документированный терминальный REJECT. Для RETRYABLE лестница должна упираться в потолок (например, каждые 15 мин) и жить сутками, а не 380 секунд: горизонт ретраев обязан покрывать реальную аварию площадки, а не её мигание. 2) FAILED_PERMANENT включить в ту же очередь, что и QUARANTINED, и сделать resolve = сброс verify_attempts + next_attempt_at=now(). 3) На GET /redeem/:code/status для своей строки в FAILED_PERMANENT отдавать самообслуживаемый «повторить» (тот же сброс next_attempt_at), иначе единственный путь — тикет.

**Доказательство.** Проект, раздел «Лимиты»: «Лестница задержек 0,0,0,5,15,60,300 с» (сумма 380 с). Решение о retval: «после исчерпания попыток → FAILED_PERMANENT + алерт админу». Раздел владельца п.8: «В проекте нет ни метрик, ни алертов, ни счётчика подряд идущих падений фоновых задач». Эндпоинты: resolve гейтит только очередь карантина.

### Д7. [КРИТИЧНО] [внешний-отказ] У фазы C нет ни счётчика попыток, ни продвижения next_attempt_at. Детерминированно падающее исполнение даёт бесконечный горячий цикл с сетевым вызовом к площадке каждые 15 секунд — то есть сам модуль устраивает себе бан у DDoS-Guard, которого боится.

**Сценарий.** Строка проходит верификацию (verdict OK — значит verify_attempts НЕ увеличивается: по тексту «Не-OK → verify_attempts+1 и экспоненциальный next_attempt_at»), после чего транзакция фазы C падает. Причины реальны и перечислены самим проектом: (а) P2002 по UNIQUE(inv_id) на корзинной покупке; (б) licenses.issue бросает BadRequest PLAN_MISMATCH, когда digiseller_product_id не сопоставлен нашему тарифу — это ровно тот случай, ради которого заведён resolve «после того как админ завёл тариф»; (в) currency площадки длиннее 3 символов при currency VarChar(3); (г) провал assert count===1 на PAID→DELIVERED. Транзакция откатывается ЦЕЛИКОМ, включая любую попытку записать state=QUARANTINED внутри неё. next_attempt_at остался в прошлом (выставлен на интейке = now()), verify_attempts не тронут. digiseller-verify.processor (@Interval(15_000)) забирает строку на каждом тике, каждый раз делая живой GET /api/purchases/unique-code/{code}: 240 запросов в час на одну застрявшую строку, бесконечно, с того же аккаунта продавца, расходуя global_upstream_per_minute=60 — тот самый бакет, который защищает живых покупателей. Через сутки-двое такой строки бакет исчерпан фоном, и новые покупатели получают 503 PROVIDER_UNAVAILABLE.

**Правка.** Завести отдельные fulfill_attempts + next_attempt_at, продвигаемые в ОТДЕЛЬНОЙ транзакции после отката (компенсирующая запись, а не внутри аборченной транзакции). Любой отказ исполнения обязан двигать next_attempt_at, иначе процессор молотит. Ошибки, которые не лечатся временем (PLAN_MISMATCH, P2002 по inv_id), переводить в QUARANTINED сразу и отдельным UPDATE, а «товар площадки не сопоставлен тарифу» проверять ДО открытия транзакции и до похода в API — сейчас у него нет даже кода карантина, хотя resolve описан именно под него.

**Доказательство.** Проект: «Не-OK → строка остаётся PENDING_VERIFY с verify_attempts+1 и экспоненциальным next_attempt_at» — счётчика/бэкоффа для отказов ИСПОЛНЕНИЯ не заведено ни одного. licenses.service.ts:57-100 — issue бросает BadRequestException PLAN_MISMATCH при несовпадении плана. schema.prisma:1085 — Payment.currency VarChar(3). Фаза C заявлена как «ровно одна транзакция», карантинные коды INV_CONFLICT/QUANTITY_OUT_OF_RANGE пишутся в ту же строку.

### Д8. [КРИТИЧНО] [внешний-отказ] Карантин CODE_CASE_COLLISION физически невозможно записать: строку блокирует ровно тот индекс, который вызвал коллизию. Покупатель получает номер тикета, за которым нет ни одной записи в БД.

**Сценарий.** В БД есть строка с кодом 'abc123...'. Законный покупатель вводит 'ABC123...'. INSERT в digiseller_orders падает на новом UNIQUE(lower(unique_code)). По тексту «P2002 — не ошибка: перечитываем строку и ветвимся по state» — но перечитывание идёт по unique_code, а строки с 'ABC123...' не существует и создать её нельзя: индекс по lower() отвергнет любую попытку записать state=QUARANTINED, quarantineCode=CODE_CASE_COLLISION. Значит RedeemResult {state:'QUARANTINED', ticket} возвращает идентификатор, которому не соответствует ни одна строка; GET /quarantine перечисляет строки digiseller_orders и этот случай не покажет никогда; поддержка по тикету не найдёт ничего. Деньги у площадки, факт предъявления кода не сохранён нигде — то есть достигнут ровно тот исход, против которого выбран интейк-вперёд, и достигнут он в сценарии, который проект объявил «мягкой посадкой» вместо отказа.

**Правка.** Ловить P2002 по ИМЕНИ констрейнта и разводить два случая. Для коллизии по lower() запись обязана лечь туда, куда индекс не дотягивается: отдельная таблица (digiseller_code_collisions: sha256(code), claimed_by_user_id, conflicting_order_id, created_at) либо строка в digiseller_events с external_id='case_collision:{sha256}'. Её id и возвращать как ticket, её же включить в очередь /quarantine — иначе весь пункт 2 «ровно-однократности» существует только на бумаге.

**Доказательство.** Проект, «Ровно-однократность», п.2: «Коллизия по нему не отказ, а карантин CODE_CASE_COLLISION: если коды окажутся регистрозависимыми, законный покупатель попадёт в ручной разбор». Правки схемы п.5: CREATE UNIQUE INDEX digiseller_orders_unique_code_lower_key. Сигнатура: { state: 'QUARANTINED'; ticket: string; reason: QuarantineCode }.

### Д9. [КРИТИЧНО] [внешний-отказ] UNIQUE(unique_code) при интейке-вперёд превращает первое предъявление кода в вечный эксклюзивный захват. Любой посторонний, набравший чужой код, навсегда лишает заплатившего покупателя возможности его погасить.

**Сценарий.** Пользователь A вводит код, который ему не принадлежит (перебор, код с чужого экрана, опечатка, попавшая в чужой код, или собственный код, введённый не с того аккаунта). Фаза A создаёт строку PENDING_VERIFY, claimed_by_user_id=A — ДО всякой проверки, кому код принадлежит. Строка застревает не в терминальном REJECTED, а в PENDING_VERIFY / FAILED_PERMANENT / QUARANTINED (см. Д1, Д2). Приходит настоящий покупатель B: INSERT ловит UNIQUE(unique_code), перечитанная строка принадлежит A, и по анти-оракульному правилу B получает 404 CODE_INVALID — «код не существует» и «код погашен другим» отвечают одинаково. Джоб чистит только REJECTED-строки через 7 суток, остальных состояний не касается. Операции «освободить захват» / «переназначить claimed_by» в модуле нет: resolve описан для QUARANTINED и делает не это. B заплатил, слышит «неверный код», у поддержки нет ни одного рычага, кроме UPDATE в проде. Отдельно: самый дешёвый способ устроить это массово — перебор в момент, когда площадка лежит: попытки не отвергаются, зато каждая оставляет захват.

**Правка.** Разделить два инварианта, которые сейчас несёт один индекс: «одна лицензия на код» и «код может предъявить только один человек». Уникальным по коду должно быть ПОГАШЕНИЕ (redeemedAt IS NOT NULL — частичный уникальный индекс), а интейк-строка — ключом (lower(unique_code), claimed_by_user_id), либо непогашенный захват должен протухать по TTL (например, 30 минут без успешной верификации) и уступать место следующему заявителю. Плюс административный эндпоинт «освободить захват» рядом с resolve.

**Доказательство.** Проект, фаза A: «INSERT digiseller_orders (state=PENDING_VERIFY, claimed_by_user_id, next_attempt_at=now())» до сети. Анти-оракул: «код не существует» и «код погашен ДРУГИМ» отвечают одинаково — 404 CODE_INVALID». Решение об интейке: «REJECTED-строки чистятся job'ом через 7 суток» — только REJECTED. schema.prisma: DigisellerOrder.uniqueCode String @unique.

### Д10. [КРИТИЧНО] [внешний-отказ] Реакция на возврат непереигрываема: бухгалтерия «событие только на смену состояния» продвигается отдельно от самой реакции, и один перезапуск процесса между ними навсегда прячет возврат.

**Сценарий.** Поллер видит invoice_state=5 по сделке. Пишет digiseller_events с external_id='poll:{inv}:5' и/или проставляет DigisellerOrder.invoiceState=5, после чего процесс умирает (деплой, OOM, рестарт пода) до транзакции реакции. Следующий тик: состояние не «сменилось» — сохранённый invoiceState уже 5, а вставка события падает на @@unique([provider, external_id]) — значит реакция не породится больше никогда. refunded_at остаётся NULL, Payment CONFIRMED, Order DELIVERED, лицензия ACTIVE. Деньги покупателю площадка вернула, продукт работает бессрочно, а /health рапортует свежее «время последнего успешного поллинга», потому что тик отработал. Обнаружения нет вообще: строка по-прежнему подходит под предикат наблюдения, но каждый проход по ней теперь no-op. Дренажа событий с processed_at IS NULL в проекте не описано, поля processed_at/process_error заведены и не используются ни одним потребителем.

**Правка.** Либо запись события и реакция идут одной транзакцией (тогда P2002 по событию = «уже отработано» и это корректно), либо реакция управляется дренажом digiseller_events WHERE processed_at IS NULL с отдельным воркером и счётчиком попыток. Категорически нельзя продвигать invoiceState/дедуп-ключ раньше, чем закоммичена реакция: сейчас дедуп защищает от повтора ценой потери единственного экземпляра.

**Доказательство.** Проект, правки схемы п.6: «поллер пишет событие только на СМЕНУ состояния, external_id = 'poll:{inv}:{invoice_state}'», таблица содержит processed_at и process_error. Раздел «Возвраты»: «Реакция, одна транзакция, вся на условных UPDATE» — про совместность записи события с этой транзакцией не сказано ничего, механизма повторной обработки необработанных событий нет. п.12: DigisellerOrder.invoiceState Int?.

### Д11. [КРИТИЧНО] [злоупотребление] Санкция «Device.isBlocked = true для устройства активации» не является баном машины и не удорожает повтор схемы «купил → скачал payload → вернул деньги» вообще ни на сколько.

**Сценарий.** Противник покупает лицензию, активирует на машине M, скачивает payload, инициирует возврат на площадке. Поллер отзывает лицензию и ставит isBlocked=true у Device(license#1, hwidHash(M)). Противник покупает второй раз (новая почта на Digiseller, новый OAuth-аккаунт), гасит код, запускает лаунчер на ТОЙ ЖЕ машине M. Создаётся НОВАЯ строка Device с тем же hwid_hash и isBlocked=false — потому что уникальность девайса составная (license_id, hwid_hash), а проверка блокировки читает только license.currentDevice. Цикл повторяется бесконечно, hwid спуфить не требуется.

**Правка.** Проверять блокировку по hwid_hash глобально (индекс по hwidHash уже есть) и обязательно в ветке ПЕРВОЙ привязки, а не только при сверке: `count(devices where hwid_hash = ? and is_blocked) > 0 → DEVICE_BLOCKED`. Либо завести отдельную таблицу blocked_hwids (hwid_hash unique, reason, created_at) и спрашивать её на bindOrVerify до создания Device. Без этого рецидивную реакцию из раздела «Возвраты» надо описывать честно: она не действует.

**Доказательство.** C:/Users/user/work/kwork/license-platform/apps/api/src/modules/hwid/hwid.service.ts:129-135 — ветка первой привязки ищет `tx.device.findUnique({ where: { licenseId_hwidHash: { licenseId, hwidHash } } })` и переиспользует/создаёт строку, НЕ смотря на isBlocked вообще; hwid.service.ts:187 — `if (license.currentDevice?.isBlocked)` стоит только в ветке сверки, то есть блокировка действует ровно на одну пару (лицензия, устройство). schema.prisma:891-921 — Device привязан к license_id, глобального признака «эта машина забанена» в модели нет. Проект при этом утверждает: «устройство — единственный дефицитный для противника ресурс».

### Д12. [КРИТИЧНО] [злоупотребление] Лимиты считают ПРЕДЪЯВЛЕНИЯ кода, а стоимость измеряется в ОБРАЩЕНИЯХ к площадке: по собственной default-ветке «неизвестный retval → RETRYABLE» одно предъявление мусорного кода стоит до 7 запросов наверх (лестница 0,0,0,5,15,60,300). Дорогой лимит 10/час/пользователь на деле разрешает ~70 обращений в час, и глобальный fail-closed бакет 60/мин выносится очередью ретраев, а не самими запросами.

**Сценарий.** Противник заводит 15-20 аккаунтов через Discord OAuth (они создаются сразу ACTIVE, без подтверждения почты), с нескольких /24 льёт по 10 корректных по формату мусорных кодов в час на аккаунт. Каждый попадает в digiseller_orders как PENDING_VERIFY, и дальше уже НАШ digiseller-verify.processor (@Interval(15s), ограничения размера батча в проекте не описано) молотит эту очередь ×7. Результат: (а) global_upstream_per_minute исчерпан постоянно, честный покупатель получает 503 PROVIDER_UNAVAILABLE — то есть отказ продаж, ради предотвращения которого бакет и сделан fail-closed; (б) поллер возвратов и deliver-процессор ходят через тот же бакет и голодают, окно необнаруженного возврата растёт с 5 минут до часов; (в) отказ бакета неотличим от отказа площадки, поэтому verify_attempts честного покупателя, чей код пришёл в момент затора, инкрементится на НАШЕМ отказе и его законная покупка доезжает до FAILED_PERMANENT.

**Правка.** Резервировать бюджет ретраев в момент интейка (списывать с дорогого счётчика не 1, а max_attempts), ограничить число одновременных PENDING_VERIFY на пользователя (2-3), выделить поллеру и deliver-процессору отдельную квоту бакета, недоступную горячему пути, ограничить батч verify-процессора, и обязательно НЕ инкрементить verify_attempts, когда отказал наш собственный бакет или сработал circuit breaker — иначе локальная перегрузка списывает попытки заплатившего.

**Доказательство.** Раздел «Лимиты»: счётчики инкрементятся на входе redeem, ретраи воркера не учитываются нигде. Раздел «Фаза B»: не-OK → verify_attempts+1 и экспоненциальный next_attempt_at; раздел рисков сам признаёт, что несуществующий код будет висеть в ретраях до FAILED_PERMANENT. C:/Users/user/work/kwork/license-platform/apps/api/src/modules/auth/oauth/oauth.service.ts:251 — регистрация через OAuth ставит `status: UserStatus.ACTIVE` сразу, то есть аккаунт стоит один HTTP-запрос.

### Д13. [КРИТИЧНО] [злоупотребление] Один экономический возврат порождает две строки в refunds (POLL и MANUAL) без дедупликации между источниками, а правило рецидива «≥2 возврата по одному buyerEmail или пользователю» не имеет ни определённой базы подсчёта, ни временного окна. Честный покупатель, которому вернули деньги один раз, помечается рецидивистом.

**Сценарий.** Покупатель просит возврат, админ проводит его вручную через POST /orders/:id/refund → RefundsService.manualRefund(orderId, ...) пишет refunds(source=MANUAL, external_ref=<ручной>) и меняет Order/Payment. Через 5 минут поллер видит invoice_state=5 по тому же inv. Условный UPDATE refunded_at спасает только если ручной путь проставил digiseller_orders.refunded_at — но manualRefund по сигнатуре работает от orderId и в описании реакции строку digiseller_orders не трогает. Уникальность @@unique([paymentId, externalRef]) не срабатывает: external_ref у поллера другой ('poll:{inv}:5'). Итог: вторая строка refunds, второе письмо license.revoked, второе AntiFraudEvent(PAYMENT_REVERSAL) → срабатывает рецидив → Device.isBlocked и запрет погашения по почте невиновному. Зеркально: два законных возврата за два года по одной почте дают тот же вечный бан, потому что окна у правила нет.

**Правка.** Дедуплицировать по деньгам, а не по источнику: ключ идемпотентности возврата = (payment_id, provider_invoice_state) либо принудительный external_ref='manual:{orderId}:{amount}' с общей проверкой «уже есть возврат по этому payment на эту сумму». manualRefund обязан проставлять digiseller_orders.refunded_at тем же условным UPDATE, что и поллер. Рецидив считать по РАЗЛИЧНЫМ inv/оплатам, а не по строкам refunds, и обязательно в скользящем окне (90-180 дней), с ручной отменой отметки.

**Доказательство.** Раздел «Возвраты»: реакция поллера и manualRefund описаны как два независимых пути, общий ключ дедупликации — только (paymentId, externalRef), и он по построению различается. Сигнатуры: `applyProviderRefund({ digisellerOrderId, ... source })` против `manualRefund(orderId, dto, actor)` — вторая не получает digisellerOrderId вовсе. Инварианта sum(refunds.amount) <= payment.amount в правках схемы (пункт 7) нет, ResellerTransaction без уникального ключа (schema.prisma:1003-1025) — тот же двойной прогон будет удваивать баланс, если канал когда-нибудь свяжут с реселлером.

### Д14. [КРИТИЧНО] [контракт] timestamp для apilogin подменён монотонным счётчиком INCR, тогда как площадка требует ТЕКУЩЕЕ время; уникальность — не единственное условие

**Сценарий.** Счётчик засевается один раз значением now() и растёт на 1 за логин. Токен живёт 120 минут (valid_thru, документировано), значит логинов ~12/сутки. Через месяц работы отправляемый timestamp отстаёт от реального времени примерно на 2,6 млн секунд. Как только площадка начнёт (или уже) проверять свежесть timestamp — а документация описывает его именно как время запроса — apilogin вернёт ошибку, токен не обновится, и разом останавливаются ВСЕ три канала: погашение кодов, PUT deliver и поллинг возвратов. Единственный платёжный канал (У-1) встаёт целиком, а причина будет выглядеть как «внезапно перестал подходить API-ключ». Второй сценарий: Redis потерял ключ (eviction/flush без persistence) — INCR по отсутствующему ключу вернёт 1, и timestamp=1 либо не пройдёт проверку свежести, либо упрётся в -4 навсегда, потому что множество использованных timestamp у продавца площадка помнит бессрочно.

**Правка.** Оставить Date.now()/1000 как базу и брать монотонность поверх неё, а не вместо: ts = max(floor(now()/1000), lastUsed+1), где lastUsed хранится в Redis и обновляется атомарно (Lua: local n=redis.call('GET',k); local v=math.max(tonumber(ARGV[1]), (tonumber(n) or 0)+1); redis.call('SET',k,v); return v). Тогда уникальность между репликами сохраняется, а значение никогда не уезжает в прошлое. Явно обработать отсутствие ключа как «засеять now()», а не как «начать с 1».

**Доказательство.** api_general.asp, параметры apilogin: «timestamp — время запроса», «sign=SHA256(API ключ + timestamp)», п.2 подписи прямо назван «timestamp (текущее время)». retval -4 «не выполнено условие уникальности timestamp» — это отдельная проверка, а не определение семантики поля. Проект: «timestamp из INCR digiseller:token:ts (счётчик засеян now()), не из Date.now()».

### Д15. [КРИТИЧНО] [контракт] unique_code_state.state = 4 трактуется как возврат денег; на площадке это «товар доставлен, но доставка ОПРОВЕРГНУТА покупателем» — спор, а не движение денег

**Сценарий.** Покупатель оплатил, погасил код, получил лицензию. Наш PUT .../deliver переводит сделку ровно в state=2 — «доставка не подтверждена и не опровергнута», то есть в то самое состояние, из которого покупателю доступна кнопка «товар не получен». Он жмёт её по ошибке (или чтобы поторопить поддержку) → state=4. Поллер в течение 5 минут: пишет строку в refunds на полную сумму, ставит Payment=REFUNDED и Order=REFUNDED, отзывает лицензию (licenses.service.ts:281-318 обнуляет currentDeviceId), шлёт письмо license.revoked. Денег никто не возвращал: заплативший клиент теряет доступ примерно через 300 с (launcher.service.ts:506), бухгалтерия получает фантомный возврат, а обратной операции нет — LicensesService не умеет «разотозвать», в замысле это признано прямо. При втором таком опровержении по той же почте срабатывает рецидив: Device.isBlocked=true и запрет погашения. Ровно тот же аргумент, которым в замысле обосновали отказ от автоотзыва на invoice_state=35, здесь не применён.

**Правка.** Убрать state=4 из триггеров возврата. Единственный денежный триггер — content.invoice_state=5. state=4 (и заполненный date_refuted) заводить как отдельное состояние DISPUTED/REFUTED: уведомление админа + AntiFraudEvent, лицензия продолжает работать. Отзыв — только после того, как purchase/info по тому же inv покажет invoice_state=5. state=3 (доставка подтверждена) стоит снимать с наблюдения раньше остальных.

**Доказательство.** api_general.asp, unique_code_state\state: «1 - уникальный код не проверен; 2 - товар доставлен, доставка не подтверждена и не опровергнута; 3 - товар доставлен, доставка подтверждена; 4 - товар доставлен, но опровергнут; 5 - уникальный код проверен, товар не доставлен». Факт возврата денег выражается отдельным полем — content.invoice_state=5 в /api/purchase/info. Проект: «invoice_state = 5 ИЛИ unique_code_state.state = 4 → refunded_at ... строка в refunds → Payment REFUNDED → Order REFUNDED → licenses.revoke».

### Д16. [КРИТИЧНО] [контракт] Заявленный анти-оракул не выполняется: правило «неизвестный retval → RETRYABLE, никогда REJECT» делает ответы на несуществующий и на чужой погашенный код РАЗНЫМИ

**Сценарий.** Атакующий шлёт код правильного формата, которого не существует. Фаза A создаёт строку, фаза B получает нераспознанный ответ → RETRYABLE → покупателю 202 PENDING_VERIFY. Тот же атакующий шлёт код, который существует и уже погашен другим пользователем: P2002 на UNIQUE(unique_code) в фазе A, перечитывание строки, state=FULFILLED с чужим redeemedByUserId → мгновенный 404 CODE_INVALID без единого обращения к площадке. Итог: 202 = кода не существует, быстрый 404 = код существует и продан. Это и есть оракул существования, ради устранения которого принималось решение, — и различие видно не по таймингу, а прямо по HTTP-коду и телу ответа. Дополнительно 404 приходит за единицы миллисекунд (только БД), а 202 — после сетевого раунда к площадке.

**Правка.** Сделать неопределённость симметричной: пока вердикт по коду не терминален, отвечать заявителю ровно тем же конвертом, что и на чужой погашенный код (404 CODE_INVALID), а досчёт воркером и последующую выдачу отдавать только через GET .../:code/status, доступный заявителю. Либо наоборот — отвечать 202 и на чужой погашенный код, с переходом в 404 по истечении того же лестничного таймаута. Тест на анти-оракул должен сравнивать пару ответов (несуществующий код, чужой погашенный код) на равенство статуса, тела и порядка задержки.

**Доказательство.** Проект, решение об анти-оракуле: «‘код не существует’ и ‘код погашен ДРУГИМ’ отвечают одинаково — 404 CODE_INVALID». Проект, решение о классификации: «Неизвестный retval → RETRYABLE ... Никогда REJECT автоматически», плюс признание «формат ответа площадки на НЕСУЩЕСТВУЮЩИЙ код не документирован». Документация api_general.asp для searchuniquecode действительно перечисляет только «0 - запрос выполнен».

### Д17. [ВАЖНО] [однократность] Ручной возврат не гасит наблюдение поллера, поэтому один реальный возврат обрабатывается дважды и по правилу рецидива банит добросовестного покупателя.

**Сценарий.** Админ делает `POST /orders/:id/refund` → `manualRefund(orderId, dto, actor)`. Сигнатура не принимает `digisellerOrderId`, и нигде не сказано, что метод трогает `digiseller_orders.refunded_at`. Курсор поллера — `redeemed_at IS NOT NULL AND refunded_at IS NULL` — строку из наблюдения не снимает. Через 5 минут поллер видит `invoice_state=5` и запускает `applyProviderRefund`: условный UPDATE `refunded_at` → count=1 (поле всё ещё NULL, защита не сработала) → вторая строка в `refunds` (уникальность `[paymentId, externalRef]` не спасает: externalRef у ручного и у `poll:{inv}:5` разные) → `Payment REFUNDED WHERE status='CONFIRMED'` count=0, молча → `Order` count=0, молча → а вот `licenses.revoke(id, reason, undefined, tx)` условия по статусу НЕ имеет вовсе и отзывает повторно, затирая исходный `revokedAt` → второе письмо `license.revoked` тому же человеку → второй `AntiFraudEvent(PAYMENT_REVERSAL)`. Правило рецидива «≥2 возврата по одному buyerEmail» срабатывает на ОДНОМ возврате: `Device.isBlocked = true`, погашение по этой почте запрещено. Легитимный клиент с одним возвратом получает блокировку устройства.

**Правка.** `manualRefund` обязан в той же транзакции ставить `digisellerOrder.refundedAt` и `state='REFUNDED'` (иначе она вообще не участвует в защитном контуре). `revoke` привести к эталону проекта — `updateMany({ where: { id, status: { not: 'REVOKED' } } })`, `count===0` → тихий no-op без письма и без анти-фрод события (registration-key.service.ts:252-265 — этот шаблон в проекте уже есть). Рецидив считать по различным `refunds.externalRef` на разные `paymentId`, а не по числу строк AntiFraudEvent.

**Доказательство.** licenses.service.ts:281-318 — `revoke` делает безусловный `license.update`, никакого guard по статусу; refundedAt в `manualRefund` не фигурирует ни в сигнатуре, ни в описании

### Д18. [ВАЖНО] [однократность] `revoke(..., tx)` и `enqueue` внутри «одной транзакции возврата» пишут мимо этой транзакции — откат оставляет аудит-запись и отправленное письмо об отзыве работающей лицензии.

**Сценарий.** Транзакция возврата описана как единая цепочка: refunded_at → refunds → Payment → Order → `licenses.revoke(id, reason, undefined, tx)` → `enqueue('license.revoked')` → `AntiFraudEvent`. Но `AuditService.record` (audit.service.ts:133-135) не принимает `tx` и пишет через `this.prisma`, а `NotificationService.enqueue` (notification.service.ts:60) — тоже через `this.prisma` и вдобавок никогда не бросает. Транзакция падает на последнем шаге (создание AntiFraudEvent, дедлок, таймаут) → откат: лицензия НЕ отозвана, заказ НЕ REFUNDED. А письмо «ваша лицензия отозвана» уже лежит в `notifications` со статусом PENDING и уйдёт покупателю, чья лицензия продолжает работать; в `audit_log` висит `license.revoke`, которого не было. Через 5 минут поллер повторяет всё заново — второе такое же письмо.

**Правка.** Расширить `AuditService.record(entry, tx?)` симметрично `issue`/`revoke` (иначе четвёртый параметр tx у revoke — полумера, дающая ложное ощущение атомарности). Все побочные эффекты — письмо и анти-фрод событие — вынести ЗА коммит, как это уже сделано на пути выдачи (фаза D), либо ставить их через outbox-строку, создаваемую в той же транзакции.

**Доказательство.** src/common/audit/audit.service.ts:133-135 (`this.prisma.auditLog.create`, tx не принимается, ошибка глотается); src/modules/notifications/notification.service.ts:60 (`this.prisma.notification.create`)

### Д19. [ВАЖНО] [однократность] Ответ на повторное предъявление СВОЕГО погашенного кода определён в документе двумя взаимоисключающими способами, и `ConflictException` из шага 1 фазы C утекает заплатившему покупателю как голая 409-ка.

**Сценарий.** Таблица эндпоинтов: «409 (свой погашенный)». Раздел решений: «Повторная отправка формы тем же пользователем → 200 с теми же ключами», и `RedeemResult` содержит `{ state:'FULFILLED', licenseKeys }`. Реализовать можно только одно. При выборе 409 покупатель, обновивший страницу после успешной покупки, вместо своих ключей видит ошибку — а `all-exceptions.filter.ts:151-159` отдаёт generic «Запись с такими данными уже существует», по которому невозможно понять, что всё в порядке. Второй, не гипотетический путь к тому же экрану: интейк ставит `next_attempt_at = now()`, поэтому `digiseller-verify.processor` (@Interval 15 с) имеет право на строку НЕМЕДЛЕННО и гонится с HTTP-запросом того же покупателя. Воркер выигрывает шаг 1, HTTP-путь получает `count=0` → `ConflictException` → покупатель видит 409, хотя лицензия только что успешно выдана.

**Правка.** Зафиксировать одно правило: при `redeemedByUserId === actor.id` всегда 200 и ключи, перечитанные из `licenses where orderId`. `fulfill` обязан ловить собственный `count===0`, перечитывать строку и возвращать FULFILLED, если она уже исполнена тем же пользователем, — а не бросать наружу. Ни P2002, ни ConflictException из внутренностей фазы C не должны доходить до покупателя на денежном пути. Плюс ставить интейку `next_attempt_at = now() + 30s`, чтобы HTTP-путь получал свой запрос первым и гонка с воркером была исключением, а не нормой.

### Д20. [ВАЖНО] [однократность] Кража или опечатка в код: настоящий покупатель получает 404 CODE_INVALID, неотличимую от «кода не существует», хотя система уже держит его email и знает, кто код забрал. Данные для правильного ответа есть, они просто не используются.

**Сценарий.** Формат-гейт (16 символов, `[A-Za-z0-9]`) по построению не ловит опечатку в одном символе, попавшую в другой живой код, и не ловит подобранный или подсмотренный код. Пользователь X предъявляет код Y первым — `require_email_match=false`, буквально «кто предъявил, тот и владелец» — и получает лицензию. Настоящий покупатель Y предъявляет свой код: строка есть, `redeemedByUserId ≠ Y` → правило анти-оракула → 404 CODE_INVALID «код неверен». Строка при этом уже содержит `buyerEmail` из проверенного ответа площадки, совпадающий с почтой аккаунта Y, но на этом пути сравнение не делается и аудит-события не пишется (расхождение почты фиксируется только при УСПЕШНОЙ выдаче). Итог: Y заплатил, не получил ничего, услышал «такого кода нет», а поддержка не имеет ни тикета, ни улики.

**Правка.** На ветке «погашен другим» сравнивать сохранённый `buyerEmail` с подтверждённой почтой аккаунта заявителя. Совпало → 409 + карантинный тикет `CODE_TAKEN_BY_OTHER` для поддержки. Оракула это не создаёт: чтобы получить 409, нужно уже владеть почтой покупателя реальной сделки — перебирающему это недоступно. Не совпало → оставить 404, но обязательно писать аудит-событие с sha256 кода и обоими user id: сейчас единственный случай, который платформа могла бы доказать, оставляет ровно ноль следов.

### Д21. [ВАЖНО] [внешний-отказ] Заявленная защита от рецидива — Device.isBlocked — не блокирует ничего: устройство привязано к отозванной лицензии, а проверка смотрит только на текущее устройство ТОЙ ЖЕ лицензии. Плюс порядок шагов гарантирует, что блокировать будет уже нечего.

**Сценарий.** Пользователь покупает, скачивает payload, делает возврат — дважды. Срабатывает правило рецидива: AntiFraudEvent HIGH + Device.isBlocked=true «для устройства активации». Дальше он покупает третий раз с той же машины: создаётся новый Order → новая License → hwid.bind делает upsert по (licenseId, hwidHash), находит НОВЫЙ licenseId → создаёт новую строку devices с isBlocked=false. Проверка hwid.service.ts:187 читает license.currentDevice?.isBlocked, то есть устройство этой конкретной лицензии — оно чистое. Глобального поиска по hwidHash в коде нет вообще: во всём проекте isBlocked встречается ровно дважды (hwid.service.ts:187 и hwid.service.ts:341, где setManually при upsert ЯВНО сбрасывает isBlocked в false). Ущерб схемы = 0, повторяемость, которую проект объявил «настоящей защитой», ничем не оплачена. Отдельно, порядок в описанной транзакции возврата: licenses.revoke идёт ПЕРЕД реакцией на рецидив, а revoke делает currentDeviceId = null — значит к моменту блокировки «устройства активации» ссылки на него уже нет и код либо упадёт на null, либо заблокирует пустоту. И обратной операции нет: административного эндпоинта разблокировки устройства и снятия запрета погашения по почте в проекте не заведено — честный покупатель, у которого площадка дважды провела возврат по своей ошибке, выходит из бана только руками в БД.

**Правка.** Блокировать не строку devices, а сам hwid: таблица blocked_hwids(hwid_hash, reason, created_at, lifted_at) и проверка при bind/check по hwid_hash, а не по currentDevice. Захватывать currentDeviceId/hwidHash ДО вызова revoke. Завести эндпоинты снятия блокировки устройства и запрета по почте под правом администратора — иначе любой ложный рецидив это терминальный экран без выхода.

**Доказательство.** schema.prisma:891-931: Device.licenseId FK onDelete Cascade, @@unique([licenseId, hwidHash]) — устройство существует В РАЗРЕЗЕ лицензии, индекс @@index([hwidHash]) есть, но по нему никто не фильтрует. hwid.service.ts:187 `if (license.currentDevice?.isBlocked)`. hwid.service.ts:341 `update: { isBlocked: false }`. licenses.service.ts:288-296: revoke ставит currentDeviceId: null. Grep по isBlocked во всём src даёт 2 попадания.

### Д22. [ВАЖНО] [внешний-отказ] Курсор поллинга возвратов по last_polled_at не защищён от одной вечно падающей сделки, а правило «неизвестный retval → RETRYABLE, никогда REJECT» именно здесь работает против нас.

**Сценарий.** По одной сделке GET /api/purchase/info/{inv} стабильно отвечает не-OK: сделка удалена/архивирована у площадки, приходит недокументированный retval, или DDoS-Guard отдаёт HTML именно на этот путь. Классификатор обязан вернуть RETRYABLE (REJECT запрещён по принятому решению), терминального исхода для точечной доводки не предусмотрено, счётчика попыток на строку — тоже. Ветка А: если last_polled_at ставится только на успехе, эта строка навечно остаётся головой курсора, забирает бюджет тика, и ВСЕ остальные сделки не опрашиваются никогда — возвраты по всей базе перестают обнаруживаться, лицензии по возвращённым деньгам работают, а /health показывает свежий успешный поллинг, потому что дешёвая развёртка по seller-sells/v2 продолжает отрабатывать. Ветка Б: если last_polled_at ставится всегда, строка тихо крутится по кругу до истечения refund_watch_days=90 и возврат по ней не будет замечен вообще, без единого сигнала. Оба выхода — только ручное вмешательство, и оба замечаются по жалобе, а не по метрике.

**Правка.** Продвигать last_polled_at (или отдельный next_poll_at) БЕЗУСЛОВНО, включая неуспех; завести poll_failures на строку с потолком и переводом в админскую очередь после N подряд; в /health отдавать не время последнего тика, а МАКСИМАЛЬНЫЙ возраст last_polled_at среди наблюдаемых строк и число строк с poll_failures>0 — только такой показатель отличит «поллинг идёт» от «поллинг крутится на одной строке».

**Доказательство.** Проект, «Возвраты»: «Точечная доводка: GET /api/purchase/info/{inv} по redeemed_at IS NOT NULL AND refunded_at IS NULL, курсор по last_polled_at» — поведение last_polled_at при неуспехе не задано, счётчик неудач на строку отсутствует. Решение по retval: «Неизвестный retval → RETRYABLE... Никогда REJECT автоматически». Health отдаёт «время последнего успешного поллинга» (одно на модуль).

### Д23. [ВАЖНО] [внешний-отказ] notifications.enqueue и audit.record не принимают транзакцию и пишут мимо неё, а заявлены внутри «одной транзакции возврата». Откат оставляет покупателю письмо об отзыве работающей лицензии, а повтор шлёт второе.

**Сценарий.** Поллер обнаружил возврат, транзакция дошла до enqueue('license.revoked') — уведомление коммитится в БД немедленно, потому что NotificationService.enqueue ходит через this.prisma и параметра tx не имеет (в отличие от issue(params, tx) и правки revoke(..., tx)). Следующим шагом транзакция падает: deadlock/serialization failure, либо вставка в refunds ловит @@unique([paymentId, externalRef]), либо таймаут 10 с. Всё откатывается — кроме уведомления. Покупатель получает «ваша лицензия отозвана», а лицензия ACTIVE, заказ DELIVERED, платёж CONFIRMED. На следующем тике реакция отрабатывает заново и отправляет второе письмо. То же самое с audit.record внутри licenses.revoke: журнал утверждает, что отзыв состоялся, хотя он откатился — то есть при разборе спора аудит врёт в сторону «мы отозвали».

**Правка.** Расширить enqueue(params, tx?) и audit.record(..., tx?) тем же приёмом, что и issue/revoke (db = tx ?? this.prisma) — иначе слово «транзакция» в разделе возвратов неверно. Либо вынести всю пост-эффектную часть в outbox: строка в digiseller_events коммитится вместе с реакцией, отдельный воркер по ней шлёт письмо и пишет антифрод.

**Доказательство.** notification.service.ts:37-45 — сигнатура enqueue(params) без tx, внутри await this.prisma.notification.create (строка 60). licenses.service.ts:281-318 — revoke вызывает this.audit.record через this.prisma. Проект, «Возвраты»: «Реакция, одна транзакция... → licenses.revoke(id, reason, undefined, tx) → enqueue('license.revoked') → AntiFraudEvent(PAYMENT_REVERSAL)».

### Д24. [ВАЖНО] [внешний-отказ] digiseller-deliver.processor — цикл без счётчика, без бэкоффа и без терминального состояния. Несколько мёртвых строк навсегда съедают глобальный бакет и превращаются в 503 для живых покупателей.

**Сценарий.** По сделке PUT .../deliver никогда не завершится успехом: код уже возвращён, сделка архивирована, у токена отобрали право (403 — по правилам клиента «однократный GET /api/token/perms, отсутствие права → NOT_CONFIGURED и алерт, а не ретрай», но deliver_notified_at при этом так и не проставляется), либо стабильно приходит retval 3, который по решению «наш баг порядка вызовов, в лог ERROR» — и снова без отметки. Строка навсегда остаётся в предикате redeemedAt IS NOT NULL AND deliver_notified_at IS NULL, и @Interval(60_000) берёт её каждую минуту, вечно. За полгода таких строк накапливается десятки; каждая тратит запрос в минуту из global_upstream_per_minute=60. Когда фон съедает бакет, живой покупатель на redeem получает 503 PROVIDER_UNAVAILABLE — при полностью здоровой площадке. Приоритета между интерактивным погашением и фоном не задано, бакет один.

**Правка.** Добавить deliver_attempts + next_deliver_at с экспонентой и потолком, и терминальное DELIVER_GIVEN_UP, попадающее в ту же админскую очередь, что и карантин. Развести бакеты: интерактивное погашение не должно конкурировать с фоном за один счётчик, либо фону выделить фиксированную долю (например, 20 из 60), чтобы фон физически не мог отказать покупателю.

**Доказательство.** Проект: «недозвонившиеся строки добирает digiseller-deliver.processor (redeemedAt IS NOT NULL AND deliver_notified_at IS NULL)», «retval 3 — наш баг порядка вызовов, в лог ERROR» — ни счётчика попыток, ни next_deliver_at, ни терминального состояния в списке полей (deliverNotifiedAt + частичный индекс, п.4 правок схемы). «global_upstream_per_minute | 60 | токен-бакет перед клиентом площадки. Исчерпан → 503 PROVIDER_UNAVAILABLE».

### Д25. [ВАЖНО] [внешний-отказ] Payment.amount — Decimal(12,2), а модуль пишет туда сумму площадки, включая WMX→BTC. Крипто-платёж записывается как 0.00, и запись, названную в схеме единственным источником правды при разборе споров, становится нечем сверять.

**Сценарий.** Покупатель платит 0.00042 BTC (WMX). mapCurrency даёт BTC, сумма площадки идёт в Payment.amount типа numeric(12,2) — PostgreSQL молча округляет до 0.00, ошибки нет. Дальше: (а) аудит «расхождение payment.amount с plan.price» срабатывает на каждой крипто-продаже и обесценивается; (б) при возврате в refunds.amount попадает 0.00, и отличить полный возврат от частичного невозможно — то есть ветка PARTIALLY_REFUNDED, ради которой заведена целая таблица и два новых значения енумов, для крипты не работает в принципе; (в) при споре с площадкой у нас в БД написано, что покупатель заплатил ноль. Деньги прошли, их величина потеряна безвозвратно — rawPayload это компенсирует только глазами человека.

**Правка.** Либо отдельная колонка provider_amount Decimal(24,8) под сумму площадки в её собственной точности (Payment.amount тогда остаётся нашим), либо валюты, не выражаемые в двух знаках, уводить в карантин, а не округлять молча. Заодно проверить длину: currency VarChar(3) при «неизвестный код пишем как есть» — любой четырёхсимвольный код площадки даст ошибку 22001 внутри транзакции фазы C, то есть откат и попадание в горячий цикл из Д2.

**Доказательство.** schema.prisma:1084-1085: `amount Decimal @db.Decimal(12, 2)`, `currency String @default("RUB") @db.VarChar(3)`, комментарий к rawPayload: «единственный источник правды при разборе споров». Проект, «Деньги»: «Payment.amount/currency = сумма и валюта площадки. mapCurrency: WMZ→USD, WMR→RUB, WME→EUR, WMU→UAH, WMX→BTC».

### Д26. [ВАЖНО] [внешний-отказ] Circuit breaker и fail-closed глобальный бакет образуют состояние «продажи остановлены», у которого не задано условие выхода и нет ни одного рычага сброса, кроме удаления ключа в Redis руками.

**Сценарий.** Брейкер на хост открывается (серия таймаутов площадки, или ошибочно — на 403, который клиент трактует как NOT_CONFIGURED). Пока он открыт, redeem отдаёт 503 и коды не принимаются, поллер возвратов не ходит. Условие полузакрытия и пробного запроса нигде не описано, а глобальный бакет вдобавок fail-closed — если Redis при этом мигает, ни одна проба и не пройдёт. Административного эндпоинта сброса брейкера нет: GET /health только читает и, по решению авторов, из /health/ready исключён, а внешнего мониторинга по п.8 не существует вовсе. Итог: единственный платёжный канал стоит, никто об этом не знает, выход — redis-cli DEL по подсказке того, кто помнит имя ключа. Это же состояние наступает при DECRYPT_FAILED после неудачной ротации ключа: redeem 503 и поллер не стартует, то есть возвраты перестают обнаруживаться незаметно.

**Правка.** Задать half-open явно (одна пробная попытка раз в N секунд, брейкер закрывается на первом успехе) и обязательно пропускать пробу мимо fail-closed бакета — иначе брейкер не сможет закрыться при деградировавшем Redis. Добавить POST /billing/digiseller/health/reset под правом администратора (сброс брейкера и отрицательного кэша). Поллер возвратов не должен вставать при NOT_CONFIGURED/DECRYPT_FAILED молча: невозможность обнаруживать возвраты по уже проданным лицензиям — не то же самое, что невозможность продавать.

**Доказательство.** Проект, HTTP-клиент: «Circuit breaker на хост в Redis» — политика полузакрытия не описана. Лимиты: «глобальный бакет fail-closed → 503». Эндпоинты: health — GET, «В /health/ready НЕ включается». Раздел владельца п.8: «Пока внешнего мониторинга нет, суточная недоступность площадки будет замечена по жалобам покупателей». Конфигурация: «null → DECRYPT_FAILED, громкая ошибка и degraded health», «поллер не стартует».

### Д27. [ВАЖНО] [злоупотребление] GET /billing/digiseller/redeem/:code/status кладёт 16-значный предъявительский код в URL, и он в открытом виде попадает сразу в два независимых журнала — nginx access.log и прикладной лог. Это прямое нарушение собственного правила модуля («ни токен, ни api_key, ни сам код покупки в логи не попадают, код — предъявительский документ»).

**Сценарий.** Покупатель открывает страницу статуса. Строка `"uri":"/api/v1/billing/digiseller/redeem/A1B2C3D4E5F6G7H8/status"` ложится в access.log, туда же — pino-строка с тем же url. Любой, у кого есть доступ к логам или к их сборщику (а он, как записано в самом проекте, всегда шире доступа к БД), забирает ещё не погашенный код и гасит его первым под своим JWT. Настоящий покупатель получает 404 CODE_INVALID — неотличимый от опечатки по анти-оракульному правилу, и поддержка не может доказать обратное.

**Правка.** Не передавать код в URL: статус запрашивать POST-ом с кодом в теле (тело не логируется) либо возвращать на redeem непрозрачный claim_id и делать GET /redeem/claim/:claimId/status. Если путь с кодом остаётся — отдельный location с access_log off и явное исключение url для этого маршрута в pino-сериализаторе, но это защита от одного сборщика логов из двух и хуже смены транспорта.

**Доказательство.** C:/Users/user/work/kwork/license-platform/docker/nginx/templates/default.conf.template:22-33 — log_format json_combined содержит '"uri":"$request_uri"', access_log включён на основном server (строка 163). C:/Users/user/work/kwork/license-platform/apps/api/src/common/logger/logger.module.ts:88,92 — сериализатор req отдаёт `url` целиком; redact-пути покрывают только req.body.*. Сам проект формулирует правило в licenses.service.ts:313 и повторяет его в hwid.service.ts (комментарий про предъявительский документ).

### Д28. [ВАЖНО] [злоупотребление] Анти-оракул не выполняется: «код погашен другим» и «кода не существует» различаются и кодом ответа, и задержкой на два-три порядка, потому что первый случай отвечает из БД, а второй — только после похода к площадке, который по default-ветке даёт RETRYABLE, то есть 202, а не 404.

**Сценарий.** Противник шлёт код, уже погашенный другим пользователем: INSERT ловит P2002, строка перечитывается, ответ 404 CODE_INVALID за единицы миллисекунд, сети нет. Тот же противник шлёт несуществующий код: формат-гейт пройден, отрицательный кэш пуст, идём в Digiseller, ответ неизвестного формата → RETRYABLE → 202 PENDING_VERIFY через сотни миллисекунд (а при DDoS-Guard — через таймаут). Различить два случая тривиально: 404-мгновенно = код реален и занят, 202-медленно = кода нет. Именно тот оракул существования, который раздел «Анти-оракул» объявляет закрытым; заодно он подтверждает противнику структуру алфавита кода, если она есть.

**Правка.** Уравнять наблюдаемое поведение: отвечать 202 PENDING_VERIFY и на «погашен другим» (с фиксированной задержкой из того же диапазона), а реальный вердикт по чужому коду отдавать только через status по claim_id, которого у противника нет. Минимум — искусственная задержка и одинаковый статус на обоих путях; без этого раздел «Анти-оракул» описывает намерение, а не свойство системы.

**Доказательство.** Раздел «Анти-оракул» обещает одинаковый 404 для обоих случаев. Раздел «Как классифицировать неизвестный retval» решает: неизвестный retval → RETRYABLE, никогда REJECT; таблица эндпоинтов содержит 202 PENDING_VERIFY. Раздел рисков признаёт, что ответ площадки на несуществующий код неизвестен — значит REJECT для него недостижим в принципе, и 404 на этом пути не появится никогда.

### Д29. [ВАЖНО] [злоупотребление] UNIQUE(lower(unique_code)) → карантин CODE_CASE_COLLISION срабатывает в первую очередь не на редкой паре разных кодов, а на самом покупателе, повторно вводящем СВОЙ код в другом регистре, и параллельно даёт дешёвый способ завалить очередь ручного разбора.

**Сценарий.** (а) Покупатель вводит код с мобильной клавиатуры (автозаглавная первая буква) или копирует из письма и правит руками, получает 202 PENDING_VERIFY. Ждёт, вводит ещё раз, теперь корректным регистром. INSERT падает на lower()-индексе, поиск по WHERE unique_code = <ввод> ничего не находит (в БД лежит другой регистр), и по описанному правилу сделка уходит в карантин CODE_CASE_COLLISION — то есть повторная отправка формы, которую проект обещал сделать безобидной, превращается в тикет по СВОЕМУ ЖЕ коду. (б) Противник берёт любую строку из 16 символов и шлёт её case-варианты: первый создаёт строку, каждый следующий гарантированно ловит lower()-коллизию и создаёт карантинную запись, не тратя ни одного обращения к площадке. Десяток OAuth-аккаунтов → сотни мусорных строк в очереди, в которой тонут настоящие INV_CONFLICT и QUANTITY_OUT_OF_RANGE.

**Правка.** Перед уводом в карантин сравнить claimed_by_user_id колидирующей строки с текущим пользователем: тот же человек → вернуть состояние существующей строки (200/202 как при обычном повторе), карантин оставить только для коллизии между РАЗНЫМИ пользователями. Карантинные записи от case-вариантов не создавать без хотя бы одного успешного обращения к площадке, иначе очередь ручного разбора становится бесплатной мишенью.

**Доказательство.** Раздел «Ровно-однократность», слой 2: «Коллизия по нему не отказ, а карантин CODE_CASE_COLLISION». Раздел «Нормализация кода»: регистр не приводится, формат-гейт пропускает charset [A-Za-z0-9], то есть 2^16 вариантов одной строки проходят валидацию. Сценарий «тот же пользователь, тот же код» в ветвлении по P2002 не выделен ни разу.

### Д30. [ВАЖНО] [злоупотребление] Гейт по сумме снят, а заменяющее его аудит-событие не имеет потребителя (мониторинга в проекте нет, признано разделом владельца п.8), при этом Order.amount пишется как НАШ прайс × quantity — то есть недоплата не блокируется, не алертится и вдобавок маскируется в единственном отчёте, куда владелец смотрит.

**Сценарий.** Промокод площадки со скидкой 90%, заведённый для розыгрыша, расходится в Telegram. Сто покупок по 10% цены проходят штатно: quantity берётся из cnt_goods (до 20), сумма не проверяется вовсе, лицензии выдаются. В отчёте «продажи по продуктам за период», построенном по Order.amount, видна ПОЛНАЯ выручка — расхождение живёт только в Payment.amount и в аудит-таблице, которую никто не опрашивает. Схема обнаруживается на сверке с выпиской площадки через месяцы. Тот же механизм работает при любой ошибке маппинга cnt_goods: потолок 20 ограничивает ущерб на сделку, но не ловит систематику.

**Правка.** Не порог на выдачу, а два дешёвых контроля: (1) суточный отчёт-сверка sum(Payment.amount по площадке) против sum(Order.amount) с порогом расхождения и адресатом; (2) счётчик «покупок с расхождением > X% на пользователя/почту за сутки» с карантином при аномалии — он ловит массовое использование утёкшего промокода и не трогает единичную акционную покупку. Плюс отдельная колонка/вьюха с суммой площадки, чтобы отчётность не показывала денег, которых не приходило.

**Доказательство.** Раздел «Деньги»: «Жёсткого гейта по сумме нет… Расхождение payment.amount с plan.price → аудит-событие»; там же Order.amount = plan.price × quantity. Раздел владельца п.8: «нет ни метрик, ни алертов… суточная недоступность площадки будет замечена по жалобам покупателей» — то есть у аудит-события заведомо нет читателя. Аргумент про promo_code корректно убивает жёсткий порог 0.5, но не обосновывает отсутствие любого контроля.

### Д31. [ВАЖНО] [контракт] Ответ /api/purchase/info завёрнут в content и использует ДРУГИЕ имена полей, чем /api/purchases/unique-code; в замысле мэппер один и поля названы по unique-code

**Сценарий.** Поллер вызывает GET /api/purchase/info/{inv} и читает body.invoice_state — оно undefined, потому что состояние лежит в body.content.invoice_state. Условие «=== 5» никогда не истинно, ни один возврат не обнаруживается, и это молчаливый отказ: строки исправно опрашиваются, last_polled_at обновляется, health показывает «последний успешный поллинг = только что». Тот же промах на currency: applyProviderRefund получит currency из body.type_curr → undefined → строка refunds с пустой/невалидной валютой при NOT NULL-колонке, либо падение транзакции возврата. Аналогично id_goods vs item_id при разборе карантина. Ни один из этих случаев не воспроизводится на тестах с FakeDigisellerApi, если фейк собран по одной схеме на все методы.

**Правка.** Три отдельных типа и три отдельных парсера: UniqueCodeResponse (плоский, type_curr/id_goods/inv/email), PurchaseInfoResponse (обёртка {retval, retdesc, errors, content}, внутри currency_type/item_id/buyer_info.email, invoice_id в ответе НЕТ — нести его из запроса), SellerSellsRow (invoice_id/product_id/amount_in/amount_out/amount_currency). mapCurrency принимает уже извлечённый код, а не «поле type_curr». В табличных тестах mapper'а держать по фикстуре с реальной формой ответа каждого метода, включая обёртку content.

**Доказательство.** api_general.asp, purchase/info: {"retval":0,"retdesc":null,"errors":null,"content":{"item_id","cart_uid","name","amount","amount_usd","currency_type","invoice_state","purchase_date","date_pay","unit_goods","cnt_goods",...,"buyer_info":{"email",...}}}. unique-code: плоский объект с "inv","id_goods","amount","type_curr","date_pay","email". seller-sells/v2: "invoice_id","product_id","amount_in","amount_out","amount_currency","email". Проект объявляет одну чистую функцию mapCurrency(typeCurr) и один PurchaseInfo, поле состояния берёт как «invoice_state», а не «content.invoice_state».

### Д32. [ВАЖНО] [контракт] Правило «неизвестный retval → RETRYABLE, никогда REJECT» распространено на deliver, purchase/info и seller-sells, где коды ошибок ПОЛОЖИТЕЛЬНЫЕ и терминальные; у deliver-процессора при этом нет ни счётчика попыток, ни терминального состояния

**Сценарий.** API-ключ продавца заведён без права [Содержимое]: Редактировать — а именно оно требуется для deliver. Погашение и поллинг работают, товар выдаётся, но каждый PUT .../deliver возвращает HTTP 200 + retval -5. Значения -5 в разборе нет, срабатывает default → RETRYABLE, deliver_notified_at не проставляется, строка остаётся в выборке процессора навсегда. Через сутки при 50 продажах это 50 строк × 60 запросов в час = 72 000 бесполезных обращений в сутки к площадке за DDoS-Guard — ровно тот исход (бан продавца, отказ единственного канала продаж), ради предотвращения которого в замысле заведён глобальный бакет. Обработчика 403 это не спасает: площадка сообщает об отсутствии права кодом retval внутри HTTP 200, а не статусом 403, поэтому ветка «на 403 — GET /api/token/perms» не срабатывает никогда. Тот же механизм у поллера: опечатка в формате date_start даст retval 11 на каждом тике вместо громкой ошибки.

**Правка.** Правило «никогда REJECT» оставить ТОЛЬКО для searchuniquecode, где таблица кодов действительно неполна. Для deliver разобрать документированные коды явно: 0/4 — успех, 3 — ERROR порядка вызовов, -3/-4 — инвалидация токена и один релогин, -5 — терминально, ставить deliverFailedPermanent + алерт и выводить строку из выборки, -2/1/2 — терминально, карантин. Завести deliverAttempts + deliverNextAttemptAt с той же лестницей, что у verify, и потолок, после которого строка перестаёт опрашиваться. Для purchase/info и seller-sells считать любой retval != 0 ошибкой запроса (детали из errors/retdesc), а не сетевым сбоем.

**Доказательство.** api_general.asp, deliver: «0 - запрос выполнен; -5 - доступ запрещён; -4 - неверный токен; -3 - неверный токен; -2 - неверный код; 1 - неверный код; 2 - неверный код; 3 - уникальный код ещё не был проверен; 4 - подтверждение о доставке уже получено». purchase/info: «0 - успех; 1 - ошибка при выполнении запроса, детали в errors». api_statistics.asp, seller-sells/v2: «1 - неверно задан параметр id_seller; 2 - page; 3 - rows; 9 - returned; 10 - sign; 11 - date_start; 12 - date_finish». Проект: «retval 0 и retval 4 — оба успех; retval 3 — наш баг порядка вызовов», «default-ветка: неизвестный retval → RETRYABLE, никогда не REJECT», процессор доставки — @Interval(60_000) по условию «redeemedAt IS NOT NULL AND deliver_notified_at IS NULL» без verifyAttempts-аналога.

### Д33. [ВАЖНО] [контракт] Разрешения токена — три РАЗНЫХ права под три используемых метода, а трёхзначное состояние конфигурации (OK / NOT_CONFIGURED / DECRYPT_FAILED) состояния «настроено, но прав не хватает» не выражает

**Сценарий.** Владелец заводит API-ключ через админку и выдаёт ему только «детали счетов» — минимум, нужный для приёма кодов, и ровно то, что он проверит первым делом (погашение работает). Конфигурация читается как OK, health зелёный, продажи идут. Поллер возвратов при этом получает 401/403 на каждый seller-sells/v2, а deliver — retval -5. Возвраты не детектируются вообще: деньги вернулись, лицензия работает бессрочно, никакого сигнала в системе нет, потому что «время последнего успешного поллинга» в health отражает только тик, а не успех вызова. Обнаружится по расхождению выписки с отчётом через месяцы.

**Правка.** На старте модуля и в /billing/digiseller/health однократно дёргать GET /api/token/perms и сверять с требуемым набором {view_invoice, content_change, sales_statistics_view}; недостающие права отдавать как отдельное состояние INSUFFICIENT_PERMISSIONS с перечнем и деградировать точечно: нет sales_statistics_view — поллер не стартует и health красный; нет content_change — deliver-процессор выключен и health degraded; нет view_invoice — redeem отдаёт 503, как при NOT_CONFIGURED. Пустой массив от token/perms и 401/403 на нём трактовать как «прав нет», а не как сетевой сбой.

**Доказательство.** api_general.asp: searchuniquecode — «Токен доступа, мин. разрешение: [Операции]: детали счетов»; deliver — «[Содержимое]: Редактировать»; purchase/info — «[Операции]: детали счетов». api_statistics.asp, seller-sells/v2 — «[Статистика]: Статистика продаж». GET /api/token/perms сам требует права token_get_perms, и «пустой массив означает отсутствие доступа (http status 401 или 403)». Проект: DigisellerConfigState = OK | NOT_CONFIGURED | DECRYPT_FAILED.

### Д34. [ВАЖНО] [контракт] Окно poll_window_hours=48 в seller-sells/v2 фильтрует по дате ПРОДАЖИ, а не по дате возврата: «дешёвая развёртка» физически не видит возвраты по сделкам старше двух суток

**Сценарий.** Покупка оплачена 1 марта, возврат оформлен 20 марта. Развёртка, запущенная 20 марта, строит окно [18 марта, 20 марта] по датам продажи и возвращает продажи, СОВЕРШЁННЫЕ в эти двое суток; сделка от 1 марта в выборку не попадает ни в один день. То есть слой, поданный как дешёвый детектор возвратов, ловит только возвраты в первые 48 часов после оплаты, а всё остальное держится исключительно на поштучном purchase/info. При этом сам факт, что развёртка «отработала успешно», уходит в health как признак живого поллинга и маскирует отсутствие детекции.

**Правка.** Либо строить окно развёртки не от now, а перекрывающим весь горизонт наблюдения (date_start = now − refund_watch_days, постраничный обход, rows ≤ 1000 по документации — swagger обещает 5000, ориентироваться на меньшее), сохраняя между прогонами множество уже виденных invoice_id, чтобы не перечитывать всё каждый тик; либо честно назвать развёртку тем, чем она является — детектором свежих возвратов, — и перенести обещание полноты на поштучный опрос, заодно пересчитав его бюджет (см. отдельный дефект).

**Доказательство.** api_statistics.asp, seller-sells/v2: date_start — «Начальная дата», date_finish — «Конечная дата», формат 'yyyy-MM-dd HH:mm:ss', МСК. Единственные даты в строке ответа — date_put («дата добавления содержимого товара») и date_pay («дата продажи»); поля даты возврата в ответе нет вообще, есть только флаг returned. Проект: «Дешёвая развёртка: POST /api/seller-sells/v2, returned=2, окно poll_window_hours=48».

### Д35. [ВАЖНО] [контракт] Поштучный поллинг 90-дневного горизонта не помещается в объявленный global_upstream_per_minute = 60, и приоритета между поллером и живым погашением нет

**Сценарий.** При 15 продажах в сутки под наблюдением находится 15 × 90 = 1350 сделок; при созревании раз в 900 с каждая требует 4 опросов в час — 5400 запросов в час против 3600, которые даёт бакет 60/мин, и это ещё до единого погашения. Дальше два исхода, оба плохие. Если поллер тратит тот же бакет — покупатель, вводящий код, получает 503 PROVIDER_UNAVAILABLE потому, что фоновая задача выбрала лимит: отказ в продаже из-за собственного поллинга. Если поллер бакет не тратит — глобальный потолок обращений к площадке, объявленный единственной защитой от бана у DDoS-Guard, обходится самой массовой частью трафика. В обоих случаях цикл поллинга не замыкается, курсор по last_polled_at ползёт, и фактическая задержка обнаружения возврата вырастает с заявленных ~15 минут до многих часов молча.

**Правка.** Развести бюджеты явно: отдельный бакет площадки для фонового поллинга (например digiseller.poll_upstream_per_minute) с абсолютным приоритетом покупательского пути — при исчерпании общего лимита первым останавливается поллер, а не redeem. Сделать расписание наблюдения затухающим по-настоящему и посчитанным: сутки — раз в 15 минут, до 7 суток — раз в час, до 90 суток — раз в сутки; при таком профиле 1350 сделок дают ~200 запросов в час. Ограничить число строк, обрабатываемых за тик, и вынести и горизонт, и профиль в settings, чтобы владелец мог сузить их под реальный горизонт возвратов.

**Доказательство.** Проект: «digiseller.refund_watch_days=90», «poll_interval_sec» определяет созревание строк (по умолчанию 900 с в тексте рисков), «Точечная доводка: GET /api/purchase/info/{inv} по redeemed_at IS NOT NULL AND refunded_at IS NULL», «global_upstream_per_minute | 60 | токен-бакет перед клиентом площадки. Исчерпан → 503 PROVIDER_UNAVAILABLE». Один запрос purchase/info = одна сделка. ТЗ п.21 требует не менее 10 000 зарегистрированных пользователей.

### Д36. [МЕЛОЧЬ] [злоупотребление] Отрицательный кэш стоит ПЕРЕД дорогими лимитами и ключуется по sha256 регистрозависимого кода: попадание в кэш не стоит противнику ни одной единицы ни одного счётчика, а промах по регистру обходит кэш целиком.

**Сценарий.** Кэш-хит: запросы с уже отвергнутым кодом не инкрементят ни дешёвый счётчик (формат прошёл), ни дорогой (короткое замыкание раньше), поэтому CODE_BRUTEFORCE на такой активности не сработает никогда и в антифроде её не видно — остаётся только nginx api_zone 300r/m. Кэш-промах: тот же код в другом регистре даёт другой sha256, то есть отрицательный кэш не защищает ровно от того класса ввода, ради которого заведён lower()-индекс.

**Правка.** Ключ кэша считать от sha256(lower(code)) — иначе он несовместим с собственным lower()-индексом. Дорогие лимиты проверять ДО отрицательного кэша (или инкрементить отдельный дешёвый счётчик на кэш-хите), чтобы повторное предъявление отвергнутых кодов оставалось наблюдаемым и учитывалось в пороге CODE_BRUTEFORCE.

**Доказательство.** Раздел «Фаза A»: порядок «формат-гейт → дешёвый счётчик malformed → отрицательный кэш → дорогие лимиты». Раздел «Лимиты»: ключ `digiseller:neg:<sha256(code)>`, при этом normalizeCode регистр не трогает. Прикладного общего троттлинга в API нет — зафиксировано в docker/nginx/templates/default.conf.template:44-47 («ОБЩЕГО прикладного rate limit в API сегодня НЕТ»).

### Д37. [МЕЛОЧЬ] [контракт] cnt_goods объявлен площадкой как число с плавающей точкой и существует только у товаров с нефиксированной ценой; resolveQuantity ветки для дробного значения не имеет

**Сценарий.** Товар с нефиксированной ценой (а именно там cnt_goods и приходит) продан на 2,5 единицы. Значение — число, поэтому ветка «не-число → 1» не срабатывает; оно не целое, поэтому ветка «целое 1..20» тоже не срабатывает; оно меньше 20, поэтому в карантин не уходит. Поведение не определено ни одной из перечисленных веток: в зависимости от реализации это либо тихая выдача одной лицензии вместо оплаченных двух с половиной (недовыдача при принятых деньгах и обращение в поддержку), либо запись дробного значения в Order.quantity Int и падение транзакции исполнения уже после успешной проверки кода.

**Правка.** Добавить явную ветку: Number.isInteger(cnt) === false → карантин QUANTITY_FRACTIONAL с приложенным сырым значением, решение принимает админ. Заодно зафиксировать в тестах таблицу входов {undefined, null, 0, 1, 1.0, 2.5, 20, 21, '3', NaN, Infinity} с ожидаемым исходом на каждый.

**Доказательство.** swagger api.digiseller.com/swagger/docs/v1, PurchaseModel.cnt_goods: {"format":"double","type":"number","description":"Number of paid product units"}. api_general.asp, unique-code: «unit_goods — единица оплаченного товара, только для товаров с нефиксированной ценой», «cnt_goods — количество единиц оплаченного товара, обязательно проверяйте это значение! Только для товаров с нефиксированной ценой». Проект: «quantity = cnt_goods, если целое 1..max_quantity (20); null/0/отсутствует/не-число → 1; больше максимума → карантин».

### Д38. [МЕЛОЧЬ] [контракт] Словари валют у трёх используемых методов не совпадают, и WMT — документированное, а не экзотическое значение; mapCurrency его не знает

**Сценарий.** Сделка, зачисленная в WMT, проходит проверку кода: Payment.currency = 'WMT' (колонка VarChar(3) выдержит), плюс аудит-событие currency_unmapped на совершенно штатной покупке — то есть сигнал, заведённый под аномалию, начинает срабатывать на норме и перестаёт читаться. Позже по той же сделке приходит возврат, поллер берёт валюту уже из purchase/info (content.currency_type) — и в отчёте по одному и тому же счёту сумма платежа и сумма возврата оказываются в кодах, которые невозможно свести ни с выпиской, ни с Order.amount в валюте тарифа.

**Правка.** Достроить таблицу до полного объединения документированных значений всех трёх методов (WMZ, WMR, WME, WMU, WMX, WMT) и покрыть её табличным тестом; событие currency_unmapped оставить только для кодов вне этого объединения. Отдельно проверить, что валюта возврата берётся из того же источника, что и валюта платежа, либо принудительно наследуется от Payment.

**Доказательство.** api_general.asp, unique-code: «type_curr — валюта платежа, зачисленного на ваш счет (не способ платежа!) — WMZ | WMR | WME | WMX». api_general.asp, purchase/info: «content\currency_type — валюта платежа, зачисленного на ваш счет — WMT | WMZ | WME | WMU». api_statistics.asp, seller-sells/v2: amount_currency, в примере «WMR». Проект: «mapCurrency: WMZ→USD, WMR→RUB, WME→EUR, WMU→UAH, WMX→BTC; неизвестный код (WMT и любой новый) ... пишется как есть + audit.record('digiseller.currency_unmapped')».

### Д39. [МЕЛОЧЬ] [контракт] Ветка карантина INV_CONFLICT и возможное расширение ключа до (inv, id_goods) построены на неверном допущении, что корзина из N позиций делит один invoice_id

**Сценарий.** Замысел планирует ветку «коллизия по inv_id уводит в карантин INV_CONFLICT» и держит открытым решение «если подтвердится — ключ расширяется до (inv, id_goods)», ожидая, что покупка двух товаров одной корзиной даст два кода с одинаковым inv. По схеме площадки этого не происходит: второй код принесёт собственный invoice_id, P2002 по UNIQUE(inv_id) не возникнет, и ветка окажется недостижимой. Цена — не отказ, а мёртвый код на денежном пути, который никто не сможет воспроизвести тестом, и незакрытый пункт в плане релиза, требующий «реальной корзинной покупки».

**Правка.** Снять вопрос с плана проверок, ветку INV_CONFLICT оставить как чистый ассерт-инвариант (лог ERROR + карантин без сценария восстановления), ключ не расширять. Вместо этого использовать cart_uid по назначению — как признак того, что у сделки есть соседние позиции, что полезно при разборе спора и при частичном возврате.

**Доказательство.** swagger api.digiseller.com/swagger/docs/v1: CartInfoModel = {invoice_id_cart, cart_uid, total_amount, currency, items[]}, где CartItemModel = {invoice_id, item_id, amount, currency} — то есть у КАЖДОЙ позиции корзины свой собственный invoice_id, а cart_uid лишь группирует их. api_general.asp: «cart_uid — UID корзины, только если товар был добавлен и оплачен через корзину».

