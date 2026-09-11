import {
  SIGNATURE_TEMPLATES,
  EMPTY_SIGNATURE_FIELDS,
  renderSignatureHtml,
  renderSignatureText,
  withSignatureState,
  decodeSignatureState,
  type SignatureFields,
} from '@ims/shared';
import { sanitizeSignatureHtml, htmlToText } from './html';

/**
 * The templates render in the browser; the API sanitises what comes back. Those
 * are two files that have to agree on a vocabulary of tags, attributes and CSS
 * properties, and when they disagree nothing fails loudly — the operator sees a
 * correct preview and the recipient gets a signature with its layout stripped
 * out. These tests are the thing that fails instead.
 */

const FILLED: SignatureFields = {
  fullName: 'Anchor Chan',
  jobTitle: 'Chief Executive Officer',
  company: 'TMX',
  photoUrl: 'https://cdn.tmx.center/anchor.png',
  logoUrl: 'https://cdn.tmx.center/tmx-logo.png',
  websiteUrl: 'visibility.tmx.center',
  websiteLabel: '',
  email: 'anchor@mail.tmx.center',
  phone: '+65 6123 4567',
  address: '139 Cecil Street #03-10 YSY Building, Singapore (069539)',
  ctaText: 'See the full video of how it works',
  ctaUrl: 'https://www.youtube.com/watch?v=QDuVvj94P_A',
  accentColor: '#1d4ed8',
};

describe('signature templates', () => {
  for (const template of SIGNATURE_TEMPLATES) {
    describe(template.label, () => {
      const html = renderSignatureHtml(template.id, FILLED);

      it('survives the server sanitiser byte for byte', () => {
        // Not "close enough": any difference is layout the recipient loses, and
        // the diff on failure names the exact property that was dropped.
        expect(sanitizeSignatureHtml(html)).toBe(html);
      });

      it('sets its text in the message body font', () => {
        // Gmail's `small/1.5 Arial,Helvetica,sans-serif`, as longhand. Every
        // text line carries it, the name included.
        const font =
          'font-family:Arial, Helvetica, sans-serif;font-size:small;line-height:1.5';
        expect(sanitizeSignatureHtml(html)).toContain(font);
        expect(html).not.toMatch(/font-size:(?!small|1px)/);
      });

      it('keeps the details a signature exists for', () => {
        const clean = sanitizeSignatureHtml(html);
        expect(clean).toContain('Anchor Chan');
        expect(clean).toContain('Chief Executive Officer, TMX');
        expect(clean).toContain('mailto:anchor@mail.tmx.center');
        expect(clean).toContain('https://visibility.tmx.center');
        expect(clean).toContain('139 Cecil Street');
      });

      it('keeps the layout table, and the rule where the layout has one', () => {
        expect(html).toContain('role="presentation"');
        // 'Text only' drops the hairline deliberately — it is the compact one.
        if (template.id !== 'minimal') {
          expect(sanitizeSignatureHtml(html)).toContain('border-top:1px solid');
        }
      });

      it('renders nothing at all from an empty form', () => {
        expect(renderSignatureHtml(template.id, EMPTY_SIGNATURE_FIELDS)).toBe('');
      });
    });
  }

  it('only emits images the template was given', () => {
    const withoutImages = renderSignatureHtml('photo-card', {
      ...FILLED,
      photoUrl: '',
      logoUrl: '',
    });
    expect(withoutImages).not.toContain('<img');
    // The details column must not be left holding an empty 124px gutter.
    expect(withoutImages).not.toContain('width="124"');
  });

  it('drops an http image rather than downgrading the message', () => {
    const html = renderSignatureHtml('photo-card', {
      ...FILLED,
      logoUrl: 'http://cdn.tmx.center/tmx-logo.png',
    });
    expect(html).not.toContain('http://');
  });

  it('refuses a javascript: link', () => {
    const html = renderSignatureHtml('minimal', {
      ...FILLED,
      websiteUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<b>Web</b>');
  });

  it('escapes a name that contains markup', () => {
    const html = renderSignatureHtml('minimal', {
      ...FILLED,
      fullName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(sanitizeSignatureHtml(html)).toContain('&lt;script&gt;');
  });

  it('falls back to the first template for an unknown id', () => {
    expect(renderSignatureHtml('not-a-template', FILLED)).toBe(
      renderSignatureHtml(SIGNATURE_TEMPLATES[0].id, FILLED),
    );
  });
});

describe('signature plain text', () => {
  it('carries the same details as the HTML, one per line', () => {
    expect(renderSignatureText(FILLED)).toBe(
      [
        'Anchor Chan',
        'Chief Executive Officer, TMX',
        'Web: visibility.tmx.center',
        'Email: anchor@mail.tmx.center',
        'Phone: +65 6123 4567',
        '139 Cecil Street #03-10 YSY Building, Singapore (069539)',
        'P.s. See the full video of how it works: https://www.youtube.com/watch?v=QDuVvj94P_A',
      ].join('\n'),
    );
  });

  it('beats the generic HTML-to-text fallback on a table layout', () => {
    // The fallback flattens the contact row into one run of text, because in
    // the HTML it *is* one line held apart by non-breaking spaces. That is the
    // reason the text part is authored rather than salvaged.
    const derived = htmlToText(renderSignatureHtml('photo-card', FILLED));
    expect(derived).not.toContain('Email: ');
    expect(renderSignatureText(FILLED).split('\n')).toContain(
      'Email: anchor@mail.tmx.center',
    );
  });

  it('leaves no blank lines where a field was skipped', () => {
    const text = renderSignatureText({
      ...EMPTY_SIGNATURE_FIELDS,
      fullName: 'Kevin',
      email: 'kevin@tokenminds.co',
    });
    expect(text).toBe('Kevin\nEmail: kevin@tokenminds.co');
  });
});

describe('builder round-trip', () => {
  const state = { templateId: 'photo-card' as const, fields: FILLED };
  const stored = sanitizeSignatureHtml(
    withSignatureState(renderSignatureHtml('photo-card', FILLED), state),
  );

  it('reopens in the builder after a sanitiser pass', () => {
    expect(decodeSignatureState(stored)).toEqual(state);
  });

  it('reports hand-written HTML as not from a template', () => {
    expect(decodeSignatureState('<p>Kevin<br />TokenMinds</p>')).toBeNull();
  });

  it('fills in fields added after a signature was saved', () => {
    const legacy = withSignatureState('<div>x</div>', {
      templateId: 'minimal',
      fields: { fullName: 'Kevin' },
    } as never);
    expect(decodeSignatureState(legacy)?.fields).toEqual({
      ...EMPTY_SIGNATURE_FIELDS,
      fullName: 'Kevin',
    });
  });

  it('cannot break out of the attribute it is stored in', () => {
    const hostile = withSignatureState(renderSignatureHtml('minimal', FILLED), {
      templateId: 'minimal',
      fields: { ...FILLED, fullName: '"><script>alert(1)</script>' },
    });
    expect(hostile).not.toContain('<script>');
    expect(sanitizeSignatureHtml(hostile)).toBe(hostile);
  });
});
