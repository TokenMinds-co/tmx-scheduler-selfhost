import {
  SIGNATURE_TEMPLATES,
  EMPTY_SIGNATURE_FIELDS,
  renderSignatureHtml,
  renderSignatureText,
  withSignatureState,
  decodeSignatureState,
  fillSignature,
  SENDER_EMAIL_PLACEHOLDER,
  type SignatureFields,
} from '@tmx-scheduler/shared';
import { sanitizeSignatureHtml, htmlToText } from './html';

/**
 * The templates render in the browser; the API sanitises what comes back. Those
 * are two files that have to agree on a vocabulary of tags, attributes and CSS
 * properties, and when they disagree nothing fails loudly — the operator sees a
 * correct preview and the recipient gets a signature with its layout stripped
 * out. These tests are the thing that fails instead.
 */

const FILLED: SignatureFields = {
  fullName: 'Ada Lovelace',
  jobTitle: 'Chief Executive Officer',
  company: 'Example Ltd',
  photoUrl: 'https://cdn.example.com/ada.png',
  logoUrl: 'https://cdn.example.com/logo.png',
  websiteUrl: 'example.com',
  websiteLabel: '',
  email: 'ada@example.com',
  phone: '+1 555 0100',
  address: '1 Example Street #01-01, Example City 000000',
  ctaText: 'See the full video of how it works',
  ctaUrl: 'https://videos.example.com/intro',
  accentColor: '#1d4ed8',
};

describe('sender placeholder', () => {
  // A shared signature stores the placeholder rather than an address. It has to
  // come through the sanitiser untouched, including inside the mailto link.
  const html = renderSignatureHtml('photo-card', {
    ...FILLED,
    email: SENDER_EMAIL_PLACEHOLDER,
  });

  it('survives the server sanitiser byte for byte', () => {
    expect(sanitizeSignatureHtml(html)).toBe(html);
  });

  it('fills in as a working mailto link', () => {
    const filled = fillSignature(html, 'ada@inbox.example.com', 'html');
    expect(filled).toContain('href="mailto:ada@inbox.example.com"');
    expect(filled).toContain('>ada@inbox.example.com</a>');
    expect(filled).not.toContain(SENDER_EMAIL_PLACEHOLDER);
  });

  it('fills in the text half too', () => {
    const text = renderSignatureText({
      ...FILLED,
      email: SENDER_EMAIL_PLACEHOLDER,
    });
    expect(fillSignature(text, 'ada@inbox.example.com', 'text')).toContain(
      'Email: ada@inbox.example.com',
    );
  });

  it('escapes the address in the HTML half', () => {
    expect(fillSignature(SENDER_EMAIL_PLACEHOLDER, 'a&b@x.co', 'html')).toBe(
      'a&amp;b@x.co',
    );
  });
});

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
        expect(clean).toContain('Ada Lovelace');
        expect(clean).toContain('Chief Executive Officer, Example Ltd');
        expect(clean).toContain('mailto:ada@example.com');
        expect(clean).toContain('https://example.com');
        expect(clean).toContain('1 Example Street');
      });

      it('keeps the layout table, and the rule where the layout has one', () => {
        expect(html).toContain('role="presentation"');
        // 'Text only' drops the hairline deliberately — it is the compact one.
        if (template.id !== 'minimal') {
          expect(sanitizeSignatureHtml(html)).toContain('border-top:1px solid');
        }
      });

      it('renders nothing at all from an empty form', () => {
        expect(renderSignatureHtml(template.id, EMPTY_SIGNATURE_FIELDS)).toBe(
          '',
        );
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
      logoUrl: 'http://cdn.example.com/logo.png',
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
        'Ada Lovelace',
        'Chief Executive Officer, Example Ltd',
        'Web: example.com',
        'Email: ada@example.com',
        'Phone: +1 555 0100',
        '1 Example Street #01-01, Example City 000000',
        'P.s. See the full video of how it works: https://videos.example.com/intro',
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
      'Email: ada@example.com',
    );
  });

  it('leaves no blank lines where a field was skipped', () => {
    const text = renderSignatureText({
      ...EMPTY_SIGNATURE_FIELDS,
      fullName: 'Grace',
      email: 'grace@example.com',
    });
    expect(text).toBe('Grace\nEmail: grace@example.com');
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
    expect(decodeSignatureState('<p>Grace<br />Example Ltd</p>')).toBeNull();
  });

  it('fills in fields added after a signature was saved', () => {
    const legacy = withSignatureState('<div>x</div>', {
      templateId: 'minimal',
      fields: { fullName: 'Grace' },
    } as never);
    expect(decodeSignatureState(legacy)?.fields).toEqual({
      ...EMPTY_SIGNATURE_FIELDS,
      fullName: 'Grace',
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
