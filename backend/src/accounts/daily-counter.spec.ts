import { localDate, sentTodayOf, startOfNextDay } from './daily-counter';

describe('daily counter', () => {
  // 15:10 on 9 Sep in Singapore; 07:10 UTC.
  const lastSend = new Date('2026-09-09T07:10:00Z');
  const account = {
    timezone: 'Asia/Singapore',
    sentToday: 2,
    sentTodayDate: '2026-09-09',
  };

  it('reports the stored count while it is still that day', () => {
    expect(sentTodayOf(account, lastSend)).toBe(2);
    // 23:59 Singapore is still 9 Sep, even though UTC has moved on.
    expect(sentTodayOf(account, new Date('2026-09-09T15:59:00Z'))).toBe(2);
  });

  it('reports zero once the mailbox has crossed midnight', () => {
    // 00:01 on 10 Sep in Singapore is 16:01 UTC on the 9th: the stored row
    // still says 2 / 9 Sep, but the mailbox has a fresh allowance.
    expect(sentTodayOf(account, new Date('2026-09-09T16:01:00Z'))).toBe(0);
  });

  it('uses the mailbox zone, not the server zone', () => {
    const london = { ...account, timezone: 'Europe/London' };
    // 16:01 UTC on 9 Sep is still the evening of the 9th in London.
    expect(sentTodayOf(london, new Date('2026-09-09T16:01:00Z'))).toBe(2);
  });

  it('treats a never-sent mailbox as zero', () => {
    expect(sentTodayOf({ ...account, sentTodayDate: null })).toBe(0);
  });

  it('rolls the day at local midnight', () => {
    expect(localDate('Asia/Singapore', lastSend)).toBe('2026-09-09');
    expect(startOfNextDay('Asia/Singapore', lastSend).toISOString()).toBe(
      '2026-09-09T16:00:00.000Z',
    );
  });
});
