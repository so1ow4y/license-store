# ============================================================================
#  Генератор боевых секретов. Создаёт .env.production ЛОКАЛЬНО.
#
#  Файл в репозиторий не идёт (.gitignore) и на сервер уезжает отдельно,
#  а не вместе с исходниками: так он не попадёт ни в архив, ни в образ,
#  ни в чужие руки вместе с кодом.
#
#  ЧТО ГЕНЕРИРУЕТСЯ И ЧЕГО СТОИТ ПОТЕРЯ КАЖДОГО:
#
#    JWT_SECRET      — потеря безобидна: все выходят из системы и заходят
#                      заново. Меняется свободно.
#    ENCRYPTION_KEY  — им зашифрованы Disk ID устройств и секреты 2FA.
#                      Потеря = данные не восстановить НИКАК, даже имея
#                      полный дамп базы. Хранить отдельно от копий базы.
#                      Смена на живой системе возможна без простоя через
#                      ENCRYPTION_KEYS_RETIRED — см. env.schema.ts.
#    HWID_PEPPER     — им считается хеш железа. Версий у него НЕТ: смена на
#                      живой базе разом убивает все привязки к устройствам,
#                      и каждый пользователь получает HWID_MISMATCH.
#                      На чистой базе — генерируй смело, потом не трогай.
#
#  Запуск:
#    powershell -File scripts\gen-secrets.ps1 -Domain lic.example.com
#    powershell -File scripts\gen-secrets.ps1 -Domain 77.221.154.85   # без HTTPS
# ============================================================================

param(
    [Parameter(Mandatory = $true)][string]$Domain,
    [string]$OutFile = "",
    [string]$AdminEmail = "",
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Путь считается ЗДЕСЬ, а не в значении параметра: при запуске через
# `powershell -File` $PSScriptRoot внутри param() бывает пустым, и путь
# сворачивается в C:\.env.production — файл уезжает в корень диска,
# а ошибка выглядит как «отказано в доступе».
if (-not $OutFile) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $OutFile = Join-Path (Split-Path -Parent $here) '.env.production'
}

if ((Test-Path -LiteralPath $OutFile) -and -not $Force) {
    Write-Host "Файл уже существует: $OutFile" -ForegroundColor Yellow
    Write-Host "Перезапись затрёт СУЩЕСТВУЮЩИЕ КЛЮЧИ — данные, зашифрованные ими," -ForegroundColor Yellow
    Write-Host "станут нечитаемыми. Если уверен: добавь -Force" -ForegroundColor Yellow
    exit 1
}

# Криптографический источник, а не Get-Random: последний предсказуем и для
# ключей шифрования непригоден.
function New-Hex {
    param([int]$Bytes = 32)
    $b = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return -join ($b | ForEach-Object { $_.ToString('x2') })
}

