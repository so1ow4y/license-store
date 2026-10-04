# ============================================================================
#  Launcher API: подпись запросов, проверка лицензии, привязка, обновления.
#
#  Подпись считается ровно так же, как её считает загрузчик на C++:
#  METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(BODY), HMAC-SHA256 секретом ключа.
#  Это и есть сквозная проверка того, что контракт сошёлся.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-launcher.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres",
    [string]$ApiDir = "$PSScriptRoot\..\apps\api"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-launcher-req.json"
$script:failed = 0

function Assert {
    param([string]$Name, [bool]$Condition, [string]$Detail)
    if ($Condition) { Write-Host ("  [OK]   {0}" -f $Name) -ForegroundColor Green }
    else { Write-Host ("  [FAIL] {0} — {1}" -f $Name, $Detail) -ForegroundColor Red; $script:failed++ }
}

function Sql { param([string]$Q) ($Q | docker exec -i $PgContainer psql -U lp -d license_platform -t -A 2>&1) }

# Обычный запрос без подписи — для аутентификации.
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

# Подписанный запрос — как его формирует загрузчик.
function Invoke-Signed {
    param(
        [string]$Method, [string]$Path, $Body, [string]$Token,
        [string]$ApiKey, [string]$Secret,
        [int]$TimestampOffset = 0, [string]$ForcedNonce = $null, [string]$ForcedSignature = $null
    )

    $bodyJson = if ($Body) { $Body | ConvertTo-Json -Compress -Depth 6 } else { '' }
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $TimestampOffset

    # Query-строка в подпись НЕ входит (TZ-LAUNCHER §3.1): подписывается
    # только путь. Отрезаем её до вычисления подписи.
    $signPath = "/api/v1" + ($Path -split '\?')[0]

    # Тело передаётся node ЧЕРЕЗ ФАЙЛ, а не аргументом.
    #
    # PowerShell вырезает кавычки при передаче аргументов нативному exe,
    # и JSON доезжает искалеченным: хеш считается от другой строки,
    # подпись не сходится, а выглядит это как ошибка сервера.
    $bodyFile = Join-Path $env:TEMP "lp-sign-body.txt"
    [System.IO.File]::WriteAllText($bodyFile, $bodyJson, (New-Object System.Text.UTF8Encoding($false)))

    Push-Location $ApiDir
    $signed = node -e @"
const { createHash, createHmac, randomBytes } = require('crypto');
const { readFileSync } = require('fs');
const [secret, method, path, ts, bodyFile, forcedNonce] = process.argv.slice(1);
const body = readFileSync(bodyFile, 'utf8');
const nonce = forcedNonce && forcedNonce !== '-' ? forcedNonce : randomBytes(16).toString('hex');
const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
const payload = [method.toUpperCase(), path, ts, nonce, bodyHash].join('\n');
const sig = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
console.log(JSON.stringify({ nonce, sig }));
"@ $Secret $Method $signPath "$ts" $bodyFile ($(if ($ForcedNonce) { $ForcedNonce } else { '-' }))
    Pop-Location

    $s = $signed.Trim() | ConvertFrom-Json
    $signature = if ($ForcedSignature) { $ForcedSignature } else { $s.sig }

    $a = @('-s', '-w', "`n%{http_code}", '-D', '-', '-X', $Method, "$Base$Path",
           '-H', 'Content-Type: application/json',
           '-H', "X-Api-Key: $ApiKey", '-H', "X-Timestamp: $ts",
           '-H', "X-Nonce: $($s.nonce)", '-H', "X-Signature: $signature",
           '-H', 'X-Client-Version: 1.4.2')
    if ($Token) { $a += @('-H', "Authorization: Bearer $Token") }
    if ($bodyJson) {
        [System.IO.File]::WriteAllText($tmp, $bodyJson, (New-Object System.Text.UTF8Encoding($false)))
        $a += @('--data-binary', "@$tmp")
    }

    $raw = (& curl.exe @a) -join "`n"
    $lines = $raw -split "`n"
    $code = [int]$lines[-1]
    $headerEnd = [array]::IndexOf($lines, '')
    $headers = if ($headerEnd -gt 0) { $lines[0..($headerEnd - 1)] } else { @() }
    $bt = if ($headerEnd -gt 0) { ($lines[($headerEnd + 1)..($lines.Count - 2)] -join "`n") } else { '' }

    $parsed = $null
    if ($bt) { try { $parsed = $bt | ConvertFrom-Json } catch { $parsed = $bt } }
    return [PSCustomObject]@{ Code = $code; Body = $parsed; Headers = $headers; Nonce = $s.nonce; Signature = $signature }
}

# ---------------------------------------------------------------------------

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base -ApiDir $ApiDir

