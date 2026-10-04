# ============================================================================
#  Сквозная проверка КЛИЕНТСКОГО кода загрузчика (Platform/Api.cpp) против
#  живого сервера.
#
#  smoke-launcher.ps1 проверяет сервер, повторяя подпись на PowerShell.
#  Здесь наоборот: подпись, заголовки и разбор JSON делает тот самый код на
#  C++, который поедет пользователю. Расхождение в имени поля или в пути
#  всплывает здесь, а не после сборки релиза.
#
#  Скрипт сам: выпускает ключ сборки, заводит пользователя с лицензией,
#  компилирует тест, прогоняет его и убирает ключ за собой.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-launcher-cpp.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$Origin = "http://localhost:3000",
    [string]$PgContainer = "lp-postgres",
    [string]$LauncherDir = "C:\Users\user\work\gripulialoader\Griloder",
    [string]$VcVars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-cpp-req.json"

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

if (-not (Test-Path $VcVars)) {
    Write-Host "Не найден vcvars64.bat: $VcVars" -ForegroundColor Red
    Write-Host "Укажите путь параметром -VcVars" -ForegroundColor Red
    exit 2
}
$testSrc = Join-Path $LauncherDir "Platform\Tests\test_integration_launcher.cpp"
if (-not (Test-Path $testSrc)) {
    Write-Host "Не найден тест: $testSrc" -ForegroundColor Red
    exit 2
}

# --- Подготовка данных -------------------------------------------------------

Write-Host "`n=== Подготовка ===" -ForegroundColor Cyan

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base
if (-not $adminToken) { Write-Host "Не удалось войти администратором" -ForegroundColor Red; exit 1 }

$key = Invoke-Plain POST "/auth/api-keys" @{ name = "C++ smoke $(Get-Random)" } $adminToken
if ($key.Code -ne 201) { Write-Host "Ключ сборки не выпущен: HTTP $($key.Code)" -ForegroundColor Red; exit 1 }
$apiKey = $key.Body.prefix
$secret = $key.Body.signingSecret
Write-Host "  ключ сборки: $apiKey"

$u = "cpp$(Get-Random -Maximum 999999)"
$pw = "CorrectHorse42"
Invoke-Plain POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = $pw } | Out-Null
Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
$userId = (Sql "SELECT id FROM users WHERE username='$u';").Trim()
if (-not $userId) { Write-Host "Пользователь не создан" -ForegroundColor Red; exit 1 }

$product = (Sql "SELECT id FROM products WHERE slug='fc26';").Trim()
$plan = (Sql "SELECT id FROM license_plans WHERE product_id='$product' AND slug='30d';").Trim()
$lic = (Invoke-Plain POST "/licenses" @{ productId = $product; planId = $plan; userId = $userId } $adminToken).Body
if (-not $lic.id) { Write-Host "Лицензия не выдана" -ForegroundColor Red; exit 1 }
Write-Host "  пользователь: $u, лицензия: $($lic.id)"

# --- Сборка ------------------------------------------------------------------

Write-Host "`n=== Сборка теста ===" -ForegroundColor Cyan

$outDir = Join-Path $env:TEMP "lp-cpp-test"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir "test_integration_launcher.exe"

$sources = @(
    "Platform\Tests\test_integration_launcher.cpp",
    "Platform\Api.cpp", "Platform\Http.cpp", "Platform\Common.cpp",
    "Platform\Config.cpp", "Platform\ErrorEnvelope.cpp", "Platform\Hex.cpp",
    "Platform\Nonce.cpp", "Platform\Sha.cpp", "Platform\Signature.cpp",
    "Platform\TokenManager.cpp"
) -join ' '

# На этой машине vcvars64.bat не находит vswhere.exe и оставляет в LIB только
# Windows Kits — без каталога MSVC, из-за чего линковка падает на msvcprt.lib.
# Считаем его сами: путь детерминированный и от сломанного поиска не зависит.
#   ...\VC\Auxiliary\Build\vcvars64.bat → ...\VC → ...\VC\Tools\MSVC
$msvcRoot = Join-Path (Split-Path (Split-Path (Split-Path $VcVars))) "Tools\MSVC"
$msvcLib = ""
if (Test-Path $msvcRoot) {
    $newest = Get-ChildItem $msvcRoot -Directory | Sort-Object Name -Descending |
              Where-Object { Test-Path (Join-Path $_.FullName "lib\x64\msvcprt.lib") } |
              Select-Object -First 1
    if ($newest) { $msvcLib = Join-Path $newest.FullName "lib\x64" }
}
if (-not $msvcLib) {
    Write-Host "Не найден каталог библиотек MSVC под $msvcRoot" -ForegroundColor Red
    Write-Host "Без него линковка упадёт на msvcprt.lib — проверьте установку Build Tools." -ForegroundColor Red
    exit 2
}
Write-Host "  библиотеки MSVC: $msvcLib"
$libPath = "/LIBPATH:`"$msvcLib`""

# cl.exe нужен полноценный vcvars-контекст (INCLUDE/PATH), поэтому через cmd.
$build = "call `"$VcVars`" >nul && cd /d `"$LauncherDir`" && cl /std:c++17 /EHsc /nologo /W3 /MD /Fo:`"$outDir\\`" /Fe:`"$exe`" $sources /link $libPath winhttp.lib bcrypt.lib"
$buildLog = & cmd.exe /c $build 2>&1
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) {
    Write-Host "СБОРКА ПРОВАЛЕНА" -ForegroundColor Red
    $buildLog | ForEach-Object { Write-Host "  $_" }
    exit 1
}
# Предупреждения компилятора — не повод падать, но молчать о них вредно.
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
$env:LP_HWID     = "WD-CPP-$(Get-Random -Maximum 999999)"

& $exe
$testExit = $LASTEXITCODE

# Секреты не должны пережить скрипт в окружении сессии.
Remove-Item Env:LP_SECRET, Env:LP_PASSWORD, Env:LP_API_KEY -ErrorAction SilentlyContinue

# --- Уборка ------------------------------------------------------------------

$keyId = (Sql "SELECT id FROM api_keys WHERE prefix='$apiKey';").Trim()
if ($keyId) { Invoke-Plain DELETE "/auth/api-keys/$keyId" $null $adminToken | Out-Null }

Write-Host ""
if ($testExit -eq 0) {
    Write-Host "КЛИЕНТСКИЙ КОД СОШЁЛСЯ С СЕРВЕРОМ" -ForegroundColor Green
} else {
    Write-Host "ЕСТЬ РАСХОЖДЕНИЯ (код выхода $testExit)" -ForegroundColor Red
}
exit $testExit
