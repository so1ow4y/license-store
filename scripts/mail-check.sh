#!/usr/bin/env bash
# ============================================================================
#  Проверка почтового сервера. Запускается НА СЕРВЕРЕ, из каталога приложения:
#
#      cd /opt/license-platform && bash scripts/mail-check.sh
#
#  Её же дёргает deploy.sh после каждой выкладки.
#
#  ЗАЧЕМ ОНА ВООБЩЕ. Работающую отправку ломают не при переходе — её ломают
#  через полгода правкой «на глазок»: кто-то добавил строку в main.cf, кто-то
#  подложил новый ключ, кто-то сузил mynetworks. Все эти поломки ТИХИЕ: письма
#  продолжают уходить, просто ложатся в спам или не уходят вовсе, а API об
#  этом не сообщает — он честно отвечает 200.
#
#  ЧЕГО ЭТОТ СКРИПТ НЕ ДЕЛАЕТ. Он не проверяет защиту от открытого релея.
#  Проверять её ОТСЮДА бессмысленно: с самого сервера соединение приходит с
#  адреса, который может попасть в mynetworks, и вы проверите permit_mynetworks,
#  а не защиту. Внешние проверки — в разделе «Проверка снаружи» в конце вывода
#  и в отчёте по переходу; их надо гонять С ЧУЖОЙ МАШИНЫ.
# ============================================================================

set -uo pipefail   # без -e: скрипт обязан дойти до конца и показать ВСЕ беды

DOMAIN="${MAIL_DOMAIN:-pxcheats.com}"
SELECTOR="${MAIL_DKIM_SELECTOR:-mail}"

FAILED=0

log()  { echo -e "\n\033[36m=== $* ===\033[0m"; }
ok()   { echo -e "  \033[32m[ok]\033[0m $*"; }
bad()  { echo -e "  \033[31m[БЕДА]\033[0m $*"; FAILED=$((FAILED + 1)); }
warn() { echo -e "  \033[33m[?]\033[0m $*"; }

# Домен и селектор берём из .env.production, если он рядом: так проверка
# смотрит на ту же настройку, что и контейнеры, а не на своё представление
# о ней.
if [ -f .env.production ]; then
    v=$(grep -E '^MAIL_DOMAIN=' .env.production | head -1 | cut -d= -f2-)
    [ -n "$v" ] && DOMAIN="$v"
fi

echo "Домен: $DOMAIN, селектор DKIM: $SELECTOR"

# --- 1. Контейнеры на месте и не в цикле перезапуска ------------------------

log "Контейнеры"
for c in lp-opendkim lp-postfix lp-postfix-mx; do
    state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "нет")
    restarts=$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo 0)
    case "$state" in
        running)
            # Ненулевой счётчик перезапусков у контейнера, который «работает», —
            # признак падения по кругу. Оно почти всегда означает ошибку в
            # конфигурации, которая видна только в первых строках журнала.
            if [ "$restarts" -gt 0 ]; then
                warn "$c работает, но перезапускался $restarts раз(а) — посмотри docker logs $c"
            else
                ok "$c работает"
            fi
            ;;
        нет) bad "$c не существует. Профиль mail не включён? SMTP_HOST=postfix в .env.production?" ;;
        *)   bad "$c в состоянии «$state»; docker logs $c --tail 40" ;;
    esac
done

