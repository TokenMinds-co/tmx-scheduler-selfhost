import { Global, Module } from '@nestjs/common';
import { AppConfig, CONFIG, loadConfig } from './configuration';

/**
 * Resolves the environment exactly once, at boot, and publishes it globally.
 *
 * Global because the async factories of BullModule and
 * JwtModule all need it, and a dynamic module's factory can only inject from
 * global providers or from its own imports — this is the former, and it keeps
 * a bad environment failing at startup rather than at the first send.
 */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [CONFIG],
})
export class AppConfigModule {}
