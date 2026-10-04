import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PaymentProfile } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { AuditService } from '@common/audit/audit.service';
import { errorCode, summarize, type BulkItemResult } from '@common/bulk/bulk';
import { CryptoService } from '@common/crypto/crypto.service';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  anyContains,
  enumMatch,
  queryCondition,
  textContains,
  textMatch,
  timeRange,
  whereClause,
  type QueryTerm,
} from '@common/search/query';

import {
  PROFILE_PROVIDERS,
  PROFILE_SECRET_FIELDS,
  isProfileProvider,
  mergeSecrets,
  parseProfileConfig,
  profileReadiness,
  type ProfileConfig,
  type ProfileProvider,
  type Secrets,
} from './payment-config';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Реквизиты оплаты — куда идут деньги за товар.
 *
 * Шаблон (без productId) настраивается один раз и привязывается к любому
 * числу товаров; личные реквизиты создаются из товара и принадлежат ему.
 * К товару можно привязать сколько угодно реквизитов одного способа: два
 * крипто-кошелька — и покупатель выбирает, куда платить.
 *
 * Все реквизиты, в том числе личные, видны в общем реестре: кто создал,
 * когда, к каким товарам привязаны. Удаление снимает реквизиты со всех
 * товаров сразу. Создавать может payment_profiles.manage, привязывать
 * готовые — products.payments.assign.
 */

export interface ProfileInput {
  provider?: string;
  name?: string;
  productId?: string | null;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

/** Реквизиты, по которым принимается конкретный платёж. */
export interface CheckoutTarget<P extends ProfileProvider = ProfileProvider> {
  profileId: string;
  config: ProfileConfig<P>;
  secrets: Secrets;
  /** Кошелёк внутри реквизитов, выбранный покупателем (только крипта). */
  walletId?: string;
}

/** Поля строки поиска по реестру реквизитов. */
export const PROFILE_FIELDS = ['name', 'provider', 'kind', 'product', 'creator', 'wallet', 'id'] as const;

/** Публичный id кошелька: реквизиты и кошелёк внутри них. */
const WALLET_REF_RE = /^([0-9a-f-]{36}):([a-z0-9-]{1,32})$/;

const PROFILE_INCLUDE = {
  product: { select: { id: true, name: true } },
  productOptions: {
    select: { enabled: true, product: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PaymentProfileInclude;

type ProfileRow = Prisma.PaymentProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

@Injectable()
export class PaymentProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly methods: PaymentMethodsService,
  ) {}

  // ---------------------------------------------------------------- чтение

  /** Что можно привязать к товару: шаблоны и его личные реквизиты. */
  async list(productId?: string) {
    const rows = await this.prisma.paymentProfile.findMany({
      where: {
        archivedAt: null,
        OR: [{ productId: null }, ...(productId ? [{ productId }] : [])],
      },
      orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }],
      include: PROFILE_INCLUDE,
    });
    return this.toViews(rows);
  }

  /**
   * Реестр всех реквизитов: поиск «поле:значение» с AND/OR/NOT, способ,
   * вид (шаблон / личные), дата создания. Удалённые не показываются.
   */
  async search(input: {
    q?: string;
    provider?: string;
    kind?: 'TEMPLATE' | 'PERSONAL';
    from?: Date;
    to?: Date;
    skip?: number;
    take?: number;
  }) {
    const sql = Prisma.sql;
    const raw = Prisma.raw;
    const conditions = [
      sql`p.archived_at IS NULL`,
      input.provider ? sql`p.provider::text = ${input.provider}` : null,
      input.kind === 'TEMPLATE' ? sql`p.product_id IS NULL` : input.kind === 'PERSONAL' ? sql`p.product_id IS NOT NULL` : null,
      ...timeRange(raw('p.created_at'), input),
      queryCondition(input.q, PROFILE_FIELDS, (term) => this.profileTerm(term)),
    ];
    const from = sql`FROM payment_profiles p
      LEFT JOIN users u ON u.id = p.created_by_id
      LEFT JOIN products op ON op.id = p.product_id`;
    const where = whereClause(conditions);
    const take = Math.min(input.take ?? 50, 200);
    const skip = input.skip ?? 0;

    const [ids, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>(sql`
        SELECT p.id ${from} ${where} ORDER BY p.created_at DESC LIMIT ${take} OFFSET ${skip}`),
      this.prisma.$queryRaw<[{ total: number }]>(sql`SELECT count(*)::int AS total ${from} ${where}`),
    ]);