# --- 1b. Служба внутри контейнера жива, а не только сам контейнер -----------
#
# ЧТО К ПРОБЛЕМЕ ВЕЛО. Проверка выше смотрит на состояние КОНТЕЙНЕРА, и этого
# оказалось мало. Приёмник простоял в цикле падений, а здесь всё было зелёное:
#
#   * docker: контейнер running, RestartCount = 0 — контейнер и правда ни разу
#     не перезапускался, по кругу падал процесс ВНУТРИ него, а его падений
#     docker не считает;
#   * healthcheck: `postfix status` спрашивает про master, а master жив именно
#     потому, что перезапускает упавших детей;
#   * postconf ниже: читает ФАЙЛ конфигурации, а не работающую службу, поэтому
#     показывает то, что задумано, даже когда служба это значение отвергла.
#
# Ни одна проверка не разговаривала по SMTP. Отсюда правило: спросить у службы
# на её языке, а не собирать мнения о ней.
log "Почта отвечает по SMTP"
for c in lp-postfix lp-postfix-mx; do
    docker inspect -f '{{.State.Status}}' "$c" >/dev/null 2>&1 || continue
    # Изнутри контейнера, с 127.0.0.1: у роли mx это обходит задержку баннера
    # postscreen (postscreen_access_list = permit_mynetworks), поэтому ответ
    # приходит сразу. Прав на пересылку это не даёт — их решает другой параметр.
    banner=$(docker exec "$c" bash -c '
        exec 3<>/dev/tcp/127.0.0.1/25 2>/dev/null || { echo "НЕТ-СОЕДИНЕНИЯ"; exit 0; }
        IFS= read -r -t 5 -u 3 l || { echo "НЕТ-БАННЕРА"; exit 0; }
        printf "%s" "${l%$'\r'}"
        printf "QUIT\r\n" >&3 2>/dev/null
    ' 2>/dev/null)
    case "$banner" in
        220*)            ok  "$c отвечает: $banner" ;;
        НЕТ-СОЕДИНЕНИЯ)  bad "$c: порт 25 внутри контейнера закрыт — postfix не слушает" ;;
        НЕТ-БАННЕРА)     bad "$c: соединение есть, баннера нет — за портом никого.
      Почти всегда это упавшая служба, которую master поднимает по кругу:
        docker logs $c --tail 40 | grep -i fatal" ;;
        *)               bad "$c: неожиданный баннер «$banner»" ;;
    esac
done

# Падения служб в журнале. Строку «fatal» postfix печатает ровно один раз на
# каждую попытку запуска, поэтому её наличие за последние сутки — это либо
# сегодняшняя поломка, либо вчерашняя, о которой никто не узнал.
log "Падения служб в журналах"
for c in lp-opendkim lp-postfix lp-postfix-mx; do
    docker inspect -f '{{.State.Status}}' "$c" >/dev/null 2>&1 || continue
    fatals=$(docker logs "$c" --since 24h 2>&1 | grep -icE 'fatal:|bad command startup' || true)
    if [ "${fatals:-0}" -gt 0 ]; then
        bad "$c: за сутки $fatals сообщений о падении службы:"
        docker logs "$c" --since 24h 2>&1 | grep -iE 'fatal:|bad command startup' | tail -3 | sed 's/^/        /'
    else
        ok "$c: падений служб за сутки нет"
    fi
done

# --- 2. Подпись DKIM --------------------------------------------------------
#
# САМАЯ ВАЖНАЯ ПРОВЕРКА ФАЙЛА. opendkim-testkey берёт закрытый ключ с сервера,
# вытаскивает из DNS открытый и сверяет их между собой. «key OK» означает, что
# подпись, которую мы ставим, действительно проверяется получателем.
#
# Расхождение здесь — единственная поломка, которая не видна вообще ниоткуда:
# письма уходят, доставляются, DKIM-заголовок на месте, а Gmail молча кладёт
# их в спам.

log "Ключ DKIM: закрытый на сервере против открытого в DNS"
if out=$(docker exec lp-opendkim opendkim-testkey -d "$DOMAIN" -s "$SELECTOR" -vvv 2>&1); then
    echo "$out" | sed 's/^/    /'
    if echo "$out" | grep -q 'key OK'; then
        ok "закрытый ключ соответствует записи ${SELECTOR}._domainkey.${DOMAIN}"
    else
        bad "opendkim-testkey отработал, но не сказал «key OK» — читай вывод выше"
    fi
