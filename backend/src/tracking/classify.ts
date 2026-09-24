/**
 * Deciding whether a hit was a person.
 *
 * Every rule here is a pure function of evidence already stored on the event
 * row. That is the point: thresholds move, the scanner list grows, and when
 * either happens every event we have ever recorded is re-judged by the next
 * read. Nothing is filtered on the way in, so nothing has to be re-collected.
 */

export type Verdict = 'counted' | 'machine' | 'suspect';

export interface TrackingRules {
  /** A hit sooner than this after the send was not a person reading. */
  minDelaySeconds: number;
  /** Distinct links from one message that together mean "scanned, not read". */
  burstLinks: number;
  /**
   * How long after the send a click with no open before it is still treated
   * as a scanner. Wider than `minDelaySeconds` because a gateway that queues
   * its scan can take a minute or two — and because this rule is the only one
   * that can catch a sweep of a message carrying a single tracked link, where
   * a burst is impossible by construction.
   */
  noOpenWindowSeconds: number;
  /**
   * How many different companies' mail one network may click before it is a
   * scanner. A person's connection only ever follows the links in their own
   * mail; a gateway's address pool follows the links in everybody's. It is the
   * one signal a scanner cannot dress up — it can wait ten minutes and wear a
   * browser's user-agent, but it cannot help being the same machine room.
   */
  networkReach: number;
}

export const DEFAULT_RULES: TrackingRules = {
  // A placeholder until the first campaign produces a real delay histogram.
  // Click delay is sharply bimodal — scanners in the first seconds, people
  // minutes to days later — so this wants to sit in the gap, not at a round
  // number chosen for looking tidy.
  minDelaySeconds: 30,
  burstLinks: 3,
  noOpenWindowSeconds: 300,
  networkReach: 3,
};

/** The evidence a verdict is drawn from. */
export interface EventEvidence {
  delaySeconds: number;
  burstSize: number;
  userAgent: string | null;
  ptr: string | null;
  /**
   * For a click: whether the message had registered an open by the time the
   * click arrived. Derived at read time from `firstOpenAt`, so it is evidence
   * like the rest. Left undefined where it is unknown or the hit is an open,
   * and the rule that reads it then stays out of the way.
   */
  openedBefore?: boolean;
  /**
   * Distinct recipient domains whose mail has been clicked from this hit's
   * network (the /24, for IPv4). Counted at read time across the whole log,
   * so it sharpens as a campaign goes out. Domains rather than recipients:
   * colleagues behind one office connection are one company, not a sweep.
   */
  networkReach?: number;
}

export interface Judgement {
  verdict: Verdict;
  /** Which rule decided it, for the reason breakdown in the report. */
  reason: string;
}

/**
 * Substrings that identify an automated fetch.
 *
 * Kept as plain substrings rather than parsed user-agent structure because
 * scanners do not follow the convention closely enough for parsing to help.
 * This list is ours to extend as unknown agents show up in the log — which is
 * the whole reason the raw string is stored.
 */
const SCANNER_AGENTS = [
  // Microsoft Defender for Office 365. By far the most common in B2B, and the
  // single most important entry here.
  'safelinks',
  'bingpreview',
  // Secure email gateways.
  'proofpoint',
  'mimecast',
  'barracuda',
  'symantec',
  'forcepoint',
  'trendmicro',
  'sophos',
  'fireeye',
  'ironport',
  // Generic automation.
  'headlesschrome',
  'phantomjs',
  'python-requests',
  'curl/',
  'wget',
  'go-http-client',
  'java/',
  'okhttp',
  'apache-httpclient',
  'libwww-perl',
  'bot',
  'crawler',
  'spider',
  'preview',
  'scanner',
];

/**
 * Image proxies. An open reported by one of these is real in the sense that a
 * client asked for the image — but Apple asks on delivery, before anyone has
 * read anything, which is why opens are reported separately and never counted
 * as engagement.
 */
const IMAGE_PROXIES = ['googleimageproxy', 'applemail', 'yahoomailproxy'];

