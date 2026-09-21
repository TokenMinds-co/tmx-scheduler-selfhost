import { TrackingService } from './tracking.service';

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const SENT = new Date('2026-09-18T16:00:00Z');
const after = (seconds: number) => new Date(SENT.getTime() + seconds * 1000);

interface StoredClick {
  ip?: string | null;
  emailId: string;
  delaySeconds: number;
  burstSize: number;
  userAgent: string | null;
  ptr: string | null;
  occurredAt: Date;
}

function click(
  emailId: string,
  delaySeconds: number,
  overrides: Partial<StoredClick> = {},
): StoredClick {
  return {
    emailId,
    delaySeconds,
    burstSize: 1,
    userAgent: BROWSER,
    ptr: 'cpe-1-2-3-4.example-isp.net',
    occurredAt: after(delaySeconds),
    ...overrides,
  };
}

/**
 * Only the event read and the network-reach query are touched; the rest of the
 * service is not under test. `reach` stands in for the database's answer to
 * "how many companies' mail has this network clicked".
 */
function serviceOver(
  events: StoredClick[],
  reach: Record<string, number> = {},
): TrackingService {
  const prisma = {
    emailEvent: { findMany: async () => events },
    $queryRaw: async () =>
      Object.entries(reach).map(([network, domains]) => ({
        network,
        domains: BigInt(domains),
      })),
  };
  return new TrackingService(prisma as never, {} as never, {} as never);
}

describe('clickVerdicts', () => {
  it('calls a gateway sweep a scanner: minutes after delivery, never opened', async () => {
    // The production pattern that prompted this: one tracked link per message,
    // so no burst, followed from a browser-like agent, so no agent match.
    const verdicts = await serviceOver([click('a', 90)]).clickVerdicts([
      { id: 'a', firstOpenAt: null },
    ]);
    expect(verdicts.get('a')).toBe('scanner');
  });

  it('calls the same click human when the message was opened first', async () => {
    const verdicts = await serviceOver([click('a', 90)]).clickVerdicts([
      { id: 'a', firstOpenAt: after(60) },
    ]);
    expect(verdicts.get('a')).toBe('human');
  });

  it('does not let an open that came after the click vouch for it', async () => {
    // Swept on delivery, read by a person an hour later. The open is real; the
    // click still was not theirs.
    const verdicts = await serviceOver([click('a', 5)]).clickVerdicts([
      { id: 'a', firstOpenAt: after(3600) },
    ]);
    expect(verdicts.get('a')).toBe('scanner');
  });

  it('lets one real click outweigh the sweep that preceded it', async () => {
    const verdicts = await serviceOver([
      click('a', 4),
      click('a', 86_400),
    ]).clickVerdicts([{ id: 'a', firstOpenAt: null }]);
    expect(verdicts.get('a')).toBe('human');
  });

  it('is not fooled by the order events come back in', async () => {
    const verdicts = await serviceOver([
      click('a', 86_400),
      click('a', 4),
    ]).clickVerdicts([{ id: 'a', firstOpenAt: null }]);
    expect(verdicts.get('a')).toBe('human');
  });

  it('knows a named gateway whenever it clicks', async () => {
    const verdicts = await serviceOver([
      click('a', 7200, { userAgent: 'Mozilla/5.0 SafeLinks' }),
    ]).clickVerdicts([{ id: 'a', firstOpenAt: after(60) }]);
    expect(verdicts.get('a')).toBe('scanner');
  });

  it('judges each message on its own clicks', async () => {
    const verdicts = await serviceOver([
      click('swept', 3),
      click('read', 7200),
    ]).clickVerdicts([
      { id: 'swept', firstOpenAt: null },
      { id: 'read', firstOpenAt: null },
    ]);
    expect(verdicts.get('swept')).toBe('scanner');
    expect(verdicts.get('read')).toBe('human');
  });

  it('calls a patient scanner a scanner by the company it keeps', async () => {
    // Ten minutes after delivery, a browser's agent, the message even shows an
    // open — every older rule passes it. But its /24 has followed the links in
    // mail to five unrelated companies.
    const verdicts = await serviceOver(
      [click('a', 600, { ip: '40.94.31.17' })],
      { '40.94.31': 5 },
    ).clickVerdicts([{ id: 'a', firstOpenAt: after(30) }]);
    expect(verdicts.get('a')).toBe('scanner');
  });

  it('leaves a person alone on a network that is only theirs', async () => {
    const verdicts = await serviceOver(
      [click('a', 600, { ip: '73.12.8.200' })],
      { '73.12.8': 1 },
    ).clickVerdicts([{ id: 'a', firstOpenAt: after(30) }]);
    expect(verdicts.get('a')).toBe('human');
  });

  it('says nothing about a message nobody clicked', async () => {
    const verdicts = await serviceOver([]).clickVerdicts([
      { id: 'a', firstOpenAt: null },
    ]);
    expect(verdicts.has('a')).toBe(false);
  });
});
