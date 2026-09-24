import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type QueuedEmail } from '@prisma/client';
import {
  AccountStats,
  ClickVerdict,
  EmailDto,
  EmailStatus,
  Paginated,
  QueueStats,
} from '@tmx-scheduler/shared';
import { AppConfig, CONFIG } from '../config/configuration';
import { ApiException } from '../common/errors';
import { sentTodayOf } from '../accounts/daily-counter';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';

export interface QueueFilter {
  status?: EmailStatus[];
  accountId?: string;
  group?: string;
  search?: string;
  from?: Date;
  to?: Date;
  batchId?: string;
  importBatchId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    filter: QueueFilter,
    page: number,
    pageSize: number,
  ): Promise<Paginated<EmailDto>> {
    const where = this.toWhere(filter);
    const [items, total] = await Promise.all([
      this.prisma.queuedEmail.findMany({
        where,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.queuedEmail.count({ where }),
    ]);
    // Judged for the page on screen only — a handful of rows, and only the
    // ones that were clicked at all.
    const verdicts = await this.tracking.clickVerdicts(
      items.filter((email) => email.firstClickAt),
    );
    return {
      items: items.map((email) => toDto(email, verdicts.get(email.id))),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<EmailDto> {
    const email = await this.findOrThrow(id);
    const verdicts = await this.tracking.clickVerdicts(
      email.firstClickAt ? [email] : [],
    );
    return toDto(email, verdicts.get(email.id));
  }

  async groups(): Promise<string[]> {
    const rows = await this.prisma.queuedEmail.findMany({
      where: { group: { not: null } },
      distinct: ['group'],
      select: { group: true },
      orderBy: { group: 'asc' },
    });
    return rows.map((row) => row.group as string);
  }

  async queueStats(): Promise<QueueStats> {
    const now = new Date();
    const [counts, accounts, dueNow, next24h] = await Promise.all([
      this.prisma.queuedEmail.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      // Today's sends come from the mailbox counters, not from the queue: a
      // row is `sent` forever, and "today" is a different date per mailbox.
      this.prisma.account.findMany({
        select: { timezone: true, sentToday: true, sentTodayDate: true },
      }),
      this.prisma.queuedEmail.count({
        where: { status: 'pending', scheduledAt: { lte: now } },
      }),
      this.prisma.queuedEmail.count({
        where: {
          status: 'pending',
          scheduledAt: {
            gt: now,
            lte: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const byStatus = {
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    } as Record<EmailStatus, number>;
    for (const row of counts) byStatus[row.status] = row._count._all;

    const sentToday = accounts.reduce(
      (sum, account) => sum + sentTodayOf(account, now),
      0,
    );

    return { byStatus, sentToday, dueNow, next24h };
  }

  /**
   * Per-mailbox dashboard row. The pending and failed counts come from one
   * grouped query rather than two per account, so the page cost does not grow
   * with the number of mailboxes.
   */
  async accountStats(): Promise<AccountStats[]> {
    const now = new Date();
    const [accounts, grouped] = await Promise.all([
      this.prisma.account.findMany({ orderBy: { email: 'asc' } }),
      this.prisma.queuedEmail.groupBy({
        by: ['accountId', 'status'],
        where: { status: { in: ['pending', 'failed'] } },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map<string, { pending: number; failed: number }>();
    for (const row of grouped) {
      const entry = counts.get(row.accountId) ?? { pending: 0, failed: 0 };
      if (row.status === 'pending') entry.pending = row._count._all;
      else entry.failed = row._count._all;
      counts.set(row.accountId, entry);
    }

    return accounts.map((account) => {
      const entry = counts.get(account.id) ?? { pending: 0, failed: 0 };
      const sentToday = sentTodayOf(account, now);
      return {
        accountId: account.id,
        email: account.email,
        active: account.active,
        sentToday,
        dailyLimit: account.dailyLimit,
        remainingToday: Math.max(0, account.dailyLimit - sentToday),
        pending: entry.pending,
        failed: entry.failed,
        lastSentAt: account.lastSentAt?.toISOString() ?? null,
        lastError: account.lastError,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Operator actions
  // -------------------------------------------------------------------------

  async cancel(id: string): Promise<EmailDto> {
    const email = await this.findOrThrow(id);
    if (email.status !== 'pending') {
      throw ApiException.badRequest(
        `Only pending mail can be cancelled; this one is ${email.status}.`,
      );
    }
    const saved = await this.prisma.queuedEmail.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    return toDto(saved);
  }

  /** Bulk cancel by any queue filter — the "stop this campaign" button. */
  async cancelMany(filter: QueueFilter): Promise<number> {
    const result = await this.prisma.queuedEmail.updateMany({
      where: { ...this.toWhere(filter), status: 'pending' },
      data: { status: 'cancelled' },
    });
    this.logger.warn(`Bulk cancelled ${result.count} pending message(s)`);
    return result.count;
  }

  async reschedule(id: string, scheduledAt: Date): Promise<EmailDto> {
    const email = await this.findOrThrow(id);
    if (email.status === 'sent') {
      throw ApiException.badRequest('That message has already been sent.');
    }
    if (email.status === 'sending') {
      throw ApiException.badRequest(
        'That message is being sent right now. Try again in a moment.',
      );
    }
    const saved = await this.prisma.queuedEmail.update({
      where: { id },
      data: { scheduledAt, status: 'pending', claimedAt: null },
    });
    return toDto(saved);
  }

  /**
   * Puts a failed message back in the queue. `attempts` resets to zero: the
   * operator has looked at the error and decided it is worth a fresh run, and
   * carrying the old count would burn the retry budget before it starts.
   */
  async retry(id: string, scheduledAt?: Date): Promise<EmailDto> {
    const email = await this.findOrThrow(id);
    if (email.status !== 'failed' && email.status !== 'cancelled') {
      throw ApiException.badRequest(
        `Only failed or cancelled mail can be retried; this one is ${email.status}.`,
      );
    }
    const saved = await this.prisma.queuedEmail.update({
      where: { id },
      data: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        claimedAt: null,
        scheduledAt: scheduledAt ?? new Date(),
      },
    });
    return toDto(saved);
  }

  async retryMany(filter: QueueFilter): Promise<number> {
    const result = await this.prisma.queuedEmail.updateMany({
      where: { ...this.toWhere(filter), status: 'failed' },
      data: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        claimedAt: null,
        scheduledAt: new Date(),
      },
    });
    return result.count;
  }

  /** Called by the unsubscribe route; leaves already-sent mail untouched. */
  async cancelPendingForRecipient(
    email: string,
    reason: string,
  ): Promise<number> {
    const result = await this.prisma.queuedEmail.updateMany({
      where: { toEmail: email.toLowerCase(), status: 'pending' },
      data: { status: 'cancelled', lastError: reason },
    });
    if (result.count) {
      this.logger.log(
        `Cancelled ${result.count} pending message(s) for ${email}: ${reason}`,
      );
    }
    return result.count;
  }

  // -------------------------------------------------------------------------
  // Poller / worker transitions
  // -------------------------------------------------------------------------

  /**
   * Claims one due message, flipping it to `sending` in the same statement that
   * finds it.
   *
   * `FOR UPDATE SKIP LOCKED` is the point: concurrent pollers each take a
   * *different* due row instead of queueing behind the same one, so any number
   * of app instances can poll the same table and no message is claimed twice.
   * This is the operation the whole two-stage design rests on.
   *
   * Returns `null` when nothing is due.
   */
  async claimNextDue(now = new Date()): Promise<QueuedEmail | null> {
    const rows = await this.prisma.$queryRaw<QueuedEmail[]>`
      UPDATE "email_queue"
         SET "status" = 'sending', "claimedAt" = ${now}, "updatedAt" = ${now}
       WHERE "id" = (
             SELECT "id" FROM "email_queue"
              WHERE "status" = 'pending' AND "scheduledAt" <= ${now}
              ORDER BY "scheduledAt" ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1)
      RETURNING *`;
    return rows[0] ?? null;
  }

  /**
   * Returns messages orphaned by a worker that died between the claim and the
   * send. Without this sweep a crash leaves a message in `sending` forever —
   * invisible to the poller, never retried, and never reported as failed.
   */
  async reapStuckClaims(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.stuckSendingTimeoutMs);
    const result = await this.prisma.queuedEmail.updateMany({
      where: { status: 'sending', claimedAt: { lte: cutoff } },
      data: {
        status: 'pending',
        claimedAt: null,
        lastError:
          'Send was interrupted (worker restart or crash); returned to the queue.',
      },
    });
    if (result.count) {
      this.logger.warn(`Reaped ${result.count} message(s) stuck in "sending"`);
    }
    return result.count;
  }

  async markSent(id: string, providerMessageId: string | null): Promise<void> {
    await this.prisma.queuedEmail.updateMany({
      where: { id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerMessageId,
        claimedAt: null,
        lastError: null,
        attempts: { increment: 1 },
      },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.queuedEmail.updateMany({
      where: { id },
      data: {
        status: 'failed',
        lastError: error.slice(0, 1000),
        claimedAt: null,
        attempts: { increment: 1 },
      },
    });
  }

  /**
   * Returns a claimed message to the queue for a later attempt.
   *
   * `countsAsAttempt` separates the two reasons this happens: a throttle
   * deferral is not a failure and must not consume the retry budget, while a
   * transient SMTP error is and must.
   */
  async deferTo(
    id: string,
    scheduledAt: Date,
    reason: string,
    countsAsAttempt: boolean,
  ): Promise<void> {
    await this.prisma.queuedEmail.updateMany({
      where: { id },
      data: {
        status: 'pending',
        scheduledAt,
        claimedAt: null,
        lastError: reason.slice(0, 1000),
        ...(countsAsAttempt ? { attempts: { increment: 1 } } : {}),
      },
    });
  }

  async findById(id: string): Promise<QueuedEmail | null> {
    if (!UUID.test(id)) return null;
    return this.prisma.queuedEmail.findUnique({ where: { id } });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async findOrThrow(id: string): Promise<QueuedEmail> {
    const email = await this.findById(id);
    if (!email) throw ApiException.notFound('Message not found.');
    return email;
  }

  private toWhere(filter: QueueFilter): Prisma.QueuedEmailWhereInput {
    const where: Prisma.QueuedEmailWhereInput = {};
    if (filter.status?.length) where.status = { in: filter.status };
    // An id that is not a uuid matches nothing rather than throwing — the
    // filter comes from a query string.
    if (filter.accountId) {
      where.accountId = UUID.test(filter.accountId)
        ? filter.accountId
        : '00000000-0000-0000-0000-000000000000';
    }
    if (filter.group) where.group = filter.group;
    if (filter.batchId) where.batchId = filter.batchId;
    if (filter.importBatchId) where.importBatchId = filter.importBatchId;
    if (filter.from || filter.to) {
      where.scheduledAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }
    if (filter.search) {
      // `contains` is parameterised, so search text needs no escaping — unlike
      // the regex this replaced, where a stray metacharacter changed the query.
      const contains = filter.search;
      where.OR = [
        { toEmail: { contains, mode: 'insensitive' } },
        { company: { contains, mode: 'insensitive' } },
        { subject: { contains, mode: 'insensitive' } },
      ];
    }
    return where;
  }
}

/**
 * `clickVerdict` is passed in rather than looked up, because judging needs the
 * event log and this is a plain mapper. The write paths omit it: cancelling,
 * rescheduling and retrying all act on mail that has not been delivered, which
 * nobody can have clicked.
 */
export function toDto(
  email: QueuedEmail,
  clickVerdict: ClickVerdict | null = null,
): EmailDto {
  return {
    id: email.id,
    accountId: email.accountId,
    sendingEmail: email.sendingEmail,
    toEmail: email.toEmail,
    firstName: email.firstName,
    lastName: email.lastName,
    company: email.company,
    group: email.group,
    subject: email.subject,
    bodyText: email.bodyText,
    bodyHtml: email.bodyHtml,
    scheduledAt: email.scheduledAt.toISOString(),
    status: email.status,
    attempts: email.attempts,
    lastError: email.lastError,
    sentAt: email.sentAt?.toISOString() ?? null,
    providerMessageId: email.providerMessageId,
    claimedAt: email.claimedAt?.toISOString() ?? null,
    firstOpenAt: email.firstOpenAt?.toISOString() ?? null,
    firstClickAt: email.firstClickAt?.toISOString() ?? null,
    clickVerdict,
    batchId: email.batchId,
    importBatchId: email.importBatchId,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
  };
}
