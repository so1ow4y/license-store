/**
 * Проверка прав.
 *
 * Гейтить меню и кнопки следует ТОЛЬКО по правам: `/auth/me` не отдаёт роль,
 * поэтому «если админ» на фронте выразить нечем. Попытка вывести роль из
 * набора прав даст расхождение с сервером ровно в тот день, когда права
 * перераспределят.
 */

/**
 * Все известные приложению права.
 *
 * Значения сверены с `apps/api/prisma/seed.ts` (список PERMISSIONS) и с
 * декораторами `@RequirePermissions` в контроллерах:
 *   - `billing.controller.ts:56,71`    → licenses.create.any
 *   - `licenses.controller.ts:29`      → licenses.read.any | licenses.read.own
 *   - `licenses.controller.ts:100,114` → licenses.block
 *   - `hwid.controller.ts:58`          → hwid.reset.self
 *
 * Сюда же сведён отдельный словарь `features/admin/permissions.ts`, который
 * завёл K6: два списка прав неизбежно расходятся, а расхождение здесь значит
 * пункт меню, ведущий в 403.
 */
export const PERMISSIONS = {
  /** Право на чтение истории привязок устройства (маршрут закрыт им, а не владельцем). */
  HWID_HISTORY_READ: 'hwid.history.read',
  /** Самостоятельный сброс привязки устройства. */
  HWID_RESET_SELF: 'hwid.reset.self',
  /** Выдача лицензий вручную — по нему виден раздел зависших сделок. */
  LICENSES_CREATE_ANY: 'licenses.create.any',
  /** Просмотр ВСЕХ лицензий. `licenses.read.own` даёт только свои — это другой экран. */
  LICENSES_READ_ANY: 'licenses.read.any',
  /** Блокировка и разблокировка — одно право на оба действия. */
  LICENSES_BLOCK: 'licenses.block',
  /** Закрепление сборки из хранилища товара за лицензией. */
  LICENSES_BUILD_ASSIGN: 'licenses.build.assign',
  /** Товары, тарифы и сборки. */
  PRODUCTS_MANAGE: 'products.manage',
  PLANS_MANAGE: 'plans.manage',
  VERSIONS_MANAGE: 'versions.manage',
  /** Заказы: все (админ) и подтверждение оплаты вручную. */
  ORDERS_READ_ANY: 'orders.read.any',
  ORDERS_MANAGE: 'orders.manage',
  /** Глобальные каналы оплаты и ключи Digiseller. */
  PAYMENTS_MANAGE: 'payments.manage',
  /** Создание реквизитов: шаблонов и личных для товаров. */
  PAYMENT_PROFILES_MANAGE: 'payment_profiles.manage',
  /** Привязка готовых реквизитов к товарам. */
  PRODUCTS_PAYMENTS_ASSIGN: 'products.payments.assign',
  /** Реселлеры: просмотр, настройка, баланс; панель — у самого реселлера. */
  RESELLERS_READ: 'resellers.read',
  RESELLERS_MANAGE: 'resellers.manage',
  RESELLERS_BALANCE: 'resellers.balance',
  /** Подтверждение заявок реселлеров на пополнение (поддержка и супер-админ). */
  RESELLERS_TOPUPS_CONFIRM: 'resellers.topups.confirm',
  RESELLER_PANEL: 'reseller.panel',
  USERS_READ_ANY: 'users.read.any',
  USERS_UPDATE_ANY: 'users.update.any',
  USERS_BLOCK: 'users.block',
  ROLES_READ: 'roles.read',
  ROLES_ASSIGN: 'roles.assign',
  SETTINGS_READ: 'settings.read',
  SETTINGS_MANAGE: 'settings.manage',
  /** Журнал событий, журнал входов, адреса пользователей, блокировки IP. */
  AUDIT_READ: 'audit.read',
  LOGINS_READ: 'logins.read',
  SECURITY_IPS_READ: 'security.ips.read',
  SECURITY_IP_BLOCK: 'security.ip_block',
} as const

export type PermissionList = readonly string[]

/** Есть ли право в наборе. Пустой/неизвестный набор трактуем как «нет». */
export function has(permissions: PermissionList | undefined, permission: string): boolean {
  return Boolean(permissions?.includes(permission))
}

/** Есть ли хотя бы одно из прав — для пунктов меню, ведущих в общий раздел. */
export function hasAny(
  permissions: PermissionList | undefined,
  required: readonly string[]
): boolean {
  return required.some((permission) => has(permissions, permission))
}

/** Есть ли все права сразу. */
export function hasAll(
  permissions: PermissionList | undefined,
  required: readonly string[]
): boolean {
  return required.every((permission) => has(permissions, permission))
}
