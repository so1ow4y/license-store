# ============================================================================
#  Сквозная проверка входа через Telegram.
#
#  Discord здесь не проверяется: для него нужны client_id/client_secret
#  и живой обмен кодом. Telegram проверяется целиком — подпись считается
#  от токена бота, и валидный payload генерируется локально.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-oauth.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres",
    [string]$ApiDir = "$PSScriptRoot\..\apps\api"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-oauth-req.json"
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

# Подписывает данные ровно так, как это делает Telegram:
#   secret = SHA256(bot_token)  — БИНАРНО, не hex
#   hash   = HMAC-SHA256("key=value\n...", secret)
function New-TelegramPayload {
    param([string]$Id, [string]$Username, [string]$FirstName = 'Test', [int]$AgeSec = 0)

    $token = (Select-String -Path "$PSScriptRoot\..\.env" -Pattern '^TELEGRAM_BOT_TOKEN=(.+)$').Matches[0].Groups[1].Value.Trim()

    # ВАЖНО: не Get-Date -UFormat %s.
    #
    # В Windows PowerShell 5.1 этот формат считает epoch от ЛОКАЛЬНОГО
    # времени: при UTC+4 метка уезжает на четыре часа вперёд, и сервер
    # справедливо отбивает её как payload из будущего.
    $authDate = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $AgeSec

    Push-Location $ApiDir
    $hash = node -e @"
const { createHash, createHmac } = require('crypto');
const [token, id, username, firstName, authDate] = process.argv.slice(1);
const fields = { auth_date: authDate, first_name: firstName, id, username };
const check = Object.keys(fields).sort().map(k => k + '=' + fields[k]).join('\n');
const secret = createHash('sha256').update(token, 'utf8').digest();
console.log(createHmac('sha256', secret).update(check, 'utf8').digest('hex'));
"@ $token $Id $Username $FirstName $authDate
    Pop-Location

    return @{
        id = $Id; first_name = $FirstName; username = $Username
        auth_date = "$authDate"; hash = $hash.Trim()
    }
}

# ---------------------------------------------------------------------------

$tgId = "$(Get-Random -Minimum 100000000 -Maximum 999999999)"
$tgUser = "tguser$(Get-Random -Maximum 99999)"
Write-Host "`nTelegram id: $tgId, username: $tgUser" -ForegroundColor DarkGray

Write-Host "`n=== Проверка подписи ===" -ForegroundColor Cyan
$p = New-TelegramPayload $tgId $tgUser
$tampered = $p.Clone(); $tampered.id = "111111111"
$bad = Invoke-Api POST "/auth/telegram/callback" $tampered
Assert "подменённый id отклонён" ($bad.Code -eq 401) "HTTP $($bad.Code)"
Assert "код OAUTH_SIGNATURE_INVALID" ($bad.Body.code -eq 'OAUTH_SIGNATURE_INVALID') $bad.Body.code

$old = New-TelegramPayload $tgId $tgUser -AgeSec 3600
$expired = Invoke-Api POST "/auth/telegram/callback" $old
Assert "устаревший payload отклонён" ($expired.Code -eq 401) "HTTP $($expired.Code)"
Assert "код OAUTH_PAYLOAD_EXPIRED" ($expired.Body.code -eq 'OAUTH_PAYLOAD_EXPIRED') $expired.Body.code

Write-Host "`n=== Первый вход: создание аккаунта ===" -ForegroundColor Cyan
$first = Invoke-Api POST "/auth/telegram/callback" (New-TelegramPayload $tgId $tgUser)
Assert "вход выполнен" ($first.Code -eq 200 -and $first.Body.accessToken) "HTTP $($first.Code)"
Assert "логин взят из Telegram" ($first.Body.user.username -eq $tgUser) $first.Body.user.username
Assert "почты нет — Telegram её не отдаёт" ($null -eq $first.Body.user.email) $first.Body.user.email
$access = $first.Body.accessToken

