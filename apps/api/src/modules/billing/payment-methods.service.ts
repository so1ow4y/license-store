import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@prisma/client';
import { z } from 'zod';

import { AuditService } from '@common/audit/audit.service';
import { ENV, type Env } from '@common/config/env.schema';
import { CryptoService } from '@common/crypto/crypto.service';
import { PrismaService } from '@common/prisma/prisma.service';

import { mergeSecrets, parseWith, type Secrets } from './payment-config';

/**
 * Способы оплаты как каналы: глобальный выключатель и название на витрине.
 * Реквизиты ЮKassa и крипты — в PaymentProfilesService (шаблоны и личные
 * реквизиты товаров). Digiseller целиком здесь: у площадки один аккаунт
 * продавца на всю платформу.
 */

const CONFIG_SCHEMAS = {
  DIGISELLER: z.object({
    /** Ниже этой доли цены тарифа сделка уходит на ручной разбор. */
    minAmountRatio: z.number().min(0).max(1).default(0.5),
    /** Сколько часов после покупки следить за возвратами (площадка держит деньги 5 суток). */
    pollWindowHours: z.number().int().min(120).max(2160).default(336),
  }),
  YOOKASSA: z.object({}),
  CRYPTO: z.object({}),
} as const;

const SECRET_FIELDS = {
  DIGISELLER: ['sellerId', 'apiKey'],
  YOOKASSA: [],
  CRYPTO: [],
} as const;

const DEFAULT_TITLES: Record<ConfigurableProvider, string> = {
  DIGISELLER: 'Digiseller',
  YOOKASSA: 'Банковская карта или СБП',
  CRYPTO: 'Криптовалюта',
};

export type ConfigurableProvider = keyof typeof CONFIG_SCHEMAS;
export type ProviderConfig<P extends ConfigurableProvider> = z.infer<(typeof CONFIG_SCHEMAS)[P]>;

export const CONFIGURABLE_PROVIDERS = Object.keys(CONFIG_SCHEMAS) as ConfigurableProvider[];

export function isConfigurable(provider: string): provider is ConfigurableProvider {
  return provider in CONFIG_SCHEMAS;
}

export interface UpdatePaymentMethodInput {
  enabled?: boolean;
  title?: string;
  description?: string | null;
  sortOrder?: number;
  config?: Record<string, unknown>;
  /** Пустая строка удаляет секрет, отсутствующее поле оставляет как было. */
  secrets?: Record<string, string>;
}

