import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { ImportResult, ImportRowError } from '@ims/shared';
import { ApiException } from '../common/errors';
import { dedupeKey } from '../common/crypto.service';
import { sanitizeMessageHtml } from '../common/html';
import { SuppressionService } from '../suppression/suppression.service';
import { AccountsService } from '../accounts/accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { DateTime } from 'luxon';
import { parseSchedule } from './schedule-parse';

/** Header spellings seen in the sheets, normalised to one internal key. */
const COLUMN_ALIASES: Record<string, string> = {
  'sending email': 'sendingEmail',
  'from email': 'sendingEmail',
  from: 'sendingEmail',
  'first name': 'firstName',
  firstname: 'firstName',
  'last name': 'lastName',
  lastname: 'lastName',
  email: 'toEmail',
  'to email': 'toEmail',
  recipient: 'toEmail',
  company: 'company',
  schedule: 'schedule',
  'schedule at': 'schedule',
  'send at': 'schedule',
  message: 'message',
  body: 'message',
  'message html': 'messageHtml',
  'html message': 'messageHtml',
  'body html': 'messageHtml',
  html: 'messageHtml',
  subject: 'subject',
  group: 'group',
  campaign: 'group',
};

interface NormalisedRow {
  sendingEmail: string;
  firstName: string;
  lastName: string;
  toEmail: string;
  company: string;
  schedule: string;
  message: string;
  messageHtml: string;
  subject: string;
  group: string;
}

// A basic shape check, not RFC 5322. Anything stricter rejects addresses that
// deliver fine; anything looser lets a spreadsheet artefact reach SMTP.
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

