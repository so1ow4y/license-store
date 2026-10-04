# ============================================================================
#  Привязка к устройству: первая привязка, сверка, сбросы, лимиты.
#
#  Первая привязка идёт через bindOrVerify, который вызывается из Launcher
#  API — его ещё нет. Здесь он дёргается напрямую через ручную установку
#  привязки администратором: механика та же, отличается только actor.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-hwid.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-hwid-req.json"
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
    $u = "hw$(Get-Random -Maximum 999999)"
    Invoke-Api POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = "CorrectHorse42" } | Out-Null
    Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
    $login = Invoke-Api POST "/auth/login" @{ login = $u; password = "CorrectHorse42" }
    return [PSCustomObject]@{
        Username = $u; Token = $login.Body.accessToken
        Id = (Sql "SELECT id FROM users WHERE username='$u';").Trim()
    }
}

# ---------------------------------------------------------------------------

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base
$owner = New-User
$stranger = New-User

$product = (Sql "SELECT id FROM products WHERE slug='fc26';").Trim()
$plan = (Sql "SELECT id FROM license_plans WHERE product_id='$product' AND slug='30d';").Trim()

$lic = (Invoke-Api POST "/licenses" @{ productId = $product; planId = $plan; userId = $owner.Id } $adminToken).Body
$licId = $lic.id
Sql "UPDATE licenses SET status='ACTIVE', activated_at=now(), expires_at=now() + interval '30 days' WHERE id='$licId';" | Out-Null

Write-Host "`n=== Состояние до привязки ===" -ForegroundColor Cyan
$st = Invoke-Api GET "/licenses/$licId/hwid" $null $owner.Token
Assert "статус доступен владельцу" ($st.Code -eq 200) "HTTP $($st.Code)"
Assert "привязки нет" ($st.Body.bound -eq $false) "уже привязана"
Assert "доступно 3 сброса" ($st.Body.resetsLeft -eq 3) "$($st.Body.resetsLeft)"

$foreign = Invoke-Api GET "/licenses/$licId/hwid" $null $stranger.Token
Assert "посторонний статус не видит" ($foreign.Code -eq 403) "HTTP $($foreign.Code)"

Write-Host "`n=== Состав HWID не раскрывается ===" -ForegroundColor Cyan
$json = $st.Body | ConvertTo-Json -Compress
Assert "в ответе нет ни хеша, ни Disk ID" ($json -notmatch 'hwid|hash|diskId') $json

Write-Host "`n=== Привязка ===" -ForegroundColor Cyan
$diskA = 'WD-WCC4N1234567'
$bind = Invoke-Api POST "/licenses/$licId/hwid/set" @{ diskId = $diskA } $adminToken
Assert "привязка установлена" ($bind.Code -eq 200) "HTTP $($bind.Code)"
Assert "currentDeviceId проставлен" ($null -ne $bind.Body.currentDeviceId) "не проставлен"

$st2 = (Invoke-Api GET "/licenses/$licId/hwid" $null $owner.Token).Body
Assert "статус показывает привязку" ($st2.bound -eq $true) "не показывает"

# Нормализация: тот же диск с другим регистром и пробелами должен дать
# то же устройство, а не завести второе.
$deviceCountBefore = (Sql "SELECT count(*) FROM devices WHERE license_id='$licId';").Trim()
Invoke-Api POST "/licenses/$licId/hwid/set" @{ diskId = '  wd-wcc4n 1234567  ' } $adminToken | Out-Null
$deviceCountAfter = (Sql "SELECT count(*) FROM devices WHERE license_id='$licId';").Trim()
Assert "нормализация не плодит устройства" ($deviceCountBefore -eq $deviceCountAfter) `
       "было $deviceCountBefore, стало $deviceCountAfter — та же машина считается новой"

Write-Host "`n=== Самостоятельный сброс ===" -ForegroundColor Cyan
$r1 = Invoke-Api POST "/licenses/$licId/hwid/reset" $null $owner.Token
Assert "первый сброс прошёл" ($r1.Code -eq 200) "HTTP $($r1.Code)"
Assert "счётчик вырос" ($r1.Body.hwidResetCount -eq 1) "$($r1.Body.hwidResetCount)"
Assert "привязка снята" ($null -eq $r1.Body.currentDeviceId) "осталась"

$notBound = Invoke-Api POST "/licenses/$licId/hwid/reset" $null $owner.Token
Assert "сброс без привязки отклонён" ($notBound.Code -eq 409) "HTTP $($notBound.Code)"
Assert "код NOT_BOUND" ($notBound.Body.code -eq 'NOT_BOUND') $notBound.Body.code