else
    echo "$out" | sed 's/^/    /'
    bad "opendkim-testkey не прошёл. Обычные причины: запись в DNS не совпадает
        с .secrets/dkim-private.pem, либо резолвер контейнера не отвечает."
fi

# --- 3. Подписант принимает соединения --------------------------------------
#
# Проверяем именно ПОРТ, а не «процесс жив». Повисший opendkim для нас ничем
# не лучше мёртвого: postfix упрётся в milter_default_action=tempfail, и
# письма встанут в очередь.

log "Милтер на 8891"
if docker exec lp-postfix bash -c 'exec 3<>/dev/tcp/opendkim/8891' 2>/dev/null; then
    ok "postfix (роль out) видит opendkim:8891"
else
    bad "postfix не может подключиться к opendkim:8891 — письма встанут в очередь
        (milter_default_action=tempfail). docker logs lp-opendkim"
fi

# --- 4. Ключевые директивы не разъехались -----------------------------------
#
# Не сравниваем postconf -n целиком с эталоном: он меняется от версии к
# версии, и такое сравнение начинает врать через полгода. Проверяем ровно те
# строки, неверное значение которых что-то ЛОМАЕТ или что-то ОТКРЫВАЕТ.

check() {   # контейнер, параметр, ожидаемое значение, пояснение зачем
    local c="$1" k="$2" want="$3" why="$4"
    local got
    got=$(docker exec "$c" postconf -h "$k" 2>/dev/null | tr '\n' ' ' | tr -s ' ' | sed 's/ $//')
    want=$(echo "$want" | tr -s ' ')
    if [ "$got" = "$want" ]; then
        ok "$c: $k = ${got:-<пусто>}"
    else
        bad "$c: $k = «${got:-<пусто>}», ожидалось «${want:-<пусто>}». $why"
    fi
}

# Для многострочных списков ограничений сверять целиком бессмысленно: порядок
# и состав меняются осмысленно, а вот ПРОПАЖА конкретного правила — всегда
# беда. Поэтому «содержит», а не «равно».
check_has() {   # контейнер, параметр, обязательная подстрока, пояснение зачем
    local c="$1" k="$2" need="$3" why="$4"
    local got
    got=$(docker exec "$c" postconf -h "$k" 2>/dev/null | tr '\n' ' ' | tr -s ' ')
    if echo "$got" | grep -qF -- "$need"; then
        ok "$c: $k содержит «$need»"
    else
        bad "$c: в $k = «${got:-<пусто>}» НЕТ «$need». $why"
    fi
}

log "Отправитель (lp-postfix, роль out)"
check lp-postfix myhostname "$DOMAIN" \
    "Это имя в HELO. Именно его видел Gmail, когда принимал письма с первой попытки."
check lp-postfix smtpd_relay_restrictions "permit_mynetworks, reject_unauth_destination" \
    "ПУСТОЕ значение делает открытый релей одной строкой."
check lp-postfix mydestination "" \
    "Непустое значение включает локальную доставку, которой у нас нет."
check lp-postfix relay_domains "" \
    "Непустое значение делает нас чужим резервным MX."
check lp-postfix mynetworks_style host \
    "Стиль subnet считает своей всю подсеть интерфейса — /24 соседей по хостингу."
check lp-postfix smtpd_milters "inet:opendkim:8891" \
    "Без милтера письма уходят БЕЗ ПОДПИСИ и ложатся в спам молча."
check lp-postfix milter_default_action tempfail \
    "accept означает: opendkim упал — письма ушли неподписанными и никто не заметил."
check lp-postfix smtpd_authorized_xclient_hosts "" \
    "Непустое значение позволяет клиенту объявить себя другим IP и обнулить все защиты."
check_has lp-postfix smtpd_sender_restrictions "check_sender_access" \
    "Без неё любой, кто попал в сеть compose (шлюз docker на хосте тоже в 172.16/12),
        отправляет через нас от ЛЮБОГО отправителя куда угодно."
