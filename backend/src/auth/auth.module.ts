import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig, CONFIG } from '../config/configuration';
import { AuthService } from './auth.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { AuthController } from './auth.controller';

/**
 * Global so the app-level `JwtAuthGuard` can inject `JwtService` without every
 * module re-registering it.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        // jsonwebtoken types `expiresIn` as a template-literal union ("12h",
        // "7d", …) which an env var cannot satisfy statically. The value is
        // validated by jsonwebtoken itself at sign time.
        signOptions: {
          expiresIn: config.jwtExpiresIn as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminBootstrapService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
