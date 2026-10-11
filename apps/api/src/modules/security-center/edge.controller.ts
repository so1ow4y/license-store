import { Controller, Get, Inject, NotFoundException, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

import { ENV, type Env } from '@common/config/env.schema';
import { Public } from '@modules/auth/decorators/public.decorator';

import { EdgeService, type EdgeAgent } from './edge.service';

/**
 * Служебные эндпоинты краевых агентов. Не JWT, а общий токен из окружения
 * (EDGE_AGENT_TOKEN): агентам не нужен пользователь, а токен ротируется
 * вместе с конфигурацией развёртывания. Без токена в окружении маршрутов
 * как бы нет — 404, чтобы не светить их наружу.
 *
 * Content-Type ставится руками и только на успешный ответ: @Header()
 * применился бы и к JSON-ошибке, и Fastify не смог бы её сериализовать.
 */
@ApiExcludeController()
@Public()
@Controller('internal/edge')
export class EdgeController {
  private readonly tokenHash: Buffer | null;

  constructor(
    private readonly edge: EdgeService,
    @Inject(ENV) env: Env,
  ) {
    this.tokenHash = env.EDGE_AGENT_TOKEN ? createHash('sha256').update(env.EDGE_AGENT_TOKEN).digest() : null;
  }

  @Get('nginx/blocklist')
  async nginxBlocklist(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    this.authorize(req);
    return this.served('nginx', req, reply, await this.edge.nginxBlocklist());
  }

  @Get('nginx/priority')
  async nginxPriority(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    this.authorize(req);
    return this.text(reply, await this.edge.nginxPriority());
  }

  @Get('nftables')
  async nftables(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    this.authorize(req);
    return this.served('firewall', req, reply, await this.edge.nftables());
  }

  private async served(agent: EdgeAgent, req: FastifyRequest, reply: FastifyReply, body: string): Promise<string> {
    await this.edge.touch(agent, req.ip, body.length);
    return this.text(reply, body);
  }

  private text(reply: FastifyReply, body: string): string {
    void reply.header('Content-Type', 'text/plain; charset=utf-8').header('Cache-Control', 'no-store');
    return body;
  }

  private authorize(req: FastifyRequest): void {
    if (!this.tokenHash) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Не найдено' });
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const given = createHash('sha256').update(token).digest();
    if (!timingSafeEqual(given, this.tokenHash)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Неверный токен агента' });
    }
  }
}
