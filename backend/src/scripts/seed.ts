import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { seedAdmin } from '../auth/seed-admin';

loadEnv();

/**
 * Creates the first administrator from the command line.
 *
 * The server now does this itself on first boot, so this exists for the cases
 * booting cannot cover: seeding a database before anything is deployed against
 * it, or recovering an installation whose only administrator was deleted. It
 * shares `seedAdmin` with the boot hook rather than repeating the guard, so
 * the two can never disagree about when it is safe to run.
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient();
  try {
    const outcome = await seedAdmin(prisma);
    if (outcome.status === 'created') {
      console.log(
        `Created admin ${outcome.email}. Change the password after first login.`,
      );
    } else if (outcome.status === 'raced') {
      console.log('Another process created the first administrator.');
    } else {
      console.log(
        `${outcome.existing} user(s) already exist — leaving them alone. ` +
          'Add more from Settings → Users in the admin UI.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
