-- Удаление заготовок без кода: реселлеры, новости, таблицы языков и переводов,
-- каналы уведомлений DISCORD/INTERNAL. Ни одна из этих сущностей не
-- создавалась кодом, поэтому данных в них быть не может; на случай ручных
-- вставок строки со снимаемыми значениями enum'ов сначала переводятся на
-- допустимые — иначе смена типа упадёт на живой базе.

-- Данные под снимаемые значения ---------------------------------------------
UPDATE "hwid_history" SET "reason" = 'ADMIN_RESET' WHERE "reason" = 'RESELLER_RESET';
UPDATE "hwid_history" SET "actor_type" = 'USER' WHERE "actor_type" = 'RESELLER';
UPDATE "audit_logs" SET "actor_type" = 'USER' WHERE "actor_type" = 'RESELLER';
UPDATE "api_keys" SET "owner_type" = 'ADMIN' WHERE "owner_type" = 'RESELLER';
UPDATE "orders" SET "source" = 'MANUAL' WHERE "source" = 'RESELLER';
UPDATE "payments" SET "provider" = 'MANUAL' WHERE "provider" = 'RESELLER_BALANCE';
UPDATE "payments" SET "method" = 'OTHER' WHERE "method" = 'BALANCE';
DELETE FROM "notifications" WHERE "channel" IN ('DISCORD', 'INTERNAL');
UPDATE "notifications" SET "status" = 'SENT' WHERE "status" = 'READ';
DELETE FROM "notification_templates" WHERE "channel" IN ('DISCORD', 'INTERNAL');
-- Роль реселлера (привязки к пользователям и правам уходят каскадом).
DELETE FROM "roles" WHERE "slug" = 'reseller';

-- AlterEnum
BEGIN;
CREATE TYPE "ActorType_new" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'API_KEY');
ALTER TABLE "hwid_history" ALTER COLUMN "actor_type" TYPE "ActorType_new" USING ("actor_type"::text::"ActorType_new");
ALTER TABLE "audit_logs" ALTER COLUMN "actor_type" TYPE "ActorType_new" USING ("actor_type"::text::"ActorType_new");
ALTER TYPE "ActorType" RENAME TO "ActorType_old";
ALTER TYPE "ActorType_new" RENAME TO "ActorType";
DROP TYPE "public"."ActorType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ApiKeyOwnerType_new" AS ENUM ('SYSTEM', 'ADMIN');
ALTER TABLE "api_keys" ALTER COLUMN "owner_type" TYPE "ApiKeyOwnerType_new" USING ("owner_type"::text::"ApiKeyOwnerType_new");
ALTER TYPE "ApiKeyOwnerType" RENAME TO "ApiKeyOwnerType_old";
ALTER TYPE "ApiKeyOwnerType_new" RENAME TO "ApiKeyOwnerType";
DROP TYPE "public"."ApiKeyOwnerType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "HwidEventReason_new" AS ENUM ('FIRST_BIND', 'USER_RESET', 'ADMIN_RESET', 'ADMIN_MANUAL_SET', 'SYSTEM_REVOKE');
ALTER TABLE "hwid_history" ALTER COLUMN "reason" TYPE "HwidEventReason_new" USING ("reason"::text::"HwidEventReason_new");
ALTER TYPE "HwidEventReason" RENAME TO "HwidEventReason_old";
ALTER TYPE "HwidEventReason_new" RENAME TO "HwidEventReason";
DROP TYPE "public"."HwidEventReason_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationChannel_new" AS ENUM ('EMAIL', 'TELEGRAM');
ALTER TABLE "notifications" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TABLE "notification_templates" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
DROP TYPE "public"."NotificationChannel_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationStatus_new" AS ENUM ('PENDING', 'SENT', 'FAILED');
ALTER TABLE "public"."notifications" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "notifications" ALTER COLUMN "status" TYPE "NotificationStatus_new" USING ("status"::text::"NotificationStatus_new");
ALTER TYPE "NotificationStatus" RENAME TO "NotificationStatus_old";
ALTER TYPE "NotificationStatus_new" RENAME TO "NotificationStatus";
DROP TYPE "public"."NotificationStatus_old";
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OrderSource_new" AS ENUM ('DIGISELLER', 'MANUAL', 'REGISTRATION_KEY');
ALTER TABLE "orders" ALTER COLUMN "source" TYPE "OrderSource_new" USING ("source"::text::"OrderSource_new");
ALTER TYPE "OrderSource" RENAME TO "OrderSource_old";
ALTER TYPE "OrderSource_new" RENAME TO "OrderSource";
DROP TYPE "public"."OrderSource_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('CARD', 'SBP', 'CRYPTO', 'EWALLET', 'MOBILE', 'OTHER');
ALTER TABLE "public"."payments" ALTER COLUMN "method" DROP DEFAULT;
ALTER TABLE "payments" ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "public"."PaymentMethod_old";
ALTER TABLE "payments" ALTER COLUMN "method" SET DEFAULT 'OTHER';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentProvider_new" AS ENUM ('DIGISELLER', 'MANUAL');
ALTER TABLE "payments" ALTER COLUMN "provider" TYPE "PaymentProvider_new" USING ("provider"::text::"PaymentProvider_new");
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
ALTER TYPE "PaymentProvider_new" RENAME TO "PaymentProvider";
DROP TYPE "public"."PaymentProvider_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_reseller_id_fkey";
ALTER TABLE "licenses" DROP CONSTRAINT "licenses_reseller_id_fkey";
ALTER TABLE "news" DROP CONSTRAINT "news_author_id_fkey";
ALTER TABLE "news" DROP CONSTRAINT "news_cover_file_id_fkey";
ALTER TABLE "news_translations" DROP CONSTRAINT "news_translations_news_id_fkey";
ALTER TABLE "orders" DROP CONSTRAINT "orders_reseller_id_fkey";
ALTER TABLE "registration_keys" DROP CONSTRAINT "registration_keys_reseller_id_fkey";
ALTER TABLE "reseller_transactions" DROP CONSTRAINT "reseller_transactions_reseller_id_fkey";
ALTER TABLE "resellers" DROP CONSTRAINT "resellers_user_id_fkey";
ALTER TABLE "translations" DROP CONSTRAINT "translations_locale_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_reseller_id_fkey";

-- DropIndex
DROP INDEX "api_keys_reseller_id_idx";
DROP INDEX "licenses_reseller_id_idx";
DROP INDEX "orders_reseller_id_created_at_idx";
DROP INDEX "registration_keys_reseller_id_idx";
DROP INDEX "users_reseller_id_idx";

-- AlterTable
ALTER TABLE "api_keys" DROP COLUMN "reseller_id";
ALTER TABLE "licenses" DROP COLUMN "reseller_id";
ALTER TABLE "orders" DROP COLUMN "reseller_id";
ALTER TABLE "registration_keys" DROP COLUMN "reseller_id";
ALTER TABLE "users" DROP COLUMN "reseller_id";

-- DropTable
DROP TABLE "locales";
DROP TABLE "news";
DROP TABLE "news_translations";
DROP TABLE "reseller_transactions";
DROP TABLE "resellers";
DROP TABLE "translations";

-- DropEnum
DROP TYPE "NewsStatus";
DROP TYPE "ResellerStatus";
DROP TYPE "ResellerTxType";
