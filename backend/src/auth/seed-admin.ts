import * as bcrypt from 'bcryptjs';

/** The subset of the client this needs, so the CLI and the app can both call it. */
export interface AdminSeedStore {
  user: {
    count(): Promise<number>;
    create(args: {
      data: {
        email: string;
        name: string;
        role: 'admin';
        passwordHash: string;
      };
    }): Promise<unknown>;
  };
}

export type AdminSeedOutcome =
  | { status: 'created'; email: string }
  | { status: 'skipped'; existing: number }
  | { status: 'raced' };

const MIN_PASSWORD_LENGTH = 10;

/**
 * Creates the first administrator, once, on an empty database.
 *
 * The guard is `users` being empty rather than a flag or a marker row: an
 * existing deployment always has at least one administrator, so "no users" is
 * the only state that unambiguously means "nobody can get in yet". That makes
 * the operation safe to run on every boot and every redeploy — a CI pipeline
 * that restarts the service twenty times a day seeds nothing after the first.
 *
 * The seed configuration is only read when seeding is actually needed. A
 * long-running deployment must not start failing because someone removed
 * SEED_ADMIN_PASSWORD from the environment months after it was used.
 */
export async function seedAdmin(
  store: AdminSeedStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminSeedOutcome> {
  const existing = await store.user.count();
  if (existing > 0) return { status: 'skipped', existing };

  const email = (env.SEED_ADMIN_EMAIL ?? '').toLowerCase().trim();
  const password = env.SEED_ADMIN_PASSWORD ?? '';
  const name = env.SEED_ADMIN_NAME?.trim() || 'Admin';

  // Thrown rather than warned: the database is empty, so without this nobody
  // can sign in at all. Failing at first boot is far easier to diagnose than a
  // login screen that rejects every password.
  if (!email || !password) {
    throw new Error(
      'The database has no users and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set, ' +
        'so no administrator can be created and nobody would be able to sign in.',
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  try {
    await store.user.create({
      data: {
        email,
        name,
        role: 'admin',
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    return { status: 'created', email };
  } catch (error) {
    // Two instances booting together both saw an empty table. The unique index
    // on email settles it; the loser simply did not need to do anything.
    if ((error as { code?: string }).code === 'P2002') {
      return { status: 'raced' };
    }
    throw error;
  }
}
