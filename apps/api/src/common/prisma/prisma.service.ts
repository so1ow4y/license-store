import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.schema';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    const isDev = config.get('NODE_ENV', { infer: true }) !== 'production';

    super({
      datasources: { db: { url: config.get('DATABASE_URL', { infer: true }) } },
      // В разработке логируем сами запросы — без этого невозможно заметить
      // N+1, который на локальных объёмах данных не проявляется по времени,
      // но на проде превращается в сотни запросов на один эндпоинт.
      log: isDev
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ],
      errorFormat: isDev ? 'pretty' : 'minimal',
    });

    if (isDev) {
      // Порог 200 мс совпадает с log_min_duration_statement в Postgres:
      // то, что видно в логах БД, видно и здесь — но уже с привязкой
      // к конкретному месту в коде.
      (this as unknown as { $on: (e: 'query', cb: (ev: Prisma.QueryEvent) => void) => void }).$on(
        'query',
        (event) => {
          if (event.duration >= 200) {
            this.logger.warn(`медленный запрос ${event.duration} мс: ${event.query}`);
          }
        },
      );
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('соединение с PostgreSQL установлено');
  }

  async onModuleDestroy(): Promise<void> {
    // Вызывается после того, как Nest дождался завершения обработчиков
    // в полёте. Порядок важен: отключиться раньше — значит оборвать
    // запросы, которые уже приняты и почти отвечены.
    await this.$disconnect();
    this.logger.log('соединение с PostgreSQL закрыто');
  }

  /**
   * Пинг для readiness-проверки. Намеренно самый дешёвый запрос из
   * возможных: задача — убедиться, что соединение живо, а не нагрузить БД
   * проверками здоровья, которых при 1000 онлайн будет много.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