check_has lp-postfix smtpd_recipient_restrictions "reject_non_fqdn_recipient" \
    "Без неё адрес-литерал foo@[127.0.0.1] принимается как «свой» и превращается в отлуп."
check lp-postfix local_recipient_maps "hash:/etc/postfix/local_recipients" \
    "ПУСТОЕ значение здесь означает не «локальных получателей нет», а
        «принимать ЛЮБОГО локального получателя» — включая foo@[127.0.0.1]."
check lp-postfix smtpd_discard_ehlo_keywords "silent-discard, dsn" \
    "Пустое значение включает DSN: NOTIFY=SUCCESS + RET=FULL заставляют postfix
        отправить письмо с чужим текстом на адрес, названный отправителем."

# Домен отправителя обязан совпадать с тем, что разрешает smtpd_sender_restrictions.
# Не совпадёт — API получит 554 на КАЖДОЕ письмо, и это первое, что стоит
# проверить после правки .env.production.
if [ -f .env.production ]; then
    from_line=$(grep -E '^SMTP_FROM=' .env.production | head -1 | cut -d= -f2-)
    from_domain=$(echo "$from_line" | sed -n 's/.*@\([A-Za-z0-9._-]*\).*/\1/p')
    if [ -z "$from_domain" ]; then
        warn "SMTP_FROM в .env.production не разобран ($from_line) — проверь адрес глазами"
    elif [ "$from_domain" = "$DOMAIN" ]; then
        ok "SMTP_FROM указывает на @$from_domain — отправитель разрешён"
    else
        bad "SMTP_FROM = @$from_domain, а разрешён только @$DOMAIN.
        Каждое письмо платформы получит 554 Access denied на MAIL FROM."
    fi
fi

log "Приёмник (lp-postfix-mx, роль mx)"
check lp-postfix-mx mynetworks "127.0.0.0/8" \
    "ЛЮБАЯ подсеть docker здесь = открытый релей: входящее соединение приходит
        с адреса шлюза docker-сети."
check lp-postfix-mx smtpd_relay_restrictions "permit_sasl_authenticated, reject_unauth_destination" \
    "Единственное, что мешает публичному порту стать открытым релеем."
check lp-postfix-mx mydestination "" \
    "Локальных ящиков нет и быть не должно."
check lp-postfix-mx relay_domains "" \
    "Мы никому не резервный MX."
check lp-postfix-mx virtual_alias_domains "$DOMAIN" \
    "Без этого письма на наши адреса отвергаются как чужие."
check lp-postfix-mx smtpd_sasl_auth_enable no \
    "AUTH на порту 25 — это то, что можно подобрать и чем можно открыть релей."
check lp-postfix-mx allow_percent_hack no \
    "user%gmail.com@$DOMAIN обходит reject_unauth_destination."
check lp-postfix-mx allow_untrusted_routing no \
    "user@remote@$DOMAIN обходит reject_unauth_destination."
check lp-postfix-mx swap_bangpath no \
    "gmail.com!user@$DOMAIN обходит reject_unauth_destination."
check lp-postfix-mx smtpd_authorized_xclient_hosts "" \
    "Непустое значение позволяет клиенту назваться своим."
check lp-postfix-mx soft_bounce no \
    "yes превращает все отказы 5xx во временные — мусор возвращается вечно."
check lp-postfix-mx local_recipient_maps "hash:/etc/postfix/local_recipients" \
    "ПУСТОЕ значение = «принимать любого локального получателя». Локальный класс
        при inet_interfaces=all включает адреса интерфейсов в квадратных скобках,
        то есть RCPT TO:<foo@[127.0.0.1]> принимался бы кодом 250 и возвращался
        отлупом с телом письма на подделанный адрес отправителя."
