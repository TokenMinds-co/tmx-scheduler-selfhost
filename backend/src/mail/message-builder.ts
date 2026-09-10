import { Inject, Injectable } from '@nestjs/common';
import type { SendMailOptions } from 'nodemailer';
import { AppConfig, CONFIG } from '../config/configuration';
import { CryptoService } from '../common/crypto.service';
import { escapeHtml, textToHtml } from '../common/html';
import { rewriteLinks } from './link-rewrite';
import { TrackingService } from '../tracking/tracking.service';
import type { Account } from '@prisma/client';

export interface MessageInput {
  toEmail: string;
  subject: string;
  bodyText: string;
  /** Supplied by the import when the sheet carried HTML; otherwise derived. */
  bodyHtml?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  /** Set on real campaign mail; omitted for the "send test to myself" button. */
  includeUnsubscribe?: boolean;
  /**
   * The queue row this message belongs to. Present for campaign mail, absent
   * for a test send — which is why a test send is never tracked: there is
   * nothing to attribute the hit to.
   */
  emailId?: string | null;
  /** Rewrite body links and append the open pixel. */
  track?: boolean;
}

/**
 * Assembles the wire message: body, signature and unsubscribe line, in both
 * the text and HTML alternatives.
 *
 * SMTP adds none of this — a mailbox's web-UI signature exists only in that web
 * UI — so anything the recipient should see has to be built here.
 */
@Injectable()
export class MessageBuilder {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly tracking: TrackingService,
  ) {}

  build(account: Account, input: MessageInput): SendMailOptions {
    const includeUnsubscribe = input.includeUnsubscribe ?? true;
    const unsubscribeUrl = includeUnsubscribe
      ? this.unsubscribeUrl(input.toEmail)
      : null;

    const text = this.buildText(account, input, unsubscribeUrl);
    const html = this.buildHtml(account, input, unsubscribeUrl);

    const message: SendMailOptions = {
      from: { name: account.displayName, address: account.email },
      to: input.toEmail,
      subject: this.personalise(input.subject, input),
      text,
      html,
      // Replies belong in the mailbox that sent the message; without this an
      // alias in `from` can send replies somewhere nobody reads.
      replyTo: account.email,
    };

    if (unsubscribeUrl) {
      message.headers = {
        // RFC 8058: Gmail and Outlook render a native unsubscribe control from
        // these two headers, which is far more likely to be used than a link at
        // the bottom — and far better for us than a spam report.
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${account.email}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }

    return message;
  }

  unsubscribeUrl(toEmail: string): string {
    const email = toEmail.toLowerCase();
    const params = new URLSearchParams({
      e: email,
      s: this.crypto.signUnsubscribe(email),
    });
    return `${this.config.publicApiUrl}/unsubscribe?${params.toString()}`;
  }

  private buildText(
    account: Account,
    input: MessageInput,
    unsubscribeUrl: string | null,
  ): string {
    const parts = [this.personalise(input.bodyText, input).trim()];
    if (account.signatureText.trim()) {
      parts.push(account.signatureText.trim());
    }
    if (unsubscribeUrl) {
      parts.push(`Don't want these emails? Unsubscribe: ${unsubscribeUrl}`);
    }
    return parts.join('\n\n--\n\n');
  }

  private buildHtml(
    account: Account,
    input: MessageInput,
    unsubscribeUrl: string | null,
  ): string {
    const personalised = input.bodyHtml
      ? this.personalise(input.bodyHtml, input, true)
      : textToHtml(this.personalise(input.bodyText, input));

    // Only the body is rewritten. The signature's links are the company's own
    // and a click on a logo is not campaign engagement; the unsubscribe link
    // must stay untouched or the RFC 8058 one-click header stops matching the
    // link beside it.
    const trackable = input.track && input.emailId;
    const body = trackable
      ? rewriteLinks(personalised, (destination) =>
          this.tracking.clickUrl(input.emailId as string, destination),
        )
      : personalised;

    const sections = [body];
    if (account.signatureHtml.trim()) {
      sections.push(account.signatureHtml);
    }
    if (unsubscribeUrl) {
      sections.push(
        `<p style="color:#6b7280;font-size:12px">` +
          `Don't want these emails? ` +
          `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>.` +
          `</p>`,
      );
    }

    // Last thing before the closing tags: a client that truncates a long
    // message truncates the pixel rather than the content.
    const pixel = trackable
      ? `<img src="${escapeHtml(
          this.tracking.openUrl(input.emailId as string),
        )}" width="1" height="1" alt="" style="display:block;border:0" />`
      : '';

    return [
      '<!doctype html><html><body style="margin:0;padding:0">',
      `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827">`,
      sections.join('\n<br />\n'),
      pixel,
      '</div></body></html>',
    ].join('\n');
  }

  /**
   * Fills `{{firstName}}`-style placeholders from the sheet's columns. An
   * unknown placeholder is left untouched rather than blanked, so a typo is
   * visible in a test send instead of silently producing "Hi ,".
   */
  /**
   * Fills `{{firstName}}`-style placeholders from the sheet's columns.
   *
   * `escape` matters on the HTML path and only there. The body was sanitised at
   * import, but substitution happens here, afterwards — so an unescaped value
   * would land in the markup having never passed the sanitiser. A company name
   * containing a quote is enough to break the `href` it sits inside, which
   * since link rewriting is a tracked link.
   *
   * The text path passes false because `textToHtml` escapes the whole string
   * afterwards; escaping twice would show the recipient `&amp;`.
   */
  private personalise(
    template: string,
    input: MessageInput,
    escape = false,
  ): string {
    const values: Record<string, string> = {
      firstName: input.firstName ?? '',
      lastName: input.lastName ?? '',
      company: input.company ?? '',
      email: input.toEmail,
    };
    return template.replace(
      /\{\{\s*(\w+)\s*\}\}/g,
      (match, key: string) => {
        const value = values[key];
        // An unknown placeholder is left untouched rather than blanked, so a
        // typo is visible in a test send instead of producing "Hi ,".
        if (value === undefined) return match;
        return escape ? escapeHtml(value) : value;
      },
    );
  }
}
