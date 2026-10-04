import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Формы реквизитов оплаты: что администратор вводит для магазина ЮKassa и
 * для набора крипто-кошельков. Общие для шаблонов и личных реквизитов товара.
 */

const cryptoWallet = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/, 'id кошелька: латиница, цифры, дефис'),
  currency: z.string().regex(/^[A-Z0-9]{2,10}$/, 'монета: например USDT'),
  network: z.string().min(1).max(32),
  address: z.string().trim().min(10).max(128),
  /** Сколько единиц валюты тарифа стоит одна монета (курс задаёт админ). */
  rate: z.number().positive(),
  /** Знаков после запятой в сумме к оплате. */
  decimals: z.number().int().min(0).max(8),
  /** Шаблон ссылки на транзакцию в обозревателе, {tx} заменяется хешем. */
  explorerTxUrl: z.string().url().includes('{tx}').optional(),
});

export type CryptoWallet = z.infer<typeof cryptoWallet>;

const PROFILE_SCHEMAS = {
  YOOKASSA: z.object({
    /** Отправлять чек 54-ФЗ: нужно, если в магазине ЮKassa включена фискализация. */
    sendReceipt: z.boolean().default(false),
    /** Код ставки НДС для чека (1 — без НДС). */
    vatCode: z.number().int().min(1).max(12).default(1),
  }),
  CRYPTO: z.object({
    wallets: z.array(cryptoWallet).max(20).default([]),
    /** Текст для покупателя рядом с адресом. */
    instructions: z.string().max(1000).optional(),
    /** Через сколько часов неоплаченный заказ отменяется. */
    expireHours: z.number().int().min(1).max(168).default(24),
  }),
} as const;

export const PROFILE_SECRET_FIELDS = {
  YOOKASSA: ['shopId', 'secretKey'],
  CRYPTO: [],
} as const;

export type ProfileProvider = keyof typeof PROFILE_SCHEMAS;
export type ProfileConfig<P extends ProfileProvider> = z.infer<(typeof PROFILE_SCHEMAS)[P]>;
export type Secrets = Record<string, string>;

export const PROFILE_PROVIDERS = Object.keys(PROFILE_SCHEMAS) as ProfileProvider[];

export function isProfileProvider(provider: string): provider is ProfileProvider {
  return provider in PROFILE_SCHEMAS;
}

export function parseProfileConfig<P extends ProfileProvider>(provider: P, raw: unknown): ProfileConfig<P> {
  return parseWith(PROFILE_SCHEMAS[provider], raw) as ProfileConfig<P>;
}

/** Разбор по zod-схеме с понятной ошибкой для панели. */
export function parseWith<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Неверные параметры способа оплаты',
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/** null — реквизиты готовы к приёму оплаты, иначе причина по-человечески. */
export function profileReadiness(provider: ProfileProvider, config: unknown, secrets: Secrets): string | null {
  const missing = PROFILE_SECRET_FIELDS[provider].filter((field) => !secrets[field]);
  if (missing.length) return `Не заданы ключи: ${missing.join(', ')}`;
  if (provider === 'CRYPTO' && (config as ProfileConfig<'CRYPTO'>).wallets.length === 0) {
    return 'Добавьте хотя бы один кошелёк';
  }
  return null;
}

/** Пустая строка удаляет секрет, отсутствующее поле оставляет как было. */
export function mergeSecrets(allowed: readonly string[], current: Secrets, patch?: Record<string, string>): Secrets {
  const fields = new Set(allowed);
  const next: Secrets = { ...current };
  for (const [field, value] of Object.entries(patch ?? {})) {
    if (!fields.has(field)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `Неизвестный ключ: ${field}` });
    }
    const trimmed = String(value).trim();
    if (trimmed) next[field] = trimmed;
    else delete next[field];
  }
  return next;
}
