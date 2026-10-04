import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LicenseStatus, ReleaseChannel } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';
import { HwidService, type HwidCheckResult } from '@modules/hwid/hwid.service';
import { VersionsService } from '@modules/products/versions.service';

import {
  LicenseKeyService,
  type LicenseForLauncher,
  type LicenseKeySource,
} from './license-key.service';

/**
 * Launcher API — горячий путь платформы (ТЗ п.6, п.11, п.21): основной
 * трафик, загрузчики опрашивают сервер каждые несколько минут. Проверка
 * лицензии каждый раз идёт в Postgres (замер живого прогона — ~60 мс);
 * кэша результата нет.
 */

/** Отметка присутствия для счётчика онлайна. */
const ONLINE_PREFIX = 'license:online:';

/**
 * ВЫБОРА ЛИЦЕНЗИИ БОЛЬШЕ НЕТ — и это главное изменение поведения при переходе
 * на ключ.
 *
 * Раньше здесь жили pickLicense, LICENSE_FALLBACK_ORDER и LICENSE_CANDIDATES:
 * сервер сам решал, какая из лицензий пользователя обслуживает запуск, и
 * именно это правило АВТОМАТИЧЕСКИ активировало купленное впрок продление.
 * Ключ задаёт лицензию однозначно, поэтому весь механизм мёртв и удалён.
 *
 * Цена, которую надо назвать вслух: человек, купивший продление, получает
 * НОВЫЙ ключ и обязан вставить его в загрузчик. До этого момента он держит
 * оплаченное продление и видит LICENSE_EXPIRED по старому ключу — раньше
 * переход был бесшовным. Смягчение — флаг renewalAvailable в теле отказа
 * (см. renewalHint): загрузчику есть что сказать человеку, а сам новый ключ
 * не отдаётся ни при каких условиях, иначе просроченный ключ стал бы
 * способом добыть действующий.
 */

/**
 * Идентификаторы, которые резолвер выкладывает наружу ПО МЕРЕ чтения строк.
 *
 * Нужен потому, что все отказы по лицензии и привязке бросаются ИЗНУТРИ
 * resolveForLauncher — то есть до того, как вызывающий получит результат и
 * хоть что-то себе присвоит. Вызывающий, который ведёт журнал попыток
 * (payload.service.ts), писал из-за этого отказные строки с NULL в
 * license_id / device_id / product_id, хотя резолвер в момент броска держал
 * все три значения в руках. Именно серия отказов по одной лицензии и есть
 * сигнал, ради которого журнал заводился.
 *
 * Альтернатива — прикрепить идентификаторы к самому исключению — отвергнута.
 * Тело HttpException Nest сериализует КЛИЕНТУ: внутренние UUID лицензии и
 * устройства уехали бы в каждый 403. Класть их мимо тела, отдельным полем на
 * объекте ошибки, можно, но тогда про это обязан помнить КАЖДЫЙ throw, в том
 * числе те, которых ещё нет, — а забытый throw даёт ровно тот же NULL, только
 * молча. Здесь поле заполняется один раз рядом с чтением строки и покрывает
 * все отказы ниже по коду автоматически.
 */
export interface LauncherResolveTrace {
  productId?: string;
  licenseId?: string;
  deviceId?: string;
  /**
   * Владелец лицензии.
   *
   * Раньше вызывающий знал его ДО резолвера — из JWT — и заполнял сам.
   * Теперь пользователь производен от ключа, то есть становится известен
   * ровно здесь, вместе с licenseId, и может отсутствовать вовсе
   * (licenses.user_id nullable). Журналу это ничего не ломает:
   * payload_issues.user_id nullable изначально.
   */
  userId?: string;
}

export interface LicenseCheckResult {
  status: 'ACTIVE';
  expiresAt: string | null;
  productName: string;
  planName: string;
  update: {
    available: boolean;
    mandatory: boolean;
    version: string | null;
    versionCode: number | null;
  } | null;
  notice: string | null;
  recheckAfterSec: number;
}

