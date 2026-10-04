import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { OrderSource, Prisma, ProductStatus, UserStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { SettingsService } from '@common/settings/settings.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import type { LoginResult, RequestContext } from './auth.service';
import { AuthService } from './auth.service';

/**
 * Регистрация по ключу (ТЗ п.5). Ключ — приглашение от администратора,
 * которое может нести лицензию. Активируется при регистрации или на уже
 * существующем аккаунте.
 */

/** Без визуально похожих символов (0/O, 1/I/L, 8/B, 5/S): ключи диктуют и переписывают. */
const KEY_ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ2346789';
const KEY_GROUPS = 4;
const KEY_GROUP_LENGTH = 4;

@Injectable()
export class RegistrationKeyService {
  private readonly logger = new Logger(RegistrationKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly licenses: LicensesService,
  ) {}

  /** Выпуск партии ключей (раздают пачками: на розыгрыш, в комплект к заказу). */
  async issue(params: {
    count: number;
    productId?: string;
    planId?: string;
    expiresAt?: Date;
    createdById: string;
  }): Promise<{ codes: string[] }> {
    if (params.count < 1 || params.count > 500) {
      throw new BadRequestException({
        code: 'INVALID_COUNT',
        message: 'За раз можно выпустить от 1 до 500 ключей',
      });
    }

    // Тариф принадлежит продукту: один без другого не определяет, что выдавать.
    if (Boolean(params.productId) !== Boolean(params.planId)) {
      throw new BadRequestException({
        code: 'PRODUCT_AND_PLAN_REQUIRED',
        message: 'Продукт и тариф указываются вместе либо не указываются вовсе',
      });
    }

    if (params.planId && params.productId) {
      const plan = await this.prisma.licensePlan.findUnique({
        where: { id: params.planId },
        select: { productId: true, isActive: true, product: { select: { status: true } } },
      });

      if (!plan || plan.productId !== params.productId) {
        throw new BadRequestException({
          code: 'PLAN_MISMATCH',
          message: 'Тариф не принадлежит указанному продукту',
        });
      }

      if (!plan.isActive) {
        throw new BadRequestException({ code: 'PLAN_INACTIVE', message: 'Тариф отключён' });
      }

      if (plan.product.status === ProductStatus.ARCHIVED) {
        throw new BadRequestException({
          code: 'PRODUCT_ARCHIVED',
          message: 'Продукт архивирован, новые ключи на него не выпускаются',
        });
      }
    }

    const codes = Array.from({ length: params.count }, () => this.generateCode());

    // Без skipDuplicates: коллизия при таком алфавите практически невозможна,
    // и если случилась — это сигнал о генераторе, а не повод выпустить меньше.
    await this.prisma.registrationKey.createMany({
      data: codes.map((code) => ({
        id: uuidv7(),
        code,
        productId: params.productId ?? null,
        planId: params.planId ?? null,
        createdById: params.createdById,
        expiresAt: params.expiresAt ?? null,
      })),
    });

    this.logger.log(`выпущено ключей: ${params.count}`);

    // Сами коды в аудит не пишем: это предъявительские документы.
    await this.audit.record({
      action: 'registration_key.issue',
      actorId: params.createdById,
      actorType: 'USER',
      entityType: 'registration_key',
      after: {
        count: params.count,
        productId: params.productId ?? null,
        planId: params.planId ?? null,
      },
    });

    return { codes };
  }

  /**
   * Ключи, выпущенные реселлером за свой баланс. Вызывается внутри
   * транзакции списания: ключи и деньги появляются или пропадают вместе.
   * Проверку тарифа, товара и цены делает ResellersService до списания.
   */
  async issueForReseller(
    tx: Prisma.TransactionClient,
    params: {
      resellerId: string;
      productId: string;
      planId: string;
      count: number;
      price: Prisma.Decimal;
      expiresAt?: Date;
      createdById: string;
    },
  ): Promise<{ id: string; code: string }[]> {
    const keys = Array.from({ length: params.count }, () => ({ id: uuidv7(), code: this.generateCode() }));
    await tx.registrationKey.createMany({
      data: keys.map((k) => ({
        ...k,
        productId: params.productId,
        planId: params.planId,
        resellerId: params.resellerId,
        price: params.price,
        createdById: params.createdById,
        expiresAt: params.expiresAt ?? null,
      })),
    });
    return keys;
  }

  /** Регистрация нового аккаунта по ключу. */
  async registerWithKey(
    params: { code: string; username: string; password: string; email?: string },
    ctx: RequestContext,
  ): Promise<LoginResult> {
    this.passwords.assertLength(params.password);

    const key = await this.loadUsableKey(params.code);

    const taken = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: params.username }, ...(params.email ? [{ email: params.email }] : [])],
      },
      select: { id: true },
    });

    if (taken) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Пользователь с такими данными уже зарегистрирован',
      });
    }

    const { hash, version } = await this.passwords.hashPassword(params.password);
    const userId = uuidv7();
    const userRole = await this.prisma.role.findUniqueOrThrow({ where: { slug: 'user' } });

    const user = await this.prisma.$transaction(async (tx) => {
      // Пользователь создаётся ДО погашения ключа: used_by_user_id ссылается на users.
      const created = await tx.user.create({
        data: {
          id: userId,
          username: params.username,
          email: params.email ?? null,
          passwordHash: hash,
          passwordVersion: version,
          passwordChangedAt: new Date(),
          // Ключ от администратора и есть подтверждение права на доступ;
          // почта при этом необязательна.
          status: UserStatus.ACTIVE,
          emailVerifiedAt: null,
          locale: await this.settings.getString('app.default_locale', 'ru'),
          // Пришёл по ключу реселлера — его клиент.
          resellerId: key.resellerId,
        },
      });

      await tx.userRole.create({ data: { userId, roleId: userRole.id } });
      await this.claim(tx, key.id, userId);

      const license =
        key.productId && key.planId
          ? await this.createLicense(tx, {
              userId,
              productId: key.productId,
              planId: key.planId,
              resellerId: key.resellerId,
              registrationKeyId: key.id,
            })
          : null;

      return { ...created, licenseId: license?.id ?? null };
    });

    this.logger.log(`регистрация по ключу: ${params.username}`);
    await this.recordRedeem(key, user.id, user.licenseId, true);

    return this.auth.completeLogin(
      user.id,
      user.username,
      user.email,
      user.locale,
      ctx,
      'registration_key',
    );
  }

  /** Активация ключа на существующем аккаунте — добавляет лицензию. */
  async redeemForUser(code: string, userId: string): Promise<{ licenseKey: string | null }> {
    const key = await this.loadUsableKey(code);
    const { productId, planId } = key;

    if (!productId || !planId) {
      throw new BadRequestException({
        code: 'KEY_WITHOUT_LICENSE',
        message: 'Этот ключ предназначен только для регистрации нового аккаунта',
      });
    }

    const license = await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, key.id, userId);
      const issued = await this.createLicense(tx, {
        userId,
        productId,
        planId,
        resellerId: key.resellerId,
        registrationKeyId: key.id,
      });
      // Клиентом реселлера становится тот, кто пришёл без реселлера; уже
      // закреплённого за другим реселлером не переманиваем.
      if (key.resellerId) {
        await tx.user.updateMany({ where: { id: userId, resellerId: null }, data: { resellerId: key.resellerId } });
      }
      return issued;
    });

    await this.recordRedeem(key, userId, license.id, false);
    return { licenseKey: license.key };
  }

  /**
   * Активация ключа — событие журнала: кто, каким ключом (чьим — админа или
   * реселлера), какую лицензию получил. Сам код в журнал не пишется: это
   * предъявительский документ, достаточно id ключа.
   */
  private async recordRedeem(
    key: { id: string; productId: string | null; planId: string | null; resellerId: string | null; createdById: string | null },
    userId: string,
    licenseId: string | null,
    newAccount: boolean,
  ): Promise<void> {
    await this.audit.record({
      action: newAccount ? 'registration_key.register' : 'registration_key.redeem',
      actorId: userId,
      actorType: 'USER',
      entityType: 'registration_key',
      entityId: key.id,
      after: {
        licenseId,
        productId: key.productId,
        planId: key.planId,
        resellerId: key.resellerId,
        issuedById: key.createdById,
      },
    });
  }

  // ------------------------------------------------------------- внутреннее

  /**
   * Погашение условием внутри UPDATE: из двух параллельных запросов с одним
   * кодом пройдёт один, второй откатит свою транзакцию целиком.
   */
  private async claim(tx: Prisma.TransactionClient, keyId: string, userId: string): Promise<void> {
    // cancelledAt: null в том же условии — гонка «реселлер отменил ключ, пока
    // покупатель его активировал» решается в одну сторону, а не в обе.
    const claimed = await tx.registrationKey.updateMany({
      where: { id: keyId, usedAt: null, cancelledAt: null },
      data: { usedAt: new Date(), usedByUserId: userId },
    });

    if (claimed.count === 0) {
      throw new ConflictException({ code: 'KEY_ALREADY_USED', message: 'Ключ уже использован' });
    }
  }

  private async loadUsableKey(code: string) {
    const normalized = code.trim().toUpperCase().replace(/\s/g, '');

    const key = await this.prisma.registrationKey.findUnique({ where: { code: normalized } });

    // Отменённый ключ выглядит как несуществующий: деньги за него уже вернулись.
    if (!key || key.cancelledAt) {
      throw new UnauthorizedException({ code: 'KEY_INVALID', message: 'Ключ не найден' });
    }

    if (key.usedAt) {
      throw new ConflictException({ code: 'KEY_ALREADY_USED', message: 'Ключ уже использован' });
    }

    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'KEY_EXPIRED', message: 'Срок действия ключа истёк' });
    }

    return key;
  }

  /** Лицензии создаёт только LicensesService — правила срока живут в одном месте. */
  private createLicense(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      productId: string;
      planId: string;
      resellerId?: string | null;
      registrationKeyId: string;
    },
  ) {
    return this.licenses.issue(
      {
        ...params,
        notes: params.resellerId
          ? 'выдана по ключу реселлера'
          : `выдана по регистрационному ключу (${OrderSource.REGISTRATION_KEY})`,
      },
      tx,
    );
  }

  /** Код вида ACDE-FGHJ-KMNP-QRTU; randomInt из node:crypto — коды не должны угадываться. */
  private generateCode(): string {
    const groups: string[] = [];
    for (let g = 0; g < KEY_GROUPS; g++) {
      let group = '';
      for (let i = 0; i < KEY_GROUP_LENGTH; i++) {
        group += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
      }
      groups.push(group);
    }
    return groups.join('-');
  }
}
