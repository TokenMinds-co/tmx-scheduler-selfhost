export const SEND_QUEUE = 'send';

export interface SendJobData {
  emailId: string;
}

/**
 * How many times a transient failure is retried before the message is marked
 * failed and left for an operator.
 */
export const MAX_ATTEMPTS = 4;

/**
 * Backoff for transient failures: 1m, 4m, 15m. Deliberately slow — the usual
 * cause is the provider asking us to ease off, and a fast retry answers that
 * by pushing harder.
 */
export const RETRY_BACKOFF_MS = [60_000, 240_000, 900_000];

export function backoffFor(attempt: number): number {
  const base =
    RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)] ??
    RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
  // Up to 20% jitter so a provider outage does not produce a synchronised
  // retry stampede from every message it failed at once.
  return base + Math.floor(Math.random() * base * 0.2);
}
