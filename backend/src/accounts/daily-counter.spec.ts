import {
  DAY_RESET_HOUR,
  localDate,
  sentTodayOf,
  startOfNextDay,
} from './daily-counter';

describe('daily counter', () => {
  // 15:10 on 9 Sep in Singapore; 07:10 UTC.
  const lastSend = new Date('2026-09-09T07:10:00Z');
  const account = {
    timezone: 'Asia/Singapore',
    sentToday: 2,
    sentTodayDate: '2026-09-09',
  };

  it('renews at nine in the morning', () => {
    expect(DAY_RESET_HOUR).toBe(9);
  });

  it('reports the stored count while it is still that send day', () => {
    expect(sentTodayOf(account, lastSend)).toBe(2);
    // 23:59 Singapore is still 9 Sep, even though UTC has moved on.
    expect(sentTodayOf(account, new Date('2026-09-09T15:59:00Z'))).toBe(2);
    // 08:59 on 10 Sep in Singapore (00:59 UTC) is still the 9 Sep send day:
    // the allowance has not renewed yet.
    expect(sentTodayOf(account, new Date('2026-09-10T00:59:00Z'))).toBe(2);
  });

  it('reports zero once the mailbox has crossed 9 AM', () => {
    // 09:00 on 10 Sep in Singapore is 01:00 UTC: the stored row still says
    // 2 / 9 Sep, but the mailbox has a fresh allowance.
    expect(sentTodayOf(account, new Date('2026-09-10T01:00:00Z'))).toBe(0);
  });

  it('uses the mailbox zone, not the server zone', () => {
    const london = { ...account, timezone: 'Europe/London' };
    // 01:00 UTC on 10 Sep is 02:00 in London — before its 9 AM, so still the
    // 9 Sep send day there, while Singapore has already rolled over.
    expect(sentTodayOf(london, new Date('2026-09-10T01:00:00Z'))).toBe(2);
  });

  it('treats a never-sent mailbox as zero', () => {
    expect(sentTodayOf({ ...account, sentTodayDate: null })).toBe(0);
  });

  it('labels the send day with the date it started on', () => {
    expect(localDate('Asia/Singapore', lastSend)).toBe('2026-09-09');
    // 03:00 on 10 Sep Singapore (19:00 UTC on the 9th) is after midnight but
    // before the reset, so it still belongs to the 9 Sep send day.
    expect(localDate('Asia/Singapore', new Date('2026-09-09T19:00:00Z'))).toBe(
      '2026-09-09',
    );
  });

  it('defers to the next 9 AM in the mailbox zone', () => {
    // From the afternoon: 9 AM tomorrow, which is 01:00 UTC.
    expect(startOfNextDay('Asia/Singapore', lastSend).toISOString()).toBe(
      '2026-09-10T01:00:00.000Z',
    );
    // From 03:00 Singapore: 9 AM the same calendar day, not the day after.
    expect(
      startOfNextDay('Asia/Singapore', new Date('2026-09-09T19:00:00Z')).toISOString(),
    ).toBe('2026-09-10T01:00:00.000Z');
    // Exactly at 9 AM the new day has begun, so the next boundary is tomorrow.
    expect(
      startOfNextDay('Asia/Singapore', new Date('2026-09-10T01:00:00Z')).toISOString(),
    ).toBe('2026-09-11T01:00:00.000Z');
  });
});
