-- Разовая чистка журнала аудита: затирание секретов, записанных ДО того,
-- как в AuditService.redact() появился полный список запрещённых имён полей.
--
-- ЧТО ЭТО. AuditInterceptor кладёт в audit_logs.after тело запроса целиком
-- (apps/api/src/common/audit/audit.interceptor.ts), а вырезание секретов
-- делает AuditService.redact() по списку REDACTED_FIELD_NAMES
-- (apps/api/src/common/audit/audit.service.ts). В списке не было ни
-- 'diskId', ни 'hwid', поэтому POST /api/licenses/:id/hwid/set записал
-- сырые Disk ID открытым текстом: на момент написания — 12 строк
-- (action='hwid.set_manual'). Код починен, но уже записанное само не
-- исчезнет: журнал аудита пишется один раз и живёт годами.
--
-- ПОЧЕМУ ЭТО ВАЖНО, А НЕ КОСМЕТИКА. Сырой Disk ID по ТЗ п.7 не показывается
-- даже владельцу лицензии, а hwid_hash считается из него однозначно
-- (HMAC с HWID_PEPPER на стороне сервера). Пока эти строки лежат в базе,
-- любой сотрудник с правом чтения аудита обходит всю схему «в базе только
-- хеш и шифротекст»: имея сырое значение, он сам получает hwid_hash и
-- сходится с devices/licenses без всякого ключа шифрования.
--
-- ПОЧЕМУ ЭТО НЕ МИГРАЦИЯ PRISMA. Схема не меняется — меняются данные, и
-- меняются необратимо. Prisma-миграция выполнилась бы автоматически на
-- каждом стенде при деплое; здесь нужен осознанный ручной запуск с
-- предварительным взглядом на вывод «до». Поэтому — обычный SQL-файл.
--
-- ЗАПУСКАЕТСЯ ОДИН РАЗ, вручную, после выкатки исправленного AuditService.
-- Порядок важен: если запустить до выкатки, следующий же вызов
-- /hwid/set запишет новую сырую строку и чистку придётся повторять.
-- Повторный запуск безопасен (идемпотентен): скрипт трогает только строки,
-- где запрещённое поле ещё не равно '[REDACTED]'.
--
-- Запуск:
--   docker exec -i lp-postgres psql -U lp -d license_platform -v ON_ERROR_STOP=1 \
--     < scripts/redact-audit-diskid.sql
--
-- ВОССТАНОВЛЕНИЮ НЕ ПОДЛЕЖИТ. Значения затираются, а не шифруются: смысл
-- операции в том, чтобы сырого Disk ID в базе не осталось ни в каком виде.
-- Если журнал нужен для разбора инцидента — снимите бэкап ДО запуска и
-- храните его там же, где остальные дампы, а не рядом с базой.

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- Рекурсивный редактор. Живёт в pg_temp: функция исчезнет вместе с
-- сессией, схема базы не засоряется разовым инструментом.
--
-- Рекурсия, а не jsonb_set по фиксированному пути: сегодня diskId лежит
-- на верхнем уровне, но тело запроса кладётся целиком, и вложенный
-- {"device": {"diskId": ...}} — такая же строка журнала. Точечный
-- jsonb_set её бы молча пропустил.
CREATE OR REPLACE FUNCTION pg_temp.audit_redact(doc jsonb) RETURNS jsonb AS $$
DECLARE
  -- Имена сверены со списком REDACTED_FIELD_NAMES в audit.service.ts.
  -- Сравнение регистронезависимое — там оно тоже регистронезависимое,
  -- иначе чистка истории и защита будущих записей разойдутся.
  banned text[] := ARRAY[
    'password','passwordhash','password_hash','newpassword','currentpassword','oldpassword',
    'token','tokenhash','token_hash','refreshtoken','accesstoken','access_token','challengetoken',
    'sessionkey','session_key','sessionkeyhex',
    'secret','clientsecret','client_secret','signingsecret','signingsecretenc','signing_secret_enc',
    'twofactorsecretenc','two_factor_secret_enc','accesskeyid','secretaccesskey','credentials',
    'code','codes','twofactorcode','recoverycodes','recovery_codes',
    'twofactorrecoverycodes','two_factor_recovery_codes',
    'diskid','disk_id','hwid','hwidenc','hwid_enc','hwidhash','hwid_hash','newhwidhash','oldhwidhash',
    'keyhash','key_hash','apikey','api_key','licensekey','license_key'
  ];
  result jsonb;
BEGIN
  IF doc IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(doc) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(
             e.key,
             CASE WHEN lower(e.key) = ANY (banned)
                  THEN '"[REDACTED]"'::jsonb
                  ELSE pg_temp.audit_redact(e.value)
             END
           ), '{}'::jsonb)
      INTO result
      FROM jsonb_each(doc) e;
    RETURN result;
  END IF;

  IF jsonb_typeof(doc) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.audit_redact(x)), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(doc) x;
    RETURN result;
  END IF;

  -- Скаляр: значение сохраняется как есть. Решение принимается по ИМЕНИ
  -- поля, а не по виду значения — угадывать «похоже на серийник диска»
  -- значит затирать лишнее и всё равно пропускать нужное.
  RETURN doc;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Что было до чистки — чтобы в логе запуска осталось число, с которым
-- можно сверить результат.
\echo '=== ДО чистки ==='
SELECT count(*) AS rows_with_secrets
  FROM audit_logs
 WHERE before IS DISTINCT FROM pg_temp.audit_redact(before)
    OR after  IS DISTINCT FROM pg_temp.audit_redact(after);

SELECT action, count(*) AS rows
  FROM audit_logs
 WHERE before IS DISTINCT FROM pg_temp.audit_redact(before)
    OR after  IS DISTINCT FROM pg_temp.audit_redact(after)
 GROUP BY action
 ORDER BY action;

-- Сама чистка. created_at не трогается: audit_logs секционирована по
-- дате, и изменение ключа секционирования вызвало бы переезд строки
-- между секциями — то есть новую физическую запись вместо правки старой.
UPDATE audit_logs
   SET before = pg_temp.audit_redact(before),
       after  = pg_temp.audit_redact(after)
 WHERE before IS DISTINCT FROM pg_temp.audit_redact(before)
    OR after  IS DISTINCT FROM pg_temp.audit_redact(after);

\echo '=== ПОСЛЕ чистки (обе цифры обязаны быть 0) ==='
SELECT count(*) AS rows_with_secrets_left
  FROM audit_logs
 WHERE before IS DISTINCT FROM pg_temp.audit_redact(before)
    OR after  IS DISTINCT FROM pg_temp.audit_redact(after);

SELECT count(*) AS raw_diskid_left
  FROM audit_logs
 WHERE after::text ILIKE '%diskId%'
   AND after -> 'diskId' IS DISTINCT FROM '"[REDACTED]"'::jsonb;

COMMIT;
