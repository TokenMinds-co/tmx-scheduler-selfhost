import { textToHtml } from './html';

describe('textToHtml', () => {
  it('turns blocks into paragraphs and newlines into breaks', () => {
    expect(textToHtml('Hi Ada\nThanks\n\nGrace')).toBe(
      '<p>Hi Ada<br />Thanks</p>\n<p>Grace</p>',
    );
  });

  it('escapes markup in the text', () => {
    expect(textToHtml('<b>hi</b> & bye')).toBe(
      '<p>&lt;b&gt;hi&lt;/b&gt; &amp; bye</p>',
    );
  });

  describe('bare URLs', () => {
    // A link the mail client invents on display never passes through link
    // rewriting, so a plain-text body would otherwise record no clicks at all.
    it('become anchors', () => {
      expect(textToHtml('See https://example.com/pricing today')).toContain(
        '<a href="https://example.com/pricing" target="_blank" rel="noopener noreferrer">' +
          'https://example.com/pricing</a> today',
      );
    });

    it('link http as well as https', () => {
      expect(textToHtml('http://x.test')).toContain('<a href="http://x.test"');
    });

    it('leave sentence punctuation outside the link', () => {
      const output = textToHtml('Book here: https://x.test/demo. Thanks!');
      expect(output).toContain('href="https://x.test/demo"');
      expect(output).toContain('</a>. Thanks!');
    });

    it('keep a closing parenthesis the URL opened itself', () => {
      expect(
        textToHtml('(see https://en.wikipedia.org/wiki/Foo_(bar))'),
      ).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"');
    });

    it('drop a closing parenthesis that belongs to the sentence', () => {
      expect(textToHtml('(see https://x.test/a)')).toContain(
        'href="https://x.test/a"',
      );
    });

    it('escape a query string ampersand inside the attribute', () => {
      expect(textToHtml('https://x.test/?a=1&b=2')).toContain(
        'href="https://x.test/?a=1&amp;b=2"',
      );
    });

    it('stop at a surrounding angle bracket or quote', () => {
      expect(textToHtml('<https://x.test>')).toContain(
        '&lt;<a href="https://x.test"',
      );
      expect(textToHtml('"https://x.test"')).toContain('</a>&quot;');
    });

    it('ignore a scheme with no address after it', () => {
      expect(textToHtml('https://.')).not.toContain('<a ');
    });
  });
});
