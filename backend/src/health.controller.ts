import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './auth/jwt-auth.guard';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Unauthenticated so a load balancer can reach it. Runs a real query rather
   * than reporting a bare 200 — a process that is up but has lost its database
   * is not healthy, and a naive check would keep it in rotation sending
   * nothing.
   *
   * The HTTP status mirrors the body: 200 for `ok`, 503 for `degraded`. The
   * compose healthcheck and the deploy job only read the status line, so a
   * probe that answered 200 no matter what would be a probe nothing could
   * ever fail. `passthrough` keeps Nest's own serialisation of the body.
   *
   * `version` is the short commit SHA baked into the image (COMMIT_SHA). The
   * deploy compares it with the tag it just pulled, so a deploy that silently
   * kept the old container cannot report success.
   */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const connected = await this.prisma.isReachable();
    res.status(connected ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: connected ? 'ok' : 'degraded',
      database: connected ? 'connected' : 'disconnected',
      version: process.env.COMMIT_SHA ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
