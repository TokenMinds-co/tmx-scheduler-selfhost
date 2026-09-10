import { Controller, Get, Header, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CryptoService } from '../common/crypto.service';
import { escapeHtml } from '../common/html';
import { SuppressionService } from '../suppression/suppression.service';
import { EmailsService } from '../emails/emails.service';
import { Public } from '../auth/jwt-auth.guard';

/**
 * The one route reachable without a session. It is mounted outside the `/api`
 * prefix so the link in an email stays short and readable.
 *
 * Both verbs land here: `GET` is the human clicking the footer link, `POST` is
 * the RFC 8058 one-click request Gmail and Outlook send from their own
 * unsubscribe button without ever showing the user a page.
 */
@Controller('unsubscribe')
export class UnsubscribeController {
  constructor(
    private readonly crypto: CryptoService,
    private readonly suppression: SuppressionService,
    private readonly emails: EmailsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  async oneClick(@Query('e') email: string, @Query('s') signature: string) {
    await this.process(email, signature);
    // One-click has no UI; the mail client only cares that it succeeded.
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async landing(
    @Query('e') email: string,
    @Query('s') signature: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const done = await this.process(email, signature);
    if (!done) {
      res.status(400);
      return page(
        'Link not valid',
        'This unsubscribe link is incomplete or has been altered. Reply to the message and we will remove you by hand.',
      );
    }
    return page(
      'You have been unsubscribed',
      `We will not email ${escapeHtml(email)} again. Anything already scheduled has been cancelled.`,
    );
  }

  /**
   * Suppress the address and cancel whatever is still queued for it. Doing only
   * the first would leave already-scheduled mail to go out after someone asked
   * to stop — the exact complaint the header is meant to prevent.
   */
  private async process(email: string, signature: string): Promise<boolean> {
    if (!email || !signature) return false;
    if (!this.crypto.verifyUnsubscribe(email, signature)) return false;

    await this.suppression.add(email, 'unsubscribe', 'One-click unsubscribe');
    await this.emails.cancelPendingForRecipient(email, 'Recipient unsubscribed');
    return true;
  }
}

function page(heading: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;color:#0f172a">
  <div style="max-width:32rem;margin:12vh auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
    <h1 style="margin:0 0 .75rem;font-size:1.25rem">${escapeHtml(heading)}</h1>
    <p style="margin:0;line-height:1.6;color:#475569">${body}</p>
  </div>
</body></html>`;
}
