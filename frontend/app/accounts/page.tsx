'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import type { AccountDto, AuthType } from '@ims/shared';
import { Shell } from '@/components/Shell';
import { ICONS, Icon } from '@/components/icons';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatShort } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Meter,
  PageHeader,
  cx,
} from '@/components/ui';

/** The stored enum, read as a person would say it. */
const AUTH_LABELS: Record<AuthType, string> = {
  smtp_password: 'App password',
  oauth_google: 'OAuth · Google',
  oauth_microsoft: 'OAuth · Microsoft',
};

/**
 * One mailbox, as a card.
 *
 * The card answers the two questions asked of this page: can this address still
 * send today, and is it healthy. So the daily count is a meter rather than a
 * number in a row of six equal-looking numbers — headroom is the thing being
 * watched — and the rest sit underneath as labelled facts. A paused mailbox
 * mutes its own meter instead of dropping the row, because "0 / 50" on a paused
 * address otherwise reads as a mailbox that has simply not started yet.
 */
function MailboxCard({
  account,
  busy,
  canEdit,
  onVerify,
  onTest,
  onTogglePaused,
}: {
  account: AccountDto;
  busy: boolean;
  canEdit: boolean;
  onVerify: () => void;
  onTest: () => void;
  onTogglePaused: () => void;
}) {
  const remaining = Math.max(0, account.dailyLimit - account.sentToday);
  const atLimit = remaining === 0;

  return (
    <Card className={cx(!account.active && 'border-dashed')}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span
          className={cx(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            account.active
              ? 'bg-accent-soft text-accent'
              : 'bg-cancelled-soft text-cancelled',
          )}
        >
          <Icon>{ICONS.mail}</Icon>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{account.email}</h2>
            {account.active ? (
              <Badge tone="good">active</Badge>
            ) : (
              <Badge tone="warn">paused</Badge>
            )}
            {!account.requireTls && <Badge tone="bad">no TLS</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {account.displayName} · {account.smtpHost}:{account.smtpPort}
          </p>
        </div>
        {canEdit && (
          <Link href={`/accounts/${account.id}`}>
            <Button>
              <Icon className="size-3.5">{ICONS.pencil}</Icon>
              Edit
            </Button>
          </Link>
        )}
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Icon className="size-3.5">{ICONS.gauge}</Icon>
            Sent today
          </span>
          <span className="text-xs tabular-nums text-muted">
            <span className="text-sm font-semibold text-ink">
              {account.sentToday}
            </span>{' '}
            / {account.dailyLimit}
          </span>
        </div>
        <div className="mt-2">
          <Meter
            value={account.sentToday}
            max={account.dailyLimit}
            tone={!account.active ? 'muted' : atLimit ? 'full' : 'accent'}
          />
        </div>
        {/* Pace belongs with the meter, not in the fact grid below: how much
            is left, how fast it goes out and when the count resets are one
            answer, and splitting them across three cells made the reader
            reassemble it. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {/* The headline of the three. The other two carry icons, which is
              what keeps them legible as separate chips without separators. */}
          <span
            className={cx(
              'font-medium',
              !account.active || atLimit ? 'text-pending' : 'text-ink',
            )}
          >
            {!account.active
              ? 'Paused — nothing leaves this mailbox'
              : atLimit
                ? 'Daily limit reached'
                : `${remaining} left today`}
          </span>
          <span className="flex items-center gap-1">
            <Icon className="size-3.5">{ICONS.clock}</Icon>
            <span className="tabular-nums">{account.minGapSeconds}s</span> apart
          </span>
          <span className="flex items-center gap-1">
            <Icon className="size-3.5">{ICONS.globe}</Icon>
            resets 9 AM {account.timezone}
          </span>
        </div>
      </div>

      {/* Three facts, three columns, no half-empty last row. */}
      <dl className="grid grid-cols-3 gap-3 border-t border-border px-4 py-3">
        <Fact icon={ICONS.key} label="Auth">
          {AUTH_LABELS[account.authType]}
        </Fact>
        <Fact icon={ICONS.shieldCheck} label="Verified">
          {formatShort(account.lastVerifiedAt)}
        </Fact>
        <Fact icon={ICONS.send} label="Last send">
          {formatShort(account.lastSentAt)}
        </Fact>
      </dl>

      {account.lastError && (
        <div className="border-t border-border px-4 py-2">
          <Alert>{account.lastError}</Alert>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
        <Button loading={busy} onClick={onVerify}>
          <Icon className="size-3.5">{ICONS.plug}</Icon>
          Test login
        </Button>
        <Button loading={busy} onClick={onTest}>
          <Icon className="size-3.5">{ICONS.send}</Icon>
          Send test email
        </Button>
        {canEdit && (
          <Button
            variant={account.active ? 'danger' : 'secondary'}
            loading={busy}
            onClick={onTogglePaused}
            className="ml-auto"
          >
            <Icon className="size-3.5">
              {account.active ? ICONS.pause : ICONS.play}
            </Icon>
            {account.active ? 'Pause sending' : 'Resume sending'}
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Icon, label, value — the repeating unit of the card's lower half.
 *
 * The icon sits on the label's line rather than beside the whole block, so the
 * value starts at the same left edge as the icon. Hanging the value off the
 * icon instead indents every value by a different-looking amount and leaves the
 * column with no straight edge to read down.
 */
function Fact({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        <Icon className="size-3.5">{icon}</Icon>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

export default function AccountsPage() {
  const { user } = useAuth();
  const accounts = useSWR<AccountDto[]>('/accounts', fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The mailbox a test is being composed for, and the address to send it to.
  const [testing, setTesting] = useState<AccountDto | null>(null);
  const [testTo, setTestTo] = useState('');

  async function verify(account: AccountDto) {
    setBusyId(account.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/accounts/${account.id}/verify`, { method: 'POST', body: {} });
      setNotice(`${account.email} logged in successfully.`);
      void accounts.mutate();
    } catch (cause) {
      setError((cause as Error).message);
      void accounts.mutate();
    } finally {
      setBusyId(null);
    }
  }

  function openTest(account: AccountDto) {
    // Your own inbox is the usual place to look, so it is the default.
    setTestTo(user?.email ?? '');
    setTesting(account);
  }

  async function sendTest() {
    if (!testing || !testTo.trim()) return;
    const account = testing;
    const to = testTo.trim();
    setTesting(null);
    setBusyId(account.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/accounts/${account.id}/test`, {
        method: 'POST',
        body: { to },
      });
      setNotice(`Test message sent from ${account.email} to ${to}.`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function togglePaused(account: AccountDto) {
    setBusyId(account.id);
    try {
      await api(`/accounts/${account.id}`, {
        method: 'PATCH',
        body: { active: !account.active },
      });
      void accounts.mutate();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Mailboxes"
        description="Every sending address, its credentials and its daily pace."
        actions={
          user?.role === 'admin' && (
            <>
              <Link href="/accounts/new">
                <Button>Plain form</Button>
              </Link>
              <Link href="/accounts/help">
                <Button variant="primary">Add mailbox</Button>
              </Link>
            </>
          )
        }
      />

      {(error || notice) && (
        <div className="mb-4 space-y-2">
          {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
          {notice && (
            <Alert tone="success" onDismiss={() => setNotice(null)}>
              {notice}
            </Alert>
          )}
        </div>
      )}

      {!accounts.data && !accounts.error && (
        <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-xl border border-border bg-surface"
            />
          ))}
        </div>
      )}
      {accounts.error && (
        <Alert>{(accounts.error as Error).message}</Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {accounts.data?.map((account) => (
          <MailboxCard
            key={account.id}
            account={account}
            busy={busyId === account.id}
            canEdit={user?.role === 'admin'}
            onVerify={() => void verify(account)}
            onTest={() => openTest(account)}
            onTogglePaused={() => void togglePaused(account)}
          />
        ))}
      </div>

      <Dialog
        open={testing !== null}
        onClose={() => setTesting(null)}
        title="Send a test email"
        description={
          testing && (
            <>
              From <span className="font-medium text-ink">{testing.email}</span>
              , with its signature, and no unsubscribe line.
            </>
          )
        }
        footer={
          <>
            <Button onClick={() => setTesting(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!testTo.trim()}
              onClick={() => void sendTest()}
            >
              <Icon className="size-3.5">{ICONS.send}</Icon>
              Send
            </Button>
          </>
        }
      >
        <Field label="Send to">
          <Input
            type="email"
            value={testTo}
            placeholder="you@example.com"
            onChange={(e) => setTestTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendTest();
            }}
          />
        </Field>
      </Dialog>

      {accounts.data?.length === 0 && (
        <Card>
          <EmptyState
            title="No mailboxes yet"
            description="Add the first sending address to start scheduling. The guided setup walks through where each credential comes from."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/accounts/help">
                  <Button variant="primary">Add mailbox, step by step</Button>
                </Link>
                <Link href="/accounts/new">
                  <Button>Plain form</Button>
                </Link>
              </div>
            }
          />
        </Card>
      )}
    </Shell>
  );
}
