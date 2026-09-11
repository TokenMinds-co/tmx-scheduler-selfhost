import { MessageBuilder } from './message-builder';
import type { CryptoService } from '../common/crypto.service';
import type { TrackingService } from '../tracking/tracking.service';
import type { AppConfig } from '../config/configuration';
import type { Account } from '@prisma/client';

const config = {
  publicApiUrl: 'https://api.tmx.center',
  trackingBaseUrl: 'https://api.tmx.center',
} as AppConfig;

const crypto = {
  signUnsubscribe: () => 'sig',
} as unknown as CryptoService;

const tracking = {
  clickUrl: (emailId: string, destination: string) =>
    `https://api.tmx.center/t/c?m=${emailId}&u=${encodeURIComponent(destination)}`,
  openUrl: (emailId: string) => `https://api.tmx.center/t/o?m=${emailId}`,
} as unknown as TrackingService;

const account = {
  email: 'outreach@email.tmx.center',
  displayName: 'Kevin',
  signatureHtml: '',
  signatureText: '',
} as Account;

const builder = new MessageBuilder(config, crypto, tracking);

/** The HTML alternative of a built message. */
function html(input: Parameters<MessageBuilder['build']>[1]): string {
  return builder.build(account, input).html as string;
}

describe('personalisation', () => {
  const base = {
    toEmail: 'ada@example.com',
    subject: 'Hello',
    bodyText: 'plain',
    firstName: 'Ada',
    company: 'Analytical Engines',
    includeUnsubscribe: false,
  };

  it('fills placeholders in an HTML body', () => {
    expect(
      html({ ...base, bodyHtml: '<p>Hi {{firstName}} at {{company}}</p>' }),
    ).toContain('Hi Ada at Analytical Engines');
  });

  describe('a merge value cannot inject markup', () => {
    // The body is sanitised at import, but substitution happens afterwards —
    // so without escaping here the value never passes a sanitiser at all.
    it('escapes a tag smuggled in through a name', () => {
      const output = html({
        ...base,
        firstName: '<img src=x onerror=alert(1)>',
        bodyHtml: '<p>Hi {{firstName}}</p>',
      });
      expect(output).not.toContain('<img src=x');
      expect(output).toContain('&lt;img');
    });

    it('escapes a quote that would otherwise break an href', () => {
      // A company name with a quote in it lands inside the attribute and ends
      // it early, which since link rewriting means breaking a tracked link.
      const output = html({
        ...base,
        company: 'Ada" onclick="steal()',
        bodyHtml: '<a href="https://x.test?c={{company}}">go</a>',
      });
      expect(output).not.toContain('onclick="steal()"');
      expect(output).toContain('&quot;');
    });
  });

  it('does not double-escape a plain-text body', () => {
    // textToHtml escapes the whole string afterwards; escaping in both places
    // would show the recipient a literal &amp;.
    const output = html({
      ...base,
      company: 'Bell & Co',
      bodyText: 'Hi {{firstName}} at {{company}}',
      bodyHtml: null,
    });
    expect(output).toContain('Bell &amp; Co');
    expect(output).not.toContain('&amp;amp;');
  });

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    // A typo should be obvious in a test send, not silently produce "Hi ,".
    expect(html({ ...base, bodyHtml: '<p>Hi {{firstname}}</p>' })).toContain(
      '{{firstname}}',
    );
  });

  it('leaves the plain-text alternative unescaped', () => {
    const message = builder.build(account, {
      ...base,
      company: 'Bell & Co',
      bodyText: 'Hi {{company}}',
    });
    expect(message.text).toContain('Bell & Co');
  });
});

describe('body font', () => {
  it("uses Gmail's small/1.5 Arial, Helvetica, sans-serif", () => {
    const output = html({
      toEmail: 'ada@example.com',
      subject: 'Hello',
      bodyText: 'Hi',
      includeUnsubscribe: false,
    });
    expect(output).toContain(
      'font-family:Arial,Helvetica,sans-serif;font-size:small;line-height:1.5',
    );
  });
});

describe('click tracking', () => {
  const base = {
    toEmail: 'ada@example.com',
    subject: 'Hello',
    includeUnsubscribe: false,
    emailId: 'email-1',
    track: true,
  };

  it('tracks a bare URL in a plain-text body', () => {
    // The sheet's Message column with the HTML column left blank: the URL is
    // only ever a link because textToHtml made it one.
    const output = html({
      ...base,
      bodyText: 'Book a call: https://tokenminds.co/demo.',
      bodyHtml: null,
    });
    expect(output).toContain(
      `href="https://api.tmx.center/t/c?m=email-1&amp;u=${encodeURIComponent(
        'https://tokenminds.co/demo',
      )}"`,
    );
    expect(output).not.toContain('href="https://tokenminds.co/demo"');
  });

  it('leaves links untracked on a test send', () => {
    const output = html({
      ...base,
      emailId: null,
      bodyText: 'https://tokenminds.co',
      bodyHtml: null,
    });
    expect(output).toContain('href="https://tokenminds.co"');
  });
});
