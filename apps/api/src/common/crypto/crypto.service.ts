import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdf,
  randomBytes,
  timingSafeEqual,
  webcrypto,
} from 'node:crypto';
import { promisify } from 'node:util';
import { ENV, parseRetiredKeys, type Env } from '../config/env.schema';

/**
 * Шифрование полей БД: AES-256-GCM с версионированным ключом.
 *
 * Формат хранимого значения:
 *
 *     v<версия>.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 *
 * Самоописывающийся: по строке видно, каким ключом её расшифровывать,
 * и не нужна отдельная колонка на каждое поле — хотя версия дублируется
 * в *_key_ver для того, чтобы фоновая перешифровка могла выбирать записи
 * запросом, а не разбором строк.
 */

/** Длина IV для GCM. 96 бит — размер, для которого GCM спроектирован. */
const IV_LENGTH = 12;
/** Длина тега аутентификации. 128 бит — максимум и единственный разумный выбор. */
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_PREFIX = 'v';
/** Длина ключа AES-256 и одновременно L у HKDF. */
const KEY_LENGTH = 32;

/**
 * Домен схемы выдачи payload'а: info у HKDF и первая строка AAD — ОДНА
 * константа, а не два одинаковых литерала. Клиент собирает обе строки
 * самостоятельно, и разъехавшиеся между собой домены дадут не ошибку
 * конфигурации, а провал GCM-тега без единого признака причины.
 */
const PAYLOAD_DOMAIN = 'lp/payload/v1';
const PAYLOAD_HKDF_INFO = Buffer.from(PAYLOAD_DOMAIN, 'ascii');

/**
 * Разделитель полей AAD — ровно тот же ОДИН 0x0A, что в каноне подписи
 * (SignatureService.buildPayload). Второе соглашение о канонических строках
 * рядом с уже оттестированным на C++ означало бы вторую поверхность
 * для расхождения.
 */
const AAD_SEPARATOR = '\n';

/**
 * Метка домена для pepper'а, которым ключ лицензии превращается в псевдоним.
 *
 * Pepper ВЫВОДИТСЯ из HWID_PEPPER, а не заводится отдельной переменной
 * окружения, по двум причинам. Первая: новая обязательная переменная — это
 * остановленный деплой у всех, кто выкатит код раньше, чем обновит окружение,
 * ради значения, которое ниоткуда, кроме нас, не приходит. Вторая: HWID_PEPPER
 * уже объявлен неизменяемым после запуска в прод, то есть псевдонимы переживут
 * ротацию ENCRYPTION_KEY и счётчики антифрода не обнулятся на ровном месте.
 *
 * Разделение доменов обеспечивает сама метка: HMAC(HWID_PEPPER, метка)
 * необратим, поэтому знание псевдонима ключа лицензии не даёт вычислить ни
 * один hwid_hash и наоборот.
 */
const LICENSE_KEY_PEPPER_LABEL = 'lp/license-key-alias/v1';

/** sessionKey на проводе: 32 байта, ровно 64 hex НИЖНЕГО регистра (§7 DTO). */
const SESSION_KEY_RE = /^[0-9a-f]{64}$/;
/** Канонический вид полей AAD. Верхний регистр и пробелы не допускаются. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const PAYLOAD_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;
const PRODUCT_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * hkdf отдаёт ArrayBuffer через колбэк. Тип задаётся явно, потому что
 * промисифицированная перегрузка выводится не всегда, а молча получить
 * `[object ArrayBuffer]` вместо ключа — ровно тот класс ошибки, который
 * потом ищут в C++.
 */
