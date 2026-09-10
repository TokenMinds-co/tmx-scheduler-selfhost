import { DateTime } from 'luxon';

/**
 * The queue stores UTC; operators think in local time. Every timestamp on
 * screen is rendered in the viewer's own zone and labelled with it, because a
 * send time shown without a zone is the single most expensive ambiguity in a
 * scheduling tool.
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return DateTime.fromISO(iso).toFormat('dd LLL yyyy, HH:mm ZZZZ');
}

export function formatShort(iso: string | null): string {
  if (!iso) return '—';
  return DateTime.fromISO(iso).toFormat('dd LLL HH:mm');
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  return DateTime.fromISO(iso).toRelative() ?? '—';
}

/** Local wall-clock string for a `datetime-local` input. */
export function toLocalInputValue(iso: string): string {
  return DateTime.fromISO(iso).toFormat("yyyy-LL-dd'T'HH:mm");
}

/** Converts a `datetime-local` value back to a UTC ISO instant. */
export function fromLocalInputValue(value: string): string {
  return DateTime.fromFormat(value, "yyyy-LL-dd'T'HH:mm").toUTC().toISO() ?? '';
}

export const localZone = (): string => DateTime.local().zoneName ?? 'UTC';

/** `plural(3, 'message')` → "3 messages"; the "(s)" convention reads as unfinished. */
export function plural(count: number, noun: string, pluralNoun?: string): string {
  const word = count === 1 ? noun : (pluralNoun ?? `${noun}s`);
  return `${count.toLocaleString()} ${word}`;
}
