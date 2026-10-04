import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AntiFraudSeverity, AntiFraudType, Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { isIP } from 'node:net';
import { v7 as uuidv7 } from 'uuid';

import { CryptoService } from '@common/crypto/crypto.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';

/**
 * Разрешение ключа лицензии для загрузчика.
 *
 * Загрузчик больше не предъявляет токен пользователя: ключ лицензии
 * определяет и лицензию, и владельца. Возражение «ключ — предъявительский
 * документ» изложено владельцу и им отклонено: ключ виден только в личном
 * кабинете, а лицензия привязана к железу.
 *
 * УГАДЫВАНИЕ КЛЮЧА УГРОЗОЙ НЕ ЯВЛЯЕТСЯ и здесь не обсуждается: 16 символов
 * из алфавита в 28 знаков, сгенерированных randomInt (CSPRNG), — это 2^76,9.
 * Реальных угроз три, и на каждую здесь свой ответ:
 *
 *   1. НАГРУЗКА. Запрос дёшев для клиента и стоит нам индексного поиска
 *      в Postgres. Ответ — отрицательный кэш и пороги по источнику, все
 *      в Redis и все ДО обращения к Postgres. Порог применяется на ОБОИХ
 *      путях, приходящих с улицы: и на горячем (resolve), и на приёме
 *      логов (admitLog). Путь без порога — это путь без ответа на угрозу,
 *      а не «путь, на котором отказать нельзя».
 *   2. ПРОВЕРКА СПИСКОВ. Утёкшая выгрузка, скриншоты, перепроданные ключи —
 *      противнику надо узнать, какие из них живы. Счётчик промахов на это
 *      НЕ ОТВЕЧАЕТ: в выгрузке живых ключей большинство, а живой ключ
 *      промахом не является и раньше не стоил ничего. Ответ — ось 1б:
 *      РАЗЛИЧНЫЕ разрешённые ключи с одного источника за час. Отказа там
 *      нет и быть не может (за одним NAT честных ключей столько же),
 *      но сортировка выгрузки перестаёт быть бесшумной.
 *   3. ОРАКУЛ. Ответ обязан не различать «ключа нет», «ключ от другого
 *      продукта» и «синтаксически валидный мусор» — всё это 404
 *      LICENSE_KEY_INVALID. Детальные коды (EXPIRED, BLOCKED, REVOKED)
 *      остаются только для РАЗРЕШЁННЫХ ключей: чтобы их увидеть, надо
 *      предъявить ключ, то есть уже им владеть.
 *
 *      Оракулом является не только КОД ОТВЕТА, но и любое НАБЛЮДАЕМОЕ
 *      состояние, которое зависит от исхода. Пока /logs инкрементил общий
 *      счётчик промахов, не проверяя порога, «ключ существует» читалось
 *      так: погнать кандидата в /logs (всегда 202), затем своим заведомо
 *      рабочим ключом сходить в /license/check и посмотреть, не наступил
 *      ли отказ по порогу. Поэтому у /logs теперь СВОЙ бюджет, который
 *      тратится ОДИНАКОВО при любом исходе разрешения ключа, и общего
 *      состояния между /logs и /license/check не осталось.
 *
 * Ось «лицензия» (payload:rate:<licenseId>) живёт в PayloadService и правки
 * не потребовала — она с самого начала считалась по лицензии, а не по
 * пользователю.
 */

/** Лицензия в том виде, в каком её отдаёт резолвер вызывающим. */
export type LicenseForLauncher = Prisma.LicenseGetPayload<{
  include: { plan: { select: { name: true } }; currentDevice: true };
}>;

/** Кто прислал запрос. Ни одно из полей не является пользователем — их больше нет. */
export interface LicenseKeySource {
  /** id ключа сборки из SignatureGuard. */
  apiKeyId: string | null;
  /** req.ip. Доказателен только за нашим прокси (Д15). */
  ip: string | null;
}

/**
 * Отрицательный кэш нераспознанных ключей.
 *
 * Единственное, что взято от отвергнутой идеи короткоживущего токена. Сканер
 * не превращает каждую догадку в запрос к Postgres, а повтор той же догадки
 * стоит одного GET из Redis. ПОЛОЖИТЕЛЬНОГО кэша (key → licenseId) нет
 * намеренно: он потребовал бы инвалидации при удалении лицензии и не окупает
 * одного попадания в UNIQUE-индекс.
 *
 * Минута, а не час: ключ, выпущенный в кабинете сразу после неудачной
 * попытки, не должен «не существовать» ещё час.
 */
