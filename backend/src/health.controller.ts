import { Controller, Get } from '@nestjs/common';
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
   */
  @Public()
  @Get()
  async check() {
    const connected = await this.prisma.isReachable();
    return {
      status: connected ? 'ok' : 'degraded',
      database: connected ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
