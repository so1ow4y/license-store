-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "profile_id" UUID;

-- CreateTable
CREATE TABLE "payment_profiles" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "product_id" UUID,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets_enc" TEXT,
    "secrets_key_ver" INTEGER,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_payment_options" (
    "product_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "profile_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_payment_options_pkey" PRIMARY KEY ("product_id","provider")
);

-- CreateTable
CREATE TABLE "user_ips" (
    "user_id" UUID NOT NULL,
    "ip" INET NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "last_user_agent" TEXT,

    CONSTRAINT "user_ips_pkey" PRIMARY KEY ("user_id","ip")
);

-- CreateTable
CREATE TABLE "ip_blocks" (
    "id" UUID NOT NULL,
    "cidr" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "ip_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_profiles_product_id_idx" ON "payment_profiles"("product_id");

-- CreateIndex
CREATE INDEX "payment_profiles_provider_archived_at_idx" ON "payment_profiles"("provider", "archived_at");

-- CreateIndex
CREATE INDEX "product_payment_options_profile_id_idx" ON "product_payment_options"("profile_id");

-- CreateIndex
CREATE INDEX "user_ips_ip_idx" ON "user_ips"("ip");

-- CreateIndex
CREATE INDEX "user_ips_last_seen_at_idx" ON "user_ips"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "ip_blocks_cidr_key" ON "ip_blocks"("cidr");

-- CreateIndex
CREATE INDEX "ip_blocks_expires_at_idx" ON "ip_blocks"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_ip_created_at_idx" ON "audit_logs"("ip", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_profile_id_idx" ON "payments"("profile_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "payment_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_profiles" ADD CONSTRAINT "payment_profiles_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_payment_options" ADD CONSTRAINT "product_payment_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_payment_options" ADD CONSTRAINT "product_payment_options_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "payment_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ips" ADD CONSTRAINT "user_ips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Данные.
--
-- Реквизиты ЮKassa и крипты переезжают из payment_methods в шаблоны, а живые
-- товары получают способы оплаты на эти шаблоны — витрина работает как раньше.
-- Ключи ЮKassa зашифрованы с привязкой к строке payment_methods и в SQL не
-- переносятся: если они были заданы, их нужно ввести заново в шаблоне.
-- ---------------------------------------------------------------------------
INSERT INTO "payment_profiles" ("id", "provider", "name", "config", "updated_at")
SELECT gen_random_uuid(), pm."provider", 'Основные реквизиты', pm."config", CURRENT_TIMESTAMP
FROM "payment_methods" pm
WHERE pm."provider" IN ('YOOKASSA', 'CRYPTO');

INSERT INTO "product_payment_options" ("product_id", "provider", "profile_id", "enabled", "updated_at")
SELECT p."id", pp."provider", pp."id", true, CURRENT_TIMESTAMP
FROM "products" p
CROSS JOIN "payment_profiles" pp
WHERE p."status" <> 'ARCHIVED';

UPDATE "payments" pay SET "profile_id" = pp."id"
FROM "payment_profiles" pp
WHERE pay."provider" = pp."provider" AND pay."profile_id" IS NULL;

UPDATE "payment_methods" SET "config" = '{}', "secrets_enc" = NULL, "secrets_key_ver" = NULL
WHERE "provider" IN ('YOOKASSA', 'CRYPTO');

-- Адреса из истории успешных входов: список IP пользователя не начинается с нуля.
INSERT INTO "user_ips" ("user_id", "ip", "first_seen_at", "last_seen_at", "hits", "last_user_agent")
SELECT lh."user_id", lh."ip", MIN(lh."created_at"), MAX(lh."created_at"), COUNT(*)::int,
       (ARRAY_AGG(lh."user_agent" ORDER BY lh."created_at" DESC))[1]
FROM "login_history" lh
JOIN "users" u ON u."id" = lh."user_id"
WHERE lh."ip" IS NOT NULL AND lh."success"
GROUP BY lh."user_id", lh."ip";

