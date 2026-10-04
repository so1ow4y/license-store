# ============================================================================
#  Продукты, версии и загрузка дистрибутива в хранилище.
#
#  Главное здесь — что SHA-256 считает СЕРВЕР, скачав объект, и он сходится
#  с фактическим файлом. Хеш от клиента не принимается: им загрузчик
#  проверяет целостность перед установкой.
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-products.ps1
# ============================================================================

param(
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-prod-req.json"
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

function New-PlainUser {
    $u = "prod$(Get-Random -Maximum 999999)"
    Invoke-Api POST "/auth/register" @{ email = "$u@example.com"; username = $u; password = "CorrectHorse42" } | Out-Null
    Sql "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$u';" | Out-Null
    return (Invoke-Api POST "/auth/login" @{ login = $u; password = "CorrectHorse42" }).Body.accessToken
}

# ---------------------------------------------------------------------------

. "$PSScriptRoot\_admin-token.ps1"
$adminToken = Get-AdminToken -Base $Base
$plainToken = New-PlainUser
$slug = "test$(Get-Random -Maximum 99999)"

Write-Host "`n=== Права ===" -ForegroundColor Cyan
$denied = Invoke-Api POST "/products" @{ slug = $slug; name = 'Тест' } $plainToken
Assert "обычный пользователь не создаёт продукты" ($denied.Code -eq 403) "HTTP $($denied.Code)"

$anon = Invoke-Api GET "/products"
Assert "каталог доступен без авторизации" ($anon.Code -eq 200) "HTTP $($anon.Code)"

# products.read есть у роли user для каталога, поэтому полный список
# со скрытыми продуктами закрыт правом products.manage.
$adminOnly = Invoke-Api GET "/products/admin/all" $null $plainToken
Assert "полный список закрыт для обычного пользователя" ($adminOnly.Code -eq 403) "HTTP $($adminOnly.Code)"

Write-Host "`n=== Создание продукта ===" -ForegroundColor Cyan
$badSlug = Invoke-Api POST "/products" @{ slug = 'Bad_Slug!'; name = 'Тест' } $adminToken
Assert "некорректный код отклонён" ($badSlug.Code -eq 400) "HTTP $($badSlug.Code)"

$created = Invoke-Api POST "/products" @{ slug = $slug; name = 'Тестовый продукт' } $adminToken
Assert "продукт создан" ($created.Code -eq 201) "HTTP $($created.Code)"
Assert "создан СКРЫТЫМ" ($created.Body.status -eq 'HIDDEN') "$($created.Body.status) — не должен сразу попадать в каталог"
$productId = $created.Body.id

$catalog = (Invoke-Api GET "/products").Body
Assert "скрытого нет в публичном каталоге" (($catalog | Where-Object { $_.slug -eq $slug }).Count -eq 0) "виден"

$dup = Invoke-Api POST "/products" @{ slug = $slug; name = 'Дубль' } $adminToken
Assert "дубликат кода отклонён" ($dup.Code -eq 409) "HTTP $($dup.Code)"

Write-Host "`n=== Тарифы ===" -ForegroundColor Cyan
$plan = Invoke-Api POST "/products/$productId/plans" @{ slug = '30d'; name = '30 дней'; durationDays = 30; price = 1290 } $adminToken
Assert "тариф создан" ($plan.Code -eq 201) "HTTP $($plan.Code)"

$lifetime = Invoke-Api POST "/products/$productId/plans" @{ slug = 'lifetime'; name = 'Навсегда'; durationDays = $null; price = 9900 } $adminToken
Assert "бессрочный тариф создан" ($lifetime.Code -eq 201) "HTTP $($lifetime.Code)"
Assert "durationDays = NULL означает Lifetime" ($null -eq $lifetime.Body.durationDays) "$($lifetime.Body.durationDays)"

Write-Host "`n=== Версия ===" -ForegroundColor Cyan
$badVer = Invoke-Api POST "/products/$productId/versions" @{ version = '1.4' } $adminToken
Assert "неполная версия отклонена" ($badVer.Code -eq 400) "HTTP $($badVer.Code)"

$ver = Invoke-Api POST "/products/$productId/versions" @{ version = '1.4.2'; changelog = '## Первый релиз' } $adminToken
Assert "версия создана" ($ver.Code -eq 201) "HTTP $($ver.Code)"
Assert "versionCode посчитан верно" ($ver.Body.versionCode -eq 1004002) "$($ver.Body.versionCode)"
Assert "создана НЕопубликованной" ($ver.Body.isPublished -eq $false) "опубликована сразу"
$versionId = $ver.Body.id

# Сравнение версий должно идти по числу: "1.10.0" лексикографически меньше "1.9.0".
$v10 = Invoke-Api POST "/products/$productId/versions" @{ version = '1.10.0' } $adminToken
Assert "1.10.0 > 1.4.2 по versionCode" ($v10.Body.versionCode -gt $ver.Body.versionCode) `
       "$($v10.Body.versionCode) vs $($ver.Body.versionCode)"

Write-Host "`n=== Публикация без файла ===" -ForegroundColor Cyan
$noFile = Invoke-Api POST "/products/versions/$versionId/publish" $null $adminToken
Assert "публикация без файла запрещена" ($noFile.Code -eq 400) "HTTP $($noFile.Code) — загрузчику нечего скачивать"
Assert "код FILE_REQUIRED" ($noFile.Body.code -eq 'FILE_REQUIRED') $noFile.Body.code

Write-Host "`n=== Загрузка дистрибутива ===" -ForegroundColor Cyan
$upload = Invoke-Api POST "/products/versions/$versionId/upload-url" @{ filename = 'launcher-1.4.2.bin' } $adminToken
Assert "ссылка на загрузку выдана" ($upload.Code -eq 200 -and $upload.Body.uploadUrl) "HTTP $($upload.Code)"
Assert "версия в пути объекта" ($upload.Body.objectKey -like "*1.4.2*") $upload.Body.objectKey

# Готовим файл со случайным содержимым и считаем его SHA-256 локально.
$payload = Join-Path $env:TEMP "lp-dist.bin"
$bytes = New-Object byte[] 262144
(New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
[System.IO.File]::WriteAllBytes($payload, $bytes)
$localSha = (Get-FileHash -Path $payload -Algorithm SHA256).Hash.ToLower()
Write-Host "  локальный SHA-256: $($localSha.Substring(0,16))…" -ForegroundColor DarkGray

$putCode = & curl.exe -s -o NUL -w "%{http_code}" -X PUT --data-binary "@$payload" `
    -H "Content-Type: application/octet-stream" $upload.Body.uploadUrl
Assert "файл загружен напрямую в хранилище" ($putCode -eq '200') "HTTP $putCode"

Write-Host "`n=== Подтверждение и хеширование ===" -ForegroundColor Cyan
$confirm = Invoke-Api POST "/products/versions/$versionId/confirm-upload" @{ objectKey = $upload.Body.objectKey } $adminToken
Assert "загрузка подтверждена" ($confirm.Code -eq 200) "HTTP $($confirm.Code)"
Assert "СЕРВЕРНЫЙ SHA-256 сошёлся с фактическим файлом" ($confirm.Body.sha256 -eq $localSha) `
       "сервер: $($confirm.Body.sha256), файл: $localSha"
Assert "размер записан верно" ([int]$confirm.Body.fileSize -eq $bytes.Length) "$($confirm.Body.fileSize) vs $($bytes.Length)"

$missing = Invoke-Api POST "/products/versions/$versionId/confirm-upload" @{ objectKey = 'releases/nope/0.0.1/nothing.bin' } $adminToken
Assert "подтверждение несуществующего объекта отклонено" ($missing.Code -eq 400) "HTTP $($missing.Code)"

Write-Host "`n=== Манифест целостности ===" -ForegroundColor Cyan
$badHash = Invoke-Api POST "/products/versions/$versionId/manifest" @{ files = @(@{ path = 'bin/a.exe'; sha256 = 'ZZZZ'; size = 10 }) } $adminToken
Assert "некорректный хеш в манифесте отклонён" ($badHash.Code -eq 400) "HTTP $($badHash.Code)"

$manifest = Invoke-Api POST "/products/versions/$versionId/manifest" @{
    files = @(
        @{ path = 'bin/launcher.exe'; sha256 = $localSha; size = $bytes.Length; isCritical = $true },
        @{ path = 'data/config.bin'; sha256 = ('a' * 64); size = 128 }
    )
} $adminToken
Assert "манифест записан" ($manifest.Code -eq 200 -and $manifest.Body.fileCount -eq 2) "HTTP $($manifest.Code)"

Write-Host "`n=== Публикация ===" -ForegroundColor Cyan
$pub = Invoke-Api POST "/products/versions/$versionId/publish" $null $adminToken
Assert "версия опубликована" ($pub.Code -eq 200 -and $pub.Body.isPublished -eq $true) "HTTP $($pub.Code)"

$again = Invoke-Api POST "/products/versions/$versionId/publish" $null $adminToken
Assert "повторная публикация отклонена" ($again.Code -eq 409) "HTTP $($again.Code)"

$lockedUpload = Invoke-Api POST "/products/versions/$versionId/upload-url" @{ filename = 'other.bin' } $adminToken
Assert "файл опубликованной версии менять нельзя" ($lockedUpload.Code -eq 409) "HTTP $($lockedUpload.Code)"

Write-Host "`n=== Публикация продукта в каталог ===" -ForegroundColor Cyan
$activate = Invoke-Api PATCH "/products/$productId" @{ status = 'ACTIVE' } $adminToken
Assert "статус изменён" ($activate.Code -eq 200) "HTTP $($activate.Code)"

$catalog2 = (Invoke-Api GET "/products").Body
# @() обязательно: в PowerShell .Count на одиночном объекте ведёт себя
# иначе, чем на массиве, и проверка молча становится ложной.
$found = @($catalog2 | Where-Object { $_.slug -eq $slug })
Assert "продукт появился в каталоге" ($found.Count -eq 1) "не найден"
Assert "тарифы отданы вместе с продуктом" (@($found[0].plans).Count -eq 2) "$(@($found[0].plans).Count)"

Write-Host "`n=== Аудит ===" -ForegroundColor Cyan
$auditActions = (Sql "SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs WHERE entity_id='$productId' OR entity_id='$versionId';").Trim()
Assert "действия попали в журнал" ($auditActions -ne '') "журнал пуст"
Write-Host "  записано: $auditActions" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