$me = Invoke-Api GET "/auth/me" $null $access
Assert "requiresPassword = true" ($me.Body.requiresPassword -eq $true) "$($me.Body.requiresPassword)"
Assert "провайдер TELEGRAM в списке" ($me.Body.providers -contains 'TELEGRAM') ($me.Body.providers -join ',')
Assert "права роли user выданы" ($me.Body.permissions -contains 'licenses.read.own') "прав нет"

Write-Host "`n=== Повторный вход: тот же аккаунт ===" -ForegroundColor Cyan
$second = Invoke-Api POST "/auth/telegram/callback" (New-TelegramPayload $tgId $tgUser)
Assert "вход выполнен" ($second.Code -eq 200) "HTTP $($second.Code)"
Assert "тот же пользователь, а не новый" ($second.Body.user.id -eq $first.Body.user.id) `
       "создался дубль: $($first.Body.user.id) -> $($second.Body.user.id)"

$count = (Sql "SELECT count(*) FROM oauth_accounts WHERE provider_user_id='$tgId';").Trim()
Assert "привязка в БД ровно одна" ($count -eq '1') "их $count"

Write-Host "`n=== Занятый логин ===" -ForegroundColor Cyan
# Другой Telegram-аккаунт с тем же username: логин должен получить суффикс.
$tgId2 = "$(Get-Random -Minimum 100000000 -Maximum 999999999)"
$dup = Invoke-Api POST "/auth/telegram/callback" (New-TelegramPayload $tgId2 $tgUser)
Assert "второй аккаунт создан" ($dup.Code -eq 200) "HTTP $($dup.Code)"
Assert "логин получил суффикс" ($dup.Body.user.username -ne $tgUser) "совпал: $($dup.Body.user.username)"
Assert "суффикс осмысленный" ($dup.Body.user.username -like "$tgUser`_*") $dup.Body.user.username

Write-Host "`n=== Отвязка последнего способа входа ===" -ForegroundColor Cyan
$unlink = Invoke-Api DELETE "/auth/oauth/telegram" $null $access
Assert "отвязка запрещена без пароля" ($unlink.Code -eq 409) "HTTP $($unlink.Code)"
Assert "код LAST_LOGIN_METHOD" ($unlink.Body.code -eq 'LAST_LOGIN_METHOD') $unlink.Body.code

Write-Host "`n=== Установка первого пароля ===" -ForegroundColor Cyan
$short = Invoke-Api POST "/auth/password/set" @{ password = "123" } $access
Assert "короткий пароль отклонён" ($short.Code -eq 400) "HTTP $($short.Code)"

$setPwd = Invoke-Api POST "/auth/password/set" @{ password = "TelegramPwd42" } $access
Assert "пароль задан" ($setPwd.Code -eq 200) "HTTP $($setPwd.Code)"

$again = Invoke-Api POST "/auth/password/set" @{ password = "AnotherPwd99" } $access
Assert "повторная установка запрещена" ($again.Code -eq 409) "HTTP $($again.Code)"
Assert "код PASSWORD_ALREADY_SET" ($again.Body.code -eq 'PASSWORD_ALREADY_SET') $again.Body.code

$me2 = Invoke-Api GET "/auth/me" $null $access
Assert "requiresPassword стал false" ($me2.Body.requiresPassword -eq $false) "$($me2.Body.requiresPassword)"

Write-Host "`n=== Вход паролем: загрузчик теперь заработает ===" -ForegroundColor Cyan
$byPwd = Invoke-Api POST "/auth/login" @{ login = $tgUser; password = "TelegramPwd42" }
Assert "вход по логину и паролю" ($byPwd.Code -eq 200 -and $byPwd.Body.accessToken) "HTTP $($byPwd.Code)"

# ---------------------------------------------------------------------------
#  Второй фактор обязателен и на входе через OAuth
#
#  Регрессия на реальную дыру. Проверка 2FA стояла ВНУТРИ парольного входа,
#  а completeLogin был просто выдачей токенов — поэтому вход через Telegram
#  второй фактор не спрашивал вовсе. Человек, включивший 2FA, входил одним
#  запросом к callback'у: обходился ровно тот фактор, ради которого его и
#  включали, причём каналом, который считается вспомогательным.
#
#  Достижимо это было именно отсюда: привязать OAuth к аккаунту с паролем
#  нельзя, а вот аккаунт, начавшийся с Telegram, пароль и 2FA получить может —
#  что этот скрипт выше и делает.
# ---------------------------------------------------------------------------

