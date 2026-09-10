import { seedAdmin, type AdminSeedStore } from './seed-admin';

const env = {
  SEED_ADMIN_EMAIL: 'Admin@TokenMinds.co',
  SEED_ADMIN_PASSWORD: 'a-long-enough-password',
  SEED_ADMIN_NAME: 'Admin',
};

function store(existing: number, onCreate?: () => never): AdminSeedStore {
  return {
    user: {
      count: async () => existing,
      create: async (args) => {
        if (onCreate) onCreate();
        return args;
      },
    },
  };
}

describe('seedAdmin', () => {
  it('creates the administrator on an empty database', async () => {
    const created: unknown[] = [];
    const result = await seedAdmin(
      {
        user: {
          count: async () => 0,
          create: async (args) => {
            created.push(args.data);
            return args;
          },
        },
      },
      env,
    );

    expect(result).toEqual({ status: 'created', email: 'admin@tokenminds.co' });
    expect(created).toHaveLength(1);
    const data = created[0] as { email: string; role: string; passwordHash: string };
    // Lower-cased on the way in, and never stored in the clear.
    expect(data.email).toBe('admin@tokenminds.co');
    expect(data.role).toBe('admin');
    expect(data.passwordHash).not.toContain('a-long-enough-password');
  });

  describe('does nothing once anyone exists', () => {
    it('skips rather than creating a second administrator', async () => {
      const result = await seedAdmin(
        store(1, () => {
          throw new Error('must not create');
        }),
        env,
      );
      expect(result).toEqual({ status: 'skipped', existing: 1 });
    });

    it('does not even look at the seed configuration', async () => {
      // A deployment that has been running for months must not start failing
      // because someone removed SEED_ADMIN_PASSWORD from the environment.
      const result = await seedAdmin(store(3), {});
      expect(result).toEqual({ status: 'skipped', existing: 3 });
    });
  });

  describe('an empty database with unusable configuration', () => {
    it('fails when the credentials are missing', async () => {
      // Nobody could sign in; exiting is easier to diagnose than a login
      // screen that rejects every password.
      await expect(seedAdmin(store(0), {})).rejects.toThrow(
        /no users and SEED_ADMIN/,
      );
    });

    it('fails on a password too short to be worth having', async () => {
      await expect(
        seedAdmin(store(0), { ...env, SEED_ADMIN_PASSWORD: 'short' }),
      ).rejects.toThrow(/at least 10 characters/);
    });
  });

  it('treats a lost race as success', async () => {
    // Two instances booting together both saw an empty table; the unique index
    // on email settles it and the loser had nothing left to do.
    const result = await seedAdmin(
      store(0, () => {
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      }),
      env,
    );
    expect(result).toEqual({ status: 'raced' });
  });

  it('lets an unexpected database error through', async () => {
    await expect(
      seedAdmin(
        store(0, () => {
          throw Object.assign(new Error('connection lost'), { code: 'P1001' });
        }),
        env,
      ),
    ).rejects.toThrow('connection lost');
  });

  it('defaults the name when none is configured', async () => {
    const created: unknown[] = [];
    await seedAdmin(
      {
        user: {
          count: async () => 0,
          create: async (args) => {
            created.push(args.data);
            return args;
          },
        },
      },
      { SEED_ADMIN_EMAIL: env.SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD },
    );
    expect((created[0] as { name: string }).name).toBe('Admin');
  });
});
