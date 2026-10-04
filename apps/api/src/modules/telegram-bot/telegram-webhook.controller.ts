import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

import { Public } from '@modules/auth/decorators/public.decorator';

import { TelegramBotConfig } from './telegram-bot.config';
import { TelegramUpdateQueue } from './telegram-update.queue';

/**
 * Приём апдейтов Telegram.
 *
 * ДВА СЕКРЕТА СРАЗУ — в пути и в заголовке. Не избыточность: путь
 * протекает в журналы обратного прокси, в метрики и в трассировки, где
 * его увидит любой, у кого есть доступ к наблюдаемости; заголовок туда
 * не попадает. Обратный случай — прокси, срезающий незнакомые заголовки:
 * тогда проверка держится на пути. Совпасть обязаны оба.
 *
 * РАСХОЖДЕНИЕ ДАЁТ 404, А НЕ 403. 403 подтверждает, что маршрут
 * существует, и превращает перебор в игру «горячо-холодно». 404 не
 * отличим от любого другого несуществующего адреса.
 *
 * @ApiExcludeController: адрес вебхука не место в публичной спецификации,
 * а Swagger-описание с примером пути — готовая подсказка перебирающему.
 */
@ApiExcludeController()
@Public()
@Controller('telegram/webhook')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    private readonly config: TelegramBotConfig,
    private readonly queue: TelegramUpdateQueue,
  ) {}

  /**
   * Обработчик обязан ответить 200 в пределах секунды и с пустым телом.
   *
   * Никакой работы здесь не делается намеренно: Telegram считает
   * неотвеченный вебхук неудачей и шлёт апдейт заново — то есть медленный
   * обработчик производит дубликаты, а дубликат сброса привязки стоит
   * человеку одной попытки из трёх. Всё, что тут происходит, — проверка
   * секретов и запись в очередь.
   *
   * Возврат void вместе с @HttpCode(200) даёт пустое тело ответа.
   */
  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('secret') secret: string,
    @Headers('x-telegram-bot-api-secret-token') header: string | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    // Выключенный бот не отличим от несуществующего маршрута. Иначе
    // рубильник сам становится источником сведений о системе.
    if (!this.config.enabled) throw new NotFoundException();

    const expectedPath = this.config.webhookSecret;
    const expectedHeader = this.config.webhookHeaderSecret;

    // Пустой секрет никогда не должен совпадать (недонастроенный стенд).
    if (expectedPath.length === 0 || expectedHeader.length === 0) throw new NotFoundException();

    // Секрет пути и секрет заголовка — разные значения: URL может попасть
    // в лог прокси.
    if (
      !constantTimeEquals(secret, expectedPath) ||
      !constantTimeEquals(header ?? '', expectedHeader)
    ) {
      // Ни присланное значение, ни ожидаемое в лог не идут. Уровень warn,
      // а не error: это чужой перебор, а не наш сбой.
      this.logger.warn('вебхук с неверным секретом отклонён');
      throw new NotFoundException();
    }

    // Сырое тело, а не разобранный объект: идентификаторы Telegram
    // приходят числами, и JSON.parse у Fastify уже мог бы потерять
    // точность на значениях выше 2^53. Сырую строку сохраняет парсер
    // из main.ts:62-87; отката на разобранное тело хватает для стендов,
    // где парсер заменён.
    const raw = (req as unknown as { rawBody?: string }).rawBody;
    const outcome = await this.queue.push(raw && raw.length > 0 ? raw : body);

    // Очередь недоступна — 503: Telegram повторит доставку с паузой (на 200
    // апдейт потерялся бы). Неразбираемое тело остаётся 200 — повтор не поможет.
    if (outcome === 'unavailable') {
      this.logger.warn('апдейт не принят в очередь — просим Telegram повторить');
      throw new ServiceUnavailableException();
    }
  }
}

/**
 * Сравнение за постоянное время. Приём взят из oauth/telegram.provider.ts:121-124
 * и повторён здесь дословно, а не вынесен: копия в две строки честнее
 * общего модуля, который придётся импортировать из транспорта в OAuth.
 *
 * Разная длина отвечает сразу — она и так видна по длине URL.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
