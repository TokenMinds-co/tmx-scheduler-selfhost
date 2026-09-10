import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailsService } from '../emails/emails.service';

/**
 * Returns messages abandoned in `sending` to the queue.
 *
 * A message enters `sending` in Postgres and only then becomes a Redis job. If
 * the process dies in that window — or a worker is killed mid-send — nothing
 * else in the system will ever look at that row again: the poller only sees
 * `pending`, and the Redis job either never existed or died with the worker.
 * This sweep is the only thing that makes a restart safe.
 *
 * Running it every minute against a 10-minute default timeout means a genuinely
 * slow send is never reaped out from under a live worker.
 */
@Injectable()
export class ReaperService {
  private readonly logger = new Logger(ReaperService.name);

  constructor(private readonly emails: EmailsService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'reap-stuck-sends' })
  async sweep(): Promise<void> {
    try {
      await this.emails.reapStuckClaims();
    } catch (error) {
      this.logger.error(`Reaper sweep failed: ${(error as Error).message}`);
    }
  }
}
