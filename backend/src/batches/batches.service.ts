import { Injectable } from '@nestjs/common';
import type { Batch } from '@prisma/client';
import { BatchDto, BatchStats, EMAIL_STATUSES, EmailStatus } from '@ims/shared';
import { ApiException } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

/** A batch nothing has been queued under yet, so every read has a shape. */
function emptyStats(): BatchStats {
  const byStatus = Object.fromEntries(
    EMAIL_STATUSES.map((status) => [status, 0]),
  ) as Record<EmailStatus, number>;
  return {
    byStatus,
    sent: 0,
    opened: 0,
    clicked: 0,
    openRate: 0,
    clickRate: 0,
    firstSentAt: null,
    lastSentAt: null,
  };
}

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first — the batch someone wants to look at is the last one sent. */
  async list(): Promise<BatchDto[]> {
    const batches = await this.prisma.batch.findMany({
      orderBy: { number: 'desc' },
    });
    if (!batches.length) return [];

    const stats = await this.statsFor(batches.map((batch) => batch.id));
    return batches.map((batch) => toDto(batch, stats.get(batch.id)));
  }

  async get(id: string): Promise<BatchDto> {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw ApiException.notFound('That batch does not exist.');
    const stats = await this.statsFor([id]);
    return toDto(batch, stats.get(id));
  }

  async rename(id: string, name: string): Promise<BatchDto> {
    const trimmed = name.trim();
    if (!trimmed) throw ApiException.badRequest('A batch needs a name.');

    const exists = await this.prisma.batch.findUnique({ where: { id } });
    if (!exists) throw ApiException.notFound('That batch does not exist.');

    const batch = await this.prisma.batch.update({
      where: { id },
      data: { name: trimmed },
    });
    const stats = await this.statsFor([id]);
    return toDto(batch, stats.get(id));
  }

  /**
   * Every batch's numbers in one query.
   *
   * Grouped by (batch, status) rather than counted per batch, so the page costs
   * the same whether there are three batches or three hundred. `_count` over a
   * nullable column counts the rows where it is set, which is exactly what a
   * first open or a first click is.
   */
  private async statsFor(ids: string[]): Promise<Map<string, BatchStats>> {
    const grouped = await this.prisma.queuedEmail.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { in: ids } },
      _count: { _all: true, firstOpenAt: true, firstClickAt: true },
      _min: { sentAt: true },
      _max: { sentAt: true },
    });

    const stats = new Map<string, BatchStats>();
    for (const row of grouped) {
      if (!row.batchId) continue;
      const entry = stats.get(row.batchId) ?? emptyStats();

      entry.byStatus[row.status] = row._count._all;
      entry.opened += row._count.firstOpenAt;
      entry.clicked += row._count.firstClickAt;

      const first = row._min.sentAt?.toISOString() ?? null;
      const last = row._max.sentAt?.toISOString() ?? null;
      if (first && (!entry.firstSentAt || first < entry.firstSentAt)) {
        entry.firstSentAt = first;
      }
      if (last && (!entry.lastSentAt || last > entry.lastSentAt)) {
        entry.lastSentAt = last;
      }

      stats.set(row.batchId, entry);
    }

    for (const entry of stats.values()) {
      entry.sent = entry.byStatus.sent;
      // Rates are of what went out, so a batch still sending reports against
      // the mail it has actually delivered rather than against its own size.
      entry.openRate = entry.sent ? entry.opened / entry.sent : 0;
      entry.clickRate = entry.sent ? entry.clicked / entry.sent : 0;
    }
    return stats;
  }
}

function toDto(batch: Batch, stats: BatchStats | undefined): BatchDto {
  return {
    id: batch.id,
    number: batch.number,
    name: batch.name,
    sourceFile: batch.sourceFile,
    createdBy: batch.createdBy,
    totalRows: batch.totalRows,
    inserted: batch.inserted,
    skippedDuplicates: batch.skippedDuplicates,
    skippedSuppressed: batch.skippedSuppressed,
    errorCount: batch.errorCount,
    createdAt: batch.createdAt.toISOString(),
    stats: stats ?? emptyStats(),
  };
}
