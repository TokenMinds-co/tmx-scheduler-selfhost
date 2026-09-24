/**
 * Every environment value the app reads, resolved once at boot. Anything
 * missing that the app cannot invent a safe default for throws here rather
 * than at the first send — a misconfigured CREDS_KEY should stop deployment,
 * not corrupt stored secrets.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  databaseUrl: string;
  redisUrl: string;
  credsKey: Buffer;
  jwtSecret: string;
  jwtExpiresIn: string;
  unsubscribeSecret: string;
  trackingSecret: string;
  trackingBaseUrl: string;
  publicApiUrl: string;
  pollIntervalMs: number;
  claimBatchSize: number;
  sendConcurrency: number;
  stuckSendingTimeoutMs: number;
  dryRunSending: boolean;
}

export function loadConfig(): AppConfig {
  const credsKey = Buffer.from(required('CREDS_KEY'), 'base64');
  if (credsKey.length !== 32) {
    throw new Error(
      `CREDS_KEY must decode to exactly 32 bytes (got ${credsKey.length}). ` +
        'Generate one with: pnpm --filter backend keygen',
    );
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: int('PORT', 4000),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    credsKey,
    jwtSecret: required('JWT_SECRET'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    unsubscribeSecret: required('UNSUBSCRIBE_SECRET'),
    trackingSecret: required('TRACKING_SECRET'),
    publicApiUrl: (
      process.env.PUBLIC_API_URL ?? 'http://localhost:4000'
    ).replace(/\/+$/, ''),
    // Tracking links live on their own host in production so the sending
    // domain's reputation and the redirect endpoint can be managed apart.
    // Falls back to the API origin, which is what makes local Mailpit testing
    // work end to end.
    // Truthiness rather than ??: the env file ships the key with an empty
    // value to document it, and an empty string is not nullish.
    trackingBaseUrl: (
      process.env.TRACKING_BASE_URL ||
      process.env.PUBLIC_API_URL ||
      'http://localhost:4000'
    ).replace(/\/+$/, ''),
    pollIntervalMs: int('POLL_INTERVAL_MS', 2000),
    claimBatchSize: int('CLAIM_BATCH_SIZE', 50),
    sendConcurrency: int('SEND_CONCURRENCY', 5),
    stuckSendingTimeoutMs: int('STUCK_SENDING_TIMEOUT_MS', 10 * 60 * 1000),
    dryRunSending: bool('DRY_RUN_SENDING', false),
  };
}

export const CONFIG = 'APP_CONFIG';