const BAD_KEY_PREFIX = 'launcher:badkey:';
const BAD_KEY_TTL_SEC = 60;

/**
 * Ось 1 — источник, РАЗЛИЧНЫЕ НЕРАСПОЗНАННЫЕ КЛЮЧИ. Единственная ось,
 * которой разрешено отказывать.
 *
 * Успехи не считаются намеренно: за одним NAT сидят сотни легитимных машин,
 * и общий счётчик там — самострел (то же рассуждение уже записано про зону
 * launcher_zone в nginx).
 *
 * МНОЖЕСТВО, А НЕ СЧЁТЧИК ПОПЫТОК, и это исправление, а не оптимизация.
 * Ключ теперь вводится руками из личного кабинета, то есть опечатка — не
 * редкость, а основной способ ошибиться. Со счётчиком попыток десять нажатий
 * «повторить» с ОДНОЙ и той же опечаткой (текст ошибки прямо приглашает:
 * «Проверьте ключ в личном кабинете») выжигали весь бюджет источника — и
 * дальше отказ получал в том числе ПРАВИЛЬНЫЙ ключ, причём у всех, кто сидит
 * за тем же адресом. Различные псевдонимы отделяют цикл опечаток (один
 * элемент, сколько бы раз его ни повторили) от сканера, идущего по списку
 * (элемент на каждую догадку) — именно то различие, ради которого ось
 * заводилась.
 *
 * Множество псевдонимов, а не самих ключей: значения ключей в Redis нет
 * нигде, ровно как в оси 2.
 *
 * ПРЕФИКС СМЕНЁН С `lk:fail:` НАМЕРЕННО. На выкладке в Redis лежат записи
 * прежнего формата — СТРОКИ от INCR, а не множества. SCARD и SADD по строке
 * дают WRONGTYPE, то есть на всех таких источниках ось молча деградировала бы
 * в fail-open с потоком предупреждений; у записей, оставшихся без TTL
 * (см. addDistinct), — навсегда. Новое имя оставляет старые записи сиротами:
 * те, у кого срок есть, истекут сами в пределах окна, остальные не влияют
 * ни на что.
 */
const FAIL_PREFIX = 'lk:miss:';
const FAIL_WINDOW_SEC = 600;
const FAIL_THRESHOLD_DEFAULT = 10;

/**
 * Ось 1б — источник, РАЗЛИЧНЫЕ РАЗРЕШЁННЫЕ КЛЮЧИ. Только наблюдение.
 *
 * Отвечает на угрозу №2, на которую ось 1 не отвечает по построению. Живой
 * ключ промахом не является, поэтому сортировка утёкшей выгрузки (в ней живых
 * ключей большинство) не стоила противнику ни одного элемента в оси 1, не
 * писала строк в журнал выдач и не пересекала порогов оси 2 — один HWID и
 * одна подсеть на весь прогон. Прогон был бесшумным целиком.
 *
 * ОТКАЗА ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: за CGNAT мобильного оператора и в
 * общежитии за одним адресом честных ключей ровно столько же, сколько у
 * сканера, и отказ по этой оси клал бы весь сегмент. Порог существует только
 * чтобы записать событие антифрода — «с одного адреса за час предъявлено
 * N различных живых ключей» — и дать человеку повод посмотреть.
 *
 * Ложное срабатывание за большим NAT возможно и признаётся: это одна строка
 * severity MEDIUM с actionTaken = logged_only на источник в час, а не отказ.
 */
const SRC_KEYS_PREFIX = 'lk:src:';
const SRC_KEYS_WINDOW_SEC = 3600;
const SRC_KEYS_THRESHOLD_DEFAULT = 25;

/**
 * Бюджет приёма отчётов на источник.
 *
 * Закрывает сразу две дыры одним счётчиком, и обе — следствие того, что
 * /launcher/logs не требует лицензии и отвечает 202 всегда:
 *
 *   1. РАЗРЕШЕНИЕ КЛЮЧА МИМО ВСЕХ ПОРОГОВ. resolveForLog делает
 *      findUnique по licenses.key, то есть каждый запрос — индексный поиск
 *      в Postgres. Единственным потолком была зона nginx (120 r/m на адрес),
 *      то есть два обращения к базе в секунду с каждого адреса и вечно.
 *   2. НЕОГРАНИЧЕННАЯ ЗАПИСЬ. Каждый запрос — безусловный INSERT в
 *      launcher_log_batches со строкой до 512 символов от клиента.
 *
 * Бюджет тратится на ЗАПРОС, а не на промах: только так расход не зависит от
 * исхода разрешения ключа и /logs перестаёт быть оракулом (см. угрозу №3
 * в шапке). Исчерпан — запрос по-прежнему получает 202, но ключ не
 * разрешается и строка не пишется: отчёт ценен, однако не ценнее того,
 * чтобы приёмник отчётов не был бесплатным каналом в базу.
 *
 * 60 на 10 минут с адреса — шесть отчётов в минуту. Честный загрузчик шлёт
 * единицы за запуск; за большим NAT потолок достижим, и тогда часть отчётов
 * теряется — это осознанная плата, записанная здесь явно.
 */
