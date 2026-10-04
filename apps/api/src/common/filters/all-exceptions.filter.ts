import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Единая форма ошибки для всего API.
 *
 * requestId возвращается клиенту намеренно: он же пишется в audit_logs
 * и в логи приложения. Пользователь присылает его в поддержку — и инцидент
 * находится одним запросом, без выяснения «а во сколько это было примерно».
 */
export interface ApiErrorBody {
  statusCode: number;
  /** Машиночитаемый код: клиент ветвится по нему, а не по тексту. */
  code: string;
  /** Человекочитаемое сообщение. Локализуется на клиенте по code. */
  message: string;
  requestId: string;
  timestamp: string;
  /** Детали валидации. Для 5xx всегда отсутствует. */
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = String(request.id ?? '-');

    const { status, code, message, details, logLevel } = this.classify(exception);

    // 5xx — это наша вина, пишем со стеком. 4xx — ошибка клиента,
    // достаточно строки: иначе перебор логина забьёт логи стектрейсами.
    if (logLevel === 'error') {
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${code} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${status} ${code} [${requestId}]`);
    }

    const body: ApiErrorBody = {
      statusCode: status,
      code,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      ...(details !== undefined ? { details } : {}),
    };

    void reply.status(status).send(body);
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    logLevel: 'warn' | 'error';
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      // ValidationPipe отдаёт { message: string[], error, statusCode }.
      // Разворачиваем в details, чтобы форма ответа оставалась одинаковой.
      if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>;
        const raw = r['message'];
        const isValidation = Array.isArray(raw);

        // Поля сверх code и message пробрасываются в details.
        //
        // Без этого клиент вынужден выковыривать данные из текста
        // сообщения: например, дату следующего разрешённого сброса HWID.
        // Разбор человекочитаемой строки ломается при первой же правке
        // формулировки или смене языка.
        const extra = Object.fromEntries(
          Object.entries(r).filter(([key]) => !['code', 'message', 'statusCode', 'error'].includes(key)),
        );

        const details = isValidation
          ? raw
          : Object.keys(extra).length > 0
            ? extra
            : undefined;

        return {
          status,
          code: typeof r['code'] === 'string' ? r['code'] : this.codeFromStatus(status),
          message: isValidation
            ? 'Ошибка валидации запроса'
            : typeof raw === 'string'
              ? raw
              : exception.message,
          ...(details !== undefined ? { details } : {}),
          logLevel: status >= 500 ? 'error' : 'warn',
        };
      }

      return {
        status,
        code: this.codeFromStatus(status),
        message: typeof response === 'string' ? response : exception.message,
        logLevel: status >= 500 ? 'error' : 'warn',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // Сообщение Prisma содержит фрагмент схемы — наружу не отдаём.
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_QUERY',
        message: 'Некорректный запрос',
        logLevel: 'error',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      // Никаких подробностей: текст исключения может содержать SQL,
      // имена таблиц, значения полей и куски конфигурации.
      message: 'Внутренняя ошибка сервера',
      logLevel: 'error',
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    code: string;
    message: string;
    logLevel: 'warn' | 'error';
  } {
    switch (e.code) {
      // Нарушение уникальности. Самый частый случай в этом проекте —
      // повторное погашение кода Digiseller и повторная регистрация email.
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: 'ALREADY_EXISTS',
          message: 'Запись с такими данными уже существует',
          logLevel: 'warn',
        };
      // Запись не найдена при update/delete.
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Запись не найдена',
          logLevel: 'warn',
        };
      // Нарушение внешнего ключа.
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'INVALID_REFERENCE',
          message: 'Ссылка на несуществующую запись',
          logLevel: 'warn',
        };
      // БД недоступна — это уже наша авария, а не ошибка клиента.
      case 'P1001':
      case 'P1002':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'DATABASE_UNAVAILABLE',
          message: 'Сервис временно недоступен',
          logLevel: 'error',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'DATABASE_ERROR',
          message: 'Внутренняя ошибка сервера',
          logLevel: 'error',
        };
    }
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  }
}
