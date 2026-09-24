'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { ICONS, Icon } from './icons';
import { Button, Spinner, cx } from './ui';

const VERSION = 'v0.1.0';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Optional shortcut rendered as a + on the right of the row. */
  add?: { href: string; label: string };
}

/**
 * Grouped so the rail reads as three jobs rather than five links: what is going
 * out, who it goes out as, and everything else. Icons are inline paths rather
 * than an icon dependency — there are six of them and they never change.
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Campaign',
    items: [
      {
        href: '/queue',
        label: 'Queue',
        icon: (
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 8h18M8 12h8M8 16h5" />
          </>
        ),
      },
      {
        href: '/batches',
        label: 'Batches',
        icon: (
          <>
            <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
            <path d="m3 12 9 4.5 9-4.5" />
            <path d="m3 16.5 9 4.5 9-4.5" />
          </>
        ),
      },
      {
        href: '/import',
        label: 'Import',
        icon: (
          <>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 19h16" />
          </>
        ),
      },
    ],
  },
  {
    label: 'Sending',
    items: [
      {
        href: '/accounts',
        label: 'Mailboxes',
        icon: (
          <>
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="m2 7 10 6 10-6" />
          </>
        ),
        add: { href: '/accounts/help', label: 'Add a mailbox' },
      },
      {
        href: '/signatures',
        label: 'Signatures',
        icon: ICONS.signature,
        add: { href: '/signatures/new', label: 'New signature' },
      },
      {
        href: '/suppression',
        label: 'Suppression',
        icon: (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="m6 6 12 12" />
          </>
        ),
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        href: '/settings',
        label: 'Settings',
        icon: (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M20.2 14.1a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3.7a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3.8a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.2z" />
          </>
        ),
      },
    ],
  },
];

/** Extra routes that are not rail entries but still need a breadcrumb name. */
const CRUMBS: [string, string[]][] = [
  ['/accounts/help', ['Mailboxes', 'Add a mailbox']],
  ['/accounts/new', ['Mailboxes', 'New mailbox']],
  ['/signatures/new', ['Signatures', 'New signature']],
];

function crumbsFor(pathname: string): string[] {
  const extra = CRUMBS.find(([href]) => pathname === href);
  if (extra) return extra[1];
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href) return [item.label];
      // A detail route such as /accounts/<id> sits under its section.
      if (pathname.startsWith(`${item.href}/`)) return [item.label, 'Details'];
    }
  }
  return [];
}

// `ims` is the legacy internal name; kept so a collapsed sidebar stays collapsed.
const COLLAPSE_KEY = 'ims_nav_collapsed';

/**
 * Authenticated chrome. Rendering children only once a session is confirmed
 * avoids the flash of a dashboard the API is about to reject.
 *
 * A dark side rail carries navigation; the bar across the top carries where you
 * are and who you are signed in as. Splitting them this way means the rail can
 * hold grouped sections without the page title competing for the same row, and
 * the content column stays capped so tables and forms do not stretch to the far
 * edge of a monitor.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Read after mount: touching localStorage during render would disagree with
  // the server-rendered markup, and it can throw in a locked-down browser.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* Storage unavailable — the default stands. */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* Not worth failing the click over. */
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted">
        <Spinner />
      </div>
    );
  }

  if (!user) return null;

  const crumbs = crumbsFor(pathname);
  const wide = !collapsed || open;

  const rail = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className={cx('px-5 py-5', !wide && 'flex justify-center px-0')}>
        <Link
          href="/queue"
          aria-label="TMX Scheduler"
          className="flex items-baseline gap-1.5"
        >
          <span className="text-xl font-extrabold tracking-tight text-white">
            TMX
          </span>
          {wide && (
            <span className="text-base font-medium tracking-tight text-[var(--color-sidebar-muted)]">
              Scheduler
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-6">
            {wide && (
              <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-sidebar-muted)]/80">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <div key={item.href} className="group/row relative">
                    <Link
                      href={item.href}
                      title={!wide ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={cx(
                        'flex items-center gap-3 rounded-lg py-2.5 text-sm transition',
                        wide ? 'px-2.5' : 'justify-center px-0',
                        active
                          ? 'bg-white/15 font-medium text-white'
                          : 'text-[var(--color-sidebar-muted)] hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <Icon>{item.icon}</Icon>
                      {wide && <span className="truncate">{item.label}</span>}
                    </Link>

                    {wide && item.add && user.role === 'admin' && (
                      <Link
                        href={item.add.href}
                        title={item.add.label}
                        aria-label={item.add.label}
                        onClick={() => setOpen(false)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--color-sidebar-muted)] opacity-0 transition hover:bg-white/15 hover:text-white focus-visible:opacity-100 group-hover/row:opacity-100"
                      >
                        <Icon className="size-3.5">
                          <path d="M12 5v14M5 12h14" />
                        </Icon>
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 pb-5">
        {wide && (
          <p className="px-2 pb-2 text-[11px] text-[var(--color-sidebar-muted)]">
            TMX Scheduler · {VERSION}
          </p>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className={cx(
            'hidden w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
            'text-[var(--color-sidebar-muted)] transition hover:bg-white/10 hover:text-white lg:flex',
            !wide && 'justify-center px-0',
          )}
        >
          <Icon>
            {collapsed ? (
              <path d="m9 18 6-6-6-6" />
            ) : (
              <path d="m15 18-6-6 6-6" />
            )}
          </Icon>
          {wide && 'Collapse'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Backdrop for the mobile drawer. */}
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
        />
      )}

      <aside
        className={cx(
          'sidebar-gradient fixed inset-y-0 left-0 z-40 shrink-0 transition-all',
          'lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          collapsed ? 'lg:w-[4.5rem]' : 'lg:w-60',
          'w-60',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {rail}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Where you are, and who you are. The rail owns navigation, so this
            row is free to carry context instead of competing with it. */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/90 px-4 py-3.5 backdrop-blur lg:px-10">
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg p-1.5 text-muted hover:bg-accent-soft hover:text-ink lg:hidden"
          >
            <Icon>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </Icon>
          </button>

          <nav aria-label="Breadcrumb" className="min-w-0 truncate text-sm">
            <Link href="/queue" className="text-muted hover:text-ink">
              TMX Scheduler
            </Link>
            {crumbs.map((crumb, i) => (
              <span key={crumb}>
                <span className="mx-1.5 text-muted">›</span>
                <span
                  className={
                    i === crumbs.length - 1 ? 'font-semibold' : 'text-muted'
                  }
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-[14rem] truncate text-xs font-medium">
                {user.email}
              </p>
              <p className="text-xs capitalize text-muted">{user.role}</p>
            </div>
            <span
              aria-hidden
              className="brand-gradient grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold uppercase text-white"
            >
              {user.email.slice(0, 2)}
            </span>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
