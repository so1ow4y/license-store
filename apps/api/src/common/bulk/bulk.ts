import { HttpException } from '@nestjs/common';

/**
 * Итог массовой операции: что прошло, что нет и почему. Отказ по одному
 * элементу не отменяет остальных — как в SIEM, оператору важнее видеть
 * разбивку, чем получить всё-или-ничего.
 */
export interface BulkItemResult {
  id: string;
  ok: boolean;
  code?: string;
}

export interface BulkResult {
  total: number;
  succeeded: number;
  failed: BulkItemResult[];
}

/** Потолок элементов за один запрос: защита от случайного «выделить всё». */
export const BULK_MAX = 500;

export function summarize(results: BulkItemResult[]): BulkResult {
  return {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  };
}

/** Машинный код ошибки для разбивки итога. */
export function errorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'code' in response) {
      return String((response as { code: unknown }).code);
    }
    return `HTTP_${error.getStatus()}`;
  }
  return 'INTERNAL_ERROR';
}
