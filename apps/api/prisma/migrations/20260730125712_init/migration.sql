-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('DISCORD', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'RESELLER', 'SYSTEM', 'API_KEY');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReleaseChannel" AS ENUM ('STABLE', 'BETA');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'BLOCKED', 'REVOKED');

-- CreateEnum
CREATE TYPE "HwidEventReason" AS ENUM ('FIRST_BIND', 'USER_RESET', 'ADMIN_RESET', 'RESELLER_RESET', 'ADMIN_MANUAL_SET', 'SYSTEM_REVOKE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('DIGISELLER', 'MANUAL', 'RESELLER', 'REGISTRATION_KEY');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('DIGISELLER', 'MANUAL', 'RESELLER_BALANCE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'SBP', 'CRYPTO', 'EWALLET', 'MOBILE', 'BALANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ResellerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ResellerTxType" AS ENUM ('TOPUP', 'SALE', 'REFUND', 'ADJUSTMENT', 'COMMISSION');

-- CreateEnum
CREATE TYPE "FileStorage" AS ENUM ('S3', 'LOCAL');

-- CreateEnum
CREATE TYPE "NewsStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'DISCORD', 'TELEGRAM', 'LAUNCHER_PUSH', 'INTERNAL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "ApiKeyOwnerType" AS ENUM ('SYSTEM', 'ADMIN', 'RESELLER');

-- CreateEnum
CREATE TYPE "AntiFraudType" AS ENUM ('MASS_LOGIN_ATTEMPTS', 'RATE_LIMIT_EXCEEDED', 'SUSPICIOUS_IP', 'NEW_COUNTRY', 'VPN_PROXY_DETECTED', 'REPLAY_ATTEMPT', 'HWID_CHANGE', 'CONCURRENT_SESSIONS', 'SIGNATURE_MISMATCH', 'IMPOSSIBLE_TRAVEL');

-- CreateEnum
CREATE TYPE "AntiFraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "username" CITEXT NOT NULL,
    "password_hash" TEXT,
    "password_version" INTEGER NOT NULL DEFAULT 1,
    "password_changed_at" TIMESTAMPTZ(3),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMPTZ(3),
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret_enc" TEXT,
    "two_factor_confirmed_at" TIMESTAMPTZ(3),
    "two_factor_recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locale" VARCHAR(8) NOT NULL DEFAULT 'ru',
    "reseller_id" UUID,
    "blocked_at" TIMESTAMPTZ(3),
    "blocked_reason" TEXT,
    "blocked_by_id" UUID,
    "last_login_at" TIMESTAMPTZ(3),
    "last_login_ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "provider_username" TEXT,
    "profile" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "group" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_by_id" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "country" VARCHAR(2),
    "city" VARCHAR(128),
    "device" VARCHAR(255),
    "client_version" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(64),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "family" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_ip" INET,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "owner_type" "ApiKeyOwnerType" NOT NULL,
    "user_id" UUID,
    "reseller_id" UUID,
    "prefix" VARCHAR(16) NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ip_whitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signing_secret_enc" TEXT,
    "last_used_at" TIMESTAMPTZ(3),
    "last_used_ip" INET,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_keys" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "product_id" UUID,
    "plan_id" UUID,
    "reseller_id" UUID,
    "created_by_id" UUID,
    "used_by_user_id" UUID,
    "used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "icon_file_id" UUID,
    "max_hwid_resets" INTEGER,
    "hwid_reset_cooldown_hours" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_versions" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "version_code" INTEGER NOT NULL,
    "channel" "ReleaseChannel" NOT NULL DEFAULT 'STABLE',
    "changelog" TEXT,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "file_id" UUID,
    "sha256" CHAR(64),
    "file_size" BIGINT,
    "min_launcher_version_code" INTEGER,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_plans" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "duration_days" INTEGER,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "digiseller_product_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "license_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "product_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'PENDING',
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "blocked_at" TIMESTAMPTZ(3),
    "blocked_reason" TEXT,
    "blocked_by_id" UUID,
    "current_device_id" UUID,
    "hwid_reset_count" INTEGER NOT NULL DEFAULT 0,
    "last_hwid_reset_at" TIMESTAMPTZ(3),
    "last_check_at" TIMESTAMPTZ(3),
    "last_check_ip" INET,
    "last_check_country" VARCHAR(2),
    "last_client_version" VARCHAR(32),
    "order_id" UUID,
    "reseller_id" UUID,
    "issued_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "license_id" UUID,
    "hwid_hash" CHAR(64) NOT NULL,
    "hwid_enc" TEXT,
    "os_info" VARCHAR(255),
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_ip" INET,
    "last_country" VARCHAR(2),
    "last_client_version" VARCHAR(32),
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hwid_history" (
    "id" UUID NOT NULL,
    "license_id" UUID NOT NULL,
    "reason" "HwidEventReason" NOT NULL,
    "old_hwid_hash" CHAR(64),
    "new_hwid_hash" CHAR(64),
    "old_device_id" UUID,
    "new_device_id" UUID,
    "actor_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "ip" INET,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hwid_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resellers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(128) NOT NULL,
    "status" "ResellerStatus" NOT NULL DEFAULT 'ACTIVE',
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowed_product_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "hwid_reset_daily_limit" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_transactions" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "type" "ResellerTxType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "license_id" UUID,
    "order_id" UUID,
    "comment" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "user_id" UUID,
    "reseller_id" UUID,
    "product_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "source" "OrderSource" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "comment" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'OTHER',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "external_id" VARCHAR(128),
    "raw_payload" JSONB,
    "confirmed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digiseller_orders" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "unique_code" VARCHAR(64) NOT NULL,
    "inv_id" BIGINT,
    "digiseller_product_id" INTEGER,
    "amount" DECIMAL(12,2),
    "currency" VARCHAR(3),
    "buyer_email" VARCHAR(255),
    "raw_payload" JSONB,
    "verified_at" TIMESTAMPTZ(3),
    "redeemed_at" TIMESTAMPTZ(3),
    "redeemed_by_user_id" UUID,
    "refunded_at" TIMESTAMPTZ(3),
    "last_polled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "digiseller_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "storage" "FileStorage" NOT NULL DEFAULT 'S3',
    "bucket" VARCHAR(128) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "author_id" UUID NOT NULL,
    "status" "NewsStatus" NOT NULL DEFAULT 'DRAFT',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "publish_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "cover_file_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_translations" (
    "id" UUID NOT NULL,
    "news_id" UUID NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "template_key" VARCHAR(128) NOT NULL,
    "payload" JSONB,
    "locale" VARCHAR(8) NOT NULL DEFAULT 'ru',
    "rendered_subject" VARCHAR(512),
    "rendered_body" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" VARCHAR(512),
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "identifier_used" VARCHAR(255),
    "success" BOOLEAN NOT NULL,
    "failure_reason" VARCHAR(64),
    "method" VARCHAR(32) NOT NULL,
    "ip" INET,
    "country" VARCHAR(2),
    "city" VARCHAR(128),
    "asn" INTEGER,
    "is_vpn" BOOLEAN NOT NULL DEFAULT false,
    "user_agent" TEXT,
    "client_version" VARCHAR(32),
    "device_id" UUID,
    "session_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "actor_label" VARCHAR(255),
    "action" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "anti_fraud_events" (
    "id" UUID NOT NULL,
    "type" "AntiFraudType" NOT NULL,
    "severity" "AntiFraudSeverity" NOT NULL DEFAULT 'LOW',
    "user_id" UUID,
    "license_id" UUID,
    "device_id" UUID,
    "ip" INET,
    "country" VARCHAR(2),
    "asn" INTEGER,
    "details" JSONB,
    "action_taken" VARCHAR(64),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anti_fraud_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locales" (
    "code" VARCHAR(8) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "native_name" VARCHAR(64) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locales_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "namespace" VARCHAR(64) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_reseller_id_idx" ON "users"("reseller_id");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_user_id_key" ON "oauth_accounts"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_user_id_provider_key" ON "oauth_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "roles_slug_key" ON "roles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_slug_key" ON "permissions"("slug");

-- CreateIndex
CREATE INDEX "permissions_group_idx" ON "permissions"("group");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens"("family");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_owner_type_idx" ON "api_keys"("owner_type");

-- CreateIndex
CREATE INDEX "api_keys_reseller_id_idx" ON "api_keys"("reseller_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_keys_code_key" ON "registration_keys"("code");

-- CreateIndex
CREATE UNIQUE INDEX "registration_keys_used_by_user_id_key" ON "registration_keys"("used_by_user_id");

-- CreateIndex
CREATE INDEX "registration_keys_reseller_id_idx" ON "registration_keys"("reseller_id");

-- CreateIndex
CREATE INDEX "registration_keys_used_at_idx" ON "registration_keys"("used_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "product_versions_product_id_channel_is_published_version_co_idx" ON "product_versions"("product_id", "channel", "is_published", "version_code" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "product_versions_product_id_version_key" ON "product_versions"("product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "license_plans_digiseller_product_id_key" ON "license_plans"("digiseller_product_id");

-- CreateIndex
CREATE INDEX "license_plans_is_active_idx" ON "license_plans"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "license_plans_product_id_slug_key" ON "license_plans"("product_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_key_key" ON "licenses"("key");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_current_device_id_key" ON "licenses"("current_device_id");

-- CreateIndex
CREATE INDEX "licenses_user_id_status_idx" ON "licenses"("user_id", "status");

-- CreateIndex
CREATE INDEX "licenses_product_id_status_idx" ON "licenses"("product_id", "status");

-- CreateIndex
CREATE INDEX "licenses_reseller_id_idx" ON "licenses"("reseller_id");

-- CreateIndex
CREATE INDEX "licenses_status_expires_at_idx" ON "licenses"("status", "expires_at");

-- CreateIndex
CREATE INDEX "licenses_expires_at_idx" ON "licenses"("expires_at");

-- CreateIndex
CREATE INDEX "licenses_order_id_idx" ON "licenses"("order_id");

-- CreateIndex
CREATE INDEX "devices_hwid_hash_idx" ON "devices"("hwid_hash");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "devices_is_blocked_idx" ON "devices"("is_blocked");

-- CreateIndex
CREATE UNIQUE INDEX "devices_license_id_hwid_hash_key" ON "devices"("license_id", "hwid_hash");

-- CreateIndex
CREATE INDEX "hwid_history_license_id_created_at_idx" ON "hwid_history"("license_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "hwid_history_actor_id_idx" ON "hwid_history"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "resellers_user_id_key" ON "resellers"("user_id");

-- CreateIndex
CREATE INDEX "resellers_status_idx" ON "resellers"("status");

-- CreateIndex
CREATE INDEX "reseller_transactions_reseller_id_created_at_idx" ON "reseller_transactions"("reseller_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reseller_transactions_type_idx" ON "reseller_transactions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_reseller_id_created_at_idx" ON "orders"("reseller_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_external_id_key" ON "payments"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "digiseller_orders_payment_id_key" ON "digiseller_orders"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "digiseller_orders_unique_code_key" ON "digiseller_orders"("unique_code");

-- CreateIndex
CREATE UNIQUE INDEX "digiseller_orders_inv_id_key" ON "digiseller_orders"("inv_id");

-- CreateIndex
CREATE INDEX "digiseller_orders_redeemed_at_idx" ON "digiseller_orders"("redeemed_at");

-- CreateIndex
CREATE INDEX "digiseller_orders_last_polled_at_idx" ON "digiseller_orders"("last_polled_at");

-- CreateIndex
CREATE INDEX "files_sha256_idx" ON "files"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "files_bucket_object_key_key" ON "files"("bucket", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "news_slug_key" ON "news"("slug");

-- CreateIndex
CREATE INDEX "news_status_is_pinned_published_at_idx" ON "news"("status", "is_pinned", "published_at" DESC);

-- CreateIndex
CREATE INDEX "news_publish_at_idx" ON "news"("publish_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_translations_news_id_locale_key" ON "news_translations"("news_id", "locale");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_status_channel_idx" ON "notifications"("status", "channel");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_locale_channel_key" ON "notification_templates"("key", "locale", "channel");

-- CreateIndex
CREATE INDEX "login_history_user_id_created_at_idx" ON "login_history"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "login_history_ip_created_at_idx" ON "login_history"("ip", "created_at" DESC);

-- CreateIndex
CREATE INDEX "login_history_success_created_at_idx" ON "login_history"("success", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "anti_fraud_events_type_created_at_idx" ON "anti_fraud_events"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "anti_fraud_events_user_id_created_at_idx" ON "anti_fraud_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "anti_fraud_events_severity_resolved_at_idx" ON "anti_fraud_events"("severity", "resolved_at");

-- CreateIndex
CREATE INDEX "anti_fraud_events_ip_idx" ON "anti_fraud_events"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "settings_category_idx" ON "settings"("category");

-- CreateIndex
CREATE INDEX "translations_namespace_idx" ON "translations"("namespace");

-- CreateIndex
CREATE UNIQUE INDEX "translations_locale_namespace_key_key" ON "translations"("locale", "namespace", "key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_keys" ADD CONSTRAINT "registration_keys_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_keys" ADD CONSTRAINT "registration_keys_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "license_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_keys" ADD CONSTRAINT "registration_keys_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_keys" ADD CONSTRAINT "registration_keys_used_by_user_id_fkey" FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_icon_file_id_fkey" FOREIGN KEY ("icon_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_plans" ADD CONSTRAINT "license_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "license_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_current_device_id_fkey" FOREIGN KEY ("current_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hwid_history" ADD CONSTRAINT "hwid_history_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_transactions" ADD CONSTRAINT "reseller_transactions_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "license_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digiseller_orders" ADD CONSTRAINT "digiseller_orders_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news" ADD CONSTRAINT "news_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news" ADD CONSTRAINT "news_cover_file_id_fkey" FOREIGN KEY ("cover_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_translations" ADD CONSTRAINT "news_translations_news_id_fkey" FOREIGN KEY ("news_id") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_locale_fkey" FOREIGN KEY ("locale") REFERENCES "locales"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
--  Управление помесячными партициями журнальных таблиц.
--  Обоснование и порядок применения: apps/api/prisma/sql/01_partitioning.sql
-- ============================================================================

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

            IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
                EXECUTE format(
                    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                    partition_name, tbl, period_start, period_end
                );
            END IF;
        END LOOP;

        -- DEFAULT-партиция: строка с датой вне диапазона не должна ронять
        -- бизнес-операцию, ради которой писался лог.
        partition_name := format('%s_default', tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
            EXECUTE format('CREATE TABLE %I PARTITION OF %I DEFAULT', partition_name, tbl);
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION drop_old_partitions(retention_days INT DEFAULT 90)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    tbl        TEXT;
    part       RECORD;
    cutoff     DATE;
    part_month DATE;
BEGIN
    cutoff := date_trunc('month', CURRENT_DATE - (retention_days || ' day')::INTERVAL);

    FOREACH tbl IN ARRAY ARRAY['login_history', 'audit_logs'] LOOP
        FOR part IN
            SELECT c.relname
            FROM pg_class c
            JOIN pg_inherits inh ON inh.inhrelid = c.oid
            JOIN pg_class p ON p.oid = inh.inhparent
            WHERE p.relname = tbl AND c.relname ~ '_p[0-9]{6}$'
        LOOP
            part_month := to_date(right(part.relname, 6) || '01', 'YYYYMMDD');
            IF part_month < cutoff THEN
                EXECUTE format('DROP TABLE IF EXISTS %I', part.relname);
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

SELECT create_monthly_partitions(3);
