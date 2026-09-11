import { Module } from '@nestjs/common';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';

@Module({
  controllers: [SignaturesController],
  providers: [SignaturesService],
})
export class SignaturesModule {}