@Injectable()
export class LauncherService {
  private readonly logger = new Logger(LauncherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly hwid: HwidService,
    private readonly versions: VersionsService,
    private readonly licenseKeys: LicenseKeyService,
  ) {}

  /**
   * Общая для всех эндпоинтов загрузчика цепочка «продукт → лицензия →
   * устройство».
   *
   * Вынесено из check() не из эстетики. Раньше причина была в выборе строки:
   * where и orderBy жили инлайном, и при первой же правке два эндпоинта
   * выбрали бы РАЗНЫЕ лицензии одного пользователя. С ключом лицензия задана
   * однозначно, и эта опасность ушла — но осталась вторая, более неприятная:
   * ПОРЯДОК и СОСТАВ проверок (владелец, срок, статус, verify-only, привязка).
   * Разъехавшийся порядок дал бы 200 от license/check и отказ от payload
   * в одну секунду, а диагностировать это было бы некому.
   *
   * Порядок отказов важен: сначала то, что пользователь может исправить
   * сам (истёк срок → продлить), потом то, что требует поддержки.
   *
   * @param licenseKey     ЕДИНСТВЕННОЕ доказательство права на лицензию:
   *        токена пользователя на этом пути больше нет.
   * @param allowFirstBind false — verify-only: запрос ПРОВЕРЯЕТ привязку
   *        и не имеет права её создавать и запускать отсчёт срока.
   * @param touchDevice    false — не писать статистику присутствия.
   * @param trace          необязательный приёмник идентификаторов: резолвер
   *        пишет в него product.id / license.id / user.id / устройство СРАЗУ
   *        после чтения строк, до любого броска отказа (см. LauncherResolveTrace).
   * @param source         ключ сборки и адрес — оси счётчиков перебора.
   * @param reply          нужен только для Retry-After при 503 от порога
   *        источника; см. LicenseKeyService.resolve.
   */
  async resolveForLauncher(params: {
    licenseKey: string;
    productSlug: string;
    diskId: string;
    clientVersion?: string;
    ip?: string;
    country?: string;
    source: LicenseKeySource;
    allowFirstBind: boolean;
    touchDevice: boolean;
    trace?: LauncherResolveTrace;
    reply?: FastifyReply;
  }): Promise<{
    product: { id: string; name: string };
    license: LicenseForLauncher;
    bind: HwidCheckResult;
  }> {
    // Приёмник по умолчанию — пустой объект, чтобы ниже не появилось ни одной
    // проверки на undefined: три `if (params.trace)` вокруг присваиваний
    // читались бы как условная логика там, где её нет. Вызывающий без журнала
    // (check()) просто выбрасывает этот объект вместе с кадром стека.
    const trace = params.trace ?? {};

    const product = await this.prisma.product.findUnique({
      where: { slug: params.productSlug },
      select: { id: true, name: true },
    });

    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Продукт не найден' });
    }

    trace.productId = product.id;

    // Лицензия задана КЛЮЧОМ, а не выбирается сервером из нескольких.
    // Нераспознанный ключ (нет такого, чужой продукт, валидный мусор) уходит
    // отсюда единым 404 LICENSE_KEY_INVALID и в payload_issues не попадает:
    // лицензии нет, значит нет ни licenseId, ни productId, а значения под
    // такой исход нет в PayloadIssueResult. Это уточнение к Д29 — «каждая
    // попытка» означает «каждая попытка, дошедшая до проверки лицензии».
    const license = await this.licenseKeys.resolve({
      licenseKey: params.licenseKey,
      productId: product.id,
      diskId: params.diskId,
      source: params.source,
      reply: params.reply,
    });

