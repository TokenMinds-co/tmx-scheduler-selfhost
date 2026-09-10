import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';
import type { EmailEventKind } from '@prisma/client';
import { AppConfig, CONFIG } from '../config/configuration';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { judge, rulesFromEnv, type Verdict } from './classify';
import type { TrackingBreakdown, TrackingStats } from '@ims/shared';

/** A hit, as observed at the endpoint. */
export interface TrackingHit {
  emailId: string;
  kind: EmailEventKind;
  url: string | null;
  userAgent: string | null;
  ip: string | null;
}

/**
 * A reverse lookup should never hold up a recipient's redirect, and a dead
 * resolver should never turn into a hung request.
 */
const PTR_TIMEOUT_MS = 1500;

/**
 * How close together hits have to be to count as one burst.
 *
 * A gateway fetches every link in a message in a single pass, so its hits land
 * within a second or two of each other. Two seconds is wide enough to catch
 * that and far too narrow for a person to have read the message and chosen a
 * second link.
 */
const BURST_WINDOW_MS = 2000;

/** Upper bound of each delay bucket, in seconds. */
const DELAY_BUCKETS = [10, 30, 120, 3600, 86_400, Number.MAX_SAFE_INTEGER];

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------------------
  // Building links
  // ---------------------------------------------------------------------------

  /**
   * The destination travels base64url-encoded and inside the signature. Both
   * matter: encoding keeps a query string intact through a query string, and
   * signing is what stops this being an open redirect.
   */
  clickUrl(emailId: string, destination: string): string {
    const encoded = Buffer.from(destination, 'utf8').toString('base64url');
    const signature = this.crypto.signTracking('click', emailId, destination);
    return (
      `${this.config.trackingBaseUrl}/t/c` +
      `?m=${encodeURIComponent(emailId)}` +
      `&u=${encodeURIComponent(encoded)}` +
      `&s=${encodeURIComponent(signature)}`
    );
  }

  openUrl(emailId: string): string {
    const signature = this.crypto.signTracking('open', emailId);
    return (
      `${this.config.trackingBaseUrl}/t/o` +
      `?m=${encodeURIComponent(emailId)}` +
      `&s=${encodeURIComponent(signature)}`
    );
  }

  // ---------------------------------------------------------------------------
  // Reading links back
  // ---------------------------------------------------------------------------

  /**
   * Returns the destination a click token authorises, or `null` if the
   * signature does not hold.
   *
   * Verification failure returns null rather than falling back to the supplied
   * URL: forwarding an unverified destination is precisely the open redirect
   * this design exists to avoid.
   */
  resolveClick(emailId: string, encoded: string, signature: string): string | null {
    if (!emailId || !encoded || !signature) return null;

    let destination: string;
    try {
      destination = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    // Re-check the scheme after decoding. A signature proves we minted the
    // link, but a `javascript:` destination should never have been minted and
    // must not be honoured if one ever was.
    if (!/^https?:\/\//i.test(destination)) return null;
    if (!this.crypto.verifyTracking('click', emailId, destination, signature)) {
      return null;
    }
    return destination;
  }

  verifyOpen(emailId: string, signature: string): boolean {
    if (!emailId || !signature) return false;
    return this.crypto.verifyTracking('open', emailId, '', signature);
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  /**
   * Writes the hit and everything that would let us judge it later.
   *
   * Deliberately never throws: the caller has already answered the recipient,
   * and a logging failure must not surface as a broken link. Nothing here
   * decides whether the hit counts — that is read-time work against thresholds
   * that can change, which is only possible because this stores the evidence
   * rather than a verdict.
   */
  async record(hit: TrackingHit): Promise<void> {
    try {
      const email = await this.prisma.queuedEmail.findUnique({
        where: { id: hit.emailId },
        select: { id: true, sentAt: true, firstOpenAt: true, firstClickAt: true },
      });
      if (!email) return;

      const now = new Date();
      const sentAt = email.sentAt ?? now;
      const delaySeconds = Math.max(
        0,
        Math.round((now.getTime() - sentAt.getTime()) / 1000),
      );

      const windowStart = new Date(now.getTime() - BURST_WINDOW_MS);
      const recent = await this.prisma.emailEvent.findMany({
        where: {
          emailId: email.id,
          kind: hit.kind,
          occurredAt: { gte: windowStart },
        },
        select: { url: true },
      });

      // Distinct destinations, this hit included. Two fetches of the same link
      // are a retry; two fetches of different links are a sweep.
      const links = new Set(
        recent.map((event) => event.url).filter((url): url is string => !!url),
      );
      if (hit.url) links.add(hit.url);
      const burstSize = Math.max(1, links.size);

      await this.prisma.emailEvent.create({
        data: {
          emailId: email.id,
          kind: hit.kind,
          url: hit.url,
          delaySeconds,
          burstSize,
          userAgent: hit.userAgent?.slice(0, 500) ?? null,
          ip: hit.ip,
          ptr: await this.reverseDns(hit.ip),
          occurredAt: now,
        },
      });

      // The earlier hits of a sweep were recorded before anyone knew a sweep
      // was happening — the first of three links looks like a single click
      // until the third arrives. Backfilling the whole window means the
      // evidence describes the burst rather than the order it was observed in.
      if (burstSize > 1) {
        await this.prisma.emailEvent.updateMany({
          where: {
            emailId: email.id,
            kind: hit.kind,
            occurredAt: { gte: windowStart },
          },
          data: { burstSize },
        });
      }

      // First-touch only: the queue table wants "did this land", and rewriting
      // it on every subsequent hit would lose the moment engagement started.
      const alreadySeen =
        hit.kind === 'open' ? email.firstOpenAt : email.firstClickAt;
      if (!alreadySeen) {
        await this.prisma.queuedEmail.update({
          where: { id: email.id },
          data:
            hit.kind === 'open' ? { firstOpenAt: now } : { firstClickAt: now },
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to record ${hit.kind} for ${hit.emailId}: ${(error as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  /**
   * Engagement for a campaign, judged now rather than when it was recorded.
   *
   * Every hit is re-run through the rules on each call, which is what makes a
   * threshold change retroactive. At campaign volumes the whole event log fits
   * comfortably in memory; if it ever stops fitting, the same judgement can
   * move into SQL because every input is a stored column.
   */
  async stats(group?: string): Promise<TrackingStats> {
    const rules = rulesFromEnv();

    const emails = await this.prisma.queuedEmail.findMany({
      where: { status: 'sent', ...(group ? { group } : {}) },
      select: { id: true },
    });
    const ids = emails.map((email) => email.id);
    if (!ids.length) return empty(rules);

    const events = await this.prisma.emailEvent.findMany({
      where: { emailId: { in: ids } },
      select: {
        emailId: true,
        kind: true,
        delaySeconds: true,
        burstSize: true,
        userAgent: true,
        ptr: true,
      },
    });

    const clicks = tally();
    const opens = tally();
    const reasons = new Map<string, number>();
    const buckets = DELAY_BUCKETS.map((upToSeconds) => ({
      upToSeconds,
      hits: 0,
    }));

    for (const event of events) {
      const { verdict, reason } = judge(event, rules);
      const into = event.kind === 'click' ? clicks : opens;
      into.counts[verdict] += 1;
      if (verdict === 'counted') into.people.add(event.emailId);
      if (verdict !== 'counted') {
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      if (event.kind === 'click') {
        const bucket = buckets.find(
          (candidate) => event.delaySeconds <= candidate.upToSeconds,
        );
        if (bucket) bucket.hits += 1;
      }
    }

    return {
      sent: ids.length,
      clicks: summarise(clicks),
      opens: summarise(opens),
      clickDelayBuckets: buckets,
      reasons: [...reasons.entries()]
        .map(([reason, hits]) => ({ reason, hits }))
        .sort((a, b) => b.hits - a.hits),
      rules,
    };
  }

  /**
   * Resolved here, once, rather than on every read.
   *
   * This is the no-third-party substitute for an IP intelligence service: a PTR
   * ending in a cloud or security provider's domain is the strongest free
   * signal that a hit came from a scanner rather than a person. Most residential
   * addresses resolve to something generic or not at all, which is itself
   * informative.
   */
  private async reverseDns(ip: string | null): Promise<string | null> {
    if (!ip) return null;
    // Loopback and private ranges never have a useful PTR, and the lookup is
    // pure latency during local testing.
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fe80:)/i.test(ip)) {
      return null;
    }
    try {
      const resolver = new Resolver({ timeout: PTR_TIMEOUT_MS, tries: 1 });
      const names = await resolver.reverse(ip);
      return names[0]?.toLowerCase() ?? null;
    } catch {
      // No PTR is the common case for consumer connections, not an error.
      return null;
    }
  }
}

interface Tally {
  counts: Record<Verdict, number>;
  people: Set<string>;
}

function tally(): Tally {
  return { counts: { counted: 0, machine: 0, suspect: 0 }, people: new Set() };
}

function summarise(input: Tally): TrackingBreakdown {
  return { ...input.counts, people: input.people.size };
}

function empty(rules: TrackingStats['rules']): TrackingStats {
  const none: TrackingBreakdown = {
    counted: 0,
    machine: 0,
    suspect: 0,
    people: 0,
  };
  return {
    sent: 0,
    clicks: none,
    opens: none,
    clickDelayBuckets: DELAY_BUCKETS.map((upToSeconds) => ({
      upToSeconds,
      hits: 0,
    })),
    reasons: [],
    rules,
  };
}
