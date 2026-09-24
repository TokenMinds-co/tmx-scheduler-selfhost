import {
  decodeSignatureState,
  normaliseSignatureUrl,
} from '@tmx-scheduler/shared';

/**
 * Whether a message will carry a link that tracking can follow.
 *
 * Answered before the send, from the same three places the builder rewrites:
 * anchors in the HTML body, bare URLs in the plain-text body, and the P.s.
 * link a library signature records about itself. Kept in step with the
 * builder because the point is to say, at import time, exactly what the
 * builder will find at send time — a message this says no to will read as 0%
 * clicked forever, and that is worth knowing while the sheet is still open.
 */

/**
 * The P.s. destination a library signature carries, or null when it has none
 * the tracker can follow. Pasted HTML records no P.s. and so is always null.
 */
export function signatureCallToAction(
  signatureHtml: string | null | undefined,
): string | null {
  if (!signatureHtml) return null;
  const ctaUrl = decodeSignatureState(signatureHtml)?.fields.ctaUrl ?? '';
  const destination = normaliseSignatureUrl(ctaUrl);
  return /^https?:\/\//i.test(destination) ? destination : null;
}

/** The sanitiser normalises attributes to double quotes; `rewriteLinks` relies on that too. */
const HTML_LINK = /href="https?:\/\//i;

/** What `textToHtml` would turn into an anchor: its BARE_URL, needing one character after the scheme. */
const TEXT_LINK = /https?:\/\/[^\s<>"']/i;

export function hasTrackableLink(message: {
  bodyText: string;
  bodyHtml: string | null;
  signatureHtml: string | null | undefined;
}): boolean {
  // Truthiness, not a null check: the builder falls back to the text body for
  // an empty HTML one, so an empty string means "look at the text".
  const bodyHasLink = message.bodyHtml
    ? HTML_LINK.test(message.bodyHtml)
    : TEXT_LINK.test(message.bodyText);
  return bodyHasLink || signatureCallToAction(message.signatureHtml) !== null;
}