# Карта обязана быть ПУСТОЙ по содержимому: одна запись здесь — это локальный
# ящик, которого в системе нет, то есть письмо, которое некому доставить.
lr=$(docker exec lp-postfix-mx sh -c 'grep -cvE "^[[:space:]]*(#|$)" /etc/postfix/local_recipients' 2>/dev/null | tr -d '[:space:]')
if [ "${lr:-0}" = "0" ]; then
    ok "карта локальных получателей пуста — не находится никто"
else
    bad "в /etc/postfix/local_recipients ${lr} записей. Локальных ящиков в этой
        системе нет; каждая запись — принятое письмо, которое некуда доставить."
fi
check_has lp-postfix-mx smtpd_recipient_restrictions "reject_non_fqdn_recipient" \
    "Без неё RCPT TO:<foo@[127.0.0.1]> проходит как «наш» адрес (при inet_interfaces=all
        адреса интерфейсов входят в локальный класс), принимается в очередь и
        превращается в ОТЛУП на подделанный адрес отправителя."
check lp-postfix-mx smtpd_discard_ehlo_keywords "silent-discard, dsn" \
    "Пустое значение включает DSN. MAIL FROM:<жертва> RET=FULL + RCPT TO:<support@>
        NOTIFY=SUCCESS = доставка чужого текста произвольному адресату с нашего IP,
        и это НЕ ловится ни одной проверкой релея."
check lp-postfix-mx sender_canonical_classes "envelope_sender" \
    "Умолчание «envelope_sender, header_sender» переписало бы заголовок From и
        сломало исходную подпись DKIM — ровно то, ради чего приёмник не трогает письма."
check lp-postfix-mx smtp_destination_concurrency_limit 2 \
    "Умолчание 20: двадцать параллельных сессий к Google с одного IP = 421 4.7.28
        и растущая очередь."

# Переписывание конверта: без него отлуп от Gmail уходит на подделанный адрес
# отправителя, с нашего IP и через наш SPF. Проверяем обе стороны правила.
log "Переписывание конверта при пересылке"
rw_foreign=$(docker exec lp-postfix-mx postmap -q 'probe@example.org' \
    regexp:/etc/postfix/sender_canonical 2>/dev/null || true)
rw_own=$(docker exec lp-postfix-mx postmap -q "postmaster@${DOMAIN}" \
    regexp:/etc/postfix/sender_canonical 2>/dev/null || true)
if [ "$rw_foreign" = "forward@${DOMAIN}" ]; then
    ok "чужой отправитель переписывается в forward@${DOMAIN} — отлуп вернётся нам"
else
    bad "чужой отправитель НЕ переписывается (получено «${rw_foreign:-<пусто>}»):
        отлуп от Gmail уйдёт на адрес из конверта, а он у ботов подделан.
        Это backscatter с нашего IP — прямая дорога в Backscatterer.org."
fi
if [ "$rw_own" = "postmaster@${DOMAIN}" ]; then
    ok "свои адреса не трогаются"
else
    bad "наш собственный адрес переписывается в «${rw_own:-<пусто>}» — проверь
        /etc/postfix/sender_canonical, первая строка шаблона."
fi

# --- 5. Карта адресов -------------------------------------------------------

log "Принимаемые адреса"
if docker exec lp-postfix-mx cat /etc/postfix/virtual 2>/dev/null | grep -vE '^\s*(#|$)' | sed 's/^/    /'; then
    # forward@ — не для людей: на него возвращаются отлупы от Gmail после
    # переписывания конверта. Его отсутствие означает, что об отлупе никто
    # не узнает: он превратится в двойной отлуп и будет отброшен молча.
    for addr in support dmarc postmaster abuse forward; do
        if docker exec lp-postfix-mx postmap -q "${addr}@${DOMAIN}" hash:/etc/postfix/virtual >/dev/null 2>&1; then
            ok "${addr}@${DOMAIN} на месте"
        else
            bad "${addr}@${DOMAIN} НЕ разрешается картой — письма на него получат 550"
        fi
    done
    # Ловушка «всё подряд» — ровно то, чего ждут переборщики адресов.
    if docker exec lp-postfix-mx postmap -q "@${DOMAIN}" hash:/etc/postfix/virtual >/dev/null 2>&1; then
        bad "в карте есть catch-all @${DOMAIN} — уберите, он собирает весь перебор"
    else
        ok "catch-all отсутствует, как и задумано"
    fi
