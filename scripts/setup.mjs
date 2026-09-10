#!/usr/bin/env node
/**
 * Creates the local env files with real secrets.
 *
 * Idempotent by design: an existing file is never touched. Regenerating
 * CREDS_KEY on a database that already holds encrypted SMTP passwords would
 * make every one of them permanently unreadable, so "leave it alone" is the
 * only safe default here.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Env vars that must be unique per install, and how to generate each. */
const GENERATED = {
  CREDS_KEY: () => randomBytes(32).toString('base64'),
  JWT_SECRET: () => randomBytes(48).toString('base64url'),
  UNSUBSCRIBE_SECRET: () => randomBytes(32).toString('base64url'),
  TRACKING_SECRET: () => randomBytes(32).toString('base64url'),
  SEED_ADMIN_PASSWORD: () => randomBytes(12).toString('base64url'),
};

function setupBackendEnv() {
  const target = join(root, 'backend', '.env');
  if (existsSync(target)) {
    console.log('backend/.env       already exists — left untouched');
    return null;
  }

  let contents = readFileSync(join(root, 'backend', '.env.example'), 'utf8');
  const generated = {};

  for (const [key, generate] of Object.entries(GENERATED)) {
    const value = generate();
    generated[key] = value;
    // Anchored to the start of a line so a mention inside a comment is not
    // mistaken for the assignment.
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (!pattern.test(contents)) {
      throw new Error(`.env.example has no ${key} line to fill in`);
    }
    contents = contents.replace(pattern, `${key}=${value}`);
  }

  writeFileSync(target, contents);
  console.log('backend/.env       created with fresh secrets');
  return generated;
}

function setupFrontendEnv() {
  const target = join(root, 'frontend', '.env.local');
  if (existsSync(target)) {
    console.log('frontend/.env.local already exists — left untouched');
    return;
  }
  copyFileSync(join(root, 'frontend', '.env.local.example'), target);
  console.log('frontend/.env.local created');
}

const generated = setupBackendEnv();
setupFrontendEnv();

if (generated) {
  console.log(`
The first admin will be seeded as:

  email     ${/^SEED_ADMIN_EMAIL=(.*)$/m.exec(readFileSync(join(root, 'backend', '.env'), 'utf8'))?.[1]}
  password  ${generated.SEED_ADMIN_PASSWORD}

Save that password now — it is only printed here. Change it after signing in.
`);
}

console.log(`Next:
  pnpm infra:up                    start Redis and Mailpit
  pnpm --filter @ims/shared build  build the shared contracts
  pnpm --filter backend db:migrate create the Postgres tables
  pnpm seed                        create the first admin
  pnpm dev                         API on :4000, UI on :3000
`);