const LOG_PREFIX = 'lk:log:';
const LOG_WINDOW_SEC = 600;
const LOG_BUDGET_DEFAULT = 60;

/**
 * Ось 2 — ключ, ЛЮБОЙ исход.
 *
 * Это не защита от перебора, а детектор ШАРИНГА, строить который до сих пор
 * было не на чем: один ключ, ходящий с двадцати машин, виден только косвенно
 * через payload_issues. Отказа здесь нет и быть не должно — отказ ломал бы
 * легитимный сброс привязки и переезд на новое железо.
 */
const SEEN_HWID_PREFIX = 'lk:seen:hwid:';
const SEEN_NET_PREFIX = 'lk:seen:net:';
const SEEN_WINDOW_SEC = 3600;
const SEEN_HWID_THRESHOLD_DEFAULT = 3;
const SEEN_NET_THRESHOLD_DEFAULT = 5;

/**
 * Потолок мощности множеств оси 2.
 *
 * Множество живёт час и растёт от КЛИЕНТА: без потолка ключ, разошедшийся по
 * ботнету, занимает в Redis столько памяти, сколько противник захочет, а
 * политика allkeys-lru начнёт вытеснять чужие полезные записи. Событие
 * антифрода срабатывает на порогах 3 и 5, то есть задолго до потолка, —
 * после него множество не несёт новой информации и просто перестаёт расти.
 */
const SEEN_SET_CAP = 64;

