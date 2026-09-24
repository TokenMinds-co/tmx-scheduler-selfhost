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
        judge({ ...human, delaySeconds: DEFAULT_RULES.minDelaySeconds })
          .verdict,
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

describe('clicked without opening', () => {
  // The case the burst rule cannot see: one tracked link per message, followed
  // by a gateway a minute or two after delivery, with a browser's user-agent.
  const sweep = { ...human, delaySeconds: 90, openedBefore: false };

  it('suspects a click soon after the send on a message never opened', () => {
    const result = judge(sweep);
    expect(result.verdict).toBe('suspect');
    expect(result.reason).toContain('never opened');
  });

  it('counts the same click once the message had been opened', () => {
    expect(judge({ ...sweep, openedBefore: true }).verdict).toBe('counted');
  });

  it('counts an unopened click that came long after delivery', () => {
    // Outlook blocks images by default, so a person there clicks with no open
    // on record. What separates them from a gateway is the clock.
    expect(
      judge({ ...sweep, delaySeconds: DEFAULT_RULES.noOpenWindowSeconds })
        .verdict,
    ).toBe('counted');
  });

  it('stays out of the way when nothing is known about opens', () => {
    expect(judge({ ...human, delaySeconds: 90 }).verdict).toBe('counted');
  });
});

describe('a network that clicks for everyone', () => {
  // The scanner the other rules cannot see: it waits ten minutes, wears a
  // browser's user-agent, and the message may even have been "opened" by the
  // same gateway. What it cannot hide is that one machine room is following
  // the links in mail addressed to unrelated companies.
  const patient = { ...human, delaySeconds: 600, openedBefore: true };

  it('rejects a hit from a network seen across several companies', () => {
    const result = judge({ ...patient, networkReach: 3 });
    expect(result.verdict).toBe('machine');
    expect(result.reason).toContain('3 companies');
  });

  it('counts a network that has only clicked for one or two', () => {
    // Two is a person who reads their work mail at home, or two colleagues on
    // a shared connection whose company uses two domains.
    expect(judge({ ...patient, networkReach: 2 }).verdict).toBe('counted');
  });

  it('stays out of the way when the network is unknown', () => {
    expect(judge(patient).verdict).toBe('counted');
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
    ).toEqual({
      minDelaySeconds: 45,
      burstLinks: 2,
      noOpenWindowSeconds: DEFAULT_RULES.noOpenWindowSeconds,
      networkReach: DEFAULT_RULES.networkReach,
    });
  });

  it('ignores nonsense rather than disabling the filter', () => {
    // A typo in an env var should not silently turn every scanner into a
    // counted click.
    expect(rulesFromEnv({ TRACKING_MIN_DELAY_SECONDS: 'soon' })).toEqual(
      DEFAULT_RULES,
    );
  });
});
