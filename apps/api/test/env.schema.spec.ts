import { describe, expect, it } from 'vitest';
import { validateEnv } from '../src/common/config/env.schema';

/**
 * Валидация конфигурации — единственная защита от запуска с полуготовыми
 * настройками. Тесты здесь проверяют не «схема работает», а конкретные
 * сценарии, которые реально случаются при деплое.
 */

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    APP_PORT: '3000',
    APP_URL: 'http://localhost:3000',
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://lp:pw@localhost:5442/license_platform',
    REDIS_URL: 'redis://:pw@localhost:6389/0',
    JWT_SECRET: HEX_A,
    HWID_PEPPER: HEX_B,
    ENCRYPTION_KEY: HEX_C,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'lpadmin',
    S3_SECRET_KEY: 'pw',
    S3_BUCKET_RELEASES: 'releases',
    SMTP_HOST: 'localhost',
    SMTP_FROM: 'noreply@local',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('принимает корректную конфигурацию и подставляет умолчания', () => {
    const env = validateEnv(baseEnv());

    expect(env.APP_PORT).toBe(3000);
    expect(env.ARGON2_MEMORY_KIB).toBe(65536);
    expect(env.S3_BUCKET_PAYLOADS).toBe('payloads');
  });

  it('не пускает payload в бакет releases', () => {
    expect(() => validateEnv(baseEnv({ S3_BUCKET_PAYLOADS: 'releases' }))).toThrow(/S3_BUCKET_PAYLOADS/);
  });

  it('собирает ВСЕ ошибки разом, а не падает на первой', () => {
    // Настройка окружения не должна превращаться в игру «запусти,
    // почини одну строчку, запусти снова».
    const call = () =>
      validateEnv(baseEnv({ JWT_SECRET: 'короткий', HWID_PEPPER: 'не-hex', DATABASE_URL: 'mysql://x' }));

    expect(call).toThrow(/JWT_SECRET/);
    expect(call).toThrow(/HWID_PEPPER/);
    expect(call).toThrow(/DATABASE_URL/);
  });

  it('требует ровно 64 hex-символа для HWID_PEPPER', () => {
    // Слишком короткий pepper обесценивает хеширование HWID: Disk ID
    // имеет низкую энтропию и перебирается по радужной таблице.
    expect(() => validateEnv(baseEnv({ HWID_PEPPER: 'a'.repeat(32) }))).toThrow(/HWID_PEPPER/);
    expect(() => validateEnv(baseEnv({ HWID_PEPPER: 'z'.repeat(64) }))).toThrow(/HWID_PEPPER/);
  });

  it('не пропускает параметры Argon2 ниже рекомендаций OWASP', () => {
    expect(() => validateEnv(baseEnv({ ARGON2_MEMORY_KIB: '4096' }))).toThrow(/ARGON2_MEMORY_KIB/);
    expect(() => validateEnv(baseEnv({ ARGON2_TIME_COST: '1' }))).toThrow(/ARGON2_TIME_COST/);
  });

  it('в production отвергает секреты-заглушки из .env.example', () => {
    // Самая частая ошибка первого деплоя: .env скопировали, секреты
    // сгенерировать забыли. А они лежат в git и известны всем.
    expect(() =>
      validateEnv(
        baseEnv({ NODE_ENV: 'production', JWT_SECRET: 'CHANGE_ME_openssl_rand_hex_32' }),
      ),
    ).toThrow(/production/);
  });

  it('в production не позволяет использовать один ключ для HWID и шифрования', () => {
    // Компрометация одного секрета не должна автоматически вскрывать второй.
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', HWID_PEPPER: HEX_A, ENCRYPTION_KEY: HEX_A })),
    ).toThrow(/разными/);
  });

  it('в development заглушки допускает — иначе не поднять проект после клона', () => {
    const env = validateEnv(baseEnv({ NODE_ENV: 'development' }));
    expect(env.NODE_ENV).toBe('development');
  });

  describe('булевы значения', () => {
    it('строка "false" означает ЛОЖЬ', () => {
      // z.coerce.boolean() здесь давал бы true: Boolean("false") === true.
      // Из-за этого SMTP_SECURE=false включал TLS на открытом порту,
      // и ошибка выглядела как проблема сети.
      expect(validateEnv(baseEnv({ SMTP_SECURE: 'false' })).SMTP_SECURE).toBe(false);
      expect(validateEnv(baseEnv({ SMTP_SECURE: '0' })).SMTP_SECURE).toBe(false);
      expect(validateEnv(baseEnv({ SMTP_SECURE: 'no' })).SMTP_SECURE).toBe(false);
      expect(validateEnv(baseEnv({ SMTP_SECURE: '' })).SMTP_SECURE).toBe(false);
    });

    it('строка "true" означает истину', () => {
      expect(validateEnv(baseEnv({ SMTP_SECURE: 'true' })).SMTP_SECURE).toBe(true);
      expect(validateEnv(baseEnv({ SMTP_SECURE: '1' })).SMTP_SECURE).toBe(true);
      expect(validateEnv(baseEnv({ SMTP_SECURE: 'ON' })).SMTP_SECURE).toBe(true);
    });

    it('опечатка останавливает старт, а не трактуется как ложь', () => {
      // SMTP_SECURE=ture не должно молча выключать TLS в проде.
      expect(() => validateEnv(baseEnv({ SMTP_SECURE: 'ture' }))).toThrow(/SMTP_SECURE/);
    });

    it('умолчание применяется, когда переменной нет', () => {
      const env = validateEnv(baseEnv());
      expect(env.SMTP_SECURE).toBe(false);
      expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    });
  });

  describe('Telegram-бот', () => {
    const PATH_SECRET = 'p'.repeat(43);
    const HEADER_SECRET = 'h'.repeat(43);

    function botEnv(overrides: Record<string, unknown> = {}) {
      return baseEnv({
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '1234567:AAaaBBbbCCccDDddEEeeFFffGGgg',
        TELEGRAM_BOT_USERNAME: 'pxcheats_bot',
        TELEGRAM_WEBHOOK_SECRET: PATH_SECRET,
        TELEGRAM_WEBHOOK_HEADER_SECRET: HEADER_SECRET,
        ...overrides,
      });
    }

    it('выключенный бот не требует ни токена, ни секретов', () => {
      // Состояние по умолчанию на любой машине разработчика.
      const env = validateEnv(baseEnv());
      expect(env.TELEGRAM_BOT_ENABLED).toBe(false);
    });

    it('включённый бот принимает пару разных секретов', () => {
      const env = validateEnv(botEnv());
      expect(env.TELEGRAM_WEBHOOK_SECRET).toBe(PATH_SECRET);
      expect(env.TELEGRAM_WEBHOOK_HEADER_SECRET).toBe(HEADER_SECRET);
    });

    it('отвергает ОДИНАКОВЫЕ секреты пути и заголовка', () => {
      // Смысл пары в том, что путь протекает в журналы обратного прокси,
      // а заголовок — нет. При одинаковых значениях увидевший URL в чужом
      // логе знает оба и может слать произвольные апдейты от имени любого
      // пользователя Telegram: подписи тела Bot API не ставит.
      expect(() =>
        validateEnv(botEnv({ TELEGRAM_WEBHOOK_HEADER_SECRET: PATH_SECRET })),
      ).toThrow(/TELEGRAM_WEBHOOK_HEADER_SECRET/);
    });

    it('отвергает пустой секрет заголовка при включённом боте', () => {
      expect(() => validateEnv(botEnv({ TELEGRAM_WEBHOOK_HEADER_SECRET: undefined }))).toThrow(
        /TELEGRAM_WEBHOOK_HEADER_SECRET/,
      );
    });

    it('отвергает короткий секрет заголовка', () => {
      expect(() => validateEnv(botEnv({ TELEGRAM_WEBHOOK_HEADER_SECRET: 'корот' }))).toThrow(
        /TELEGRAM_WEBHOOK_HEADER_SECRET/,
      );
    });
  });
});
