# ============================================================================
#  Завести пользователя с лицензией на продукт. Ничего больше не трогает:
#  ни ключ сборки, ни Config.h, ни exe — в отличие от setup-live.ps1.
#
#  Нужен, когда сборка уже выпущена и её нельзя пересобирать: setup-live.ps1
#  выпускает НОВЫЙ ключ сборки и переписывает Config.h, после чего все ранее
#  розданные exe перестают проходить проверку подписи.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\add-user.ps1 -Login kent
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres",
    [Parameter(Mandatory = $true)][string]$Login,
    [string]$Password = "",
    [string]$Email = "",
    [string]$ProductSlug = "fc26",
    [string]$PlanSlug = "30d"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-adduser-req.json"

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

if (-not $Password) {
    # Читаемый пароль из словаря был бы удобнее, но словаря под рукой нет,
    # а угадываемый пароль на сервере, который вот-вот станет доступен
    # снаружи, — плохая идея. Ничего секретного в нём нет, но и подбирать
    # его не должно быть тривиально.
    $bytes = New-Object byte[] 9
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $Password = ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x') + '!aA1'
}
if (-not $Email) { $Email = "$Login@example.com" }

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base
if (-not $adminToken) { Die "Не удалось войти администратором — сервер поднят?" }

$reg = Invoke-Plain POST "/auth/register" @{ email = $Email; username = $Login; password = $Password }
if ($reg.Code -ge 300 -and $reg.Code -ne 409) {
    Die "Регистрация не прошла: HTTP $($reg.Code) $($reg.Body | ConvertTo-Json -Compress)"
}
if ($reg.Code -eq 409) { Write-Host "  пользователь уже существовал — пароль НЕ менялся" -ForegroundColor Yellow }

# Почтового подтверждения в деве нет, иначе вход отдаст EMAIL_NOT_VERIFIED.
Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$Login';" | Out-Null
$userId = Sql "SELECT id FROM users WHERE username='$Login';"
if (-not $userId) { Die "Пользователь не создан" }

$productId = Sql "SELECT id FROM products WHERE slug='$ProductSlug';"
if (-not $productId) { Die "Нет продукта $ProductSlug" }
$planId = Sql "SELECT id FROM license_plans WHERE product_id='$productId' AND slug='$PlanSlug';"
if (-not $planId) { Die "Нет тарифа $PlanSlug у продукта $ProductSlug" }

$existing = Sql "SELECT id FROM licenses WHERE user_id='$userId' AND product_id='$productId' AND status IN ('PENDING','ACTIVE') LIMIT 1;"
if ($existing) {
    Write-Host "  лицензия уже есть: $existing" -ForegroundColor Yellow
    $licId = $existing
} else {
    $lic = (Invoke-Plain POST "/licenses" @{ productId = $productId; planId = $planId; userId = $userId } $adminToken).Body
    if (-not $lic.id) { Die "Лицензия не выдана" }
    $licId = $lic.id
}

Write-Host ""
Write-Host "  Логин:    $Login"
if ($reg.Code -ne 409) { Write-Host "  Пароль:   $Password" }
Write-Host "  Лицензия: $licId ($ProductSlug / $PlanSlug)"
Write-Host "  Привязка: к диску той машины, где будет первый запуск"
Write-Host ""
