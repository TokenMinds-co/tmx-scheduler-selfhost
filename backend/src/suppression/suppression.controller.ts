import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { SUPPRESSION_REASONS, SuppressionReason } from '@tmx-scheduler/shared';
import { SuppressionService } from './suppression.service';
import { Roles } from '../auth/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

class AddSuppressionDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @IsEmail({}, { each: true })
  emails!: string[];

  @IsIn(SUPPRESSION_REASONS)
  reason!: SuppressionReason;

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('suppression')
export class SuppressionController {
  constructor(
    private readonly suppression: SuppressionService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('search') search?: string,
  ) {
    return this.suppression.list(
      Math.max(1, page),
      Math.min(200, Math.max(1, pageSize)),
      search,
    );
  }

  @Post()
  async add(@Body() dto: AddSuppressionDto, @CurrentUser() actor: AuthUser) {
    const added = await this.suppression.addMany(
      dto.emails,
      dto.reason,
      dto.note ?? null,
    );
    await this.audit.record(actor, 'suppression.add', null, {
      count: dto.emails.length,
      added,
      reason: dto.reason,
    });
    return { added, submitted: dto.emails.length };
  }

  /**
   * Admin-only: taking an address off the list is the one action here that can
   * cause mail to be sent to someone who asked not to receive it.
   */
  @Roles('admin')
  @Delete(':email')
  async remove(@Param('email') email: string, @CurrentUser() actor: AuthUser) {
    await this.suppression.remove(email);
    await this.audit.record(actor, 'suppression.remove', email, null);
    return { ok: true };
  }
}
