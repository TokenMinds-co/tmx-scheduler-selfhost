import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { DomainCheckService } from './domain-check.service';
import { AccountsController } from './accounts.controller';
import { TransportService } from './transport.service';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, TransportService, DomainCheckService],
  // The sender needs both: the service for the throttle claim, the transport
  // cache so a campaign send reuses the same pooled connection as a test send.
  exports: [AccountsService, TransportService],
})
export class AccountsModule {}
