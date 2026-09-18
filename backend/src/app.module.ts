import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, CONFIG } from './config/configuration';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { TrackingModule } from './tracking/tracking.module';
import { CommonModule } from './common/common.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AccountsModule } from './accounts/accounts.module';
import { SignaturesModule } from './signatures/signatures.module';
import { EmailsModule } from './emails/emails.module';
import { BatchesModule } from './batches/batches.module';
import { SuppressionModule } from './suppression/suppression.module';
import { SenderModule } from './sender/sender.module';
import { UnsubscribeModule } from './unsubscribe/unsubscribe.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Must come before anything whose factory injects CONFIG.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    AppConfigModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    // Reads DATABASE_URL itself; AppConfig validates it is present at boot.
    PrismaModule,
    TrackingModule,
    BullModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.redisUrl },
        prefix: 'ims',
      }),
    }),

    CommonModule,
    MailModule,
    AuthModule,
    AuditModule,
    AccountsModule,
    SignaturesModule,
    EmailsModule,
    BatchesModule,
    SuppressionModule,
    SenderModule,
    UnsubscribeModule,
  ],
  controllers: [HealthController],
  providers: [
    // Authentication is on by default; a route opts out with `@Public()`.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
