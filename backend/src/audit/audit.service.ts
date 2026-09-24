import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditEntryDto, Paginated } from '@tmx-scheduler/shared';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Never throws. An audit write failing must not turn a completed action into
   * an API error — the action already happened, and reporting it as failed
   * would be a worse lie than a missing log line.
   */
  async record(
    actor: AuthUser,
    action: string,
    target: string | null,
    metadata: Record<string, unknown> | null,
  ): Promise<void> {
    try {
      await this.prisma.auditEntry.create({
        data: {
          actorEmail: actor.email,
          action,
          target,
          metadata: (metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${action}: ${(error as Error).message}`,
      );
    }
  }

  async list(page: number, pageSize: number): Promise<Paginated<AuditEntryDto>> {
    const [items, total] = await Promise.all([
      this.prisma.auditEntry.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditEntry.count(),
    ]);
    return {
      items: items.map((entry) => ({
        id: entry.id,
        actorEmail: entry.actorEmail,
        action: entry.action,
        target: entry.target,
        metadata: (entry.metadata ?? null) as Record<string, unknown> | null,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
