-- ============================================================================
--  Партиционирование журнальных таблиц по месяцам.
--
--  ЗАЧЕМ: login_history и audit_logs — единственные таблицы, которые растут
--  линейно от трафика, а не от числа пользователей. При 1000 онлайн и
--  ретенции 90 дней это десятки миллионов строк. Помесячные партиции дают:
--    * DROP PARTITION вместо DELETE — очистка старых данных за миллисекунды
--      и без раздувания таблицы;
--    * partition pruning — запросы «за последние 7 дней» читают одну партицию;
--    * VACUUM/REINDEX по частям, а не по всей таблице целиком.
--
--  КАК ПРИМЕНЯТЬ (порядок важен):
--    1. npx prisma migrate dev --create-only --name init
--    2. Из сгенерированного migration.sql УДАЛИТЬ блоки
--       CREATE TABLE "login_history" ... и CREATE TABLE "audit_logs" ...
--       вместе с их CREATE INDEX.
--    3. Вставить на их место содержимое этого файла.
--    4. npx prisma migrate deploy
--
--  Скрипт идемпотентен — повторный запуск безопасен.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  login_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "login_history" (
    "id"              UUID         NOT NULL,
    "user_id"         UUID,
    "identifier_used" VARCHAR(255),
    "success"         BOOLEAN      NOT NULL,
    "failure_reason"  VARCHAR(64),
    "method"          VARCHAR(32)  NOT NULL,
    "ip"              INET,
    "country"         VARCHAR(2),
    "city"            VARCHAR(128),
    "asn"             INTEGER,
    "is_vpn"          BOOLEAN      NOT NULL DEFAULT false,
    "user_agent"      TEXT,
    "client_version"  VARCHAR(32),
    "device_id"       UUID,
    "session_id"      UUID,
    "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

CREATE INDEX IF NOT EXISTS "login_history_user_id_created_at_idx"
    ON "login_history" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "login_history_ip_created_at_idx"
    ON "login_history" ("ip", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "login_history_success_created_at_idx"
    ON "login_history" ("success", "created_at" DESC);

-- ---------------------------------------------------------------------------
--  audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id"          UUID         NOT NULL,
    "actor_id"    UUID,
    "actor_type"  "ActorType"  NOT NULL,
    "actor_label" VARCHAR(255),
    "action"      VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id"   UUID,
    "before"      JSONB,
    "after"       JSONB,
    "ip"          INET,
    "user_agent"  TEXT,
    "request_id"  VARCHAR(64),
    "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_created_at_idx"
    ON "audit_logs" ("actor_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx"
    ON "audit_logs" ("action", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_created_at_idx"
    ON "audit_logs" ("entity_type", "entity_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
--  Создание помесячных партиций.
--  Вызывается кроном раз в сутки: SELECT create_monthly_partitions(3);
--  Держим партиции на 3 месяца вперёд — с запасом, чтобы вставка никогда
--  не упала из-за отсутствия партиции, даже если крон пропустил запуск.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_monthly_partitions(months_ahead INT DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    tbl            TEXT;
    period_start   DATE;
    period_end     DATE;
    partition_name TEXT;
    i              INT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['login_history', 'audit_logs'] LOOP
        FOR i IN 0..months_ahead LOOP
            period_start   := date_trunc('month', CURRENT_DATE) + (i || ' month')::INTERVAL;
            period_end     := period_start + INTERVAL '1 month';
            partition_name := format('%s_p%s', tbl, to_char(period_start, 'YYYYMM'));

            IF NOT EXISTS (
                SELECT 1 FROM pg_class WHERE relname = partition_name
            ) THEN
                EXECUTE format(
                    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                    partition_name, tbl, period_start, period_end
                );
                RAISE NOTICE 'created partition %', partition_name;
            END IF;
        END LOOP;

        -- DEFAULT-партиция: страховка от строк вне диапазона. Без неё
        -- вставка с «кривой» датой упадёт и уронит бизнес-операцию.
        partition_name := format('%s_default', tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
            EXECUTE format('CREATE TABLE %I PARTITION OF %I DEFAULT', partition_name, tbl);
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
--  Удаление партиций старше retention. Крон: SELECT drop_old_partitions(90);
--  DROP TABLE вместо DELETE — мгновенно и без bloat.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION drop_old_partitions(retention_days INT DEFAULT 90)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    tbl          TEXT;
    part         RECORD;
    cutoff       DATE;
    part_month   DATE;
BEGIN
    cutoff := date_trunc('month', CURRENT_DATE - (retention_days || ' day')::INTERVAL);

    FOREACH tbl IN ARRAY ARRAY['login_history', 'audit_logs'] LOOP
        FOR part IN
            SELECT c.relname
            FROM pg_class c
            JOIN pg_inherits inh ON inh.inhrelid = c.oid
            JOIN pg_class p ON p.oid = inh.inhparent
            WHERE p.relname = tbl
              AND c.relname ~ '_p[0-9]{6}$'
        LOOP
            part_month := to_date(right(part.relname, 6) || '01', 'YYYYMMDD');
            IF part_month < cutoff THEN
                EXECUTE format('DROP TABLE IF EXISTS %I', part.relname);
                RAISE NOTICE 'dropped partition % (month %)', part.relname, part_month;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

-- Первичное создание партиций, чтобы приложение могло писать сразу после миграции.
SELECT create_monthly_partitions(3);