function New-Password {
    param([int]$Bytes = 24)
    $b = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    # base64url: без +/=, поэтому значение безопасно вставляется в строку
    # подключения и в URL, не требуя экранирования.
    return ([Convert]::ToBase64String($b) -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

# --- Режим: домен или голый IP ----------------------------------------------
#
# На IP сертификат не выпустить (Let's Encrypt их не выдаёт), и поддомена
# s3. не сделать. Поэтому адреса строятся иначе, а хранилище адресуется
# портом. Режим временный и небезопасный — предупреждение ниже не для вида.

$isIp = $Domain -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'

if ($isIp) {
    $appUrl     = "http://$Domain"
    $s3Url      = "http://" + $Domain + ":9000"
    $mailDomain = 'example.com'
    # В режиме без домена письма ловит mailpit из docker-compose.iptest.yml
    # и показывает их в браузере: без рабочего SMTP регистрацию не завершить.
    $smtpHost = 'mailpit'
    $smtpPort = '1025'
} else {
    $appUrl     = "https://$Domain"
    $s3Url      = "https://s3.$Domain"
    $mailDomain = $Domain
    $smtpHost = ''
    $smtpPort = '587'
}

if (-not $AdminEmail) { $AdminEmail = "admin@$mailDomain" }

$pgPass    = New-Password
$redisPass = New-Password
$s3Pass    = New-Password
$adminPass = (New-Password 12) + '!aA1'

$content = @"
# ============================================================================
#  БОЕВЫЕ настройки. Создано gen-secrets.ps1 $(Get-Date -Format 'yyyy-MM-dd HH:mm').
#
#  НЕ коммитить. НЕ пересылать в мессенджерах. Копию ENCRYPTION_KEY и
#  HWID_PEPPER держать ОТДЕЛЬНО от резервных копий базы — иначе укравший
#  архив получает и данные, и ключ к ним.
#
#  Значения БЕЗ кавычек: docker --env-file, в отличие от dotenv, кавычки
#  не снимает и передаёт их внутрь значения.
# ============================================================================

NODE_ENV=production
APP_PORT=3000
APP_URL=$appUrl

# Origin, которому разрешён CORS. Пока фронта нет, совпадает с APP_URL:
# схема требует адрес обязательно, и пустое значение роняет API на старте.
# Появится отдельный фронт на своём домене — поменять здесь.
FRONTEND_URL=$appUrl

# --- Секреты ----------------------------------------------------------------
JWT_SECRET=$(New-Hex)

# Потеря = зашифрованные поля не восстановить. Версия 1 — начальная.
ENCRYPTION_KEY=$(New-Hex)
ENCRYPTION_KEY_VERSION=1

# Версий не имеет. На живой базе НЕ МЕНЯТЬ.
HWID_PEPPER=$(New-Hex)

# --- База -------------------------------------------------------------------
POSTGRES_USER=lp
POSTGRES_PASSWORD=$pgPass
POSTGRES_DB=license_platform
DATABASE_URL=postgresql://lp:$pgPass@postgres:5432/license_platform?schema=public

# --- Redis ------------------------------------------------------------------
REDIS_PASSWORD=$redisPass
REDIS_URL=redis://:$redisPass@redis:6379/0

# --- Хранилище --------------------------------------------------------------
# Этими же ключами запускается контейнер s3 (RustFS).
S3_ACCESS_KEY=lpadmin
S3_SECRET_KEY=$s3Pass

# Адрес, по которому в хранилище ходит сам сервер. В контейнере его
# перекрывает docker-compose.yml значением http://s3:9000.
S3_ENDPOINT=$s3Url

# Адрес, для которого подписываются presigned-ссылки, уходящие наружу.
# Подпись привязана к хосту, поэтому он обязан быть доступен из браузера.
S3_PUBLIC_ENDPOINT=$s3Url
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_BUCKET_RELEASES=releases
S3_BUCKET_PAYLOADS=payloads

# --- Почта ------------------------------------------------------------------
# Без рабочего SMTP не уйдут ни подтверждение почты при регистрации, ни
# письмо о выданной лицензии.
SMTP_HOST=$smtpHost
SMTP_PORT=$smtpPort
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@$mailDomain

# --- Digiseller -------------------------------------------------------------
DIGISELLER_SELLER_ID=
DIGISELLER_API_KEY=
DIGISELLER_API_BASE=https://api.digiseller.com
DIGISELLER_TOKEN_CACHE_TTL=6600

# --- OAuth ------------------------------------------------------------------
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=$appUrl/auth/discord/callback
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=

# --- Прочее -----------------------------------------------------------------
NGINX_PORT=80
NGINX_TLS_PORT=443
LOG_LEVEL=info
UV_THREADPOOL_SIZE=8

# Бюджет байтов payload в полёте. 16 МиБ вместо 128: на машине с 2 ГБ каждый
# запрос держит открытый текст, шифротекст и пик конкатенации разом, и
# большой бюджет обернулся бы сотнями мегабайт настоящего расхода — то есть
# смертью Postgres от руки OOM-killer'а.
PAYLOAD_INFLIGHT_MAX_BYTES=16777216
PAYLOAD_CACHE_MAX_BYTES=8388608
"@

[System.IO.File]::WriteAllText($OutFile, $content, (New-Object System.Text.UTF8Encoding($false)))

if ($isIp) {
    Write-Host ""
    Write-Host "РЕЖИМ БЕЗ ДОМЕНА — ВРЕМЕННЫЙ" -ForegroundColor Yellow
    Write-Host "  Всё пойдёт открытым HTTP: пароль при входе, токены доступа," -ForegroundColor Yellow
    Write-Host "  sessionKey в теле запроса за payload." -ForegroundColor Yellow
    Write-Host "  Шифрование payload при этом теряет смысл целиком: ключ" -ForegroundColor Yellow
    Write-Host "  выводится из sessionKey, а он летит рядом в открытую." -ForegroundColor Yellow
    Write-Host "  Годится, пока систему трогаешь только ты." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Создан $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "Пароль администратора для первого входа:" -ForegroundColor Cyan
Write-Host "  логин:  admin"
Write-Host "  пароль: $adminPass"
Write-Host ""
Write-Host "Запиши его СЕЙЧАС — больше он нигде не появится." -ForegroundColor Yellow
Write-Host ""
Write-Host "Осталось заполнить руками:" -ForegroundColor Cyan
Write-Host "  SMTP_*                — без них не уйдут письма и не подтвердится почта"
Write-Host "  DIGISELLER_SELLER_ID  — из кабинета продавца"
Write-Host "  DIGISELLER_API_KEY    — оттуда же"
Write-Host "  DISCORD_*, TELEGRAM_* — если нужен вход через них"
Write-Host ""
Write-Host "СОХРАНИ ОТДЕЛЬНО от копий базы:" -ForegroundColor Red
Write-Host "  ENCRYPTION_KEY  — без него зашифрованные поля не восстановить"
Write-Host "  HWID_PEPPER     — без него все привязки к устройствам умрут"
Write-Host ""

# Пароль админа кладём рядом, чтобы deploy.sh передал его в сид.
$pwFile = Join-Path (Split-Path $OutFile) ".admin-password"
[System.IO.File]::WriteAllText($pwFile, $adminPass, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Пароль также записан в $pwFile (удали после первого входа)" -ForegroundColor DarkGray
