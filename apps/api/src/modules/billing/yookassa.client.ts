import { Injectable, Logger } from '@nestjs/common';

/**
 * Клиент API ЮKassa v3 (https://yookassa.ru/developers/api).
 *
 * Знает только контракт ЮKassa и ничего о заказах. Уведомлениям (вебхукам)
 * ЮKassa подписи не ставит, поэтому статус платежа всегда перечитывается
 * отсюда с нашими ключами — тело вебхука служит лишь поводом проверить.
 */

const API_BASE = 'https://api.yookassa.ru/v3';
const TIMEOUT_MS = 15_000;

export interface YookassaCredentials {
  shopId: string;
  secretKey: string;
}

export type YookassaStatus = 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';

export interface YookassaPayment {
  id: string;
  status: YookassaStatus;
  paid: boolean;
  amount: { value: string; currency: string };
  metadata?: Record<string, string>;
  confirmation?: { type: string; confirmation_url?: string };
  payment_method?: { type?: string };
  cancellation_details?: { party?: string; reason?: string };
}

export interface CreatePaymentParams {
  idempotenceKey: string;
  amount: string;
  currency: string;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
  /** Чек 54-ФЗ — только если в магазине включена фискализация. */
  receipt?: { email: string; vatCode: number };
}

/** Сбой связи или 5xx — можно повторить позже. */
export class YookassaUnavailableError extends Error {}
/** Отказ ЮKassa по существу (неверные ключи, неверный запрос) — повтор не поможет. */
export class YookassaRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

@Injectable()
export class YookassaClient {
  private readonly logger = new Logger(YookassaClient.name);

  async createPayment(creds: YookassaCredentials, params: CreatePaymentParams): Promise<YookassaPayment> {
    const body = {
      amount: { value: params.amount, currency: params.currency },
      capture: true,
      confirmation: { type: 'redirect', return_url: params.returnUrl },
      description: params.description.slice(0, 128),
      metadata: params.metadata,
      ...(params.receipt
        ? {
            receipt: {
              customer: { email: params.receipt.email },
              items: [
                {
                  description: params.description.slice(0, 128),
                  quantity: '1.00',
                  amount: { value: params.amount, currency: params.currency },
                  vat_code: params.receipt.vatCode,
                  payment_mode: 'full_payment',
                  payment_subject: 'service',
                },
              ],
            },
          }
        : {}),
    };

    return this.request<YookassaPayment>(creds, 'POST', '/payments', body, params.idempotenceKey);
  }

  async getPayment(creds: YookassaCredentials, paymentId: string): Promise<YookassaPayment> {
    return this.request<YookassaPayment>(creds, 'GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  private async request<T>(
    creds: YookassaCredentials,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotenceKey?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const auth = Buffer.from(`${creds.shopId}:${creds.secretKey}`).toString('base64');

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          ...(idempotenceKey ? { 'Idempotence-Key': idempotenceKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new YookassaUnavailableError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T;

    // Тело ошибки ЮKassa: { type: 'error', code, description, parameter }.
    let description = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { code?: string; description?: string };
      description = [parsed.code, parsed.description].filter(Boolean).join(': ') || description;
    } catch {
      // не JSON — оставляем как есть
    }

    if (res.status >= 500 || res.status === 429) {
      throw new YookassaUnavailableError(`HTTP ${res.status} ${description}`);
    }
    this.logger.warn(`ЮKassa отклонила ${method} ${path}: HTTP ${res.status} ${description}`);
    throw new YookassaRejectedError(description, res.status);
  }
}
