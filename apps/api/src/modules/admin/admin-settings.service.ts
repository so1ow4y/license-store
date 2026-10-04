import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { SettingsService } from '@common/settings/settings.service';

/**
 * Настройки платформы без передеплоя. Тип значения задан строкой в БД:
 * число остаётся числом, флаг — флагом. Значения секретов наружу не отдаются.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.setting.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
    return rows.map((row) => ({
      key: row.key,
      category: row.category,
      description: row.description,
      isSecret: row.isSecret,
      value: row.isSecret ? null : row.value,
      isSet: row.value !== null && row.value !== '',
      updatedAt: row.updatedAt,
    }));
  }

  async update(key: string, value: unknown, actorId: string) {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Настройка не найдена' });

    const expected = row.isSecret ? 'string' : typeof row.value;
    if (row.value !== null && typeof value !== expected) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Значение должно быть типа ${expected}`,
      });
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Некорректное число' });
    }

    await this.settings.set(key, value, actorId);
    await this.audit.record({
      action: 'setting.update',
      actorId,
      actorType: 'USER',
      entityType: 'setting',
      before: { key, value: row.isSecret ? '***' : row.value },
      after: { key, value: row.isSecret ? '***' : value },
    });

    return (await this.list()).find((s) => s.key === key);
  }
}