    // Присваивание стоит ДО assertUsable и до verify-only проверок ниже —
    // именно они бросают LICENSE_EXPIRED / BLOCKED / REVOKED / NOT_BOUND /
    // NOT_ACTIVATED. Строкой позже журнал уже не узнал бы, ПО КАКОЙ лицензии
    // отказали, а разбор шаринга и перебора HWID делается только в её разрезе.
    trace.licenseId = license.id;
    trace.userId = license.userId ?? undefined;
    trace.deviceId = license.currentDeviceId ?? undefined;

    // Ничья лицензия (ещё не выдана или аккаунт удалён) в загрузчике не
    // работает. Проверка после trace — чтобы отказ попал в журнал с licenseId.
    if (license.userId === null) {
      throw new ForbiddenException({
        code: 'LICENSE_NOT_ASSIGNED',
        message: 'Ключ не привязан к аккаунту — активируйте его в личном кабинете',
      });
    }

    await this.assertUsable(license);

    if (!params.allowFirstBind) {
      // Обе проверки делаются на УЖЕ прочитанной строке — ноль
      // дополнительных запросов, и типичный отказ не доходит до второго
      // чтения лицензии внутри HwidService.
      if (license.currentDeviceId === null) {
        throw new ForbiddenException({
          code: 'LICENSE_NOT_BOUND',
          message: 'Сначала выполните проверку лицензии',
        });
      }

      // Дефект Д1. PENDING означает «срок не начат»: expiresAt = NULL,
      // а проверка срока трактует NULL как «бессрочная». Лицензия с
      // проставленной вручную привязкой проходила бы все проверки и
      // давала выдачу навсегда — крон EXPIRED её не видит, ни один
      // оплаченный день не сгорает.
      //
      // Verify-only путь исправить это не может по построению (он не
      // имеет права активировать), значит обязан отказать. Отдельный код,
      // а не HWID_MISMATCH: привязка как раз ЕСТЬ, а на HWID_MISMATCH
      // клиент стирает сохранённые секреты и предлагает сброс привязки —
      // здесь это вредный совет.
      if (license.status !== LicenseStatus.ACTIVE) {
        throw new ForbiddenException({
          code: 'LICENSE_NOT_ACTIVATED',
          message: 'Лицензия ещё не активирована. Выполните проверку лицензии.',
        });
      }
    }

    // Привязка проверяется ВСЕГДА, даже при попадании в кэш результата:
    // кэш хранит состояние лицензии, а устройство могло смениться.
    const bind = await this.hwid.bindOrVerify(
      license.id,
      params.diskId,
      {
        ip: params.ip,
        country: params.country,
        clientVersion: params.clientVersion,
      },
      { allowFirstBind: params.allowFirstBind, touch: params.touchDevice },
    );

    // На отказе HwidService возвращает deviceId ПРИВЯЗАННОГО устройства
    // (MISMATCH, DEVICE_BLOCKED), а не того, с которого пришли: строки для
    // устройства-нарушителя в базе может не быть вовсе — verify-only путь её
    // не создаёт. Для разбора нужно как раз первое: «в чью привязку ломятся».
    // Сам чужой Disk ID из журнала не теряется — он лежит в hwid_hash.
    trace.deviceId = bind.deviceId ?? trace.deviceId;

    if (!bind.ok) {
      throw new ForbiddenException(this.bindFailure(bind.reason));
    }

