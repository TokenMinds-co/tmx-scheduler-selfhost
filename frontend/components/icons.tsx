import type { ReactNode } from 'react';
import { cx } from './ui';

/**
 * Inline paths rather than an icon dependency. There are two dozen of them,
 * they never change, and a package would ship a few hundred KB to draw them.
 *
 * One stroke weight and one viewBox for the whole set: icons that disagree
 * about either read as clip art borrowed from three places, which is worse than
 * having no icons at all.
 */
export function Icon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('size-4 shrink-0', className)}
    >
      {children}
    </svg>
  );
}

export const ICONS = {
  mail: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </>
  ),
  /** Connection: a plug, because the section is about reaching the server. */
  plug: (
    <>
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v2.5a6 6 0 0 1-12 0z" />
      <path d="M12 16.5V22" />
    </>
  ),
  /** Pace: a speedometer, for daily limit and gap. */
  gauge: (
    <>
      <path d="M4.4 18a9 9 0 1 1 15.2 0" />
      <path d="m12 14 4-4" />
      <circle cx="12" cy="14.5" r="1.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 1.9" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 12h17.6" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="3.8" />
      <path d="m10.8 12.8 8.2-8.2" />
      <path d="m17 6.6 2 2" />
      <path d="m14.4 9.2 2 2" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 3 5 5.9v5.2c0 4.4 2.9 8.1 7 9.9 4.1-1.8 7-5.5 7-9.9V5.9z" />
      <path d="m9.2 12 2.1 2.1 3.9-4.2" />
    </>
  ),
  send: (
    <>
      <path d="M21.5 2.5 11 13" />
      <path d="M21.5 2.5 15 21.5l-3.8-8.7L2.5 9z" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h8.5" />
      <path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z" />
    </>
  ),
  pause: (
    <>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1.2" />
      <rect x="14" y="5" width="3.5" height="14" rx="1.2" />
    </>
  ),
  play: <path d="M7 4.8 19 12 7 19.2z" />,
  chevron: <path d="m6 9.5 6 6 6-6" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.3h.01" />
    </>
  ),
  /** Signature: a written flourish on a baseline. */
  signature: (
    <>
      <path d="M3 15.5c2.6 0 2.6-9 5.2-9s2.6 9 5.2 9 2.6-3.5 5.2-3.5" />
      <path d="M3 20h18" />
    </>
  ),
  phone: (
    <>
      <path d="M5.2 3h3.4l1.7 4.3-2.1 1.3a12.3 12.3 0 0 0 5.2 5.2l1.3-2.1L19 13.4v3.4a2 2 0 0 1-2.2 2A15.8 15.8 0 0 1 3.2 5.2 2 2 0 0 1 5.2 3z" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.8" cy="10" r="1.8" />
      <path d="m4.5 17.5 4.8-4.5 3.7 3.5 2.2-2 4.3 4" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </>
  ),
  /** Reschedule: a clock with a "set" nub on top. */
  reschedule: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6" />
    </>
  ),
  cancel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  /** The optional extras on a signature — the P.s. line and the accent colour. */
  sparkle: (
    <>
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M18.5 16.5 19 18l1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 18l1.5-.5z" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;
