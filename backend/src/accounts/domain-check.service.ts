import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';
import type { DetectionConfidence, DomainCheck } from '@tmx-scheduler/shared';

/**
 * Which provider runs a domain's mail, read from that domain's public DNS.
 *
 * MX is the authority here: whoever receives a domain's mail is, in practice,
 * whoever an operator will be sending through. SPF is a weaker signal — it
 * lists who *may* send, which is often a marketing tool rather than the
 * mailbox host — so it is reported alongside but never used to pick a preset.
 *
 * Matching is on the registrable suffix of each MX hostname rather than a
 * substring, so a vanity host like `mx.notgoogle.com.example.net` cannot be
 * mistaken for Google.
 */

interface Rule {
  presetId: string;
  /** MX hostname suffixes that identify this provider. */
  suffixes: string[];
  /** SPF include: token the provider publishes, used for the readiness check. */
  spfInclude?: string;
  label: string;
}

const RULES: Rule[] = [
  {
    presetId: 'google_workspace',
    suffixes: ['google.com', 'googlemail.com', 'aspmx.l.google.com'],
    spfInclude: '_spf.google.com',
    label: 'Google Workspace',
  },
  {
    presetId: 'microsoft365',
    suffixes: ['outlook.com', 'protection.outlook.com', 'office365.com'],
    spfInclude: 'spf.protection.outlook.com',
    label: 'Microsoft 365',
  },
  {
    presetId: 'zoho',
    suffixes: ['zoho.com', 'zoho.eu', 'zoho.in', 'zohomail.com', 'zoho.com.au'],
    spfInclude: 'zoho.com',
    label: 'Zoho Mail',
  },
];

/** Mailbox providers whose own domain means a personal account, not a tenant. */
const PERSONAL_DOMAINS: Record<string, string> = {
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'outlook.com': 'outlook_personal',
  'hotmail.com': 'outlook_personal',
  'live.com': 'outlook_personal',
};

// A lookup against a domain that does not exist should fail fast rather than
// hold the request open for the resolver's default retry schedule.
const DNS_TIMEOUT_MS = 5000;

@Injectable()
export class DomainCheckService {
  private readonly logger = new Logger(DomainCheckService.name);

  /**
   * Accepts either an address or a bare domain. Anything that is not a
   * plausible hostname is rejected before it reaches the resolver — this input
   * comes from a form and is handed to a network call.
   */
  private normalise(input: string): string {
    const trimmed = input.trim().toLowerCase();
    const domain = trimmed.includes('@')
      ? trimmed.slice(trimmed.lastIndexOf('@') + 1)
      : trimmed;

    // Labels of 1–63 chars, at least two of them, letters/digits/hyphens only.
    const valid =
      domain.length > 0 &&
      domain.length <= 253 &&
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(
        domain,
      );

    if (!valid) {
      throw new BadRequestException({
        code: 'invalid_domain',
        message: `"${input}" is not a domain or email address.`,
      });
    }
    return domain;
  }

  /** True when `host` is exactly `suffix` or a subdomain of it. */
  private matches(host: string, suffix: string): boolean {
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  async check(input: string): Promise<DomainCheck> {
    const domain = this.normalise(input);

    const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });

    // Each lookup is independently optional: a domain may publish MX and no
    // SPF, or SPF and no DMARC, and none of those is an error worth failing on.
    const [mx, spf, dmarc] = await Promise.all([
      this.mxHosts(resolver, domain),
      this.txtRecord(resolver, domain, (t) => t.startsWith('v=spf1')),
      this.txtRecord(resolver, `_dmarc.${domain}`, (t) =>
        t.startsWith('v=DMARC1'),
      ),
    ]);

    const personal = PERSONAL_DOMAINS[domain];
    let presetId: string | null = null;
    let confidence: DetectionConfidence = 'unknown';
    let reason: string;

    if (personal) {
      presetId = personal;
      confidence = 'certain';
      reason = `${domain} is a personal mailbox provider.`;
    } else if (mx.length === 0) {
      reason =
        'This domain publishes no MX records, so nothing receives mail for it. Check the spelling, or use the mail host your provider gave you.';
    } else {
      const rule = RULES.find((r) =>
        mx.some((host) => r.suffixes.some((s) => this.matches(host, s))),
      );

      if (rule) {
        presetId = rule.presetId;
        confidence = 'certain';
        reason = `Mail for ${domain} is delivered to ${mx[0]}, which is ${rule.label}.`;
      } else {
        // Mail is hosted somewhere with no preset — that is exactly what the
        // "Own domain" path is for, so this is an answer, not a failure.
        presetId = 'custom';
        confidence = 'likely';
        reason = `Mail for ${domain} is delivered to ${mx[0]}, which is not one of the known providers — treat it as your own mail server.`;
      }
    }

    const rule = RULES.find((r) => r.presetId === presetId);
    const spfIncludesProvider =
      spf && rule?.spfInclude ? spf.includes(rule.spfInclude) : null;

    return {
      domain,
      presetId,
      confidence,
      reason,
      mx,
      spf,
      spfIncludesProvider,
      dmarc,
    };
  }

  /** MX hostnames in preference order, or [] when the domain publishes none. */
  private async mxHosts(resolver: Resolver, domain: string): Promise<string[]> {
    try {
      const records = await resolver.resolveMx(domain);
      return records
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange.toLowerCase().replace(/\.$/, ''))
        .filter(Boolean);
    } catch (cause) {
      // ENOTFOUND and ENODATA both mean "no MX here", which the caller reports
      // as a finding. Anything else is a resolver problem worth a log line.
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== 'ENOTFOUND' && code !== 'ENODATA') {
        this.logger.warn(`MX lookup for ${domain} failed: ${code ?? cause}`);
      }
      return [];
    }
  }

  private async txtRecord(
    resolver: Resolver,
    name: string,
    predicate: (text: string) => boolean,
  ): Promise<string | null> {
    try {
      const records = await resolver.resolveTxt(name);
      // A TXT record arrives as an array of strings that must be concatenated;
      // long SPF records are split across 255-byte chunks.
      const joined = records.map((chunks) => chunks.join(''));
      return joined.find(predicate) ?? null;
    } catch {
      return null;
    }
  }
}
