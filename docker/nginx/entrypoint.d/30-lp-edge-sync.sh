#!/bin/sh
# shellcheck shell=sh
# Агент синхронизации списков центра безопасности для nginx.
#
# ЧТО ДЕЛАЕТ. Раз в EDGE_SYNC_INTERVAL секунд забирает у API два файла —
# заблокированные адреса (уровни «nginx» и «фаервол») и доверенные адреса
# (приоритет трафика) — и, если содержимое изменилось, проверяет конфиг
# (nginx -t) и перезагружает nginx. Перезагрузка бесшовная: старые воркеры
# дообслуживают свои соединения.
#
# ПОЧЕМУ ФОНОВЫЙ ЦИКЛ, А НЕ ОТДЕЛЬНЫЙ КОНТЕЙНЕР. reload — это сигнал
# мастер-процессу; из соседнего контейнера его не послать без общего
# PID-пространства или docker.sock, а отдавать сокет докера сервису на краю
# ровно то, чего делать нельзя.
#
# ПОЧЕМУ .sh, А НЕ .envsh. Скрипт ничего не экспортирует наружу, а фоновый
# процесс должен пережить exec nginx — дочерний процесс скрипта переходит
# к PID 1 и продолжает работать.
#
# Без EDGE_AGENT_TOKEN файлы остаются пустыми: nginx работает как раньше,
# блоки уровней «nginx» и «фаервол» действуют только в самом приложении.

set -eu

DIR=/etc/nginx/lp-edge
mkdir -p "$DIR"
# Пустые файлы нужны ДО старта: geo с include несуществующего файла не
# даст nginx подняться вовсе.
[ -f "$DIR/blocklist.conf" ] || : > "$DIR/blocklist.conf"
[ -f "$DIR/priority.conf" ] || : > "$DIR/priority.conf"

if [ -z "${EDGE_AGENT_TOKEN:-}" ]; then
    echo "$0: EDGE_AGENT_TOKEN не задан — списки блокировок на краю не синхронизируются"
    exit 0
fi

INTERVAL="${EDGE_SYNC_INTERVAL:-10}"
BASE="http://${API_UPSTREAM}/api/v1/internal/edge/nginx"

sync_once() {
    changed=0
    for name in blocklist priority; do
        tmp="$DIR/.$name.new"
        if wget -q -T 5 -O "$tmp" --header "Authorization: Bearer $EDGE_AGENT_TOKEN" "$BASE/$name" 2>/dev/null; then
            if ! cmp -s "$tmp" "$DIR/$name.conf"; then
                cp "$DIR/$name.conf" "$DIR/.$name.prev"
                mv "$tmp" "$DIR/$name.conf"
                changed=1
            else
                rm -f "$tmp"
            fi
        else
            # API недоступен (перезапуск, атака) — работаем на прежних списках.
            rm -f "$tmp"
        fi
    done

    [ "$changed" = 1 ] || return 0
    if nginx -t -q 2>/dev/null; then
        nginx -s reload
        echo "$0: списки обновлены, nginx перезагружен"
    else
        # Битый файл не должен положить nginx при следующем рестарте контейнера.
        for name in blocklist priority; do
            [ -f "$DIR/.$name.prev" ] && cp "$DIR/.$name.prev" "$DIR/$name.conf"
        done
        echo "$0: новые списки не прошли nginx -t, оставлены прежние" >&2
    fi
}

(
    # Ждём мастер-процесс: reload до старта ушёл бы в пустоту.
    while [ ! -s /var/run/nginx.pid ]; do sleep 1; done
    while true; do
        sync_once || true
        sleep "$INTERVAL"
    done
) &

echo "$0: синхронизация списков с API каждые ${INTERVAL} с"
