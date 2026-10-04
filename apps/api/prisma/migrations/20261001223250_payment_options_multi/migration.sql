-- AlterTable
ALTER TABLE "product_payment_options" DROP CONSTRAINT "product_payment_options_pkey",
ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "product_payment_options_pkey" PRIMARY KEY ("product_id", "profile_id");

-- CreateIndex
CREATE INDEX "product_payment_options_product_id_provider_idx" ON "product_payment_options"("product_id", "provider");

