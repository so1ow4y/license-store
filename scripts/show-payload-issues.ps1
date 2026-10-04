# Что сервер видел про выдачи payload. Смотреть сразу после запуска
# загрузчика: строка пишется на КАЖДУЮ попытку, включая отказы, и по ней
# видно, дошло ли дело до выдачи и на каком шаге встало.
#
# Заголовки колонок латиницей намеренно: psql отдаёт UTF-8, консоль PS 5.1
# читает в OEM-кодировке, и кириллица в них превращается в «?????».
# Переключение [Console]::OutputEncoding не помогает — декодирование
# происходит раньше. Данные и так ASCII, так что терять нечего.

param(
    [string]$PgContainer = "lp-postgres",
    [int]$Limit = 20
)

Write-Host "`n=== Выдачи payload ===" -ForegroundColor Cyan
@"
SELECT to_char(created_at,'HH24:MI:SS')      AS "time",
       result,
       COALESCE(payload_version,'-')          AS "build",
       COALESCE(size_bytes::text,'-')         AS "bytes",
       COALESCE(client_version,'-')           AS "client",
       COALESCE(left(hwid_hash,12),'-')       AS "hwid",
       COALESCE(host(ip),'-')                 AS "ip"
FROM payload_issues
ORDER BY created_at DESC
LIMIT $Limit;
"@ | docker exec -i $PgContainer psql -U lp -d license_platform

Write-Host "`n=== Проверки лицензии ===" -ForegroundColor Cyan
@"
SELECT to_char(l.last_check_at,'HH24:MI:SS') AS "time",
       u.username                             AS "login",
       l.status,
       COALESCE(to_char(l.expires_at,'YYYY-MM-DD'),'lifetime') AS "until",
       (l.current_device_id IS NOT NULL)      AS "bound"
FROM licenses l JOIN users u ON u.id = l.user_id
WHERE l.last_check_at IS NOT NULL
ORDER BY l.last_check_at DESC LIMIT 10;
"@ | docker exec -i $PgContainer psql -U lp -d license_platform

Write-Host "`n=== Антифрод (последнее) ===" -ForegroundColor Cyan
@"
SELECT to_char(created_at,'HH24:MI:SS') AS "time", type, severity
FROM anti_fraud_events ORDER BY created_at DESC LIMIT 5;
"@ | docker exec -i $PgContainer psql -U lp -d license_platform