    const rows = await this.prisma.paymentProfile.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: PROFILE_INCLUDE,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((r) => byId.get(r.id)).filter((r): r is ProfileRow => Boolean(r));
    return { items: await this.toViews(ordered), total, skip, take };
  }

  async get(id: string) {
    const row = await this.prisma.paymentProfile.findFirst({ where: { id, archivedAt: null }, include: PROFILE_INCLUDE });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Реквизиты не найдены' });
    return (await this.toViews([row]))[0]!;
  }

  // ---------------------------------------------------------------- запись

  async create(input: ProfileInput, actorId: string) {
    const provider = input.provider ?? '';
    if (!isProfileProvider(provider)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Реквизиты бывают для ЮKassa и криптовалюты' });
    }
    if (input.productId) await this.assertProduct(input.productId);

    const id = uuidv7();
    const config = parseProfileConfig(provider, input.config ?? {});
    const secrets = mergeSecrets(PROFILE_SECRET_FIELDS[provider], {}, input.secrets);

    await this.prisma.paymentProfile.create({
      data: {
        id,
        provider,
        name: this.cleanName(input.name),
        productId: input.productId ?? null,
        config: config as Prisma.InputJsonValue,
        ...this.encryptSecrets(id, secrets),
        createdById: actorId,
        updatedById: actorId,
      },
    });

    await this.audit.record({
      action: 'payment_profile.create',
      actorId,
      actorType: 'USER',
      entityType: 'payment_profile',
      entityId: id,
      after: { provider, name: input.name, productId: input.productId ?? null, config, secretsSet: Object.keys(secrets) },
    });
    return this.get(id);
  }

  async update(id: string, input: ProfileInput, actorId: string) {
    const row = await this.loadActive(id);
    const provider = row.provider as ProfileProvider;
    const config = parseProfileConfig(provider, input.config ?? row.config);
    const secrets = mergeSecrets(PROFILE_SECRET_FIELDS[provider], this.decrypt(row), input.secrets);

    await this.prisma.paymentProfile.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: this.cleanName(input.name) } : {}),
        config: config as Prisma.InputJsonValue,
        ...this.encryptSecrets(id, secrets),
        updatedById: actorId,
      },
    });

    await this.audit.record({
      action: 'payment_profile.update',
      actorId,
      actorType: 'USER',
      entityType: 'payment_profile',
      entityId: id,
      after: { name: input.name, config, secretsChanged: Object.keys(input.secrets ?? {}) },
    });
    return this.get(id);
  }

  /**
   * Удалить реквизиты для всех: снять со всех товаров и убрать из реестра.
   * Удаление мягкое — по уже выставленным платежам статус ещё сверяется.
   */
  async archive(id: string, actorId: string) {
    const row = await this.loadActive(id);
    const linked = await this.prisma.productPaymentOption.findMany({
      where: { profileId: id },
      select: { productId: true },
    });

    await this.prisma.$transaction([
      this.prisma.productPaymentOption.deleteMany({ where: { profileId: id } }),
      this.prisma.paymentProfile.update({ where: { id }, data: { archivedAt: new Date(), updatedById: actorId } }),
    ]);
    await this.audit.record({
      action: 'payment_profile.archive',
      actorId,
      actorType: 'USER',
      entityType: 'payment_profile',
      entityId: id,
      before: { name: row.name, provider: row.provider, products: linked.map((l) => l.productId) },
    });
    return { detachedFrom: linked.length };
  }

  /** Массовое удаление: каждые реквизиты отдельно, отказ по одним не мешает остальным. */
  async archiveMany(ids: string[], actorId: string) {
    const results: BulkItemResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        await this.archive(id, actorId);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, code: errorCode(error) });
      }
    }
    return summarize(results);
  }

  // ------------------------------------------------------- привязка к товару

  /** Способы оплаты товара: глобальный выключатель и все привязанные реквизиты. */
  async productOptions(productId: string) {
    await this.assertProduct(productId);
    const [channels, options] = await Promise.all([
      this.methods.channels(),
      this.prisma.productPaymentOption.findMany({
        where: { productId, profile: { archivedAt: null } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { profile: { include: PROFILE_INCLUDE } },
      }),
    ]);
    const views = new Map((await this.toViews(options.map((o) => o.profile))).map((v) => [v.id, v]));

    return PROFILE_PROVIDERS.map((provider) => {
      const channel = channels.find((c) => c.provider === provider);
      return {
        provider,
        channelEnabled: channel?.enabled ?? false,
        channelTitle: channel?.title ?? provider,
        options: options
          .filter((o) => o.provider === provider)
          .map((o) => ({ enabled: o.enabled, sortOrder: o.sortOrder, profile: views.get(o.profileId)! })),
      };
    });
  }

  /** Привязать реквизиты к товару (способ берётся из самих реквизитов). */
  async attach(productId: string, profileId: string, actorId: string) {
    await this.assertProduct(productId);
    const profile = await this.loadActive(profileId);
    if (profile.productId && profile.productId !== productId) {
      throw new BadRequestException({ code: 'PROFILE_OF_OTHER_PRODUCT', message: 'Это личные реквизиты другого товара' });
    }
    const last = await this.prisma.productPaymentOption.findFirst({
      where: { productId, provider: profile.provider },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    await this.prisma.productPaymentOption.upsert({
      where: { productId_profileId: { productId, profileId } },
      update: { enabled: true, updatedById: actorId },
      create: {
        productId,
        profileId,
        provider: profile.provider,
        enabled: true,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        updatedById: actorId,
      },
    });
    await this.auditOption(productId, actorId, null, { profileId, provider: profile.provider, attached: true });
    return this.productOptions(productId);
  }

  /** Включить или выключить приём на эти реквизиты, поменять порядок. */
  async updateOption(productId: string, profileId: string, input: { enabled?: boolean; sortOrder?: number }, actorId: string) {
    const before = await this.loadOption(productId, profileId);
    await this.prisma.productPaymentOption.update({
      where: { productId_profileId: { productId, profileId } },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedById: actorId,
      },
    });
    await this.auditOption(productId, actorId, { profileId, enabled: before.enabled, sortOrder: before.sortOrder }, { profileId, ...input });
    return this.productOptions(productId);
  }

  async detach(productId: string, profileId: string, actorId: string) {
    const before = await this.loadOption(productId, profileId);
    await this.prisma.productPaymentOption.delete({ where: { productId_profileId: { productId, profileId } } });
    await this.auditOption(productId, actorId, { profileId, provider: before.provider }, { profileId, attached: false });
    return this.productOptions(productId);
  }

  // ------------------------------------------------------------ покупка

  /**
   * Способы, которыми товар можно оплатить прямо сейчас. Для крипты — все
   * кошельки всех привязанных готовых реквизитов; адреса — только в заказе.
   */
  async methodsForProduct(productId: string) {
    const [channels, options] = await Promise.all([
      this.methods.channels(),
      this.prisma.productPaymentOption.findMany({
        where: { productId, enabled: true, profile: { archivedAt: null } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { profile: true },
      }),
    ]);

    const result = [];
    for (const channel of channels) {
      if (!channel.enabled) continue;
      // Digiseller: один аккаунт продавца на всё, товар выбирается на площадке.
      if (channel.provider === 'DIGISELLER') {
        result.push({ provider: channel.provider, title: channel.title, description: channel.description });
        continue;
      }
      const provider = channel.provider;
      if (!isProfileProvider(provider)) continue;
      const ready = options
        .filter((o) => o.provider === provider)
        .map((o) => this.target(o.profile))
        .filter((target) => profileReadiness(provider, target.config, target.secrets) === null);
      if (ready.length === 0) continue;

      result.push({
        provider,
        title: channel.title,
        description: channel.description,
        ...(provider === 'CRYPTO'
          ? {
              wallets: ready.flatMap((target) =>
                (target.config as ProfileConfig<'CRYPTO'>).wallets.map((w) => ({
                  id: `${target.profileId}:${w.id}`,
                  currency: w.currency,
                  network: w.network,
                })),
              ),
            }
          : {}),
      });
    }
    return result;
  }

  /**
   * Реквизиты для нового заказа или отказ, если способ сейчас недоступен.
   * Для крипты `walletRef` выбирает кошелёк («реквизиты:кошелёк»); без него
   * берётся первый кошелёк первых готовых реквизитов.
   */
  async resolveForCheckout<P extends ProfileProvider>(
    productId: string,
    provider: P,
    walletRef?: string,
  ): Promise<CheckoutTarget<P>> {
    const unavailable = new BadRequestException({
      code: 'PAYMENT_METHOD_DISABLED',
      message: 'Этот способ оплаты сейчас недоступен',
    });
    if (!(await this.methods.isEnabled(provider))) throw unavailable;

    const options = await this.prisma.productPaymentOption.findMany({
      where: { productId, provider, enabled: true, profile: { archivedAt: null } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { profile: true },
    });
    const ready = options
      .map((o) => this.target(o.profile) as CheckoutTarget<P>)
      .filter((target) => profileReadiness(provider, target.config, target.secrets) === null);
    if (ready.length === 0) throw unavailable;

    const ref = walletRef ? WALLET_REF_RE.exec(walletRef) : null;
    if (walletRef && provider === 'CRYPTO') {
      // Старый формат (только id кошелька) ищется по всем привязанным реквизитам.
      const [profileId, walletId] = ref ? [ref[1], ref[2]] : [null, walletRef];
      const target = ready.find(
        (t) =>
          (!profileId || t.profileId === profileId) &&
          (t.config as ProfileConfig<'CRYPTO'>).wallets.some((w) => w.id === walletId),
      );
      if (!target) throw new BadRequestException({ code: 'WALLET_NOT_FOUND', message: 'Выбранный кошелёк недоступен' });
      return { ...target, walletId };
    }
    return ready[0]!;
  }

  /**
   * Кошельки для пополнения баланса реселлеров — из готовых крипто-шаблонов
   * (общих реквизитов, не привязанных к товару). Адреса здесь не отдаются:
   * адрес попадает только в созданную заявку.
   */
  async topupWallets() {
    const rows = await this.prisma.paymentProfile.findMany({
      where: { provider: 'CRYPTO', productId: null, archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .map((row) => this.target(row) as CheckoutTarget<'CRYPTO'>)
      .filter((t) => profileReadiness('CRYPTO', t.config, t.secrets) === null)
      .flatMap((t) =>
        t.config.wallets.map((w) => ({ id: `${t.profileId}:${w.id}`, currency: w.currency, network: w.network })),
      );
  }

  /** Кошелёк для заявки на пополнение по id вида «реквизиты:кошелёк». */
  async topupTarget(walletRef: string) {
    const ref = WALLET_REF_RE.exec(walletRef);
    const notFound = new BadRequestException({ code: 'WALLET_NOT_FOUND', message: 'Выбранный кошелёк недоступен' });
    if (!ref) throw notFound;
    const row = await this.prisma.paymentProfile.findFirst({
      where: { id: ref[1], provider: 'CRYPTO', productId: null, archivedAt: null },
    });
    if (!row) throw notFound;
    const target = this.target(row) as CheckoutTarget<'CRYPTO'>;
    const wallet = target.config.wallets.find((w) => w.id === ref[2]);
    if (!wallet || profileReadiness('CRYPTO', target.config, target.secrets) !== null) throw notFound;
    return { profileId: row.id, wallet, config: target.config };
  }

  /**
   * Реквизиты уже выставленного платежа — в том числе удалённые: сверять
   * статус нужно с тем магазином, где платёж создан. Платежам до появления
   * реквизитов достаётся первый шаблон того же способа.
   */
  async forPayment<P extends ProfileProvider>(profileId: string | null, provider: P): Promise<CheckoutTarget<P> | null> {
    const row = profileId
      ? await this.prisma.paymentProfile.findUnique({ where: { id: profileId } })
      : await this.prisma.paymentProfile.findFirst({
          where: { provider, productId: null, archivedAt: null },
          orderBy: { createdAt: 'asc' },
        });
    return row ? (this.target(row) as CheckoutTarget<P>) : null;
  }

  /** Срок оплаты крипто-заказа по реквизитам платежа. */
  async cryptoExpireHours(profileId: string | null): Promise<number> {
    const target = await this.forPayment(profileId, 'CRYPTO');
    return target?.config.expireHours ?? 24;
  }

  // ------------------------------------------------------------- внутреннее

  private profileTerm({ field, value }: QueryTerm): Prisma.Sql {
    const sql = Prisma.sql;
    const raw = Prisma.raw;
    // Привязан к товару (по коду или названию) или это личные реквизиты товара.
    const product = sql`(${textMatch(raw('op.slug'), value)} OR ${textMatch(raw('op.name'), value)} OR EXISTS (
      SELECT 1 FROM product_payment_options o JOIN products pr ON pr.id = o.product_id
      WHERE o.profile_id = p.id AND (${textMatch(raw('pr.slug'), value)} OR ${textMatch(raw('pr.name'), value)})))`;
    switch (field) {
      case 'name':
        return textMatch(raw('p.name'), value);
      case 'provider':
        return enumMatch(raw('p.provider'), value);
      case 'kind': {
        const v = value.toLowerCase();
        if (['template', 'шаблон'].includes(v)) return sql`p.product_id IS NULL`;
        if (['personal', 'own', 'личные', 'свои'].includes(v)) return sql`p.product_id IS NOT NULL`;
        throw new BadRequestException({ code: 'SEARCH_VALUE_INVALID', message: 'kind: template или personal' });
      }
      case 'product':
        return product;
      case 'creator':
        return sql`(${textMatch(raw('u.username::text'), value)} OR p.created_by_id::text = ${value})`;
      case 'wallet':
        // Адрес или монета кошелька — несекретная часть config.
        return textContains(raw('p.config::text'), value);
      case 'id':
        return sql`p.id::text = ${value}`;
      default:
        return sql`(${anyContains(['p.name', 'u.username::text', 'op.name'], value)} OR ${product})`;
    }
  }

  private target(row: PaymentProfile): CheckoutTarget {
    const provider = row.provider as ProfileProvider;
    return { profileId: row.id, config: parseProfileConfig(provider, row.config), secrets: this.decrypt(row) };
  }

  /** Вид для панели: без значений ключей, с товарами и автором. */
  private async toViews(rows: ProfileRow[]) {
    const creatorIds = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => Boolean(id)))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, username: true } })
      : [];
    const usernames = new Map(creators.map((u) => [u.id, u.username]));

    return rows.map((row) => {
      const provider = row.provider as ProfileProvider;
      const config = parseProfileConfig(provider, row.config);
      const secrets = this.decrypt(row);
      const notReadyReason = profileReadiness(provider, config, secrets);
      return {
        id: row.id,
        provider: row.provider,
        name: row.name,
        kind: row.productId ? ('PERSONAL' as const) : ('TEMPLATE' as const),
        productId: row.productId,
        productName: row.product?.name ?? null,
        config,
        secretFields: PROFILE_SECRET_FIELDS[provider],
        secretsSet: Object.fromEntries(PROFILE_SECRET_FIELDS[provider].map((f) => [f, Boolean(secrets[f])])),
        ready: notReadyReason === null,
        notReadyReason,
        usedBy: row.productOptions.length,
        products: row.productOptions.map((o) => ({ ...o.product, enabled: o.enabled })),
        createdById: row.createdById,
        createdByUsername: row.createdById ? (usernames.get(row.createdById) ?? null) : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  private async loadActive(id: string): Promise<PaymentProfile> {
    const row = await this.prisma.paymentProfile.findFirst({ where: { id, archivedAt: null } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Реквизиты не найдены' });
    return row;
  }

  private async loadOption(productId: string, profileId: string) {
    const option = await this.prisma.productPaymentOption.findUnique({
      where: { productId_profileId: { productId, profileId } },
    });
    if (!option) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Эти реквизиты не привязаны к товару' });
    return option;
  }

  private async auditOption(productId: string, actorId: string, before: object | null, after: object) {
    await this.audit.record({
      action: 'product.payment_option',
      actorId,
      actorType: 'USER',
      entityType: 'product',
      entityId: productId,
      before,
      after,
    });
  }

  private async assertProduct(productId: string): Promise<void> {
    const exists = await this.prisma.product.count({ where: { id: productId } });
    if (!exists) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Товар не найден' });
  }

  private cleanName(name: string | undefined): string {
    const value = (name ?? '').trim();
    if (!value) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Укажите название реквизитов' });
    return value.slice(0, 128);
  }

  private decrypt(row: Pick<PaymentProfile, 'id' | 'secretsEnc'>): Secrets {
    if (!row.secretsEnc) return {};
    return JSON.parse(this.crypto.decrypt(row.secretsEnc, this.context(row.id))) as Secrets;
  }

  private encryptSecrets(id: string, secrets: Secrets) {
    if (Object.keys(secrets).length === 0) return { secretsEnc: null, secretsKeyVer: null };
    return {
      secretsEnc: this.crypto.encrypt(JSON.stringify(secrets), this.context(id)),
      secretsKeyVer: this.crypto.keyVersion,
    };
  }

  private context(id: string) {
    return { table: 'payment_profiles', column: 'secrets_enc', rowId: id };
  }
}