else
    bad "карта /etc/postfix/virtual не читается"
fi

# --- 6. Очереди -------------------------------------------------------------
#
# Непустая очередь — не всегда беда (письмо может ждать минуту), но растущая
# очередь у ОТПРАВИТЕЛЯ почти всегда означает недоступный opendkim.

log "Очереди"
for c in lp-postfix lp-postfix-mx; do
    q=$(docker exec "$c" postqueue -p 2>/dev/null | tail -1)
    # Число писем, а не только последняя строка: «очередь непуста» может
    # означать и одно письмо, ждущее минуту, и три тысячи, съедающие раздел.
    # tr убирает пробелы: wc в некоторых сборках выравнивает число по ширине,
    # а « 12» в арифметическом сравнении ниже — это уже не число.
    n=$(docker exec "$c" sh -c 'find /var/spool/postfix/deferred /var/spool/postfix/active \
        /var/spool/postfix/incoming -type f 2>/dev/null | wc -l' 2>/dev/null \
        | tr -d '[:space:]')
    [ -n "$n" ] || n=0
    case "$q" in
        *"Mail queue is empty"*) ok "$c: очередь пуста" ;;
        "")                      warn "$c: postqueue ничего не ответил" ;;
        *)
            if [ "${n:-0}" -ge 100 ]; then
                # 100 писем по 10 МБ — это гигабайт на том же разделе, где
                # данные Postgres и объекты S3. Дальше растёт само.
                bad "$c: в очереди $n писем ($q). Смотри postqueue -p целиком:
        у отправителя это почти всегда недоступный opendkim, у приёмника —
        придержанная Google пересылка."
            else
                warn "$c: $n писем в очереди ($q) — если это не разовое, смотри postqueue -p"
            fi
            ;;
    esac
done

# Место на разделе, где лежат тома docker. Очередь приёмника ограничена
# сверху только им; queue_minfree = 1 ГБ останавливает приём раньше, чем
# Postgres перестанет писать WAL, но узнать об этом лучше здесь.
free_mb=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$free_mb" ]; then
    if [ "$free_mb" -lt 2048 ]; then
        bad "на разделе с томами docker свободно ${free_mb} МБ. При падении ниже 1 ГБ
        приёмник перестанет принимать почту (queue_minfree), а Postgres — писать WAL."
    else
        ok "на разделе с томами docker свободно ${free_mb} МБ"
    fi
else
    warn "не удалось узнать свободное место на /var/lib/docker"
fi

# --- 7. Записи DNS ----------------------------------------------------------
#
# Не «правильные ли они», а «какие они сейчас»: сверять глазами дешевле, чем
# кодировать ожидания, которые устареют при первом переезде.

log "DNS (для сверки глазами)"
if command -v dig >/dev/null 2>&1; then
    echo "  MX     $(dig +short "$DOMAIN" MX | tr '\n' ' ')"
    echo "  A(mx)  $(dig +short "mail.$DOMAIN" A | tr '\n' ' ')"
    echo "  SPF    $(dig +short "$DOMAIN" TXT | grep -i 'v=spf1' || echo '—')"
    echo "  DKIM   $(dig +short "${SELECTOR}._domainkey.$DOMAIN" TXT | head -c 120)..."
    echo "  DMARC  $(dig +short "_dmarc.$DOMAIN" TXT || echo '—')"
else
    warn "dig не установлен (apt-get install -y dnsutils) — записи не показаны"
fi

# --- Итог -------------------------------------------------------------------

