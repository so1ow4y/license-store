import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

import { PrismaService } from '@common/prisma/prisma.service';

/**
 * Дашборды безопасности: каждый собирает себе экран из виджетов. Данные
 * виджеты берут из тех же эндпоинтов, что и журналы (поиск и статистика),
 * поэтому здесь хранится только раскладка.
 */

export const WIDGET_TYPES = ['counter', 'histogram', 'top', 'events', 'hits', 'traffic', 'blocks'] as const;
export const WIDGET_SIZES = ['s', 'm', 'l', 'full'] as const;
const WIDGET_SOURCES = ['audit', 'logins'] as const;
const MAX_WIDGETS = 40;

export interface Widget {
  id: string;
  type: (typeof WIDGET_TYPES)[number];
  title: string;
  size: (typeof WIDGET_SIZES)[number];
  source?: (typeof WIDGET_SOURCES)[number];
  q?: string;
  field?: string;
}

/** Первый дашборд нового пользователя — чтобы экран не был пустым. */
const STARTER: Omit<Widget, 'id'>[] = [
  { type: 'counter', title: 'Неудачные входы', size: 's', source: 'logins', q: 'result:failed' },
  { type: 'counter', title: 'Успешные входы', size: 's', source: 'logins', q: 'result:success' },
  { type: 'counter', title: 'События журнала', size: 's', source: 'audit', q: '' },
  { type: 'hits', title: 'Новые сработки', size: 's' },
  { type: 'histogram', title: 'Входы во времени', size: 'l', source: 'logins', q: '' },
  { type: 'traffic', title: 'Нагрузка и очередь', size: 'm' },
  { type: 'top', title: 'Адреса с неудачными входами', size: 'm', source: 'logins', q: 'result:failed', field: 'ip' },
  { type: 'top', title: 'Самые частые действия', size: 'm', source: 'audit', q: '', field: 'action' },
  { type: 'events', title: 'Последние события', size: 'full', source: 'audit', q: '' },
];

@Injectable()
export class DashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Свои и общие дашборды; у нового пользователя создаётся стартовый. */
  async list(userId: string) {
    let rows = await this.prisma.securityDashboard.findMany({
      where: { OR: [{ ownerId: userId }, { shared: true }] },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    if (!rows.some((r) => r.ownerId === userId)) {
      await this.prisma.securityDashboard.create({
        data: { id: uuidv7(), ownerId: userId, name: 'Обзор', widgets: STARTER.map((w) => ({ ...w, id: uuidv7() })) as unknown as Prisma.InputJsonValue },
      });
      rows = await this.prisma.securityDashboard.findMany({
        where: { OR: [{ ownerId: userId }, { shared: true }] },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
    }
    const owners = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } },
      select: { id: true, username: true },
    });
    const names = new Map(owners.map((o) => [o.id, o.username]));
    return rows.map((row) => ({ ...row, ownerUsername: names.get(row.ownerId) ?? null, mine: row.ownerId === userId }));
  }

  async create(userId: string, input: { name: string; widgets?: unknown; shared?: boolean }) {
    const count = await this.prisma.securityDashboard.count({ where: { ownerId: userId } });
    if (count >= 30) throw new BadRequestException({ code: 'DASHBOARDS_TOO_MANY', message: 'Не больше 30 дашбордов' });
    return this.prisma.securityDashboard.create({
      data: {
        id: uuidv7(),
        ownerId: userId,
        name: input.name.trim(),
        shared: input.shared ?? false,
        position: count,
        widgets: sanitizeWidgets(input.widgets ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(userId: string, id: string, input: { name?: string; widgets?: unknown; shared?: boolean; position?: number }) {
    await this.owned(userId, id);
    return this.prisma.securityDashboard.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.widgets !== undefined ? { widgets: sanitizeWidgets(input.widgets) as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.prisma.securityDashboard.delete({ where: { id } });
  }

  private async owned(userId: string, id: string) {
    const row = await this.prisma.securityDashboard.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Дашборд не найден' });
    if (row.ownerId !== userId) throw new ForbiddenException({ code: 'DASHBOARD_NOT_OWNER', message: 'Менять дашборд может только его владелец' });
    return row;
  }
}

/** Виджеты из запроса — в известную форму; лишние поля отбрасываются, строки обрезаются. */
export function sanitizeWidgets(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) throw new BadRequestException({ code: 'WIDGETS_INVALID', message: 'Виджеты — это список' });
  if (raw.length > MAX_WIDGETS) throw new BadRequestException({ code: 'WIDGETS_TOO_MANY', message: `Не больше ${MAX_WIDGETS} виджетов` });
  return raw.map((item, index) => {
    const w = (item ?? {}) as Record<string, unknown>;
    if (!WIDGET_TYPES.includes(w.type as Widget['type'])) {
      throw new BadRequestException({ code: 'WIDGETS_INVALID', message: `Виджет ${index + 1}: неизвестный тип` });
    }
    const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
    const id = str(w.id, 64);
    return {
      id: id && /^[\w-]+$/.test(id) ? id : uuidv7(),
      type: w.type as Widget['type'],
      title: str(w.title, 120) ?? '',
      size: WIDGET_SIZES.includes(w.size as Widget['size']) ? (w.size as Widget['size']) : 'm',
      ...(WIDGET_SOURCES.includes(w.source as NonNullable<Widget['source']>) ? { source: w.source as Widget['source'] } : {}),
      ...(str(w.q, 1000) !== undefined ? { q: str(w.q, 1000) } : {}),
      ...(str(w.field, 32) !== undefined ? { field: str(w.field, 32) } : {}),
    };
  });
}
