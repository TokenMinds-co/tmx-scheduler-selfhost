'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import type { EmailStatus } from '@ims/shared';

export function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'brand-gradient text-white shadow-sm shadow-accent/30 hover:opacity-90',
  secondary: 'bg-surface border border-border hover:bg-accent-soft',
  danger: 'bg-failed-soft text-failed border border-failed/30 hover:bg-failed/15',
  ghost: 'hover:bg-accent-soft',
};

export function Button({
  variant = 'secondary',
  className,
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5',
        'text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/**
 * An icon-only action with a tooltip.
 *
 * The label is not decoration: it is the button's accessible name and the
 * tooltip text, so the control is never a bare glyph to a screen reader or to
 * anyone who does not recognise the icon. The tooltip is CSS rather than the
 * native `title` attribute, which takes about a second to appear and cannot be
 * styled — too slow to be useful when scanning a table of rows.
 */
export function IconButton({
  label,
  icon,
  loading,
  tone = 'neutral',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  loading?: boolean;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        {...props}
        type="button"
        aria-label={label}
        disabled={props.disabled || loading}
        className={cx(
          'inline-flex size-8 items-center justify-center rounded-lg transition',
          'disabled:cursor-not-allowed disabled:opacity-40',
          tone === 'danger'
            ? 'text-muted hover:bg-failed-soft hover:text-failed'
            : 'text-muted hover:bg-accent-soft hover:text-accent',
          className,
        )}
      >
        {loading ? <Spinner /> : icon}
      </button>

      {/* Hidden from assistive tech: aria-label already carries the name. */}
      <span
        aria-hidden
        role="tooltip"
        className={cx(
          'pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2',
          'whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface',
          'opacity-0 shadow-sm transition-opacity',
          'group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'rounded-xl border border-border bg-surface shadow-sm',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold">{title}</h2>
          ) : (
            title
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Big number + label. Used for the queue counters across the top. */
export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: EmailStatus | 'neutral';
  hint?: string;
}) {
  const toneClass =
    tone && tone !== 'neutral' ? STATUS_TEXT[tone as EmailStatus] : '';
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', toneClass)}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<EmailStatus, string> = {
  pending: 'text-pending',
  sending: 'text-sending',
  sent: 'text-sent',
  failed: 'text-failed',
  cancelled: 'text-cancelled',
};

const STATUS_BG: Record<EmailStatus, string> = {
  pending: 'bg-pending-soft text-pending',
  sending: 'bg-sending-soft text-sending',
  sent: 'bg-sent-soft text-sent',
  failed: 'bg-failed-soft text-failed',
  cancelled: 'bg-cancelled-soft text-cancelled',
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={cx(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        STATUS_BG[status],
      )}
    >
      {status}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}) {
  const tones = {
    neutral: 'bg-cancelled-soft text-cancelled',
    good: 'bg-sent-soft text-sent',
    bad: 'bg-failed-soft text-failed',
    warn: 'bg-pending-soft text-pending',
  };
  return (
    <span
      className={cx(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-failed">{error}</span>}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm ' +
  'outline-none focus:border-accent focus:ring-1 focus:ring-accent';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(CONTROL, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={cx(CONTROL, 'font-mono', props.className)} />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(CONTROL, props.className)} />;
}

export function Checkbox({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2">
      <input
        {...props}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-border accent-accent"
      />
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Alert({
  tone = 'error',
  children,
  onDismiss,
}: {
  tone?: 'error' | 'success' | 'info';
  children: ReactNode;
  /** When given, the alert can be closed — a notice should not outlive its news. */
  onDismiss?: () => void;
}) {
  const tones = {
    error: 'bg-failed-soft text-failed border-failed/30',
    success: 'bg-sent-soft text-sent border-sent/30',
    info: 'bg-accent-soft text-accent border-accent/30',
  };
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-3 rounded-lg border px-3 py-2 text-sm',
        tones[tone],
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-0.5 rounded p-1 opacity-60 transition hover:opacity-100"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            className="size-3.5"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * A modal for the handful of actions that need a value before they can run —
 * a new send time, an address to test against. These used to be
 * `window.prompt`, which cannot show a date picker, cannot validate, and
 * looks like an error to anyone who has not seen one in a decade.
 *
 * Escape and the backdrop both close it; the first control inside gets focus.
 * That covers keyboard use without a full focus trap, and the content is
 * small enough that tabbing out of it is a nuisance rather than a hazard.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    panel.current
      ?.querySelector<HTMLElement>('input, select, textarea, button')
      ?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal
        aria-labelledby="dialog-title"
        className="relative w-full max-w-md rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="px-5 pt-5">
          <h2 id="dialog-title" className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-muted">{description}</p>
          )}
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Rows of placeholder text while a list loads. The shimmer is the point: an
 * empty table and a table that has not arrived yet look identical otherwise,
 * and "no data" is a conclusion the reader should not be able to draw early.
 */
export function LoadingRows({
  columns,
  rows = 3,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-4 py-3">
              <span
                className="block h-3 animate-pulse rounded bg-border"
                style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Rows per page, everywhere. One constant rather than a number per table, so
 * every list in the tool turns a page at the same size — a table that scrolls
 * differently from the one next to it reads as a bug.
 */
export const ROWS_PER_PAGE = 10;

/**
 * Paging for a list that arrives whole, for the endpoints that return every
 * row at once. Server-paginated tables keep their own `page` state and pass
 * the server's `pageSize`/`total` to <Pagination> directly.
 */
export function usePagedRows<T>(rows: T[] | undefined, pageSize = ROWS_PER_PAGE) {
  const [page, setPage] = useState(1);
  const total = rows?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Deleting the last row of the last page would otherwise leave the table
  // showing an empty slice of a page that no longer exists.
  const current = Math.min(page, pages);
  return {
    rows: rows?.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    setPage,
    pageSize,
    total,
  };
}

/** Previous / next with a count, for any paginated list. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm">
      <span className="text-muted tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of{' '}
        {total.toLocaleString()}
      </span>
      <div className="flex gap-2">
        <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

/**
 * One section of an accordion, controlled by whoever owns the open id.
 *
 * The panel stays mounted and is hidden with the `hidden` attribute rather than
 * unmounted. Two reasons, both about forms: a collapsed section keeps whatever
 * has been typed into it, and its controls stay in the document where native
 * constraint validation can still see them — an input that does not exist
 * cannot report that it is empty. `hidden` also takes the panel out of the tab
 * order, which a zero-height wrapper would not.
 */
export function AccordionSection({
  id,
  title,
  icon,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  /** Shown in place of nothing when collapsed: what is inside, in a few words. */
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      data-section={id}
      className={cx(
        'overflow-hidden rounded-xl border bg-surface shadow-sm transition-colors',
        open ? 'border-accent/40' : 'border-border',
      )}
    >
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent-soft/50"
        >
          {icon && (
            <span
              className={cx(
                'grid size-8 shrink-0 place-items-center rounded-lg transition-colors',
                open ? 'bg-accent text-white' : 'bg-accent-soft text-accent',
              )}
            >
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            {!open && summary && (
              <span className="mt-0.5 block truncate text-xs text-muted">
                {summary}
              </span>
            )}
          </span>
          <span
            aria-hidden
            className={cx(
              'text-muted transition-transform duration-200',
              open && 'rotate-180',
            )}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
            >
              <path d="m6 9.5 6 6 6-6" />
            </svg>
          </span>
        </button>
      </h2>
      <div id={`${id}-panel`} hidden={!open} className="border-t border-border">
        {children}
      </div>
    </section>
  );
}

/**
 * A usage bar. The number alone ("12 / 50") makes the reader do the division;
 * the bar is the part that says at a glance whether a mailbox has room left.
 */
export function Meter({
  value,
  max,
  tone = 'accent',
}: {
  value: number;
  max: number;
  tone?: 'accent' | 'muted' | 'full';
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = {
    accent: 'brand-gradient',
    muted: 'bg-cancelled/40',
    full: 'bg-pending',
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      // The empty track has to read as a track. On a white card `bg-canvas` is
      // nearly the card itself, so an unused meter looked like a stray rule.
      className="h-2 w-full overflow-hidden rounded-full bg-accent-soft"
    >
      <div
        className={cx('h-full rounded-full transition-[width]', fill)}
        // A mailbox that has sent nothing shows an empty track, not a sliver.
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
