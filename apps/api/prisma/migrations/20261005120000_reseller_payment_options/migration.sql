-- Реквизиты делятся на два раздела: для товаров (покупатели) и для реселлеров
-- (пополнение баланса). Все существующие реквизиты остаются в разделе товаров;
-- кошельки для пополнений администратор переносит в раздел реселлеров сам.

-- CreateEnum
CREATE TYPE "PaymentScope" AS ENUM ('PRODUCTS', 'RESELLERS');

-- AlterTable
ALTER TABLE "payment_profiles" ADD COLUMN     "scope" "PaymentScope" NOT NULL DEFAULT 'PRODUCTS';

-- CreateTable
CREATE TABLE "reseller_payment_options" (
    "reseller_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reseller_payment_options_pkey" PRIMARY KEY ("reseller_id","profile_id")
);

-- CreateIndex
CREATE INDEX "reseller_payment_options_profile_id_idx" ON "reseller_payment_options"("profile_id");

-- CreateIndex
CREATE INDEX "payment_profiles_scope_archived_at_idx" ON "payment_profiles"("scope", "archived_at");

-- AddForeignKey
ALTER TABLE "reseller_payment_options" ADD CONSTRAINT "reseller_payment_options_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_payment_options" ADD CONSTRAINT "reseller_payment_options_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "payment_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
