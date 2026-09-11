import { DateTime } from 'luxon';

/**
 * The daily send counter, and what "today" means for it.
 *
 * `sentToday` on an account is not reset by a scheduler. It is reset lazily:
 * the claim that records a send compares `sentTodayDate` with the mailbox's
 * current send day and starts from 1 when they differ. That keeps the claim a
 * single atomic UPDATE, but it means the stored number is stale from the
 * boundary until the first send of the new day — and every reader has to
 * apply the same comparison, or two screens will disagree about the same
 * mailbox. This module is that comparison, in one place.
 *
 * A send day starts at DAY_RESET_HOUR in the mailbox's own timezone, not at
 * midnight. Outreach goes out during working hours, so a quota that renewed
 * at 00:00 handed the whole allowance to whatever was queued overnight; one
 * that renews at 09:00 hands it to the morning. The day is labelled with the
 * calendar date it started on, so `sentTodayDate` is still `yyyy-LL-dd`.
 */

/** Hour (0–23) in the mailbox's zone at which the daily allowance renews. */
export const DAY_RESET_HOUR = 9;

interface CounterFields {
  timezone: string;
  sentToday: number;
  sentTodayDate: string | null;
}

/**
 * The send day containing `at`, as the mailbox's own timezone sees it:
 * the calendar date on which that day's DAY_RESET_HOUR fell.
 */
export function localDate(timezone: string, at: Date): string {
  return DateTime.fromJSDate(at)
    .setZone(timezone)
    .minus({ hours: DAY_RESET_HOUR })
    .toFormat('yyyy-LL-dd');
}

/** The instant the next send day begins: the next DAY_RESET_HOUR after `from`. */
export function startOfNextDay(timezone: string, from: Date): Date {
  const local = DateTime.fromJSDate(from).setZone(timezone);
  const todayReset = local.startOf('day').set({ hour: DAY_RESET_HOUR });
  return (local < todayReset ? todayReset : todayReset.plus({ days: 1 }))
    .toJSDate();
}

/** The count that is true *now*, not the one last written. */
export function sentTodayOf(account: CounterFields, now = new Date()): number {
  return account.sentTodayDate === localDate(account.timezone, now)
    ? account.sentToday
    : 0;
}
