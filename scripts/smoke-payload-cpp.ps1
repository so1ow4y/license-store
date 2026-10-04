# ============================================================================
#  Живой круг ТЗ §7 глазами КЛИЕНТА НА C++.
#
#  smoke-payload.mjs проверяет сервер, повторяя криптографию на Node.
#  Здесь наоборот: подпись, разбор заголовков, вывод ключа, сборку AAD и
#  расшифровку делает тот самый код на C++, который поедет пользователю.
#  Расхождение канонизации или KDF видно ИСКЛЮЧИТЕЛЬНО как провал GCM-тега,
#  то есть без диагностики, — и всплыть оно должно здесь, а не у людей.
#
#  Скрипт сам: выпускает ключ сборки со scope, заводит пользователя с
#  лицензией, заливает настоящий DLL, публикует сборку, компилирует тест,
#  прогоняет и убирает за собой.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-payload-cpp.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$Origin = "http://localhost:3000",
    [string]$PgContainer = "lp-postgres",
    [string]$LauncherDir = "C:\Users\user\work\gripulialoader\Griloder",
    [string]$Dll = "C:\Users\user\work\chipa\productionFC26\out\Release\x64\fc26mod_ship.dll",
    [string]$VcVars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-payload-cpp-req.json"

function Sql { param([string]$Q) ($Q | docker exec -i $PgContainer psql -U lp -d license_platform -t -A 2>&1) }

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

# --- Проверки окружения ------------------------------------------------------

foreach ($p in @($VcVars, $Dll, (Join-Path $LauncherDir "Platform\Tests\test_integration_payload.cpp"))) {
    if (-not (Test-Path $p)) { Write-Host "Не найдено: $p" -ForegroundColor Red; exit 2 }
}

# --- Подготовка --------------------------------------------------------------

Write-Host "`n=== Подготовка ===" -ForegroundColor Cyan

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base
if (-not $adminToken) { Write-Host "Не удалось войти администратором" -ForegroundColor Red; exit 1 }

# Ключ с ЯВНЫМ scope, а не пустым: пустой пропускается по переходному
# правилу, и тест тогда проверял бы послабление, а не работу гварда.
$key = Invoke-Plain POST "/auth/api-keys" @{
    name   = "payload C++ smoke $(Get-Random)"
    scopes = @('launcher:payload', 'launcher:check', 'launcher:update', 'launcher:logs')
} $adminToken
if ($key.Code -ne 201) { Write-Host "Ключ сборки не выпущен: HTTP $($key.Code)" -ForegroundColor Red; exit 1 }
$apiKey = $key.Body.prefix
$secret = $key.Body.signingSecret
Write-Host "  ключ сборки: $apiKey (scope выдан явно)"

$u = "pcpp$(Get-Random -Maximum 999999)"
$pw = "CorrectHorse42"
Invoke-Plain POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = $pw } | Out-Null
Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
$userId = (Sql "SELECT id FROM users WHERE username='$u';").Trim()
if (-not $userId) { Write-Host "Пользователь не создан" -ForegroundColor Red; exit 1 }

$productId = (Sql "SELECT id FROM products WHERE slug='fc26';").Trim()
$planId = (Sql "SELECT id FROM license_plans WHERE product_id='$productId' AND slug='30d';").Trim()
$lic = (Invoke-Plain POST "/licenses" @{ productId = $productId; planId = $planId; userId = $userId } $adminToken).Body
if (-not $lic.id) { Write-Host "Лицензия не выдана" -ForegroundColor Red; exit 1 }
Write-Host "  пользователь: $u, лицензия: $($lic.id)"

# --- Заливка payload ---------------------------------------------------------

Write-Host "`n=== Заливка payload ===" -ForegroundColor Cyan

$dllBytes = [System.IO.File]::ReadAllBytes($Dll)
$dllSha = (Get-FileHash -Path $Dll -Algorithm SHA256).Hash.ToLower()
Write-Host "  $Dll"
Write-Host "  $($dllBytes.Length) байт, sha256 $dllSha"

$version = "9.$(Get-Random -Maximum 900).0"
$draft = Invoke-Plain POST "/products/$productId/payloads" @{ version = $version } $adminToken
if ($draft.Code -ne 201) { Write-Host "Черновик не создан: HTTP $($draft.Code)" -ForegroundColor Red; exit 1 }
$buildId = $draft.Body.id

$up = Invoke-Plain POST "/products/payloads/$buildId/upload-url" @{ filename = 'fc26mod_ship.dll' } $adminToken
if ($up.Code -ne 200) { Write-Host "Ссылка на загрузку не получена: HTTP $($up.Code)" -ForegroundColor Red; exit 1 }