echo ""
if [ "$FAILED" -eq 0 ]; then
    echo -e "\033[32m=== Проверки на сервере пройдены ===\033[0m"
else
    echo -e "\033[31m=== Провалено проверок: $FAILED ===\033[0m"
fi

cat <<'OUTSIDE'

  ---------------------------------------------------------------------------
  ЭТОГО НЕДОСТАТОЧНО. Защиту от открытого релея проверяют ТОЛЬКО С ЧУЖОЙ
  МАШИНЫ: отсюда соединение придёт с адреса, который может оказаться «своим»,
  и вы проверите permit_mynetworks вместо защиты.

    swaks --server mail.pxcheats.com --from probe@example.org --to проверка@gmail.com
    #  ждём на RCPT TO: 554 5.7.1 ... Relay access denied

    swaks --server mail.pxcheats.com --from "" --to проверка@gmail.com
    #  ждём: тот же 554

    swaks --server mail.pxcheats.com --from probe@example.org \
          --to 'проверка%gmail.com@pxcheats.com'
    #  ждём: 550 User unknown in virtual alias table

    swaks --server mail.pxcheats.com --to 'проверка@gmail.com@pxcheats.com'
    swaks --server mail.pxcheats.com --to '@pxcheats.com:проверка@gmail.com'
    swaks --server mail.pxcheats.com --to 'gmail.com!проверка@pxcheats.com'
    #  ждём: отказ на каждый

    swaks --server mail.pxcheats.com --to нет-такого-адреса@pxcheats.com
    #  ждём: 550 ... User unknown ИМЕННО НА RCPT, а не отлуп письмом

  ЭТИХ ДВУХ ПРОВЕРОК ЗДЕСЬ РАНЬШЕ НЕ БЫЛО, И ИМЕННО ОНИ ЛОВЯТ ТО, ЧТО
  «ПРОВЕРКОЙ РЕЛЕЯ» НЕ ЛОВИТСЯ ВОВСЕ: получатель в обоих случаях НАШ, релея
  нет, а письмо постороннему человеку всё равно уходит.

    swaks --server mail.pxcheats.com --from probe@example.org \
          --to 'foo@[127.0.0.1]'
    #  ждём: 5xx НА RCPT (reject_non_fqdn_recipient).
    #  250 здесь означает: письмо принято в очередь, ушло в local(8), где
    #  нет ни ящиков, ни алиасов, и вернулось ОТЛУПОМ на адрес из --from.

    printf 'EHLO probe.example.org\r\nQUIT\r\n' | nc mail.pxcheats.com 25
    #  ждём: в списке расширений НЕТ строки «250-DSN».
    #  Если она есть — проверь руками, дословно (ответы после каждой строки):
    #      EHLO probe.example.org
    #      MAIL FROM:<жертва@example.com> RET=FULL       → ждём 5xx
    #      RCPT TO:<support@pxcheats.com> NOTIFY=SUCCESS → ждём 5xx
    #  250 на эти две строки означает работающий канал рассылки: письмо
    #  принимается на support@ (адрес наш, релея нет, все проверки выше
    #  проходят), пересылается на Gmail, а postfix сам сочиняет уведомление
    #  «relayed» и отправляет его с нашего IP на адрес из MAIL FROM —
    #  с текстом письма внутри, если был RET=FULL.
    #  Если DSN есть, работает вот что: письмо принимается на support@ (адрес
    #  наш, релея нет, все проверки выше проходят), пересылается на Gmail, а
    #  postfix сам сочиняет уведомление «relayed» и отправляет его с нашего
    #  IP на адрес из MAIL FROM — вместе с текстом письма при RET=FULL.
  ---------------------------------------------------------------------------
OUTSIDE

# Код возврата, а не только текст: deploy.sh отличает «прошло» от «не прошло»
# именно по нему.
[ "$FAILED" -eq 0 ] || exit 1
exit 0
