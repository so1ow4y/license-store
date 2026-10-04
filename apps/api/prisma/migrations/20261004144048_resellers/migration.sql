-- CreateEnum
CREATE TYPE "ResellerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ResellerTxType" AS ENUM ('TOPUP', 'SALE', 'REFUND', 'ADJUSTMENT', 'COMMISSION');

-- AlterEnum
ALTER TYPE "HwidEventReason" ADD VALUE 'RESELLER_RESET';

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "reseller_id" UUID;

-- AlterTable
ALTER TABLE "registration_keys" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "price" DECIMAL(12,2),
ADD COLUMN     "reseller_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reseller_id" UUID;

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
    "notes" TEXT,
    "created_by_id" UUID,
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
    "plan_id" UUID,
    "quantity" INTEGER,
    "license_id" UUID,
    "registration_key_id" UUID,
    "comment" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resellers_user_id_key" ON "resellers"("user_id");

-- CreateIndex
CREATE INDEX "resellers_status_idx" ON "resellers"("status");

-- CreateIndex
CREATE INDEX "reseller_transactions_reseller_id_created_at_idx" ON "reseller_transactions"("reseller_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reseller_transactions_type_idx" ON "reseller_transactions"("type");

-- CreateIndex
CREATE INDEX "licenses_reseller_id_idx" ON "licenses"("reseller_id");

-- CreateIndex
CREATE INDEX "registration_keys_reseller_id_created_at_idx" ON "registration_keys"("reseller_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "users_reseller_id_idx" ON "users"("reseller_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_keys" ADD CONSTRAINT "registration_keys_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_transactions" ADD CONSTRAINT "reseller_transactions_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

