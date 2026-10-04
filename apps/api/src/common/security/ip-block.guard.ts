import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { IpBlockService } from './ip-block.service';

/**
 * Первый глобальный guard: запросы с заблокированных адресов отклоняются
 * до проверки токена. Пробы здоровья не трогаются — их шлёт сама инфраструктура.
 */
@Injectable()
export class IpBlockGuard implements CanActivate {
  constructor(private readonly blocks: IpBlockService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.url.startsWith('/health')) return true;

    if (await this.blocks.isBlocked(request.ip)) {
      throw new ForbiddenException({ code: 'IP_BLOCKED', message: 'Доступ с вашего адреса заблокирован' });
    }
    return true;
  }
}