Write-Host "`n=== Выпуск ключа сборки ===" -ForegroundColor Cyan
$key = Invoke-Plain POST "/auth/api-keys" @{ name = "Smoke test $(Get-Random)" } $adminToken
Assert "ключ выпущен" ($key.Code -eq 201) "HTTP $($key.Code)"
Assert "префикс узнаваем" ($key.Body.prefix -like 'lp_*') $key.Body.prefix
Assert "префикс влезает в колонку VARCHAR(16)" ($key.Body.prefix.Length -le 16) "длина $($key.Body.prefix.Length)"
Assert "секрет подписи отдан" ($null -ne $key.Body.signingSecret) "нет секрета"
$apiKey = $key.Body.prefix
$secret = $key.Body.signingSecret

$listed = Invoke-Plain GET "/auth/api-keys" $null $adminToken
$found = @($listed.Body | Where-Object { $_.prefix -eq $apiKey })
Assert "секрет в списке НЕ отдаётся" ($null -eq $found[0].signingSecret -and $null -eq $found[0].signingSecretEnc) "секрет виден в списке"

# --- Пользователь с лицензией ------------------------------------------------
$u = "lau$(Get-Random -Maximum 999999)"
Invoke-Plain POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = "CorrectHorse42" } | Out-Null
Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
$userToken = (Invoke-Plain POST "/auth/login" @{ login = $u; password = "CorrectHorse42" }).Body.accessToken
$userId = (Sql "SELECT id FROM users WHERE username='$u';").Trim()

$product = (Sql "SELECT id FROM products WHERE slug='fc26';").Trim()
$plan = (Sql "SELECT id FROM license_plans WHERE product_id='$product' AND slug='30d';").Trim()
$lic = (Invoke-Plain POST "/licenses" @{ productId = $product; planId = $plan; userId = $userId } $adminToken).Body
$licKey = $lic.key
Assert "ключ лицензии выдан в формате SLUG-XXXX-XXXX-XXXX-XXXX" `
       ($licKey -cmatch '^[A-Z0-9]{2,16}(-[ACDEFGHJKMNPQRTUVWXYZ2346789]{4}){4}$') $licKey

# Токен пользователя дальше НЕ передаётся ни в один запрос загрузчика:
# в этом и состоит переход. Он остаётся в скрипте только затем, чтобы
# проверить, что кабинет по-прежнему на JWT.
$me = Invoke-Plain GET "/auth/me" $null $userToken
Assert "веб-кабинет остался на JWT" ($me.Code -eq 200) "HTTP $($me.Code)"

Write-Host "`n=== Подпись обязательна ===" -ForegroundColor Cyan
$noSig = Invoke-Plain POST "/launcher/license/check" @{ productSlug = 'fc26'; hwid = 'WD-TEST-001'; clientVersion = '1.4.2'; licenseKey = $licKey }
Assert "без подписи отклонено" ($noSig.Code -eq 403) "HTTP $($noSig.Code)"
Assert "код SIGNATURE_MISSING" ($noSig.Body.code -eq 'SIGNATURE_MISSING') $noSig.Body.code

$body = @{ productSlug = 'fc26'; hwid = 'WD-TEST-001'; clientVersion = '1.4.2'; licenseKey = $licKey }

$badSig = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret -ForcedSignature ('a' * 64)
Assert "неверная подпись отклонена" ($badSig.Code -eq 403) "HTTP $($badSig.Code)"
Assert "код SIGNATURE_INVALID" ($badSig.Body.code -eq 'SIGNATURE_INVALID') $badSig.Body.code

$expired = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret -TimestampOffset -3600
Assert "устаревшая метка времени отклонена" ($expired.Code -eq 403) "HTTP $($expired.Code)"
Assert "код SIGNATURE_EXPIRED" ($expired.Body.code -eq 'SIGNATURE_EXPIRED') $expired.Body.code

$wrongSecret = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey 'not-the-real-secret'
Assert "подпись чужим секретом отклонена" ($wrongSecret.Code -eq 403) "HTTP $($wrongSecret.Code)"

Write-Host "`n=== Ключ лицензии вместо логина ===" -ForegroundColor Cyan
$noKey = Invoke-Signed POST "/launcher/license/check" @{ productSlug = 'fc26'; hwid = 'WD-TEST-001'; clientVersion = '1.4.2' } $null $apiKey $secret
Assert "без ключа лицензии отклонено валидацией" ($noKey.Code -eq 400) "HTTP $($noKey.Code)"

