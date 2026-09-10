import { Module } from '@nestjs/common';
import { EmailsService } from './emails.service';
import { EmailsController } from './emails.controller';
import { ImportService } from './import.service';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [
    // Mailbox lookup during import, throttle claim during send.
    AccountsModule,
  ],
  controllers: [EmailsController],
  providers: [EmailsService, ImportService],
  exports: [EmailsService, ImportService],
})
export class EmailsModule {}
