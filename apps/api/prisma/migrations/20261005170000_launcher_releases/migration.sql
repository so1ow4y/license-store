-- Релизы клиента-загрузчика: версии по платформам и каналам, кому доступны,
-- файл в хранилище с хешем от сервера, счётчик скачиваний.

-- CreateEnum
CREATE TYPE "LauncherAudience" AS ENUM ('PUBLIC', 'USERS', 'LICENSED', 'ROLES');

-- CreateEnum
CREATE TYPE "LauncherPlatform" AS ENUM ('WINDOWS', 'LINUX', 'MACOS');

-- CreateTable
CREATE TABLE "launcher_releases" (
    "id" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "version_code" INTEGER NOT NULL,
    "platform" "LauncherPlatform" NOT NULL DEFAULT 'WINDOWS',
    "channel" "ReleaseChannel" NOT NULL DEFAULT 'STABLE',
    "notes" TEXT,
    "audience" "LauncherAudience" NOT NULL DEFAULT 'USERS',
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "file_id" UUID,
    "file_name" VARCHAR(255),
    "sha256" CHAR(64),
    "file_size" BIGINT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "launcher_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "launcher_releases_platform_channel_is_published_version_cod_idx" ON "launcher_releases"("platform", "channel", "is_published", "version_code" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "launcher_releases_platform_channel_version_key" ON "launcher_releases"("platform", "channel", "version");

-- AddForeignKey
ALTER TABLE "launcher_releases" ADD CONSTRAINT "launcher_releases_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Описание страницы загрузки: требования и шаги установки. Правится в
-- админке без деплоя, поэтому строка нужна сразу.
INSERT INTO "settings" ("id", "key", "value", "category", "is_secret", "description", "created_at", "updated_at")
VALUES (
    gen_random_uuid(),
    'launcher.page',
    '{"requirements":"Windows 10 или 11, 64 бита\nСвободно 300 МБ на диске\nСтабильное интернет-соединение","steps":"Скачайте установщик\nЗапустите его и следуйте подсказкам\nВойдите своим логином и паролем от кабинета\nВыберите продукт — загрузчик сам скачает и обновит его"}'::jsonb,
    'launcher',
    false,
    'Страница загрузчика: системные требования и шаги установки',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
