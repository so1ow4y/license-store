# ============================================================================
#  Токен администратора для скриптов.
#
#  Понадобился, когда включилось требование ТЗ п.14: привилегированная роль
#  без второго фактора не выполняет административных действий. Сидовый admin
#  создаётся без 2FA, поэтому на первое же админское действие он получает
#  403 TWO_FACTOR_SETUP_REQUIRED — и это правильно, так задумано.
#
#  Помощник проходит этот путь так же, как его пройдёт человек:
#    первый запуск — включает 2FA и запоминает секрет;
#    последующие  — входит и завершает вход кодом.
#
#  Секрет лежит в scripts/.admin-2fa (в .gitignore). Потеряешь файл —
#  сбрось 2FA админу в БД и запусти снова:
#    UPDATE users SET two_factor_enabled=false, two_factor_confirmed_at=NULL,
#           two_factor_secret_enc=NULL WHERE username='admin';
#
#  Использование:  . "$PSScriptRoot\_admin-token.ps1"
#                  $token = Get-AdminToken -Base $Base
# ============================================================================

function Get-AdminToken {
    param(
        [string]$Base = "http://localhost:3000/api/v1",
        [string]$ApiDir = "$PSScriptRoot\..\apps\api",
        [string]$AdminLogin = 'admin',
        [string]$AdminPassword = 'ChangeMe!2026',
        [string]$SecretFile = "$PSScriptRoot\.admin-2fa"
    )

    # ВНИМАНИЕ на имена переменных.
    #
    # Имена в PowerShell РЕГИСТРОНЕЗАВИСИМЫ, поэтому параметр [string]$Login
    # и результат $login — это ОДНА переменная. Присваивание объекта в
    # типизированный параметр молча приводит его к строке вида
    # "@{Code=200; Body=...}", после чего .Code пустой, и отказ выглядит как
    # «сервер не ответил», хотя он ответил 200. Час на поиск.
    #
    # Отсюда $AdminLogin/$AdminPassword у параметров и $auth у результата.

    function Send {
        param([string]$Path, $Body, [string]$BearerToken)
        $tmp = Join-Path $env:TEMP "lp-admin-$([guid]::NewGuid().ToString('N')).json"
        $a = @('-s', '-w', "`n%{http_code}", '-X', 'POST', "$Base$Path", '-H', 'Content-Type: application/json')
        if ($BearerToken) { $a += @('-H', "Authorization: Bearer $BearerToken") }
        if ($Body) {
            [System.IO.File]::WriteAllText($tmp, ($Body | ConvertTo-Json -Compress -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
            $a += @('--data-binary', "@$tmp")
        }
        $raw = (& curl.exe @a) -join "`n"
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        $parts = $raw -split "`n"
        $bodyText = ($parts[0..($parts.Count - 2)] -join "`n")
        $parsed = $null
        if ($bodyText) { try { $parsed = $bodyText | ConvertFrom-Json } catch { $parsed = $bodyText } }
        return [PSCustomObject]@{ Code = [int]$parts[-1]; Body = $parsed }
    }

    function Totp {
        param([string]$Secret)
        Push-Location $ApiDir
        $c = (node -e "console.log(require('otplib').generateSync({secret: process.argv[1]}))" $Secret).Trim()
        Pop-Location
        return $c
    }

    $auth = Send "/auth/login" @{ login = $AdminLogin; password = $AdminPassword }

    if ($auth.Code -ne 200) {
        throw "вход администратором не прошёл: HTTP $($auth.Code) $($auth.Body | ConvertTo-Json -Compress)"
    }

    # --- Второй фактор уже включён: завершаем вход кодом --------------------
    if ($auth.Body.twoFactorRequired -eq $true) {
        if (-not (Test-Path -LiteralPath $SecretFile)) {
            throw "у админа включена 2FA, но секрет не сохранён ($SecretFile). Как сбросить — написано в шапке _admin-token.ps1"
        }
        $secret = (Get-Content -LiteralPath $SecretFile -Raw).Trim()
        $code = Totp $secret
        $verify = Send "/auth/2fa/verify" @{ challengeToken = $auth.Body.challengeToken; code = $code }

        # Код одноразовый: сервер запоминает использованный шаг TOTP и
        # отвергает повтор (защита от перехвата кода с экрана). Скрипты
        # запускаются подряд и попадают в одно 30-секундное окно, поэтому
        # ждём следующий шаг и пробуем ещё раз. Обходить защиту нельзя —
        # тогда тесты проверяли бы не тот сервер, что поедет в прод.
        if ($verify.Code -ne 200 -and $verify.Body.code -eq 'TWO_FACTOR_INVALID') {
            Write-Host "  код уже использован, жду следующий шаг TOTP..." -ForegroundColor DarkGray
            $next = $code
            for ($i = 0; $i -lt 35 -and $next -eq $code; $i++) {
                Start-Sleep -Seconds 1
                $next = Totp $secret
            }
            if ($next -ne $code) {
                # Прежний challenge погашен неудачной попыткой — берём новый.
                $auth = Send "/auth/login" @{ login = $AdminLogin; password = $AdminPassword }
                $verify = Send "/auth/2fa/verify" @{ challengeToken = $auth.Body.challengeToken; code = $next }
            }
        }

        if ($verify.Code -ne 200) {
            throw "не удалось завершить вход кодом: HTTP $($verify.Code) $($verify.Body | ConvertTo-Json -Compress)"
        }
        return $verify.Body.accessToken
    }

    # --- Второго фактора нет: включаем и запоминаем -------------------------
    #
    # Токен, полученный ДО включения, остаётся действительным: гейт стоит на
    # административных действиях, а не на самом входе. Поэтому возвращаем его
    # же, не дожидаясь следующего шага TOTP — иначе каждый первый прогон
    # скриптов стоил бы лишних тридцати секунд.
    $token = $auth.Body.accessToken

    $setup = Send "/auth/2fa/setup" $null $token
    if ($setup.Code -ne 200 -or -not $setup.Body.secret) {
        throw "не удалось получить секрет 2FA: HTTP $($setup.Code)"
    }

    $enable = Send "/auth/2fa/enable" @{ code = (Totp $setup.Body.secret) } $token
    if ($enable.Code -ne 200) {
        throw "не удалось включить 2FA: HTTP $($enable.Code) $($enable.Body | ConvertTo-Json -Compress)"
    }

    [System.IO.File]::WriteAllText($SecretFile, $setup.Body.secret, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "  2FA администратора включена, секрет сохранён в $SecretFile" -ForegroundColor DarkGray

    return $token
}
