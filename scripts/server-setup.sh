#!/usr/bin/env bash
# ============================================================================
#  Подготовка чистого сервера. Запускается ОДИН РАЗ, на самом сервере.
#
#    ssh root@<IP> 'bash -s' < scripts/server-setup.sh
#
#  Ставит docker, закрывает всё лишнее фаерволом, добавляет своп и создаёт
#  каталог приложения. Ничего из проекта не разворачивает — этим занимается
#  deploy.sh.
#
#  Рассчитано на Ubuntu 24.04+ с 2 ГБ памяти.
# ============================================================================

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/license-platform}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

log() { echo -e "\n\033[36m=== $* ===\033[0m"; }
ok()  { echo "  [ok] $*"; }

[ "$(id -u)" -eq 0 ] || { echo "нужен root"; exit 1; }

# --- Система ----------------------------------------------------------------

log "Обновление системы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban >/dev/null
ok "пакеты обновлены"

# --- Своп -------------------------------------------------------------------
#
# На двух гигабайтах он не роскошь, а страховка. Argon2 при входе берёт
# по 64 МБ на хеш, и десяток одновременных входов способен упереться в
# потолок — без свопа ядро убьёт что-нибудь важное, скорее всего Postgres.

log "Своп"
if swapon --show | grep -q .; then
    ok "своп уже есть: $(swapon --show=SIZE --noheadings | tr -d ' ')"
else
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # 10 вместо стандартных 60: своп нужен как подушка на пиках, а не как
    # постоянное место жительства горячих страниц Postgres.
    sysctl -w vm.swappiness=10 >/dev/null
    grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
    ok "своп $SWAP_SIZE создан"
fi

# --- Docker -----------------------------------------------------------------

log "Docker"
if command -v docker >/dev/null 2>&1; then
    ok "уже установлен: $(docker --version)"
else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
    systemctl enable --now docker >/dev/null
    ok "установлен: $(docker --version)"
fi

# Журналы контейнеров без ограничения растут, пока не кончится диск.
# На 30 ГБ это вопрос месяцев, а не лет.
if [ ! -f /etc/docker/daemon.json ]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
    systemctl restart docker
    ok "ограничение журналов включено"
fi

# --- Фаервол ----------------------------------------------------------------
#
# Наружу — только SSH, HTTP и HTTPS. Postgres, Redis и S3 публиковать
# нельзя: в боевом compose их порты и так не выставлены, но фаервол — второй
# рубеж на случай, если однажды кто-то добавит `ports:` не подумав.

log "Фаервол"
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP + ACME' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
# Приём почты для домена. Открыт ЗАРАНЕЕ и здесь, а не только в deploy.sh:
# `ufw --force reset` выше стирает всё, что добавили после установки, и без
# этой строки повторный запуск server-setup.sh на живом сервере ТИХО закрыл бы
# приём почты. Симптом был бы отложенный и малопонятный: письма на support@
# перестают доходить, при этом отправка платформы работает как ни в чём
# не бывало (у неё исходящее соединение, а исходящие ufw не трогает).
ufw allow 25/tcp comment 'SMTP MX' >/dev/null
ufw --force enable >/dev/null
ok "открыты 22, 80, 443, 25"

# Порт 587 (submission, «отправлять как support@» из стороннего клиента)
# НАМЕРЕННО не открыт. Он бесполезен, пока в .env.production не заданы
# MAIL_SUBMISSION_BIND и MAIL_SUBMISSION_PASSWORD, а открытый порт без службы
# за ним — просто приглашение сканерам. Его откроет deploy.sh в тот момент,
# когда submission действительно включат.
echo "  587 (submission) закрыт до включения — это шаг C перехода на свою почту."

# ВАЖНО про docker и ufw: docker пишет свои правила в iptables МИМО ufw,
# поэтому опубликованный порт контейнера виден снаружи, даже если ufw его
# запрещает. Единственная надёжная защита — не публиковать порты вовсе,
# что боевой compose и делает. Проверить фактическую доступность можно
# только снаружи: nmap с другой машины, а не ufw status изнутри.
echo "  ПОМНИ: docker обходит ufw для опубликованных портов."
echo "         Защита — отсутствие 'ports:' у внутренних сервисов."

# --- fail2ban ---------------------------------------------------------------

log "Защита SSH от перебора"
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled  = true
port     = 22
maxretry = 5
findtime = 600
bantime  = 3600
JAIL
systemctl enable --now fail2ban >/dev/null 2>&1 || true
ok "fail2ban включён"

# --- Каталог приложения -----------------------------------------------------

log "Каталог приложения"
mkdir -p "$APP_DIR"/{docker/nginx/{certs,certbot,letsencrypt},backups}
ok "$APP_DIR"

# --- Итог -------------------------------------------------------------------

log "Готово"
free -h | head -2
echo ""
df -h / | tail -1
echo ""
echo "Дальше — deploy.sh с рабочей машины."
