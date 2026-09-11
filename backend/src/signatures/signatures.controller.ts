import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { SignaturesService } from './signatures.service';
import { CreateSignatureDto, UpdateSignatureDto } from './dto/signature.dto';

/**
 * The signature library: write, edit and delete sign-offs.
 *
 * Which mailbox sends with which signature is not set here. A mailbox picks
 * its signature on its own edit form (PATCH /accounts/:id with signatureId),
 * so there is exactly one place that changes a mailbox's sign-off.
 */
@Controller('signatures')
export class SignaturesController {
  constructor(
    private readonly signatures: SignaturesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.signatures.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.signatures.get(id);
  }

  @Roles('admin')
  @Post()
  async create(
    @Body() dto: CreateSignatureDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const signature = await this.signatures.create(dto);
    await this.audit.record(actor, 'signature.create', signature.name, null);
    return signature;
  }

  @Roles('admin')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSignatureDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const signature = await this.signatures.update(id, dto);
    await this.audit.record(actor, 'signature.update', signature.name, {
      fields: Object.keys(dto),
    });
    return signature;
  }

  @Roles('admin')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const signature = await this.signatures.remove(id);
    await this.audit.record(actor, 'signature.delete', signature.name, null);
    return { ok: true };
  }
}
