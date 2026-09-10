import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Paginated, SuppressionDto, SuppressionReason } from '@ims/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppressionService {
  private readonly logger = new Logger(SuppressionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isSuppressed(email: string): Promise<boolean> {
    const found = await this.prisma.suppression.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    return Boolean(found);
  }

  /**
   * Bulk membership test for the importer. One query for the whole file rather
   * than one per row — a 5,000-row sheet should not be 5,000 round trips.
   */
  async filterSuppressed(emails: string[]): Promise<Set<string>> {
    const lowered = [...new Set(emails.map((e) => e.toLowerCase()))];
    if (!lowered.length) return new Set();
    const found = await this.prisma.suppression.findMany({
      where: { email: { in: lowered } },
      select: { email: true },
    });
    return new Set(found.map((entry) => entry.email));
  }

  /**
   * Idempotent: re-suppressing an address keeps the original reason and date.
   * The first reason is the true one — a later bounce on an address someone
   * already unsubscribed from should not rewrite that history. The empty
   * `update` is what makes this an insert-or-leave-alone in one statement.
   */
  async add(
    email: string,
    reason: SuppressionReason,
    note: string | null = null,
    sourceEmailId: string | null = null,
  ): Promise<void> {
    const normalised = email.toLowerCase().trim();
    const before = await this.prisma.suppression.findUnique({
      where: { email: normalised },
      select: { id: true },
    });
    await this.prisma.suppression.upsert({
      where: { email: normalised },
      update: {},
      create: { email: normalised, reason, note, sourceEmailId },
    });
    if (!before) this.logger.log(`Suppressed ${normalised} (${reason})`);
  }

  async addMany(
    emails: string[],
    reason: SuppressionReason,
    note: string | null = null,
  ): Promise<number> {
    const normalised = [
      ...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean)),
    ];
    if (!normalised.length) return 0;

    // `skipDuplicates` leaves existing rows untouched, preserving the original
    // reason, and reports how many were genuinely new in one round trip.
    const result = await this.prisma.suppression.createMany({
      data: normalised.map((email) => ({
        email,
        reason,
        note,
        sourceEmailId: null,
      })),
      skipDuplicates: true,
    });
    if (result.count) {
      this.logger.log(`Suppressed ${result.count} address(es) (${reason})`);
    }
    return result.count;
  }

  async remove(email: string): Promise<void> {
    await this.prisma.suppression.deleteMany({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async list(
    page: number,
    pageSize: number,
    search?: string,
  ): Promise<Paginated<SuppressionDto>> {
    // Parameterised, so search text needs no escaping — unlike the regex this
    // replaced, where a stray metacharacter changed the query.
    const where: Prisma.SuppressionWhereInput = search
      ? { email: { contains: search.toLowerCase(), mode: 'insensitive' } }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.suppression.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.suppression.count({ where }),
    ]);

    return {
      items: items.map((entry) => ({
        id: entry.id,
        email: entry.email,
        reason: entry.reason,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
