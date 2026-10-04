# ============================================================================
#  Сквозная проверка сброса и смены пароля.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-password.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres",
    [string]$ApiDir = "$PSScriptRoot\..\apps\api"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-pwd-req.json"
$script:failed = 0

function Invoke-Api {
    param([string]$Method, [string]$Path, $Body, [string]$Token)
    $curlArgs = @('-s', '-w', "`n%{http_code}", '-X', $Method, "$Base$Path",
                  '-H', 'Content-Type: application/json')
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }
    if ($Body) {
        [System.IO.File]::WriteAllText($tmp, ($Body | ConvertTo-Json -Compress),
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

function Sql { param([string]$Q) $Q | docker exec -i $PgContainer psql -U lp -d license_platform -t -A 2>&1 }

# Токен сброса уходит только письмом и в БД лежит хешем — восстановить его
# из ответа нельзя, и это правильно. Поэтому для проверки confirm мы кладём
# в БД строку с ЗАРАНЕЕ ИЗВЕСТНЫМ токеном: путь подтверждения при этом
# проверяется целиком, а путь запроса — отдельно, по коду ответа.
function New-ResetToken {
    param([string]$Username, [int]$TtlSec = 3600)
    Push-Location $ApiDir
    $raw = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
    $hash = node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" $raw.Trim()
    $id = node -e "console.log(require('uuid').v7())"
    Pop-Location
    $raw = $raw.Trim(); $hash = $hash.Trim(); $id = $id.Trim()
    Sql @"
INSERT INTO verification_tokens (id, user_id, type, token_hash, expires_at, attempts, created_at)
SELECT '$id', id, 'PASSWORD_RESET', '$hash', now() + interval '$TtlSec seconds', 0, now()
FROM users WHERE username='$Username';
"@ | Out-Null
    return $raw
}

function New-ActiveUser {
    $u = "pwd$(Get-Random -Maximum 999999)"
    $r = Invoke-Api POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = "CorrectHorse42" }
    if ($r.Code -ne 201) { throw "регистрация не прошла: HTTP $($r.Code)" }
    Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
    return $u
}

# ---------------------------------------------------------------------------

$user = New-ActiveUser
$old = "CorrectHorse42"
$new = "BrandNewSecret99"
Write-Host "`nпользователь: $user" -ForegroundColor DarkGray

Write-Host "`n=== Запрос сброса: неразличимость ===" -ForegroundColor Cyan
$known = Invoke-Api POST "/auth/password-reset/request" @{ email = "$user@example.com" }
$unknown = Invoke-Api POST "/auth/password-reset/request" @{ email = "definitely-not-here-9999@example.com" }
Assert "существующий адрес -> 200" ($known.Code -eq 200) "HTTP $($known.Code)"
Assert "несуществующий адрес -> 200" ($unknown.Code -eq 200) "HTTP $($unknown.Code)"
Assert "ответы совпадают" ($known.Body.message -eq $unknown.Body.message) "различаются — форма стала проверялкой"
Assert "токен не утёк в ответ" ($null -eq $known.Body.token) "токен виден клиенту"

Write-Host "`n=== Несколько сессий до сброса ===" -ForegroundColor Cyan
$s1 = Invoke-Api POST "/auth/login" @{ login = $user; password = $old }
$s2 = Invoke-Api POST "/auth/login" @{ login = $user; password = $old }
Assert "две сессии открыты" ($s1.Body.accessToken -and $s2.Body.accessToken) "не открылись"

Write-Host "`n=== Подтверждение сброса ===" -ForegroundColor Cyan
$bad = Invoke-Api POST "/auth/password-reset/confirm" @{ token = "totally-invalid"; newPassword = $new }
Assert "невалидный токен отклонён" ($bad.Code -eq 401) "HTTP $($bad.Code)"

$short = Invoke-Api POST "/auth/password-reset/confirm" @{ token = (New-ResetToken $user); newPassword = "123" }
Assert "короткий пароль отклонён" ($short.Code -eq 400) "HTTP $($short.Code)"

$expired = New-ResetToken $user -TtlSec -60
$exp = Invoke-Api POST "/auth/password-reset/confirm" @{ token = $expired; newPassword = $new }
Assert "истёкший токен отклонён" ($exp.Code -eq 401) "HTTP $($exp.Code)"

$token = New-ResetToken $user
$ok = Invoke-Api POST "/auth/password-reset/confirm" @{ token = $token; newPassword = $new }
Assert "сброс выполнен" ($ok.Code -eq 200) "HTTP $($ok.Code)"

Write-Host "`n=== Последствия сброса ===" -ForegroundColor Cyan
$reuse = Invoke-Api POST "/auth/password-reset/confirm" @{ token = $token; newPassword = "YetAnother123" }
Assert "тот же токен второй раз не работает" ($reuse.Code -eq 401) "HTTP $($reuse.Code)"

$me1 = Invoke-Api GET "/auth/me" $null $s1.Body.accessToken
$me2 = Invoke-Api GET "/auth/me" $null $s2.Body.accessToken
Assert "первая сессия завершена" ($me1.Code -eq 401) "HTTP $($me1.Code)"
Assert "вторая сессия завершена" ($me2.Code -eq 401) "HTTP $($me2.Code)"

$oldLogin = Invoke-Api POST "/auth/login" @{ login = $user; password = $old }
Assert "старый пароль больше не подходит" ($oldLogin.Code -eq 401) "HTTP $($oldLogin.Code)"

$newLogin = Invoke-Api POST "/auth/login" @{ login = $user; password = $new }
Assert "новый пароль работает" ($newLogin.Code -eq 200) "HTTP $($newLogin.Code)"
$access = $newLogin.Body.accessToken

Write-Host "`n=== Смена пароля вошедшим ===" -ForegroundColor Cyan
$other = Invoke-Api POST "/auth/login" @{ login = $user; password = $new }

$wrong = Invoke-Api POST "/auth/password/change" @{ currentPassword = "WrongOne111"; newPassword = "Another12345" } $access
Assert "неверный текущий пароль отклонён" ($wrong.Code -eq 401) "HTTP $($wrong.Code)"

$same = Invoke-Api POST "/auth/password/change" @{ currentPassword = $new; newPassword = $new } $access
Assert "совпадающий новый пароль отклонён" ($same.Code -eq 400) "HTTP $($same.Code)"

$final = "FinalPassword77"
$chg = Invoke-Api POST "/auth/password/change" @{ currentPassword = $new; newPassword = $final } $access
Assert "смена выполнена" ($chg.Code -eq 200) "HTTP $($chg.Code)"

$meSelf = Invoke-Api GET "/auth/me" $null $access
Assert "ТЕКУЩАЯ сессия сохранена" ($meSelf.Code -eq 200) "HTTP $($meSelf.Code) — разлогинили того, кто менял пароль"

$meOther = Invoke-Api GET "/auth/me" $null $other.Body.accessToken
Assert "остальные сессии завершены" ($meOther.Code -eq 401) "HTTP $($meOther.Code)"

$finalLogin = Invoke-Api POST "/auth/login" @{ login = $user; password = $final }
Assert "вход с итоговым паролем" ($finalLogin.Code -eq 200) "HTTP $($finalLogin.Code)"

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