const hkdfAsync = promisify(hkdf) as (
  digest: string,
  ikm: Buffer,
  salt: Buffer,
  info: Buffer,
  keylen: number,
) => Promise<ArrayBuffer>;

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);

  /** Все известные ключи: текущий плюс выведенные из обращения. */
  private readonly keyRing = new Map<number, Buffer>();
  private readonly currentVersion: number;
  private readonly hwidPepper: Buffer;
  private readonly licenseKeyPepper: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.currentVersion = env.ENCRYPTION_KEY_VERSION;
    this.keyRing.set(this.currentVersion, Buffer.from(env.ENCRYPTION_KEY, 'hex'));

    if (env.ENCRYPTION_KEYS_RETIRED) {
      for (const [version, key] of parseRetiredKeys(env.ENCRYPTION_KEYS_RETIRED)) {
        this.keyRing.set(version, Buffer.from(key, 'hex'));
      }
    }

    this.hwidPepper = Buffer.from(env.HWID_PEPPER, 'hex');
    this.licenseKeyPepper = createHmac('sha256', this.hwidPepper)
      .update(LICENSE_KEY_PEPPER_LABEL, 'ascii')
      .digest();

    this.logger.log(
      `ключей в связке: ${this.keyRing.size}, текущая версия: ${this.currentVersion}`,
    );
  }

  get keyVersion(): number {
    return this.currentVersion;
  }

  /**
   * Шифрует значение текущим ключом.
   *
   * @param plaintext значение в открытом виде
   * @param context   привязка к месту хранения — см. buildAad(). Обязателен:
   *                  без него зашифрованное значение можно перенести
   *                  в чужую строку, и оно расшифруется.
   */
  encrypt(plaintext: string, context: EncryptionContext): string {
    const key = this.keyRing.get(this.currentVersion);
    if (!key) {
      throw new InternalServerErrorException('текущий ключ шифрования не найден в связке');
    }

    // Новый случайный IV на каждое шифрование. Повтор IV с тем же ключом
    // в GCM раскрывает ключ аутентификации — это не «слабое место»,
    // а полная потеря стойкости.
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    cipher.setAAD(this.buildAad(context));

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      `${ENVELOPE_PREFIX}${this.currentVersion}`,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Расшифровывает значение любым ключом из связки.
   *
   * Бросает, если значение подменено: тег GCM не сойдётся. Это и есть
   * главное преимущество перед CBC — подмена обнаруживается, а не выдаёт
   * правдоподобный мусор.
   */
  decrypt(envelope: string, context: EncryptionContext): string {
    const parts = envelope.split('.');
    if (parts.length !== 4) {
      throw new InternalServerErrorException('повреждённый формат зашифрованного значения');
    }

    const [versionRaw, ivRaw, tagRaw, ciphertextRaw] = parts as [string, string, string, string];

    if (!versionRaw.startsWith(ENVELOPE_PREFIX)) {
      throw new InternalServerErrorException('повреждённый формат зашифрованного значения');
    }

    const version = Number(versionRaw.slice(ENVELOPE_PREFIX.length));
    const key = this.keyRing.get(version);
    if (!key) {
      // Ключ выкинули из конфигурации, а записи, зашифрованные им, остались.
      // Молча вернуть null нельзя: это выглядело бы как «у пользователя
      // не настроена 2FA», и второй фактор тихо отключился бы.
      throw new InternalServerErrorException(
        `ключ версии ${version} отсутствует в связке — верни его в ENCRYPTION_KEYS_RETIRED`,
      );
    }

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, 'base64url'), {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAAD(this.buildAad(context));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));

    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Сюда попадаем при подмене значения, подмене контекста или неверном
      // ключе. Подробности наружу не отдаём — они помогают атакующему
      // различать эти случаи.
      throw new InternalServerErrorException('не удалось расшифровать значение');
    }
  }

  /**
   * Нужна ли записи перешифровка. Используется фоновой задачей ротации
   * и точечно — при обращении к записи.
   */
  needsReencryption(envelope: string): boolean {
    const version = Number(envelope.split('.')[0]?.slice(ENVELOPE_PREFIX.length));
    return Number.isFinite(version) && version !== this.currentVersion;
  }

  /**
   * Хеш HWID: HMAC-SHA256(нормализованный Disk ID, HWID_PEPPER).
   *
   * Почему HMAC, а не голый SHA-256: серийный номер накопителя — короткая
   * строка с низкой энтропией, её хеш перебирается по словарю за копейки.
   * Pepper лежит в окружении, а не в БД, поэтому дамп базы сам по себе
   * не позволяет восстановить исходные идентификаторы.
   *
   * HWID_PEPPER нельзя менять после запуска в прод: все существующие
   * привязки станут несопоставимыми одновременно.
   */
  hashHwid(diskId: string): string {
    const normalized = this.normalizeDiskId(diskId);
    if (normalized.length === 0) {
      throw new InternalServerErrorException('пустой Disk ID');
    }

    return createHmac('sha256', this.hwidPepper).update(normalized, 'utf8').digest('hex');
  }

  /**
   * Псевдоним ключа лицензии: HMAC-SHA256(нормализованный ключ, pepper).
   *
   * Нужен ровно для одного: класть в ИМЕНА ключей Redis (счётчики промахов,
   * отрицательный кэш, детектор шаринга) вместо самого ключа лицензии.
   * Ключ лицензии — предъявительский документ, а Redis работает с
   * appendonly yes: каждый SET дописывается в AOF, и срок жизни такой утечки
   * равен сроку жизни файла AOF и его бэкапов, а не TTL записи. Ровно на этом
   * уже обожглись с кэшем секретов подписи (signature.guard.ts).
   *
   * Псевдоним детерминирован, поэтому счётчик по ключу продолжает считаться
   * между процессами и перезапусками; обратимости нет — pepper в окружении.
   */
  hashLicenseKey(licenseKey: string): string {
    const normalized = this.normalizeLicenseKey(licenseKey);
    if (normalized.length === 0) {
      throw new InternalServerErrorException('пустой ключ лицензии');
    }

    return createHmac('sha256', this.licenseKeyPepper).update(normalized, 'utf8').digest('hex');
  }

  /**
   * Канонический вид ключа лицензии.
   *
   * Ключ человек переносит руками из личного кабинета: копия приезжает
   * с хвостовым пробелом, из мессенджера — в нижнем регистре, из PDF —
   * с неразрывным пробелом внутри. Все эти варианты обязаны означать одну
   * лицензию, иначе поддержка будет разбирать «ключ не подходит» вместо
   * настоящих проблем.
   *
   * Нормализация — СЕРВЕРНАЯ и на подпись не влияет: SignatureGuard считает
   * HMAC по сырым байтам тела, до разбора JSON.
   */
  normalizeLicenseKey(licenseKey: string): string {
    return licenseKey.trim().replace(/\s+/g, '').toUpperCase();
  }

  /**
   * Приведение Disk ID к каноническому виду до хеширования.
   *
   * Загрузчик читает серийник через DeviceIoControl, и в зависимости от
   * контроллера тот приходит с разным регистром и хвостовыми пробелами.
   * Без нормализации одна и та же машина после обновления драйвера даст
   * другой хеш, и пользователь получит «устройство не совпадает».
   */
  normalizeDiskId(diskId: string): string {
    return diskId.trim().replace(/\s+/g, '').toUpperCase();
  }

  /**
   * Сравнение секретов за постоянное время.
   *
   * Обычное === выходит на первом различающемся байте, и по времени ответа
   * секрет восстанавливается побайтово. Для токенов и подписей это
   * практическая атака, а не теоретическая.
   */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    // timingSafeEqual требует одинаковой длины и сам по себе её раскрывает.
    // Длина секрета не тайна, а вот содержимое — да.
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Выдача payload'а: эфемерный ключ на один ответ
  //
  // Ключ AES-256 выводится HKDF-SHA256 (RFC 5869) из клиентского sessionKey,
  // солью служит IV, сгенерированный СЕРВЕРОМ и уезжающий в X-Payload-Nonce.
  // Схема зафиксирована контрактом; ниже записано, что она даёт НА САМОМ ДЕЛЕ,
  // потому что приукрашенное обоснование потом становится основанием
  // не чинить настоящую дыру.
  //
  // 1. Повтор пары (ключ, IV) исключает СЕРВЕРНАЯ генерация IV, а не выбор
  //    соли. При любой соли — хоть IV, хоть фиксированной константе — пара
  //    повторяется тогда и только тогда, когда повторяется IV; условие одно
  //    и то же, порог тот же (парадокс дней рождения на 96 битах). Поэтому
  //    «salt = IV конструктивно исключает повтор у сломанного клиента» —
  //    неверное утверждение, и опираться на него нельзя. Единственная
  //    работающая реакция на клиента, переиспользующего sessionKey, — отказ
  //    (400 SESSION_KEY_REUSED), а не надежда на KDF.
  //    У salt = IV есть и обратная сторона: ключ и нонс выводятся из ОДНОГО
  //    вызова randomBytes(12). Повтор IV (восстановление контейнера из снимка
  //    памяти, клонирование инстанса с уже засеянным ГПСЧ, форк после засева)
  //    даёт одновременно и тот же ключ, И тот же нонс — худший из возможных
  //    исходов, тогда как при независимой соли тот же повтор дал бы РАЗНЫЕ
  //    ключи и катастрофы не было бы. Схема оставлена (RFC-корректна, соль
  //    уже на проводе, новых заголовков не требует), но запрет на подъём api
  //    из снапшота памяти — эксплуатационное требование, а не пожелание.
  //
  // 2. AAD НЕ защищает от противника, терминирующего TLS. Такой противник
  //    читает sessionKey прямо из тела запроса, выводит тот же ключ по
  //    публичной спецификации и переподписывает ответ целиком вместе со всеми
  //    заголовками. Класса противника, который меняет заголовки ответа, но не
  //    видит тела запроса, в этой схеме не существует — запрос и ответ едут по
  //    одному соединению. AAD оставлен потому, что стоит одну конкатенацию и
  //    ловит реальное: наше собственное рассогласование заголовков и тела плюс
  //    разделение доменов. Целостность payload'а против владельца машины не
  //    обеспечивается ничем — ни AAD, ни sha256, ни подписью (секрет подписи
  //    извлекаем из бинарника). Это отдельная задача с зашитым в бинарник
  //    асимметричным ключом, и считать её закрытой нельзя.
  //
  // 3. X-Request-Id в AAD НЕ входит: инвариант «покрыт каждый X-Payload-*»
  //    соблюдён буквально, но диагностический идентификатор остаётся
  //    подменяемым, и ссылаться на присланный клиентом requestId как на
  //    доверенный номер инцидента нельзя.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Единственный источник И заголовков успешного ответа, И AAD.
   *
   * Возвращает одно и другое из ОДНОГО выражения намеренно. Если собрать
   * заголовки и AAD двумя независимыми обращениями к полям сборки, то любое
   * расхождение — хвостовой пробел в version из копипаста в админке, hex
   * в верхнем регистре, BigInt, сериализованный иначе, — даёт провал GCM-тега
   * на 100% запросов к этой сборке при чистых 200 в наших логах. Отличить это
   * от подмены нечем, а отладка сводится к двоичному поиску по двум
   * реализациям. Тот же приём уже кодифицирован на клиенте: Http.cpp:315-318
   * держит ОДИН литерал пути и для подписи, и для URL.
   *
   * Значения канонизируются (trim с обеих сторон, hex в нижний регистр, size
   * через BigInt) и тут же проверяются на канонический вид. Неканоничное
   * значение — наша авария публикации: лучше 500 с внятной строкой в логе,
   * чем молчаливый экран «повреждённые данные» у каждого пользователя.
   */
  buildPayloadBinding(fields: PayloadBindingFields): PayloadBinding {
    const productSlug = assertCanonical(
      'productSlug',
      String(fields.productSlug).trim(),
      PRODUCT_SLUG_RE,
    );
    const sha256 = assertCanonical(
      'sha256',
      String(fields.sha256).trim().toLowerCase(),
      SHA256_HEX_RE,
    );
    const version = assertCanonical('version', String(fields.version).trim(), PAYLOAD_VERSION_RE);

    // BigInt сам даёт десятичное без ведущих нулей и бросает на дробном
    // и на мусоре — отдельная регулярка здесь была бы второй проверкой
    // того же свойства.
    let size: string;
    try {
      const parsed = BigInt(fields.size);
      if (parsed <= 0n) {
        throw new Error('размер сборки должен быть положительным');
      }
      size = parsed.toString();
    } catch {
      throw new InternalServerErrorException(
        `неканоничное значение size для payload'а: ${JSON.stringify(String(fields.size))}`,
      );
    }

    return {
      headers: {
        'X-Payload-Sha256': sha256,
        'X-Payload-Size': size,
        'X-Payload-Version': version,
      },
      productSlug,
      // Ровно те же строки, что уехали в headers, — второго обращения
      // к полям сборки здесь нет и быть не должно.
      aad: Buffer.from(
        [PAYLOAD_DOMAIN, productSlug, sha256, size, version].join(AAD_SEPARATOR),
        'utf8',
      ),
    };
  }

  /**
   * HKDF-SHA256 (RFC 5869, Extract+Expand).
   *
   * Публичный, хотя на горячем пути зовётся только из derivePayloadKey:
   * опубликованные векторы RFC 5869 обязаны гонять ТУ ЖЕ функцию, что
   * работает в бою, а не её копию в тесте. Расхождение KDF между Node и C++
   * проявляется ИСКЛЮЧИТЕЛЬНО как провал GCM-тега — состояние без всякой
   * диагностики, и отдельно проверяемый KDF стоит дешевле, чем поиск
   * этого расхождения по двум реализациям.
   */
  async hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Promise<Buffer> {
    // hkdf отдаёт ArrayBuffer, а не Buffer — обёртка обязательна.
    return Buffer.from(await hkdfAsync('sha256', ikm, salt, info, length));
  }

  /**
   * Эфемерный ключ AES-256 для одного ответа payload'а.
   *
   *   IKM  = 32 байта sessionKey (hex из тела запроса)
   *   salt = IV, 12 байт, сгенерированные сервером
   *   info = ASCII "lp/payload/v1"
   *   L    = 32
   *
   * L = длине хеша выбрано в том числе ради того, чтобы Expand был РОВНО
   * одной итерацией: PRK = HMAC(IV, sessionKey), OKM = HMAC(PRK, info||0x01).
   * На C++ это два вызова готового HmacSha256 и ноль циклов — минимум мест,
   * где две реализации могут разойтись.
   */
  async derivePayloadKey(sessionKeyHex: string, iv: Buffer): Promise<Buffer> {
    // Регистр не нормализуем. Два допустимых представления одного ключа
    // однажды разъедутся в векторах и тестах, а DTO уже отбивает всё, кроме
    // нижнего: сюда неверное значение попадает только если проверку обошли,
    // то есть это наша ошибка, а не клиентская.
    if (!SESSION_KEY_RE.test(sessionKeyHex)) {
      throw new InternalServerErrorException(
        'sessionKey обязан быть 64 hex нижнего регистра — проверка DTO не сработала',
      );
    }
    if (iv.length !== IV_LENGTH) {
      throw new InternalServerErrorException(
        `соль HKDF обязана быть IV длиной ${IV_LENGTH} байт, получено ${iv.length}`,
      );
    }

    return this.hkdfSha256(Buffer.from(sessionKeyHex, 'hex'), iv, PAYLOAD_HKDF_INFO, KEY_LENGTH);
  }

  /**
   * Шифрование payload'а ключом, выведенным из sessionKey этого запроса.
   *
   * Асинхронный путь (webcrypto.subtle + crypto.hkdf), а не createCipheriv:
   * на потолке контракта в 8 МиБ синхронный cipher.update блокирует event
   * loop на единицы миллисекунд, и всплеск запусков складывается в сотни
   * миллисекунд заблокированного цикла — то есть в разрушение p99 всего API,
   * включая проверку лицензии с бюджетом 150 мс, которая идёт тем же
   * процессом. Проектируется под потолок, а не под сегодняшние 600 КБ.
   * Обратная сторона: subtle уходит на пул libuv, общий с @node-rs/argon2
   * из логина, — UV_THREADPOOL_SIZE обязателен и задан в docker-compose.
   */
  async sealForSession(
    plaintext: Buffer,
    sessionKeyHex: string,
    aad: Buffer,
  ): Promise<SealedPayload> {
    return this.sealForSessionWithIv(plaintext, sessionKeyHex, aad, randomBytes(IV_LENGTH));
  }

  /**
   * То же шифрование, но с IV, заданным СНАРУЖИ.
   *
   * Существует ради контрольных векторов: без фиксированного IV вектор
   * невоспроизводим, а вектор — единственный способ отладить расхождение
   * между Node и C++, потому что проявляется оно только провалом тега.
   * На горячем пути звать нельзя: IV обязан быть свежим на каждый ответ.
   * Повтор пары (ключ, IV) в GCM — не «ослабление», а полная потеря
   * стойкости вплоть до раскрытия ключа аутентификации.
   */
  async sealForSessionWithIv(
    plaintext: Buffer,
    sessionKeyHex: string,
    aad: Buffer,
    iv: Buffer,
  ): Promise<SealedPayload> {
    const key = await this.derivePayloadKey(sessionKeyHex, iv);

    const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);

    const sealed = Buffer.from(
      await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad, tagLength: TAG_LENGTH * 8 },
        cryptoKey,
        plaintext,
      ),
    );

    // subtle отдаёт ciphertext||tag одним буфером. subarray — вид на те же
    // байты, а не копия: на потолке контракта лишний Buffer.concat удвоил бы
    // пиковый расход ровно там, где память считают по байтам.
    return {
      iv,
      ciphertext: sealed.subarray(0, sealed.length - TAG_LENGTH),
      tag: sealed.subarray(sealed.length - TAG_LENGTH),
    };
  }

  /**
   * Дополнительные аутентифицируемые данные.
   *
   * Входят в проверку целостности, но не шифруются. Привязывают шифротекст
   * к конкретному месту: значение из users.two_factor_secret_enc одного
   * пользователя, перенесённое в строку другого, не расшифруется.
   */
  private buildAad(context: EncryptionContext): Buffer {
    return Buffer.from(`${context.table}.${context.column}:${context.rowId}`, 'utf8');
  }
}