    return { product, license, bind };
  }

  /**
   * Проверка лицензии и привязки.
   *
   * Единственный путь, которому разрешено привязать устройство и запустить
   * отсчёт срока. Порядок в контракте: сначала license/check, потом всё
   * остальное.
   */
  async check(params: {
    licenseKey: string;
    productSlug: string;
    diskId: string;
    clientVersion: string;
    ip?: string;
    country?: string;
    source: LicenseKeySource;
    reply?: FastifyReply;
  }): Promise<LicenseCheckResult> {
    const { product, license, bind } = await this.resolveForLauncher({
      licenseKey: params.licenseKey,
      productSlug: params.productSlug,
      diskId: params.diskId,
      clientVersion: params.clientVersion,
      ip: params.ip,
      country: params.country,
      source: params.source,
      reply: params.reply,
      allowFirstBind: true,
      touchDevice: true,
    });

    // Лицензия только что активирована — перечитываем срок, иначе отдадим
    // expiresAt, устаревший ровно на этот запрос.
    const fresh = bind.activated
      ? await this.prisma.license.findUniqueOrThrow({
          where: { id: license.id },
          select: { expiresAt: true, status: true },
        })
      : { expiresAt: license.expiresAt, status: license.status };

    await this.markOnline(license.id);
    await this.touchLastCheck(license.id, params);

    const recheckAfterSec = await this.settings.getNumber(
      'limits.license.check_cache_ttl_sec',
      300,
    );

    return {
      status: 'ACTIVE',
      expiresAt: fresh.expiresAt?.toISOString() ?? null,
      productName: product.name,
      planName: license.plan.name,
      update: await this.updateInfo(product.id, params.clientVersion),
      notice: null,
      recheckAfterSec,
    };
  }

  /** Проверка обновления без полной проверки лицензии. */
  async checkUpdate(productSlug: string, clientVersion: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug: productSlug },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Продукт не найден' });
    }

    const info = await this.updateInfo(product.id, clientVersion);
    return info ?? { available: false, mandatory: false, version: null, versionCode: null };
  }

  /**
   * Приём отчёта от загрузчика (ТЗ п.11).
   *
   * В БД попадает только метаинформация: сами логи объёмные, читаются
   * редко и точечно, держать их в Postgres незачем. Пока хранилище логов
   * не подключено, тело обрезается и кладётся в summary.
   *
   * Ключ здесь НЕОБЯЗАТЕЛЕН, и разрешение его — best-effort: разрешился →
   * строка получает licenseId, userId и deviceId; не разрешился или его не
   * прислали → в этих колонках NULL. Ответ 202 в любом случае, потому что
   * различие ответов сделало бы /logs бесплатным проверятором ключей мимо
   * счётчиков check и payload.
   *
   * ОДНОГО «ВСЕГДА 202» ДЛЯ ЭТОГО НЕ ХВАТАЕТ, и это стоило дыры. Пока
   * бюджета не было, эндпоинт оставался неограниченным каналом: findUnique
   * по licenses.key и INSERT в launcher_log_batches на КАЖДЫЙ запрос,
   * с единственным потолком в виде зоны nginx (120 r/m на адрес). Теперь
   * источник сначала списывает бюджет (LicenseKeyService.admitLog), и
   * исчерпавший его получает тот же 202, но без обращения к базе — ни
   * на чтение, ни на запись. Расход одинаков при любом исходе разрешения
   * ключа: иначе бюджет сам стал бы оракулом.
   *
   * Схема это предусматривала с самого начала: launcher_log_batches.user_id
   * объявлен nullable «без FK: лог может прийти от клиента, чей аккаунт уже
   * удалён», а колонки license_id и device_id вместе с индексом
   * @@index([licenseId]) существовали и не заполнялись НИ РАЗУ. Переход
   * на ключ впервые даёт им смысл.
   */
  async ingestLog(params: {
    licenseKey?: string;
    kind: string;
    clientVersion: string;
    summary: string;
    ip?: string;
    source: LicenseKeySource;
  }): Promise<{ accepted: true }> {
    // Списание ДО всякой работы и независимо от того, прислали ключ или нет:
    // бюджет считает ЗАПРОСЫ к приёмнику, а не промахи по ключу.
    if (!(await this.licenseKeys.admitLog(params.source))) return { accepted: true };

    const license = params.licenseKey
      ? await this.licenseKeys.resolveForLog(params.licenseKey)
      : null;

    await this.prisma.launcherLogBatch.create({
      data: {
        id: uuidv7(),
        userId: license?.userId ?? null,
        licenseId: license?.id ?? null,
        deviceId: license?.currentDeviceId ?? null,
        kind: params.kind,
        clientVersion: params.clientVersion,
        summary: params.summary.slice(0, 512),
        ip: params.ip ?? null,
      },
    });

    return { accepted: true };
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Маппинг отказа привязки в код для клиента.
   *
   * Незнакомую причину схлопываем в HWID_MISMATCH — так было до выноса
   * резолвера, и менять умолчание заодно с рефакторингом нельзя.
   */
  private bindFailure(reason: HwidCheckResult['reason']): { code: string; message: string } {
    switch (reason) {
      case 'DEVICE_BLOCKED':
        return { code: 'DEVICE_BLOCKED', message: 'Устройство заблокировано' };
      case 'NOT_BOUND':
        return { code: 'LICENSE_NOT_BOUND', message: 'Сначала выполните проверку лицензии' };
      default:
        return { code: 'HWID_MISMATCH', message: 'Лицензия привязана к другому устройству' };
    }
  }

  /**
   * Отказы, которые пользователь видит вместо доступа.
   *
   * Разные коды для разных причин намеренно: загрузчик показывает разные
   * экраны — «продлить» для истёкшей и «обратитесь в поддержку»
   * для заблокированной.
   */
  private async assertUsable(license: LicenseForLauncher): Promise<void> {
    if (license.status === LicenseStatus.BLOCKED) {
      // Про продление здесь молчим намеренно: блокировка — это наше решение
      // по нарушению, и предлагать в ответ на него «возьмите другой ключ»
      // значит подсказывать обход.
      throw new ForbiddenException({
        code: 'LICENSE_BLOCKED',
        message: 'Лицензия заблокирована. Обратитесь в поддержку.',
      });
    }

    if (license.status === LicenseStatus.REVOKED) {
      throw new ForbiddenException({
        code: 'LICENSE_REVOKED',
        message: 'Лицензия отозвана',
        ...(await this.renewalHint(license)),
      });
    }

    // Срок проверяется по дате, а не только по статусу: крон переводит
    // в EXPIRED раз в час, и в этом окне статус ещё ACTIVE.
    //
    // Условие expiresAt IS NOT NULL обязательно: у бессрочной лицензии
    // там NULL, и сравнение дало бы NULL вместо false — доступ пропал бы
    // именно у тех, кто заплатил больше всех.
    if (
      license.status === LicenseStatus.EXPIRED ||
      (license.expiresAt !== null && license.expiresAt.getTime() < Date.now())
    ) {
      throw new ForbiddenException({
        code: 'LICENSE_EXPIRED',
        message: 'Срок действия лицензии истёк',
        ...(await this.renewalHint(license)),
      });
    }
  }

  /**
   * Компенсация за исчезнувший автоматический подбор лицензии.
   *
   * Раньше pickLicense сам переключался на оплаченное продление, и человек
   * ничего не замечал. С ключом лицензия задана однозначно, поэтому владелец
   * продления упирается в LICENSE_EXPIRED по старому ключу, имея на руках
   * действующий новый. Флаг позволяет загрузчику сказать «продление найдено
   * в вашем кабинете, возьмите там новый ключ» вместо тупика.
   *
   * САМ КЛЮЧ НЕ ОТДАЁТСЯ НИ ПРИ КАКИХ УСЛОВИЯХ. Правило владельца — ключ
   * виден только в личном кабинете; отдав его здесь, мы превратили бы
   * просроченный ключ в способ добыть действующий, то есть в наследуемый
   * навсегда доступ.
   *
   * Флаг ставится только когда он ИСТИНЕН: отсутствующее поле и false
   * означают для клиента одно и то же, а лишний ключ в JSON — это лишняя
   * ветка на C++.
   *
   * Ошибка запроса гасится: это подсказка в теле отказа, и она не имеет
   * права превратить чистый 403 в 500.
   */
  private async renewalHint(license: {
    id: string;
    userId: string | null;
    productId: string;
  }): Promise<{ renewalAvailable?: true }> {
    if (license.userId === null) return {};

    const renewal = await this.prisma.license
      .findFirst({
        where: {
          userId: license.userId,
          productId: license.productId,
          id: { not: license.id },
          // PENDING ОБЯЗАН БЫТЬ В СПИСКЕ, иначе подсказка не срабатывает
          // ровно в том случае, ради которого заведена. Купленное продление —
          // это НОВАЯ лицензия, а issue() создаёт её со status: PENDING и
          // expiresAt: null («срок НЕ начинается здесь»), и все три пути
          // выдачи — Digiseller и ключи регистрации — идут через issue().
          // С фильтром по одному ACTIVE флаг мог появиться только у того,
          // у кого УЖЕ есть вторая активированная живая лицензия на тот же
          // продукт, то есть у того, кто и так работает. Человек, купивший
          // продление и ещё не запускавший его, видел LICENSE_EXPIRED без
          // подсказки — тупик вместо обещанного смягчения.
          status: { in: [LicenseStatus.PENDING, LicenseStatus.ACTIVE] },
          // «Живая» — та же формулировка, что была в pickLicense: бессрочная
          // либо не истёкшая ПО ДАТЕ. Статус ACTIVE сам по себе гарантии
          // не даёт, крон переводит в EXPIRED раз в час. У PENDING здесь
          // всегда NULL, то есть условие для неё выполняется — так и надо:
          // непочатая лицензия живая по определению.
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `не удалось проверить наличие продления: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      });

    return renewal ? { renewalAvailable: true } : {};
  }

  private async updateInfo(productId: string, clientVersion: string) {
    const code = this.versionCodeOf(clientVersion);
    if (code === null) return null;

    const update = await this.versions.checkUpdate(productId, code, ReleaseChannel.STABLE);
    if (!update) return { available: false, mandatory: false, version: null, versionCode: null };

    return {
      available: true,
      mandatory: update.mandatory,
      version: update.version,
      versionCode: update.versionCode,
    };
  }

  private versionCodeOf(version: string): number | null {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,4})$/.exec(version);
    if (!m) return null;
    return Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]);
  }

  /**
   * Отметка присутствия для счётчика онлайна.
   *
   * Живёт ТОЛЬКО в Redis. Писать heartbeat в Postgres нельзя: при 1000
   * онлайн и опросе раз в пять минут это 288 тысяч записей в сутки —
   * на порядки больше всего остального в базе вместе взятого.
   */
  private async markOnline(licenseId: string): Promise<void> {
    const ttl = await this.settings.getNumber('limits.license.check_cache_ttl_sec', 300);
    await this.redis.client.set(`${ONLINE_PREFIX}${licenseId}`, '1', 'EX', ttl * 2);
  }

  /**
   * Обновление last_check_at в БД — не чаще раза в пять минут на лицензию.
   *
   * Само по себе поле нужно для админки, но писать его на каждый запрос
   * значит превращать проверку лицензии в запись. Отсечка живёт в Redis.
   */
  private async touchLastCheck(
    licenseId: string,
    params: { ip?: string; country?: string; clientVersion: string },
  ): Promise<void> {
    const throttleKey = `license:touch:${licenseId}`;
    const acquired = await this.redis.client.set(throttleKey, '1', 'EX', 300, 'NX');
    if (acquired === null) return;

    await this.prisma.license
      .update({
        where: { id: licenseId },
        data: {
          lastCheckAt: new Date(),
          lastCheckIp: params.ip ?? null,
          lastCheckCountry: params.country ?? null,
          lastClientVersion: params.clientVersion,
        },
      })
      .catch((error: unknown) => {
        // Не роняем проверку лицензии из-за статистики.
        this.logger.warn(
          `не удалось обновить last_check_at: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}
