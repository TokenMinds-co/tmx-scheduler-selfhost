import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Account } from '@prisma/client';
import { DateTime } from 'luxon';
import { AccountDto, PROVIDER_PRESETS } from '@ims/shared';
import { ApiException } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';
import { localDate, sentTodayOf, startOfNextDay } from './daily-counter';
import { TransportService } from './transport.service';
import type { SendingAccount } from '../mail/message-builder';

/**
 * Outcome of asking an account for permission to send one message right now.
 * `retryAt` is when it is worth asking again — the worker reschedules the
 * message to exactly that time rather than guessing.
 */
export type SlotClaim =
  | { ok: true; account: SendingAccount }
  | {
      ok: false;
      reason: 'inactive' | 'daily_limit' | 'min_gap';
      retryAt: Date;
      detail: string;
    };

/** Settings whose change invalidates a cached transport and needs re-verifying. */
const CONNECTION_FIELDS = [
  'authType',
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'requireTls',
  'smtpPassword',
  'oauthClientId',
  'oauthClientSecret',
  'oauthRefreshToken',
  'oauthTenantId',
] as const;

/** Postgres rejects a malformed uuid outright, so ids are shape-checked first. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly transports: TransportService,
  ) {}

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  async list(): Promise<AccountDto[]> {
    const accounts = await this.prisma.account.findMany({
      orderBy: { email: 'asc' },
      include: { signature: true },
    });
    return accounts.map((account) => this.toDto(account));
  }

  async findOrThrow(id: string): Promise<Account> {
    if (!UUID.test(id)) throw ApiException.notFound('Account not found.');
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw ApiException.notFound('Account not found.');
    return account;
  }

  async findByEmail(email: string): Promise<Account | null> {
    return this.prisma.account.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
  }

  /** A mailbox with its library signature loaded — what building a message needs. */
  async findForSending(id: string): Promise<SendingAccount> {
    if (!UUID.test(id)) throw ApiException.notFound('Account not found.');
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { signature: true },
    });
    if (!account) throw ApiException.notFound('Account not found.');
    return account;
  }

  async get(id: string): Promise<AccountDto> {
    return this.toDto(await this.findForSending(id));
  }

  async create(dto: CreateAccountDto): Promise<AccountDto> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.account.findUnique({ where: { email } });
    if (existing) {
      throw ApiException.conflict(`${email} is already configured.`);
    }

    // Built in memory first so the credential and signature rules run before
    // anything touches the database, which is where the model hooks used to
    // enforce them.
    const draft: Account = {
      id: '',
      email,
      displayName: dto.displayName,
      authType: dto.authType,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpUser: dto.smtpUser,
      requireTls: dto.requireTls ?? true,
      smtpPasswordEnc: null,
      oauthClientId: null,
      oauthClientSecretEnc: null,
      oauthRefreshTokenEnc: null,
      oauthTenantId: null,
      signatureId: null,
      dailyLimit: dto.dailyLimit ?? 20,
      minGapSeconds: dto.minGapSeconds ?? 45,
      timezone: this.validTimezone(dto.timezone),
      sentToday: 0,
      sentTodayDate: null,
      lastSentAt: null,
      lastError: null,
      lastVerifiedAt: null,
      active: dto.active ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.applySecrets(draft, dto);
    await this.applySignatureLink(draft, dto.signatureId);
    this.assertCredentialsComplete(draft);
    this.warnOnProviderLimit(draft);

    // Verify before the first write: a mailbox that cannot log in should never
    // reach the accounts list, where the poller would start feeding it work.
    await this.transports.verify(draft);

    const { id: _ignored, createdAt, updatedAt, ...data } = draft;
    void _ignored;
    void createdAt;
    void updatedAt;
    const account = await this.prisma.account.create({
      data: { ...data, lastVerifiedAt: new Date() },
      include: { signature: true },
    });

    this.logger.log(`Configured mailbox ${email}`);
    return this.toDto(account);
  }

  async update(id: string, dto: UpdateAccountDto): Promise<AccountDto> {
    const account = await this.findOrThrow(id);
    const touchesConnection = CONNECTION_FIELDS.some(
      (field) => dto[field] !== undefined,
    );

    const next: Account = { ...account };
    if (dto.displayName !== undefined) next.displayName = dto.displayName;
    if (dto.authType !== undefined) next.authType = dto.authType;
    if (dto.smtpHost !== undefined) next.smtpHost = dto.smtpHost;
    if (dto.smtpPort !== undefined) next.smtpPort = dto.smtpPort;
    if (dto.smtpUser !== undefined) next.smtpUser = dto.smtpUser;
    if (dto.requireTls !== undefined) next.requireTls = dto.requireTls;
    if (dto.dailyLimit !== undefined) next.dailyLimit = dto.dailyLimit;
    if (dto.minGapSeconds !== undefined) next.minGapSeconds = dto.minGapSeconds;
    if (dto.timezone !== undefined) {
      next.timezone = this.validTimezone(dto.timezone);
    }
    if (dto.active !== undefined) next.active = dto.active;
    this.applySecrets(next, dto);
    await this.applySignatureLink(next, dto.signatureId);

    if (touchesConnection) {
      this.assertCredentialsComplete(next);
      this.warnOnProviderLimit(next);
      await this.transports.verify(next);
      next.lastVerifiedAt = new Date();
      next.lastError = null;
    }

    const { id: _id, createdAt, updatedAt, ...data } = next;
    void _id;
    void createdAt;
    void updatedAt;
    const saved = await this.prisma.account.update({
      where: { id },
      data,
      include: { signature: true },
    });
    return this.toDto(saved);
  }

  async remove(id: string): Promise<void> {
    const account = await this.findOrThrow(id);
    this.transports.invalidate(account.id);
    await this.prisma.account.delete({ where: { id } });
  }

  /** Re-runs `transporter.verify()` on demand from the account screen. */
  async verify(id: string): Promise<AccountDto> {
    const account = await this.findOrThrow(id);
    try {
      await this.transports.verify(account);
    } catch (error) {
      await this.prisma.account.update({
        where: { id },
        data: { lastError: (error as Error).message },
      });
      throw error;
    }
    const saved = await this.prisma.account.update({
      where: { id },
      data: { lastVerifiedAt: new Date(), lastError: null },
      include: { signature: true },
    });
    return this.toDto(saved);
  }

  // -------------------------------------------------------------------------
  // Throttling
  // -------------------------------------------------------------------------

  /**
   * Atomically reserves one send for this mailbox.
   *
   * Raw SQL rather than the Prisma query API because both gates and the write
   * must be one statement: N workers on M instances must not all pass a
   * `sentToday < dailyLimit` check and then collectively blow through it.
   * Postgres evaluates the WHERE against the row it locks for the UPDATE, so
   * the check and the increment cannot be separated by another transaction.
   *
   * The CASE is what lets the same statement reset the counter on a day
   * boundary in the mailbox's own timezone and increment it otherwise.
   */
  async claimSendSlot(accountId: string): Promise<SlotClaim> {
    const account = UUID.test(accountId)
      ? await this.prisma.account.findUnique({
          where: { id: accountId },
          include: { signature: true },
        })
      : null;

    if (!account) {
      return {
        ok: false,
        reason: 'inactive',
        retryAt: new Date(Date.now() + 60 * 60 * 1000),
        detail: 'Sending mailbox no longer exists.',
      };
    }
    if (!account.active) {
      return {
        ok: false,
        reason: 'inactive',
        retryAt: new Date(Date.now() + 60 * 60 * 1000),
        detail: `Mailbox ${account.email} is paused.`,
      };
    }

    const now = new Date();
    const today = localDate(account.timezone, now);
    const gapCutoff = new Date(now.getTime() - account.minGapSeconds * 1000);

    const claimed = await this.prisma.$queryRaw<Account[]>`
      UPDATE "accounts"
         SET "sentToday" = CASE WHEN "sentTodayDate" = ${today}
                                THEN "sentToday" + 1
                                ELSE 1 END,
             "sentTodayDate" = ${today},
             "lastSentAt" = ${now},
             "updatedAt" = ${now}
       WHERE "id" = ${account.id}::uuid
         AND "active" = true
         AND ("sentTodayDate" IS DISTINCT FROM ${today}
              OR "sentToday" < "dailyLimit")
         AND ("lastSentAt" IS NULL OR "lastSentAt" <= ${gapCutoff})
      RETURNING *`;

    // RETURNING * carries no relations; the signature loaded above is the one
    // this send uses.
    if (claimed.length > 0) {
      return {
        ok: true,
        account: { ...claimed[0], signature: account.signature },
      };
    }

    // The claim failed; work out which of the two gates closed so the caller
    // can reschedule to a time that will actually succeed.
    const atLimit =
      account.sentTodayDate === today && account.sentToday >= account.dailyLimit;
    if (atLimit) {
      return {
        ok: false,
        reason: 'daily_limit',
        retryAt: startOfNextDay(account.timezone, now),
        detail: `${account.email} has reached its daily limit of ${account.dailyLimit}.`,
      };
    }

    return {
      ok: false,
      reason: 'min_gap',
      retryAt: this.nextGapOpening(account, now),
      detail: `${account.email} last sent less than ${account.minGapSeconds}s ago.`,
    };
  }

  /**
   * Gives a reserved slot back after a send that never reached the provider
   * (a connection refused, a TLS failure). `lastSentAt` is deliberately left
   * alone: the pacing gap should still be honoured, because whatever went wrong
   * is a reason to slow down rather than to retry immediately.
   */
  async releaseSendSlot(accountId: string): Promise<void> {
    if (!UUID.test(accountId)) return;
    await this.prisma.account.updateMany({
      where: { id: accountId, sentToday: { gt: 0 } },
      data: { sentToday: { decrement: 1 } },
    });
  }

  async recordSendError(accountId: string, message: string): Promise<void> {
    if (!UUID.test(accountId)) return;
    await this.prisma.account.updateMany({
      where: { id: accountId },
      data: { lastError: message.slice(0, 500) },
    });
  }

  async clearSendError(accountId: string): Promise<void> {
    if (!UUID.test(accountId)) return;
    await this.prisma.account.updateMany({
      where: { id: accountId },
      data: { lastError: null },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * When the pacing gap next opens, plus up to 25% jitter. Without the jitter,
   * a backlog of messages on one mailbox would resume in a perfectly even
   * cadence — the exact machine-gun signature spam filters look for.
   */
  private nextGapOpening(account: Account, now: Date): Date {
    const gapMs = account.minGapSeconds * 1000;
    const since = account.lastSentAt
      ? now.getTime() - account.lastSentAt.getTime()
      : gapMs;
    const remaining = Math.max(0, gapMs - since);
    const jitter = Math.floor(Math.random() * gapMs * 0.25);
    return new Date(now.getTime() + remaining + jitter + 1000);
  }

  private validTimezone(timezone: string | undefined): string {
    if (!timezone) return 'Asia/Singapore';
    if (!DateTime.local().setZone(timezone).isValid) {
      throw ApiException.badRequest(
        `"${timezone}" is not a known IANA timezone (e.g. Asia/Singapore).`,
      );
    }
    return timezone;
  }

  /**
   * An absent secret field means "leave it as it is"; an empty string means
   * "clear it". The UI never receives stored secrets, so without that
   * distinction every save would wipe the password.
   */
  private applySecrets(
    account: Account,
    dto: CreateAccountDto | UpdateAccountDto,
  ): void {
    if (dto.smtpPassword !== undefined) {
      account.smtpPasswordEnc = dto.smtpPassword
        ? this.crypto.encrypt(dto.smtpPassword)
        : null;
    }
    if (dto.oauthClientId !== undefined) {
      account.oauthClientId = dto.oauthClientId || null;
    }
    if (dto.oauthClientSecret !== undefined) {
      account.oauthClientSecretEnc = dto.oauthClientSecret
        ? this.crypto.encrypt(dto.oauthClientSecret)
        : null;
    }
    if (dto.oauthRefreshToken !== undefined) {
      account.oauthRefreshTokenEnc = dto.oauthRefreshToken
        ? this.crypto.encrypt(dto.oauthRefreshToken)
        : null;
    }
    if (dto.oauthTenantId !== undefined) {
      account.oauthTenantId = dto.oauthTenantId || null;
    }
  }

  /**
   * Attaches (an id), detaches (null) or leaves alone (undefined) the library
   * signature. The signature itself is written in the library, never here.
   */
  private async applySignatureLink(
    account: Account,
    signatureId: string | null | undefined,
  ): Promise<void> {
    if (signatureId === undefined) return;
    if (signatureId === null) {
      account.signatureId = null;
      return;
    }
    const exists =
      UUID.test(signatureId) &&
      (await this.prisma.signature.count({ where: { id: signatureId } })) > 0;
    if (!exists) {
      throw ApiException.badRequest('That signature no longer exists.');
    }
    account.signatureId = signatureId;
  }

  private assertCredentialsComplete(account: Account): void {
    if (account.authType === 'smtp_password') {
      if (!account.smtpPasswordEnc) {
        throw ApiException.badRequest(
          'An SMTP password is required for password authentication.',
        );
      }
      return;
    }
    const missing = [
      !account.oauthClientId && 'client ID',
      !account.oauthClientSecretEnc && 'client secret',
      !account.oauthRefreshTokenEnc && 'refresh token',
    ].filter(Boolean);
    if (missing.length) {
      throw ApiException.badRequest(
        `OAuth authentication needs a ${missing.join(', ')}.`,
      );
    }
  }

  /** Logs, rather than blocks — the published ceilings move, the code does not. */
  private warnOnProviderLimit(account: Account): void {
    const preset = PROVIDER_PRESETS.find(
      (candidate) =>
        candidate.smtpHost === account.smtpHost &&
        candidate.providerDailyLimit !== null,
    );
    if (
      preset?.providerDailyLimit &&
      account.dailyLimit > preset.providerDailyLimit
    ) {
      this.logger.warn(
        `${account.email}: dailyLimit ${account.dailyLimit} exceeds the ` +
          `published ${preset.label} ceiling of ${preset.providerDailyLimit}.`,
      );
    }
  }

  toDto(account: SendingAccount): AccountDto {
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      authType: account.authType,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      smtpUser: account.smtpUser,
      requireTls: account.requireTls,
      // Booleans only — a masked hint would still leak the secret's length.
      hasPassword: Boolean(account.smtpPasswordEnc),
      hasOAuthCredentials: Boolean(
        account.oauthClientId &&
          account.oauthClientSecretEnc &&
          account.oauthRefreshTokenEnc,
      ),
      signatureId: account.signatureId,
      signatureName: account.signature?.name ?? null,
      dailyLimit: account.dailyLimit,
      minGapSeconds: account.minGapSeconds,
      timezone: account.timezone,
      sentToday: sentTodayOf(account),
      sentTodayDate: account.sentTodayDate,
      lastSentAt: account.lastSentAt?.toISOString() ?? null,
      lastError: account.lastError,
      lastVerifiedAt: account.lastVerifiedAt?.toISOString() ?? null,
      active: account.active,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }
}

/** Re-exported so callers keep a single import for the row type. */
export type { Account };
export { Prisma };
