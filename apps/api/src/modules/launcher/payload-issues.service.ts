import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PayloadIssueResult } from '@prisma/client';
import { isIP } from 'node:net';
import { v7 as uuidv7 } from 'uuid';

import { CryptoService } from '@common/crypto/crypto.service';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * Журнал выдач payload'а — append-only, строка на КАЖДУЮ попытку.
 *
 * Зачем вообще: обещание §7.1 («повторно запросить нельзя без валидной подписи
 * и лицензии») верно для одиночного запроса и никак не мешает шарингу — одна
 * лицензия, двадцать человек по очереди, у каждого своя валидная сессия и своя
 * валидная подпись. Отличить это от нормальной работы можно ТОЛЬКО считая
 * выдачи в разрезе лицензии/HWID/IP за окно, а до этой таблицы после выдачи
 * в базе не оставалось вообще ничего.
 *
 * Отказы пишутся наравне с успехами: тот, кому двести раз отказали по
 * HWID_MISMATCH, — самая интересная строка в таблице.
 *
 * Прямой INSERT, а не Redis Stream с воркером: объём порядка трёх тысяч строк
 * в сутки (на два порядка ниже heartbeat-потока, который справедливо не пишут
 * в БД), а проверка лицензии и так требует Postgres — нового режима отказа
 * fail-closed не добавляет.
 *
 * Маршрут НЕ помечается @Audit категорически: AuditInterceptor пишет
 * request.body целиком, а REDACTED_FIELDS не содержит ни sessionKey, ни hwid —
 * журнал, который хранится годами и читается людьми, мгновенно стал бы утечкой
 * секрета сессии и Disk ID.
 */

/** Что известно о попытке к моменту записи. Всё, кроме result, необязательно. */
export interface PayloadIssueEntry {
  result: PayloadIssueResult;
  userId?: string | null;
  licenseId?: string | null;
  deviceId?: string | null;
  productId?: string | null;
  payloadBuildId?: string | null;
  payloadVersion?: string | null;
  /**
   * СЫРОЙ Disk ID. Хешируется внутри сервиса и наружу в этом виде не выходит —
   * см. комментарий к hwidHash ниже.
   */
  diskId?: string | null;
  clientVersion?: string | null;
  apiKeyId?: string | null;
  ip?: string | null;
  country?: string | null;
  sizeBytes?: number | bigint | null;
  requestId?: string | null;
}

@Injectable()
export class PayloadIssuesService {
  private readonly logger = new Logger(PayloadIssuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Запись об ОТКАЗЕ — best-effort.
   *
   * Сбой журнала не имеет права превращать чистый 403 в 500: пользователь
   * получил бы терминальную «неизвестную ошибку» вместо внятного «лицензия
   * заблокирована», а починить журнал он всё равно не может.
   */
  async record(entry: PayloadIssueEntry): Promise<void> {
    try {
      await this.insert(entry);
    } catch (error) {
      this.logger.error(
        `не удалось записать отказ ${entry.result} в payload_issues: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Запись о ВЫДАЧЕ — fail-closed.
   *
   * Выдача, которой нет в журнале, — это выданный самый ценный актив системы
   * без следа: ни антифрода, ни доказательства в споре о чарджбеке. Поэтому при
   * невозможности записать строку тело НЕ отдаётся, а клиент получает 503,
   * который по §2.3 повторяется. Нового режима отказа это не создаёт: тот же
   * Postgres уже нужен для проверки лицензии несколькими строками выше.
   */
  async recordIssued(entry: PayloadIssueEntry): Promise<void> {
    try {
      await this.insert({ ...entry, result: PayloadIssueResult.ISSUED });
    } catch (error) {
      this.logger.error(
        `выдача не записана в payload_issues, тело не отдано: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'ISSUE_NOT_RECORDED',
        message: 'Сервис временно недоступен, повторите запрос',
      });
    }
  }

  private async insert(entry: PayloadIssueEntry): Promise<void> {
    await this.prisma.payloadIssue.create({
      data: {
        // uuid v7 генерируется приложением, как у всех PK этой схемы,
        // и заодно сортирует журнал по времени без отдельного индекса.
        id: uuidv7(),
        userId: entry.userId ?? null,
        licenseId: entry.licenseId ?? null,
        deviceId: entry.deviceId ?? null,
        productId: entry.productId ?? null,
        payloadBuildId: entry.payloadBuildId ?? null,
        payloadVersion: entry.payloadVersion ?? null,
        hwidHash: this.hwidHash(entry.diskId),
        clientVersion: entry.clientVersion?.slice(0, 32) ?? null,
        apiKeyId: entry.apiKeyId ?? null,
        ip: this.ip(entry.ip),
        country: entry.country?.slice(0, 2) ?? null,
        result: entry.result,
        sizeBytes: entry.sizeBytes === null || entry.sizeBytes === undefined
          ? null
          : BigInt(entry.sizeBytes),
        requestId: entry.requestId?.slice(0, 64) ?? null,
      },
    });
  }

  /**
   * Хеширование Disk ID делает СЕРВИС, а не вызывающий.
   *
   * Если бы метод принимал готовый hwidHash, правило «в колонку никогда не
   * попадает сырой Disk ID» держалось бы на дисциплине каждого вызывающего.
   * Здесь оно свойство кода: сырое значение физически не имеет пути в SQL.
   *
   * Хеш — тот же HMAC-SHA256 с HWID_PEPPER, что в devices.hwid_hash, а не
   * голый sha256. Две причины: голый хеш короткого серийника перебирается по
   * словарю за копейки, и — главное — только при одинаковой функции журнал
   * СОЕДИНЯЕТСЯ с таблицей устройств. Хеш, не совпадающий ни с чем в базе,
   * не даёт провести ни одно расследование, ради которого таблица заводилась.
   */
  private hwidHash(diskId?: string | null): string | null {
    if (!diskId) return null;
    return this.crypto.hashHwid(diskId);
  }

  /**
   * Проверка IP перед записью в колонку типа inet.
   *
   * Без неё запись о ВЫДАЧЕ (fail-closed) падала бы на 22P02 от Postgres,
   * и легальный пользователь получал бы 503 из-за мусора в X-Forwarded-For.
   * Заголовок подконтролен клиенту ровно настолько, насколько nginx его не
   * перезаписывает (Д15), — то есть значение поля доказательно только за нашим
   * прокси, и полагаться на него в антифроде можно только с этой оговоркой.
   */
  private ip(value?: string | null): string | null {
    if (!value) return null;
    return isIP(value) === 0 ? null : value;
  }
}
