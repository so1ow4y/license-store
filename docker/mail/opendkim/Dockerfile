# ============================================================================
#  Подписант DKIM. ЕДИНСТВЕННОЕ место, где лежит закрытый ключ.
#
#  ПОЧЕМУ ОТДЕЛЬНЫЙ КОНТЕЙНЕР, А НЕ ВТОРОЙ ПРОЦЕСС РЯДОМ С POSTFIX.
#
#  1. Если opendkim падает, docker его перезапустит. Процесс, запущенный из
#     entrypoint рядом с `postfix start-fg`, умирает МОЛЧА: postfix жив,
#     контейнер «здоров», письма продолжают уходить — неподписанными. Это та
#     самая тихая поломка, которая обходится дороже всего: выглядит как
#     «письма опять в спаме», без единой ошибки в журнале.
#
#  2. Закрытый ключ монтируется ТОЛЬКО сюда. Публичный postfix-mx, который
#     принимает соединения от кого угодно, ключа не видит вовсе.
#
#  3. Оба postfix ходят к одному opendkim через inet:opendkim:8891 — одна
#     конфигурация подписи, а не две расходящиеся копии.
#
#  Цена вопроса — 12-15 МБ RSS.
# ============================================================================

FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC

# opendkim        — сам демон
# opendkim-tools  — opendkim-testkey, которым scripts/mail-check.sh сверяет
#                   закрытый ключ на сервере с открытым в DNS
# busybox         — ради одного апплета syslogd: opendkim умеет писать
#                   ТОЛЬКО в syslog, файлового журнала у него нет вовсе.
#                   Без приёмника syslog все строки вида «DKIM-Signature
#                   field added» пропадают, и проверить подпись по журналу
#                   становится нечем. busybox syslogd перекладывает их в
#                   stdout, то есть в `docker logs lp-opendkim`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        opendkim \
        opendkim-tools \
        busybox \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/opendkim.conf \
 # Каталог для рабочей копии ключа: сюда entrypoint кладёт ключ с правами,
 # которые opendkim считает безопасными (см. RequireSafeKeys).
 && mkdir -p /var/lib/opendkim/keys \
 && chown -R opendkim:opendkim /var/lib/opendkim \
 && chmod 700 /var/lib/opendkim/keys

COPY opendkim.conf /etc/opendkim/opendkim.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8891

# Проверка живости — именно соединение с портом milter, а не «процесс есть».
# Повисший opendkim, который не принимает соединения, для нас ничем не лучше
# мёртвого: postfix упрётся в milter_default_action.
#
# Проверка сделана средствами bash (/dev/tcp), а не nc: набор апплетов busybox
# отличается от сборки к сборке, и «-z не поддерживается» превратило бы
# здоровый контейнер в вечно нездоровый.
#
# ЗАПУСК POSTFIX ОТ ЭТОЙ ПРОВЕРКИ БОЛЬШЕ НЕ ЗАВИСИТ. Раньше оба postfix
# ждали её по `condition: service_healthy`, и любая её неудача — хоть из-за
# сборки bash, хоть из-за занятого демона — означала «dependency failed to
# start», то есть отправка платформы не поднималась вовсе. Теперь зависимость
# service_started (см. docker-compose.prod.yml), а эта проверка осталась тем,
# чем и должна быть: сигналом для человека и для scripts/mail-check.sh.
#
# Проверить, что /dev/tcp вообще работает в этой сборке bash, можно так:
#   docker run --rm debian:12-slim bash -c 'exec 3<>/dev/tcp/1.1.1.1/53' && echo ok
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8891' || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
