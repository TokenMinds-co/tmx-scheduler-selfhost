import { Global, Module } from '@nestjs/common';
import {
  TrackingController,
  TrackingReportController,
} from './tracking.controller';
import { TrackingService } from './tracking.service';

/**
 * Global because MessageBuilder needs the URL builders and lives in MailModule,
 * which several feature modules already import.
 */
@Global()
@Module({
  controllers: [TrackingController, TrackingReportController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
