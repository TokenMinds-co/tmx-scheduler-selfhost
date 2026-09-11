import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PROVIDER_PRESETS } from '@ims/shared';
import { AccountsService } from './accounts.service';
import { TransportService } from './transport.service';
import {
  CheckDomainDto,
  CreateAccountDto,
  SendTestEmailDto,
  UpdateAccountDto,
} from './dto/account.dto';
import { DomainCheckService } from './domain-check.service';
import { Roles } from '../auth/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { MessageBuilder } from '../mail/message-builder';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly domains: DomainCheckService,
    private readonly transports: TransportService,
    private readonly messages: MessageBuilder,
    private readonly audit: AuditService,
  ) {}

  /** Static reference table the account form's provider dropdown renders. */
  @Get('providers')
  providers() {
    return PROVIDER_PRESETS;
  }

  /**
   * Reads a domain's public DNS and reports which provider runs its mail, so
   * the setup guide can answer "which of these am I" instead of asking.
   * A POST because the domain is operator input, not a cacheable resource.
   */
  @Post('check-domain')
  @HttpCode(200)
  checkDomain(@Body() dto: CheckDomainDto) {
    return this.domains.check(dto.domain);
  }

  @Get()
  list() {
    return this.accounts.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.accounts.get(id);
  }

  @Roles('admin')
  @Post()
  async create(@Body() dto: CreateAccountDto, @CurrentUser() actor: AuthUser) {
    const account = await this.accounts.create(dto);
    await this.audit.record(actor, 'account.create', account.email, {
      authType: account.authType,
      smtpHost: account.smtpHost,
      dailyLimit: account.dailyLimit,
    });
    return account;
  }

  @Roles('admin')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const account = await this.accounts.update(id, dto);
    await this.audit.record(actor, 'account.update', account.email, {
      // Record which secrets were rotated, never their values.
      fields: Object.keys(dto).map((key) =>
        /password|Secret|Token/.test(key) ? `${key}*` : key,
      ),
    });
    return account;
  }

  @Roles('admin')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const account = await this.accounts.get(id);
    await this.accounts.remove(id);
    await this.audit.record(actor, 'account.delete', account.email, null);
    return { ok: true };
  }

  @Post(':id/verify')
  async verify(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const account = await this.accounts.verify(id);
    await this.audit.record(actor, 'account.verify', account.email, null);
    return account;
  }

  /**
   * Sends one message through the real transport so an operator can see the
   * signature and rendering before a campaign goes out. No unsubscribe footer:
   * this is not campaign mail, and a test send should not put the tester's own
   * address one mis-click away from the suppression list.
   */
  @Post(':id/test')
  async sendTest(
    @Param('id') id: string,
    @Body() dto: SendTestEmailDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const account = await this.accounts.findForSending(id);
    const transporter = await this.transports.get(account);
    const info = await transporter.sendMail(
      this.messages.build(account, {
        toEmail: dto.to,
        subject: dto.subject ?? `Test from ${account.displayName}`,
        bodyText:
          dto.body ??
          'This is a test message from the mail scheduler.\n\nIf the signature below looks right, the mailbox is ready.',
        firstName: actor.name.split(' ')[0],
        includeUnsubscribe: false,
      }),
    );
    await this.audit.record(actor, 'account.test_send', account.email, {
      to: dto.to,
    });
    return { ok: true, messageId: info.messageId };
  }
}
