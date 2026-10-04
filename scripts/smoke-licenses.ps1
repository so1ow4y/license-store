# ============================================================================
#  Лицензии: выдача, активация, продление, блокировка, отзыв.
#
#  Ключевые правила, которые здесь проверяются:
#    * срок начинается с ПЕРВОГО ЗАПУСКА, а не с выдачи;
#    * продление считается от большей из дат — срока и текущего момента;
#    * разблокировка не воскрешает истёкшую;
#    * область видимости: пользователь видит только свои.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-licenses.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-lic-req.json"
$script:failed = 0

function Invoke-Api {
    param([string]$Method, [string]$Path, $Body, [string]$Token)
    $curlArgs = @('-s', '-w', "`n%{http_code}", '-X', $Method, "$Base$Path",
                  '-H', 'Content-Type: application/json')
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }
    if ($Body) {
        [System.IO.File]::WriteAllText($tmp, ($Body | ConvertTo-Json -Compress -Depth 6),
                                       (New-Object System.Text.UTF8Encoding($false)))
        $curlArgs += @('--data-binary', "@$tmp")
    }
    $raw = (& curl.exe @curlArgs) -join "`n"
    $parts = $raw -split "`n"
    $bodyText = ($parts[0..($parts.Count - 2)] -join "`n")
    $parsed = $null
    if ($bodyText) { try { $parsed = $bodyText | ConvertFrom-Json } catch { $parsed = $bodyText } }
    return [PSCustomObject]@{ Code = [int]$parts[-1]; Body = $parsed }
}

function Assert {
    param([string]$Name, [bool]$Condition, [string]$Detail)
    if ($Condition) { Write-Host ("  [OK]   {0}" -f $Name) -ForegroundColor Green }
    else { Write-Host ("  [FAIL] {0} — {1}" -f $Name, $Detail) -ForegroundColor Red; $script:failed++ }
}

function Sql { param([string]$Q) ($Q | docker exec -i $PgContainer psql -U lp -d license_platform -t -A 2>&1) }

function New-User {
    $u = "lic$(Get-Random -Maximum 999999)"
    Invoke-Api POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = "CorrectHorse42" } | Out-Null
    Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
    $login = Invoke-Api POST "/auth/login" @{ login = $u; password = "CorrectHorse42" }
    return [PSCustomObject]@{
        Username = $u
        Token = $login.Body.accessToken
        Id = (Sql "SELECT id FROM users WHERE username='$u';").Trim()
    }
}

# ---------------------------------------------------------------------------

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base
$owner = New-User
$stranger = New-User

$product = (Sql "SELECT id FROM products WHERE slug='fc26';").Trim()
$plan30 = (Sql "SELECT id FROM license_plans WHERE product_id='$product' AND slug='30d';").Trim()
$planLife = (Sql "SELECT id FROM license_plans WHERE product_id='$product' AND slug='lifetime';").Trim()

Write-Host "`n=== Выдача ===" -ForegroundColor Cyan
$denied = Invoke-Api POST "/licenses" @{ productId = $product; planId = $plan30 } $owner.Token
Assert "обычный пользователь не выдаёт лицензии" ($denied.Code -eq 403) "HTTP $($denied.Code)"

$issued = Invoke-Api POST "/licenses" @{ productId = $product; planId = $plan30; userId = $owner.Id } $adminToken
Assert "лицензия выдана" ($issued.Code -eq 201) "HTTP $($issued.Code)"
Assert "статус PENDING" ($issued.Body.status -eq 'PENDING') $issued.Body.status
Assert "СРОК НЕ НАЧАТ при выдаче" ($null -eq $issued.Body.expiresAt) "$($issued.Body.expiresAt) — подаренный ключ протухнет, пока лежит"
Assert "ключ содержит код продукта" ($issued.Body.key -like 'FC26-*') $issued.Body.key
$licId = $issued.Body.id

$mismatch = Invoke-Api POST "/licenses" @{ productId = $product; planId = '019fbb00-0000-7000-8000-000000000001' } $adminToken
Assert "чужой тариф отклонён" ($mismatch.Code -eq 400) "HTTP $($mismatch.Code)"

Write-Host "`n=== Область видимости ===" -ForegroundColor Cyan
$mine = Invoke-Api GET "/licenses" $null $owner.Token
Assert "владелец видит свою" (@($mine.Body.items | Where-Object { $_.id -eq $licId }).Count -eq 1) "не видит"

$theirs = Invoke-Api GET "/licenses" $null $stranger.Token
Assert "посторонний НЕ видит чужую" (@($theirs.Body.items | Where-Object { $_.id -eq $licId }).Count -eq 0) "видит чужую лицензию!"

$byIdStranger = Invoke-Api GET "/licenses/$licId" $null $stranger.Token
Assert "прямой доступ к чужой запрещён" ($byIdStranger.Code -eq 403) "HTTP $($byIdStranger.Code)"

$byIdAdmin = Invoke-Api GET "/licenses/$licId" $null $adminToken
Assert "админ видит любую" ($byIdAdmin.Code -eq 200) "HTTP $($byIdAdmin.Code)"

# Поиск не должен обходить фильтр по владельцу.
$searchLeak = Invoke-Api GET "/licenses?search=FC26" $null $stranger.Token
Assert "поиск не обходит область видимости" (@($searchLeak.Body.items | Where-Object { $_.id -eq $licId }).Count -eq 0) "поиском видна чужая!"

