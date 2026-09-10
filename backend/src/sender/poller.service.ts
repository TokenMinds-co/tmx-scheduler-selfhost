import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { AppConfig, CONFIG } from '../config/configuration';
import { EmailsService } from '../emails/emails.service';
import { SEND_QUEUE, SendJobData } from './sender.constants';

const TICK_NAME = 'queue-poller';

/**
 * Moves due mail from Postgres into the send queue.
 *
 * The two-stage design (claim in Postgres, then enqueue) is what makes the
 * operator actions work: a message sitting in `pending` can be cancelled or
 * rescheduled with one update, which is not true of a job already delayed
 * inside Redis. Redis holds only work that is due *right now*.
 */
@Injectable()
export class PollerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PollerService.name);
  /** Guards against a slow tick overlapping the next one. */
  private ticking = false;
  private stopped = false;

  constructor(
    @InjectQueue(SEND_QUEUE) private readonly queue: Queue<SendJobData>,
    private readonly emails: EmailsService,
    private readonly scheduler: SchedulerRegistry,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    // Registered dynamically rather than with @Interval so the period stays
    // configurable per environment.
    const interval = setInterval(
      () => void this.tick(),
      this.config.pollIntervalMs,
    );
    this.scheduler.addInterval(TICK_NAME, interval);
    this.logger.log(
      `Polling for due mail every ${this.config.pollIntervalMs}ms ` +
        `(up to ${this.config.claimBatchSize} per tick)`,
    );
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.scheduler.doesExist('interval', TICK_NAME)) {
      this.scheduler.deleteInterval(TICK_NAME);
    }
  }

  async tick(): Promise<number> {
    if (this.ticking || this.stopped) return 0;
    this.ticking = true;
    let claimed = 0;

    try {
      while (claimed < this.config.claimBatchSize && !this.stopped) {
        const email = await this.emails.claimNextDue();
        if (!email) break;

        const emailId = email.id as string;
        try {
          await this.queue.add(
            'send',
            { emailId },
            {
              // The claim timestamp makes the id unique per claim. A fixed id
              // would collide with the retained record of the previous run
              // every time a message is deferred and re-claimed, and BullMQ
              // drops a duplicate id silently — the message would never send
              // again. The separator is "-" because BullMQ rejects ":" in a
              // custom job id (it is its own key separator).
              jobId: `${emailId}-${email.claimedAt?.getTime() ?? Date.now()}`,
              // Retries are owned by the queue document, not by BullMQ: the
              // dashboard has to show the attempt count and the next attempt
              // time, and two independent retry mechanisms would disagree.
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: 100,
            },
          );
          claimed += 1;
        } catch (error) {
          // The row is already `sending` but no job exists to advance it. Put
          // it straight back rather than leaving it for the reaper — this is a
          // Redis problem, and the message should be retried in seconds, not
          // after the stuck-claim timeout.
          await this.emails.deferTo(
            emailId,
            new Date(Date.now() + 30_000),
            `Could not enqueue for sending: ${(error as Error).message}`,
            false,
          );
          throw error;
        }
      }
    } catch (error) {
      this.logger.error(
        `Poll tick failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.ticking = false;
    }

    if (claimed) this.logger.debug(`Enqueued ${claimed} message(s)`);
    return claimed;
  }
}
