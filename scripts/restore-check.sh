#!/usr/bin/env bash
# ============================================================================
#  Проверка резервной копии восстановлением.
#
#  Разворачивает дамп в ОТДЕЛЬНУЮ базу и сверяет, что данные на месте.
#  Боевую базу не трогает вообще.
#
#  Зачем отдельный скрипт. Копия, которую ни разу не разворачивали,
#  существует только на бумаге: битый архив, пустой дамп, забытая таблица —
#  всё это обнаруживается в момент, когда восстановление уже нужно, то есть
#  в худший из возможных. Гонять раз в неделю дешевле, чем узнать в аварии.
#
#  Запуск:  scripts/restore-check.sh backups/20260804-024655
# ============================================================================

set -euo pipefail

DIR="${1:-}"
PG="${PG_CONTAINER:-lp-postgres}"
USER_="${POSTGRES_USER:-lp}"
TEST_DB="restore_check_$(date -u +%H%M%S)"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "ОШИБКА: $*" >&2; exit 1; }

[ -n "$DIR" ] || die "укажи каталог копии: scripts/restore-check.sh backups/ГГГГММДД-ЧЧММСС"
[ -f "$DIR/db.dump" ] || die "нет $DIR/db.dump"

# --- 1. Контрольные суммы ---------------------------------------------------
if [ -f "$DIR/SHA256SUMS" ]; then
    log "сверка контрольных сумм..."
    ( cd "$DIR" && sha256sum -c SHA256SUMS --quiet ) || die "архив повреждён — суммы не сошлись"
    log "  суммы сошлись"
else
    log "  ВНИМАНИЕ: SHA256SUMS нет, целостность не проверена"
fi

# --- 2. Разворачивание ------------------------------------------------------
log "создаю временную базу $TEST_DB..."
docker exec "$PG" createdb -U "$USER_" "$TEST_DB" || die "не удалось создать базу"

cleanup() {
    log "убираю временную базу..."
    docker exec "$PG" dropdb -U "$USER_" --if-exists "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "восстанавливаю..."
# --no-owner и --no-privileges: роли боевой базы во временной не существуют,
# и без этих флагов восстановление тонет в ошибках прав, за которыми не видно
# настоящих проблем.
docker exec -i "$PG" pg_restore -U "$USER_" -d "$TEST_DB" --no-owner --no-privileges \
    < "$DIR/db.dump" 2>&1 | grep -vE "^$" | head -20 || true

# --- 3. Сверка содержимого --------------------------------------------------
#
# Проверяем не «база создалась», а что в ней есть то, ради чего копия и
# делается. Пустая, но синтаксически корректная база проходит любую
# формальную проверку и бесполезна.
log "сверка данных..."
q() { echo "$1" | docker exec -i "$PG" psql -U "$USER_" -d "$TEST_DB" -t -A; }

FAIL=0
check() {
    local name="$1" got="$2" min="$3"
    if [ "${got:-0}" -ge "$min" ] 2>/dev/null; then
        printf '  [ok]   %-28s %s\n' "$name" "$got"
    else
        printf '  [ПУСТО] %-27s %s (ожидалось >= %s)\n' "$name" "${got:-0}" "$min"
        FAIL=$((FAIL + 1))
    fi
}

check "таблиц"        "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")" 20
check "пользователей" "$(q "SELECT count(*) FROM users;")" 1
check "прав"          "$(q "SELECT count(*) FROM permissions;")" 10
check "ролей"         "$(q "SELECT count(*) FROM roles;")" 3
check "продуктов"     "$(q "SELECT count(*) FROM products;")" 1
check "настроек"      "$(q "SELECT count(*) FROM settings;")" 10

# Лицензии и заказы могут быть пусты на свежей системе — не повод падать,
# но показать надо: если их не стало после того как были, это видно сразу.
printf '  [—]    %-28s %s\n' "лицензий" "$(q "SELECT count(*) FROM licenses;")"
printf '  [—]    %-28s %s\n' "заказов"  "$(q "SELECT count(*) FROM orders;")"

# --- 4. Ключи ---------------------------------------------------------------
if [ -f "$DIR/secrets.enc" ]; then
    if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
        if openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
             -in "$DIR/secrets.enc" 2>/dev/null | grep -q '^ENCRYPTION_KEY='; then
            log "ключ шифрования на месте и расшифровывается"
        else
            log "ОШИБКА: ключи не расшифровались — неверный BACKUP_PASSPHRASE?"
            FAIL=$((FAIL + 1))
        fi
    else
        log "ВНИМАНИЕ: BACKUP_PASSPHRASE не задан, ключи не проверены"
    fi
else
    log "ОШИБКА: secrets.enc нет — без ключа шифрования копия неполна"
    FAIL=$((FAIL + 1))
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
    echo "КОПИЯ ПРИГОДНА К ВОССТАНОВЛЕНИЮ"
else
    echo "ПРОБЛЕМ: $FAIL — копией пользоваться нельзя"
    exit 1
fi
