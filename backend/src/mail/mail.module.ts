import { Global, Module } from '@nestjs/common';
import { MessageBuilder } from './message-builder';

/**
 * Message assembly has no dependency on the queue or the accounts CRUD, so it
 * lives on its own — that is what lets the accounts screen send a test message
 * without the accounts module importing the sender, which would close a cycle.
 */
@Global()
@Module({
  providers: [MessageBuilder],
  exports: [MessageBuilder],
})
export class MailModule {}
