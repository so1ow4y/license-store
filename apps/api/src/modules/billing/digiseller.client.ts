import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV, type Env } from '@common/config/env.schema';
import { RedisService } from '@common/redis/redis.service';
import { createHash } from 'node:crypto';

import { PaymentMethodsService } from './payment-methods.service';

/**
 * Клиент API Digiseller.
 *
 * Знает ровно три вещи: как войти, как проверить код покупки и как узнать
 * состояние счёта. Бизнес-логики здесь нет — она в DigisellerService.
 *
 * ТРИ ОСОБЕННОСТИ ПЛОЩАДКИ, из-за которых этот файл выглядит подробнее
 * обычного HTTP-клиента. Все три проверены живыми запросами, не по памяти:
 *
 * 1. Бизнес-ошибка приходит с HTTP 200 и полем retval. По статусу её не
 *    видно вообще: {"retval":-1,"desc":"Неверный идентификатор продавца
 *    или подпись!"} отдаётся с кодом 200.
 * 2. Схем ошибок три разных в одном API: apilogin — 200 + retval<0;
 *    unique-code — 400 + JSON; purchase/info с плохим токеном — 401 с
 *    ПУСТЫМ телом.
 * 3. Перед API стоит DDoS-Guard, и при блокировке приезжает HTML вместо
 *    JSON. Распознавать это надо по телу, потому что статус может быть 200.
 */

/** Что вернул метод площадки. Разделение сделано ради одного вопроса вызывающего: повторять или нет. */
export type DigisellerOutcome<T> =
  /** Ответ получен и разобран. */
  | { kind: 'ok'; data: T }
  /** Площадка ответила отказом по существу: код не найден, счёт не наш. */
  | { kind: 'rejected'; retval: number; message: string }
  /** Временная неприятность: сеть, 5xx, HTML вместо JSON, протухший токен. Повторять можно. */
  | { kind: 'unavailable'; reason: string };

export interface UniqueCodeInfo {
  /** Номер счёта. Ключ идемпотентности — проверяется на вид ДО использования. */
  inv: number;
  /** ID товара площадки. По нему находится тариф. */
  idGoods: number;
  amount: number | null;
  currency: string | null;
  buyerEmail: string | null;
  /** Полный ответ — единственный источник правды при разборе спора. */
  raw: unknown;
}

export interface PurchaseState {
  /**
   * 1 ожидает оплаты, 2 отказ, 3 оплачено, 4 просрочено, 35 возврат не завершён, 5 возврат.
   *
   * НЕ nullable: ответ без состояния счёта — это не «состояние неизвестно»,
   * а неразобранный ответ, и он больше сюда не доезжает (см. purchaseInfo).
   */
  invoiceState: number;
  /** Состояние ДОСТАВКИ, а не денег: 4 = покупатель опроверг доставку. Это спор, не возврат. */
  uniqueCodeState: number | null;
  /**
   * ID товара площадки (item_id). По нему находится тариф — ровно та же роль,
   * что у id_goods в ответе на проверку кода, только поле называется иначе.
   */
  itemId: number | null;
  /** Сумма в валюте площадки (currency_type), а НЕ в рублях: живой ответ отдаёт 0.04 WMT. */
  amount: number | null;
  currency: string | null;
  /**
   * Почта покупателя из buyer_info. Для активации по номеру заказа это
   * единственное, что отличает владельца покупки от соседа по нумерации.
   */
  buyerEmail: string | null;
  /** Момент оплаты как его отдаёт площадка: "05.08.2026 18:25:20". */
  datePay: string | null;
  raw: unknown;
}

const TOKEN_KEY = 'digiseller:token';
/**
 * Запас от срока, который отдаёт площадка.
 *
 * Кэшируем по valid_thru из ответа, а не по константе из конфига: срок
 * задаёт площадка и может его поменять, не спросив нас. Проверено живым
 * входом — приходит ровно 120 минут. Константа в конфиге осталась только
 * страховкой на случай, если поле не придёт.
 */