/**
 * PTR suffixes that place a hit in a datacenter or a security vendor.
 *
 * This is the no-third-party substitute for an IP intelligence service. It is
 * deliberately weaker than the other signals: plenty of real people browse from
 * corporate networks that resolve into cloud ranges, so a match lowers
 * confidence rather than disqualifying.
 */
const INFRASTRUCTURE_PTR = [
  'amazonaws.com',
  'compute.amazonaws.com',
  'googleusercontent.com',
  'bc.googleusercontent.com',
  '1e100.net',
  'cloudfront.net',
  'azure.com',
  'cloudapp.net',
  'protection.outlook.com',
  'digitalocean.com',
  'linode.com',
  'hetzner.com',
  'ovh.net',
  'vultr.com',
  'scaleway.com',
];

function matches(haystack: string | null, needles: string[]): string | null {
  if (!haystack) return null;
  const lowered = haystack.toLowerCase();
  return needles.find((needle) => lowered.includes(needle)) ?? null;
}

/**
 * Judges one hit.
 *
 * Order matters only for which reason gets reported; any of the first three
 * rules is on its own enough to disqualify.
 */
export function judge(
  evidence: EventEvidence,
  rules: TrackingRules = DEFAULT_RULES,
): Judgement {
  const proxy = matches(evidence.userAgent, IMAGE_PROXIES);
  if (proxy) {
    return { verdict: 'machine', reason: `image proxy (${proxy})` };
  }

  const agent = matches(evidence.userAgent, SCANNER_AGENTS);
  if (agent) {
    return { verdict: 'machine', reason: `scanner agent (${agent})` };
  }

  if (evidence.delaySeconds < rules.minDelaySeconds) {
    return {
      verdict: 'machine',
      reason: `${evidence.delaySeconds}s after send`,
    };
  }

  if (evidence.burstSize >= rules.burstLinks) {
    return {
      verdict: 'machine',
      reason: `${evidence.burstSize} links at once`,
    };
  }

  if (
    evidence.networkReach !== undefined &&
    evidence.networkReach >= rules.networkReach
  ) {
    return {
      verdict: 'machine',
      reason: `same network clicked mail to ${evidence.networkReach} companies`,
    };
  }

  // A scanner follows links but never renders the message, so the open pixel
  // does not fire: clicked within minutes of delivery, never opened, is its
  // fingerprint. Suspect rather than machine, because it is not proof — Outlook
  // blocks images by default, and a person there can click with no open on
  // record. What makes that unlikely is the clock: a stranger reading a cold
  // message and following its link within minutes of it landing is rare, and a
  // gateway doing so is what gateways are for.
  if (
    evidence.openedBefore === false &&
    evidence.delaySeconds < rules.noOpenWindowSeconds
  ) {
    return {
      verdict: 'suspect',
      reason: `clicked ${evidence.delaySeconds}s after send, never opened`,
    };
  }

  // An empty user-agent is not proof — some privacy tooling strips it — but no
  // ordinary browser omits it.
  if (!evidence.userAgent) {
    return { verdict: 'suspect', reason: 'no user agent' };
  }

  const infra = matches(evidence.ptr, INFRASTRUCTURE_PTR);
  if (infra) {
    return { verdict: 'suspect', reason: `datacenter host (${infra})` };
  }

  return { verdict: 'counted', reason: 'passed every check' };
}

/** Rules read from the environment, so a threshold change needs no deploy. */
export function rulesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TrackingRules {
  const number = (key: string, fallback: number): number => {
    const parsed = Number(env[key]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    minDelaySeconds: number(
      'TRACKING_MIN_DELAY_SECONDS',
      DEFAULT_RULES.minDelaySeconds,
    ),
    burstLinks: number('TRACKING_BURST_LINKS', DEFAULT_RULES.burstLinks),
    noOpenWindowSeconds: number(
      'TRACKING_NO_OPEN_WINDOW_SECONDS',
      DEFAULT_RULES.noOpenWindowSeconds,
    ),
    networkReach: number('TRACKING_NETWORK_REACH', DEFAULT_RULES.networkReach),
  };
}
