-- Центр безопасности: уровни блокировок (приложение / nginx / фаервол),
-- приоритет трафика, правила корреляции со сработками, свои дашборды.

-- CreateEnum
CREATE TYPE "IpBlockLevel" AS ENUM ('APP', 'EDGE', 'FIREWALL');

-- CreateEnum
CREATE TYPE "TrafficPriorityKind" AS ENUM ('IP', 'USER');

-- CreateEnum
CREATE TYPE "CorrelationSource" AS ENUM ('LOGINS', 'AUDIT');

-- CreateEnum
CREATE TYPE "CorrelationAction" AS ENUM ('ALERT', 'BLOCK_IP', 'BLOCK_USER');

-- CreateEnum
CREATE TYPE "HitSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HitStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE');

-- AlterTable
ALTER TABLE "ip_blocks" ADD COLUMN     "level" "IpBlockLevel" NOT NULL DEFAULT 'APP',
ADD COLUMN     "ports" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "rule_id" UUID,
ADD COLUMN     "source" VARCHAR(16) NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "traffic_priorities" (
    "id" UUID NOT NULL,
    "kind" "TrafficPriorityKind" NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "weight" INTEGER NOT NULL,
    "note" VARCHAR(300),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_rules" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "source" "CorrelationSource" NOT NULL,
    "query" VARCHAR(1000) NOT NULL DEFAULT '',
    "group_by" VARCHAR(32) NOT NULL,
    "distinct_field" VARCHAR(32),
    "threshold" INTEGER NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "severity" "HitSeverity" NOT NULL DEFAULT 'MEDIUM',
    "action" "CorrelationAction" NOT NULL DEFAULT 'ALERT',
    "block_level" "IpBlockLevel" NOT NULL DEFAULT 'EDGE',
    "block_ports" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "block_hours" INTEGER,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_run_at" TIMESTAMPTZ(3),
    "last_hit_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "correlation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_hits" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "group_key" VARCHAR(255) NOT NULL,
    "count" INTEGER NOT NULL,
    "distinct_count" INTEGER,
    "severity" "HitSeverity" NOT NULL,
    "action" "CorrelationAction" NOT NULL,
    "outcome" VARCHAR(64) NOT NULL,
    "block_id" UUID,
    "status" "HitStatus" NOT NULL DEFAULT 'NEW',
    "window_from" TIMESTAMPTZ(3) NOT NULL,
    "window_to" TIMESTAMPTZ(3) NOT NULL,
    "first_event_at" TIMESTAMPTZ(3),
    "last_event_at" TIMESTAMPTZ(3),
    "sample" JSONB,
    "note" VARCHAR(1000),
    "handled_by_id" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correlation_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_dashboards" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "security_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "traffic_priorities_kind_value_key" ON "traffic_priorities"("kind", "value");

-- CreateIndex
CREATE INDEX "correlation_rules_enabled_idx" ON "correlation_rules"("enabled");

-- CreateIndex
CREATE INDEX "correlation_hits_rule_id_group_key_created_at_idx" ON "correlation_hits"("rule_id", "group_key", "created_at");

-- CreateIndex
CREATE INDEX "correlation_hits_status_created_at_idx" ON "correlation_hits"("status", "created_at");

-- CreateIndex
CREATE INDEX "correlation_hits_created_at_idx" ON "correlation_hits"("created_at");

-- CreateIndex
CREATE INDEX "security_dashboards_owner_id_idx" ON "security_dashboards"("owner_id");

-- CreateIndex
CREATE INDEX "ip_blocks_level_idx" ON "ip_blocks"("level");

-- AddForeignKey
ALTER TABLE "correlation_hits" ADD CONSTRAINT "correlation_hits_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "correlation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Настройка приоритета трафика. Строка нужна сразу после миграции:
-- SettingsService.set() правит только существующие ключи, а ждать
-- повторного сида, чтобы включить «режим атаки», нельзя.
INSERT INTO "settings" ("id", "key", "value", "category", "is_secret", "description", "created_at", "updated_at")
VALUES (
    gen_random_uuid(),
    'security.traffic',
    '{"enabled":true,"maxConcurrent":128,"queueMax":1000,"queueTimeoutMs":8000,"bypassWeight":90,"lagThresholdMs":250,"anonymousWeight":10,"authenticatedWeight":30,"roleWeights":{"super_admin":100,"security_admin":95,"product_admin":80,"support":70,"reseller":50},"attackMode":false,"attackMinWeight":50}'::jsonb,
    'security',
    false,
    'Приоритет трафика: лимит одновременных запросов, очередь по весам, режим атаки',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