const TOKEN_MARGIN_SEC = 300;

@Injectable()
export class DigisellerClient {
  private readonly logger = new Logger(DigisellerClient.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly methods: PaymentMethodsService,
  ) {}

  /** Заданы ли учётные данные. Отдельный метод, чтобы отличать «не настроено» от «не работает». */
  async isConfigured(): Promise<boolean> {
    const { sellerId, apiKey } = await this.credentials();
    return Boolean(sellerId && apiKey);
  }

  // =========================================================================
  //  МЕТОДЫ ПЛОЩАДКИ
  // =========================================================================

  /**
   * Проверка кода покупки — центральный вызов всего модуля.
   *
   * Код ровно 16 символов. Право токена: view_invoice.
   *
   * ВАЖНО про отказы: у площадки НЕТ документированного способа сказать
   * «такого кода не существует» — в документации метода описан ровно один
   * retval = 0. Поэтому любой ненулевой retval считается ВРЕМЕННЫМ, а не
   * приговором. Ложный отказ стоит чарджбека и потерянного покупателя;
   * лишняя просьба повторить стоит одного неудобства.
   */
  async verifyUniqueCode(code: string): Promise<DigisellerOutcome<UniqueCodeInfo>> {
    const token = await this.token();
    if (token.kind !== 'ok') return token;

    const res = await this.request(
      `/api/purchases/unique-code/${encodeURIComponent(code)}?token=${encodeURIComponent(token.data)}`,
    );
    if (res.kind !== 'ok') return res;

    const body = res.data as Record<string, unknown>;
    const retval = Number(body.retval ?? -1);

    if (retval !== 0) {
      return {
        kind: 'rejected',
        retval,
        message: String(body.retdesc ?? body.desc ?? 'площадка отклонила код'),
      };
    }

    // inv проверяется НА ВИД до того, как станет ключом идемпотентности.
    // Отсутствующее поле, превращённое в строку, дало бы литерал "undefined"
    // как внешний идентификатор платежа: первый покупатель занял бы его, а
    // все следующие получили бы конфликт. Лучше честно сказать «не поняли
    // ответ», чем построить на нём выдачу.
    const inv = Number(body.inv);
    const idGoods = Number(body.id_goods);
    if (!Number.isInteger(inv) || inv <= 0 || !Number.isInteger(idGoods) || idGoods <= 0) {
      this.logger.error(`ответ площадки без пригодных inv/id_goods: inv=${body.inv} id_goods=${body.id_goods}`);
      return { kind: 'unavailable', reason: 'ответ площадки не содержит номера счёта или товара' };
    }

    const amount = Number(body.amount);

    return {
      kind: 'ok',
      data: {
        inv,
        idGoods,
        amount: Number.isFinite(amount) ? amount : null,
        currency: typeof body.type_curr === 'string' ? body.type_curr : null,
        buyerEmail: typeof body.email === 'string' ? body.email : null,
        raw: body,
      },
    };
  }