const MAX_ROWS = 20_000;

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly suppression: SuppressionService,
  ) {}

  /**
   * Validates a whole file, then writes it.
   *
   * Rows are validated up front and inserted unordered at the end, so one bad
   * row never leaves half a campaign in the queue and the operator gets a
   * single report they can act on. `dryRun` runs everything except the write —
   * the preview the import screen shows before anyone commits.
   */
  async importCsv(
    content: string,
    options: { dryRun: boolean; defaultTimezone?: string },
  ): Promise<ImportResult> {
    // Rejected up front rather than per row: one mistyped zone would
    // otherwise fail every line in the file with the same message.
    if (
      options.defaultTimezone &&
      !DateTime.local().setZone(options.defaultTimezone).isValid
    ) {
      throw ApiException.badRequest(
        `"${options.defaultTimezone}" is not a known timezone. Use an IANA name such as Asia/Singapore.`,
      );
    }

    const batchId = randomUUID();
    const rows = this.parseFile(content);

    if (rows.length > MAX_ROWS) {
      throw ApiException.badRequest(
        `That file has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it and import in parts.`,
      );
    }

    const errors: ImportRowError[] = [];
    const candidates: Array<{ row: number; doc: Record<string, unknown> }> = [];
    const accountCache = new Map<string, Awaited<ReturnType<AccountsService["findByEmail"]>>>();

    // Look the whole file's recipients up once instead of per row.
    const suppressed = await this.suppression.filterSuppressed(
      rows.map((row) => row.toEmail).filter(Boolean),
    );
    let skippedSuppressed = 0;

    // Duplicates inside the same file are caught here; duplicates against
    // already-queued mail are caught by the unique index at insert time.
    const seenKeys = new Set<string>();
    let skippedDuplicates = 0;

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 1;
      const fail = (reason: string) =>
        errors.push({ row: rowNumber, toEmail: row.toEmail || null, reason });

      if (!row.toEmail) {
        fail('Missing recipient email');
        continue;
      }
      if (!EMAIL_PATTERN.test(row.toEmail)) {
        fail(`"${row.toEmail}" is not a valid email address`);
        continue;
      }
      if (!row.subject.trim()) {
        fail('Missing subject');
        continue;
      }
      if (!row.message.trim()) {
        fail('Missing message body');
        continue;
      }
      if (!row.sendingEmail) {
        fail('Missing sending email');
        continue;
      }

      if (!accountCache.has(row.sendingEmail)) {
        accountCache.set(
          row.sendingEmail,
          await this.accounts.findByEmail(row.sendingEmail),
        );
      }
      const account = accountCache.get(row.sendingEmail) ?? null;
      if (!account) {
        fail(`No mailbox is configured for "${row.sendingEmail}"`);
        continue;
      }
      if (!account.active) {
        fail(`Mailbox "${row.sendingEmail}" is paused`);
        continue;
      }

      // A cell's own zone always wins. Failing that, the zone chosen on the
      // import screen; failing that, the mailbox's own zone, which tracks the
      // market it works and beats the server's clock.
      const schedule = parseSchedule(
        row.schedule,
        options.defaultTimezone ?? account.timezone,
      );
      if (!schedule.ok) {
        fail(schedule.reason);
        continue;
      }

      if (suppressed.has(row.toEmail)) {
        skippedSuppressed += 1;
        continue;
      }

      const bodyHtml = row.messageHtml
        ? sanitizeMessageHtml(row.messageHtml)
        : null;

      const key = dedupeKey({
        sendingEmail: account.email,
        toEmail: row.toEmail,
        subject: row.subject,
        group: row.group || null,
        bodyText: row.message,
        bodyHtml,
        firstName: row.firstName || null,
        lastName: row.lastName || null,
        company: row.company || null,
      });
      if (seenKeys.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      seenKeys.add(key);

      candidates.push({
        row: rowNumber,
        doc: {
          accountId: account.id,
          sendingEmail: account.email,
          toEmail: row.toEmail,
          firstName: row.firstName || null,
          lastName: row.lastName || null,
          company: row.company || null,
          group: row.group || null,
          subject: row.subject.trim(),
          bodyText: row.message,
          // Sanitised above, before hashing, so the key covers exactly what
          // gets stored.
          bodyHtml,
          scheduledAt: schedule.utc,
          status: 'pending',
          dedupeKey: key,
          importBatchId: batchId,
        },
      });
    }

    if (options.dryRun) {
      return {
        batchId,
        totalRows: rows.length,
        inserted: candidates.length,
        skippedDuplicates,
        skippedSuppressed,
        errors,
        dryRun: true,
      };
    }

    const inserted = await this.insert(candidates, errors);
    // Everything the unique index rejected was a duplicate of mail already in
    // the queue, which is a skip rather than an error the operator must fix.
    skippedDuplicates += candidates.length - inserted;

    this.logger.log(
      `Import ${batchId}: ${inserted} queued, ${skippedDuplicates} duplicate, ` +
        `${skippedSuppressed} suppressed, ${errors.length} error(s)`,
    );

    return {
      batchId,
      totalRows: rows.length,
      inserted,
      skippedDuplicates,
      skippedSuppressed,
      errors,
      dryRun: false,
    };
  }

  /**
   * Inserts the batch, skipping rows that duplicate mail already queued.
   *
   * `skipDuplicates` makes the unique index on `dedupeKey` a filter rather
   * than an error: one statement inserts everything new and silently drops the
   * rest, which is what a duplicate is — a skip, not something the operator
   * must go and fix.
   *
   * Anything else (a constraint violation, a dead connection) is a real
   * failure, and is reported against the batch rather than invented per row —
   * Postgres aborts the statement, so no individual row is at fault.
   */
  private async insert(
    candidates: Array<{ row: number; doc: Record<string, unknown> }>,
    errors: ImportRowError[],
  ): Promise<number> {
    if (!candidates.length) return 0;
    try {
      const result = await this.prisma.queuedEmail.createMany({
        data: candidates.map(
          (candidate) => candidate.doc as unknown as Prisma.QueuedEmailCreateManyInput,
        ),
        skipDuplicates: true,
      });
      return result.count;
    } catch (error) {
      const reason =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? `Database rejected the batch (${error.code}): ${error.message.split('\n').pop()}`
          : `Database rejected the batch: ${(error as Error).message}`;
      for (const candidate of candidates) {
        errors.push({
          row: candidate.row,
          toEmail: (candidate.doc.toEmail as string) ?? null,
          reason,
        });
      }
      return 0;
    }
  }

  /** Parses the CSV and maps whatever the header says onto the internal keys. */
  private parseFile(content: string): NormalisedRow[] {
    let records: Record<string, string>[];
    try {
      records = parse(content, {
        columns: (header: string[]) =>
          header.map((column) => {
            const key = column.trim().toLowerCase().replace(/[_-]+/g, ' ');
            return COLUMN_ALIASES[key] ?? key;
          }),
        skip_empty_lines: true,
        trim: true,
        // A stray extra comma in one row should not abort the whole file; the
        // row-level validation below reports what is actually missing.
        relax_column_count: true,
        bom: true,
      });
    } catch (error) {
      throw ApiException.badRequest(
        `Could not read that file as CSV: ${(error as Error).message}`,
      );
    }

    if (!records.length) {
      throw ApiException.badRequest('That file has no data rows.');
    }

    const missing = ['sendingEmail', 'toEmail', 'schedule', 'subject', 'message']
      .filter((column) => !(column in records[0]))
      .map((column) => COLUMN_LABELS[column]);
    if (missing.length) {
      throw ApiException.badRequest(
        `The file is missing required column(s): ${missing.join(', ')}.`,
      );
    }

    return records.map((record) => ({
      sendingEmail: (record.sendingEmail ?? '').trim().toLowerCase(),
      firstName: (record.firstName ?? '').trim(),
      lastName: (record.lastName ?? '').trim(),
      toEmail: (record.toEmail ?? '').trim().toLowerCase(),
      company: (record.company ?? '').trim(),
      schedule: (record.schedule ?? '').trim(),
      message: record.message ?? '',
      messageHtml: (record.messageHtml ?? '').trim(),
      subject: (record.subject ?? '').trim(),
      group: (record.group ?? '').trim(),
    }));
  }
}

const COLUMN_LABELS: Record<string, string> = {
  sendingEmail: 'Sending Email',
  toEmail: 'Email',
  schedule: 'Schedule',
  subject: 'Subject',
  message: 'Message',
};

