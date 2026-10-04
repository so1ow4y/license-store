import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { PrismaService } from '@common/prisma/prisma.service';

import { API_SCOPE_KEY } from '../decorators/require-api-scope.decorator';

/**
 * Ограничение ключа сборки набором эндпоинтов.
 *
 * До этого guard'а поле api_keys.scopes ЗАПОЛНЯЛОСЬ И НЕ ЧИТАЛОСЬ НИ РАЗУ
 * (проверено грепом по src: единственная запись — signature.guard.ts:93).
 * Это худший вид защиты: на ревью выглядит как ограничение, а на деле любой
 * валидный ключ сборки подписывает любой эндпоинт.
 *
 * Работает строго ПОСЛЕ SignatureGuard: тот кладёт request.apiKey. Порядок
 * гарантирован уровнями — SignatureGuard висит на классе контроллера,
 * ApiScopeGuard на методе, а Nest вызывает guard'ы класса раньше guard'ов
 * метода. Если request.apiKey всё же пуст, это сломанный порядок, а не
 * ситуация клиента, — отказываем, потому что «пропустить, раз ключа нет»
 * здесь означало бы отключить проверку целиком.
 */
@Injectable()
export class ApiScopeGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(ApiScopeGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Предупреждение о ключах с пустым scopes — обязательная часть
   * переходного правила «пустой массив = все».
   *
   * Fail-open введён сознательно: иначе правка одномоментно превращает
   * в кирпич все сборки, уже уехавшие пользователям (у них scopes = [],
   * значение по умолчанию в ApiKeyService.create). Но fail-open без
   * напоминания на старте — это тот самый паттерн, который остаётся
   * навсегда, потому что о нём никто не вспомнит.
   *
   * Дополнительно к этому предупреждению нужен способ ПРОСТАВИТЬ scopes
   * существующему ключу: сегодня в ApiKeyService есть только create/list/
   * revoke, то есть выйти из fail-open можно лишь выпуском нового ключа
   * (новый префикс и новый секрет = новая сборка всем пользователям).
   * См. Д12 в docs/PAYLOAD-DESIGN.md.
   */
  async onModuleInit(): Promise<void> {
    try {
      const open = await this.prisma.apiKey.findMany({
        where: { revokedAt: null, scopes: { isEmpty: true } },
        select: { prefix: true, name: true },
      });

      if (open.length === 0) return;

      this.logger.warn(
        `ключей API без ограничения по scope: ${open.length} — ` +
          `${open.map((k) => `${k.prefix} (${k.name})`).join(', ')}. ` +
          'Пустой scopes трактуется как «все эндпоинты» (переходное правило). ' +
          'Пока такие ключи существуют, @RequireApiScope их не ограничивает.',
      );
    } catch (error) {
      // Недоступная на старте БД не должна мешать подъёму процесса: за это
      // отвечает /health/ready. Но и молча пропускать нельзя — иначе
      // отсутствие предупреждения будет прочитано как «пустых scopes нет».
      this.logger.warn(
        `не удалось проверить scopes ключей API на старте: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(API_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const apiKey = request.apiKey;

    if (!apiKey) {
      this.logger.error(
        'ApiScopeGuard выполнился раньше SignatureGuard: request.apiKey пуст. ' +
          'Проверьте порядок guard\'ов на контроллере.',
      );
      throw this.deny();
    }

    // Переходное правило. Событие уровня DEBUG, а не WARN: на горячем пути
    // это строка на каждый запрос, а само наличие таких ключей уже
    // сообщено один раз на старте.
    if (apiKey.scopes.length === 0) {
      this.logger.debug(`ключ ${apiKey.prefix} без scopes — пропущен по переходному правилу`);
      return true;
    }

    if (required.some((scope) => apiKey.scopes.includes(scope))) return true;

    throw this.deny();
  }

  /**
   * Какого именно scope не хватило, наружу не сообщаем: это карта
   * административного API для того, кто её собирает. Клиенту достаточно
   * знать, что сборка не имеет права на этот эндпоинт.
   */
  private deny(): ForbiddenException {
    return new ForbiddenException({
      code: 'API_KEY_SCOPE',
      message: 'Ключ сборки не имеет доступа к этому эндпоинту',
    });
  }
}
