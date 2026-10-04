-- Telegram-бот: привязка чата к аккаунту, настройки уведомлений, обращения.
--
-- ПОЧЕМУ BIGINT ДЛЯ ИДЕНТИФИКАТОРОВ TELEGRAM. Bot API отдаёт их числами, и
-- в 2021 году они перешагнули границу 32 бит. Для chat_id групп значения
-- ещё и отрицательные, причём супергруппы живут около -10^12. INTEGER здесь
-- переполнится молча на чужих данных, которые мы не выбираем.
--
-- ПОЧЕМУ СОСТОЯНИЯ ДИАЛОГА (FSM) ЗДЕСЬ НЕТ. Оно живёт в Redis: у него срок
-- жизни минуты, оно теряется без последствий (человек повторит команду), и
-- писать его в Postgres значило бы генерировать запись на каждое нажатие
-- кнопки. В БД попадает только то, что обязано пережить перезапуск.
--
-- ПОЧЕМУ У ОБРАЩЕНИЙ НЕТ ВНЕШНИХ КЛЮЧЕЙ. Соглашение журналов (см. шапку
-- schema.prisma): привязка отзывается и пересоздаётся каждые 90 дней, а
-- каскад от неё стирал бы историю обращений вместе с номерами, на которые
-- ссылаются и пользователь, и админ-чат.

-- CreateEnum
CREATE TYPE "TelegramLinkScope" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TelegramNotifyCategory" AS ENUM ('LICENSE', 'EXPIRY', 'SECURITY', 'DEVICE', 'ADMIN');

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "username" VARCHAR(64),
    "locale" VARCHAR(8) NOT NULL DEFAULT 'ru',
    "scope" "TelegramLinkScope" NOT NULL DEFAULT 'USER',
    "chat_blocked" BOOLEAN NOT NULL DEFAULT false,
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(64),

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" "TelegramLinkScope" NOT NULL DEFAULT 'USER',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_notification_prefs" (
    "link_id" UUID NOT NULL,
    "category" "TelegramNotifyCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "telegram_notification_prefs_pkey" PRIMARY KEY ("link_id","category")
);

-- CreateTable
CREATE TABLE "telegram_support_threads" (
    "id" UUID NOT NULL,
    "ticket_no" SERIAL NOT NULL,
    "link_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "admin_chat_id" BIGINT NOT NULL,
    "admin_message_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "telegram_support_threads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_user_id_key" ON "telegram_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_telegram_user_id_key" ON "telegram_links"("telegram_user_id");

-- CreateIndex
CREATE INDEX "telegram_links_chat_id_idx" ON "telegram_links"("chat_id");

-- CreateIndex
CREATE INDEX "telegram_links_revoked_at_idx" ON "telegram_links"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_code_hash_key" ON "telegram_link_codes"("code_hash");

-- CreateIndex
CREATE INDEX "telegram_link_codes_user_id_created_at_idx" ON "telegram_link_codes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "telegram_link_codes_expires_at_idx" ON "telegram_link_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_support_threads_ticket_no_key" ON "telegram_support_threads"("ticket_no");

-- CreateIndex
CREATE INDEX "telegram_support_threads_admin_chat_id_admin_message_id_idx" ON "telegram_support_threads"("admin_chat_id", "admin_message_id");

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_notification_prefs" ADD CONSTRAINT "telegram_notification_prefs_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "telegram_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Отложенная отправка уведомления.
--
-- Тихие часы (23:00-08:00 МСК) реализуются именно полем, а не пропуском строки
-- в обработчике: без него отложенная строка перечитывалась бы каждым тиком
-- очереди до самого утра, то есть тысячи раз за ночь на каждое уведомление.
--
-- NULL-able намеренно: у всех существующих строк значения нет и быть не может,
-- а NOT NULL DEFAULT now() на непустой таблице соврал бы про время отправки
-- писем, отправленных месяц назад.
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "scheduled_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "notifications_channel_status_scheduled_at_idx" ON "notifications"("channel", "status", "scheduled_at");
