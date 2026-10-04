# ============================================================================
#  Сквозная проверка двухфакторной аутентификации.
#
#  Проверяет не «эндпоинт отвечает 200», а конкретные свойства безопасности:
#  повторное использование кода, лимит попыток, одноразовость кодов
#  восстановления.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-2fa.ps1
# ============================================================================

param(
    # Напрямую в API: через nginx лимит 10 входов в минуту, сценарий в него упрётся.
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres",
    [string]$ApiDir = "$PSScriptRoot\..\apps\api"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-2fa-req.json"
$script:failed = 0

function Invoke-Api {
    param([string]$Method, [string]$Path, $Body, [string]$Token)

    $curlArgs = @('-s', '-w', "`n%{http_code}", '-X', $Method, "$Base$Path",
                  '-H', 'Content-Type: application/json')
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }

    if ($Body) {
        $json = $Body | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
        $curlArgs += @('--data-binary', "@$tmp")
    }

    $raw = (& curl.exe @curlArgs) -join "`n"
    $parts = $raw -split "`n"
    $code = $parts[-1]
    $bodyText = ($parts[0..($parts.Count - 2)] -join "`n")

    $parsed = $null
    if ($bodyText) { try { $parsed = $bodyText | ConvertFrom-Json } catch { $parsed = $bodyText } }
    return [PSCustomObject]@{ Code = [int]$code; Body = $parsed }
}

function Assert {
    param([string]$Name, [bool]$Condition, [string]$Detail)
    if ($Condition) {
        Write-Host ("  [OK]   {0}" -f $Name) -ForegroundColor Green
    } else {
        Write-Host ("  [FAIL] {0} — {1}" -f $Name, $Detail) -ForegroundColor Red
        $script:failed++
    }
}

# Код TOTP считаем той же библиотекой, что и сервер — иначе тест проверял бы
# согласованность двух своих реализаций, а не работу сервера.
function Get-TotpCode {
    param([string]$Secret)
    Push-Location $ApiDir
    $code = node -e "console.log(require('otplib').generateSync({secret: process.argv[1]}))" $Secret
    Pop-Location
    return $code.Trim()
}

# Ждёт наступления следующего 30-секундного шага TOTP.
#
# Нужно потому, что защита от повтора привязана к номеру шага: код, уже
# зачтённый сервером, во второй раз не подойдёт — в том числе тот, которым
# включали второй фактор. Опрос вместо Start-Sleep 30, чтобы не ждать лишнего.
function Wait-NextCode {
    param([string]$Secret, [string]$PreviousCode)
    $deadline = (Get-Date).AddSeconds(35)
    while ((Get-Date) -lt $deadline) {
        $c = Get-TotpCode $Secret
        if ($c -ne $PreviousCode) { return $c }
        Start-Sleep -Milliseconds 1500
    }
    throw "новый код TOTP не появился за 35 секунд"
}

function New-ActiveUser {
    $u = "tfa$(Get-Random -Maximum 999999)"
    $r = Invoke-Api POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = "CorrectHorse42" }
    if ($r.Code -ne 201) { throw "регистрация не прошла: HTTP $($r.Code)" }
    "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" |
        docker exec -i $PgContainer psql -U lp -d license_platform -q 2>&1 | Out-Null
    return $u
}

# ---------------------------------------------------------------------------

$user = New-ActiveUser
$pass = "CorrectHorse42"
Write-Host "`nпользователь: $user" -ForegroundColor DarkGray

Write-Host "`n=== Вход без 2FA ===" -ForegroundColor Cyan
$login = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
Assert "вход выполнен" ($login.Code -eq 200) "HTTP $($login.Code)"
Assert "второй фактор не требуется" ($login.Body.twoFactorRequired -ne $true) "уже включён"
$access = $login.Body.accessToken

Write-Host "`n=== Подключение: шаг 1, setup ===" -ForegroundColor Cyan
$setup = Invoke-Api POST "/auth/2fa/setup" $null $access
Assert "секрет выдан" ($setup.Code -eq 200 -and $setup.Body.secret) "HTTP $($setup.Code)"
Assert "ссылка otpauth:// выдана" ($setup.Body.uri -like 'otpauth://totp/*') $setup.Body.uri
$secret = $setup.Body.secret

# Ключевая проверка: после setup вход ещё НЕ требует кода.
$probe = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
Assert "после setup второй фактор ещё НЕ включён" ($probe.Body.twoFactorRequired -ne $true) `
       "включился раньше подтверждения — криво отсканированный QR отрежет доступ"

Write-Host "`n=== Подключение: шаг 2, enable ===" -ForegroundColor Cyan
$bad = Invoke-Api POST "/auth/2fa/enable" @{ code = "000000" } $access
Assert "неверный код отклонён" ($bad.Code -eq 401) "HTTP $($bad.Code)"

