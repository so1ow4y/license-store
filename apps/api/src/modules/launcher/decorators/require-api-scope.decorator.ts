import { SetMetadata } from '@nestjs/common';

export const API_SCOPE_KEY = 'requiredApiScope';

/**
 * Какие scope ключа сборки допускают этот маршрут. Достаточно ЛЮБОГО
 * из перечисленных — та же дизъюнкция, что у @RequirePermissions.
 *
 *     @RequireApiScope('launcher:payload')
 *
 * Проверяет ApiScopeGuard, и только он: решение о допуске обязано
 * приниматься ДО входа в бизнес-логику, иначе оно однажды окажется
 * в середине сервиса рядом с проверкой лицензии.
 *
 * Смысл scope именно здесь: секрет подписи извлекаем из бинарника сборки
 * (это данность, записанная в signature.guard.ts), поэтому утечка ключа —
 * вопрос времени, а не гипотеза. Без scope утёкший ключ продукта А
 * подписывает запросы к payload'у продукта Б; со scope радиус поражения
 * ограничен и ключ можно урезать, а не отзывать целиком.
 */
export const RequireApiScope = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(API_SCOPE_KEY, scopes);
