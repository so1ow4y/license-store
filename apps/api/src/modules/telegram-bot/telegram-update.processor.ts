import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { RedisService } from '@common/redis/redis.service';

import { BOT_ROUTER, type BotRouter } from './bot-router.interface';
import type { TgUpdate } from './dto/telegram-update.types';
import { TelegramBotConfig } from './telegram-bot.config';
import { TelegramUpdateQueue } from './telegram-update.queue';

/**
 * Разбор очереди апдейтов.
 *
 * Тик в секунду, а не подписка на список: BRPOP держит соединение занятым,
 * а клиент ioredis у нас один на весь процесс — блокирующая команда
 * остановила бы вместе с собой кэш лицензий, счётчики и настройки.
 * Секунда задержки в чате незаметна, второе соединение ради неё — лишняя
 * деталь, которая ломается отдельно.
 */

const TICK_MS = 1_000;
/**
 * Сколько апдейтов берётся за проход. Двадцать при секундном тике — это
 * запас к любому реальному потоку; больше значит дольше держать блокировку
 * реплики и позже отпустить чужой чат.
 */
const BATCH_SIZE = 20;

/** Блокировка реплики: очередь разбирает ровно один процесс. */
const LOCK_KEY = 'tg:updates:lock';
const LOCK_TTL_SEC = 30;

/**
 * Блокировка чата. Сериализует апдейты одного человека: без неё два
 * быстрых нажатия «Сбросить привязку» обрабатываются параллельно и
 * тратят два сброса из трёх вместо одного.
 *
 * Десять секунд — потолок разумной обработки экрана. Меньше значит
 * пустить второй апдейт в незакрытую операцию, больше — подвесить чат
 * при зависшем обработчике.
 */
const CHAT_LOCK_PREFIX = 'tg:chat-lock:';
const CHAT_LOCK_TTL_SEC = 10;

/**
 * Фоновая уборка сообщений с раскрытыми ключами — на случай, если штатный
 * таймер на 90 секунд потерян (перезапуск процесса).
 */
const SWEEP_TICK_MS = 60_000;
const SWEEP_LOCK_KEY = 'tg:keymsg:lock';
const SWEEP_LOCK_TTL_SEC = 55;

@Injectable()
export class TelegramUpdateProcessor {
  private readonly logger = new Logger(TelegramUpdateProcessor.name);

  constructor(
    private readonly queue: TelegramUpdateQueue,
    private readonly redis: RedisService,
    private readonly config: TelegramBotConfig,
    @Inject(BOT_ROUTER) private readonly router: BotRouter,
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (!this.config.enabled) return;

    // SET NX атомарен: блокировку возьмёт ровно одна реплика.
    const acquired = await this.redis.client
      .set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEC, 'NX')
      .catch(() => null);
    if (acquired === null) return;

    try {
      await this.processBatch();
    } catch (error) {
      this.logger.error(
        `сбой разбора очереди апдейтов: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.redis.client.del(LOCK_KEY).catch(() => undefined);
    }
  }

  /**
   * Фоновая уборка сообщений с ключами.
   *
   * Отдельный интервал, а не хвост tick(): tick срабатывает раз в секунду,
   * и уборка на каждом проходе означала бы обращение в Redis секунда в
   * секунду ради работы, которая нужна раз в минуту.
   */
  @Interval(SWEEP_TICK_MS)
  async sweepTick(): Promise<void> {
    if (!this.config.enabled) return;

    const acquired = await this.redis.client
      .set(SWEEP_LOCK_KEY, '1', 'EX', SWEEP_LOCK_TTL_SEC, 'NX')
      .catch(() => null);
    if (acquired === null) return;

    try {
      await this.router.sweepExpiredKeyMessages();
    } catch (error) {
      this.logger.error(
        `сбой уборки сообщений с ключами: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Замок НЕ снимается досрочно: он же и есть расписание «не чаще раза
    // в минуту». Снять его здесь значило бы разрешить второй реплике
    // повторить проход сразу же.
  }

  private async processBatch(): Promise<void> {
    const batch = await this.queue.pop(BATCH_SIZE);
    if (batch.length === 0) return;

    for (const { update, raw } of batch) {
      const chatId = chatIdOf(update);

      // Апдейт без чата обрабатывать всё равно надо (сериализовать нечего).
      if (chatId !== null) {
        const locked = await this.redis.client
          .set(`${CHAT_LOCK_PREFIX}${chatId}`, '1', 'EX', CHAT_LOCK_TTL_SEC, 'NX')
          .catch(() => 'OK' as const);

        if (locked === null) {
          // Чат занят предыдущим апдейтом — возвращаем в конец очереди,
          // а не ждём здесь: ожидание блокирует разбор всех остальных чатов.
          await this.queue.requeue(raw);
          continue;
        }
      }

      const startedAt = Date.now();
      try {
        await this.router.handleUpdate(update);
        this.logger.debug(
          `апдейт ${update.update_id} от ${telegramUserIdOf(update) ?? '—'}: ${Date.now() - startedAt} мс`,
        );
      } catch (error) {
        // Гасим намеренно: Telegram уже получил 200, повторять апдейт
        // некому, и падение одного экрана не должно останавливать очередь.
        //
        // Тело апдейта в лог НЕ идёт: там код Digiseller, регключ или
        // текст обращения в поддержку (§7.6 ТЗ).
        this.logger.error(
          `апдейт ${update.update_id} от ${telegramUserIdOf(update) ?? '—'} не обработан ` +
            `за ${Date.now() - startedAt} мс: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      } finally {
        if (chatId !== null) {
          // Снимаем сразу, а не ждём TTL: следующий апдейт того же чата
          // иначе простоит в очереди до десяти секунд.
          await this.redis.client.del(`${CHAT_LOCK_PREFIX}${chatId}`).catch(() => undefined);
        }
      }
    }
  }
}

/**
 * Чат апдейта. У callback_query сообщения может не быть (кнопка из
 * inline-режима), тогда сериализуем по автору — для нас это тот же чат.
 */
function chatIdOf(update: TgUpdate): bigint | null {
  if (update.message) return update.message.chat.id;
  if (update.callback_query) {
    return update.callback_query.message?.chat.id ?? update.callback_query.from.id;
  }
  if (update.my_chat_member) return update.my_chat_member.chat.id;
  return null;
}

/** Автор апдейта — единственный идентификатор, который разрешено логировать (§7.6 ТЗ). */
function telegramUserIdOf(update: TgUpdate): bigint | null {
  return (
    update.message?.from?.id ??
    update.callback_query?.from.id ??
    update.my_chat_member?.from.id ??
    null
  );
}
