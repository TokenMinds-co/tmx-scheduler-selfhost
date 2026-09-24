import { EMPTY_SIGNATURE_FIELDS, withSignatureState } from '@tmx-scheduler/shared';
import { hasTrackableLink, signatureCallToAction } from './trackable';

/** A builder signature whose P.s. points somewhere, as the library stores it. */
function builtSignature(ctaUrl: string): string {
  return withSignatureState('<div><p>Ada</p></div>', {
    templateId: 'photo-card',
    fields: { ...EMPTY_SIGNATURE_FIELDS, ctaUrl },
  });
}

describe('signatureCallToAction', () => {
  it('reads the P.s. destination the builder recorded', () => {
    expect(signatureCallToAction(builtSignature('tokenminds.co/visibility'))).toBe(
      'https://tokenminds.co/visibility',
    );
  });

  it('is null for a signature whose P.s. is empty', () => {
    expect(signatureCallToAction(builtSignature(''))).toBeNull();
  });

  it('is null for pasted HTML, which records no P.s.', () => {
    expect(
      signatureCallToAction('<p>Ada · <a href="https://x.test">x.test</a></p>'),
    ).toBeNull();
  });

  it('is null with no signature at all', () => {
    expect(signatureCallToAction(null)).toBeNull();
    expect(signatureCallToAction('')).toBeNull();
  });
});

describe('hasTrackableLink', () => {
  const plain = { bodyText: 'Hello Ada, are you free this week?', bodyHtml: null };

  it('is false for a plain message from a mailbox with no P.s.', () => {
    expect(hasTrackableLink({ ...plain, signatureHtml: null })).toBe(false);
  });

  it('is true when the plain-text body carries a URL', () => {
    expect(
      hasTrackableLink({
        ...plain,
        bodyText: 'See https://x.test/demo for the tool.',
        signatureHtml: null,
      }),
    ).toBe(true);
  });

  it('is true when the HTML body carries an anchor', () => {
    expect(
      hasTrackableLink({
        bodyText: 'See the tool.',
        bodyHtml: '<p>See <a href="https://x.test/demo">the tool</a>.</p>',
        signatureHtml: null,
      }),
    ).toBe(true);
  });

  it('is true when only the signature P.s. carries a link', () => {
    expect(
      hasTrackableLink({ ...plain, signatureHtml: builtSignature('x.test') }),
    ).toBe(true);
  });

  it('judges the HTML body alone when one is present, as the builder does', () => {
    // The text body is the plain-text alternative; the builder rewrites the
    // HTML half, so a URL only in the text is never a tracked link.
    expect(
      hasTrackableLink({
        bodyText: 'See https://x.test/demo',
        bodyHtml: '<p>See the tool.</p>',
        signatureHtml: null,
      }),
    ).toBe(false);
  });

  it('falls back to the text body for an empty HTML one', () => {
    expect(
      hasTrackableLink({
        bodyText: 'See https://x.test/demo',
        bodyHtml: '',
        signatureHtml: null,
      }),
    ).toBe(true);
  });

  it('does not count a mailto or a bare domain', () => {
    expect(
      hasTrackableLink({
        bodyText: 'Write to ada@x.test or visit x.test',
        bodyHtml: null,
        signatureHtml: null,
      }),
    ).toBe(false);
  });
});
