import { DateTime } from 'luxon';

/**
 * The daily send counter, and what "today" means for it.
 *
 * `sentToday` on an account is not reset by a scheduler at midnight. It is
 * reset lazily: the claim that records a send compares `sentTodayDate` with
 * the mailbox's local date and starts from 1 when they differ. That keeps the
 * claim a single atomic UPDATE, but it means the stored number is stale from
 * midnight until the first send of the new day — and every reader has to
 * apply the same comparison, or two screens will disagree about the same
 * mailbox. This module is that comparison, in one place.
 */

interface CounterFields {
  timezone: string;
  sentToday: number;
  sentTodayDate: string | null;
}

/** The calendar date at `at`, as the mailbox's own timezone sees it. */
export function localDate(timezone: string, at: Date): string {
  return DateTime.fromJSDate(at).setZone(timezone).toFormat('yyyy-LL-dd');
}

export function startOfNextDay(timezone: string, from: Date): Date {
  return DateTime.fromJSDate(from)
    .setZone(timezone)
    .plus({ days: 1 })
    .startOf('day')
    .toJSDate();
}

/** The count that is true *now*, not the one last written. */
export function sentTodayOf(account: CounterFields, now = new Date()): number {
  return account.sentTodayDate === localDate(account.timezone, now)
    ? account.sentToday
    : 0;
}
