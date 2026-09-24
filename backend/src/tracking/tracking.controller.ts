import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/jwt-auth.guard';
import { TrackingService } from './tracking.service';

/**
 * A 1×1 transparent GIF. Smaller than the equivalent PNG and understood by
 * every mail client ever written, which is the only requirement.
 */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Open and click endpoints.
 *
 * Both answer the recipient first and record afterwards. A click must not wait
 * on a database write, and a database that is briefly unavailable must not turn
 * every link in every campaign into a broken one — recording is best-effort,
 * redirecting is not.
 *
 * Excluded from the global `/api` prefix in main.ts: these URLs sit inside sent
 * mail, where they are permanent, and short is worth something.
 */
// Exempt from the global rate limit. These endpoints are hit by recipients
// rather than by operators, in bursts the size of a campaign, and a 429 here
// does not merely lose an event — it hands someone who clicked a link an error
// page instead of the site they were going to. The signature check is the
// access control that matters; a request without a valid HMAC is refused
// whatever the rate.
@SkipThrottle()
@Controller('t')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Public()
  @Get('c')
  click(
    @Query('m') emailId: string,
    @Query('u') encoded: string,
    @Query('s') signature: string,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    const destination = this.tracking.resolveClick(
      emailId ?? '',
      encoded ?? '',
      signature ?? '',
    );

    // A bad signature is refused outright rather than redirected anyway. This
    // endpoint forwarding an unverified destination would make the sending
    // domain an open redirect, and an open redirect gets a domain blocklisted.
    if (!destination) {
      response.status(400).type('text/plain').send('Invalid or expired link.');
      return;
    }

    response.redirect(302, destination);

    void this.tracking.record({
      emailId,
      kind: 'click',
      url: destination,
      userAgent: request.get('user-agent') ?? null,
      ip: clientIp(request),
    });
  }

  @Public()
  @Get('o')
  // Caching would hide every open after the first, and a proxy caching it would
  // hide them for everyone.
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Pragma', 'no-cache')
  open(
    @Query('m') emailId: string,
    @Query('s') signature: string,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    const valid = this.tracking.verifyOpen(emailId ?? '', signature ?? '');

    // The pixel is returned either way. A broken image in a recipient's message
    // is a worse outcome than an unrecorded open, and refusing tells whoever is
    // probing which ids exist.
    response.type('image/gif').send(PIXEL);
    if (!valid) return;

    void this.tracking.record({
      emailId,
      kind: 'open',
      url: null,
      userAgent: request.get('user-agent') ?? null,
      ip: clientIp(request),
    });
  }
}

/**
 * The address the hit came from.
 *
 * Behind a reverse proxy `request.ip` is the proxy, so the forwarded header
 * wins where present — its first entry is the original client. Only trust this
 * when the app actually sits behind a proxy you control; otherwise a caller can
 * set the header to anything.
 */
function clientIp(request: Request): string | null {
  const forwarded = request.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return request.ip ?? null;
}

/**
 * Engagement figures for the dashboard. Authenticated, unlike the two
 * endpoints above, because this is operator data rather than something a
 * recipient's mail client asks for.
 */
@Controller('tracking')
export class TrackingReportController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('stats')
  stats(@Query('group') group?: string) {
    return this.tracking.stats(group?.trim() || undefined);
  }

  /** Every hit on one message, judged — the evidence behind a queue chip. */
  @Get('emails/:id/events')
  events(@Param('id') id: string) {
    return this.tracking.eventsFor(id);
  }
}
