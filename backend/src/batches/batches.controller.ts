import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { BatchesService } from './batches.service';
import { RenameBatchDto } from './dto/batch.dto';
import { Roles } from '../auth/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

/**
 * How each import performed, after the fact.
 *
 * Read-only apart from the name: a batch is the record of what an import did,
 * and the only thing about it that was ever a guess is what to call it.
 */
@Controller('batches')
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.batches.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.batches.get(id);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() dto: RenameBatchDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const batch = await this.batches.rename(id, dto.name);
    await this.audit.record(actor, 'batch.rename', `Batch ${batch.number}`, {
      batchId: batch.id,
      name: batch.name,
    });
    return batch;
  }
}