# curl, а не Invoke-WebRequest: последний на больших телах в PS 5.1 держит
# всё в памяти и умеет молча испортить двоичные данные.
$putCode = (& curl.exe -s -o NUL -w "%{http_code}" -X PUT --data-binary "@$Dll" `
            -H "Content-Type: application/octet-stream" $up.Body.uploadUrl)
if ([int]$putCode -ge 300) { Write-Host "Загрузка в хранилище не прошла: HTTP $putCode" -ForegroundColor Red; exit 1 }

$confirm = Invoke-Plain POST "/products/payloads/$buildId/confirm-upload" @{ objectKey = $up.Body.objectKey } $adminToken
if ($confirm.Code -ne 200) { Write-Host "Подтверждение не прошло: HTTP $($confirm.Code)" -ForegroundColor Red; exit 1 }
if ($confirm.Body.sha256 -ne $dllSha) {
    Write-Host "СЕРВЕР ПОСЧИТАЛ ДРУГОЙ sha256: $($confirm.Body.sha256)" -ForegroundColor Red
    exit 1
}
Write-Host "  сервер сам посчитал sha256 и он совпал"

$pub = Invoke-Plain POST "/products/payloads/$buildId/publish" $null $adminToken
if ($pub.Code -ne 200) { Write-Host "Публикация не прошла: HTTP $($pub.Code)" -ForegroundColor Red; exit 1 }
Write-Host "  сборка $version опубликована"

# --- Сборка теста ------------------------------------------------------------

Write-Host "`n=== Сборка теста ===" -ForegroundColor Cyan

# vcvars64.bat на этой машине не находит vswhere.exe и оставляет в LIB только
# Windows Kits — линковка падает на msvcprt.lib. Каталог MSVC считаем сами.
$msvcRoot = Join-Path (Split-Path (Split-Path (Split-Path $VcVars))) "Tools\MSVC"
$newest = Get-ChildItem $msvcRoot -Directory -ErrorAction SilentlyContinue |
          Sort-Object Name -Descending |
          Where-Object { Test-Path (Join-Path $_.FullName "lib\x64\msvcprt.lib") } |
          Select-Object -First 1
if (-not $newest) { Write-Host "Не найден каталог библиотек MSVC под $msvcRoot" -ForegroundColor Red; exit 2 }
$libPath = Join-Path $newest.FullName "lib\x64"

$outDir = Join-Path $env:TEMP "lp-payload-cpp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir "test_integration_payload.exe"

$sources = @(
    "Platform\Tests\test_integration_payload.cpp",
    "Platform\Payload.cpp", "Platform\AesGcm.cpp", "Platform\Hkdf.cpp",
    "Platform\Api.cpp", "Platform\Http.cpp", "Platform\Common.cpp",
    "Platform\Config.cpp", "Platform\ErrorEnvelope.cpp", "Platform\Hex.cpp",
    "Platform\Nonce.cpp", "Platform\Sha.cpp", "Platform\Signature.cpp",
    "Platform\TokenManager.cpp"
) -join ' '

$build = "call `"$VcVars`" >nul 2>&1 && cd /d `"$LauncherDir`" && cl /std:c++17 /EHsc /nologo /W3 /MD " +
         "/Fo:`"$outDir\\`" /Fe:`"$exe`" $sources /link /LIBPATH:`"$libPath`" winhttp.lib bcrypt.lib"
$buildLog = & cmd.exe /c $build 2>&1
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) {
    Write-Host "СБОРКА ПРОВАЛЕНА" -ForegroundColor Red
    $buildLog | ForEach-Object { Write-Host "  $_" }
    exit 1
}
$warnings = $buildLog | Where-Object { $_ -match 'warning C' }
if ($warnings) {
    Write-Host "  предупреждения компилятора:" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
} else {
    Write-Host "  собрано без предупреждений" -ForegroundColor Green
}

# --- Прогон ------------------------------------------------------------------

Write-Host "`n=== Прогон ===" -ForegroundColor Cyan

$env:LP_ORIGIN   = $Origin
$env:LP_API_KEY  = $apiKey
$env:LP_SECRET   = $secret
$env:LP_LOGIN    = $u
$env:LP_PASSWORD = $pw
$env:LP_PRODUCT  = 'fc26'
$env:LP_HWID     = "WD-CPP-PL-$(Get-Random -Maximum 999999)"
$env:LP_DLL      = $Dll

& $exe
$testExit = $LASTEXITCODE

Remove-Item Env:LP_SECRET, Env:LP_PASSWORD, Env:LP_API_KEY -ErrorAction SilentlyContinue

# --- Уборка ------------------------------------------------------------------

Invoke-Plain POST "/products/payloads/$buildId/unpublish" $null $adminToken | Out-Null
$keyId = (Sql "SELECT id FROM api_keys WHERE prefix='$apiKey';").Trim()
if ($keyId) { Invoke-Plain DELETE "/auth/api-keys/$keyId" $null $adminToken | Out-Null }

Write-Host ""
if ($testExit -eq 0) {
    Write-Host "КЛИЕНТ НА C++ ПОЛУЧИЛ И РАСШИФРОВАЛ НАСТОЯЩИЙ PAYLOAD" -ForegroundColor Green
} else {
    Write-Host "ЕСТЬ РАСХОЖДЕНИЯ (код выхода $testExit)" -ForegroundColor Red
}
exit $testExit
