import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { AppConfig, CONFIG } from '../config/configuration';

/**
 * Stored ciphertext format: `v1.<iv>.<authTag>.<ciphertext>`, all base64url.
 *
 * The version prefix is what makes key rotation possible: a future `v2` can
 * use a new key while `decrypt` still understands `v1`, so re-encryption can
 * run as a background sweep instead of a stop-the-world migration.
 */
const VERSION = 'v1';
const IV_BYTES = 12;

@Injectable()
export class CryptoService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.config.credsKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(stored: string): string {
    const [version, iv, authTag, ciphertext] = stored.split('.');
    if (version !== VERSION || !iv || !authTag || !ciphertext) {
      throw new Error('Stored secret is not in a recognised format');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.config.credsKey,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Unsubscribe links carry the recipient address plus this signature. Keyed
   * with UNSUBSCRIBE_SECRET rather than the session secret so a leaked link
   * cannot be turned into an admin token.
   */
  signUnsubscribe(email: string): string {
    return createHmac('sha256', this.config.unsubscribeSecret)
      .update(email.toLowerCase())
      .digest('base64url');
  }

  /**
   * Signs a tracking hit.
   *
   * The destination URL is inside the signature, not merely alongside it. A
   * redirect endpoint that will forward to whatever `u` says is an open
   * redirect, and an open redirect on a sending domain gets that domain
   * blocklisted — which takes the campaign down, not just the tracking.
   *
   * Keyed with TRACKING_SECRET so a leaked tracking link cannot be replayed as
   * an unsubscribe or a session.
   */
  signTracking(kind: string, emailId: string, url = ''): string {
    return createHmac('sha256', this.config.trackingSecret)
      // Length-prefixed so ("click", "ab", "c") and ("click", "a", "bc")
      // cannot collide into the same signature.
      .update(`${kind}:${emailId.length}:${emailId}:${url}`)
      .digest('base64url');
  }

  verifyTracking(
    kind: string,
    emailId: string,
    url: string,
    signature: string,
  ): boolean {
    return this.constantTimeEquals(
      this.signTracking(kind, emailId, url),
      signature,
    );
  }

  private constantTimeEquals(expected: string, provided: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    // Length must match before timingSafeEqual, which throws on mismatch.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  verifyUnsubscribe(email: string, signature: string): boolean {
    const expected = Buffer.from(this.signUnsubscribe(email));
    const provided = Buffer.from(signature);
    // Length must match before timingSafeEqual, which throws on mismatch.
    return (
      expected.length === provided.length && timingSafeEqual(expected, provided)
    );
  }
}

/**
 * Identity of a queued message for duplicate detection.
 *
 * Covers everything the recipient would actually see: who it is from, who it is
 * to, the subject, the body in both alternatives, and the merge fields that
 * personalise it. Change any of those and it is a different message, because to
 * the person receiving it, it is.
 *
 * `scheduledAt` is the one deliberate omission. Correcting a send time and
 * re-importing is the common case, and keying on the time would deliver the
 * same pitch twice over a typo — which is the failure worth protecting against,
 * since nobody has to notice for it to happen.
 *
 * The corollary is worth stating: editing a body and re-importing now queues a
 * *second* message rather than being skipped. That is the intent — but if the
 * edit was a correction rather than a new message, cancel the original.
 */
export function dedupeKey(input: {
  sendingEmail: string;
  toEmail: string;
  subject: string;
  group: string | null;
  bodyText: string;
  bodyHtml: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
}): string {
  // JSON.stringify rather than a join: it quotes and escapes each field, so
  // ("sub|ject", "") can never hash the same as ("sub", "ject").
  return createHash('sha1')
    .update(
      JSON.stringify([
        input.sendingEmail.toLowerCase(),
        input.toEmail.toLowerCase(),
        input.subject.trim().toLowerCase(),
        (input.group ?? '').trim().toLowerCase(),
        input.bodyText.trim(),
        (input.bodyHtml ?? '').trim(),
        (input.firstName ?? '').trim().toLowerCase(),
        (input.lastName ?? '').trim().toLowerCase(),
        (input.company ?? '').trim().toLowerCase(),
      ]),
    )
    .digest('hex');
}
