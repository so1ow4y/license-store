import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Сборка графа зависимостей всего приложения.
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ СУЩЕСТВУЕТ. `tsc --noEmit` проверяет типы и НЕ проверяет
 * DI: сервис, забытый в providers, и сервис, не добавленный в exports своего
 * модуля, компилируются идеально и роняют процесс на старте с «Nest can't
 * resolve dependencies». Ровно это и произошло бы с RegistrationKeyService —
 * его инжектит экран активации бота, а AuthModule его не экспортировал.
 * Цена ошибки — упавший прод, найденный руками; цена проверки — эти
 * несколько секунд.
 *
 * compile() создаёт все провайдеры, но НЕ вызывает onModuleInit, а
 * подключение к Postgres и Redis живёт именно там (prisma.service.ts:47,
 * redis.service.ts:48). Поэтому тест не требует ни базы, ни Redis —
 * в отличие от остальных, он зелёный на голой машине.
 */

/**
 * Минимальное окружение. Значения синтетические и никуда не отправляются:
 * до сетевых вызовов дело не доходит, проверяется только сборка графа.
 * Задаётся ДО импорта AppModule — validateEnv выполняется на этапе
 * ConfigModule.forRoot, то есть в момент вычисления декоратора @Module.
 */
const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(48),
  // hex32 — ровно 64 шестнадцатеричных символа, и оба значения обязаны
  // различаться (env.schema.ts, superRefine).
  HWID_PEPPER: 'a1'.repeat(32),
  ENCRYPTION_KEY: 'b2'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET_RELEASES: 'releases',
  SMTP_HOST: 'localhost',
  SMTP_FROM: 'noreply@example.com',
};

function applyEnv(extra: Record<string, string>): void {
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...extra })) {
    process.env[key] = value;
  }
}

describe('граф зависимостей приложения', () => {
  let AppModule: unknown;

  beforeAll(async () => {
    // Рубильник выключен — состояние боевого сервера на момент выкладки:
    // токена бота там ещё нет.
    applyEnv({ TELEGRAM_BOT_ENABLED: 'false' });
    ({ AppModule } = await import('../src/app.module'));
  });

  it('собирается целиком при выключенном боте', async () => {
    // Именно здесь ловятся незарегистрированные и неэкспортированные
    // провайдеры: TelegramBotModule тянет AuthModule, LicensesModule,
    // HwidModule, BillingModule и ProductsModule ради их публичных сервисов,
    // и любой недостающий экспорт превращается в исключение на этой строке.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule as never],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('модуль бота поднимается, но рубильник выключен', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule as never],
    }).compile();

    // Провайдеры бота существуют даже при TELEGRAM_BOT_ENABLED=false:
    // модуль регистрируется всегда, а рубильник проверяется на границах.
    // Если бы модуль регистрировался условно, кабинет получал бы 404
    // вместо внятного TELEGRAM_DISABLED.
    const { TelegramBotConfig } = await import(
      '../src/modules/telegram-bot/telegram-bot.config'
    );
    const config = moduleRef.get(TelegramBotConfig, { strict: false });

    expect(config.enabled).toBe(false);

    // Ключевое свойство рубильника: обращение к необязательным настройкам
    // не бросает. Токен при этом бросает намеренно — но его никто не
    // спрашивает, пока enabled === false.
    expect(config.adminChatId).toBeNull();
    expect(() => config.webhookSecret).not.toThrow();
    expect(() => config.token).toThrow();

    await moduleRef.close();
  });
});
