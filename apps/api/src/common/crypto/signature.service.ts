import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { RedisService } from '../redis/redis.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Подпись запросов загрузчика и защита от повторного воспроизведения
 * (ТЗ п.14: «подпись запросов», «Replay Protection»).
 *
 * Зачем это поверх TLS. TLS защищает канал, но не отвечает на вопрос
 * «этот запрос действительно сформировал наш загрузчик». Перехватив
 * валидный ответ на своей машине — а на своей машине пользователь может
 * подставить свой корневой сертификат и прочитать весь трафик, — его
 * можно воспроизвести позже или с другой машины. Подпись привязывает
 * запрос к секрету ключа, а nonce и метка времени — к моменту.
 *
 * ФОРМАТ ПОДПИСИ. Строка для подписи собирается из пяти полей через \n:
 *
 *     METHOD \n PATH \n TIMESTAMP \n NONCE \n SHA256(BODY)
 *
 *     signature = HMAC-SHA256(signing_secret, строка) в нижнем регистре hex
 *
 * Заголовки запроса:
 *     X-Api-Key    префикс ключа
 *     X-Timestamp  unix-время в СЕКУНДАХ
 *     X-Nonce      случайные 16 байт в hex
 *     X-Signature  результат HMAC
 *
 * Разделитель \n и hex в нижнем регистре выбраны намеренно: на стороне
 * C++ это несколько строк кода и нет места для расхождения в кодировании.
 */

/** Пустое тело подписывается хешем пустой строки — не спецзначением. */
const EMPTY_BODY_SHA256 = createHash('sha256').update('').digest('hex');

/** Префикс ключей Redis, в которых отмечаются использованные nonce. */
const NONCE_PREFIX = 'sig:nonce:';

export interface SignedRequest {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  signature: string;
  /** Сырое тело запроса. Пустая строка для GET. */
  rawBody: string;
}

export type SignatureFailure =
  | 'MISSING_HEADERS'
  | 'BAD_TIMESTAMP'
  | 'EXPIRED'
  | 'REPLAY'
  | 'BAD_SIGNATURE';

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureFailure };

@Injectable()
export class SignatureService {
  private readonly logger = new Logger(SignatureService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  /** Собирает каноническую строку для подписи. */
  buildPayload(req: Omit<SignedRequest, 'signature'>): string {
    const bodyHash = req.rawBody
      ? createHash('sha256').update(req.rawBody, 'utf8').digest('hex')
      : EMPTY_BODY_SHA256;

    return [req.method.toUpperCase(), req.path, req.timestamp, req.nonce, bodyHash].join('\n');
  }

  /** Подпись строки секретом. Используется и при проверке, и в тестах клиента. */
  sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  }

  /**
   * Полная проверка: подпись, окно времени, неповторяемость nonce.
   *
   * Порядок проверок выбран по стоимости: сначала дешёвые отбраковки,
   * и только потом обращение к Redis. Мусорный трафик не должен
   * создавать нагрузку на хранилище.
   */
  async verify(req: SignedRequest, secret: string): Promise<SignatureResult> {
    if (!req.timestamp || !req.nonce || !req.signature) {
      return { ok: false, reason: 'MISSING_HEADERS' };
    }

    const timestamp = Number(req.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return { ok: false, reason: 'BAD_TIMESTAMP' };
    }

    const windowSec = await this.settings.getNumber('security.request_signature.window_sec', 300);
    const nowSec = Math.floor(Date.now() / 1000);
    const drift = Math.abs(nowSec - timestamp);

    // Окно двустороннее: часы на машине пользователя могут и отставать,
    // и спешить. Односторонняя проверка отсекала бы половину легитимных
    // клиентов с неточным временем.
    if (drift > windowSec) {
      return { ok: false, reason: 'EXPIRED' };
    }

    // Подпись проверяется ДО обращения к Redis: иначе кто угодно сможет
    // забивать хранилище записями nonce, не зная секрета.
    const expected = this.sign(this.buildPayload(req), secret);
    if (!this.constantTimeEquals(expected, req.signature)) {
      return { ok: false, reason: 'BAD_SIGNATURE' };
    }

    // Nonce отмечается атомарно. SET NX возвращает null, если ключ уже
    // существует — значит, этот запрос уже приходил.
    //
    // TTL равен окну: за его пределами запрос всё равно отбракуется
    // по метке времени, и хранить nonce дольше незачем. Это ограничивает
    // объём в Redis произведением частоты запросов на длину окна.
    const key = `${NONCE_PREFIX}${req.nonce}`;
    const stored = await this.redis.client.set(key, '1', 'EX', windowSec, 'NX');
    if (stored === null) {
      this.logger.warn(`повторное использование nonce: ${req.nonce}`);
      return { ok: false, reason: 'REPLAY' };
    }

    return { ok: true };
  }

  /**
   * Сравнение подписей за постоянное время.
   *
   * Обычное === выходит на первом различающемся символе. По времени ответа
   * подпись подбирается побайтово — это практическая атака, не теоретическая.
   */
  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }
}
