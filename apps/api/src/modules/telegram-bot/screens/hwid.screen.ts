import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '@common/redis/redis.service';
import { SettingsService } from '@common/settings/settings.service';
import { HwidService } from '@modules/hwid/hwid.service';
import { LicensesService } from '@modules/licenses/licenses.service';

import { BotStateService } from '../bot-state.service';
import { formatDateTime, hoursText, toLicenseView } from '../bot-format';
import { kb, type KbButton } from '../bot-keyboard';
import { t, type Locale, type MessageKey } from '../i18n';
import { CB, apiErrorCode, apiErrorDetails, type ScreenCtx, type ScreenView } from './screen.types';

/**
 * Сброс привязки к компьютеру — единственное необратимое действие, которое
 * бот выполняет сам (E-05, E-06).
 *
 * Два шага обязательны, и второй обязан называть цену: «использовано 1 из 3,
 * останется 2». Счётчик сбросов общий и не восстанавливается ничем, кроме
 * ручной правки поддержкой, поэтому человек, нажавший кнопку не читая,
 * теряет треть лимита навсегда.
 */

/**
 * Замок на лицензию: два быстрых тапа по «Да, сбросить» — обычное дело
 * на телефоне. Метка подтверждения гасится атомарно и уже отсекает второй
 * тап, замок — вторая линия на случай, если параллельно пришёл апдейт из
 * другого источника (например, повтор доставки Telegram).
 */
const HWID_LOCK_PREFIX = 'tg:hwid-lock:';
const HWID_LOCK_TTL_SEC = 30;

@Injectable()
export class HwidScreen {
  private readonly logger = new Logger(HwidScreen.name);

