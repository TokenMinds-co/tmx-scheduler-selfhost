import { Module } from '@nestjs/common';
import { UnsubscribeController } from './unsubscribe.controller';
import { EmailsModule } from '../emails/emails.module';

@Module({
  imports: [EmailsModule],
  controllers: [UnsubscribeController],
})
export class UnsubscribeModule {}
