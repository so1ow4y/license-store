#!/usr/bin/env bash
# ============================================================================
#  Развёртывание на сервер. Запускается С РАБОЧЕЙ МАШИНЫ (git-bash подойдёт).
#
#    scripts/deploy.sh <IP-или-домен> <домен-для-сертификата> [почта-для-Let's-Encrypt]
#
#  Пример:
#    scripts/deploy.sh 203.0.113.7 lic.example.com admin@example.com
#
#  Что делает по шагам:
#    1. копирует исходники (без node_modules, .git, копий и .env разработки)
#    2. копирует .env.production ОТДЕЛЬНО, с правами 600
#    3. собирает образ на сервере
#    4. поднимает инфраструктуру, ждёт готовности базы
#    5. применяет миграции и сид
#    6. выпускает сертификат Let's Encrypt и включает HTTPS
#    7. проверяет, что живое
#
#  Пароль сервера скрипт не спрашивает и никуда не пишет: аутентификацию
#  делает ssh как обычно — по ключу или по паролю, который ты вводишь сам.
# ============================================================================

set -euo pipefail

HOST="${1:-}"
DOMAIN="${2:-}"
EMAIL="${3:-}"
USER_="${DEPLOY_USER:-root}"
APP_DIR="${APP_DIR:-/opt/license-platform}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { echo -e "\n\033[36m=== $* ===\033[0m"; }
ok()   { echo "  [ok] $*"; }
warn() { echo -e "\033[33m  [?] $*\033[0m"; }
die()  { echo -e "\033[31mОШИБКА: $*\033[0m" >&2; exit 1; }

[ -n "$HOST" ]   || die "укажи адрес сервера: scripts/deploy.sh <IP> <домен> [почта]"
[ -n "$DOMAIN" ] || DOMAIN="$HOST"
[ -n "$EMAIL" ]  || EMAIL="admin@$DOMAIN"

# Режим без домена. Отличается тремя вещами: подключается временный
# override-файл, сертификат не выпускается (Let's Encrypt на IP не выдаёт),
# и открываются порты хранилища — иначе presigned-ссылки на загрузку
# не откроются ни у кого, кроме самого сервера.
if echo "$DOMAIN" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    IP_MODE=1
    COMPOSE="-f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.iptest.yml"
else
    IP_MODE=0
    COMPOSE="-f docker-compose.yml -f docker-compose.prod.yml"
fi

# Почтовая ловушка в боевом окружении — временно, пока не выбран настоящий
# отправитель. Признак берётся из самих настроек, а не из отдельного флага:
# так режим невозможно забыть выключить — он отпадёт сам в ту минуту, когда
# SMTP_HOST перестанет быть «mailpit». Без этого переезд на домен тихо ломает
# регистрацию: боевой файл гасит mailpit, и письма перестают уходить куда-либо.
MAILTRAP=0
OWN_MAIL=0
# Ставится в 1, если scripts/mail-check.sh не прошёл. Печатается в самом конце
# и меняет код возврата: жёлтая строка в середине вывода теряется, а «Готово»
# с кодом 0 при мёртвой отправке — это ложь, на которую потом ссылаются.
MAIL_FAILED=0
if grep -qE '^SMTP_HOST=mailpit\s*$' "$ROOT/.env.production" 2>/dev/null; then
    MAILTRAP=1
    COMPOSE="$COMPOSE -f docker-compose.mailtrap.yml"
elif grep -qE '^SMTP_HOST=postfix\s*$' "$ROOT/.env.production" 2>/dev/null; then
    # Свой почтовый сервер: отправитель, приёмник и подписант. Профиль
    # включается по той же настройке, что и сам транспорт: два независимых
    # переключателя рано или поздно разъедутся, и API будет слать письма
    # сервису, который не запущен.
    OWN_MAIL=1
    COMPOSE="$COMPOSE --profile mail"
fi

[ -f "$ROOT/.env.production" ] || die "нет .env.production — создай его: scripts/gen-secrets.ps1 -Domain $DOMAIN"

# --- Сверка .env.production со схемой ----------------------------------------
#
# ЗАЧЕМ. Генератор секретов и env.schema.ts — два независимых списка одних и
# тех же переменных, и ничто не заставляло их совпадать. Однажды они разошлись:
# в схему добавился FRONTEND_URL, в генератор — нет. Обнаружилось это ПОСЛЕ
# шестиминутной сборки, в виде бесконечного цикла перезапуска контейнера, где
# настоящая причина видна только в логах. Проверка занимает миллисекунды и
# ловит весь класс таких расхождений, а не один конкретный случай.
#
# Источник истины — сама схема, поэтому список не дублируется здесь руками:
# он вычитывается из файла. Обязательной считается переменная, в объявлении
# которой нет ни .optional(), ни .default() — ровно то же правило, по которому
# судит zod.
SCHEMA="$ROOT/apps/api/src/common/config/env.schema.ts"
if [ -f "$SCHEMA" ]; then
    missing=""
    # Объявление может занимать несколько строк, поэтому запись собирается
    # целиком: от «ИМЯ:» до следующего «ИМЯ:». Иначе .optional() на отдельной
    # строке не виден, и переменная ошибочно считается обязательной.
    required="$(awk '
        /^[ \t]+[A-Z][A-Z0-9_]*:[ \t]*(z|hex32|boolFromEnv)/ {
            if (name != "") emit()
            name = $1; sub(/:$/, "", name); body = $0; next
        }
        name != "" { body = body $0 }
        END { if (name != "") emit() }
        function emit() {
            if (body !~ /optional\(/ && body !~ /default\(/) print name
            name = ""; body = ""
        }
    ' "$SCHEMA" | sort -u)"

    for key in $required; do
        # Пусто и отсутствует — одно и то же: zod отвергает и то, и другое.
        grep -qE "^${key}=.+" "$ROOT/.env.production" || missing="$missing $key"
    done

    if [ -n "$missing" ]; then
        echo -e "\033[31mОШИБКА: в .env.production нет обязательных переменных:\033[0m" >&2
        for key in $missing; do echo "    $key" >&2; done
        echo "" >&2
        echo "  Их требует apps/api/src/common/config/env.schema.ts — без них" >&2
        echo "  API не стартует вовсе и уйдёт в цикл перезапуска." >&2
        echo "  Допиши значения руками либо перевыпусти файл генератором." >&2
        exit 1
    fi
    ok "переменные окружения сходятся со схемой"
fi

# Проверка до всего остального: пустой SMTP означает, что письма не уйдут,
# и человек не подтвердит почту при регистрации. Лучше узнать сейчас.
if ! grep -qE '^SMTP_HOST=.+' "$ROOT/.env.production"; then
    echo -e "\033[33m  ВНИМАНИЕ: SMTP_HOST пуст — письма уходить не будут.\033[0m"
    echo -e "\033[33m  Регистрация без подтверждения почты не завершится.\033[0m"
    read -rp "  Продолжить всё равно? [y/N] " a
    [ "$a" = "y" ] || exit 1
fi

# --- Проверки собственного почтового сервера ---------------------------------
#
# Всё это ловится ЗДЕСЬ, а не в контейнере, по одной причине: ошибка в
# контейнере видна только тому, кто догадается посмотреть `docker logs` после
# того, как деплой отчитается об успехе. Почта — редко используемая часть, и
# «оно вроде поднялось» здесь означает «узнаем через неделю от клиента».
if [ "$OWN_MAIL" = "1" ]; then
    # Куда пересылать support@ и dmarc@. Без адреса контейнер приёмника
    # откажется стартовать — пусть лучше об этом скажет скрипт до выкладки.
    grep -qE '^MAIL_FORWARD_TO=.+' "$ROOT/.env.production" \
        || die "нет MAIL_FORWARD_TO в .env.production — некуда пересылать почту домена.
  Допиши, например: MAIL_FORWARD_TO=kotenkovgrigorij64@gmail.com"

    # Закрытый ключ подписи. Без него opendkim не поднимется, а без opendkim
    # (milter_default_action=tempfail) не уйдёт НИ ОДНО письмо платформы.
    [ -f "$ROOT/.secrets/dkim-private.pem" ] \
        || die "нет .secrets/dkim-private.pem — подписывать письма нечем.
  Открытая часть уже опубликована в DNS (mail._domainkey), новый ключ
  генерировать НЕЛЬЗЯ: подпись перестанет проверяться."

    # Заряженное ружьё: mail.service.ts включает подпись в nodemailer, когда
    # заданы ВСЕ три переменные. Подписывает opendkim — и если nodemailer
    # начнёт подписывать тоже, на письме окажутся ДВЕ подписи одного
    # селектора, из которых проверится одна. Внешне это «письма опять
    # в спаме», без единой ошибки в журналах.
    if grep -qE '^DKIM_DOMAIN=.+' "$ROOT/.env.production" \
       && grep -qE '^DKIM_SELECTOR=.+' "$ROOT/.env.production" \
       && grep -qE '^DKIM_PRIVATE_KEY=.+' "$ROOT/.env.production"; then
        die "в .env.production заданы DKIM_DOMAIN, DKIM_SELECTOR и DKIM_PRIVATE_KEY разом.
  Подписывает opendkim; nodemailer поставит ВТОРУЮ подпись тем же селектором.
  Закомментируй DKIM_DOMAIN и DKIM_SELECTOR (ключ живёт в .secrets/)."
    fi

    ok "почтовый сервер: настройки на месте"
fi

SSH="ssh -o StrictHostKeyChecking=accept-new $USER_@$HOST"

log "Проверка связи с $HOST"
$SSH "echo ok" >/dev/null || die "не подключиться. Проверь IP и что сервер выдан"
$SSH "command -v docker >/dev/null" || die "docker не установлен. Сначала: ssh $USER_@$HOST 'bash -s' < scripts/server-setup.sh"
ok "сервер отвечает, docker на месте"

# --- 1. Исходники -----------------------------------------------------------
#
# rsync, а не scp: он переносит только изменившееся, и повторный деплой
# занимает секунды вместо минут.

# --- 0. Фронтенд ------------------------------------------------------------
#
# Собирается ЛОКАЛЬНО, а не на сервере: у сервера одно ядро и 2 ГБ, установка
# зависимостей фронта заняла бы там больше, чем вся остальная выкладка вместе
# взятая. На сервер уезжает только готовая статика, её раздаёт nginx.
#
# dist попадает в rsync намеренно — исключение сужено до apps/api/dist,
# потому что серверный dist всё равно собирается внутри образа.

if [ -f "$ROOT/apps/web/package.json" ]; then
    log "Сборка фронтенда"
    if [ ! -d "$ROOT/apps/web/node_modules" ]; then
        echo "  зависимости не установлены, ставлю"
        (cd "$ROOT/apps/web" && npm install --no-audit --no-fund) || die "npm install фронтенда не прошёл"
    fi
    (cd "$ROOT/apps/web" && npm run build) || die "сборка фронтенда не прошла"
    [ -f "$ROOT/apps/web/dist/index.html" ] || die "сборка прошла, но dist/index.html нет"
    ok "фронтенд собран"
fi

log "Копирование исходников"
if command -v rsync >/dev/null 2>&1; then
    rsync -az --delete \
        --exclude '.git' --exclude 'node_modules' --exclude 'apps/api/dist' \
        --exclude 'backups' --exclude '.env' --exclude '.env.production' \
        --exclude 'coverage' --exclude '*.log' --exclude '.secrets' \
        --exclude 'docker/nginx/certs' --exclude 'docker/nginx/letsencrypt' \
        -e "ssh -o StrictHostKeyChecking=accept-new" \
        "$ROOT/" "$USER_@$HOST:$APP_DIR/"
else
    # Запасной путь для машин без rsync: архивом через трубу, без временных
    # файлов на диске.
    tar czf - -C "$ROOT" \
        --exclude='.git' --exclude='node_modules' --exclude='apps/api/dist' \
        --exclude='backups' --exclude='.env' --exclude='.env.production' \
        --exclude='coverage' --exclude='.secrets' --exclude='docker/nginx/certs' \
        --exclude='docker/nginx/letsencrypt' . \
        | $SSH "mkdir -p $APP_DIR && tar xzf - -C $APP_DIR"
fi
ok "исходники на сервере"

# Права на исполнение. Windows бита +x не хранит вовсе, и файлы приезжают
# как 0644. Для entrypoint-скриптов nginx это тихая поломка: его собственный
# docker-entrypoint.sh пропускает неисполняемые файлы со строкой
# «Ignoring ..., not executable» в логе — то есть без ошибки и без падения.
# В результате 25-tls-optional не выключает HTTPS без сертификата, а
# 16-resolve-upstream не разрешает имя апстрима, и nginx падает на конфиге,
# который лично мы не писали. Ставится здесь, а не в образе: файлы
# подключены томом с хоста, и режим берётся с хоста же.
$SSH "chmod +x $APP_DIR/docker/nginx/entrypoint.d/*.envsh $APP_DIR/scripts/*.sh 2>/dev/null || true"
ok "скрипты помечены исполняемыми"

# --- 2. Секреты -------------------------------------------------------------
#
# Отдельным шагом и с правами 600: в общий rsync .env.production намеренно
# не попадает, чтобы случайная правка списка исключений не разложила ключи
# по резервным копиям и образам.

log "Секреты"
$SSH "cat > $APP_DIR/.env.production && chmod 600 $APP_DIR/.env.production" < "$ROOT/.env.production"

# Закрытый ключ подписи писем. Копируется ОТДЕЛЬНО и с правами 600, как и
# .env.production: в общий rsync каталог .secrets намеренно не попадает,
# чтобы случайная правка списка исключений не разложила ключи по резервным
# копиям и образам.
#
# Файлом, а не только переменной окружения, потому что подписывает opendkim
# внутри контейнера postfix, а он читает ключ с диска. Свой ключ образ
# генерирует сам при каждом пересоздании — и запись в DNS ломалась бы после
# каждой выкладки, поэтому подсовываем постоянный.
if [ -f "$ROOT/.secrets/dkim-private.pem" ]; then
    $SSH "mkdir -p $APP_DIR/.secrets && cat > $APP_DIR/.secrets/dkim-private.pem && chmod 600 $APP_DIR/.secrets/dkim-private.pem" \
        < "$ROOT/.secrets/dkim-private.pem"
    ok "ключ подписи писем скопирован, права 600"
fi
$SSH "ln -sf $APP_DIR/.env.production $APP_DIR/.env"
ok ".env.production скопирован, права 600"

# --- 3. Сборка --------------------------------------------------------------

log "Сборка образа на сервере"
echo "  на одном ядре это 3-6 минут, наберись терпения"
$SSH "cd $APP_DIR && docker compose $COMPOSE build api" \
    || die "сборка не удалась"
ok "образ собран"

# Почтовые образы свои и собираются здесь же. Отдельным шагом, потому что
# ошибка в них не должна выглядеть как «не собрался API»: причины и способы
# починки у них совсем разные.
#
# postfix и postfix-mx — ОДИН образ (lp-mail:local) в двух ролях, вторая
# сборка попадает в кеш целиком и стоит секунду.
if [ "$OWN_MAIL" = "1" ]; then
    log "Сборка почтовых образов"
    $SSH "cd $APP_DIR && docker compose $COMPOSE build postfix postfix-mx opendkim" \
        || die "почтовые образы не собрались"
    ok "lp-mail и lp-opendkim собраны"

    # Порт 25 на ВХОД. Правило есть и в server-setup.sh — на случай нового
    # сервера, — но повторяется здесь, потому что server-setup.sh запускается
    # один раз и давно, а `ufw --force reset` в нём стирает всё, что добавили
    # позже. Правило идемпотентно: ufw не заводит дубликатов.
    #
    # ЧЕСТНО ПРО DOCKER И UFW: опубликованный порт контейнера доступен снаружи
    # ДАЖЕ БЕЗ этого правила — docker пишет свои цепочки в iptables мимо ufw.
    # Правило здесь не «открывает» порт, а приводит `ufw status` в
    # соответствие с реальностью: расхождение между ними однажды приведёт к
    # тому, что кто-то «закроет» 25 в ufw, увидит, что почта всё равно идёт,
    # и сделает неверный вывод о том, как в этой системе работает фаервол.
    # Настоящая защита приёмника — в его конфигурации (см. conf/mx/main.cf).
    $SSH "command -v ufw >/dev/null && ufw allow 25/tcp comment 'SMTP MX' >/dev/null 2>&1 || true"
    ok "ufw: 25/tcp разрешён"

    # Достижим ли приёмник снаружи на самом деле. Разрешение в ufw об этом не
    # говорит ничего: решает привязка публикации порта. Печатаем прямо, иначе
    # «ufw: 25/tcp разрешён» выше прочитается как «почта принимается», и
    # владелец будет ждать писем, которые отправителям возвращаются по
    # таймауту.
    if grep -qE '^MAIL_MX_BIND=127\.0\.0\.1\s*$' "$ROOT/.env.production" 2>/dev/null; then
        warn "приёмник поднят НА ПЕТЛЕ: входящая почта снаружи НЕ принимается.
  Так задумано до проверки на открытый релей. Проверить и открыть:
    ssh $USER_@$HOST 'cd $APP_DIR && bash scripts/mail-relay-test.sh'
  затем MAIL_MX_BIND=0.0.0.0 в .env.production и выложить заново."
    fi

    # Порт 587 НЕ открывается автоматически. Он бесполезен, пока не заданы
    # MAIL_SUBMISSION_BIND и MAIL_SUBMISSION_PASSWORD, а открытый порт без
    # службы за ним — это приглашение сканерам.
    if grep -qE '^MAIL_SUBMISSION_BIND=0\.0\.0\.0\s*$' "$ROOT/.env.production" 2>/dev/null; then
        grep -qE '^MAIL_SUBMISSION_PASSWORD=.+' "$ROOT/.env.production" \
            || die "MAIL_SUBMISSION_BIND=0.0.0.0 без MAIL_SUBMISSION_PASSWORD —
  порт 587 откроется, а войти в него будет нельзя ничем. Задай пароль."
        $SSH "command -v ufw >/dev/null && ufw allow 587/tcp comment 'SMTP submission' >/dev/null 2>&1 || true"
        ok "ufw: 587/tcp разрешён (submission включён)"
    fi
fi

# --- 4. Инфраструктура ------------------------------------------------------

log "Запуск базы, кэша и хранилища"
# Сервисы перечисляются поимённо, а не через голый `up -d`: так в бою не
# поднимется случайно то, что включено профилем для разработки.
#
# Почтовая ловушка — исключение, и без неё режим без домена нерабочий.
# Настоящего SMTP на этом этапе нет, а без доставки писем регистрация не
# завершается: пользователь создаётся, но подтвердить почту нечем, и войти
# он не может. docker-compose.iptest.yml её включает, но перечислить её
# здесь всё равно нужно — иначе она просто не запускается, и API пишет в
# журнал «SMTP недоступен: getaddrinfo EAI_AGAIN mailpit».
INFRA="postgres redis s3"
if [ "$MAILTRAP" = "1" ]; then
    INFRA="$INFRA mailpit"
fi
$SSH "cd $APP_DIR && docker compose $COMPOSE up -d $INFRA"

# Почта поднимается ОТДЕЛЬНОЙ командой и с оговоркой «не смертельно».
#
# ПОЧЕМУ НЕ В ОДНОЙ СТРОКЕ С ОСТАЛЬНЫМ. Ошибка в почтовых контейнерах не
# должна обрывать `set -e` на середине деплоя: без миграций, без API, без
# сертификата. Почта важна, но не настолько, чтобы из-за неё откатывать
# платформу.
#
# Зависимость postfix от opendkim теперь service_started, а НЕ service_healthy
# (см. docker-compose.prod.yml). ЧТО К ПРОБЛЕМЕ ВЕЛО: при service_healthy
# любая неудача однострочной проверки здоровья подписанта означала
# «dependency failed to start» — контейнер отправителя не создавался вовсе,
# то есть отправка платформы умирала целиком, а этот блок глушил исход
# жёлтым предупреждением. Теперь непринятое письмо в худшем случае ждёт в
# очереди и повторяется, а не исчезает.
#
# ИТОГ ПО ПОЧТЕ ТЕПЕРЬ ВЛИЯЕТ НА КОД ВОЗВРАТА — см. конец файла.
#
# Порядок в строке роли не играет: opendkim перечислен первым для читаемости,
# а поднимет его раньше сам compose — по depends_on.
if [ "$OWN_MAIL" = "1" ]; then
    if $SSH "cd $APP_DIR && docker compose $COMPOSE up -d opendkim postfix postfix-mx"; then
        ok "почта поднята (отправитель, приёмник, подписант)"
    else
        echo -e "\033[33m  ВНИМАНИЕ: почтовые контейнеры не поднялись.\033[0m"
        echo -e "\033[33m  Письма платформы уходить не будут — регистрация не завершится.\033[0m"
        $SSH "docker logs lp-opendkim --tail 20 2>&1" | sed 's/^/    /' || true
    fi
fi

echo -n "  жду готовности базы"
for i in $(seq 1 60); do
    if $SSH "docker exec lp-postgres pg_isready -U lp -d license_platform" >/dev/null 2>&1; then
        echo ""; ok "база готова"; break
    fi
    echo -n "."; sleep 2
    [ "$i" -eq 60 ] && { echo ""; die "база не поднялась за две минуты"; }
done

# --- 5. Миграции и сид ------------------------------------------------------
#
# Выполняются ОДНОРАЗОВЫМ контейнером из того же образа, а не внутри
# работающего API: так падение миграции не оставляет наполовину поднятый
# сервис, и видно точную причину.

log "Миграции"
$SSH "cd $APP_DIR && docker compose $COMPOSE run --rm --entrypoint sh api -c 'npx prisma migrate deploy'" \
    || die "миграции не применились"
ok "схема актуальна"

log "Сид"
ADMIN_PW=""
[ -f "$ROOT/.admin-password" ] && ADMIN_PW="$(tr -d '\r\n' < "$ROOT/.admin-password")"
# `node dist/seed.js`, а НЕ `npx prisma db seed`: секции `prisma.seed` в
# манифесте нет, поэтому вторая команда завершается нулём, не сделав ничего.
# Сид собирается в образ отдельным шагом, см. apps/api/Dockerfile.
$SSH "cd $APP_DIR && SEED_ADMIN_PASSWORD='$ADMIN_PW' docker compose $COMPOSE run --rm --entrypoint sh -e SEED_ADMIN_PASSWORD api -c 'node dist/seed.js'" \
    || echo "  сид завершился с ошибкой — проверяю базу"

# Проверяем БАЗУ, а не код возврата. Код возврата уже один раз солгал: сид
# вышел с нулём на пустой базе, и деплой поехал дальше. Спрашивать надо у
# того, кто знает правду, — состояние важнее рапорта об успехе.
seeded=$($SSH "docker exec lp-postgres psql -U lp -d license_platform -t -A -c \
    \"SELECT count(*) FROM users\"" 2>/dev/null | tr -d '[:space:]')
if [ "${seeded:-0}" -gt 0 ] 2>/dev/null; then
    ok "начальные данные на месте ($seeded пользователей)"
else
    die "база ПУСТА после сида: войти будет некем. Причина выше."
fi

# --- 6. Сертификат и запуск -------------------------------------------------
#
# Порядок важен: nginx поднимается СНАЧАЛА на голом HTTP, потому что проверка
# владения доменом идёт по нему. Пока сертификата нет, скрипт 25-tls-optional
# сам убирает TLS-конфиг, и nginx стартует без 443.

log "Запуск API и nginx"
$SSH "cd $APP_DIR && docker compose $COMPOSE up -d api nginx"
sleep 5

if [ "$IP_MODE" = "1" ]; then
    log "Сертификат пропущен — режим без домена"
    echo -e "\033[33m  Let's Encrypt не выдаёт сертификаты на IP-адрес.\033[0m"
    echo -e "\033[33m  Всё работает по HTTP, трафик идёт открытым текстом.\033[0m"

    # Хранилище наружу: presigned-ссылки на загрузку открываются в браузере
    # администратора, и без публичного порта они не работают ни у кого.
    # Почтовую ловушку НЕ открываем: в письмах ходят ссылки на сброс пароля
    # и подтверждение почты, и публичный доступ к ним отдаёт чужие аккаунты
    # любому желающему. К ней ходят через туннель SSH, см. вывод в конце.
    $SSH "ufw allow 9000/tcp comment 'S3 — временно, до домена' >/dev/null 2>&1 || true"
    ok "порт 9000 открыт для хранилища"
elif $SSH "cd $APP_DIR && CERTBOT_DOMAIN=$DOMAIN CERTBOT_EMAIL=$EMAIL docker compose $COMPOSE --profile certbot run --rm certbot"; then
    ok "сертификат получен"
    $SSH "cd $APP_DIR && docker compose $COMPOSE up -d --force-recreate nginx"
    ok "HTTPS включён"

    # Автопродление. Let's Encrypt живёт 90 дней, certbot обновляет за 30 до
    # конца; дважды в сутки — рекомендация самого Let's Encrypt, чтобы попытка
    # не пришлась на единственное неудачное окно.
    $SSH "cat > /etc/cron.d/lp-certbot <<'CRON'
0 3,15 * * * root cd $APP_DIR && CERTBOT_DOMAIN=$DOMAIN CERTBOT_EMAIL=$EMAIL docker compose $COMPOSE --profile certbot run --rm certbot >/dev/null 2>&1 && docker compose $COMPOSE exec -T nginx nginx -s reload
CRON"
    ok "автопродление в cron"
else
    echo -e "\033[33m  Сертификат не выпущен. Обычная причина — DNS ещё не разошёлся\033[0m"
    echo -e "\033[33m  или A-запись не указывает на этот сервер. Сайт пока по HTTP.\033[0m"
    echo -e "\033[33m  Повторить позже: ssh $USER_@$HOST 'cd $APP_DIR && CERTBOT_DOMAIN=$DOMAIN CERTBOT_EMAIL=$EMAIL docker compose $COMPOSE --profile certbot run --rm certbot'\033[0m"
fi

# --- 7. Проверка ------------------------------------------------------------

#
# Проверка ЗАКАНЧИВАЕТ деплой отказом, а не строчкой в выводе. Раньше здесь
# просто печатались статусы контейнеров и коды ответов, после чего скрипт
# при любом исходе доходил до «Готово» и печатал инструкции для входа. Так
# полностью нерабочий сервер — API в цикле перезапуска, nginx следом, база
# без единого пользователя — выглядел успешно развёрнутым. Ошибка, о которой
# не сказали вслух, стоит дороже ошибки: её ищут не там.

log "Проверка"
sleep 3
$SSH "cd $APP_DIR && docker compose $COMPOSE ps --format 'table {{.Name}}\t{{.Status}}'"

echo ""
#
# Схема не фиксируется заранее: в режиме без домена работает только HTTP, а в
# доменном сертификат мог и не выпуститься — тогда сайт тоже на HTTP, и это
# не повод объявлять деплой провалившимся. Поэтому пробуем оба и запоминаем
# тот, который ответил.
if [ "$IP_MODE" = "1" ]; then PROBES="http"; else PROBES="https http"; fi

echo -n "  жду ответа API"
health=""
LIVE_URL=""
for i in $(seq 1 30); do
    for s in $PROBES; do
        code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$s://$DOMAIN/health/live" 2>/dev/null || echo 000)
        if [ "$code" = "200" ]; then health="$code"; LIVE_URL="$s://$DOMAIN"; break; fi
    done
    [ -n "$health" ] && { echo ""; ok "API отвечает 200 на $LIVE_URL"; break; }
    echo -n "."; sleep 2
done

if [ -z "$health" ]; then
    echo ""
    echo -e "\033[31mОШИБКА: API не отвечает на $DOMAIN/health/live (ни по HTTP, ни по HTTPS)\033[0m" >&2
    echo "" >&2
    echo "  Последние строки журнала API:" >&2
    $SSH "docker logs lp-api --tail 25 2>&1" | sed 's/^/    /' >&2
    echo "" >&2
    echo "  Последние строки журнала nginx:" >&2
    $SSH "docker logs lp-nginx --tail 10 2>&1" | sed 's/^/    /' >&2
    die "развёртывание НЕ завершено. Сервер не работает."
fi

# Живой ответ ещё не значит рабочую систему: /health/live отвечает и когда
# база недоступна. /health/ready проверяет зависимости.
ready=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$LIVE_URL/health/ready" 2>/dev/null || echo 000)
if [ "$ready" = "200" ]; then
    ok "зависимости в порядке (база, кэш, хранилище)"
else
    echo -e "\033[33m  ВНИМАНИЕ: /health/ready вернул $ready — что-то из зависимостей не отвечает.\033[0m"
    $SSH "curl -s --max-time 10 http://127.0.0.1/health/ready" 2>/dev/null | sed 's/^/    /' || true
fi

# --- Почта ------------------------------------------------------------------
#
# Отдельная проверка, потому что почта — часть, которую замечают последней.
# API отвечает 200 и с мёртвым postfix: письма просто копятся в таблице
# notifications со статусом PENDING, и узнают об этом от клиента, который
# не смог зарегистрироваться.
if [ "$OWN_MAIL" = "1" ]; then
    log "Проверка почты"
    # Скрипт лежит рядом и уже приехал на сервер общим rsync. Он же
    # запускается вручную после любой правки почтовой конфигурации.
    if $SSH "cd $APP_DIR && bash scripts/mail-check.sh"; then
        ok "почтовый сервер проверен"
    else
        # НЕ die: остальная система работает, и разворачивать её обратно
        # из-за почты неправильно. Но и молчать нельзя.
        #
        # ЧТО К ПРОБЛЕМЕ ВЕЛО: раньше здесь всё и заканчивалось — жёлтая
        # строка посреди вывода, а через полсотни строк бодрое «Готово» и
        # код возврата 0. Провал почты выглядел как успешная выкладка, хотя
        # означать он может в том числе «отправка мертва полностью».
        MAIL_FAILED=1
        echo -e "\033[33m  ВНИМАНИЕ: проверки почты не прошли — см. вывод выше.\033[0m"
        echo -e "\033[33m  Отправка и приём писем сейчас под вопросом.\033[0m"
        echo -e "\033[33m  Повторить: ssh $USER_@$HOST 'cd $APP_DIR && bash scripts/mail-check.sh'\033[0m"
    fi
fi

# --- Бэкапы -----------------------------------------------------------------

log "Резервное копирование"
$SSH "chmod +x $APP_DIR/scripts/backup.sh $APP_DIR/scripts/restore-check.sh 2>/dev/null || true"
echo "  Скрипт на месте, но НЕ в расписании: ему нужен BACKUP_PASSPHRASE,"
echo "  а придумать и сохранить его должен человек. Поставь так:"
echo ""
echo "    ssh $USER_@$HOST"
echo "    echo '0 4 * * * root BACKUP_PASSPHRASE=\"ПРИДУМАЙ\" $APP_DIR/scripts/backup.sh >> /var/log/lp-backup.log 2>&1' > /etc/cron.d/lp-backup"
echo ""

log "Готово"

if [ "$IP_MODE" = "1" ]; then
    SCHEME="http"
else
    SCHEME="https"
fi

# /docs в бою НЕ поднимается: main.ts заводит Swagger только при isDev.
# Это осознанно — полная карта эндпоинтов со схемами тел запросов упрощает
# работу не только своему фронтенду. Раньше адрес печатался безусловно, и
# по нему отдавался 404: сообщение обещало то, чего в этом режиме нет.
echo "  Описание API:  только в разработке (Swagger отключён в бою)"
echo "  Проверка:      $SCHEME://$DOMAIN/health/live"
echo "  Админ:         логин admin, пароль из gen-secrets.ps1"
echo ""
echo "  Первым делом включи 2FA: без неё административные действия"
echo "  отдают TWO_FACTOR_SETUP_REQUIRED — это не поломка, так задумано."

if [ "$IP_MODE" = "1" ]; then
    echo ""
    echo "  Письма ловит mailpit. Наружу он НЕ открыт намеренно: в письмах"
    echo "  ходят ссылки на подтверждение почты и сброс пароля, и публичный"
    echo "  доступ к ним отдал бы чужие аккаунты любому желающему."
    echo "  Смотреть через туннель — выполни у себя:"
    echo ""
    echo "    ssh -L 8025:localhost:8025 $USER_@$HOST"
    echo ""
    echo "  и открой http://localhost:8025 в браузере, не закрывая это окно."
    echo ""
    echo -e "\033[33m  ПОМНИ: это временный режим. Появится домен —\033[0m"
    echo -e "\033[33m  убери -f docker-compose.iptest.yml, закрой порт 9000,\033[0m"
    echo -e "\033[33m  перевыпусти сертификат и СМЕНИ пароль администратора:\033[0m"
    echo -e "\033[33m  сейчас он ходит по сети открытым текстом.\033[0m"
fi

# --- Итог по почте ----------------------------------------------------------
#
# В самом конце и с ненулевым кодом возврата. Платформа при этом развёрнута и
# работает — откатывать её из-за почты неправильно, — но «Готово» с кодом 0
# при непройденных проверках почты означало бы, что о мёртвой отправке узнают
# от клиента, который не смог зарегистрироваться.
if [ "$MAIL_FAILED" = "1" ]; then
    echo ""
    echo -e "\033[31m===========================================================\033[0m"
    echo -e "\033[31m  ПЛАТФОРМА РАЗВЁРНУТА, НО ПОЧТА НЕ ПРОШЛА ПРОВЕРКИ.\033[0m"
    echo -e "\033[31m  Письма (подтверждение почты, сброс пароля, выдача заказа)\033[0m"
    echo -e "\033[31m  могут не уходить вовсе. Разбор — вывод mail-check.sh выше.\033[0m"
    echo -e "\033[31m===========================================================\033[0m"
    echo ""
    echo "  Повторить проверку:"
    echo "    ssh $USER_@$HOST 'cd $APP_DIR && bash scripts/mail-check.sh'"
    exit 1
fi
