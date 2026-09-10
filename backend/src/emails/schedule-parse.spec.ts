import { parseSchedule } from './schedule-parse';

/** Convenience: assert a cell resolves to an exact UTC instant. */
function expectUtc(raw: string, iso: string) {
  const result = parseSchedule(raw);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.utc.toISOString()).toBe(iso);
}

describe('parseSchedule', () => {
  it('reads the sheet format with an abbreviation', () => {
    // 12:03 AM in Singapore (UTC+8) is 16:03 the previous day in UTC.
    expectUtc('Sep 10 2026 12:03 AM SGT', '2026-09-09T16:03:00.000Z');
  });

  it('reads 24-hour times', () => {
    expectUtc('Sep 10 2026 14:30 SGT', '2026-09-10T06:30:00.000Z');
  });

  it('reads ISO dates with a zone suffix', () => {
    expectUtc('2026-09-10 09:00 Asia/Tokyo', '2026-09-10T00:00:00.000Z');
  });

  it('reads an explicit UTC offset', () => {
    expectUtc('2026-09-10T00:03+08:00', '2026-09-09T16:03:00.000Z');
    expectUtc('Sep 10 2026 12:03 AM +08:00', '2026-09-09T16:03:00.000Z');
  });

  it('reads a full IANA zone', () => {
    expectUtc('Sep 10 2026 9:00 AM Asia/Singapore', '2026-09-10T01:00:00.000Z');
  });

  it('honours the zone rather than the host clock', () => {
    const sgt = parseSchedule('Sep 10 2026 12:00 PM SGT');
    const utc = parseSchedule('Sep 10 2026 12:00 PM UTC');
    expect(sgt.ok && utc.ok).toBe(true);
    if (!sgt.ok || !utc.ok) return;
    expect(utc.utc.getTime() - sgt.utc.getTime()).toBe(8 * 60 * 60 * 1000);
  });

  it('rejects a bare local time rather than guessing', () => {
    const result = parseSchedule('Sep 10 2026 12:03 AM');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no timezone/);
  });

  it('names the abbreviation it could not resolve', () => {
    const result = parseSchedule('Sep 10 2026 12:03 AM XYZ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/XYZ/);
  });

  it('rejects an empty cell', () => {
    expect(parseSchedule('  ').ok).toBe(false);
  });

  it('rejects a date that does not exist', () => {
    expect(parseSchedule('Feb 30 2026 10:00 AM SGT').ok).toBe(false);
  });

  it('tolerates commas and extra whitespace', () => {
    expectUtc('Sep 10, 2026   12:03 AM  SGT', '2026-09-09T16:03:00.000Z');
  });

  describe(
    'a bare local time uses the zone chosen on the import screen',
    () => {
      it('parses it in the supplied fallback zone', () => {
        const result = parseSchedule('Sep 10 2026 12:00 PM', 'Asia/Singapore');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Noon in Singapore is 04:00 UTC.
        expect(result.utc.toISOString()).toBe('2026-09-10T04:00:00.000Z');
      });

      it('lets the cell own zone win over the fallback', () => {
        const result = parseSchedule(
          'Sep 10 2026 12:00 PM UTC',
          'Asia/Singapore',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.utc.toISOString()).toBe('2026-09-10T12:00:00.000Z');
      });

      it('still rejects a mistyped zone rather than falling back', () => {
        const result = parseSchedule(
          'Sep 10 2026 12:00 PM XYZ',
          'Asia/Singapore',
        );
        expect(result.ok).toBe(false);
      });
    },
  );
});

describe('a dot between hours and minutes', () => {
  it('reads 11.10 AM the same as 11:10 AM', () => {
    const dotted = parseSchedule('Sep 11 2026 11.10 AM', 'Asia/Jakarta');
    const coloned = parseSchedule('Sep 11 2026 11:10 AM', 'Asia/Jakarta');
    expect(dotted.ok).toBe(true);
    expect(coloned.ok).toBe(true);
    if (!dotted.ok || !coloned.ok) return;
    expect(dotted.utc.toISOString()).toBe(coloned.utc.toISOString());
  });

  it('does not advertise a timezone when the import supplies one', () => {
    // The old message showed "… 12:03 AM SGT" whatever the cause, which sent
    // people hunting for a timezone problem they did not have.
    const result = parseSchedule('Sep 11 2026 lunchtime', 'Asia/Jakarta');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toContain('SGT');
  });

  it('still advertises one when no fallback zone was given', () => {
    const result = parseSchedule('Sep 11 2026 lunchtime');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('SGT');
  });
});
