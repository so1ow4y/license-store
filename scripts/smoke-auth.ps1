# ============================================================================
#  Сквозная проверка аутентификации.
#
#  Прогоняет полный сценарий против запущенного API и проверяет ключевые
#  свойства безопасности, а не только «эндпоинт отвечает 200».
#
#  Запуск:  powershell -ExecutionPolicy Bypass -File scripts\smoke-auth.ps1
# ============================================================================

param(
    # НАПРЯМУЮ В API, минуя nginx.
    #
    # Через nginx сценарий не проходит и не должен: на /auth/login стоит
    # ограничение 10 запросов в минуту, а тест делает шесть входов подряд
    # и справедливо получает 429. Здесь проверяется логика приложения;
    # ограничение скорости — отдельная проверка на уровне nginx.
    [string]$Base = "http://localhost:3000/api/v1",
    [string]$PgContainer = "lp-postgres"
)

$ErrorActionPreference = 'Continue'
$tmp = Join-Path $env:TEMP "lp-smoke-req.json"
$script:failed = 0

function Invoke-Api {
    param([string]$Method, [string]$Path, $Body, [string]$Token)

    $curlArgs = @('-s', '-w', "`n%{http_code}", '-X', $Method, "$Base$Path",
                  '-H', 'Content-Type: application/json')
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }

    if ($Body) {
        # Тело пишется в файл намеренно: PowerShell мнёт кавычки при
        # передаче аргументов нативному exe, и валидный JSON доезжает
        # до сервера искалеченным.
        $json = $Body | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
        $curlArgs += @('--data-binary', "@$tmp")
    }

    $raw = (& curl.exe @curlArgs) -join "`n"
    $parts = $raw -split "`n"
    $code = $parts[-1]
    $bodyText = ($parts[0..($parts.Count - 2)] -join "`n")

    $parsed = $null
    if ($bodyText) {
        try { $parsed = $bodyText | ConvertFrom-Json } catch { $parsed = $bodyText }
    }

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

function Activate-User {
    param([string]$Username)
    $sql = "UPDATE users SET status='ACTIVE', email_verified_at=now() WHERE username='$Username';"
    $sql | docker exec -i $PgContainer psql -U lp -d license_platform -q 2>&1 | Out-Null
}

# ---------------------------------------------------------------------------

$user = "smoke$(Get-Random -Maximum 999999)"
$pass = "CorrectHorse42"

Write-Host "`n=== Регистрация ===" -ForegroundColor Cyan
$r = Invoke-Api POST "/auth/register" @{ email = "$user@example.com"; username = $user; password = $pass }
Assert "регистрация принята" ($r.Code -eq 201) "HTTP $($r.Code)"
Assert "токен подтверждения не утёк в ответ" ($null -eq $r.Body.verificationToken) "токен виден клиенту"

Write-Host "`n=== Повторная регистрация ===" -ForegroundColor Cyan
$r = Invoke-Api POST "/auth/register" @{ email = "$user@example.com"; username = $user; password = $pass }
Assert "занятый логин отклонён" ($r.Code -eq 409) "HTTP $($r.Code)"
Assert "не раскрыто, какое поле занято" ($r.Body.message -notmatch 'email|логин|username') $r.Body.message

Write-Host "`n=== Слабый пароль ===" -ForegroundColor Cyan
$r = Invoke-Api POST "/auth/register" @{ email = "weak$user@example.com"; username = "weak$user"; password = "123" }
Assert "короткий пароль отклонён" ($r.Code -eq 400) "HTTP $($r.Code)"

Write-Host "`n=== Вход до подтверждения адреса ===" -ForegroundColor Cyan
$r = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
Assert "вход запрещён" ($r.Code -eq 403) "HTTP $($r.Code)"
Assert "код EMAIL_NOT_VERIFIED" ($r.Body.code -eq 'EMAIL_NOT_VERIFIED') $r.Body.code

Activate-User $user

