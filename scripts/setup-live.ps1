# ============================================================================
#  Подготовка к ЖИВОМУ запуску загрузчика с игрой.
#
#  В отличие от смоук-скриптов ничего за собой НЕ убирает: ключ сборки,
#  пользователь, лицензия и опубликованная сборка payload'а остаются в базе,
#  чтобы загрузчиком можно было пользоваться руками.
#
#  Заодно прописывает выданные значения в Platform/Config.h и пересобирает
#  Griloder.exe — иначе ValidateConfig() честно откажется работать на
#  заглушках, и это будет выглядеть как поломка.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\setup-live.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    # Через nginx, а не напрямую в Node: именно этот путь поедет в прод, и
    # именно на нём проверено, что многомегабайтный ответ не уходит во
    # временный файл. Проверять одно, а пользоваться другим — плохая идея.
    [string]$Origin = "http://localhost:8080",
    [string]$PgContainer = "lp-postgres",
    [string]$LauncherDir = "C:\Users\user\work\gripulialoader\Griloder",
    [string]$Dll = "C:\Users\user\work\chipa\productionFC26\out\Release\x64\fc26mod_ship.dll",
    [string]$Login = "",
    [string]$Password = "LiveRun!2026",
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-live-req.json"

# Пустой результат psql приходит как $null, и .Trim() на нём роняет строку
# с невнятным «You cannot call a method on a null-valued expression».
# Нормализуем здесь один раз, а не городим проверки на каждом вызове.
function Sql {
    param([string]$Q)
    $r = ($Q | docker exec -i $PgContainer psql -U lp -d license_platform -t -A 2>&1)
    if ($null -eq $r) { return '' }
    return ($r -join "`n").Trim()
}

