import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { seedAdmin } from './seed-admin';

/**
 * Creates the first administrator on the first boot against an empty database.
 *
 * Runs on every start, does nothing on all but the first — see `seedAdmin` for
 * why an empty `users` table is the right guard. A failure here is fatal on
 * purpose: it can only happen when the database is empty, which means the
 * deployment is unusable anyway, and a process that exits is easier to notice
 * than a login screen that rejects everything.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const outcome = await seedAdmin(this.prisma);

    if (outcome.status === 'created') {
      this.logger.warn(
        `Created the first administrator ${outcome.email} from SEED_ADMIN_*. ` +
          'Change the password after signing in.',
      );
    } else if (outcome.status === 'raced') {
      this.logger.log('Another instance created the first administrator.');
    }
    // 'skipped' is the steady state and says nothing worth a log line.
  }
}
