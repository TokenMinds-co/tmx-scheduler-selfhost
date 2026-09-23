import { Injectable } from '@nestjs/common';
import type { Batch } from '@prisma/client';
import { BatchDto, BatchStats, EMAIL_STATUSES, EmailStatus } from '@ims/shared';
import { ApiException } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { signatureCallToAction } from '../mail/trackable';

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
    scannerClicks: 0,
    clickFetches: 0,
    untracked: 0,
    openRate: 0,
    clickRate: 0,
    firstSentAt: null,
    lastSentAt: null,
  };
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
  ) {}

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
      _count: { _all: true, firstOpenAt: true },
      _min: { sentAt: true },
      _max: { sentAt: true },
    });

    const stats = new Map<string, BatchStats>();
    for (const row of grouped) {
      if (!row.batchId) continue;
      const entry = stats.get(row.batchId) ?? emptyStats();

      entry.byStatus[row.status] = row._count._all;
      entry.opened += row._count.firstOpenAt;

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

    // Clicks cannot come from the grouped count: `firstClickAt` is stamped by
    // the first hit of any kind, and on mail with a tracked link that is
    // usually a gateway. Only the clicked messages are fetched, so this stays
    // proportional to engagement rather than to the size of the batches.
    const clicked = await this.prisma.queuedEmail.findMany({
      where: { batchId: { in: ids }, firstClickAt: { not: null } },
      select: { id: true, batchId: true, firstOpenAt: true },
    });
    const verdicts = await this.tracking.clickVerdicts(clicked);
    for (const email of clicked) {
      const entry = email.batchId ? stats.get(email.batchId) : undefined;
      if (!entry) continue;
      // No events behind a stamped click means the log was pruned; with no
      // evidence against it, it stays a click.
      if ((verdicts.get(email.id) ?? 'human') === 'human') entry.clicked += 1;
      else entry.scannerClicks += 1;
    }

    const [fetches, untracked] = await Promise.all([
      this.clickFetches(ids),
      this.untracked(ids),
    ]);
    for (const [batchId, count] of fetches) {
      const entry = stats.get(batchId);
      if (entry) entry.clickFetches = count;
    }
    for (const [batchId, count] of untracked) {
      const entry = stats.get(batchId);
      if (entry) entry.untracked = count;
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

  /** Every click hit on each batch's mail, whatever the verdict. */
  private async clickFetches(ids: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Counted>`
      SELECT q."batchId"::text AS "batchId", COUNT(*) AS n
        FROM "email_event" e
        JOIN "email_queue" q ON q."id" = e."emailId"
       WHERE e."kind" = 'click' AND q."batchId"::text = ANY(${ids})
       GROUP BY q."batchId"`;
    return new Map(rows.map((row) => [row.batchId, Number(row.n)]));
  }

  /**
   * Per batch, how many messages carry no link the tracker can follow.
   *
   * The signature half is judged against each mailbox as it is configured
   * now, not as it was at send time — the sent message is not stored, only
   * its body. That is the useful reading anyway: it says whether the fix has
   * been made, and a batch sent before it was still reads as unclickable.
   * The body half mirrors `hasTrackableLink`, in SQL so the bodies stay in
   * the database.
   */
  private async untracked(ids: string[]): Promise<Map<string, number>> {
    const senders = await this.prisma.queuedEmail.findMany({
      where: { batchId: { in: ids } },
      distinct: ['accountId'],
      select: { accountId: true },
    });
    if (!senders.length) return new Map();

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: senders.map((row) => row.accountId) } },
      include: { signature: true },
    });
    const withCta = new Set(
      accounts
        .filter((account) => signatureCallToAction(account.signature?.html))
        .map((account) => account.id),
    );
    // A deleted mailbox has no signature at all, so it counts as none.
    const withoutCta = senders
      .map((row) => row.accountId)
      .filter((id) => !withCta.has(id));
    if (!withoutCta.length) return new Map();

    const rows = await this.prisma.$queryRaw<Counted>`
      SELECT q."batchId"::text AS "batchId", COUNT(*) AS n
        FROM "email_queue" q
       WHERE q."batchId"::text = ANY(${ids})
         AND q."accountId"::text = ANY(${withoutCta})
         AND NOT (COALESCE(q."bodyHtml", '') <> ''
                  AND q."bodyHtml" ~* 'href="https?://')
         AND NOT (COALESCE(q."bodyHtml", '') = ''
                  AND q."bodyText" ~* 'https?://[^[:space:]<>"'']')
       GROUP BY q."batchId"`;
    return new Map(rows.map((row) => [row.batchId, Number(row.n)]));
  }
}

/** Raw counts per batch id — a grouped query's rows, with the bigint made a number. */
type Counted = { batchId: string; n: bigint }[];

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
