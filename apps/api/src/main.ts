import 'reflect-metadata';

/**
 * Сериализация BigInt в JSON.
 *
 * JSON.stringify на BigInt бросает TypeError — стандарт не определяет
 * для него представления. А в схеме BigInt используется для размеров
 * файлов и номеров сделок Digiseller, и без этого любой ответ, задевший
 * такое поле, превращается в 500 уже ПОСЛЕ успешного выполнения операции.
 * Отладка такого выглядит особенно неприятно: данные записаны, аудит
 * записан, клиент видит ошибку сервера.
 *
 * Число, а не строка: размер файла должен приходить клиенту числом,
 * иначе на стороне C++ и фронтенда его придётся разбирать вручную.
 * Для значений вне безопасного диапазона отдаём строку — потеря точности
 * хуже неудобного типа.
 */
(BigInt.prototype as unknown as { toJSON: () => number | string }).toJSON = function (
  this: bigint,
): number | string {
  return this <= BigInt(Number.MAX_SAFE_INTEGER) && this >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(this)
    : this.toString();
};

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from './app.module';
import type { Env } from '@common/config/env.schema';
import { requestContext } from '@common/request-context/request-context';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    // Идентификатор запроса — сквозной для всей системы: он попадает
    // в логи, в тело ошибки для клиента и в audit_logs.request_id.
    // uuid v7 отсортирован по времени, поэтому по нему же удобно искать
    // диапазоном, а не только точным совпадением.
    genReqId: () => uuidv7(),
    // Доверяем заголовкам X-Forwarded-* — за nginx это единственный способ
    // узнать настоящий IP клиента. Без него весь антифрод и rate limit
    // будут видеть один адрес прокси и считать всех одним пользователем.
    trustProxy: true,
    // 1 МБ хватает любому запросу к API. Загрузка файлов идёт напрямую
    // в S3 по presigned URL и через приложение не проходит.
    bodyLimit: 1_048_576,
  });

  // Пустое тело при Content-Type: application/json.
  //
  // Штатный разборщик Fastify отвергает такой запрос с «Body is not valid
  // JSON», и POST без полезной нагрузки — /auth/logout, например — падает
  // с 400. Клиенты на это натыкаются постоянно: HTTP-библиотеки часто
  // ставят Content-Type независимо от наличия тела.
  //
  // Пустое тело трактуем как пустой объект. Синтаксически неверный JSON
  // по-прежнему отвергается, поэтому проверка не ослабляется.
  adapter.getInstance().addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body: string, done) => {
      // Сырое тело сохраняется ДО разбора и используется при проверке
      // подписи запросов загрузчика.
      //
      // Пересобирать его через JSON.stringify от разобранного объекта
      // нельзя: клиент подписывает БАЙТЫ НА ПРОВОДЕ, а повторная
      // сериализация может дать другую строку — иной порядок ключей,
      // иное экранирование юникода, иное представление чисел. Подпись
      // при этом не сойдётся, и отладка уведёт куда угодно, только
      // не сюда.
      (req as unknown as { rawBody?: string }).rawBody = body ?? '';

      if (body === '' || body === undefined) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // Контекст запроса для сервисов (IP и ID запроса в журнале аудита).
  // run() оборачивает весь дальнейший жизненный цикл запроса.
  adapter.getInstance().addHook('onRequest', (req, _reply, done) => {
    const userAgent = req.headers['user-agent'];
    requestContext.run(
      { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined, requestId: String(req.id) },
      done,
    );
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    // Логи стартовой последовательности буферизуются и выводятся уже
    // через pino — иначе первые строки уходят в консоль в другом формате.
    bufferLogs: true,
    // Штатный разборщик тела отключён: свой уже зарегистрирован выше.
    // Без этого Nest пытается зарегистрировать второй обработчик того же
    // content-type и падает с FST_ERR_CTP_ALREADY_PRESENT.
    //
    // API принимает только JSON, поэтому других разборщиков не нужно.
    // Если появятся формы (например, urlencoded-колбэк OAuth), парсер
    // под них регистрируется рядом с этим.
    bodyParser: false,
  });

  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService<Env, true>);
  const isDev = config.get('NODE_ENV', { infer: true }) !== 'production';

  // --- Безопасность заголовков -----------------------------------------
  const helmet = (await import('@fastify/helmet')).default;
  await app.register(helmet, {
    // CSP выключен: API отдаёт только JSON, а Swagger UI без inline-стилей
    // не работает. Для фронтенда CSP настраивается на nginx.
    contentSecurityPolicy: false,
  });

  const cors = (await import('@fastify/cors')).default;
  await app.register(cors, {
    // Загрузчик на C++ ходит без Origin и под CORS не подпадает.
    // Список нужен только для браузерных клиентов.
    origin: [config.get('FRONTEND_URL', { infer: true })],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Key',
      'X-Signature',
      'X-Timestamp',
      'X-Client-Version',
      'Accept-Language',
    ],
  });

  // --- Маршрутизация ----------------------------------------------------
  // health вынесен из-под префикса: пробы должны жить по стабильному
  // адресу и не переезжать вместе с версией API. Одного exclude мало —
  // контроллер дополнительно помечен VERSION_NEUTRAL, см. health.controller.ts.
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Обработчик несопоставленных маршрутов регистрирует сам Nest во время
  // init() — он бросает NotFoundException, которая проходит через
  // AllExceptionsFilter и получает общую форму ответа. Своего
  // setNotFoundHandler добавлять не нужно: Fastify не допускает двух
  // обработчиков на один префикс и падает при старте.

  // --- Валидация входных данных ----------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      // Отрезает поля, которых нет в DTO. Это защита от mass assignment:
      // без неё запрос на обновление профиля может прислать role_id
      // и оно молча доедет до Prisma.
      whitelist: true,
      // Мало отрезать — сообщаем об ошибке. Клиент, шлющий лишнее,
      // почти всегда делает это по недоразумению, и молчать вредно.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // На проде не показываем клиенту, какие именно ограничения нарушены
      // на уровне названий полей DTO — это разведка структуры API.
      disableErrorMessages: !isDev,
    }),
  );

  // Nest дожидается завершения обработчиков в полёте, затем вызывает
  // onModuleDestroy у Prisma и Redis. Без этого SIGTERM при деплое
  // обрывает запросы, которые уже приняты и почти отвечены.
  app.enableShutdownHooks();

  // --- OpenAPI ----------------------------------------------------------
  // Спецификация нужна не только фронтенду: по ней же разработчик
  // загрузчика на C++ сверяет контракт Launcher API.
  if (isDev) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('License Platform API')
      .setDescription('Управление лицензиями, привязка HWID, обновления, платежи Digiseller')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'apiKey')
      .addTag('health', 'Проверки живости и готовности')
      .addTag('auth', 'Регистрация, вход, токены, 2FA')
      .addTag('licenses', 'Лицензии и их жизненный цикл')
      .addTag('hwid', 'Привязка к устройству и сбросы')
      .addTag('products', 'Продукты, версии, обновления')
      .addTag('payments', 'Заказы и способы оплаты')
      .addTag('admin', 'Административные операции')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get('APP_PORT', { infer: true });
  // 0.0.0.0, а не localhost: внутри контейнера привязка к loopback
  // означает, что снаружи порт недоступен, и это выясняется не сразу.
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`API слушает http://localhost:${port}/api/v1`);
  logger.log(`Проверки: http://localhost:${port}/health/live · /health/ready`);
  if (isDev) logger.log(`OpenAPI: http://localhost:${port}/docs`);
}

void bootstrap();
