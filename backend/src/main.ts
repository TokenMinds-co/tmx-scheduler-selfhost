import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, CONFIG } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(CONFIG);
  const logger = new Logger('Bootstrap');

  app.use(helmet({ contentSecurityPolicy: false }));

  // Behind a reverse proxy every request otherwise appears to come from the
  // proxy itself, which would put every recipient in the world into a single
  // rate-limit bucket and record the proxy's address on every tracking event.
  // Trusting one hop is right for a single nginx/Caddy in front; raise it only
  // if there are genuinely more proxies, since each trusted hop is one more
  // place a client could forge its own address.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Everything except the unsubscribe landing lives under /api; that one route
  // is public and its URL ends up inside emails, so it stays short.
  app.setGlobalPrefix('api', {
    // These three sit inside sent mail or in a load balancer's config, where
    // the URL is permanent and brevity is worth something.
    exclude: ['unsubscribe', 'health', 't/c', 't/o'],
  });

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      // An unexpected field is a client bug worth surfacing, not something to
      // quietly drop — especially on the account form, where a typo'd secret
      // field would otherwise look like a successful save.
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Lets Nest run onApplicationShutdown, which stops the poller and drains the
  // SMTP pools instead of dropping a send mid-flight on deploy.
  app.enableShutdownHooks();

  await app.listen(config.port);
  logger.log(`API listening on http://localhost:${config.port}`);
  logger.log(`Admin UI origins allowed: ${config.corsOrigins.join(', ')}`);
  if (config.dryRunSending) {
    logger.warn('DRY_RUN_SENDING is on — no mail will actually be sent.');
  }
}

void bootstrap();