$code = Get-TotpCode $secret
$enable = Invoke-Api POST "/auth/2fa/enable" @{ code = $code } $access
Assert "включение прошло" ($enable.Code -eq 200) "HTTP $($enable.Code)"
Assert "выдано 10 кодов восстановления" ($enable.Body.recoveryCodes.Count -eq 10) `
       "$($enable.Body.recoveryCodes.Count)"
$recovery = $enable.Body.recoveryCodes

Write-Host "`n=== Вход с включённым 2FA ===" -ForegroundColor Cyan
$l2 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
Assert "выдан challenge вместо токенов" ($l2.Body.twoFactorRequired -eq $true) "HTTP $($l2.Code)"
Assert "access-токен НЕ выдан до второго фактора" ($null -eq $l2.Body.accessToken) "токен утёк"
$challenge = $l2.Body.challengeToken

# Код, которым включали 2FA, уже зачтён — ждём следующего шага.
# Это не обход проверки, а её прямое следствие.
$usedCode = Wait-NextCode $secret $code
$v = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $challenge; code = $usedCode }
Assert "верный код завершает вход" ($v.Code -eq 200 -and $v.Body.accessToken) "HTTP $($v.Code)"

Write-Host "`n=== ГЛАВНОЕ: повторное использование кода ===" -ForegroundColor Cyan
# Тот же код, который ТОЛЬКО ЧТО сработал, и новый challenge.
# Код живёт 30 секунд — без защиты он подойдёт второй раз.
$l3 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
$replay = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $l3.Body.challengeToken; code = $usedCode }
Assert "код, только что сработавший, отклонён при повторе" ($replay.Code -eq 401) `
       "HTTP $($replay.Code) — код сработал повторно!"
Assert "код TWO_FACTOR_INVALID" ($replay.Body.code -eq 'TWO_FACTOR_INVALID') $replay.Body.code

Write-Host "`n=== Лимит попыток ===" -ForegroundColor Cyan
$l4 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
$ch4 = $l4.Body.challengeToken
$lastCode = ''
for ($i = 1; $i -le 6; $i++) {
    $r = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $ch4; code = "00000$i" }
    $lastCode = $r.Body.code
}
Assert "после 5 промахов challenge погашен" ($lastCode -eq 'TWO_FACTOR_ATTEMPTS_EXCEEDED') $lastCode

# И даже верный код к погашенному challenge уже не подходит.
$freshCode = Get-TotpCode $secret
$afterBurn = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $ch4; code = $freshCode }
Assert "верный код к погашенному challenge не работает" ($afterBurn.Code -eq 401) "HTTP $($afterBurn.Code)"

Write-Host "`n=== Коды восстановления ===" -ForegroundColor Cyan
$l5 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
$rc = $recovery[0]
$useRc = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $l5.Body.challengeToken; code = $rc }
Assert "код восстановления завершает вход" ($useRc.Code -eq 200 -and $useRc.Body.accessToken) "HTTP $($useRc.Code)"

$l6 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
$reuseRc = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $l6.Body.challengeToken; code = $rc }
Assert "тот же код восстановления второй раз не работает" ($reuseRc.Code -eq 401) "HTTP $($reuseRc.Code)"

$l7 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
$rc2 = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $l7.Body.challengeToken; code = $recovery[1] }
Assert "следующий код восстановления работает" ($rc2.Code -eq 200) "HTTP $($rc2.Code)"
$access2 = $rc2.Body.accessToken

Write-Host "`n=== Отключение ===" -ForegroundColor Cyan
$offCode = Wait-NextCode $secret $usedCode

$wrongPass = Invoke-Api POST "/auth/2fa/disable" @{ password = "WrongPassword1"; code = $offCode } $access2
Assert "без верного пароля не отключается" ($wrongPass.Code -eq 401) "HTTP $($wrongPass.Code)"

$off = Invoke-Api POST "/auth/2fa/disable" @{ password = $pass; code = $offCode } $access2
Assert "отключение прошло" ($off.Code -eq 200) "HTTP $($off.Code)"

$afterOff = Invoke-Api GET "/auth/me" $null $access2
Assert "сессии завершены после отключения" ($afterOff.Code -eq 401) "HTTP $($afterOff.Code)"

$l8 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
Assert "вход снова без второго фактора" ($l8.Body.twoFactorRequired -ne $true) "всё ещё требуется"

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
