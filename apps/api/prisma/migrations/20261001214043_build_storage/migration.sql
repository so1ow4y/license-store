-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "build_id" UUID;

-- AlterTable: название сборки по умолчанию — её версия.
ALTER TABLE "payload_builds" ADD COLUMN     "name" VARCHAR(64);
UPDATE "payload_builds" SET "name" = "version";
ALTER TABLE "payload_builds" ALTER COLUMN "name" SET NOT NULL;

-- CreateTable
CREATE TABLE "plan_builds" (
    "plan_id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_builds_pkey" PRIMARY KEY ("plan_id","build_id")
);

-- CreateIndex
CREATE INDEX "plan_builds_build_id_idx" ON "plan_builds"("build_id");

-- CreateIndex
CREATE INDEX "licenses_build_id_idx" ON "licenses"("build_id");

-- CreateIndex
CREATE UNIQUE INDEX "payload_builds_product_id_name_key" ON "payload_builds"("product_id", "name");

-- AddForeignKey
ALTER TABLE "plan_builds" ADD CONSTRAINT "plan_builds_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "license_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_builds" ADD CONSTRAINT "plan_builds_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "payload_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "payload_builds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

