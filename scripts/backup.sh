#!/usr/bin/env bash
# ============================================================================
#  Резервная копия платформы. Запускается НА СЕРВЕРЕ по расписанию.
#
#  Копируется три вещи, и все три обязательны — по отдельности они бесполезны:
#
#    1. База          — лицензии, пользователи, заказы, платежи.
#    2. Бакет payloads — DLL, которые выдаются загрузчику.
#    3. КЛЮЧ ШИФРОВАНИЯ — ENCRYPTION_KEY и HWID_PEPPER из .env.
#
#  Третий пункт важнее, чем кажется. Disk ID устройств и секреты 2FA лежат
#  в базе ЗАШИФРОВАННЫМИ. Восстановишь базу без ключа — получишь строки,
#  которые невозможно расшифровать: привязки к железу потеряны у всех,
#  вторые факторы не работают ни у кого. Резервная копия без ключа —
#  это не резервная копия.
#
#  Ключ кладётся в ОТДЕЛЬНЫЙ файл и шифруется паролем: держать его рядом
#  с дампом в открытом виде значит, что укравший архив получает и данные,
#  и ключ к ним.
#
#  Установка (раз в сутки в 4 утра):
#    chmod +x scripts/backup.sh
#    crontab -e
#    0 4 * * * BACKUP_PASSPHRASE='...' /путь/scripts/backup.sh >> /var/log/lp-backup.log 2>&1
#
#  Проверка восстановления — scripts/restore-check.sh. Копия, которую ни разу
#  не разворачивали,существует только на бумаге.
# ============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${BACKUP_DIR:-$ROOT/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PG="${PG_CONTAINER:-lp-postgres}"
S3_HOST="${S3_CONTAINER:-lp-s3}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DEST="$OUT/$STAMP"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "ОШИБКА: $*" >&2; exit 1; }
envval() { grep -E "^$1=" "$ROOT/.env" | tail -n 1 | cut -d= -f2-; }

command -v docker >/dev/null || die "docker не найден"
[ -f "$ROOT/.env" ] || die "не найден $ROOT/.env — без него нечего сохранять из ключей"

mkdir -p "$DEST"
log "копия в $DEST"

# --- 1. База ----------------------------------------------------------------
#
# Формат custom (-Fc), а не обычный SQL: он сжат, восстанавливается
# параллельно и позволяет достать отдельную таблицу, не разворачивая всё.
log "дамп базы..."
docker exec "$PG" pg_dump -U "${POSTGRES_USER:-lp}" -d "${POSTGRES_DB:-license_platform}" -Fc \
    > "$DEST/db.dump" || die "pg_dump не отработал"

DB_SIZE=$(stat -c%s "$DEST/db.dump" 2>/dev/null || stat -f%z "$DEST/db.dump")
[ "$DB_SIZE" -gt 1024 ] || die "дамп подозрительно мал ($DB_SIZE Б) — проверь, что база не пуста"
log "  база: $(numfmt --to=iec "$DB_SIZE" 2>/dev/null || echo "$DB_SIZE Б")"

# --- 2. Хранилище -----------------------------------------------------------
#
# Только payloads: releases при потере пересобираются из исходников, а
# payload — это то, что уже выдано пользователям, и оно обязано совпадать
# с sha256 в базе.
log "копия бакета payloads..."
docker run --rm --network "${DOCKER_NETWORK:-license-platform_default}" \
    -v "$DEST:/backup" \
    -e AWS_ACCESS_KEY_ID="$(envval S3_ACCESS_KEY)" \
    -e AWS_SECRET_ACCESS_KEY="$(envval S3_SECRET_KEY)" \
    -e AWS_DEFAULT_REGION=us-east-1 \
    amazon/aws-cli --endpoint-url "http://${S3_HOST}:9000" --only-show-errors \
    s3 sync "s3://$(envval S3_BUCKET_PAYLOADS || echo payloads)" /backup/payloads \
    || log "  ВНИМАНИЕ: копия хранилища не удалась, продолжаю"

# --- 3. Ключи ---------------------------------------------------------------
#
# Отдельным зашифрованным файлом. Без пароля скрипт откажется работать:
# ключ шифрования в открытом виде рядом с дампом обесценивает шифрование
# полей целиком.
[ -n "${BACKUP_PASSPHRASE:-}" ] || die "не задан BACKUP_PASSPHRASE — ключ шифрования нельзя класть в копию открытым"

log "ключи шифрования..."
grep -E '^(ENCRYPTION_KEY|ENCRYPTION_KEY_VERSION|ENCRYPTION_KEYS_RETIRED|HWID_PEPPER|JWT_SECRET)=' "$ROOT/.env" \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
    > "$DEST/secrets.enc" || die "не удалось зашифровать ключи"

# --- Контрольные суммы ------------------------------------------------------
#
# Без них молча испортившийся архив обнаруживается в момент восстановления,
# то есть в худший из возможных.
( cd "$DEST" && find . -type f ! -name SHA256SUMS -exec sha256sum {} + > SHA256SUMS )

# --- Ротация ----------------------------------------------------------------
log "удаление копий старше $KEEP_DAYS дн..."
find "$OUT" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

TOTAL=$(du -sh "$DEST" | cut -f1)
log "готово: $DEST ($TOTAL)"

# Напоминание, которое стоит держать перед глазами: копия на том же диске,
# что и база, спасает от испорченной миграции и не спасает от смерти диска.
cat <<'NOTE'

  Копия лежит на ТОМ ЖЕ сервере. Этого достаточно против неудачной миграции
  и случайного DELETE, и недостаточно против отказа диска или потери сервера.
  Уноси каталог backups/ наружу — rclone, scp по расписанию, что угодно.
NOTE
