import { escapeHtml } from '../common/html';

/**
 * Swaps every outbound link in a message body for a tracking URL.
 *
 * Operates on the sanitised HTML rather than on the source, so the markup is
 * already normalised to double-quoted attributes by sanitize-html and a regex
 * is sufficient — parsing the document again to change one attribute would be
 * cost without benefit.
 *
 * Only `http` and `https` are rewritten. `mailto:` and `tel:` are actions
 * rather than destinations and a redirect through us would break both;
 * fragments and relative URLs have no meaning outside the page they came from.
 *
 * `toTrackingUrl` may return null to leave a particular link as it is.
 */
export function rewriteLinks(
  html: string,
  toTrackingUrl: (destination: string) => string | null,
): string {
  return html.replace(/href="([^"]*)"/gi, (whole, raw: string) => {
    const destination = decodeAttribute(raw);
    if (!/^https?:\/\//i.test(destination)) return whole;
    const tracked = toTrackingUrl(destination);
    return tracked ? `href="${escapeHtml(tracked)}"` : whole;
  });
}

/**
 * Undoes the entity encoding an HTML attribute carries, so the URL that gets
 * signed is the one the recipient will actually be sent to.
 *
 * A query string of `?a=1&b=2` lives in the attribute as `?a=1&amp;b=2`.
 * Signing the encoded form and redirecting to the decoded one would fail
 * verification on every link that takes more than one parameter.
 */
function decodeAttribute(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Ampersand last: decoding it first would let `&amp;lt;` become `<`.
    .replace(/&amp;/g, '&');
}
