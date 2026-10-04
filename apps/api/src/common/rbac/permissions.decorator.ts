import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Требуемые права. Достаточно ЛЮБОГО из перечисленных.
 *
 * Дизъюнкция, а не конъюнкция, потому что в этой системе права почти всегда
 * различаются областью видимости: licenses.read.any и licenses.read.own —
 * это одно и то же действие для разных ролей. Требовать оба бессмысленно,
 * а перечислять оба удобно:
 *
 *     @RequirePermissions('licenses.read.any', 'licenses.read.own')
 *
 * Сам guard пропустит и админа, и владельца. Кому что видно — решает
 * сервис через resolveScope(), потому что guard не знает про владельца.
 *
 * Если действительно нужны все права разом, вешаются два декоратора
 * на разных уровнях (класс и метод) — они складываются конъюнкцией.
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
