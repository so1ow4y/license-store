import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthenticatedUser } from '../guards/jwt-auth.guard';

/**
 * Текущий пользователь из запроса. Заполняется JwtAuthGuard.
 *
 * Если декоратор используется на эндпоинте, помеченном @Public,
 * значение будет undefined — это ожидаемо, тип отражает это честно.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined =>
    ctx.switchToHttp().getRequest<FastifyRequest>().user,
);