# Синтаксически валидный, но несуществующий ключ. Ответ обязан совпадать
# с ответом на ключ чужого продукта: иначе эндпоинт проверяет утёкшие выгрузки.
$ghost = @{ productSlug = 'fc26'; hwid = 'WD-TEST-001'; clientVersion = '1.4.2'; licenseKey = 'FC26-ACDE-FGHJ-KMNP-QRTU' }
$unknown = Invoke-Signed POST "/launcher/license/check" $ghost $null $apiKey $secret
Assert "несуществующий ключ отклонён" ($unknown.Code -eq 404) "HTTP $($unknown.Code)"
Assert "код LICENSE_KEY_INVALID" ($unknown.Body.code -eq 'LICENSE_KEY_INVALID') $unknown.Body.code

Write-Host "`n=== Первая проверка: привязка и активация ===" -ForegroundColor Cyan
$check1 = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "проверка прошла" ($check1.Code -eq 200) "HTTP $($check1.Code) — $($check1.Body.code)"
Assert "статус ACTIVE" ($check1.Body.status -eq 'ACTIVE') $check1.Body.status
Assert "срок появился — лицензия активирована" ($null -ne $check1.Body.expiresAt) "срока нет"
Assert "заголовок X-Recheck-After отдан" (($check1.Headers -join "`n") -match 'X-Recheck-After') "заголовка нет"

$licDb = (Sql "SELECT status || '|' || (current_device_id IS NOT NULL)::text FROM licenses WHERE id='$($lic.id)';").Trim()
Assert "в БД статус ACTIVE и привязка есть" ($licDb -eq 'ACTIVE|true') $licDb

Write-Host "`n=== Защита от повтора ===" -ForegroundColor Cyan
# Тот же nonce и та же подпись — перехваченный запрос не должен сработать.
$replay = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret `
          -ForcedNonce $check1.Nonce -ForcedSignature $check1.Signature
Assert "повтор отклонён" ($replay.Code -eq 403) "HTTP $($replay.Code)"

Write-Host "`n=== Сверка привязки ===" -ForegroundColor Cyan
$check2 = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "повторная проверка с тем же диском проходит" ($check2.Code -eq 200) "HTTP $($check2.Code)"

# Ключ в нижнем регистре и с пробелами — это тот же ключ: человек переносит
# его руками, а нормализация серверная и подписи не касается.
$sloppy = @{ productSlug = 'fc26'; hwid = 'WD-TEST-001'; clientVersion = '1.4.2'; licenseKey = " $($licKey.ToLower()) " }
$normalized = Invoke-Signed POST "/launcher/license/check" $sloppy $null $apiKey $secret
Assert "ключ в нижнем регистре и с пробелами принят" ($normalized.Code -eq 200) `
       "HTTP $($normalized.Code) — $($normalized.Body.code)"

$otherDisk = @{ productSlug = 'fc26'; hwid = 'SEAGATE-OTHER-999'; clientVersion = '1.4.2'; licenseKey = $licKey }
$mismatch = Invoke-Signed POST "/launcher/license/check" $otherDisk $null $apiKey $secret
Assert "другой диск отклонён" ($mismatch.Code -eq 403) "HTTP $($mismatch.Code)"
Assert "код HWID_MISMATCH" ($mismatch.Body.code -eq 'HWID_MISMATCH') $mismatch.Body.code

Write-Host "`n=== Отказы по состоянию лицензии ===" -ForegroundColor Cyan
Sql "UPDATE licenses SET status='BLOCKED', blocked_at=now() WHERE id='$($lic.id)';" | Out-Null
$blocked = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "заблокированная отклонена" ($blocked.Code -eq 403) "HTTP $($blocked.Code)"
Assert "код LICENSE_BLOCKED" ($blocked.Body.code -eq 'LICENSE_BLOCKED') $blocked.Body.code

Sql "UPDATE licenses SET status='ACTIVE', expires_at=now() - interval '1 day' WHERE id='$($lic.id)';" | Out-Null
$expiredLic = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "истёкшая отклонена по ДАТЕ, не дожидаясь крона" ($expiredLic.Code -eq 403) "HTTP $($expiredLic.Code)"
Assert "код LICENSE_EXPIRED" ($expiredLic.Body.code -eq 'LICENSE_EXPIRED') $expiredLic.Body.code
Assert "продления нет — флага renewalAvailable тоже нет" `
       ($null -eq $expiredLic.Body.details.renewalAvailable) "флаг стоит на пустом месте"

# Выбор лицензии сервером умер вместе с сессией: с ключом продление НЕ
# подхватывается само, но человек обязан узнать, что оно у него есть.
$lic2 = (Invoke-Plain POST "/licenses" @{ productId = $product; planId = $plan; userId = $userId } $adminToken).Body
Sql "UPDATE licenses SET status='ACTIVE', expires_at=now() + interval '30 days' WHERE id='$($lic2.id)';" | Out-Null
$withRenewal = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "по старому ключу всё ещё LICENSE_EXPIRED" ($withRenewal.Body.code -eq 'LICENSE_EXPIRED') $withRenewal.Body.code
Assert "renewalAvailable подсказывает про продление в кабинете" `
       ($withRenewal.Body.details.renewalAvailable -eq $true) "подсказки нет — человек в тупике"
