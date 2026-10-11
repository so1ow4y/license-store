#!/bin/sh
# shellcheck shell=sh
# Агент фаервола центра безопасности.
#
# Раз в EDGE_SYNC_INTERVAL секунд забирает у API готовый сценарий nftables
# (GET /api/v1/internal/edge/nftables) и, если он изменился, сначала
# проверяет его (nft -c), потом применяет (nft -f). Сценарий пересоздаёт
# одну таблицу — inet lp_guard — атомарно: состояния «правил нет» между
# старым и новым набором не бывает. Правила хоста, докера и других
# сервисов не трогаются.
#
# Цепочка висит на prerouting с приоритетом raw (-300): пакет отбрасывается
# раньше conntrack и DNAT докера, то есть до TCP-рукопожатия — заблокированный
# адрес не открывает даже соединение с nginx.
#
# При остановке контейнера таблица удаляется: выключенный агент не должен
# оставлять на хосте блоки, которые уже никто не обновляет и не снимет.

set -eu

if [ -z "${EDGE_AGENT_TOKEN:-}" ]; then
    echo "lp-firewall: EDGE_AGENT_TOKEN не задан — агенту нечем авторизоваться в API" >&2
    exit 1
fi

URL="${EDGE_API_URL:-http://127.0.0.1:3000}/api/v1/internal/edge/nftables"
INTERVAL="${EDGE_SYNC_INTERVAL:-10}"
STATE=/tmp/lp-guard.nft
NEW=/tmp/lp-guard.nft.new

cleanup() {
    nft delete table inet lp_guard 2>/dev/null || true
    echo "lp-firewall: таблица lp_guard удалена, агент остановлен"
    exit 0
}
trap cleanup INT TERM

: > "$STATE"
echo "lp-firewall: синхронизация с $URL каждые ${INTERVAL} с"

while true; do
    if wget -q -T 5 -O "$NEW" --header "Authorization: Bearer $EDGE_AGENT_TOKEN" "$URL" 2>/dev/null; then
        if ! cmp -s "$NEW" "$STATE"; then
            if nft -c -f "$NEW"; then
                nft -f "$NEW"
                mv "$NEW" "$STATE"
                echo "lp-firewall: правила применены ($(grep -c 'drop' "$STATE") правил отбрасывания)"
            else
                echo "lp-firewall: сценарий не прошёл проверку nft -c, оставлены прежние правила" >&2
            fi
        fi
    else
        # API недоступен — держим последние применённые правила, а не снимаем их.
        echo "lp-firewall: API не ответил, правила не менялись" >&2
    fi
    rm -f "$NEW"
    # sleep в фоне и wait: так trap срабатывает сразу, а не после сна.
    sleep "$INTERVAL" &
    wait $! || true
done