  /**
   * Состояние счёта. Две роли: поиск возвратов и активация по номеру заказа.
   *
   * Поштучно, а не пачкой через seller-sells/v2: право sales_statistics_view
   * владельцем не выдано (проверено через /api/token/perms, ключ отдаёт ровно
   * три права). При объёмах этого продукта разница между одним запросом и
   * десятком несущественна.
   *
   * Разбор полей сверен с живым ответом по оплаченной покупке, а не с
   * документацией: item_id, currency_type, buyer_info.email лежат внутри
   * content, а unique_code_state приходит null, когда коды на карточке
   * товара не включены — то есть отсутствие этого объекта нормально.
   */
  async purchaseInfo(inv: bigint | number): Promise<DigisellerOutcome<PurchaseState>> {
    const token = await this.token();
    if (token.kind !== 'ok') return token;

    const res = await this.request(
      `/api/purchase/info/${String(inv)}?token=${encodeURIComponent(token.data)}`,
    );
    if (res.kind !== 'ok') return res;

    const body = res.data as Record<string, unknown>;

    // Бизнес-ошибка приходит с HTTP 200 и ненулевым retval без content —
    // это отказ по существу, а не сетевой сбой.
    if (body.retval !== undefined && body.retval !== null && Number(body.retval) !== 0) {
      const retval = Number(body.retval);
      return {
        kind: 'rejected',
        retval: Number.isFinite(retval) ? retval : -1,
        message: String(body.retdesc ?? body.desc ?? 'площадка не подтвердила счёт'),
      };
    }

    const content = (body.content ?? body) as Record<string, unknown>;
    const ucs = content.unique_code_state as Record<string, unknown> | undefined;
    const buyer = content.buyer_info as Record<string, unknown> | undefined;

    // Нет invoice_state — сломанный ответ: временный сбой, а не состояние.
    const invoiceState = this.intOrNull(content.invoice_state);
    if (invoiceState === null) {
      this.logger.error(
        `ответ площадки по счёту ${String(inv)} без invoice_state: ${JSON.stringify(body).slice(0, 200)}`,
      );
      return { kind: 'unavailable', reason: 'ответ площадки не содержит состояния счёта' };
    }

    // item_id ≤ 0 — мусор (Number(null) === 0), ниже превращается в null.
    const itemId = this.intOrNull(content.item_id);
    const amount = Number(content.amount);

    return {
      kind: 'ok',
      data: {
        invoiceState,
        uniqueCodeState: this.intOrNull(ucs?.state),
        itemId: itemId !== null && itemId > 0 ? itemId : null,
        amount: Number.isFinite(amount) ? amount : null,
        currency: typeof content.currency_type === 'string' ? content.currency_type : null,
        buyerEmail: typeof buyer?.email === 'string' ? buyer.email : null,
        datePay: typeof content.date_pay === 'string' ? content.date_pay : null,
        raw: body,
      },
    };
  }

  // =========================================================================
  //  ТОКЕН
  // =========================================================================

  /**
   * Токен доступа. Кэш в Redis, общий для всех реплик.
   *
   * Отдельного распределённого лока нет намеренно: входов около двенадцати
   * в сутки, и одновременный вход двух реплик обходится лишним запросом,
   * а не поломкой. Единственный реальный риск — коллизия timestamp
   * (площадка отвергает повтор с retval -4), и он закрыт одним повтором
   * с новым значением. Лок ради такого сценария стоил бы больше, чем спасал.
   */
  private async token(): Promise<DigisellerOutcome<string>> {
    try {
      const cached = await this.redis.client.get(TOKEN_KEY);
      if (cached) return { kind: 'ok', data: cached };
    } catch {
      // Redis недоступен — не повод не работать: войдём заново.
      // Цена — один лишний apilogin на запрос, а не остановка продаж.
    }

    const { sellerId, apiKey } = await this.credentials();
    if (!sellerId || !apiKey) {
      return { kind: 'unavailable', reason: 'DIGISELLER_SELLER_ID или DIGISELLER_API_KEY не заданы' };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      // Настоящее время, а не счётчик: площадка описывает timestamp именно
      // как время запроса. Монотонный счётчик за месяц отстал бы на месяц,
      // и в день, когда свежесть начнут проверять, встали бы все три канала.
      const timestamp = Math.floor(Date.now() / 1000) + attempt;
      const sign = createHash('sha256').update(apiKey + timestamp, 'utf8').digest('hex');

      const res = await this.request('/api/apilogin', {
        method: 'POST',
        body: JSON.stringify({ seller_id: Number(sellerId), timestamp, sign }),
      });
      if (res.kind !== 'ok') return res;

      const body = res.data as Record<string, unknown>;
      const retval = Number(body.retval ?? -1);

      // -4 — «не уникальный timestamp». Единственный отказ, который лечится
      // повтором: берём следующую секунду.
      if (retval === -4 && attempt === 0) continue;

      if (retval !== 0 || typeof body.token !== 'string') {
        const desc = String(body.desc ?? body.endesc ?? '');
        this.logger.error(`вход в Digiseller отклонён: retval=${retval} ${desc}`);
        // Неверный ключ — это НАША ошибка настройки, а не отказ покупателю.
        // Для вызывающего это всё равно «сейчас нельзя», а разбираться
        // будет человек по логу.
        return { kind: 'unavailable', reason: `вход отклонён площадкой (retval=${retval})` };
      }

      await this.cacheToken(body.token, body.valid_thru);
      return { kind: 'ok', data: body.token };
    }

    return { kind: 'unavailable', reason: 'не удалось получить токен' };
  }

