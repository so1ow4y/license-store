import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Помечает эндпоинт как доступный без авторизации.
 *
 * Guard подключается глобально, а исключения помечаются явно — не наоборот.
 * Обратный порядок означает, что забытый декоратор оставляет эндпоинт
 * открытым, и заметить это можно только по факту утечки.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
