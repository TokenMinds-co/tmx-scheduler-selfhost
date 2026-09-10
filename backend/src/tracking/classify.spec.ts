import { DEFAULT_RULES, judge, rulesFromEnv } from './classify';

/** A hit that passes every rule, so each test can spoil exactly one thing. */
const human = {
  delaySeconds: 600,
  burstSize: 1,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  ptr: 'cpe-1-2-3-4.example-isp.net',
};

describe('judge', () => {
  it('counts an ordinary click', () => {
    expect(judge(human).verdict).toBe('counted');
  });

  describe('timing', () => {
    it('rejects a hit sooner than the cut-off', () => {
      const result = judge({ ...human, delaySeconds: 3 });
      expect(result.verdict).toBe('machine');
      expect(result.reason).toContain('3s after send');
    });

    it('accepts a hit exactly on the cut-off', () => {
      expect(
        judge({ ...human, delaySeconds: DEFAULT_RULES.minDelaySeconds }).verdict,
      ).toBe('counted');
    });

    it('honours a threshold raised at read time', () => {
      // The whole point of storing the delay rather than a verdict: the same
      // stored event is judged differently when the rule changes.
      const evidence = { ...human, delaySeconds: 60 };
      expect(judge(evidence).verdict).toBe('counted');
      expect(
        judge(evidence, { ...DEFAULT_RULES, minDelaySeconds: 120 }).verdict,
      ).toBe('machine');
    });
  });

  describe('user agent', () => {
    it('rejects Microsoft Safe Links', () => {
      const result = judge({
        ...human,
        userAgent: 'Mozilla/5.0 (compatible; SafeLinks) Chrome/120.0',
      });
      expect(result.verdict).toBe('machine');
      expect(result.reason).toContain('safelinks');
    });

    it('rejects a secure email gateway', () => {
      expect(
        judge({ ...human, userAgent: 'Proofpoint-URL-Defense/2.0' }).verdict,
      ).toBe('machine');
    });

    it('rejects a scripted fetch', () => {
      expect(judge({ ...human, userAgent: 'curl/8.21.0' }).verdict).toBe(
        'machine',
      );
    });

    it('rejects an image proxy before anything else', () => {
      // Apple fetches on delivery, so this would also fail the timing rule —
      // the reason should name the proxy, which is the more useful fact.
      const result = judge({
        ...human,
        delaySeconds: 2,
        userAgent: 'AppleMail/1.0 via Apple Mail Privacy Protection',
      });
      expect(result.verdict).toBe('machine');
      expect(result.reason).toContain('image proxy');
    });

    it('treats a missing user agent as suspect, not proof', () => {
      const result = judge({ ...human, userAgent: null });
      expect(result.verdict).toBe('suspect');
    });
  });

  describe('burst', () => {
    it('rejects every link in a message being hit at once', () => {
      const result = judge({ ...human, burstSize: 4 });
      expect(result.verdict).toBe('machine');
      expect(result.reason).toContain('4 links at once');
    });

    it('allows a person clicking two links', () => {
      expect(judge({ ...human, burstSize: 2 }).verdict).toBe('counted');
    });
  });

  describe('reverse dns', () => {
    it('marks a datacenter host suspect rather than machine', () => {
      // Real people browse from corporate networks that resolve into cloud
      // ranges; this lowers confidence, it does not disqualify.
      const result = judge({
        ...human,
        ptr: 'ec2-1-2-3-4.compute.amazonaws.com',
      });
      expect(result.verdict).toBe('suspect');
    });

    it('counts a residential host', () => {
      expect(judge(human).verdict).toBe('counted');
    });

    it('counts a hit with no reverse dns at all', () => {
      // Most consumer connections have no PTR. Absence is not evidence.
      expect(judge({ ...human, ptr: null }).verdict).toBe('counted');
    });
  });
});

describe('rulesFromEnv', () => {
  it('falls back to the defaults when unset', () => {
    expect(rulesFromEnv({})).toEqual(DEFAULT_RULES);
  });

  it('reads overrides', () => {
    expect(
      rulesFromEnv({
        TRACKING_MIN_DELAY_SECONDS: '45',
        TRACKING_BURST_LINKS: '2',
      }),
    ).toEqual({ minDelaySeconds: 45, burstLinks: 2 });
  });

  it('ignores nonsense rather than disabling the filter', () => {
    // A typo in an env var should not silently turn every scanner into a
    // counted click.
    expect(rulesFromEnv({ TRACKING_MIN_DELAY_SECONDS: 'soon' })).toEqual(
      DEFAULT_RULES,
    );
  });
});
