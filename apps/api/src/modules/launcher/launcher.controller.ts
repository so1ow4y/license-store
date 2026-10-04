import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '@modules/auth/decorators/public.decorator';

import { RequireApiScope } from './decorators/require-api-scope.decorator';
import { CheckLicenseDto, LauncherLogDto, UpdateQueryDto } from './dto/launcher.dto';
import { PayloadRequestDto } from './dto/payload.dto';
import { ApiScopeGuard } from './guards/api-scope.guard';
import { SignatureGuard } from './guards/signature.guard';
import { LauncherService } from './launcher.service';
import type { LicenseKeySource } from './license-key.service';
import { PayloadService } from './payload.service';

/**
 * API загрузчика.
 *
 * ДВА ДОКАЗАТЕЛЬСТВА, И НИ ОДНО ИЗ НИХ БОЛЬШЕ НЕ ТОКЕН ПОЛЬЗОВАТЕЛЯ:
 *
 *   1. Подпись запроса (SignatureGuard) отвечает на вопрос «это наша сборка».
 *      К пользователю она не относилась никогда.
 *   2. Ключ лицензии в ТЕЛЕ отвечает на вопрос «есть ли право на лицензию».
 *      По нему же определяется владелец.
 *
 * @Public стоит на КЛАССЕ, а не на каждом методе: глобальный JwtAuthGuard
 * иначе требовал бы access-токен, которого у загрузчика теперь нет вовсе.
 * Это ослабление, и оно записано явно — единственная причина, по которой
 * его можно себе позволить, в том, что подпись с класса никуда не делась
 * и каждый метод под ней. Снять @UseGuards(SignatureGuard) отсюда значит
 * открыть launcher API всему интернету.
 *
 * Веб-кабинет (регистрация, вход, 2FA, сброс привязки) остаётся на JWT
 * целиком: меняется ТОЛЬКО способ, которым загрузчик доказывает право
 * на payload.
 *
 * ЧТО ПОТЕРЯНО ВМЕСТЕ С СЕССИЕЙ. «Завершить все сессии пользователя»
 * больше не останавливает загрузчик: JwtAuthGuard делал isSessionRevoked
 * на каждый запрос, а ключ лицензии отозвать поштучно нечем. Оперативный
 * рычаг теперь один — блокировка или отзыв ЛИЦЕНЗИИ, и доходит он за
 * recheckAfterSec (по умолчанию 300 с), а на payload — немедленно, потому
 * что лицензия проверяется на каждый запрос.
 */
@ApiTags('launcher')
@ApiHeader({ name: 'X-Api-Key', required: true, description: 'Префикс ключа сборки' })
@ApiHeader({ name: 'X-Timestamp', required: true, description: 'unix-время в секундах' })
@ApiHeader({ name: 'X-Nonce', required: true, description: '16 случайных байт в hex' })
@ApiHeader({ name: 'X-Signature', required: true, description: 'HMAC-SHA256, hex нижнего регистра' })
@Public()
@UseGuards(SignatureGuard)
@Controller('launcher')
export class LauncherController {
  constructor(
    private readonly launcher: LauncherService,
    private readonly payload: PayloadService,
  ) {}