@Injectable()
export class LicenseKeyService {
  private readonly logger = new Logger(LicenseKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Ключ → лицензия для горячего пути (license/check и payload).
   *
   * Проверку «лицензия принадлежит кому-то» этот метод сознательно НЕ делает
   * и наружу отдаёт лицензию с userId любого вида. Причина — журнал: все
   * отказы по лицензии пишутся вызывающим с licenseId, а он появляется только
   * после возврата отсюда. Бросив LICENSE_NOT_ASSIGNED здесь, мы получили бы
   * строку журнала с NULL в license_id — ровно тот дефект, ради которого
   * заводился LauncherResolveTrace.
   *
   * @param reply нужен ровно для заголовка Retry-After при 503 по порогу
   *        источника. Там, где ответа под рукой нет (приём логов), порог
   *        не бросается вовсе — у /logs свой бюджет и своё поведение.
   */
  async resolve(params: {
    licenseKey: string;
    productId: string;
    diskId: string;
    source: LicenseKeySource;
    reply?: FastifyReply;
  }): Promise<LicenseForLauncher> {
    const key = this.crypto.normalizeLicenseKey(params.licenseKey);
    const alias = this.crypto.hashLicenseKey(key);

    // Порог источника проверяется ПЕРВЫМ: он и существует затем, чтобы
    // отсечь сканер до Postgres, а не после.
    await this.assertSourceUnderThreshold(params.source, params.reply);

    if (await this.isKnownBad(alias)) {
      // Псевдоним кладётся в множество и здесь: повтор той же догадки не
      // должен обходить учёт сменой пути. На бюджете это не сказывается —
      // множество РАЗЛИЧНЫХ значений, повтор просто не меняет его размера.
      await this.noteFailure(params.source, alias);
      throw this.invalidKey();
    }

    const license = await this.prisma.license.findUnique({
      where: { key },
      include: { plan: { select: { name: true } }, currentDevice: true },
    });

    if (!license) {
      await this.rememberBad(alias);
      await this.noteFailure(params.source, alias);
      throw this.invalidKey();
    }

    if (license.productId !== params.productId) {
      // В отрицательный кэш это НЕ кладётся: ключ существует и живой, просто
      // назван не тот продукт. Иначе человек с двумя продуктами, один раз
      // промахнувшийся слагом, на минуту терял бы работающий ключ.
      // Ответ клиенту при этом тот же 404 — различать наружу нечего.
      await this.noteFailure(params.source, alias);
      throw this.invalidKey();
    }

    // Ось 2 считается по РАЗРЕШЁННОМУ ключу и ни на что не влияет: пишет
    // событие и молчит. Best-effort целиком — детектор шаринга не имеет
    // права отказать в запуске.
    await this.noteSeen(alias, license.id, params.diskId, params.source);

    // Ось 1б — тоже по разрешённому ключу и тоже без отказа. Стоит ПОСЛЕ
    // проверки продукта: «разрешён» здесь означает полный успех, а ключ
    // от чужого продукта уже учтён выше как промах.
    await this.noteSourceKey(alias, license.id, params.source);

    return license;
  }

  /**
   * Ключ → лицензия для приёма логов. НИКОГДА не бросает.
   *
   * Отдельный метод, а не флаг у resolve(), потому что различий три и все
   * содержательные: здесь нет продукта (лог приходит от загрузчика, который
   * мог не дойти даже до выбора продукта), нет отказа (ответ всегда 202) и
   * нет оси 2 (Disk ID в теле лога отсутствует по контракту — журнал читают
   * люди).
   *
   * ОСЬ 1 ЗДЕСЬ НЕ ТРОГАЕТСЯ ВОВСЕ — ни порогом, ни учётом промаха, и это
   * главное свойство метода. Прежняя схема «промах считаем, порог не
   * применяем» давала ровно то, что должна была предотвратить:
   *
   *   — прощупывание мимо порога: порога нет, значит findUnique по
   *     licenses.key делался на каждый запрос бесконечно;
   *   — оракул: единственным наблюдаемым следствием исхода оставался общий
   *     с /license/check счётчик. Кандидат гнался в /logs (всегда 202), а
   *     затем своим рабочим ключом в /license/check — наступивший отказ по
   *     порогу означал «кандидата нет», ненаступивший — «кандидат жив».
   *     Продукт при этом знать не требовалось: здесь нет фильтра по
   *     productId, то есть оракул отвечал на «ключ жив вообще»;
   *   — усилитель: десять запросов в /logs с мусорным ключом клали
   *     /license/check и /payload всем, кто за тем же адресом.
   *
   * Расход теперь один и тот же при любом исходе и списывается ДО вызова,
   * в admitLog(). Наблюдать за ним снаружи нечего.
   *
   * Источника в сигнатуре БОЛЬШЕ НЕТ намеренно: пока он был, любая правка
   * могла снова связать приём логов с осями горячего пути и вернуть оракул.
   * Всё, что касается источника на этом пути, живёт в admitLog().
   *
   * Вызывать ТОЛЬКО после положительного admitLog().
   */
  async resolveForLog(
    licenseKey: string,
  ): Promise<{ id: string; userId: string | null; currentDeviceId: string | null } | null> {
    try {
      const key = this.crypto.normalizeLicenseKey(licenseKey);
      const alias = this.crypto.hashLicenseKey(key);

      if (await this.isKnownBad(alias)) return null;

      const license = await this.prisma.license.findUnique({
        where: { key },
        select: { id: true, userId: true, currentDeviceId: true },
      });

      if (!license) {
        // Отрицательный кэш заполняется и отсюда: он не зависит от исхода
        // наблюдаемым образом (промах кэша и попадание одинаково дают 202)
        // и экономит Postgres на повторе той же догадки.
        await this.rememberBad(alias);
        return null;
      }

      return license;
    } catch (error) {
      // Любой сбой — это NULL в трёх колонках, а не потерянный отчёт.
      this.logger.warn(
        `ключ лицензии в отчёте загрузчика не разрешён: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  // =========================================================================
  //  ОСЬ 1 — ИСТОЧНИК
  // =========================================================================

  /**
   * Отказ источнику, предъявившему слишком много РАЗЛИЧНЫХ нераспознанных
   * ключей.
   *
   * Fail-open при недоступности Redis: счётчик — инструмент наблюдения,
   * а не рубеж безопасности (перебор невозможен арифметически), и терять
   * из-за него доступ у всех нельзя. Внешний рубеж по IP — зоны nginx
   * launcher_zone и payload_zone — при этом продолжает работать.
   *
   * ПОЧЕМУ 503 SERVICE_UNAVAILABLE, А НЕ 429 RATE_LIMITED. По приложению Б
   * ТЗ и таблице §6.1 клиент 429 не повторяет: это терминальный экран,
   * из которого пользователь сам не выходит. Ось у порога фактически одна —
   * IP (apiKeyId один на всю сборку, см. SignatureGuard), то есть за CGNAT
   * мобильного оператора или в общежитии отказ достаётся не тому, кто его
   * набрал, и достаётся ПРАВИЛЬНОМУ ключу тоже — проверка стоит до
   * разрешения. Терминальный экран у невиновного — ровно то, из-за чего
   * проект уже дважды поменял 429 на 503: зона payload_zone в nginx
   * (limit_req_status 503) и PayloadAdmissionService. Повторять то, что
   * дважды отвергнуто в этом же модуле, оснований нет.
   *
   * 503 клиент повторяет с экспоненциальной задержкой и не позднее
   * Retry-After — сканер этим ничего не выигрывает (порог остаётся, окно
   * не сдвигается), а честный сосед по NAT выходит из состояния сам.
   * Отдельного кода не заводится намеренно: SERVICE_UNAVAILABLE уже есть
   * в контракте (приложение Б и @json503 в nginx отдают ровно его), и
   * C++-клиенту не нужна новая ветка.
   */
  private async assertSourceUnderThreshold(
    source: LicenseKeySource,
    reply?: FastifyReply,
  ): Promise<void> {
    const key = this.failKey(source);
    if (key === null) return;

    const threshold = await this.limit(
      'limits.license_key.fail_per_source_per_window',
      FAIL_THRESHOLD_DEFAULT,
    );

    let distinct: number;
    let ttl: number;
    try {
      const [size, seconds] = await Promise.all([
        this.redis.client.scard(key),
        this.redis.client.ttl(key),
      ]);
      distinct = size;
      // seconds === -1 означает ключ БЕЗ СРОКА — окно, которое не истечёт
      // никогда. Такое состояние возможно при обрыве между записью и
      // EXPIRE, и раньше оно было вечным: читатель подставлял сюда
      // FAIL_WINDOW_SEC и отдавал честный на вид Retry-After: 600, который
      // не наступал, а вытеснения по LRU при maxmemory 64mb можно ждать
      // годами. Чиним прямо на чтении — дефект переживает один запрос,
      // а не до ручного DEL.
      if (seconds === -1 && distinct > 0) {
        await this.redis.client.expire(key, FAIL_WINDOW_SEC);
        ttl = FAIL_WINDOW_SEC;
      } else {
        ttl = seconds > 0 ? seconds : FAIL_WINDOW_SEC;
      }
    } catch (error) {
      this.logger.warn(
        `множество промахов по ключу не прочитано, Redis недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (distinct < threshold) return;

    if (reply) void reply.header('Retry-After', String(ttl));
    throw new ServiceUnavailableException({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Сервис временно недоступен, повторите попытку позже.',
    });
  }

  /**
   * Учёт промаха и событие ровно на пересечении порога.
   *
   * Считаются РАЗЛИЧНЫЕ псевдонимы: повтор одной догадки размера множества
   * не меняет, поэтому цикл опечаток у человека стоит одного элемента,
   * сколько бы раз он ни нажал «повторить», а сканер по списку тратит
   * элемент на каждую догадку.
   *
   * Событие пишется ровно на пересечении: размер, равный порогу, увидит
   * РОВНО один запрос (SADD атомарен и вернул 1 только тому, кто добавил).
   * Без этого поток событий забил бы таблицу антифрода со скоростью сканера.
   */
  private async noteFailure(source: LicenseKeySource, alias: string): Promise<void> {
    const key = this.failKey(source);
    if (key === null) return;

    const threshold = await this.limit(
      'limits.license_key.fail_per_source_per_window',
      FAIL_THRESHOLD_DEFAULT,
    );

    const size = await this.addDistinct(key, alias, FAIL_WINDOW_SEC, 'множество промахов по ключу');
    if (size !== threshold) return;

    await this.recordFraud(AntiFraudType.RATE_LIMIT_EXCEEDED, AntiFraudSeverity.HIGH, source, {
      endpoint: 'launcher',
      reason: 'license_key_probing',
      distinct: size,
      threshold,
      windowSec: FAIL_WINDOW_SEC,
    });
  }

  /**
   * Ось 1б: различные РАЗРЕШЁННЫЕ ключи с одного источника. Не отказывает
   * никогда — только пишет событие на пересечении порога.
   */
  private async noteSourceKey(
    alias: string,
    licenseId: string,
    source: LicenseKeySource,
  ): Promise<void> {
    const key = this.sourceKeysKey(source);
    if (key === null) return;

    const threshold = await this.limit(
      'limits.license_key.distinct_key_per_source_per_hour',
      SRC_KEYS_THRESHOLD_DEFAULT,
    );

    const size = await this.addDistinct(
      key,
      alias,
      SRC_KEYS_WINDOW_SEC,
      'множество живых ключей источника',
    );
    // threshold + 1, как у оси 2, а не threshold, как у оси 1: у отказывающей
    // оси событие пишется в момент отказа, у наблюдающей — когда порог
    // ПРЕВЫШЕН. Ровно одно значение размера увидит ровно один запрос,
    // поэтому событие пишется однократно.
    if (size !== threshold + 1) return;

    await this.recordFraud(
      AntiFraudType.RATE_LIMIT_EXCEEDED,
      AntiFraudSeverity.MEDIUM,
      source,
      {
        endpoint: 'launcher',
        reason: 'distinct_live_keys_per_source',
        distinct: size,
        threshold,
        windowSec: SRC_KEYS_WINDOW_SEC,
      },
      licenseId,
    );
  }

  /**
   * Списание бюджета приёма отчётов. true — обслуживаем, false — молча
   * отбрасываем (ответ всё равно 202).
   *
   * Расход НЕ ЗАВИСИТ ОТ ИСХОДА и списывается до всякой работы: в этом весь
   * смысл (см. LOG_PREFIX). Fail-open при недоступности Redis — приёмник
   * отчётов не должен переставать работать из-за кэша.
   */
  async admitLog(source: LicenseKeySource): Promise<boolean> {
    const key = this.logKey(source);
    // Нет оси — нет бюджета. Отдельного счётчика «все неизвестные» не
    // заводим по тем же соображениям, что и в failKey: он был бы общим
    // на всех и его выбивал бы кто угодно.
    if (key === null) return true;

    const budget = await this.limit(
      'limits.license_key.log_per_source_per_window',
      LOG_BUDGET_DEFAULT,
    );

    let count: number;
    try {
      count = await this.bumpWindow(key, LOG_WINDOW_SEC);
    } catch (error) {
      this.logger.warn(
        `бюджет приёма отчётов не списан, Redis недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }

    if (count <= budget) return true;

    // WARN, а не событие антифрода: превышение здесь чаще означает большой
    // NAT или зациклившийся загрузчик, а не злоупотребление, и строка в
    // anti_fraud_events на каждый такой запрос была бы ровно той записью
    // в базу, которую бюджет и предотвращает.
    if (count === budget + 1) {
      this.logger.warn(`бюджет приёма отчётов исчерпан источником ${key}, отчёты отбрасываются`);
    }

    return false;
  }

  /**
   * Имя счётчика промахов: ключ сборки И адрес.
   *
   * Без IP счётчик стал бы общим на всю сборку, то есть один сканер отключал
   * бы запуск всему парку. Без apiKeyId он смешивал бы разные сборки за одним
   * NAT. Нет адреса (или в нём мусор из подконтрольного клиенту заголовка) —
   * не считаем вовсе: считать «всех неизвестных» одним счётчиком значит
   * построить самострел ровно того вида, из-за которого успехи не считаются.
   */
  private failKey(source: LicenseKeySource): string | null {
    return this.sourceKey(FAIL_PREFIX, source);
  }

  /** Ось 1б. Своё пространство имён: пересечение с осью 1 вернуло бы оракул. */
  private sourceKeysKey(source: LicenseKeySource): string | null {
    return this.sourceKey(SRC_KEYS_PREFIX, source);
  }

  /**
   * Бюджет /logs. ОТДЕЛЬНОЕ пространство имён от оси 1 — не для порядка.
   *
   * Общее с /license/check состояние и есть тот самый оракул: наблюдаемое
   * снаружи следствие того, что происходило на /logs. Разные ключи Redis —
   * единственное, что делает эти два пути независимыми.
   */
  private logKey(source: LicenseKeySource): string | null {
    return this.sourceKey(LOG_PREFIX, source);
  }

  private sourceKey(prefix: string, source: LicenseKeySource): string | null {
    if (!source.apiKeyId) return null;
    if (!source.ip || isIP(source.ip) === 0) return null;
    return `${prefix}${source.apiKeyId}:${source.ip}`;
  }

  // =========================================================================
  //  ОСЬ 2 — КЛЮЧ
  // =========================================================================

  /** Оба множества считаются по ПСЕВДОНИМУ ключа: самого ключа в Redis нет нигде. */
  private async noteSeen(
    alias: string,
    licenseId: string,
    diskId: string,
    source: LicenseKeySource,
  ): Promise<void> {
    const hwidThreshold = await this.limit(
      'limits.license_key.distinct_hwid_per_hour',
      SEEN_HWID_THRESHOLD_DEFAULT,
    );
    const netThreshold = await this.limit(
      'limits.license_key.distinct_subnet_per_hour',
      SEEN_NET_THRESHOLD_DEFAULT,
    );

    // Хеш тот же, что в devices.hwid_hash: только при одинаковой функции
    // сигнал соединяется с таблицей устройств при разборе.
    await this.trackDistinct({
      key: SEEN_HWID_PREFIX + alias,
      member: this.crypto.hashHwid(diskId),
      threshold: hwidThreshold,
      type: AntiFraudType.HWID_CHANGE,
      reason: 'distinct_hwid_per_key',
      licenseId,
      source,
    });

    const subnet = this.subnetOf(source.ip);
    if (subnet === null) return;

    await this.trackDistinct({
      key: SEEN_NET_PREFIX + alias,
      member: subnet,
      threshold: netThreshold,
      type: AntiFraudType.CONCURRENT_SESSIONS,
      reason: 'distinct_subnet_per_key',
      licenseId,
      source,
    });
  }

  private async trackDistinct(params: {
    key: string;
    member: string;
    threshold: number;
    type: AntiFraudType;
    reason: string;
    licenseId: string;
    source: LicenseKeySource;
  }): Promise<void> {
    const size = await this.addDistinct(
      params.key,
      params.member,
      SEEN_WINDOW_SEC,
      'детектор шаринга ключа',
    );

    if (size !== params.threshold + 1) return;

    await this.recordFraud(
      params.type,
      AntiFraudSeverity.MEDIUM,
      params.source,
      {
        endpoint: 'launcher',
        reason: params.reason,
        distinct: size,
        threshold: params.threshold,
        windowSec: SEEN_WINDOW_SEC,
      },
      params.licenseId,
    );
  }

  /**
   * Подсеть источника.
   *
   * /24 для IPv4 и /64 для IPv6 — привычные границы одного провайдерского
   * или домашнего сегмента. Значение служит ЯРЛЫКОМ множества, а не
   * маршрутной информацией, поэтому сжатая запись IPv6 (::1) даёт свой
   * ярлык и никого не смешивает.
   */
  private subnetOf(ip: string | null): string | null {
    if (!ip) return null;

    const version = isIP(ip);
    if (version === 4) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
    if (version === 6) return `${ip.split(':').slice(0, 4).join(':')}::/64`;
    return null;
  }

  // =========================================================================
  //  ВСПОМОГАТЕЛЬНОЕ
  // =========================================================================

  /**
   * Добавление элемента в множество с окном. Возвращает НОВЫЙ размер или
   * null, если элемент уже был (тогда не изменилось ничего и звать по этому
   * поводу больше нечего).
   *
   * ОКНО СОЗДАЁТСЯ ДВУМЯ КОМАНДАМИ, И ЭТО ЛЕЧИТСЯ ЗДЕСЬ, А НЕ ИГНОРИРУЕТСЯ.
   * SADD и EXPIRE атомарной парой не являются: обрыв соединения, таймаут,
   * failover Redis или падение воркера между ними оставляли множество БЕЗ
   * СРОКА — навсегда. Это уже описанный дефект №26 для payload:rate:
   * (docs/LIVE-RUN-AUDIT.md), и на осях источника он хуже: залипает не одна
   * лицензия, а весь сегмент за адресом, причём сразу на /license/check
   * и /payload. Вытеснения ждать бессмысленно — allkeys-lru при maxmemory
   * 64mb и десятках килобайт данных не наступает практически никогда.
   *
   * Поэтому срок ставится не только при size === 1, но и всякий раз, когда
   * его фактически нет (TTL = -1). Каждый следующий добавляющий запрос
   * чинит окно за предыдущий; читающая сторона (assertSourceUnderThreshold)
   * делает то же самое со своей стороны. Пары «атомарная запись + атомарный
   * срок» в Redis для множеств нет вовсе, а Lua ради этого — лишняя
   * поверхность там, где хватает самовосстановления.
   *
   * Fail-open: любой сбой Redis — это null, то есть «ничего не знаем».
   */
  private async addDistinct(
    key: string,
    member: string,
    windowSec: number,
    what: string,
  ): Promise<number | null> {
    try {
      const added = await this.redis.client.sadd(key, member);
      // Значение уже в множестве — ни размер, ни срок не изменились.
      // Это подавляющее большинство запросов: одна машина, один ключ.
      if (added === 0) return null;

      const [size, ttl] = await Promise.all([
        this.redis.client.scard(key),
        this.redis.client.ttl(key),
      ]);

      if (size === 1 || ttl === -1) await this.redis.client.expire(key, windowSec);

      if (size >= SEEN_SET_CAP) {
        // Снимаем только что добавленный элемент: множество остаётся
        // ограниченным, а порог давно пройден и событие уже записано.
        await this.redis.client.srem(key, member);
      }

      return size;
    } catch (error) {
      this.logger.warn(
        `${what} пропущен, Redis недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Счётчик с окном. Возвращает значение ПОСЛЕ инкремента.
   *
   * SET ... EX ... NX создаёт значение И срок ОДНОЙ командой — это и есть
   * правка из дефекта №26. INCR берётся только когда ключ уже существует,
   * то есть срок у него уже проставлен. Остаётся одна щель: ключ истёк
   * между SET NX и INCR, и тогда INCR создаёт его заново без срока —
   * ловится проверкой count === 1.
   *
   * Бросает наружу: вызывающий сам решает, что значит недоступность Redis
   * для его бюджета (везде здесь — fail-open).
   */
  private async bumpWindow(key: string, windowSec: number): Promise<number> {
    const created = await this.redis.client.set(key, '1', 'EX', windowSec, 'NX');
    if (created === 'OK') return 1;

    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSec);
    return count;
  }

  private async isKnownBad(alias: string): Promise<boolean> {
    try {
      return (await this.redis.client.exists(BAD_KEY_PREFIX + alias)) === 1;
    } catch {
      // Промах кэша дешевле отказа: идём в Postgres.
      return false;
    }
  }

  private async rememberBad(alias: string): Promise<void> {
    try {
      await this.redis.client.set(BAD_KEY_PREFIX + alias, '1', 'EX', BAD_KEY_TTL_SEC);
    } catch {
      // Отрицательный кэш — оптимизация, а не условие корректности.
    }
  }

  /**
   * ОДИН код на всё нераспознанное.
   *
   * Неизвестный ключ, ключ чужого продукта, синтаксически валидный мусор —
   * 404 LICENSE_KEY_INVALID, одинаково и с одинаковым текстом. Любое различие
   * здесь превращает эндпоинт в проверятор утёкших выгрузок.
   *
   * 404, а не 403: по приложению Б клиент повторяет 403 не так, как 404,
   * а «ключа не существует» — это именно «не найдено». Детальные коды
   * LICENSE_EXPIRED / BLOCKED / REVOKED остаются за разрешёнными ключами.
   */
  private invalidKey(): NotFoundException {
    return new NotFoundException({
      code: 'LICENSE_KEY_INVALID',
      message: 'Ключ лицензии не найден. Проверьте ключ в личном кабинете.',
    });
  }

  /** Порог из настроек. Недоступность БД не должна ронять горячий путь. */
  private async limit(key: string, fallback: number): Promise<number> {
    try {
      const value = await this.settings.getNumber(key, fallback);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch (error) {
      this.logger.warn(
        `настройка ${key} не прочитана, работаем по умолчанию ${fallback}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }

  /**
   * Событие антифрода — всегда best-effort.
   *
   * userId не заполняется НИКОГДА: на этом пути пользователя ещё нет, а
   * колонка nullable изначально. Сам ключ лицензии в details не попадает
   * ни при каких условиях — только licenseId, если лицензия уже разрешена.
   */
  private async recordFraud(
    type: AntiFraudType,
    severity: AntiFraudSeverity,
    source: LicenseKeySource,
    details: Record<string, string | number | boolean>,
    licenseId?: string,
  ): Promise<void> {
    try {
      await this.prisma.antiFraudEvent.create({
        data: {
          id: uuidv7(),
          type,
          severity,
          licenseId: licenseId ?? null,
          // Колонка типа inet: мусор из подконтрольного клиенту заголовка
          // уронил бы запись на 22P02, то есть противник, шлющий кривой
          // X-Forwarded-For, отключал бы себе антифрод одной строкой.
          ip: source.ip !== null && isIP(source.ip) !== 0 ? source.ip : null,
          details: { ...details, apiKeyId: source.apiKeyId ?? null },
          actionTaken: 'logged_only',
        },
      });
    } catch (error) {
      this.logger.error(
        `не удалось записать событие антифрода: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
