# ============================================================================
#  Свой образ postfix. Из него поднимаются ДВА контейнера с разными ролями:
#
#    MAIL_ROLE=out — внутренний отправитель. Портов наружу нет вовсе.
#                    Это ровно тот путь, по которому уже сегодня уходят
#                    письма платформы и который проверен живой доставкой.
#    MAIL_ROLE=mx  — публичный приёмник. Порты 25 и 587 опубликованы.
#                    Не содержит НИ ОДНОЙ директивы, разрешающей релей по IP.
#
#  ПОЧЕМУ СВОЙ, А НЕ boky/postfix. Тот образ перегенерирует main.cf при каждом
#  старте из своих переменных, и ни одна из нужных для приёма настроек
#  (virtual_alias_domains, пустой mydestination, postscreen, submission, SASL)
#  в его переменные не выведена. Любая «доработка» свелась бы к тому, чтобы
#  своим entrypoint править чужой сгенерированный файл — то есть сопровождать
#  конфигурацию вслепую, не видя итог целиком, и получать сюрпризы при каждом
#  обновлении базового образа.
#
#  Второе, не менее важное: `image: boky/postfix:latest` — это подвижная цель.
#  Живая доставка проверена для того образа, который скачался в тот день.
#  Следующий `docker compose pull` притащил бы другой, и отправка сломалась бы
#  без единого изменения в репозитории.
#
#  ПОЧЕМУ DEBIAN, А НЕ ALPINE. Пакет postfix в Debian — эталонная сборка, на
#  которой написана вся документация и все ответы в интернете; SASL-модули,
#  PCRE-таблицы и пути к файлам совпадают с любым руководством. Alpine дал бы
#  экономию ~40 МБ на ДИСКЕ (не в памяти) и musl-сборку, отладка которой ночью
#  в проде стоит дороже этих сорока мегабайт.
# ============================================================================

# Пин по тегу-мажору, а не по :latest. Полностью зафиксировать базу можно
# digest'ом — снять его на сервере и подставить сюда:
#
#   docker image inspect debian:12-slim --format '{{index .RepoDigests 0}}'
#   # FROM debian@sha256:....
#
# Пока держим тег: 12-slim обновляется только патчами внутри Debian 12,
# смены мажора (и вместе с ней смены версии postfix) он не приносит.
FROM debian:12-slim

# Часовой пояс нужен postfix для меток в журнале. Без него все записи в UTC,
# и сверять их с журналом API (тоже UTC) даже удобнее — оставляем UTC явно.
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC

# postfix           — сам агент доставки
# postfix-pcre      — таблицы pcre: нужны для sender_login_maps на submission
# libsasl2-modules  — auxprop-плагины Cyrus SASL, в т.ч. sasldb
# sasl2-bin         — saslpasswd2, которым entrypoint заводит учётку submission
# ca-certificates   — корневые сертификаты для исходящего STARTTLS
# rsyslog не ставим: postfix умеет писать в stdout через maillog_file,
#   а лишний демон в контейнере — это ещё один процесс, который может
#   умереть молча.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        postfix \
        postfix-pcre \
        libsasl2-modules \
        sasl2-bin \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 # Пакет создаёт свой main.cf/master.cf в ходе установки. Убираем их сразу:
 # конфигурацию кладёт entrypoint из /etc/postfix-role, и оставленные
 # пакетные файлы только сбивали бы с толку при отладке.
 && rm -f /etc/postfix/main.cf /etc/postfix/master.cf \
 # Каталог для сертификатов: entrypoint копирует туда ключ и цепочку с
 # правами, которые может прочитать пользователь postfix (см. entrypoint).
 && mkdir -p /etc/postfix/tls \
 && chmod 750 /etc/postfix/tls

# Конфигурации ролей. Лежат ОТДЕЛЬНО от /etc/postfix и копируются оттуда при
# старте — так в контейнере видно и то, что положили, и то, что применилось.
COPY conf/out/main.cf     /etc/postfix-role/out/main.cf
COPY conf/out/master.cf   /etc/postfix-role/out/master.cf
COPY conf/mx/main.cf      /etc/postfix-role/mx/main.cf
COPY conf/mx/master.cf    /etc/postfix-role/mx/master.cf

# Карта адресов и карта «кому от кого можно писать». Шаблоны: домен и адрес
# пересылки подставляет entrypoint, чтобы одни и те же файлы годились и для
# другого домена, и чтобы адрес пересылки жил в .env.production, а не в коде.
COPY conf/virtual.template      /etc/postfix-role/virtual.template
COPY conf/sender_login.template /etc/postfix-role/sender_login.template
# Переписывание конверта при пересылке (роль mx): отлуп от Gmail обязан
# вернуться нам, а не на подделанный адрес отправителя.
COPY conf/sender_canonical.template /etc/postfix-role/sender_canonical.template

# Настройка Cyrus SASL для smtpd: проверять пароль по локальной базе sasldb2.
# Файл обязан лежать именно здесь — postfix ищет его как
# /etc/postfix/sasl/<appname>.conf, а appname у smtpd по умолчанию «smtpd».
COPY conf/sasl-smtpd.conf /etc/postfix/sasl/smtpd.conf

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

# Оба порта объявляем в образе, публикует их только роль mx (см. compose).
EXPOSE 25 587

# Проба живости разговаривает по SMTP и ждёт баннер 220. Почему не
# `postfix status` — подробно в самом файле: master остаётся жив, когда его
# дети падают, и именно так приёмник однажды простоял «здоровым», не принимая
# почту вовсе.
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 \
    CMD /usr/local/bin/healthcheck.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