Write-Host "`n=== Неразличимость отказов ===" -ForegroundColor Cyan
$wrongPass = Invoke-Api POST "/auth/login" @{ login = $user; password = "WrongPassword1" }
$noUser = Invoke-Api POST "/auth/login" @{ login = "nosuchuser999"; password = "WrongPassword1" }
Assert "неверный пароль -> 401" ($wrongPass.Code -eq 401) "HTTP $($wrongPass.Code)"
Assert "несуществующий логин -> 401" ($noUser.Code -eq 401) "HTTP $($noUser.Code)"
Assert "коды совпадают" ($wrongPass.Body.code -eq $noUser.Body.code) "$($wrongPass.Body.code) vs $($noUser.Body.code)"
Assert "сообщения совпадают" ($wrongPass.Body.message -eq $noUser.Body.message) "различаются"

Write-Host "`n=== Успешный вход ===" -ForegroundColor Cyan
$login = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
Assert "вход выполнен" ($login.Code -eq 200) "HTTP $($login.Code)"
Assert "выдан access-токен" ($null -ne $login.Body.accessToken) "нет токена"
Assert "выдан refresh-токен" ($null -ne $login.Body.refreshToken) "нет токена"
Assert "хеш пароля не в ответе" ($login.Body.user.passwordHash -eq $null) "утечка хеша"

$access = $login.Body.accessToken
$refresh1 = $login.Body.refreshToken

Write-Host "`n=== Защищённый эндпоинт ===" -ForegroundColor Cyan
$me = Invoke-Api GET "/auth/me" $null $access
Assert "с токеном -> 200" ($me.Code -eq 200) "HTTP $($me.Code)"
Assert "права загружены" ($me.Body.permissions.Count -gt 0) "прав нет"
Assert "роль user даёт licenses.read.own" ($me.Body.permissions -contains 'licenses.read.own') ($me.Body.permissions -join ',')

$anon = Invoke-Api GET "/auth/me"
Assert "без токена -> 401" ($anon.Code -eq 401) "HTTP $($anon.Code)"

$bad = Invoke-Api GET "/auth/me" $null "явно.невалидный.токен"
Assert "с мусорным токеном -> 401" ($bad.Code -eq 401) "HTTP $($bad.Code)"

Write-Host "`n=== Ротация refresh-токена ===" -ForegroundColor Cyan
$rot = Invoke-Api POST "/auth/refresh" @{ refreshToken = $refresh1 }
Assert "обновление прошло" ($rot.Code -eq 200) "HTTP $($rot.Code)"
Assert "выдан НОВЫЙ refresh" ($rot.Body.refreshToken -ne $refresh1) "токен не изменился"
$refresh2 = $rot.Body.refreshToken
$access2 = $rot.Body.accessToken

Write-Host "`n=== Обнаружение кражи токена ===" -ForegroundColor Cyan
# Предъявляем УЖЕ ПОТРАЧЕННЫЙ refresh — так выглядит перехваченный токен.
$reuse = Invoke-Api POST "/auth/refresh" @{ refreshToken = $refresh1 }
Assert "повторное использование отклонено" ($reuse.Code -eq 401) "HTTP $($reuse.Code)"
Assert "код TOKEN_REUSED" ($reuse.Body.code -eq 'TOKEN_REUSED') $reuse.Body.code

# И главное: вся семья должна быть погашена, включая свежий токен.
$afterReuse = Invoke-Api POST "/auth/refresh" @{ refreshToken = $refresh2 }
Assert "свежий токен той же семьи тоже погашен" ($afterReuse.Code -eq 401) "HTTP $($afterReuse.Code)"

# И access-токен перестал работать, потому что сессия отозвана.
$meAfter = Invoke-Api GET "/auth/me" $null $access2
Assert "сессия отозвана, access больше не работает" ($meAfter.Code -eq 401) "HTTP $($meAfter.Code)"
Assert "код SESSION_REVOKED" ($meAfter.Body.code -eq 'SESSION_REVOKED') $meAfter.Body.code

Write-Host "`n=== Выход ===" -ForegroundColor Cyan
$login2 = Invoke-Api POST "/auth/login" @{ login = $user; password = $pass }
$access3 = $login2.Body.accessToken
$out = Invoke-Api POST "/auth/logout" $null $access3
Assert "выход выполнен" ($out.Code -eq 200) "HTTP $($out.Code)"

$meAfterLogout = Invoke-Api GET "/auth/me" $null $access3
Assert "после выхода access не работает" ($meAfterLogout.Code -eq 401) "HTTP $($meAfterLogout.Code)"

# ---------------------------------------------------------------------------

Write-Host ""
if ($script:failed -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:failed)" -ForegroundColor Red
    exit 1
}