Write-Host "`n=== Второй фактор при входе через Telegram ===" -ForegroundColor Cyan

$setup = Invoke-Api POST "/auth/2fa/setup" $null $access
Assert "секрет 2FA выдан" ($setup.Code -eq 200 -and $setup.Body.secret) "HTTP $($setup.Code)"

# Код считаем той же библиотекой, что и сервер: иначе тест проверял бы
# согласованность двух своих реализаций, а не работу сервера.
Push-Location $ApiDir
$totp = (node -e "console.log(require('otplib').generateSync({secret: process.argv[1]}))" $setup.Body.secret).Trim()
Pop-Location

$enable = Invoke-Api POST "/auth/2fa/enable" @{ code = $totp } $access
Assert "2FA включена" ($enable.Code -eq 200) "HTTP $($enable.Code)"

$tgWith2fa = Invoke-Api POST "/auth/telegram/callback" (New-TelegramPayload $tgId $tgUser)
Assert "вход через Telegram ТРЕБУЕТ второй фактор" `
       ($tgWith2fa.Body.twoFactorRequired -eq $true) `
       "второй фактор обойдён — вернулись токены вместо challenge"
Assert "выдан challengeToken, а не пара токенов" `
       ($null -ne $tgWith2fa.Body.challengeToken -and $null -eq $tgWith2fa.Body.accessToken) `
       "accessToken присутствует в ответе"

# Challenge от OAuth-входа завершается кодом — иначе гейт превратился бы
# в тупик вместо защиты.
#
# ПОРЯДОК ВАЖЕН: этот шаг идёт СРАЗУ после входа через Telegram, до любого
# другого входа. createTwoFactorChallenge намеренно гасит незакрытые
# challenge того же пользователя (иначе их копится сколько угодно, и каждый
# — отдельная попытка подбора). Вклинь сюда парольный вход — он погасил бы
# challenge от Telegram, и проверка упала бы на CHALLENGE_INVALID, обвиняя
# код в том, чего он не делал.
#
# Ждём СЛЕДУЮЩИЙ код. Тот же самый сервер отвергнет: включение 2FA выше
# уже израсходовало текущий шаг TOTP, а повторное использование кода
# запрещено (twoFactorLastStep). Это защита от перехвата кода из СМС или
# с экрана, и обходить её в тесте значило бы проверять не тот сервер.
$totp2 = $totp
for ($i = 0; $i -lt 35 -and $totp2 -eq $totp; $i++) {
    Start-Sleep -Seconds 1
    Push-Location $ApiDir
    $totp2 = (node -e "console.log(require('otplib').generateSync({secret: process.argv[1]}))" $setup.Body.secret).Trim()
    Pop-Location
}
Assert "новый код TOTP появился" ($totp2 -ne $totp) "код не сменился за 35 секунд"

$finish = Invoke-Api POST "/auth/2fa/verify" @{ challengeToken = $tgWith2fa.Body.challengeToken; code = $totp2 }
Assert "challenge от Telegram-входа завершается кодом" `
       ($finish.Code -eq 200 -and $finish.Body.accessToken) "HTTP $($finish.Code) $($finish.Body.code)"

$access = $finish.Body.accessToken

# Тот же гейт на парольном пути — убеждаемся, что перенос проверки его не сломал.
$pwdWith2fa = Invoke-Api POST "/auth/login" @{ login = $tgUser; password = "TelegramPwd42" }
Assert "вход паролем тоже требует второй фактор" ($pwdWith2fa.Body.twoFactorRequired -eq $true) `
       "HTTP $($pwdWith2fa.Code)"

$unlink2 = Invoke-Api DELETE "/auth/oauth/telegram" $null $access
Assert "теперь отвязка разрешена" ($unlink2.Code -eq 200) "HTTP $($unlink2.Code)"

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