Write-Host "`n=== Продление до активации ===" -ForegroundColor Cyan
$earlyExtend = Invoke-Api POST "/licenses/$licId/extend" @{} $adminToken
Assert "неактивированную продлить нельзя" ($earlyExtend.Code -eq 409) "HTTP $($earlyExtend.Code)"
Assert "код LICENSE_NOT_ACTIVATED" ($earlyExtend.Body.code -eq 'LICENSE_NOT_ACTIVATED') $earlyExtend.Body.code

Write-Host "`n=== Активация ===" -ForegroundColor Cyan
# Активация идёт из Launcher API, которого ещё нет — эмулируем через БД,
# вызывая ту же логику: статус ACTIVE и срок от текущего момента.
Sql "UPDATE licenses SET status='ACTIVE', activated_at=now(), expires_at=now() + interval '30 days' WHERE id='$licId';" | Out-Null
$afterAct = (Invoke-Api GET "/licenses/$licId" $null $adminToken).Body
Assert "срок появился после активации" ($null -ne $afterAct.expiresAt) "срока нет"

Write-Host "`n=== Продление: остаток не теряется ===" -ForegroundColor Cyan
$before = [datetime]$afterAct.expiresAt
$ext = Invoke-Api POST "/licenses/$licId/extend" @{} $adminToken
Assert "продление прошло" ($ext.Code -eq 200) "HTTP $($ext.Code)"
$after = [datetime]$ext.Body.expiresAt
$delta = ($after - $before).TotalDays
Assert "добавлено ровно 30 дней к остатку" ([math]::Abs($delta - 30) -lt 0.1) `
       "добавлено $([math]::Round($delta,2)) дн. — продливший заранее теряет остаток"

Write-Host "`n=== Продление истёкшей ===" -ForegroundColor Cyan
Sql "UPDATE licenses SET status='EXPIRED', expires_at=now() - interval '7 days' WHERE id='$licId';" | Out-Null
$extExpired = Invoke-Api POST "/licenses/$licId/extend" @{} $adminToken
Assert "истёкшая продлена" ($extExpired.Code -eq 200) "HTTP $($extExpired.Code)"
Assert "статус вернулся в ACTIVE" ($extExpired.Body.status -eq 'ACTIVE') $extExpired.Body.status
$daysLeft = ([datetime]$extExpired.Body.expiresAt - (Get-Date)).TotalDays
Assert "отсчёт от СЕГОДНЯ, а не от истёкшей даты" ([math]::Abs($daysLeft - 30) -lt 0.2) `
       "осталось $([math]::Round($daysLeft,2)) дн. — опоздавший получил меньше оплаченного"

Write-Host "`n=== Бессрочный тариф ===" -ForegroundColor Cyan
$toLife = Invoke-Api POST "/licenses/$licId/extend" @{ planId = $planLife } $adminToken
Assert "переход на бессрочный" ($toLife.Code -eq 200) "HTTP $($toLife.Code)"
Assert "срок снят совсем" ($null -eq $toLife.Body.expiresAt) "$($toLife.Body.expiresAt)"

Write-Host "`n=== Блокировка ===" -ForegroundColor Cyan
$block = Invoke-Api POST "/licenses/$licId/block" @{ reason = 'Передача доступа третьим лицам' } $adminToken
Assert "лицензия заблокирована" ($block.Code -eq 200 -and $block.Body.status -eq 'BLOCKED') "HTTP $($block.Code)"
Assert "причина сохранена" ($block.Body.blockedReason -like '*третьим лицам*') $block.Body.blockedReason

$unblock = Invoke-Api POST "/licenses/$licId/unblock" $null $adminToken
Assert "разблокирована" ($unblock.Code -eq 200) "HTTP $($unblock.Code)"
Assert "вернулась в ACTIVE" ($unblock.Body.status -eq 'ACTIVE') $unblock.Body.status

Write-Host "`n=== Разблокировка не воскрешает истёкшую ===" -ForegroundColor Cyan
Sql "UPDATE licenses SET status='BLOCKED', expires_at=now() - interval '3 days', blocked_at=now() WHERE id='$licId';" | Out-Null
$unblockExpired = Invoke-Api POST "/licenses/$licId/unblock" $null $adminToken
Assert "истёкшая осталась истёкшей" ($unblockExpired.Body.status -eq 'EXPIRED') `
       "$($unblockExpired.Body.status) — разблокировка воскресила истёкшую"

Write-Host "`n=== Отзыв ===" -ForegroundColor Cyan
$revoke = Invoke-Api POST "/licenses/$licId/revoke" @{ reason = 'Возврат средств' } $adminToken
Assert "лицензия отозвана" ($revoke.Code -eq 200 -and $revoke.Body.status -eq 'REVOKED') "HTTP $($revoke.Code)"
Assert "дата отзыва записана" ($null -ne $revoke.Body.revokedAt) "revokedAt пуст"
Assert "привязка к устройству снята" ($null -eq $revoke.Body.currentDeviceId) "привязка осталась"

$extRevoked = Invoke-Api POST "/licenses/$licId/extend" @{} $adminToken
Assert "отозванную продлить нельзя" ($extRevoked.Code -eq 409) "HTTP $($extRevoked.Code)"

Write-Host "`n=== Аудит ===" -ForegroundColor Cyan
$actions = (Sql "SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs WHERE entity_id='$licId';").Trim()
Assert "все операции в журнале" ($actions -like '*license.block*' -and $actions -like '*license.revoke*') $actions
Write-Host "  записано: $actions" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
