import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ENV, type Env } from '@common/config/env.schema';
import { RequirePermissions } from '@common/rbac/permissions.decorator';
import { normalizeIp } from '@common/security/ip';
import { TrafficPriorityService } from '@common/security/traffic-priority.service';
import { CORRELATION_FIELDS } from '@modules/admin/admin-audit.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@modules/auth/guards/jwt-auth.guard';

import { CorrelationService } from './correlation.service';
import { DashboardsService } from './dashboards.service';
import {
  AddPriorityDto,
  DashboardDto,
  ListHitsDto,
  RuleDto,
  TrafficConfigDto,
  UpdateDashboardDto,
  UpdateHitsDto,
  UpdateRuleDto,
} from './dto/security-center.dto';
import { EdgeService } from './edge.service';
import { IpContextService } from './ip-context.service';
import { TrafficAdminService } from './traffic-admin.service';

const LOG_READERS = ['audit.read', 'logins.read'] as const;

/** Центр безопасности: дашборды, правила корреляции и сработки, приоритет трафика, контекст адреса. */
@ApiTags('admin')
@ApiBearerAuth('jwt')
@Controller()
export class SecurityCenterController {
  constructor(
    private readonly correlation: CorrelationService,
    private readonly dashboards: DashboardsService,
    private readonly trafficAdmin: TrafficAdminService,
    private readonly traffic: TrafficPriorityService,
    private readonly ipContext: IpContextService,
    private readonly edge: EdgeService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------- пропуск приоритета

  @Get('security/priority-pass')
  @ApiOperation({ summary: 'Пропуск приоритета для браузера доверенного пользователя (null — особого веса нет)' })
  priorityPass(@CurrentUser() actor: AuthenticatedUser): unknown {
    return this.traffic.issuePass(actor.id) ?? { pass: null };
  }

  // ---------------------------------------------------------------- дашборды

  @Get('admin/security/dashboards')
  @RequirePermissions(...LOG_READERS)
  @ApiOperation({ summary: 'Свои и общие дашборды безопасности' })
  async listDashboards(@CurrentUser() actor: AuthenticatedUser): Promise<unknown> {
    return this.dashboards.list(actor.id);
  }

  @Post('admin/security/dashboards')
  @RequirePermissions(...LOG_READERS)
  @ApiOperation({ summary: 'Создать дашборд' })
  async createDashboard(@CurrentUser() actor: AuthenticatedUser, @Body() dto: DashboardDto): Promise<unknown> {
    return this.dashboards.create(actor.id, dto);
  }

  @Patch('admin/security/dashboards/:id')
  @RequirePermissions(...LOG_READERS)
  @ApiOperation({ summary: 'Изменить дашборд: название, виджеты, общий доступ' })
  async updateDashboard(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDashboardDto,
  ): Promise<unknown> {
    return this.dashboards.update(actor.id, id, dto);
  }

  @Delete('admin/security/dashboards/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(...LOG_READERS)
  @ApiOperation({ summary: 'Удалить дашборд' })
  async deleteDashboard(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.dashboards.remove(actor.id, id);
  }

  // ----------------------------------------------------------------- правила

  @Get('admin/security/rules')
  @RequirePermissions(...LOG_READERS, 'security.rules.manage')
  @ApiOperation({ summary: 'Правила корреляции со счётчиками сработок' })
  async listRules(): Promise<unknown> {
    return { rules: await this.correlation.listRules(), fields: CORRELATION_FIELDS_LIST };
  }

  @Post('admin/security/rules')
  @RequirePermissions('security.rules.manage')
  @ApiOperation({ summary: 'Создать правило корреляции' })
  async createRule(@CurrentUser() actor: AuthenticatedUser, @Body() dto: RuleDto): Promise<unknown> {
    return this.correlation.createRule(dto, actor.id);
  }

  @Post('admin/security/rules/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('security.rules.manage')
  @ApiOperation({ summary: 'Что правило нашло бы сейчас — без сработок и действий' })
  async previewRule(@Body() dto: RuleDto): Promise<unknown> {
    return this.correlation.preview(dto);
  }

  @Patch('admin/security/rules/:id')
  @RequirePermissions('security.rules.manage')
  @ApiOperation({ summary: 'Изменить, включить или выключить правило' })
  async updateRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRuleDto,
  ): Promise<unknown> {
    return this.correlation.updateRule(id, dto, actor.id);
  }

  @Post('admin/security/rules/:id/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('security.rules.manage')
  @ApiOperation({ summary: 'Прогнать правило сейчас (со сработками и действиями)' })
  async runRule(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.correlation.run(await this.correlation.getRule(id));
  }

  @Delete('admin/security/rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('security.rules.manage')
  @ApiOperation({ summary: 'Удалить правило вместе со сработками' })
  async deleteRule(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.correlation.removeRule(id, actor.id);
  }

  // ---------------------------------------------------------------- сработки

  @Get('admin/security/hits')
  @RequirePermissions(...LOG_READERS, 'security.rules.manage')
  @ApiOperation({ summary: 'Сработки правил корреляции' })
  async listHits(@Query() query: ListHitsDto): Promise<unknown> {
    return this.correlation.listHits(query);
  }

  @Get('admin/security/hits/summary')
  @RequirePermissions(...LOG_READERS, 'security.rules.manage')
  @ApiOperation({ summary: 'Сколько сработок ждут разбора' })
  async hitsSummary(): Promise<unknown> {
    return this.correlation.summary();
  }

  @Post('admin/security/hits/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('security.rules.manage')
  @ApiOperation({ summary: 'Разбор сработок: принято, решено, ложное срабатывание' })
  async updateHits(@CurrentUser() actor: AuthenticatedUser, @Body() dto: UpdateHitsDto): Promise<unknown> {
    return this.correlation.updateHits(dto.ids, { status: dto.status, note: dto.note }, actor.id);
  }

  // ------------------------------------------------------------------ трафик

  @Get('admin/security/traffic')
  @RequirePermissions('security.traffic.manage', 'security.ip_block')
  @ApiOperation({ summary: 'Нагрузка, очередь, топ адресов и доверенные' })
  async trafficState(@Req() req: FastifyRequest): Promise<unknown> {
    const ip = normalizeIp(req.ip);
    return {
      live: this.traffic.snapshot(),
      priorities: await this.trafficAdmin.list(),
      you: { ip, weight: this.traffic.weightOf(req, ip) },
    };
  }

  @Patch('admin/security/traffic/config')
  @RequirePermissions('security.traffic.manage')
  @ApiOperation({ summary: 'Настройки очереди, веса ролей, режим атаки' })
  async updateTraffic(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: TrafficConfigDto,
    @Req() req: FastifyRequest,
  ): Promise<unknown> {
    return this.trafficAdmin.updateConfig(dto, { id: actor.id, weight: this.traffic.weightOf(req, normalizeIp(req.ip)) });
  }

  @Post('admin/security/traffic/priorities')
  @RequirePermissions('security.traffic.manage')
  @ApiOperation({ summary: 'Добавить доверенный адрес или пользователя' })
  async addPriority(@CurrentUser() actor: AuthenticatedUser, @Body() dto: AddPriorityDto): Promise<unknown> {
    return this.trafficAdmin.add(dto, actor.id);
  }

  @Delete('admin/security/traffic/priorities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('security.traffic.manage')
  @ApiOperation({ summary: 'Убрать из доверенных' })
  async removePriority(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.trafficAdmin.remove(id, actor.id);
  }

  @Get('admin/security/edge')
  @RequirePermissions('security.ip_block', 'security.traffic.manage')
  @ApiOperation({ summary: 'Краевые агенты: настроен ли токен, когда nginx и фаервол забирали списки' })
  async edgeStatus(): Promise<unknown> {
    return this.edge.status(Boolean(this.env.EDGE_AGENT_TOKEN));
  }

  // ------------------------------------------------------------ контекст IP

  @Get('admin/security/ip/:ip')
  @RequirePermissions('security.ips.read', ...LOG_READERS)
  @ApiOperation({ summary: 'Контекст адреса: сеть, активность, пользователи, блоки, сработки' })
  async describeIp(@Param('ip') ip: string): Promise<unknown> {
    return this.ipContext.describe(ip);
  }
}

/** Поля группировки по журналам — для конструктора правил. */
const CORRELATION_FIELDS_LIST = Object.fromEntries(
  Object.entries(CORRELATION_FIELDS).map(([source, fields]) => [source, Object.keys(fields)]),
);
