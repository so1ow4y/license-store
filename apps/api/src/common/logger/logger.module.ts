import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.schema';
import { redactLicenseKeys } from '../utils/license-key';

/**
 * Секрет вебхука Telegram — это СЕГМЕНТ ПУТИ, а не заголовок и не поле тела:
 * POST /api/v1/telegram/webhook/<секрет>. Поэтому ни redact по req.params,
 * ни redact по req.headers его не спасают — в лог он попадает через url,
 * который сериализатор req пишет открытым, и попадает на КАЖДОМ апдейте,
 * то есть десятки тысяч раз в сутки.
 *
 * Утечка здесь равносильна утечке права слать боту любые апдейты от чьего
 * угодно имени: контроллер сравнивает секрет пути и одноимённый заголовок,
 * а заголовок подделывается тривиально — он не подписан.
 *
 * Регулярка нарочно широкая по алфавиту (base64url + что угодно без слэша):
 * вырезать лишнее в диагностике дешевле, чем не вырезать секрет.
 *
 * Флаг `g` — ради второй точки вызова (цензор сообщений ниже), где в одной
 * строке теоретически может оказаться два адреса. Использовать эту
 * регулярку в `.test()` НЕЛЬЗЯ: у глобальной регулярки `.test()` хранит
 * lastIndex между вызовами и на одной и той же строке отвечает через раз.
 * Здесь она живёт только внутри `replace`, который lastIndex сбрасывает сам.
 */
