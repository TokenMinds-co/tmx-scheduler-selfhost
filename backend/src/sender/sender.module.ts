import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { EmailsModule } from '../emails/emails.module';
import { PollerService } from './poller.service';
import { ReaperService } from './reaper.service';
import { SendProcessor } from './send.processor';
import { SEND_QUEUE } from './sender.constants';

@Module({
  imports: [
    AccountsModule,
    EmailsModule,
    BullModule.registerQueue({
      name: SEND_QUEUE,
      defaultJobOptions: {
        // Nothing reads a finished job: success and failure are both recorded
        // on the queue document, which is what the dashboard shows. Keeping
        // completed jobs would also make a re-claimed message's job id collide
        // with its own retained history.
        removeOnComplete: true,
        // A short tail of failures is worth keeping for `bull-board`-style
        // inspection when a worker itself is misbehaving.
        removeOnFail: 100,
      },
    }),
  ],
  providers: [PollerService, ReaperService, SendProcessor],
  exports: [PollerService],
})
export class SenderModule {}
