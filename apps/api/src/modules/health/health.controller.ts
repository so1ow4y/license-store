import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { Public } from '@modules/auth/decorators/public.decorator';

interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

@ApiTags('health')
/**
 * VERSION_NEUTRAL вместе с exclude в setGlobalPrefix даёт чистый путь
 * /health/live. Одного exclude мало: он снимает префикс /api, но сегмент
 * версии добавляется отдельным механизмом, и проба уезжает на /v1/health/live.
 * Адрес пробы обязан быть стабильным — иначе выкатка /api/v2 молча ломает
 * мониторинг и балансировщик перестаёт видеть живые инстансы.
 */
/**
 * @Public обязателен: guard подключён глобально, и без него балансировщик
 * получал бы 401 на пробах и считал все инстансы мёртвыми.
 */
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Liveness. Отвечает, пока процесс жив и цикл событий не заблокирован.
   *
   * НАМЕРЕННО не проверяет БД и Redis. Оркестратор по этой пробе
   * перезапускает контейнер — а перезапуск при недоступной БД не лечит
   * ничего, зато превращает деградацию в отказ: реплики уходят в цикл
   * рестартов ровно тогда, когда БД и так под нагрузкой.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness: процесс жив' })
  live(): { status: 'ok'; uptimeSec: number } {
    return { status: 'ok', uptimeSec: Math.floor(process.uptime()) };
  }

  /**
   * Readiness. Отвечает, только если приложение реально способно
   * обслуживать запросы: есть соединение с Postgres и Redis.
   *
   * По этой пробе балансировщик убирает инстанс из ротации, не убивая его.
   * Инстанс восстановится сам, когда зависимости вернутся.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: зависимости доступны' })
  async ready(): Promise<{
    status: 'ok';
    dependencies: Record<string, DependencyStatus>;
  }> {
    // Проверки идут параллельно: последовательные удвоили бы худшее время
    // ответа пробы, а таймаут у неё обычно жёсткий.
    const [postgres, redis] = await Promise.all([
      this.check(() => this.prisma.ping()),
      this.check(() => this.redis.ping()),
    ]);

    const dependencies = { postgres, redis };
    const failed = Object.entries(dependencies).filter(([, v]) => v.status === 'down');

    if (failed.length > 0) {
      // 503 с телом: балансировщику достаточно кода, а человеку нужно
      // видеть, что именно упало, без похода в логи.
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: `недоступны зависимости: ${failed.map(([k]) => k).join(', ')}`,
        details: dependencies,
      });
    }

    return { status: 'ok', dependencies };
  }

  private async check(fn: () => Promise<void>): Promise<DependencyStatus> {
    const started = performance.now();
    try {
      await fn();
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