const WEBHOOK_PATH_RE = /(\/telegram\/webhook\/)[^\s/?#]+/g;

export function maskWebhookSecret(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(WEBHOOK_PATH_RE, '$1[REDACTED]');
}

/**
 * Структурное логирование через pino.
 *
 * Почему не встроенный логгер Nest: он пишет человекочитаемый текст, который
 * невозможно нормально агрегировать. Pino отдаёт JSON — строки уходят
 * в сборщик логов как есть, с полями, по которым можно фильтровать.
 *
 * Главное здесь — reqId. Тот же идентификатор возвращается клиенту в теле
 * ошибки и пишется в audit_logs.request_id. Три независимых источника
 * связываются одним значением: пользователь прислал ID из сообщения об
 * ошибке — и видна вся цепочка от HTTP-запроса до записи в журнале аудита.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDev = config.get('NODE_ENV', { infer: true }) !== 'production';

        return {
          // Именованный wildcard: Nest 11 (path-to-regexp v8) не принимает
          // голую '*' по умолчанию nestjs-pino и пишет предупреждение на старте.
          forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),

            // В разработке — цветной вывод для чтения глазами.
            // В проде — сырой JSON: транспорт съедает CPU и добавляет
            // задержку, а читать логи глазами на проде всё равно не будут.
            transport: isDev
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss.l',
                    ignore: 'pid,hostname',
                    singleLine: false,
                  },
                }
              : undefined,

            // Fastify сам генерирует req.id; берём его, чтобы идентификатор
            // был единым и в логах, и в ответе клиенту.
            genReqId: (req) => (req as { id?: string }).id ?? '',

            /**
             * Что вырезается из логов. Список намеренно избыточен:
             * дешевле замаскировать лишнее, чем однажды обнаружить
             * пароль в архиве логов.
             *
             * hwid и licenseKey здесь не паранойя: HWID пользователю
             * не показывается по ТЗ п.7, а ключ лицензии — это, по сути,
             * предъявительский документ.
             */
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'req.headers["x-signature"]',
                'res.headers["set-cookie"]',
                'req.body.password',
                'req.body.newPassword',
                'req.body.currentPassword',
                'req.body.token',
                'req.body.refreshToken',
                'req.body.twoFactorCode',
                'req.body.hwid',
                'req.body.diskId',
                'req.body.uniqueCode',
                'req.body.licenseKey',
                'req.body.apiKey',
                'req.body.secret',
                // Действующий код 2FA. Живёт полминуты, но лог живёт год:
                // POST /auth/telegram/link/init помечен @Audit, и тело
                // запроса проходит и через интерцептор, и мимо логгера.
                'req.body.totpCode',
                // Код Digiseller и регистрационный ключ: оба одноразовые
                // и оба — предъявительские.
                'req.body.code',
                // Секрет вебхука Telegram. В URL он вырезается отдельно —
                // см. сериализатор req ниже, там объяснено почему.
                'req.params.secret',
                'req.headers["x-telegram-bot-api-secret-token"]',
              ],
              censor: '[REDACTED]',
            },

            // Логируем только то, что нужно для разбора. Полный дамп
            // заголовков и тела раздувает объём и тащит за собой данные,
            // которые не должны храниться.
            serializers: {
              req: (req: {
                id: string;
                method: string;
                url: string;
                headers: Record<string, unknown>;
                remoteAddress?: string;
              }) => ({
                id: req.id,
                method: req.method,
                url: maskWebhookSecret(req.url),
                userAgent: req.headers['user-agent'],
                clientVersion: req.headers['x-client-version'],
                ip: req.remoteAddress,
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },

            // Проверки здоровья идут раз в несколько секунд от nginx
            // и оркестратора. Без этого 90% лога — успешные /health.
            //
            // Смотрим на originalUrl, а НЕ на url, и это не перестраховка.
            // Nest подключает middleware через свой клон @fastify/middie
            // (@nestjs/platform-fastify/adapters/middie), а тот монтирует его
            // по пути из forRoutes — nestjs-pino отдаёт '*', Nest переводит
            // это в '{*path}' — и ПЕРЕД вызовом срезает совпавший префикс:
            //     req.url = req.url.replace(result[0], '')
            // Шаблон '{*path}' совпадает со всем путём целиком, поэтому внутри
            // предиката req.url равен '/' для ЛЮБОГО запроса, а полный путь
            // остаётся только в req.originalUrl. Сериализатор req ниже берёт
            // его через pino-std-serializers (originalUrl || url), из-за чего
            // в логе url выглядел правильным, а фильтр молча не срабатывал:
            // 73% строк живого прогона — успешные /health/live.
            autoLogging: {
              ignore: (req) => {
                const raw = req as { originalUrl?: string; url?: string };
                const full = raw.originalUrl ?? raw.url ?? '';
                const query = full.indexOf('?');
                const path = query === -1 ? full : full.slice(0, query);
                // Пробы вынесены из-под глобального префикса 'api' (main.ts,
                // setGlobalPrefix exclude), но форма с префиксом покрыта тоже:
                // вернуть /health под префикс — правка в одну строку в main.ts,
                // и фильтр не должен от неё зависеть. Точная граница сегмента
                // (а не startsWith) — чтобы будущий /healthz-report не исчезал
                // из лога заодно с пробами.
                if (/^\/(?:api\/)?health(?:\/|$)/.test(path)) return true;
                // Краевые агенты (nginx, фаервол) забирают списки каждые
                // 10 секунд — то же «90% лога», что и пробы. Отказы (401/404)
                // всё равно видны: их пишет AllExceptionsFilter.
                return /^\/api\/v\d+\/internal\/edge\//.test(path);
              },
            },

            customLogLevel: (_req, res, err) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },

            /**
             * Цензор ключей лицензий в ТЕКСТЕ сообщений (§7.6 ТЗ бота,
             * условие выпуска — ноль совпадений грепом по суточным логам).
             *
             * Почему здесь, а не в redact: redact в pino работает по путям
             * структурированных полей (req.body.licenseKey и т.п.) и текст
             * сообщения не трогает вовсе. А ключ попадает в лог именно
             * текстом — через интерполяцию в сообщении об ошибке, где его
             * никто не объявлял полем.
             *
             * Почему хук, а не дисциплина на местах вызова: дисциплина
             * работает ровно до первого `catch (e) { logger.error(e.message) }`,
             * написанного человеком, который про ключи в тот момент не думал.
             * Здесь же перехватывается КАЖДЫЙ вызов логгера.
             *
             * Обрабатываются только строковые аргументы. Обход произвольных
             * объектов стоил бы рекурсии на каждой строке лога, а известные
             * поля закрывает redact выше. Замена идемпотентна, поэтому
             * повторный проход (pino-http вызывает свой хук на автологе
             * запроса, pino — свой на той же записи) ничего не портит.
             */
            hooks: {
              logMethod(
                this: unknown,
                args: unknown[],
                method: (...a: unknown[]) => void,
              ): void {
                for (let i = 0; i < args.length; i++) {
                  const arg = args[i];
                  if (typeof arg !== 'string') continue;
                  // Секрет вебхука режется и здесь: фильтр исключений
                  // печатает URL строкой, минуя сериализатор req.
                  args[i] = redactLicenseKeys(maskWebhookSecret(arg) ?? arg);
                }
                method.apply(this, args);
              },
            },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
