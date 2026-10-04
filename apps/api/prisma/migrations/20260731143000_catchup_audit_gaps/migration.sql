-- ============================================================================
--  Догоняющая миграция по результатам аудита покрытия ТЗ.
--
--  Закрывает пробелы, найденные при сверке схемы с требованиями. Выполняется
--  на пустой базе намеренно: версия ключа шифрования и удаление значения из
--  enum на заполненной БД потребовали бы перешифровки данных под замком.
--
--  Решения заказчика, отражённые здесь:
--    * счётчик сбросов HWID остаётся общим — раздельных счётчиков нет;
--    * канал LAUNCHER_PUSH удалён: загрузчик на C++ опрашивает API по HTTP
--      и постоянного соединения не держит, push доставлять нечем;
--    * одноразовые токены всех сценариев — в одной таблице с полем типа.
-- ============================================================================
-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'EMAIL_CHANGE', 'TWO_FACTOR_CHALLENGE');

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationChannel_new" AS ENUM ('EMAIL', 'DISCORD', 'TELEGRAM', 'INTERNAL');
ALTER TABLE "notifications" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TABLE "notification_templates" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
DROP TYPE "public"."NotificationChannel_old";
COMMIT;

-- DropIndex
DROP INDEX "registration_keys_used_by_user_id_key";

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "signing_secret_key_ver" INTEGER;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "hwid_enc_key_ver" INTEGER;

-- AlterTable
ALTER TABLE "hwid_history" ADD COLUMN     "actor_label" VARCHAR(255);

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "revoked_at" TIMESTAMPTZ(3),
ADD COLUMN     "revoked_reason" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "recipient" VARCHAR(255);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_last_step" BIGINT,
ADD COLUMN     "two_factor_secret_key_ver" INTEGER;

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_ip" INET,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_version_files" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size" BIGINT NOT NULL,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_version_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launcher_log_batches" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "license_id" UUID,
    "device_id" UUID,
    "client_version" VARCHAR(32),
    "kind" VARCHAR(32) NOT NULL,
    "summary" VARCHAR(512),
    "file_id" UUID,
    "size_bytes" BIGINT,
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,

    CONSTRAINT "launcher_log_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_type_used_at_idx" ON "verification_tokens"("user_id", "type", "used_at");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_version_files_version_id_path_key" ON "product_version_files"("version_id", "path");

-- CreateIndex
CREATE INDEX "launcher_log_batches_user_id_created_at_idx" ON "launcher_log_batches"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "launcher_log_batches_kind_created_at_idx" ON "launcher_log_batches"("kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "launcher_log_batches_license_id_idx" ON "launcher_log_batches"("license_id");

-- CreateIndex
CREATE INDEX "orders_product_id_created_at_idx" ON "orders"("product_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "registration_keys_used_by_user_id_idx" ON "registration_keys"("used_by_user_id");

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version_files" ADD CONSTRAINT "product_version_files_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launcher_log_batches" ADD CONSTRAINT "launcher_log_batches_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
--  Ниже — то, что Prisma выразить в схеме не умеет.
-- ============================================================================

-- Язык по умолчанию ровно один. Частичный уникальный индекс: строк с
-- is_default = true может быть максимум одна, при этом сколько угодно false.
CREATE UNIQUE INDEX "locales_single_default" ON "locales" ("is_default") WHERE "is_default";

-- Номер заказа для поддержки: ORD-2026-000123.
-- Сиквенс сквозной, без сброса по годам — номер остаётся глобально
-- уникальным, и по нему всегда однозначно находится заказ.
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

CREATE OR REPLACE FUNCTION next_order_number() RETURNS TEXT
LANGUAGE sql
AS $fn$
  SELECT 'ORD-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
         lpad(nextval('order_number_seq')::text, 6, '0');
$fn$;

ALTER TABLE "orders" ALTER COLUMN "number" SET DEFAULT next_order_number();

-- Поиск в админке по неполному совпадению (ТЗ п.8 «поиск»).
-- Без GIN-индексов по триграммам ILIKE '%текст%' идёт последовательным
-- сканом: на 10 000 пользователей это сотни миллисекунд на каждый ввод
-- символа в строке поиска.
-- Приведение к text обязательно: username и email имеют тип citext,
-- а gin_trgm_ops определён для text.
CREATE INDEX "users_username_trgm" ON "users" USING gin (("username"::text) gin_trgm_ops);
CREATE INDEX "users_email_trgm"    ON "users" USING gin (("email"::text) gin_trgm_ops);
CREATE INDEX "licenses_key_trgm"   ON "licenses" USING gin ("key" gin_trgm_ops);