function Invoke-Plain {
    param([string]$Method, [string]$Path, $Body, [string]$Token)
    $a = @('-s', '-w', "`n%{http_code}", '-X', $Method, "$Base$Path", '-H', 'Content-Type: application/json')
    if ($Token) { $a += @('-H', "Authorization: Bearer $Token") }
    if ($Body) {
        [System.IO.File]::WriteAllText($tmp, ($Body | ConvertTo-Json -Compress -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
        $a += @('--data-binary', "@$tmp")
    }
    $raw = (& curl.exe @a) -join "`n"
    $p = $raw -split "`n"
    $bt = ($p[0..($p.Count - 2)] -join "`n")
    $parsed = $null
    if ($bt) { try { $parsed = $bt | ConvertFrom-Json } catch { $parsed = $bt } }
    return [PSCustomObject]@{ Code = [int]$p[-1]; Body = $parsed }
}

function Die { param([string]$M) Write-Host $M -ForegroundColor Red; exit 1 }

if (-not (Test-Path $Dll)) { Die "Не найден payload: $Dll" }
if (-not $Login) { $Login = "live$(Get-Random -Maximum 99999)" }

# --- Ключ сборки -------------------------------------------------------------

Write-Host "`n=== Ключ сборки ===" -ForegroundColor Cyan

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base
if (-not $adminToken) { Die "Не удалось войти администратором — сервер поднят?" }

$key = Invoke-Plain POST "/auth/api-keys" @{
    name   = "Griloder live $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    scopes = @('launcher:payload', 'launcher:check', 'launcher:update', 'launcher:logs')
} $adminToken
if ($key.Code -ne 201) { Die "Ключ сборки не выпущен: HTTP $($key.Code)" }
$apiKey = $key.Body.prefix
$secret = $key.Body.signingSecret
Write-Host "  $apiKey — scope выдан явно, а не пустым списком"

# --- Пользователь и лицензия -------------------------------------------------

Write-Host "`n=== Пользователь и лицензия ===" -ForegroundColor Cyan

$reg = Invoke-Plain POST "/auth/register" @{ email = "$Login@example.com"; username = $Login; password = $Password }
if ($reg.Code -ge 300 -and $reg.Code -ne 409) { Die "Регистрация не прошла: HTTP $($reg.Code) $($reg.Body | ConvertTo-Json -Compress)" }

# Почты в деве нет, подтверждаем руками — иначе вход отдаст EMAIL_NOT_VERIFIED.
Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$Login';" | Out-Null
$userId = Sql "SELECT id FROM users WHERE username='$Login';"
if (-not $userId) { Die "Пользователь не создан" }

$productId = (Sql "SELECT id FROM products WHERE slug='fc26';").Trim()
$planId = (Sql "SELECT id FROM license_plans WHERE product_id='$productId' AND slug='30d';").Trim()

$existing = (Sql "SELECT id FROM licenses WHERE user_id='$userId' AND product_id='$productId' AND status IN ('PENDING','ACTIVE') LIMIT 1;").Trim()
if ($existing) {
    Write-Host "  лицензия уже есть: $existing"
    $licId = $existing
} else {
    $lic = (Invoke-Plain POST "/licenses" @{ productId = $productId; planId = $planId; userId = $userId } $adminToken).Body
    if (-not $lic.id) { Die "Лицензия не выдана" }
    $licId = $lic.id
    Write-Host "  выдана: $licId (30 дней, отсчёт начнётся с первой проверки)"
}

# --- Payload -----------------------------------------------------------------

Write-Host "`n=== Payload ===" -ForegroundColor Cyan

$dllSize = (Get-Item $Dll).Length
$dllSha = (Get-FileHash -Path $Dll -Algorithm SHA256).Hash.ToLower()
Write-Host "  $Dll"
Write-Host "  $dllSize байт, sha256 $dllSha"

# Уже опубликованная сборка с тем же содержимым — переиспользуем, чтобы
# не плодить версии на каждый запуск скрипта.
$already = (Sql "SELECT version FROM payload_builds WHERE product_id='$productId' AND is_published=true AND sha256='$dllSha' ORDER BY created_at DESC LIMIT 1;").Trim()
if ($already) {
    Write-Host "  уже опубликована: $already — переиспользую" -ForegroundColor Green
} else {
    $version = "1.0.$(Get-Random -Maximum 9999)"
    $draft = Invoke-Plain POST "/products/$productId/payloads" @{ version = $version } $adminToken
    if ($draft.Code -ne 201) { Die "Черновик не создан: HTTP $($draft.Code) $($draft.Body | ConvertTo-Json -Compress)" }
    $buildId = $draft.Body.id

    $up = Invoke-Plain POST "/products/payloads/$buildId/upload-url" @{ filename = 'fc26mod_ship.dll' } $adminToken
    if ($up.Code -ne 200) { Die "Ссылка на загрузку не получена: HTTP $($up.Code)" }

    # curl, а не Invoke-WebRequest: последний на больших двоичных телах в
    # PS 5.1 умеет молча испортить содержимое.
    $putCode = (& curl.exe -s -o NUL -w "%{http_code}" -X PUT --data-binary "@$Dll" `
                -H "Content-Type: application/octet-stream" $up.Body.uploadUrl)
    if ([int]$putCode -ge 300) { Die "Загрузка в хранилище не прошла: HTTP $putCode" }

    $confirm = Invoke-Plain POST "/products/payloads/$buildId/confirm-upload" @{ objectKey = $up.Body.objectKey } $adminToken
    if ($confirm.Code -ne 200) { Die "Подтверждение не прошло: HTTP $($confirm.Code) $($confirm.Body | ConvertTo-Json -Compress)" }
    if ($confirm.Body.sha256 -ne $dllSha) { Die "Сервер посчитал другой sha256: $($confirm.Body.sha256)" }

    $pub = Invoke-Plain POST "/products/payloads/$buildId/publish" $null $adminToken
    if ($pub.Code -ne 200) { Die "Публикация не прошла: HTTP $($pub.Code) $($pub.Body | ConvertTo-Json -Compress)" }
    Write-Host "  сборка $version опубликована, sha256 сервер посчитал сам" -ForegroundColor Green
}

# --- Config.h ----------------------------------------------------------------

Write-Host "`n=== Config.h ===" -ForegroundColor Cyan

$cfgPath = Join-Path $LauncherDir "Platform\Config.h"
if (-not (Test-Path $cfgPath)) { Die "Не найден $cfgPath" }

$cfg = [System.IO.File]::ReadAllText($cfgPath)
$cfg = $cfg -replace 'kBaseOrigin\[\]\s*=\s*L"[^"]*"',    ('kBaseOrigin[]   = L"' + $Origin + '"')
$cfg = $cfg -replace 'kApiKey\[\]\s*=\s*L"[^"]*"',        ('kApiKey[]       = L"' + $apiKey + '"')
$cfg = $cfg -replace 'kSigningSecret\[\]\s*=\s*"[^"]*"',  ('kSigningSecret[] = "' + $secret + '"')
[System.IO.File]::WriteAllText($cfgPath, $cfg, (New-Object System.Text.UTF8Encoding($false)))

# Секреты в консоль не печатаем: они уже в файле, и повторять их в логе
# терминала незачем.
Write-Host "  origin  = $Origin"
Write-Host "  apiKey  = $apiKey"
Write-Host "  secret  = записан в Config.h (в консоль не выводится)"

# --- Сборка ------------------------------------------------------------------

if (-not $SkipBuild) {
    Write-Host "`n=== Сборка Griloder.exe ===" -ForegroundColor Cyan
    $msbuild = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
    if (-not (Test-Path $msbuild)) { Die "Не найден MSBuild: $msbuild" }

    $log = & $msbuild (Join-Path $LauncherDir "Griloder.vcxproj") /p:Configuration=Release /p:Platform=x64 /v:minimal /nologo /t:Build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "СБОРКА ПРОВАЛЕНА" -ForegroundColor Red
        $log | Select-Object -Last 30 | ForEach-Object { Write-Host "  $_" }
        exit 1
    }
    $warn = $log | Where-Object { $_ -match 'warning' }
    if ($warn) { $warn | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow } }
    Write-Host "  готово: $LauncherDir\x64\Release\Griloder.exe" -ForegroundColor Green
}

# --- Итог --------------------------------------------------------------------

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " ВСЁ ГОТОВО К ЖИВОМУ ЗАПУСКУ" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Логин:  $Login"
Write-Host "  Пароль: $Password"
Write-Host ""
Write-Host "  Лицензия: $licId — 30 дней, отсчёт начнётся с первой проверки"
Write-Host "  Привязка: к диску ЭТОЙ машины, при первом запуске"
Write-Host ""
Write-Host "  Запуск (от администратора, драйвер должен быть загружен):"
Write-Host "    cd $LauncherDir\x64\Release"
Write-Host "    .\Griloder.exe"
Write-Host ""
Write-Host "  Что должно произойти по шагам:"
Write-Host "    1. спросит логин и пароль (второй раз уже не спросит —"
Write-Host "       refresh лежит в %LOCALAPPDATA%\Griloder\rt.bin под DPAPI)"
Write-Host "    2. проверит лицензию и привяжет машину"
Write-Host "    3. заберёт payload, расшифрует в памяти, сверит sha256"
Write-Host "    4. предложит нажать Enter и вставит DLL из памяти"
Write-Host ""
# Обратная кавычка, а не backslash: экранирование в PowerShell своё, и
# \" здесь превращало строку в вызов несуществующей команды.
Write-Host "  Посмотреть, что видел сервер:"
Write-Host "    powershell -File scripts\show-payload-issues.ps1"
Write-Host ""
