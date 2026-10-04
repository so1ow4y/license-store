-- AlterEnum
ALTER TYPE "OrderSource" ADD VALUE 'WEBSITE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentProvider" ADD VALUE 'YOOKASSA';
ALTER TYPE "PaymentProvider" ADD VALUE 'CRYPTO';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "instructions" JSONB,
ADD COLUMN     "reviewed_by_id" UUID,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "payment_methods" (
    "provider" "PaymentProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets_enc" TEXT,
    "secrets_key_ver" INTEGER,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE INDEX "payments_provider_status_created_at_idx" ON "payments"("provider", "status", "created_at");