  constructor(
    private readonly hwid: HwidService,
    private readonly licenses: LicensesService,
    private readonly state: BotStateService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  /** E-05. Подтверждение с явно названной ценой. */
  async confirm(ctx: ScreenCtx, licenseId: string): Promise<ScreenView> {
    const { locale } = ctx;

    const license = await this.licenses.findById(licenseId, ctx.actor.user);
    const view = toLicenseView(license);
    const binding = await this.hwid.statusFor(licenseId, ctx.actor.user.id);

    // Потолок берётся из статуса, а не считается как «использовано плюс
    // осталось»: при понижении лимита у продукта resetsLeft уже равен нулю,
    // и сумма показала бы старое, большее число.
    const maxResets = binding.maxResets;

    if (!binding.bound) return this.errorToLicense(locale, 'err.not_bound', licenseId);

    if (binding.resetsLeft <= 0) {
      return this.error(locale, 'err.hwid_limit', { max: maxResets }, [
        [{ text: t(locale, 'btn.support'), cb: CB.support }],
        [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
      ]);
    }

    const cooldownHours = binding.cooldownHours;

    if (binding.nextResetAvailableAt) {
      return this.error(
        locale,
        'err.hwid_cooldown',
        {
          cooldownText: hoursText(locale, cooldownHours),
          date: formatDateTime(locale, binding.nextResetAvailableAt),
        },
        [[{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }]],
      );
    }

    const nonce = await this.state.newNonce(ctx.chatId, 'awaiting_hwid_confirm', { licenseId });

    return {
      text: t(locale, 'screen.hwid.confirm', {
        productName: view.productName,
        maskedKey: view.maskedKey,
        resetsUsed: binding.resetsUsed,
        maxResets,
        resetsAfter: binding.resetsLeft - 1,
        cooldownText: hoursText(locale, cooldownHours),
      }),
      keyboard: kb([
        [{ text: t(locale, 'btn.reset_hwid_confirm'), cb: CB.hwidGo(licenseId, nonce) }],
        [{ text: t(locale, 'btn.cancel'), cb: CB.license(licenseId) }],
      ]),
    };
  }

  /**
   * E-06. Выполнение сброса.
   *
   * `null` означает «ответить молчанием»: так обрабатывается второй тап,
   * не взявший замок. Нарисовать в этом случае ошибку было бы враньём —
   * сброс идёт, просто его делает соседний апдейт.
   */
  async reset(ctx: ScreenCtx, licenseId: string, nonce: string): Promise<ScreenView | null> {
    const { locale } = ctx;

    const consumed = await this.state.consumeNonce(ctx.chatId, 'awaiting_hwid_confirm', nonce);
    if (!consumed || consumed.licenseId !== licenseId) {
      return this.error(locale, 'err.expired_action', {}, [
        [{ text: t(locale, 'btn.back_to_list'), cb: CB.licenses }],
      ]);
    }

    if (!(await this.acquireLock(licenseId))) return null;

    try {
      // Третий аргумент — строго undefined. Колонка hwid_history.ip имеет
      // тип inet (schema.prisma), и строка вида «telegram:123» уронила бы
      // вставку, то есть откатила бы всю транзакцию сброса.
      await this.hwid.resetBySelf(licenseId, ctx.actor.user.id, undefined);
    } catch (error) {
      return this.mapResetError(ctx, licenseId, error);
    }

    const binding = await this.hwid.statusFor(licenseId, ctx.actor.user.id);

    this.logger.log(`сброс привязки ${licenseId} через бота, пользователь ${ctx.actor.user.id}`);

    return {
      text: t(locale, 'screen.hwid.done', {
        resetsLeft: binding.resetsLeft,
        nextResetAvailableAt: binding.nextResetAvailableAt
          ? formatDateTime(locale, binding.nextResetAvailableAt)
          : t(locale, 'fmt.none'),
      }),
      keyboard: kb([
        [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
        [{ text: t(locale, 'btn.menu'), cb: CB.root }],
      ]),
    };
  }

  // =========================================================================
  //  ВНУТРЕННЕЕ
  // =========================================================================

  /**
   * Разбор отказа HwidService (§5.3 ТЗ).
   *
   * FORBIDDEN здесь — не ошибка пользователя, а рассинхрон: карточку он
   * открыл своей лицензии. Поэтому наружу общий текст, а в лог — детали,
   * по которым это можно разобрать.
   */
  private async mapResetError(
    ctx: ScreenCtx,
    licenseId: string,
    error: unknown,
  ): Promise<ScreenView> {
    const { locale } = ctx;
    const code = apiErrorCode(error);

    switch (code) {
      case 'HWID_RESET_COOLDOWN': {
        const details = apiErrorDetails(error);
        const nextAllowed =
          typeof details.nextAllowedAt === 'string' ? new Date(details.nextAllowedAt) : null;

        return this.error(
          locale,
          'err.hwid_cooldown',
          {
            cooldownText: hoursText(locale, await this.cooldownHoursFor(ctx, licenseId)),
            date: formatDateTime(locale, nextAllowed),
          },
          [[{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }]],
        );
      }

      case 'HWID_RESET_LIMIT': {
        const binding = await this.hwid
          .statusFor(licenseId, ctx.actor.user.id)
          .catch(() => null);

        return this.error(
          locale,
          'err.hwid_limit',
          { max: binding ? binding.maxResets : '' },
          [
            [{ text: t(locale, 'btn.support'), cb: CB.support }],
            [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
          ],
        );
      }

      case 'NOT_BOUND':
        return this.errorToLicense(locale, 'err.not_bound', licenseId);

      case 'NOT_FOUND':
      case 'LICENSE_REVOKED':
        return this.error(locale, 'err.expired_action', {}, [
          [{ text: t(locale, 'btn.back_to_list'), cb: CB.licenses }],
        ]);

      case 'FORBIDDEN':
        this.logger.error(
          `отказ FORBIDDEN при сбросе ${licenseId} пользователем ${ctx.actor.user.id} — рассинхрон`,
        );
        return this.error(locale, 'err.server', {}, [
          [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
        ]);

      default:
        this.logger.error(
          `сброс ${licenseId} не выполнен, код ${code ?? 'нет'}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return this.error(locale, 'err.server', {}, [
          [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
        ]);
    }
  }

  /**
   * Кулдаун этой лицензии (с учётом настройки продукта). Глобальная
   * настройка — только откат, если статус прочитать не удалось.
   */
  private async cooldownHoursFor(ctx: ScreenCtx, licenseId: string): Promise<number> {
    const binding = await this.hwid.statusFor(licenseId, ctx.actor.user.id).catch(() => null);
    if (binding) return binding.cooldownHours;
    return this.settings.getNumber('limits.hwid.reset_cooldown_hours', 24);
  }

  private async acquireLock(licenseId: string): Promise<boolean> {
    try {
      const acquired = await this.redis.client.set(
        `${HWID_LOCK_PREFIX}${licenseId}`,
        '1',
        'EX',
        HWID_LOCK_TTL_SEC,
        'NX',
      );
      return acquired !== null;
    } catch (error) {
      // Redis недоступен — пропускаем. Замок здесь вторая линия защиты,
      // первая (атомарное гашение метки) уже сработала.
      this.logger.warn(
        `замок сброса недоступен: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
  }

  private error(
    locale: Locale,
    key: MessageKey,
    vars: Record<string, string | number>,
    buttons: KbButton[][],
  ): ScreenView {
    return { text: t(locale, key, vars), keyboard: kb(buttons) };
  }

  private errorToLicense(locale: Locale, key: MessageKey, licenseId: string): ScreenView {
    return this.error(locale, key, {}, [
      [{ text: t(locale, 'btn.back_to_license'), cb: CB.license(licenseId) }],
    ]);
  }
}
