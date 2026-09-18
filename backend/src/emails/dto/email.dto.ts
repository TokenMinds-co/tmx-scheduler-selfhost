import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBooleanString,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { EMAIL_STATUSES, EmailStatus } from '@ims/shared';

/**
 * Query strings arrive as strings, so `status=pending,failed` is split here
 * rather than in the controller — the validator then rejects an unknown status
 * before it can reach a database filter.
 */
export class QueueQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @IsIn(EMAIL_STATUSES, { each: true })
  status?: EmailStatus[];

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  group?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  /** Pre-batch imports; kept so links and saved filters from before still work. */
  @IsOptional()
  @IsString()
  importBatchId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number;
}

export class RescheduleDto {
  /** ISO 8601 with an offset or Z. The UI always sends UTC. */
  @IsDateString()
  scheduledAt!: string;
}

export class RetryDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

/**
 * Bulk actions take the same filter as the queue list, so "cancel everything I
 * am looking at" is literally the filter on screen — there is no second way to
 * express a selection that could disagree with what the operator sees.
 */
export class BulkActionDto extends QueueQueryDto {}

export class ImportQueryDto {
  @IsOptional()
  @IsBooleanString()
  dryRun?: string;

  /** Zone applied to schedule cells that carry no zone of their own. */
  @IsOptional()
  @IsString()
  defaultTimezone?: string;
}