export interface ChannelInfo {
  provider: ConfigurableProvider;
  enabled: boolean;
  title: string;
  description: string | null;
  sortOrder: number;
}

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Конфигурация канала с умолчаниями (строки в БД может ещё не быть). */
  async config<P extends ConfigurableProvider>(provider: P): Promise<ProviderConfig<P>> {
    const row = await this.prisma.paymentMethodConfig.findUnique({ where: { provider } });
    return this.parseConfig(provider, row?.config ?? {});
  }

  async isEnabled(provider: ConfigurableProvider): Promise<boolean> {
    const row = await this.prisma.paymentMethodConfig.findUnique({
      where: { provider },
      select: { enabled: true },
    });
    return Boolean(row?.enabled);
  }

  /** Выключатели и названия всех каналов — для витрины и формы товара. */
  async channels(): Promise<ChannelInfo[]> {
    const rows = await this.prisma.paymentMethodConfig.findMany();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return CONFIGURABLE_PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      return {
        provider,
        enabled: row?.enabled ?? false,
        title: row?.title ?? DEFAULT_TITLES[provider],
        description: row?.description ?? null,
        sortOrder: row?.sortOrder ?? 0,
      };
    }).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Секреты канала. Для Digiseller — с откатом на окружение: так
   * работают развёртывания, где ключи заданы в .env.production.
   */
  async secrets(provider: ConfigurableProvider): Promise<Secrets> {
    const row = await this.prisma.paymentMethodConfig.findUnique({
      where: { provider },
      select: { secretsEnc: true },
    });
    const stored = row?.secretsEnc ? this.decryptSecrets(provider, row.secretsEnc) : {};
    return provider === 'DIGISELLER' ? this.withEnvFallback(stored) : stored;
  }

  /** Список для панели: настройки и признаки заданных секретов, без значений. */
  async listForAdmin() {
    const rows = await this.prisma.paymentMethodConfig.findMany();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    return Promise.all(
      CONFIGURABLE_PROVIDERS.map(async (provider) => {
        const row = byProvider.get(provider);
        const secrets = await this.secrets(provider);
        const notReadyReason = this.readiness(provider, secrets);
        return {
          provider,
          enabled: row?.enabled ?? false,
          title: row?.title ?? DEFAULT_TITLES[provider],
          description: row?.description ?? null,
          sortOrder: row?.sortOrder ?? 0,
          config: this.parseConfig(provider, row?.config ?? {}),
          secretFields: SECRET_FIELDS[provider],
          secretsSet: Object.fromEntries(
            SECRET_FIELDS[provider].map((field) => [field, Boolean(secrets[field])]),
          ),
          ready: notReadyReason === null,
          notReadyReason,
          webhookUrl:
            provider === 'YOOKASSA' ? `${this.env.APP_URL}/api/v1/billing/yookassa/webhook` : null,
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    );
  }

  async update(provider: string, input: UpdatePaymentMethodInput, actorId: string) {
    if (!isConfigurable(provider)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Такого способа оплаты нет' });
    }

    const row = await this.prisma.paymentMethodConfig.findUnique({ where: { provider } });
    const config = this.parseConfig(provider, input.config ?? row?.config ?? {});
    const current = row?.secretsEnc ? this.decryptSecrets(provider, row.secretsEnc) : {};
    const nextSecrets = mergeSecrets(SECRET_FIELDS[provider], current, input.secrets);
    const enabled = input.enabled ?? row?.enabled ?? false;

    if (enabled) {
      const effective = provider === 'DIGISELLER' ? this.withEnvFallback(nextSecrets) : nextSecrets;
      const reason = this.readiness(provider, effective);
      if (reason) {
        throw new BadRequestException({ code: 'PAYMENT_METHOD_NOT_READY', message: reason });
      }
    }

    const hasSecrets = Object.keys(nextSecrets).length > 0;
    const data = {
      enabled,
      title: input.title ?? row?.title ?? DEFAULT_TITLES[provider],
      description: input.description !== undefined ? input.description : (row?.description ?? null),
      sortOrder: input.sortOrder ?? row?.sortOrder ?? 0,
      config: config as Prisma.InputJsonValue,
      secretsEnc: hasSecrets
        ? this.crypto.encrypt(JSON.stringify(nextSecrets), this.secretsContext(provider))
        : null,
      secretsKeyVer: hasSecrets ? this.crypto.keyVersion : null,
      updatedById: actorId,
    };

    await this.prisma.paymentMethodConfig.upsert({
      where: { provider },
      update: data,
      create: { provider, ...data },
    });

    // В журнал — что изменилось, но не значения секретов.
    await this.audit.record({
      action: 'payment_method.update',
      actorId,
      actorType: 'USER',
      entityType: 'payment_method',
      entityId: provider,
      after: {
        enabled,
        title: data.title,
        config,
        secretsChanged: Object.keys(input.secrets ?? {}),
      },
    });

    return (await this.listForAdmin()).find((m) => m.provider === provider);
  }

  // ------------------------------------------------------------- внутреннее

  private parseConfig<P extends ConfigurableProvider>(provider: P, raw: unknown): ProviderConfig<P> {
    return parseWith(CONFIG_SCHEMAS[provider], raw) as ProviderConfig<P>;
  }

  /** Канал ЮKassa и крипты готов всегда: реквизиты проверяются у товара. */
  private readiness(provider: ConfigurableProvider, secrets: Secrets): string | null {
    const missing = SECRET_FIELDS[provider].filter((field) => !secrets[field]);
    return missing.length ? `Не заданы ключи: ${missing.join(', ')}` : null;
  }

  private withEnvFallback(secrets: Secrets): Secrets {
    return {
      sellerId: secrets.sellerId || this.env.DIGISELLER_SELLER_ID || '',
      apiKey: secrets.apiKey || this.env.DIGISELLER_API_KEY || '',
    };
  }

  private decryptSecrets(provider: ConfigurableProvider, envelope: string): Secrets {
    return JSON.parse(this.crypto.decrypt(envelope, this.secretsContext(provider))) as Secrets;
  }

  private secretsContext(provider: PaymentProvider) {
    return { table: 'payment_methods', column: 'secrets_enc', rowId: provider };
  }
}
