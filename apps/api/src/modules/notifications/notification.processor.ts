import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationChannel, NotificationStatus } from '@prisma/client';

import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';

import { MailService } from './mail.service';
import { NotificationService } from './notification.service';
import { TelegramChannelService } from './telegram-channel.service';

/** Как часто разбирается очередь. */
const TICK_MS = 5_000;
/** Сколько уведомлений берётся за один проход. */
const BATCH_SIZE = 20;

/**
 * Пауза перед попыткой номер N (индекс = сколько попыток уже сделано).
 * Восемь попыток растянуты примерно на восемь часов: FAILED окончателен,
 * а почтовый сервер на время выкладки отвечает 4xx.
 */
const RETRY_BACKOFF_MS = [
  0,
  60_000, // 1 мин
  5 * 60_000, // 5 мин
  15 * 60_000, // 15 мин
  30 * 60_000, // 30 мин
  60 * 60_000, // 1 ч
  2 * 60 * 60_000, // 2 ч
  4 * 60 * 60_000, // 4 ч
];

/** Попыток отправки, после чего уведомление помечается FAILED. */
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

/**
 * Блокировка в Redis, чтобы при нескольких репликах пакет обрабатывала одна.
 * Владелец помечен случайным токеном; замок продлевается после каждого
 * уведомления (одна отправка может идти почти минуту) и снимается только
 * владельцем — иначе письма уходили бы дважды.
 */
const LOCK_KEY = 'notifications:processor:lock';
const LOCK_TTL_SEC = 30;

/**
 * Продлить замок, если он всё ещё наш. Возвращает 1 при успехе.
 *
 * Именно скрипт, а не GET + EXPIRE: между двумя командами замок может
 * протухнуть и достаться другой реплике, и мы продлили бы чужой.
 */
