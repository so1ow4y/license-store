-- ============================================================================
--  Payload (ТЗ §7): отдельная сущность сборки и журнал выдач.
--
--  Аддитивно: ни одна существующая таблица не меняется. Слот артефакта у
--  product_versions ровно один (file_id) и занят дистрибутивом §8, а publish()
--  версии требует file_id + sha256 — на общей строке новый payload нельзя
--  выкатить, не выпустив новый exe. Поэтому payload_builds, а не колонка.
--
--  payload_issues — журнал без внешних ключей, по тому же соглашению, что
--  launcher_log_batches и audit_logs: строка обязана пережить удаление
--  лицензии, устройства и самой сборки. Целостность обеспечивается
--  приложением. Партиционирование не заводится: объём ~3 тыс. строк в сутки.
-- ============================================================================
-- CreateEnum
CREATE TYPE "PayloadIssueResult" AS ENUM ('ISSUED', 'DENIED_LICENSE', 'DENIED_HWID', 'DENIED_NOT_BOUND', 'DENIED_NOT_ACTIVATED', 'DENIED_NOT_READY', 'DENIED_UPDATE_REQUIRED', 'DENIED_RATE_LIMIT', 'DENIED_SCOPE', 'DENIED_CAPACITY', 'ERROR_CORRUPT');

-- CreateTable
CREATE TABLE "payload_builds" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "version_code" INTEGER NOT NULL,
    "channel" "ReleaseChannel" NOT NULL DEFAULT 'STABLE',
    "file_id" UUID,
    "sha256" CHAR(64),
    "size_bytes" BIGINT,
    "min_launcher_version_code" INTEGER,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payload_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payload_issues" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "license_id" UUID,
    "device_id" UUID,
    "product_id" UUID,
    "payload_build_id" UUID,
    "payload_version" VARCHAR(32),
    "hwid_hash" CHAR(64),
    "client_version" VARCHAR(32),
    "api_key_id" UUID,
    "ip" INET,
    "country" VARCHAR(2),
    "result" "PayloadIssueResult" NOT NULL,
    "size_bytes" BIGINT,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payload_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payload_builds_product_id_channel_is_published_version_code_idx" ON "payload_builds"("product_id", "channel", "is_published", "version_code" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payload_builds_product_id_version_key" ON "payload_builds"("product_id", "version");

-- CreateIndex
CREATE INDEX "payload_issues_license_id_created_at_idx" ON "payload_issues"("license_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payload_issues_hwid_hash_created_at_idx" ON "payload_issues"("hwid_hash", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payload_issues_ip_created_at_idx" ON "payload_issues"("ip", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payload_issues_user_id_created_at_idx" ON "payload_issues"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payload_issues_result_created_at_idx" ON "payload_issues"("result", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "payload_builds" ADD CONSTRAINT "payload_builds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT, а не SET NULL как у product_versions.file_id: у опубликованной
-- сборки потеря ссылки на файл — это авария выдачи, а не «файла нет». Отказ
-- на удалении дешевле, чем 409/503 у каждого пользователя на горячем пути.
ALTER TABLE "payload_builds" ADD CONSTRAINT "payload_builds_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