/**
 * Проверка канонического вида поля, входящего и в заголовок, и в AAD.
 * Вынесена из метода, чтобы сообщение об ошибке было одинаковым для всех
 * полей: разбираться в нём будет тот, кто видит только строку в логе.
 */
function assertCanonical(field: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new InternalServerErrorException(
      `неканоничное значение ${field} для payload'а: ${JSON.stringify(value)} — ` +
        'выдача остановлена, потому что клиент получил бы провал тега без диагностики',
    );
  }
  return value;
}

/**
 * Поля выдаваемой сборки в том виде, в каком они лежат в БД.
 * Канонизацию делает buildPayloadBinding — вызывающему форматировать
 * их самостоятельно ЗАПРЕЩЕНО, иначе заголовки и AAD снова разъедутся.
 */
export interface PayloadBindingFields {
  /** Слаг продукта, как его прислал клиент (findUnique гарантирует совпадение). */
  productSlug: string;
  /** SHA-256 ОТКРЫТОГО содержимого, эталон из PayloadBuild.sha256. */
  sha256: string;
  /** Размер открытого текста. Prisma отдаёт BigInt. */
  size: bigint | number | string;
  /** Версия сборки payload'а, например 1.2.0. */
  version: string;
}

/** Заголовки и AAD, выведенные из одного выражения. */
export interface PayloadBinding {
  /** Ставится в ответ ровно как есть — второго форматирования быть не должно. */
  headers: {
    'X-Payload-Sha256': string;
    'X-Payload-Size': string;
    'X-Payload-Version': string;
  };
  /** Канонический слаг, вошедший в AAD. Заголовком не отдаётся: он у клиента свой. */
  productSlug: string;
  /** Байты AAD: поля через один 0x0A, без завершающего перевода строки. */
  aad: Buffer;
}

/** Результат шифрования payload'а. iv → X-Payload-Nonce, tag → X-Payload-Tag. */
export interface SealedPayload {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

/** Место хранения зашифрованного значения. Входит в AAD. */
export interface EncryptionContext {
  /** Таблица, например 'users'. */
  table: string;
  /** Колонка, например 'two_factor_secret_enc'. */
  column: string;
  /** Идентификатор строки-владельца. */
  rowId: string;
}
