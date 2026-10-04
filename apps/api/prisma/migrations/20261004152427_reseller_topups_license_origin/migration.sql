-- CreateEnum
CREATE TYPE "ResellerTopupStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "registration_key_id" UUID;

-- CreateTable
CREATE TABLE "reseller_topups" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "profile_id" UUID,
    "wallet_id" VARCHAR(64),
    "instructions" JSONB NOT NULL,
    "tx_hash" VARCHAR(140),
    "status" "ResellerTopupStatus" NOT NULL DEFAULT 'PENDING',
    "credited_amount" DECIMAL(12,2),
    "note" TEXT,
    "reject_reason" TEXT,
    "reviewed_by_id" UUID,
    "transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "reseller_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reseller_topups_tx_hash_key" ON "reseller_topups"("tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_topups_transaction_id_key" ON "reseller_topups"("transaction_id");

-- CreateIndex
CREATE INDEX "reseller_topups_status_created_at_idx" ON "reseller_topups"("status", "created_at");

-- CreateIndex
CREATE INDEX "reseller_topups_reseller_id_created_at_idx" ON "reseller_topups"("reseller_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "licenses_registration_key_id_key" ON "licenses"("registration_key_id");

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_registration_key_id_fkey" FOREIGN KEY ("registration_key_id") REFERENCES "registration_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_topups" ADD CONSTRAINT "reseller_topups_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Связь с ключом для лицензий, выданных ДО этой миграции. Лицензия по ключу
-- создаётся в той же транзакции, что и погашение ключа, поэтому её владелец,
-- тариф и время совпадают с used_by_user_id, plan_id и used_at ключа.
-- DISTINCT ON с обеих сторон: каждому ключу — не больше одной лицензии и
-- наоборот, даже если один человек погасил два ключа в одну секунду.
WITH candidates AS (
  SELECT DISTINCT ON (k.id) k.id AS key_id, l.id AS license_id
    FROM "registration_keys" k
    JOIN "licenses" l ON l.user_id = k.used_by_user_id AND l.plan_id = k.plan_id
   WHERE k.used_at IS NOT NULL
     AND l.registration_key_id IS NULL
     AND abs(extract(epoch FROM (l.created_at - k.used_at))) < 5
   ORDER BY k.id, abs(extract(epoch FROM (l.created_at - k.used_at)))
), matched AS (
  SELECT DISTINCT ON (license_id) license_id, key_id FROM candidates ORDER BY license_id, key_id
)
UPDATE "licenses" l SET registration_key_id = m.key_id FROM matched m WHERE l.id = m.license_id;

