import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '@common/prisma/prisma.service';
import { AuthService } from '@modules/auth/auth.service';
import { HwidService } from '@modules/hwid/hwid.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import type { BotActor } from './bot-actor.service';
import { BotRateService } from './bot-rate.service';
import { expiryLine, statusIcon, toLicenseView } from './bot-format';
import { escapeHtml, truncate } from './telegram-html';
import { TelegramApiService } from './telegram.api';
import { TelegramBotConfig } from './telegram-bot.config';
import { pickLocale, t } from './i18n';
import type { TgUpdate } from './dto/telegram-update.types';

/**
 * Обращения в поддержку (§5.8).
 *
 * Текст обращения В БАЗУ НЕ ПИШЕТСЯ (решение A7). В `TelegramSupportThread`
 * лежат только номер, идентификаторы и ссылка на сообщение в админ-чате;
 * сам текст живёт в переписке владельца. Причина простая: текст обращения —
 * это то, что человек пишет о своей проблеме, и там регулярно оказывается
 * то, чего он присылать не собирался. Не хранить дешевле, чем защищать.
 *
 * По той же причине текст не попадает в лог приложения — ни в info,
 * ни в отладку.
 */

/** Лимит обращений: 3 в час на пользователя (§7.5 ТЗ). */
const SUPPORT_LIMIT = 3;
const SUPPORT_WINDOW_SEC = 3600;

/** Потолок текста обращения. Лимит сообщения Telegram — 4096 на всё вместе со сводкой. */
const MAX_TEXT_LENGTH = 2000;

/** Сколько лицензий прикладывается к обращению. Больше — это уже выгрузка, а не контекст. */
const LICENSES_IN_TICKET = 5;

/** Заглушка до отправки: настоящий message_id известен только после ответа Telegram. */
const PENDING_MESSAGE_ID = 0n;

export interface SupportTicket {
  ticketNo: number;
}

@Injectable()
export class BotSupportService {
  private readonly logger = new Logger(BotSupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly licenses: LicensesService,
    private readonly hwid: HwidService,
    private readonly telegram: TelegramApiService,
    private readonly rate: BotRateService,
    private readonly config: TelegramBotConfig,
  ) {}

  /** Превышен ли лимит обращений. Отдельным методом: экран решает, что показать. */
  async allow(userId: string): Promise<boolean> {
    return this.rate.hit(`tg:support:${userId}`, SUPPORT_LIMIT, SUPPORT_WINDOW_SEC);
  }