Write-Host "`n=== Кулдаун ===" -ForegroundColor Cyan
Invoke-Api POST "/licenses/$licId/hwid/set" @{ diskId = 'SEAGATE-Z1234567' } $adminToken | Out-Null
$cooldown = Invoke-Api POST "/licenses/$licId/hwid/reset" $null $owner.Token
Assert "повторный сброс в кулдауне отклонён" ($cooldown.Code -eq 409) "HTTP $($cooldown.Code)"
Assert "код HWID_RESET_COOLDOWN" ($cooldown.Body.code -eq 'HWID_RESET_COOLDOWN') $cooldown.Body.code
Assert "дата следующего сброса отдана отдельным полем" ($null -ne $cooldown.Body.details.nextAllowedAt) `
       "клиенту придётся разбирать её из текста"

Write-Host "`n=== Лимит сбросов ===" -ForegroundColor Cyan
# Убираем кулдаун и добиваем счётчик до лимита.
Sql "UPDATE licenses SET last_hwid_reset_at = now() - interval '48 hours', hwid_reset_count = 3 WHERE id='$licId';" | Out-Null
$limit = Invoke-Api POST "/licenses/$licId/hwid/reset" $null $owner.Token
Assert "сброс сверх лимита отклонён" ($limit.Code -eq 409) "HTTP $($limit.Code)"
Assert "код HWID_RESET_LIMIT" ($limit.Body.code -eq 'HWID_RESET_LIMIT') $limit.Body.code

$stLimit = (Invoke-Api GET "/licenses/$licId/hwid" $null $owner.Token).Body
Assert "остаток показывает 0" ($stLimit.resetsLeft -eq 0) "$($stLimit.resetsLeft)"

Write-Host "`n=== Сброс силами поддержки расходует общий лимит ===" -ForegroundColor Cyan
# Решение У-7: счётчик общий. Проверяем, что админский сброс его увеличивает.
Sql "UPDATE licenses SET hwid_reset_count = 1 WHERE id='$licId';" | Out-Null
$staff = Invoke-Api POST "/licenses/$licId/hwid/staff-reset" $null $adminToken
Assert "админ сбросил" ($staff.Code -eq 200) "HTTP $($staff.Code)"
Assert "счётчик увеличился и у админского сброса" ($staff.Body.hwidResetCount -eq 2) `
       "$($staff.Body.hwidResetCount) — общий счётчик не работает"

Write-Host "`n=== Корректировка счётчика ===" -ForegroundColor Cyan
$denied = Invoke-Api POST "/licenses/$licId/hwid/counter" @{ count = 0; comment = 'себе' } $owner.Token
Assert "пользователь счётчик не правит" ($denied.Code -eq 403) "HTTP $($denied.Code)"

$adj = Invoke-Api POST "/licenses/$licId/hwid/counter" @{ count = 1; comment = 'сброс по вине системы' } $adminToken
Assert "поддержка вернула счётчик" ($adj.Code -eq 200 -and $adj.Body.hwidResetCount -eq 1) "HTTP $($adj.Code)"

$bad = Invoke-Api POST "/licenses/$licId/hwid/counter" @{ count = -5; comment = 'x' } $adminToken
Assert "отрицательное значение отклонено" ($bad.Code -eq 400) "HTTP $($bad.Code)"

Write-Host "`n=== История ===" -ForegroundColor Cyan
$hist = Invoke-Api GET "/licenses/$licId/hwid/history" $null $adminToken
Assert "история доступна" ($hist.Code -eq 200) "HTTP $($hist.Code)"
Assert "записи есть" (@($hist.Body).Count -gt 0) "пусто"
$histJson = $hist.Body | ConvertTo-Json -Compress
Assert "хеши в историю не отдаются" ($histJson -notmatch 'HwidHash|hwid_hash') "хеши видны"
Assert "подпись актора сохранена" ($histJson -match 'actorLabel') "нет actorLabel"

$reasons = ($hist.Body | ForEach-Object { $_.reason } | Sort-Object -Unique) -join ','
Write-Host "  причины: $reasons" -ForegroundColor DarkGray
Assert "ручная установка и сбросы различаются" ($reasons -like '*ADMIN_MANUAL_SET*' -and $reasons -like '*USER_RESET*') $reasons

Write-Host "`n=== Уведомления о сбросе ===" -ForegroundColor Cyan
Start-Sleep -Seconds 7
$notif = (Sql "SELECT count(*) FROM notifications WHERE template_key='hwid.reset' AND user_id='$($owner.Id)';").Trim()
Assert "владелец уведомлён о сбросе" ([int]$notif -ge 1) "уведомлений $notif — сброс не владельцем останется незамеченным"

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
