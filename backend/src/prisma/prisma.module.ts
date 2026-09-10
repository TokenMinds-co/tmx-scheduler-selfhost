import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so feature modules need no per-model registration: the client already
 * exposes every model as a property, so a per-module import would be ceremony
 * with nothing behind it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
