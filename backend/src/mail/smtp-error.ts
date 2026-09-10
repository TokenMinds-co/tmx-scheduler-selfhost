/**
 * How a failed send should be treated.
 *
 * SMTP's own convention is the deciding one: a 4xx reply means "not now, ask
 * again", a 5xx means "never". Getting this backwards is expensive in both
 * directions — retrying a 5xx hammers a provider with mail it has already
 * refused, and failing a 4xx throws away a message a greylist would have
 * accepted a minute later.
 */
export type FailureKind = 'permanent' | 'transient';

export interface ClassifiedFailure {
  kind: FailureKind;
  code: number | null;
  message: string;
  /** True when the remote server named this recipient as undeliverable. */
  isRecipientRejection: boolean;
}

/** Connection-level failures nodemailer surfaces instead of an SMTP reply. */
const TRANSIENT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNECTION',
  'ESOCKET',
  'EDNS',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
]);

/**
 * 5xx replies that are about the *sender's* state rather than the recipient's
 * address. Retrying later is right for these even though the class says
 * permanent — the mailbox is over quota or rate limited, not wrong.
 */
const SENDER_STATE_PATTERNS = [
  /quota/i,
  /rate limit/i,
  /too many/i,
  /try again later/i,
  /temporarily (deferred|rejected)/i,
  /4\.7\.0/,
  /5\.4\.5/, // Gmail daily sending quota exceeded
];

export function classifySmtpFailure(error: unknown): ClassifiedFailure {
  const err = error as {
    responseCode?: number;
    code?: string;
    response?: string;
    message?: string;
  };
  const message = (err.response ?? err.message ?? String(error)).slice(0, 1000);
  const code = typeof err.responseCode === 'number' ? err.responseCode : null;

  if (err.code && TRANSIENT_ERROR_CODES.has(err.code)) {
    return { kind: 'transient', code, message, isRecipientRejection: false };
  }

  if (code === null) {
    // No SMTP reply at all — almost always a socket or TLS problem, which is
    // worth another attempt.
    return { kind: 'transient', code, message, isRecipientRejection: false };
  }

  if (code >= 400 && code < 500) {
    return { kind: 'transient', code, message, isRecipientRejection: false };
  }

  if (code >= 500) {
    const senderState = SENDER_STATE_PATTERNS.some((p) => p.test(message));
    return {
      kind: senderState ? 'transient' : 'permanent',
      code,
      message,
      // 550/551/553 name a bad recipient; 552 is a full mailbox, which is the
      // recipient's problem but not a reason to suppress the address forever.
      isRecipientRejection:
        !senderState && (code === 550 || code === 551 || code === 553),
    };
  }

  return { kind: 'transient', code, message, isRecipientRejection: false };
}