  private async cacheToken(token: string, validThru: unknown): Promise<void> {
    let ttl = this.env.DIGISELLER_TOKEN_CACHE_TTL;

    if (typeof validThru === 'string') {
      const left = Math.floor((new Date(validThru).getTime() - Date.now()) / 1000) - TOKEN_MARGIN_SEC;
      // Срок с площадки главнее константы. Проверка на разумность — чтобы
      // кривая дата не привела к вечному кэшу или к его отсутствию.
      if (Number.isFinite(left) && left > 60 && left < 86_400) ttl = left;
    }

    try {
      await this.redis.client.set(TOKEN_KEY, token, 'EX', ttl);
    } catch {
      // Кэш не обязателен: без него просто чаще логинимся.
    }
  }

  /** Учётные данные: ключи из панели (способы оплаты) главнее окружения. */
  private async credentials(): Promise<{ sellerId: string; apiKey: string }> {
    const { sellerId = '', apiKey = '' } = await this.methods.secrets('DIGISELLER');
    return { sellerId: sellerId.trim(), apiKey: apiKey.trim() };
  }

  // =========================================================================
  //  ТРАНСПОРТ
  // =========================================================================

  /**
   * Один запрос к площадке с разбором всех трёх её схем ошибок.
   *
   * Повторов здесь нет намеренно: решение «повторять или нет» принимает
   * вызывающий, и оно у него разное. Два уровня повторов — это ретрай-шторм
   * ровно в тот момент, когда площадка сбрасывает нагрузку.
   */
  private async request(
    path: string,
    init: { method?: string; body?: string } = {},
  ): Promise<DigisellerOutcome<unknown>> {
    const url = `${this.env.DIGISELLER_API_BASE}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        signal: controller.signal,
      });

      const text = await res.text();

      // Пустое тело с 401 — так площадка сообщает о негодном токене у
      // purchase/info. Сбрасываем кэш, чтобы следующий вызов вошёл заново.
      if (res.status === 401 || res.status === 403) {
        await this.redis.client.del(TOKEN_KEY).catch(() => undefined);
        return { kind: 'unavailable', reason: `площадка ответила ${res.status}` };
      }

      if (!text.trim()) {
        return { kind: 'unavailable', reason: `пустой ответ, HTTP ${res.status}` };
      }

      try {
        return { kind: 'ok', data: JSON.parse(text) };
      } catch {
        // HTML вместо JSON — почти наверняка страница защиты перед API.
        // Статус при этом может быть 200, поэтому распознаём по телу.
        this.logger.warn(`не JSON от площадки (HTTP ${res.status}): ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
        return { kind: 'unavailable', reason: 'площадка вернула не JSON' };
      }
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError'
        ? 'таймаут запроса к площадке'
        : `сеть: ${error instanceof Error ? error.message : String(error)}`;
      return { kind: 'unavailable', reason };
    } finally {
      clearTimeout(timer);
    }
  }

  private intOrNull(raw: unknown): number | null {
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }
}
