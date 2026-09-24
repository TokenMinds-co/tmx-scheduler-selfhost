import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { AppConfig, CONFIG } from '../config/configuration';
import { EmailsService } from '../emails/emails.service';
import { AccountsService } from '../accounts/accounts.service';
import { TransportService } from '../accounts/transport.service';
import { SuppressionService } from '../suppression/suppression.service';
import { MessageBuilder } from '../mail/message-builder';
import { classifySmtpFailure } from '../mail/smtp-error';
import {
  backoffFor,
  MAX_ATTEMPTS,
  SEND_QUEUE,
  SendJobData,
} from './sender.constants';

/**
 * Sends one message.
 *
 * The processor never throws for an expected outcome. A throttle deferral, a
 * bounce and a transient error are all normal states of a mail queue, and each
 * is recorded on the queue document where the dashboard can show it. Letting
 * BullMQ retry on top of that would double every attempt and hide the reason.
 */
@Processor(SEND_QUEUE)
export class SendProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SendProcessor.name);

  constructor(
    private readonly emails: EmailsService,
    private readonly accounts: AccountsService,
    private readonly transports: TransportService,
    private readonly suppression: SuppressionService,
    private readonly messages: MessageBuilder,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  /**
   * `@Processor` takes concurrency as a decorator argument, which is evaluated
   * at import time — before the config is loaded. Setting it on the live worker
   * is what keeps SEND_CONCURRENCY an environment variable rather than a
   * constant baked into the build.
   */
  onModuleInit(): void {
    this.worker.concurrency = this.config.sendConcurrency;
    this.logger.log(
      `Send worker running with concurrency ${this.config.sendConcurrency}` +
        (this.config.dryRunSending ? ' (DRY RUN — nothing will be sent)' : ''),
    );
  }

  async process(job: Job<SendJobData>): Promise<void> {
    const email = await this.emails.findById(job.data.emailId);
    if (!email) {
      this.logger.warn(`Message ${job.data.emailId} no longer exists`);
      return;
    }

    // Anything but `sending` means someone else already moved it — an operator
    // cancelled it, or the reaper returned it after a restart and a later claim
    // is now the live one. Sending here would deliver mail twice.
    if (email.status !== 'sending') {
      this.logger.debug(
        `Skipping ${email.id}: status is ${email.status}, not sending`,
      );
      return;
    }

    // Re-check suppression at the last moment. An address can land on the list
    // between the import and the scheduled send — that gap is often days.
    if (await this.suppression.isSuppressed(email.toEmail)) {
      await this.emails.cancelPendingForRecipient(
        email.toEmail,
        'Recipient is on the suppression list',
      );
      await this.emails.markFailed(
        email.id,
        'Cancelled: recipient is on the suppression list.',
      );
      return;
    }

    const claim = await this.accounts.claimSendSlot(email.accountId);
    if (!claim.ok) {
      // Not a failure: the mailbox is pacing itself. The message goes back to
      // `pending` at the time the gate reopens, without consuming an attempt.
      await this.emails.deferTo(email.id, claim.retryAt, claim.detail, false);
      this.logger.debug(
        `Deferred ${email.toEmail} to ${claim.retryAt.toISOString()}: ${claim.reason}`,
      );
      return;
    }

    const account = claim.account;
    const message = this.messages.build(account, {
      toEmail: email.toEmail,
      subject: email.subject,
      bodyText: email.bodyText,
      bodyHtml: email.bodyHtml,
      firstName: email.firstName,
      lastName: email.lastName,
      company: email.company,
      includeUnsubscribe: true,
      // Campaign mail is tracked; the test-send button is not, because a hit
      // on a message the operator sent themselves would only pollute the data.
      emailId: email.id,
      track: true,
    });

    if (this.config.dryRunSending) {
      this.logger.log(
        `DRY RUN — would send "${email.subject}" from ${account.email} to ${email.toEmail}`,
      );
      await this.emails.markSent(email.id, 'dry-run');
      return;
    }

    try {
      const transporter = await this.transports.get(account);
      const info = await transporter.sendMail(message);
      await this.emails.markSent(email.id, info.messageId ?? null);
      await this.accounts.clearSendError(account.id);
      this.logger.log(`Sent to ${email.toEmail} from ${account.email}`);
    } catch (error) {
      await this.handleFailure(email.id, account.id, error, email);
    }
  }

  private async handleFailure(
    emailId: string,
    accountId: unknown,
    error: unknown,
    email: { toEmail: string; attempts: number },
  ): Promise<void> {
    const failure = classifySmtpFailure(error);
    await this.accounts.recordSendError(
      accountId as string,
      `${failure.code ?? 'ERR'}: ${failure.message}`,
    );

    if (failure.isRecipientRejection) {
      // The server named this address as undeliverable. That is a hard bounce,
      // and continuing to mail it is what destroys a sending domain's
      // reputation — so it goes on the suppression list immediately rather
      // than waiting for the deferred bounce-handling work.
      await this.suppression.add(
        email.toEmail,
        'bounce',
        `Hard bounce: ${failure.message}`.slice(0, 500),
        emailId,
      );
      await this.emails.cancelPendingForRecipient(
        email.toEmail,
        'Address hard-bounced',
      );
      await this.emails.markFailed(
        emailId,
        `Hard bounce (${failure.code}): ${failure.message}`,
      );
      this.logger.warn(`Hard bounce for ${email.toEmail}; suppressed`);
      return;
    }

    if (failure.kind === 'permanent') {
      await this.emails.markFailed(
        emailId,
        `Permanent failure (${failure.code}): ${failure.message}`,
      );
      this.logger.error(
        `Permanent failure sending to ${email.toEmail}: ${failure.message}`,
      );
      return;
    }

    // Transient. If the connection never produced an SMTP reply, nothing left
    // the building, so give the mailbox's daily allowance back. A 4xx reply
    // means the provider did see the message, and the quota is spent.
    if (failure.code === null) {
      await this.accounts.releaseSendSlot(accountId as string);
    }

    const nextAttempt = email.attempts + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      await this.emails.markFailed(
        emailId,
        `Gave up after ${nextAttempt} attempts. Last error: ${failure.message}`,
      );
      this.logger.error(
        `Giving up on ${email.toEmail} after ${nextAttempt} attempts`,
      );
      return;
    }

    const retryAt = new Date(Date.now() + backoffFor(email.attempts));
    await this.emails.deferTo(
      emailId,
      retryAt,
      `Attempt ${nextAttempt} failed (${failure.code ?? 'network'}): ${failure.message}`,
      true,
    );
    this.logger.warn(
      `Retrying ${email.toEmail} at ${retryAt.toISOString()} (attempt ${nextAttempt})`,
    );
  }
}
