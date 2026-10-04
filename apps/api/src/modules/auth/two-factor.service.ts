import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { generateSecret, generateSync, generateURI, verifySync } from 'otplib';
import { createHash, randomBytes } from 'node:crypto';

import { CryptoService } from '@common/crypto/crypto.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { PermissionsService } from '@common/rbac/permissions.service';

/**
 * Второй фактор по TOTP (RFC 6238) — стандарт Google Authenticator,
 * Authy, 1Password.
 *
 * SMS не используется намеренно: перехватывается подменой SIM, стоит денег
 * и требует договора с оператором. Приложение-аутентификатор бесплатно
 * и устойчиво к тому, от чего SMS не защищает.
 */

/** Название в приложении-аутентификаторе. */
const ISSUER = 'License Platform';

/**
 * Допуск в один шаг (±30 с) на расхождение часов.
 *
 * Больше брать нельзя: каждый лишний шаг линейно увеличивает окно, в котором
 * подходит перехваченный код. Монотонность last_step ниже делает этот допуск
 * безопасным — назад по шкале вернуться уже не получится.
 */
const EPOCH_TOLERANCE = 1;

/** Сколько кодов восстановления выдаётся при включении. */
const RECOVERY_CODE_COUNT = 10;
/** Байт случайности на код. 8 байт = 64 бита, перебору не поддаётся. */
const RECOVERY_CODE_BYTES = 8;

const ENC_COLUMN = 'two_factor_secret_enc';

/**
 * Номер временного шага из результата проверки.
 *
 * Тип результата у otplib — объединение TOTP- и HOTP-вариантов, и TypeScript
 * видит только общие для них поля. Мы всегда работаем в режиме TOTP
 * (стратегия по умолчанию), поэтому timeStep в ответе присутствует всегда,
 * но выразить это через типы библиотеки нельзя — отсюда сужение вручную.
 */
