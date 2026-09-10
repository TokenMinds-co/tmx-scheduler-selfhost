import { Global, Module } from '@nestjs/common';
import { SuppressionService } from './suppression.service';
import { SuppressionController } from './suppression.controller';

/**
 * Global: the importer, the send worker and the unsubscribe route all consult
 * the list, across three different modules.
 */
@Global()
@Module({
  controllers: [SuppressionController],
  providers: [SuppressionService],
  exports: [SuppressionService],
})
export class SuppressionModule {}
