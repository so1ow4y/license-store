# Агент фаервола: применяет блоки уровня «фаервол» из центра безопасности
# как правила nftables на хосте. Запускается с network_mode: host и NET_ADMIN
# (см. сервис firewall в docker-compose.yml).
FROM alpine:3.22

# nftables — пользовательская утилита; само правило живёт в ядре хоста.
# wget и cmp есть в busybox.
RUN apk add --no-cache nftables

COPY agent.sh /usr/local/bin/lp-firewall-agent
RUN chmod +x /usr/local/bin/lp-firewall-agent

ENTRYPOINT ["/usr/local/bin/lp-firewall-agent"]
