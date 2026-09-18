import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmailsService, QueueFilter } from './emails.service';
import { ImportService } from './import.service';
import {
  BulkActionDto,
  ImportQueryDto,
  QueueQueryDto,
  RescheduleDto,
  RetryDto,
} from './dto/email.dto';
import { ApiException } from '../common/errors';
import { Roles } from '../auth/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

/** Refuses anything larger before it is read into memory. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@Controller('emails')
export class EmailsController {
  constructor(
    private readonly emails: EmailsService,
    private readonly imports: ImportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() query: QueueQueryDto) {
    return this.emails.list(
      toFilter(query),
      query.page ?? 1,
      query.pageSize ?? 50,
    );
  }

  @Get('stats')
  stats() {
    return this.emails.queueStats();
  }

  @Get('stats/accounts')
  accountStats() {
    return this.emails.accountStats();
  }

  @Get('groups')
  groups() {
    return this.emails.groups();
  }

  /** CSV of the current filter, for reporting outside the tool. */
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="queue-export.csv"')
  async export(@Query() query: QueueQueryDto): Promise<string> {
    const page = await this.emails.list(toFilter(query), 1, 5000);
    const header = [
      'Sending Email', 'Email', 'First Name', 'Last Name', 'Company',
      'Group', 'Subject', 'Scheduled (UTC)', 'Status', 'Attempts',
      'Sent At', 'Last Error',
    ];
    const rows = page.items.map((email) => [
      email.sendingEmail, email.toEmail, email.firstName ?? '',
      email.lastName ?? '', email.company ?? '', email.group ?? '',
      email.subject, email.scheduledAt, email.status, String(email.attempts),
      email.sentAt ?? '', email.lastError ?? '',
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.emails.get(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const email = await this.emails.cancel(id);
    await this.audit.record(actor, 'email.cancel', email.toEmail, {
      emailId: email.id,
    });
    return email;
  }

  @Post(':id/reschedule')
  async reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const email = await this.emails.reschedule(id, new Date(dto.scheduledAt));
    await this.audit.record(actor, 'email.reschedule', email.toEmail, {
      emailId: email.id,
      scheduledAt: dto.scheduledAt,
    });
    return email;
  }

  @Post(':id/retry')
  async retry(
    @Param('id') id: string,
    @Body() dto: RetryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const email = await this.emails.retry(
      id,
      dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
    );
    await this.audit.record(actor, 'email.retry', email.toEmail, {
      emailId: email.id,
    });
    return email;
  }

  /**
   * Bulk cancel. Refuses an empty filter: "cancel everything in the queue" is
   * a real operation but never an accidental one, so it has to be spelled out
   * with at least one narrowing condition.
   */
  @Post('bulk/cancel')
  async bulkCancel(
    @Body() dto: BulkActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const filter = toFilter(dto);
    assertNarrowed(filter, 'cancel');
    const cancelled = await this.emails.cancelMany(filter);
    await this.audit.record(actor, 'email.bulk_cancel', null, {
      filter: dto,
      cancelled,
    });
    return { cancelled };
  }

  @Post('bulk/retry')
  async bulkRetry(@Body() dto: BulkActionDto, @CurrentUser() actor: AuthUser) {
    const filter = toFilter(dto);
    assertNarrowed(filter, 'retry');
    const retried = await this.emails.retryMany(filter);
    await this.audit.record(actor, 'email.bulk_retry', null, {
      filter: dto,
      retried,
    });
    return { retried };
  }

  /**
   * CSV upload. `dryRun=true` validates and reports without writing, which is
   * what the import screen shows before the operator commits.
   */
  @Roles('admin', 'operator')
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query() query: ImportQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    if (!file) throw ApiException.badRequest('No file was uploaded.');

    const dryRun = query.dryRun === 'true';
    const result = await this.imports.importCsv(file.buffer.toString('utf8'), {
      dryRun,
      defaultTimezone: query.defaultTimezone,
      sourceFile: file.originalname,
      actorEmail: actor.email,
    });

    if (!dryRun) {
      await this.audit.record(actor, 'import.run', file.originalname, {
        // Null when the file was entirely duplicates: the import ran and is
        // worth logging, but it opened no batch.
        batch: result.batch ? `Batch ${result.batch.number}` : null,
        batchId: result.batch?.id ?? null,
        inserted: result.inserted,
        skippedDuplicates: result.skippedDuplicates,
        skippedSuppressed: result.skippedSuppressed,
        errors: result.errors.length,
      });
    }
    return result;
  }
}

function toFilter(query: QueueQueryDto): QueueFilter {
  return {
    status: query.status,
    accountId: query.accountId,
    group: query.group,
    search: query.search,
    batchId: query.batchId,
    importBatchId: query.importBatchId,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
}

function assertNarrowed(filter: QueueFilter, action: string): void {
  const narrowed =
    filter.accountId ||
    filter.group ||
    filter.search ||
    filter.batchId ||
    filter.importBatchId ||
    filter.from ||
    filter.to ||
    filter.status?.length;
  if (!narrowed) {
    throw ApiException.badRequest(
      `Refusing to ${action} the entire queue. Narrow it by mailbox, group, batch or date first.`,
    );
  }
}

/** RFC 4180 quoting — a subject with a comma must not shift every column. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