Assert "новый ключ в ответе НЕ отдаётся" `
       (($withRenewal.Body | ConvertTo-Json -Depth 6) -notmatch [regex]::Escape($lic2.key)) `
       "просроченный ключ стал способом добыть действующий"
Sql "UPDATE licenses SET status='REVOKED' WHERE id='$($lic2.id)';" | Out-Null

# Бессрочная: expires_at = NULL не должно трактоваться как истёкшая.
Sql "UPDATE licenses SET status='ACTIVE', expires_at=NULL WHERE id='$($lic.id)';" | Out-Null
$lifetime = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "БЕССРОЧНАЯ работает (expires_at = NULL)" ($lifetime.Code -eq 200) `
       "HTTP $($lifetime.Code) — доступ пропал у тех, кто заплатил больше всех"

Write-Host "`n=== Ключ без владельца ===" -ForegroundColor Cyan
# Складская лицензия реселлера: ключ живой, аккаунта за ним нет. До перехода
# на ключ это состояние было недостижимо — JWT гарантировал пользователя.
Sql "UPDATE licenses SET user_id=NULL WHERE id='$($lic.id)';" | Out-Null
$orphan = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "ключ без аккаунта отклонён" ($orphan.Code -eq 403) "HTTP $($orphan.Code)"
Assert "код LICENSE_NOT_ASSIGNED" ($orphan.Body.code -eq 'LICENSE_NOT_ASSIGNED') $orphan.Body.code
Sql "UPDATE licenses SET user_id='$userId' WHERE id='$($lic.id)';" | Out-Null

Write-Host "`n=== Обновления ===" -ForegroundColor Cyan
# Ключ лицензии здесь не нужен и не принимается: ответ одинаков для всех,
# а загрузчик с просроченной лицензией обязан уметь узнать про обновление.
$upd = Invoke-Signed GET "/launcher/update?productSlug=fc26&clientVersion=1.0.0" $null $null $apiKey $secret
Assert "проверка обновления прошла без ключа лицензии" ($upd.Code -eq 200) "HTTP $($upd.Code)"

Write-Host "`n=== Отчёты ===" -ForegroundColor Cyan
$log = Invoke-Signed POST "/launcher/logs" @{ kind = 'error'; clientVersion = '1.4.2'; summary = 'не удалось прочитать Disk ID'; licenseKey = $licKey } $null $apiKey $secret
Assert "отчёт принят" ($log.Code -eq 202) "HTTP $($log.Code)"
$logged = (Sql "SELECT count(*) FROM launcher_log_batches WHERE license_id='$($lic.id)' AND user_id='$userId';").Trim()
Assert "отчёт соединён с лицензией и владельцем" ([int]$logged -ge 1) "записей $logged"

# Отчёт от загрузчика, который не смог аутентифицироваться, — самый ценный.
$anonLog = Invoke-Signed POST "/launcher/logs" @{ kind = 'crash'; clientVersion = '1.4.2'; summary = 'конфиг повреждён, ключ не прочитан' } $null $apiKey $secret
Assert "отчёт БЕЗ ключа принят" ($anonLog.Code -eq 202) "HTTP $($anonLog.Code)"

$badKeyLog = Invoke-Signed POST "/launcher/logs" @{ kind = 'crash'; clientVersion = '1.4.2'; summary = 'ключ отвергнут сервером'; licenseKey = 'FC26-ACDE-FGHJ-KMNP-QRTU' } $null $apiKey $secret
Assert "отчёт с НЕВЕРНЫМ ключом тоже 202 — /logs не оракул" ($badKeyLog.Code -eq 202) "HTTP $($badKeyLog.Code)"

Write-Host "`n=== Отзыв ключа сборки ===" -ForegroundColor Cyan
$keyId = (Sql "SELECT id FROM api_keys WHERE prefix='$apiKey';").Trim()
Invoke-Plain DELETE "/auth/api-keys/$keyId" $null $adminToken | Out-Null
$afterRevoke = Invoke-Signed POST "/launcher/license/check" $body $null $apiKey $secret
Assert "отозванный ключ перестал работать СРАЗУ" ($afterRevoke.Code -eq 403) `
       "HTTP $($afterRevoke.Code) — кэш не сброшен, отзыв не действует"

Write-Host "`n=== Антифрод ===" -ForegroundColor Cyan
$fraud = (Sql "SELECT count(*) FROM anti_fraud_events WHERE type IN ('SIGNATURE_MISMATCH','REPLAY_ATTEMPT');").Trim()
Assert "неудачные подписи попали в антифрод" ([int]$fraud -ge 1) "событий $fraud"

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
