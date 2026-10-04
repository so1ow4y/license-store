# ============================================================================
#  Самоподписанный сертификат для локальной работы по HTTPS.
#
#  Нужен, чтобы TLS-путь проверялся ТАМ ЖЕ, где разрабатывается, а не
#  впервые встречался на проде. Расхождение «локально по HTTP, на сервере
#  по HTTPS» стабильно даёт сюрпризы: смешанный контент, редиректы,
#  заголовки X-Forwarded-Proto, cookie с флагом Secure.
#
#  Браузер такому сертификату не поверит и покажет предупреждение — это
#  нормально и ожидаемо. Загрузчик на WinHTTP тоже не поверит: для него
#  сертификат надо либо положить в доверенные корневые, либо оставить
#  загрузчику HTTP через Tailscale, как сейчас.
#
#  Для боевого сервера этот скрипт НЕ используется. Там:
#    certbot certonly --webroot -w ./docker/nginx/certbot -d ваш.домен
#    и симлинк/копия fullchain.pem + privkey.pem в docker/nginx/certs
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\make-dev-cert.ps1
# ============================================================================

param(
    [string]$CertDir = "$PSScriptRoot\..\docker\nginx\certs",
    [string[]]$Names = @('localhost', 'lp.local'),
    [int]$Days = 825
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null
$cert = Join-Path $CertDir 'fullchain.pem'
$key = Join-Path $CertDir 'privkey.pem'

if ((Test-Path -LiteralPath $cert) -and (Test-Path -LiteralPath $key)) {
    Write-Host "Сертификат уже есть: $cert" -ForegroundColor Yellow
    Write-Host "Удали оба файла, если нужен новый." -ForegroundColor Yellow
    exit 0
}

# openssl из состава Git for Windows — он есть у всех, кто работает с этим
# репозиторием, отдельной установки не требует.
$openssl = "$env:ProgramFiles\Git\usr\bin\openssl.exe"
if (-not (Test-Path -LiteralPath $openssl)) {
    $found = Get-Command openssl -ErrorAction SilentlyContinue
    if ($found) { $openssl = $found.Source }
    else {
        Write-Host "openssl не найден. Он входит в Git for Windows." -ForegroundColor Red
        exit 1
    }
}

# SAN обязателен: сертификаты только с CN современные клиенты игнорируют
# уже несколько лет — проверка идёт исключительно по subjectAltName.
$san = ($Names | ForEach-Object { "DNS:$_" }) -join ','
$san = "$san,IP:127.0.0.1"

$conf = Join-Path $env:TEMP "lp-cert-$([guid]::NewGuid().ToString('N')).cnf"
@"
[req]
distinguished_name = dn
x509_extensions    = v3
prompt             = no

[dn]
CN = $($Names[0])
O  = License Platform (dev)

[v3]
subjectAltName   = $san
basicConstraints = critical,CA:FALSE
keyUsage         = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
"@ | Set-Content -LiteralPath $conf -Encoding ascii

# ECDSA P-256, а не RSA: короче, быстрее на рукопожатии и поддерживается
# всем, что вышло после 2014 года.
#
# ErrorActionPreference временно снимается: openssl пишет ход работы в
# stderr (строку из дефисов), PowerShell выдаёт это за ошибку, и при
# 'Stop' скрипт обрывался ПОСЛЕ записи ключа, но ДО записи сертификата —
# на диске оставалась половина пары. Успех проверяем кодом возврата и
# наличием файла, а не отсутствием строк в stderr.
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 `
    -days $Days -keyout $key -out $cert -config $conf 2>&1 | Out-Null
$code = $LASTEXITCODE
$ErrorActionPreference = $prev

Remove-Item -LiteralPath $conf -Force -ErrorAction SilentlyContinue

if ($code -ne 0) {
    Write-Host "openssl завершился с кодом $code" -ForegroundColor Red
    Remove-Item -LiteralPath $key -Force -ErrorAction SilentlyContinue
    exit 1
}

if (-not (Test-Path -LiteralPath $cert)) {
    Write-Host "Сертификат не создан" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Сертификат создан" -ForegroundColor Green
Write-Host "  $cert"
Write-Host "  $key"
Write-Host "  имена: $($Names -join ', '), 127.0.0.1; срок: $Days дн."
Write-Host ""
Write-Host "Перезапусти nginx, чтобы он подхватил:" -ForegroundColor Cyan
Write-Host "  docker compose up -d --force-recreate nginx"
Write-Host ""
Write-Host "Проверка:" -ForegroundColor Cyan
Write-Host "  curl -k https://localhost:8443/health/live"
Write-Host ""