  @Post('license/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Проверка лицензии и привязки к устройству',
    description:
      'Горячий путь платформы. Право доказывается ключом лицензии в теле. ' +
      'Первый вызов привязывает устройство и запускает отсчёт срока. ' +
      'Заголовок X-Recheck-After задаёт интервал следующей проверки.',
  })
  @ApiResponse({
    status: 403,
    description: 'LICENSE_EXPIRED, LICENSE_BLOCKED, LICENSE_REVOKED, LICENSE_NOT_ASSIGNED, HWID_MISMATCH, DEVICE_BLOCKED',
  })
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND, LICENSE_KEY_INVALID' })
  @ApiResponse({
    status: 503,
    description:
      'SERVICE_UNAVAILABLE + Retry-After — порог различных нераспознанных ключей ' +
      'с одного источника. 503, а не 429: клиенту 429 повторять запрещено, а ось ' +
      'порога фактически IP, то есть отказ достаётся и соседям по NAT.',
  })
  async check(
    @Body() dto: CheckLicenseDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const result = await this.launcher.check({
      licenseKey: dto.licenseKey,
      productSlug: dto.productSlug,
      diskId: dto.hwid,
      clientVersion: dto.clientVersion,
      ip: req.ip,
      source: this.sourceOf(req),
      reply,
    });

    // Интервал следующей проверки отдаётся заголовком, а не только в теле:
    // при строгом режиме именно он задаёт, через сколько после аварии
    // остановятся пользователи, и клиент должен видеть его до разбора JSON.
    void reply.header('X-Recheck-After', String(result.recheckAfterSec));

    return result;
  }

  /**
   * Выдача payload'а (ТЗ §7).
   *
   * Метод ТОГО ЖЕ контроллера, поэтому SignatureGuard с класса (UseGuards
   * над объявлением класса) применяется автоматически — своей проверки
   * подписи здесь нет и не нужно. ApiScopeGuard добавляется на уровне метода
   * и потому выполняется ПОСЛЕ guard'ов класса, то есть уже видит
   * request.apiKey.
   *
   * Res БЕЗ passthrough: ответ формируется целиком здесь. Нужен полный
   * контроль над порядком — заголовки X-Payload-* ставятся ПОСЛЕ всей
   * способной упасть работы, иначе исключение уходило бы клиенту с уже
   * выставленными заголовками успешной выдачи.
   *
   * Декоратор Audit не вешается КАТЕГОРИЧЕСКИ: AuditInterceptor пишет
   * request.body целиком, а REDACTED_FIELDS не содержит ни sessionKey,
   * ни hwid. Журнал аудита хранится годами и читается людьми — он мгновенно
   * стал бы хранилищем секретов сессий, Disk ID и, с этой правки, КЛЮЧЕЙ
   * ЛИЦЕНЗИЙ. Сегодня интерцептор без метаданных ничего не делает, поэтому
   * это правило на будущее: оно нарушается одной строкой и незаметно.
   */
  @Post('payload')
  @HttpCode(HttpStatus.OK)
  @RequireApiScope('launcher:payload')
  @UseGuards(ApiScopeGuard)
  @ApiOperation({
    summary: 'Выдача зашифрованного payload',
    description:
      'Тело — сырой шифротекст AES-256-GCM; ключ выводится HKDF-SHA256 из ' +
      'sessionKey запроса, тег и nonce уезжают заголовками. Ключ лицензии ' +
      'предъявляется В КАЖДОМ запросе: лицензия и HWID ПРОВЕРЯЮТСЯ, но ' +
      'не привязываются — первую привязку делает только POST /launcher/license/check.',
  })
  @ApiResponse({ status: 200, description: 'application/octet-stream + заголовки X-Payload-*' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST, SESSION_KEY_REUSED' })
  @ApiResponse({
    status: 403,
    description:
      'API_KEY_SCOPE, LICENSE_EXPIRED, LICENSE_BLOCKED, LICENSE_REVOKED, ' +
      'LICENSE_NOT_ASSIGNED, LICENSE_NOT_BOUND, LICENSE_NOT_ACTIVATED, ' +
      'DEVICE_BLOCKED, HWID_MISMATCH',
  })
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND, LICENSE_KEY_INVALID' })
  @ApiResponse({ status: 409, description: 'PAYLOAD_NOT_READY' })
  @ApiResponse({ status: 426, description: 'UPDATE_REQUIRED' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED + Retry-After — порог выдач на ЛИЦЕНЗИЮ' })
  @ApiResponse({
    status: 503,
    description:
      'SERVICE_UNAVAILABLE, PAYLOAD_CORRUPT, PAYLOAD_UNAVAILABLE, ' +
      'STORAGE_UNAVAILABLE, ISSUE_NOT_RECORDED — все с Retry-After. ' +
      'SERVICE_UNAVAILABLE приходит из двух мест: допуск по памяти и порог ' +
      'различных нераспознанных ключей с одного источника.',
  })
  async getPayload(
    @Body() dto: PayloadRequestDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Ставится ДО работы, а не вместе с остальными заголовками: no-store
    // обязан быть и на ОТКАЗЕ тоже, а отказ уходит через AllExceptionsFilter,
    // который заголовки не добавляет. Обе директивы не могут упасть, поэтому
    // правило «заголовки только перед send» на них не распространяется —
    // оно про X-Payload-*, у которых есть шанс не появиться вовсе.
    void reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');

    const sealed = await this.payload.issue({ dto, req, reply });

    // Content-Type ставится ЯВНО и до send: без него сериализатор Fastify
    // может тронуть Buffer. Content-Length для Buffer он проставит сам,
    // то есть chunked не используется и клиент может зарезервировать вектор
    // по content-length заранее.
    void reply.type('application/octet-stream').headers(sealed.headers).send(sealed.body);
  }

  /**
   * Проверка обновления — БЕЗ ключа лицензии вовсе.
   *
   * Обработчик отвечает «есть ли версия новее и обязательна ли она», и ответ
   * одинаков для всех: ни пользователя, ни лицензии он не читает и никогда
   * не читал. Требовать здесь ключ значило бы либо принять его в query (он
   * не входит в подпись и попадает в access-лог nginx — исключено), либо
   * превратить GET в POST ради параметра, который ни на что не влияет.
   *
   * Хуже того, это создало бы тупик: загрузчик с просроченной лицензией
   * обязан уметь узнать, что ему надо обновиться, а выхода из состояния 426
   * у клиента и так нет (Д14). Запирать ещё и диагностику за лицензией —
   * прямая дорога к «не работает и не говорит почему».
   *
   * Честно про раскрытие: эндпоинт доступен всякому, кто владеет ключом
   * сборки и умеет подписывать. Раскрывает он номер опубликованной версии
   * и флаг mandatory — не секрет, и до этой правки он раздавался любому
   * залогиненному по тому же ключу сборки. Регрессии нет. Ограничение
   * по scope добавлено, чтобы ключ, выпущенный под один эндпоинт, не
   * получал этот в нагрузку.
   */
  @Get('update')
  @RequireApiScope('launcher:update')
  @UseGuards(ApiScopeGuard)
  @ApiOperation({
    summary: 'Проверка обновления',
    description:
      'Обязательность считается по всей цепочке пропущенных версий: если ' +
      'обязательной была промежуточная, обновление обязательно. Ключ ' +
      'лицензии не требуется и не принимается.',
  })
  @ApiResponse({ status: 403, description: 'API_KEY_SCOPE, SIGNATURE_*' })
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  async update(@Query() query: UpdateQueryDto): Promise<unknown> {
    return this.launcher.checkUpdate(query.productSlug, query.clientVersion);
  }

  /**
   * Отчёт от загрузчика.
   *
   * Ключ НЕОБЯЗАТЕЛЕН, ответ ВСЕГДА 202 — обоснование в LauncherLogDto
   * и LauncherService.ingestLog. Коротко: самый ценный отчёт приходит от
   * загрузчика, который как раз не смог аутентифицироваться, а различие
   * ответов сделало бы этот эндпоинт дешёвым проверятором ключей.
   *
   * У приёмника есть СВОЙ бюджет на источник (LicenseKeyService.admitLog),
   * не пересекающийся с порогами /license/check ни ключами Redis, ни
   * расходом. Без него «всегда 202» означало лишь то, что канал в Postgres
   * — на чтение и на запись — открыт всякому, кто умеет подписывать
   * запрос, а общий с /license/check счётчик промахов превращал разницу
   * исходов в наблюдаемый оракул «ключ жив».
   */
  @Post('logs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Отчёт от загрузчика',
    description:
      'В БД попадает метаинформация; тела логов уходят в хранилище объектов. ' +
      'licenseKey необязателен: без него строка пишется с NULL в license_id, ' +
      'user_id и device_id. Ответ 202 при любом исходе разрешения ключа.',
  })
  async logs(
    @Body() dto: LauncherLogDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.launcher.ingestLog({
      licenseKey: dto.licenseKey,
      kind: dto.kind,
      clientVersion: dto.clientVersion,
      summary: dto.summary,
      ip: req.ip,
      source: this.sourceOf(req),
    });
  }

  /**
   * Оси счётчиков перебора ключа: сборка и адрес.
   *
   * Собирается в ОДНОМ месте, потому что оба поля обязаны читаться
   * одинаково во всех трёх обработчиках: apiKey кладёт SignatureGuard,
   * req.ip доказателен только за нашим прокси (Д15).
   */
  private sourceOf(req: FastifyRequest): LicenseKeySource {
    return { apiKeyId: req.apiKey?.id ?? null, ip: req.ip ?? null };
  }
}