function timeStepOf(result: ReturnType<typeof verifySync>): number | null {
  if (!result.valid) return null;
  const step = (result as { timeStep?: unknown }).timeStep;
  return typeof step === 'number' ? step : null;
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly permissions: PermissionsService,
  ) {}

  // =========================================================================
  //  ПОДКЛЮЧЕНИЕ
  // =========================================================================

  /**
   * Шаг 1: выдать секрет и ссылку для сканирования.
   *
   * Второй фактор здесь ещё НЕ включается. Это принципиально: если включить
   * сразу, то человек, криво отсканировавший QR и закрывший страницу,
   * теряет доступ к аккаунту навсегда. Включение — отдельным шагом,
   * только после доказательства, что код читается.
   */
  async setup(userId: string, username: string): Promise<{ secret: string; uri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorConfirmedAt: true },
    });

    if (user.twoFactorEnabled && user.twoFactorConfirmedAt) {
      throw new BadRequestException({
        code: 'TWO_FACTOR_ALREADY_ENABLED',
        message: 'Двухфакторная аутентификация уже включена',
      });
    }

    const secret = generateSecret();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecretEnc: this.crypto.encrypt(secret, {
          table: 'users',
          column: ENC_COLUMN,
          rowId: userId,
        }),
        twoFactorSecretKeyVer: this.crypto.keyVersion,
        // Явно снимаем подтверждение: повторный setup обнуляет предыдущую
        // незавершённую попытку, чтобы не осталось «полуподключенного»
        // состояния со старым секретом.
        twoFactorConfirmedAt: null,
        twoFactorEnabled: false,
        twoFactorLastStep: null,
      },
    });

    return {
      secret,
      uri: generateURI({ issuer: ISSUER, label: username, secret }),
    };
  }

  /**
   * Шаг 2: подтвердить код и включить второй фактор.
   * Возвращает коды восстановления — единственный раз за всё время.
   */
  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const secret = await this.loadSecret(userId);

    const result = verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE });
    const step = timeStepOf(result);

    if (!result.valid || step === null) {
      throw new UnauthorizedException({
        code: 'TWO_FACTOR_INVALID',
        message: 'Неверный код',
      });
    }

    const codes = this.generateRecoveryCodes();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorConfirmedAt: new Date(),
        twoFactorLastStep: BigInt(step),
        twoFactorRecoveryCodes: codes.map((c) => this.hashRecoveryCode(c)),
      },
    });

    // Признак 2FA лежит в том же кэше, что и права (JwtAuthGuard), с TTL
    // пять минут. Без сброса админ, только что включивший второй фактор,
    // ещё пять минут получал бы TWO_FACTOR_SETUP_REQUIRED на каждое
    // действие — то есть отказ за то, что он уже сделал.
    await this.permissions.invalidate(userId);

    this.logger.log(`второй фактор включён для пользователя ${userId}`);
    return { recoveryCodes: codes };
  }

  /**
   * Отключение. Требует и пароль (проверяется вызывающим), и текущий код —
   * иначе перехваченная сессия снимает второй фактор одним запросом,
   * и весь смысл теряется.
   */
  async disable(userId: string, code: string): Promise<void> {
    await this.verify(userId, code);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorConfirmedAt: null,
        twoFactorSecretEnc: null,
        twoFactorSecretKeyVer: null,
        twoFactorLastStep: null,
        twoFactorRecoveryCodes: [],
      },
    });

    // Симметрично включению: иначе снявший 2FA админ ещё пять минут
    // выполнял бы административные действия без неё.
    await this.permissions.invalidate(userId);

    this.logger.log(`второй фактор отключён для пользователя ${userId}`);
  }

  // =========================================================================
  //  ПРОВЕРКА
  // =========================================================================

  /**
   * Проверка кода: сначала TOTP, при неудаче — код восстановления.
   *
   * Порядок именно такой: TOTP проверяется на порядок чаще, и уходить
   * в перебор десяти хешей на каждом обычном входе незачем.
   */
  async verify(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        twoFactorSecretEnc: true,
        twoFactorLastStep: true,
        twoFactorRecoveryCodes: true,
      },
    });

    if (!user.twoFactorSecretEnc) {
      throw new BadRequestException({
        code: 'TWO_FACTOR_NOT_SET_UP',
        message: 'Двухфакторная аутентификация не настроена',
      });
    }

    const secret = this.crypto.decrypt(user.twoFactorSecretEnc, {
      table: 'users',
      column: ENC_COLUMN,
      rowId: userId,
    });

    const normalized = code.replace(/[\s-]/g, '');

    // --- TOTP -------------------------------------------------------------
    if (/^\d{6}$/.test(normalized)) {
      const result = verifySync({
        secret,
        token: normalized,
        epochTolerance: EPOCH_TOLERANCE,
        // Главная защита от повтора: принимается только шаг СТРОГО больше
        // сохранённого. Без этого один код подходит все 30 секунд своего
        // окна, и подсмотренный через плечо или перехваченный код работает
        // повторно. С ним — код, который уже сработал, мёртв.
        afterTimeStep: user.twoFactorLastStep ? Number(user.twoFactorLastStep) : undefined,
      });

      const step = timeStepOf(result);
      if (result.valid && step !== null) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { twoFactorLastStep: BigInt(step) },
        });
        return;
      }
    }

    // --- Код восстановления ------------------------------------------------
    const hash = this.hashRecoveryCode(normalized);
    const index = user.twoFactorRecoveryCodes.indexOf(hash);

    if (index !== -1) {
      // Код одноразовый: вычёркиваем сразу. Условие на массив внутри
      // updateMany делает операцию атомарной — два параллельных запроса
      // с одним кодом не пройдут оба.
      const claimed = await this.prisma.user.updateMany({
        where: { id: userId, twoFactorRecoveryCodes: { has: hash } },
        data: {
          twoFactorRecoveryCodes: user.twoFactorRecoveryCodes.filter((_, i) => i !== index),
        },
      });

      if (claimed.count === 1) {
        const left = user.twoFactorRecoveryCodes.length - 1;
        this.logger.warn(`использован код восстановления, осталось ${left}`);
        return;
      }
    }

    throw new UnauthorizedException({ code: 'TWO_FACTOR_INVALID', message: 'Неверный код' });
  }

  /** Текущий код — только для тестов и отладки, наружу не выставляется. */
  generateCurrentCode(secret: string): string {
    return generateSync({ secret });
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  private async loadSecret(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorSecretEnc: true },
    });

    if (!user.twoFactorSecretEnc) {
      throw new BadRequestException({
        code: 'TWO_FACTOR_NOT_SET_UP',
        message: 'Сначала выполните настройку',
      });
    }

    return this.crypto.decrypt(user.twoFactorSecretEnc, {
      table: 'users',
      column: ENC_COLUMN,
      rowId: userId,
    });
  }

  /** Коды вида A1B2C3D4-E5F6G7H8: читаются вслух и переписываются от руки. */
  private generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const raw = randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase();
      codes.push(`${raw.slice(0, 8)}-${raw.slice(8)}`);
    }
    return codes;
  }

  /**
   * SHA-256, а не Argon2 — вопреки исходному комментарию в схеме.
   *
   * Код восстановления это 64 бита случайности, словарной атаки на него
   * не существует, а Argon2 при проверке десяти кодов дал бы около 700 мс
   * на запрос. Медленный хеш нужен там, где секрет выбирает человек.
   */
  private hashRecoveryCode(code: string): string {
    return createHash('sha256')
      .update(code.replace(/[\s-]/g, '').toUpperCase(), 'utf8')
      .digest('hex');
  }
}