  /**
   * Открыть обращение.
   *
   * Порядок «строка → отправка → доклейка message_id» выбран не случайно:
   * номер обращения нужен уже в тексте сообщения, а выдаёт его
   * последовательность в БД. Если отправка не удалась, строка удаляется —
   * иначе номера растут от несуществующих обращений, и владелец видит
   * «Обращение №47» первым в жизни.
   */
  async open(actor: BotActor, rawText: string): Promise<SupportTicket | null> {
    const adminChatId = this.config.adminChatId;

    if (adminChatId === null) {
      this.logger.error('обращение не отправлено: TELEGRAM_ADMIN_CHAT_ID не задан');
      return null;
    }

    const text = truncate(rawText.trim(), MAX_TEXT_LENGTH);
    if (text.length === 0) return null;

    const thread = await this.prisma.telegramSupportThread.create({
      data: {
        id: uuidv7(),
        linkId: actor.link.id,
        userId: actor.user.id,
        adminChatId,
        adminMessageId: PENDING_MESSAGE_ID,
      },
      select: { id: true, ticketNo: true },
    });

    try {
      const body = await this.composeTicket(actor, thread.ticketNo, text);
      const sent = await this.telegram.sendMessage(adminChatId, body);

      await this.prisma.telegramSupportThread.update({
        where: { id: thread.id },
        data: { adminMessageId: BigInt(sent.messageId) },
      });

      // Номер и идентификаторы — да, текст обращения — нет.
      this.logger.log(`обращение №${thread.ticketNo} от пользователя ${actor.user.id}`);
      return { ticketNo: thread.ticketNo };
    } catch (error) {
      await this.prisma.telegramSupportThread
        .delete({ where: { id: thread.id } })
        .catch(() => undefined);

      this.logger.error(
        `обращение №${thread.ticketNo} не доставлено: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Ответ владельца реплаем в админ-чате → сообщение пользователю.
   *
   * Возвращает true, если апдейт был ответом на обращение и обработан.
   * Всё остальное в админ-чате бот игнорирует: это рабочая переписка
   * владельца, и отвечать на неё командами он не должен (§3.9 ТЗ).
   */
  async relayAdminReply(update: TgUpdate): Promise<boolean> {
    const message = update.message;
    const adminChatId = this.config.adminChatId;

    if (!message || adminChatId === null) return false;
    if (message.chat.id !== adminChatId) return false;

    const replyTo = message.reply_to_message;
    const text = message.text?.trim();
    if (!replyTo || !text) return false;

    const thread = await this.prisma.telegramSupportThread.findFirst({
      where: { adminChatId, adminMessageId: BigInt(replyTo.message_id) },
      select: { id: true, ticketNo: true, linkId: true, userId: true },
    });

    if (!thread) return false;

    const link = await this.deliveryLink(thread.linkId, thread.userId);

    if (!link) {
      this.logger.warn(`ответ на обращение №${thread.ticketNo} некому доставить: привязки нет`);
      return true;
    }

    const locale = pickLocale(link.locale);
    const body = `${t(locale, 'msg.support_reply')}\n\n${escapeHtml(truncate(text, MAX_TEXT_LENGTH))}`;

    try {
      await this.telegram.sendMessage(link.chatId, body);
      await this.prisma.telegramSupportThread.update({
        where: { id: thread.id },
        data: { closedAt: new Date() },
      });
      this.logger.log(`ответ по обращению №${thread.ticketNo} доставлен`);
    } catch (error) {
      this.logger.error(
        `ответ по обращению №${thread.ticketNo} не доставлен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return true;
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Куда доставлять ответ поддержки: по привязке обращения, а если её
   * вытеснили — по текущей привязке владельца обращения.
   */
  private async deliveryLink(
    linkId: string,
    userId: string,
  ): Promise<{ chatId: bigint; locale: string } | null> {
    const byLink = await this.prisma.telegramLink.findUnique({
      where: { id: linkId },
      select: { chatId: true, locale: true, revokedAt: true, expiresAt: true },
    });

    if (byLink && byLink.revokedAt === null && !this.isExpired(byLink.expiresAt)) {
      return { chatId: byLink.chatId, locale: byLink.locale };
    }

    const current = await this.prisma.telegramLink.findFirst({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { chatId: true, locale: true },
    });

    return current;
  }

  private isExpired(expiresAt: Date | null): boolean {
    return expiresAt !== null && expiresAt.getTime() <= Date.now();
  }

  /**
   * Текст обращения для админ-чата.
   *
   * По-русски: это сообщение читает владелец, а не пользователь бота.
   * Ключи лицензий — только масками: владельцу для разбора хватает
   * последних четырёх символов, а полный ключ в переписке живёт вечно.
   */
  private async composeTicket(actor: BotActor, ticketNo: number, text: string): Promise<string> {
    const profile = await this.auth.getPublicUser(actor.user.id);
    const list = await this.licenses.list(actor.user, { take: LICENSES_IN_TICKET });

    const lines: string[] = [];
    for (const item of list.items) {
      const view = toLicenseView(item);
      const binding = await this.hwid
        .statusFor(view.id, actor.user.id)
        .then((status) => (status.bound ? 'привязана' : 'не привязана'))
        .catch(() => '—');

      lines.push(
        `${statusIcon(view.status)} ${escapeHtml(view.productName)} · ${escapeHtml(
          expiryLine('ru', view),
        )} · <code>${escapeHtml(view.maskedKey)}</code> · ${binding}`,
      );
    }

    const telegramLabel = actor.link.telegramUserId.toString();

    return [
      `💬 <b>Обращение №${ticketNo}</b>`,
      `Пользователь: ${escapeHtml(profile.username)} (id <code>${escapeHtml(actor.user.id)}</code>)`,
      `Telegram: <code>${escapeHtml(telegramLabel)}</code>`,
      `Лицензий: ${list.total}`,
      ...(lines.length > 0 ? lines : ['—']),
      '',
      escapeHtml(text),
    ].join('\n');
  }
}
