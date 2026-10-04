import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { SettingsService } from '../settings/settings.service';
import { PERMISSIONS_KEY } from './permissions.decorator';

/**
 * Приоритет роли, начиная с которого человек считается привилегированным:
 * 60 — поддержка (читает чужие аккаунты, продлевает лицензии). Обычный
 * пользователь (10) под требование 2FA не попадает — у него нет доступа к
 * чужим данным.
 */
const PRIVILEGED_ROLE_PRIORITY = 60;

/**
 * Проверка прав.
 *
 * Работает ПОСЛЕ JwtAuthGuard, который кладёт в запрос пользователя
 * с загруженным набором прав. Порядок гарантируется тем, что оба
 * зарегистрированы глобально: Nest вызывает их в порядке объявления
 * в providers.
 *
 * Правило умолчания: если у обработчика нет декоратора @RequirePermissions,
 * доступ разрешён любому аутентифицированному — это эндпоинты кабинета,
 * где проверка идёт по владельцу внутри сервиса.
 *
 * ЗДЕСЬ ЖЕ ТРЕБОВАНИЕ ВТОРОГО ФАКТОРА ДЛЯ ПРИВИЛЕГИРОВАННЫХ РОЛЕЙ
 * (настройка security.2fa.required_for_admin). Место выбрано не случайно:
 *
 *   • Проверять на ВХОДЕ нельзя — админ без 2FA не смог бы войти, чтобы
 *     её включить, и первый же новый сотрудник оказался бы заперт снаружи.
 *   • Проверять на КАЖДОМ запросе нельзя по той же причине: /2fa/setup и
 *     /2fa/enable перестали бы открываться.
 *   • Здесь гейт закрывает ровно привилегированные действия и оставляет
 *     открытым путь к настройке: у маршрутов 2FA нет @RequirePermissions,
 *     значит до этой проверки они не доходят.
 *
 * Итог: админ входит, видит отказ на любом административном действии с
 * внятным кодом, включает 2FA и работает дальше. Заперть себя нельзя.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Метод перекрывает класс: на контроллере можно повесить общее
    // требование, а на отдельном методе ужесточить или ослабить.
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request.user;

    if (!user) {
      // Сюда попасть можно только если эндпоинт помечен @Public и при этом
      // требует прав — это ошибка разработчика, а не пользователя.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Недостаточно прав',
      });
    }

    if (required.some((permission) => user.permissions.has(permission))) {
      await this.assertTwoFactorIfPrivileged(user.rolePriority, user.twoFactorEnabled);
      return true;
    }

    // Какие именно права требуются, наружу не сообщаем: это карта
    // административного API для того, кто её собирает.
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Недостаточно прав для этого действия',
    });
  }

  /**
   * Привилегированная роль без второго фактора не выполняет админских
   * действий. Настройка security.2fa.required_for_admin по умолчанию true.
   *
   * Отдельный код ошибки, а не общий FORBIDDEN: человеку надо сказать, что
   * делать. «Недостаточно прав» у того, у кого права есть, — это тикет в
   * поддержку и потерянный час.
   */
  private async assertTwoFactorIfPrivileged(
    rolePriority: number,
    twoFactorEnabled: boolean,
  ): Promise<void> {
    if (twoFactorEnabled) return;
    if (rolePriority < PRIVILEGED_ROLE_PRIORITY) return;

    const required = await this.settings.get<boolean>('security.2fa.required_for_admin', true);
    if (!required) return;

    throw new ForbiddenException({
      code: 'TWO_FACTOR_SETUP_REQUIRED',
      message:
        'Для административных действий требуется двухфакторная аутентификация. ' +
        'Включите её в разделе безопасности: /auth/2fa/setup, затем /auth/2fa/enable.',
    });
  }
}
