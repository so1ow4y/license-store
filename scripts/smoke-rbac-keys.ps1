# ============================================================================
#  Проверка применения прав, журнала аудита и регистрации по ключу.
#
#  Главное здесь — что обычный пользователь НЕ может выпускать ключи.
#  До появления PermissionsGuard мог любой аутентифицированный.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-rbac-keys.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-rbac-req.json"
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

function Sql { param([string]$Q) ($Q | docker exec -i $PgContainer psql -U lp -d license_platform -t -A 2>&1) }

function New-ActiveUser {
    $u = "rbac$(Get-Random -Maximum 999999)"
    $r = Invoke-Api POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = "CorrectHorse42" }
    if ($r.Code -ne 201) { throw "регистрация не прошла: HTTP $($r.Code)" }
    Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
    $login = Invoke-Api POST "/auth/login" @{ login = $u; password = "CorrectHorse42" }
    return [PSCustomObject]@{ Username = $u; Token = $login.Body.accessToken }
}

# ---------------------------------------------------------------------------

Write-Host "`n=== Обычный пользователь ===" -ForegroundColor Cyan
$plain = New-ActiveUser
Assert "вход выполнен" ($null -ne $plain.Token) "нет токена"

$denied = Invoke-Api POST "/auth/registration-keys" @{ count = 5 } $plain.Token
Assert "выпуск ключей ЗАПРЕЩЁН" ($denied.Code -eq 403) "HTTP $($denied.Code) — любой юзер может печатать ключи!"
Assert "код FORBIDDEN" ($denied.Body.code -eq 'FORBIDDEN') $denied.Body.code
Assert "не раскрыто, какое право нужно" ($denied.Body.message -notmatch 'licenses\.create') $denied.Body.message

Write-Host "`n=== Администратор ===" -ForegroundColor Cyan
. "$PSScriptRoot\_admin-token.ps1"
$admin = [PSCustomObject]@{ Code = 200; Body = [PSCustomObject]@{ accessToken = (Get-AdminToken -Base $Base) } }
Assert "админ вошёл" ($admin.Code -eq 200) "HTTP $($admin.Code) — проверь SEED_ADMIN_PASSWORD"
$adminToken = $admin.Body.accessToken

$issued = Invoke-Api POST "/auth/registration-keys" @{ count = 3 } $adminToken
Assert "выпуск разрешён" ($issued.Code -eq 201) "HTTP $($issued.Code)"
Assert "выпущено 3 ключа" ($issued.Body.codes.Count -eq 3) "$($issued.Body.codes.Count)"
Assert "формат XXXX-XXXX-XXXX-XXXX" ($issued.Body.codes[0] -match '^[ACDEFGHJKMNPQRTUVWXYZ2346789]{4}(-[ACDEFGHJKMNPQRTUVWXYZ2346789]{4}){3}$') $issued.Body.codes[0]
# Из каждой неоднозначной пары в алфавите остаётся максимум один символ:
# 0/O, 1/I/L, 8/B, 5/S. Убирать оба не нужно — достаточно снять двусмысленность.
Assert "исключены O, I, L, B, S и цифры 0, 1, 5" (($issued.Body.codes -join '') -notmatch '[OILBS015]') "остались двусмысленные символы"
Assert "коды не повторяются" (($issued.Body.codes | Select-Object -Unique).Count -eq 3) "есть дубли"

Write-Host "`n=== Журнал аудита ===" -ForegroundColor Cyan
Start-Sleep -Seconds 1
$auditCount = (Sql "SELECT count(*) FROM audit_logs WHERE action='registration_key.issue';").Trim()
Assert "запись в аудите появилась" ([int]$auditCount -ge 1) "записей: $auditCount"

$leaked = (Sql "SELECT count(*) FROM audit_logs WHERE action='registration_key.issue' AND after::text LIKE '%$($issued.Body.codes[0])%';").Trim()
Assert "коды ключей в аудит НЕ попали" ($leaked -eq '0') "код найден в журнале — он предъявительский"

Write-Host "`n=== Регистрация по ключу ===" -ForegroundColor Cyan
$code = $issued.Body.codes[0]
$newUser = "keyuser$(Get-Random -Maximum 99999)"

$bad = Invoke-Api POST "/auth/register-with-key" @{ code = "XXXX-XXXX-XXXX-XXXX"; username = $newUser; password = "KeyPassword42" }
Assert "несуществующий ключ отклонён" ($bad.Code -eq 401) "HTTP $($bad.Code)"

$reg = Invoke-Api POST "/auth/register-with-key" @{ code = $code; username = $newUser; password = "KeyPassword42" }
Assert "регистрация прошла" ($reg.Code -eq 200 -and $reg.Body.accessToken) "HTTP $($reg.Code)"
Assert "аккаунт сразу активен" ($null -ne $reg.Body.user.id) "нет пользователя"

$reuse = Invoke-Api POST "/auth/register-with-key" @{ code = $code; username = "$newUser`2"; password = "KeyPassword42" }
Assert "тот же ключ второй раз не работает" ($reuse.Code -eq 409) "HTTP $($reuse.Code)"
Assert "код KEY_ALREADY_USED" ($reuse.Body.code -eq 'KEY_ALREADY_USED') $reuse.Body.code

