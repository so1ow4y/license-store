import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

/**
 * Область видимости действия: any — все объекты (админ, поддержка),
 * own — только свои.
 */
export type Scope = 'any' | 'own';

/**
 * Область видимости по паре прав <base>.any / <base>.own. Guard видит только
 * набор прав и пропускает обладателя любого из двух, а владельца объекта
 * знает лишь сервис — он и строит условие выборки через эту функцию.
 *
 * @example
 *   const scope = resolveScope(user, 'licenses.read');
 *   const where = scope === 'any' ? {} : { userId: user.id };
 */
export function resolveScope(user: AuthenticatedUser, base: string): Scope {
  if (user.permissions.has(`${base}.any`)) return 'any';
  if (user.permissions.has(`${base}.own`)) return 'own';

  // Guard уже должен был отсечь такой запрос. Если мы здесь — значит,
  // на эндпоинте забыт декоратор либо перечислены не те права.
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'Недостаточно прав для этого действия',
  });
}