const RENEW_LOCK_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
`;

/** Снять замок, если он наш. Тот же довод, что и у продления. */
const RELEASE_LOCK_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/**
 * Постоянный ли это отказ SMTP.
 *
 * ЗАЧЕМ РАЗЛИЧАТЬ. Повторять имеет смысл только временные отказы: код 4xx
 * («милтер недоступен», «попробуйте позже», «превышена скорость»), обрыв
 * соединения, таймаут. Постоянный 5xx — «такого ящика нет», «отправитель
 * запрещён» — не изменится ни через минуту, ни через восемь часов: восемь
 * попыток по нему лишь задержат появление честного FAILED в базе и восемь
 * раз повторят одну и ту же строку в журнале.
 *
 * responseCode проставляет nodemailer из ответа сервера. Его отсутствие —
 * это как раз сетевая ошибка (ECONNREFUSED, таймаут), то есть временная.
 */
function isPermanentSmtpError(error: unknown): boolean {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
}

/** Пауза после 429 от Bot API, когда сервер не назвал свою. */
const DEFAULT_RETRY_AFTER_SEC = 60;
/** Потолок такой паузы. */
const MAX_RETRY_AFTER_SEC = 3600;

/**
 * Отказ Bot API, разобранный по видам.
 *
 * Читается УТИНОЙ ТИПИЗАЦИЕЙ, а не instanceof TelegramSendError. Причина
 * не в лени: instanceof сравнивает прототипы, и он молча возвращает false,
 * если модуль бота окажется в сборке дважды (два пути импорта, две копии
 * в node_modules, hot-reload в разработке). Обработчик очереди — не то
 * место, где такую поломку заметят: заблокированный чат просто начал бы
 * получать восемь попыток вместо одной, и никто бы не понял почему.
 *
 * Поле kind проставляет TelegramSendError модуля бота. Отсутствие поля —
 * это ошибка не от Bot API (сеть, рендеринг шаблона, разбор chat_id),
 * и обрабатывается она общей лестницей повторов.
 */
function telegramErrorKind(error: unknown): string | null {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' ? kind : null;
}

/** Сколько секунд просит подождать Telegram при 429. */
function telegramRetryAfterSec(error: unknown): number {
  const value = (error as { retryAfterSec?: unknown } | null)?.retryAfterSec;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    // Bot API обязан присылать retry_after вместе с 429, но полагаться
    // на чужую обязательность нельзя: без значения по умолчанию строка
    // осталась бы с scheduledAt в прошлом и вернулась бы в тот же тик.
    return DEFAULT_RETRY_AFTER_SEC;
  }
  // Потолок против «подождите сутки»: такой ответ означает, что бота
  // ограничили всерьёз, и держать строку PENDING сутки бессмысленно —
  // пусть лучше израсходует попытки и честно станет FAILED.
  return Math.min(Math.ceil(value), MAX_RETRY_AFTER_SEC);
}

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly notifications: NotificationService,
    private readonly telegram: TelegramChannelService,
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    // Токен владельца: без него снятие замка в finally отпирало бы дверь
    // тому проходу, который его уже перехватил по TTL.
    const token = randomUUID();

    // SET NX атомарен: захватить блокировку сможет ровно одна реплика.
    //
    // catch на самом взятии: без него недоступный Redis выбрасывает наружу
    // из @Interval, а необработанное отклонение в планировщике Nest не ловит
    // никто — процесс получает unhandledRejection. Пропустить тик дешевле,
    // чем уронить API (тот же приём, что у процессоров бота).
    const acquired = await this.redis.client
      .set(LOCK_KEY, token, 'EX', LOCK_TTL_SEC, 'NX')
      .catch((error: unknown) => {
        this.logger.warn(
          `замок очереди уведомлений недоступен: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      });
    if (acquired === null) return;

    try {
      await this.processBatch(token);
    } catch (error) {
      this.logger.error(
        `сбой обработки очереди: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.releaseLock(token);
    }
  }

  /** Продлить свой замок. false — замок уже не наш, проход обязан остановиться. */
  private async renewLock(token: string): Promise<boolean> {
    try {
      const result = await this.redis.client.eval(
        RENEW_LOCK_LUA,
        1,
        LOCK_KEY,
        token,
        String(LOCK_TTL_SEC),
      );
      return result === 1;
    } catch (error) {
      // Redis недоступен — продолжать проход нельзя: без замка соседняя
      // реплика возьмёт те же строки и отправит их второй раз.
      this.logger.warn(
        `замок очереди уведомлений не продлён: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async releaseLock(token: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE_LOCK_LUA, 1, LOCK_KEY, token);
    } catch {
      // Не сняли — замок истечёт сам через LOCK_TTL_SEC.
    }
  }

  private async processBatch(lockToken: string): Promise<void> {
    const now = Date.now();

    // Условие «пора пробовать» строится по лестнице пауз: для каждого числа
    // уже сделанных попыток своя граница по времени последней неудачи.
    // Строк с attempts >= MAX_ATTEMPTS в списке нет вовсе — это и есть
    // прежнее `attempts: { lt: MAX_ATTEMPTS }`.
    //
    // failedAt = время ПОСЛЕДНЕЙ неудачной попытки (см. catch ниже), а не
    // «когда окончательно провалено». Отдельного поля под это в схеме нет, а
    // заводить миграцию ради времени, которое и так пишется при каждой
    // неудаче, незачем: для строк в статусе FAILED смысл прежний — это время
    // последней, она же окончательная, неудача.
    //
    // failedAt: null покрывает старые строки, оставшиеся от прежней версии
    // обработчика (она поле не заполняла), — их надо взять сразу. Строки,
    // которые обрабатываются ПРЯМО СЕЙЧАС, под это условие больше не
    // подходят: время начала попытки проставляется вместе со счётчиком.
    const ready = RETRY_BACKOFF_MS.flatMap((delayMs, attemptsDone) =>
      delayMs === 0
        ? [{ attempts: attemptsDone }]
        : [
            { attempts: attemptsDone, failedAt: null },
            { attempts: attemptsDone, failedAt: { lte: new Date(now - delayMs) } },
          ],
    );

    // scheduled_at — отложенная отправка: тихие часы Telegram (23:00–08:00 МСК)
    // и перенос после 429 от Bot API. Условие вынесено в AND рядом с лестницей
    // повторов, а не подмешано к ней: два независимых OR в одном объекте where
    // Prisma склеила бы в один, и отложенная строка уезжала бы в отправку по
    // любому подходящему условию лестницы — то есть тихие часы не работали бы
    // ровно для новых уведомлений, ради которых их и заводили.
    const pending = await this.prisma.notification.findMany({
      where: {
        status: NotificationStatus.PENDING,
        AND: [
          { OR: ready },
          { OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date(now) } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    if (pending.length === 0) return;

    for (const item of pending) {
      // Замок продлевается перед КАЖДЫМ уведомлением, а не раз на пакет:
      // одна отправка в мёртвый Telegram стоит до 53 секунд, то есть
      // тридцатисекундного замка не хватает даже на одну строку.
      if (!(await this.renewLock(lockToken))) {
        this.logger.warn('замок очереди уведомлений потерян — проход остановлен');
        return;
      }

      // Счётчик увеличивается ДО отправки. Иначе письмо, упавшее по
      // таймауту уже после того, как SMTP его принял, будет отправлено
      // повторно при следующем проходе — и так до бесконечности.
      //
      // Вместе со счётчиком проставляется failedAt = «время начала попытки».
      // Без него строка, которая прямо сейчас висит в deliver(), подходит под
      // условие выборки `{ attempts: N, failedAt: null }` и уезжает в отправку
      // второй раз — параллельным проходом или этим же после потери замка.
      // Смысл поля от этого не меняется: catch ниже перезапишет его временем
      // фактической неудачи, а при успехе строка уходит в SENT.
      await this.prisma.notification.update({
        where: { id: item.id },
        data: { attempts: { increment: 1 }, failedAt: new Date() },
      });

      try {
        const rendered = await this.notifications.render(
          item.templateKey,
          item.channel,
          item.locale,
          (item.payload ?? {}) as Record<string, unknown>,
        );

        await this.deliver(item.channel, item.recipient, rendered);

        await this.prisma.notification.update({
          where: { id: item.id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            renderedSubject: rendered.subject,
            // Отрендеренный текст сохраняем намеренно: через полгода
            // в поддержке надо видеть, ЧТО именно человеку отправили,
            // а не что отправилось бы, применив сегодняшний шаблон
            // к тем данным. Шаблоны меняются, история — нет.
            renderedBody: rendered.body,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind = telegramErrorKind(error);

        // 429 от Bot API — это не отказ, а просьба подождать. Попытка при
        // этом НЕ засчитывается: иначе бот, попавший под ограничение на
        // десять минут, сжёг бы весь бюджет повторов за эти десять минут
        // и потерял уведомление, ни разу не попробовав отправить его
        // по-настоящему. Счётчик был увеличен перед отправкой — возвращаем.
        if (kind === 'rate_limited') {
          const retryAfterSec = telegramRetryAfterSec(error);
          await this.prisma.notification.update({
            where: { id: item.id },
            data: {
              attempts: { decrement: 1 },
              // failedAt возвращается в null вместе со счётчиком: 429 — это
              // не неудачная попытка, а просьба подождать, и лестница пауз
              // не должна прибавлять свои минуты к названному Telegram сроку.
              // Гонки это не открывает — строку держит scheduledAt в будущем.
              failedAt: null,
              scheduledAt: new Date(Date.now() + retryAfterSec * 1000),
              errorMessage: message.slice(0, 500),
            },
          });

          this.logger.warn(
            `уведомление ${item.id} (${item.templateKey}) отложено на ${retryAfterSec} с: лимит Telegram`,
          );
          continue;
        }

        // Окончательные отказы Telegram — ровно в том же смысле, что 5xx
        // у SMTP: восемь попыток за восемь часов не изменят ни одного из них,
        // а лишь восемь раз повторят одну строку в журнале.
        //
        //   chat_blocked   — человек заблокировал бота; отметка chat_blocked
        //                    уже проставлена транспортом, следующие уведомления
        //                    этого получателя даже не получат.
        //   chat_not_found — чата нет; транспорт уже отозвал привязку и поставил
        //                    в очередь письмо об отвязке. Повторять некуда.
        //   bad_request    — сломанная разметка или превышенная длина. Само не
        //                    починится: чинить надо шаблон, и FAILED с текстом
        //                    ошибки — единственный способ это заметить.
        const permanentTelegram =
          kind === 'chat_blocked' || kind === 'chat_not_found' || kind === 'bad_request';
        const permanent = isPermanentSmtpError(error) || permanentTelegram;
        const exhausted = permanent || item.attempts + 1 >= MAX_ATTEMPTS;

        await this.prisma.notification.update({
          where: { id: item.id },
          data: {
            status: exhausted ? NotificationStatus.FAILED : NotificationStatus.PENDING,
            // Пишется при КАЖДОЙ неудаче: по этому времени выборка выше
            // считает, когда можно пробовать снова. Раньше поле обнулялось
            // до последней попытки, и «когда пробовали» не знал никто.
            failedAt: new Date(),
            errorMessage: message.slice(0, 500),
          },
        });

        this.logger[exhausted ? 'error' : 'warn'](
          `уведомление ${item.id} (${item.templateKey}), попытка ${item.attempts + 1}` +
            `${permanent ? ' (отказ окончательный, повторять нечего)' : ''}: ${message}`,
        );
      }
    }
  }

  private async deliver(
    channel: NotificationChannel,
    recipient: string | null,
    rendered: { subject: string | null; body: string },
  ): Promise<void> {
    if (!recipient) throw new Error('получатель не задан');

    switch (channel) {
      case NotificationChannel.EMAIL:
        await this.mail.send({
          to: recipient,
          subject: rendered.subject ?? 'License Platform',
          text: rendered.body,
        });
        return;

      case NotificationChannel.TELEGRAM:
        // recipient — chat_id из telegram_links, проставленный при постановке.
        await this.telegram.send(recipient, rendered);
        return;
    }
  }
}