$used = (Sql "SELECT used_by_user_id IS NOT NULL FROM registration_keys WHERE code='$code';").Trim()
Assert "ключ помечен использованным" ($used -eq 't') "used_by_user_id пуст"

Write-Host "`n=== Ключ с лицензией ===" -ForegroundColor Cyan
$product = (Sql "SELECT id FROM products WHERE slug='fc26';").Trim()
$plan = (Sql "SELECT id FROM license_plans WHERE product_id='$product' AND slug='30d';").Trim()

$mismatch = Invoke-Api POST "/auth/registration-keys" @{ count = 1; productId = $product } $adminToken
Assert "продукт без тарифа отклонён" ($mismatch.Code -eq 400) "HTTP $($mismatch.Code)"

$withLicense = Invoke-Api POST "/auth/registration-keys" @{ count = 1; productId = $product; planId = $plan } $adminToken
Assert "ключ с лицензией выпущен" ($withLicense.Code -eq 201) "HTTP $($withLicense.Code)"

$licUser = "licuser$(Get-Random -Maximum 99999)"
$regLic = Invoke-Api POST "/auth/register-with-key" @{ code = $withLicense.Body.codes[0]; username = $licUser; password = "KeyPassword42" }
Assert "регистрация с лицензией прошла" ($regLic.Code -eq 200) "HTTP $($regLic.Code)"

$lic = (Sql "SELECT status || '|' || coalesce(expires_at::text,'NULL') FROM licenses WHERE user_id=(SELECT id FROM users WHERE username='$licUser');").Trim()
Assert "лицензия создана" ($lic -ne '') "лицензии нет"
Assert "статус PENDING, срок не начат" ($lic -eq 'PENDING|NULL') "$lic — срок должен идти от первого запуска, а не от выдачи"

Write-Host "`n=== Активация ключа на существующем аккаунте ===" -ForegroundColor Cyan
$extra = Invoke-Api POST "/auth/registration-keys" @{ count = 1; productId = $product; planId = $plan } $adminToken
$redeem = Invoke-Api POST "/auth/redeem-key" @{ code = $extra.Body.codes[0] } $plain.Token
Assert "ключ активирован" ($redeem.Code -eq 200) "HTTP $($redeem.Code)"
Assert "выдан ключ лицензии" ($redeem.Body.licenseKey -like 'FC26-*') $redeem.Body.licenseKey

# ---------------------------------------------------------------------------
#  Регрессии по находкам состязательного ревью авторизации.
#  Каждая проверка соответствует подтверждённой атаке.
# ---------------------------------------------------------------------------

Write-Host "`n=== Блокировка не снимается подтверждением почты ===" -ForegroundColor Cyan
# verify-email безусловно ставил статус ACTIVE. Токен живёт сутки, и
# заблокированный за это время снимал блокировку сам, публичным запросом.
$victim = "blocked$(Get-Random -Maximum 99999)"
Invoke-Api POST "/auth/register" @{ email = "$victim@example.com"; username = $victim; password = "CorrectHorse42" } | Out-Null
Start-Sleep -Seconds 8

$mail = (& curl.exe -s "http://localhost:8025/api/v1/search?query=to%3A$victim%40example.com" | ConvertFrom-Json)
$mailBody = (& curl.exe -s "http://localhost:8025/api/v1/message/$($mail.messages[0].ID)" | ConvertFrom-Json).Text
$verifyToken = [regex]::Match($mailBody, 'token=([A-Za-z0-9_\-]+)').Groups[1].Value
Assert "токен подтверждения получен из письма" ($verifyToken -ne '') "письмо не пришло"

Sql "UPDATE users SET status='BLOCKED', blocked_at=now() WHERE username='$victim';" | Out-Null

$unblock = Invoke-Api POST "/auth/verify-email" @{ token = $verifyToken }
Assert "заблокированный НЕ снимает блокировку" ($unblock.Code -eq 401) "HTTP $($unblock.Code) — блокировка снимается публичным запросом!"

$stillBlocked = (Sql "SELECT status FROM users WHERE username='$victim';").Trim()
Assert "статус остался BLOCKED" ($stillBlocked -eq 'BLOCKED') "стал $stillBlocked"

Write-Host "`n=== Скрытый продукт не виден публично ===" -ForegroundColor Cyan
$hiddenSlug = "hidden$(Get-Random -Maximum 99999)"
$hidden = Invoke-Api POST "/products" @{ slug = $hiddenSlug; name = 'Ещё не выпущен' } $adminToken
Assert "скрытый продукт создан" ($hidden.Code -eq 201) "HTTP $($hidden.Code)"

$peek = Invoke-Api GET "/products/$hiddenSlug"
Assert "публично отвечает 404" ($peek.Code -eq 404) "HTTP $($peek.Code) — перебор кодов выдаёт невыпущенные продукты"

$adminPeek = Invoke-Api GET "/products/admin/$($hidden.Body.id)" $null $adminToken
Assert "админ карточку видит" ($adminPeek.Code -eq 200) "HTTP $($adminPeek.Code)"

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
