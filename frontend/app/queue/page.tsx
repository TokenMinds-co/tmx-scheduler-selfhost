'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import type {
  AccountDto,
  AccountStats,
  EmailDto,
  EmailStatus,
  Paginated,
  QueueStats,
} from '@ims/shared';
import { EMAIL_STATUSES } from '@ims/shared';
import { Shell } from '@/components/Shell';
import { ICONS, Icon } from '@/components/icons';
import { api, fetcher } from '@/lib/api';
import {
  formatDateTime,
  formatShort,
  fromLocalInputValue,
  localZone,
  plural,
  toLocalInputValue,
} from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadingRows,
  Meter,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Stat,
  StatusBadge,
  cx,
} from '@/components/ui';

interface Filters {
  status: EmailStatus[];
  accountId: string;
  group: string;
  search: string;
}

const EMPTY_FILTERS: Filters = {
  status: [],
  accountId: '',
  group: '',
  search: '',
};

/**
 * What a recipient did with a message.
 *
 * A click is shown in preference to an open because it means something an open
 * does not: Apple pre-fetches images on delivery and corporate gateways fetch
 * them on arrival, so an open is a hint. The tooltip carries the caveat rather
 * than the column, which has no room for it.
 */
function Engagement({ email }: { email: EmailDto }) {
  if (email.status !== 'sent') return <span className="text-muted">—</span>;

  if (email.firstClickAt) {
    return (
      <span
        className="inline-flex rounded-full bg-sent-soft px-2 py-0.5 text-xs font-medium text-sent"
        title={`Clicked ${formatDateTime(email.firstClickAt)}`}
      >
        Clicked
      </span>
    );
  }

  if (email.firstOpenAt) {
    return (
      <span
        className="inline-flex rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
        title={`Opened ${formatDateTime(
          email.firstOpenAt,
        )} — opens are unreliable: many mail clients fetch images before anyone reads the message`}
      >
        Opened
      </span>
    );
  }

  return <span className="text-xs text-muted">No activity</span>;
}

export default function QueuePage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The row being rescheduled, and the wall-clock value typed for it.
  const [rescheduling, setRescheduling] = useState<EmailDto | null>(null);
  const [newTime, setNewTime] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status.length) params.set('status', filters.status.join(','));
    if (filters.accountId) params.set('accountId', filters.accountId);
    if (filters.group) params.set('group', filters.group);
    if (filters.search) params.set('search', filters.search);
    params.set('page', String(page));
    params.set('pageSize', '50');
    return params.toString();
  }, [filters, page]);

  // The queue moves on its own — the poller claims and the worker sends — so
  // the table refreshes on a timer rather than only on user action.
  const emails = useSWR<Paginated<EmailDto>>(`/emails?${query}`, fetcher, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });
  const stats = useSWR<QueueStats>('/emails/stats', fetcher, {
    refreshInterval: 5000,
  });
  const accountStats = useSWR<AccountStats[]>(
    '/emails/stats/accounts',
    fetcher,
    { refreshInterval: 10000 },
  );
  const accounts = useSWR<AccountDto[]>('/accounts', fetcher);
  const groups = useSWR<string[]>('/emails/groups', fetcher);

  const filtersActive =
    filters.status.length > 0 ||
    Boolean(filters.accountId || filters.group || filters.search);

  function refreshAll() {
    void emails.mutate();
    void stats.mutate();
    void accountStats.mutate();
  }

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function act(id: string, action: 'cancel' | 'retry'): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await api(`/emails/${id}/${action}`, { method: 'POST', body: {} });
      refreshAll();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function openReschedule(email: EmailDto) {
    setNewTime(toLocalInputValue(email.scheduledAt));
    setRescheduling(email);
  }

  async function confirmReschedule(): Promise<void> {
    if (!rescheduling) return;
    const scheduledAt = fromLocalInputValue(newTime);
    if (!scheduledAt) {
      setError('That time could not be read.');
      return;
    }
    const email = rescheduling;
    setRescheduling(null);
    setBusyId(email.id);
    setError(null);
    try {
      await api(`/emails/${email.id}/reschedule`, {
        method: 'POST',
        body: { scheduledAt },
      });
      setNotice(
        `${email.toEmail} rescheduled to ${formatDateTime(scheduledAt)}.`,
      );
      refreshAll();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function bulk(action: 'cancel' | 'retry'): Promise<void> {
    const verb = action === 'cancel' ? 'Cancel' : 'Retry';
    if (
      !window.confirm(
        `${verb} every message matching the current filter? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const result = await api<{ cancelled?: number; retried?: number }>(
        `/emails/bulk/${action}`,
        {
          method: 'POST',
          body: {
            status: filters.status.length ? filters.status : undefined,
            accountId: filters.accountId || undefined,
            group: filters.group || undefined,
            search: filters.search || undefined,
          },
        },
      );
      const count = result.cancelled ?? result.retried ?? 0;
      setNotice(
        `${plural(count, 'message')} ${
          action === 'cancel' ? 'cancelled' : 'queued for retry'
        }.`,
      );
      refreshAll();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function toggleStatus(status: EmailStatus) {
    setFilter(
      'status',
      filters.status.includes(status)
        ? filters.status.filter((s) => s !== status)
        : [...filters.status, status],
    );
  }

  return (
    <Shell>
      <PageHeader
        title="Send queue"
        description={`All times shown in ${localZone()}.`}
        actions={
          <>
            <IconButton
              label="Refresh"
              onClick={refreshAll}
              loading={emails.isValidating}
              icon={<Icon>{ICONS.refresh}</Icon>}
            />
            <Button
              disabled={!filtersActive}
              onClick={() => void bulk('retry')}
            >
              <Icon className="size-3.5">{ICONS.refresh}</Icon>
              Retry filtered
            </Button>
            <Button
              variant="danger"
              disabled={!filtersActive}
              title={
                filtersActive
                  ? undefined
                  : 'Narrow the queue by mailbox, group or status first'
              }
              onClick={() => void bulk('cancel')}
            >
              <Icon className="size-3.5">{ICONS.cancel}</Icon>
              Cancel filtered
            </Button>
          </>
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

      {/* Counters */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Due now" value={stats.data?.dueNow ?? '—'} tone="neutral" />
        <Stat
          label="Next 24h"
          value={stats.data?.next24h ?? '—'}
          tone="neutral"
        />
        {/* "Sent" is the one status that accumulates forever, so its tile
            leads with today — the number the mailbox cards also show — and
            keeps the all-time total as the footnote. */}
        <Stat
          label="Sent today"
          value={stats.data?.sentToday ?? '—'}
          tone="sent"
          hint={
            stats.data ? `${stats.data.byStatus.sent.toLocaleString()} all time` : undefined
          }
        />
        {EMAIL_STATUSES.filter((s) => s !== 'sending' && s !== 'sent').map(
          (status) => (
            <Stat
              key={status}
              label={status}
              value={stats.data?.byStatus[status] ?? '—'}
              tone={status}
            />
          ),
        )}
      </div>

      {/* Per-mailbox capacity */}
      <Card title="Mailboxes today" className="mb-6">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mailbox</th>
                <th className="w-56">Sent today</th>
                <th>Pending</th>
                <th>Failed</th>
                <th>Last send</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {!accountStats.data && <LoadingRows columns={6} rows={2} />}
              {accountStats.data?.map((row) => (
                <tr key={row.accountId}>
                  <td>
                    <span className="font-medium">{row.email}</span>{' '}
                    {!row.active && <Badge tone="warn">paused</Badge>}
                  </td>
                  <td>
                    {/* The bar makes "how much room is left" a glance rather
                        than a subtraction across two columns. */}
                    <div className="flex items-center gap-2">
                      <div className="w-24">
                        <Meter
                          value={row.sentToday}
                          max={row.dailyLimit}
                          tone={
                            !row.active
                              ? 'muted'
                              : row.remainingToday === 0
                                ? 'full'
                                : 'accent'
                          }
                        />
                      </div>
                      <span
                        className={cx(
                          'text-xs tabular-nums',
                          row.remainingToday === 0 && row.active
                            ? 'font-medium text-pending'
                            : 'text-muted',
                        )}
                      >
                        {row.sentToday} / {row.dailyLimit}
                      </span>
                    </div>
                  </td>
                  <td className="tabular-nums">{row.pending}</td>
                  <td
                    className={cx(
                      'tabular-nums',
                      row.failed > 0 && 'font-medium text-failed',
                    )}
                  >
                    {row.failed}
                  </td>
                  <td className="text-muted">{formatShort(row.lastSentAt)}</td>
                  <td
                    className="max-w-xs truncate text-xs text-muted"
                    title={row.lastError ?? ''}
                  >
                    {row.lastError ?? '—'}
                  </td>
                </tr>
              ))}
              {accountStats.data?.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No mailboxes configured"
                      description="Add one before importing a campaign."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search recipient, company or subject">
            <div className="relative">
              <Icon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted">
                {ICONS.search}
              </Icon>
              <Input
                value={filters.search}
                placeholder="ada@example.com"
                className="pl-8"
                onChange={(e) => setFilter('search', e.target.value)}
              />
            </div>
          </Field>
          <Field label="Mailbox">
            <Select
              value={filters.accountId}
              onChange={(e) => setFilter('accountId', e.target.value)}
            >
              <option value="">All mailboxes</option>
              {accounts.data?.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Group">
            <Select
              value={filters.group}
              onChange={(e) => setFilter('group', e.target.value)}
            >
              <option value="">All groups</option>
              {groups.data?.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <div className="flex flex-wrap gap-1 pt-0.5">
              {EMAIL_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={filters.status.includes(status)}
                  onClick={() => toggleStatus(status)}
                  className={cx(
                    'rounded-full border px-2 py-0.5 text-xs capitalize transition',
                    filters.status.includes(status)
                      ? 'border-accent bg-accent-soft font-medium text-accent'
                      : 'border-border text-muted hover:text-ink',
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
          </Field>
        </div>
        {filtersActive && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted">
            <span>
              Showing{' '}
              {emails.data ? plural(emails.data.total, 'match', 'matches') : '…'}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {/* Queue table */}
      <Card
        title={
          <h2 className="text-sm font-semibold">
            {emails.data ? plural(emails.data.total, 'message') : 'Loading…'}
          </h2>
        }
        actions={
          emails.isValidating ? (
            <Spinner />
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-sent" />
              Live
            </span>
          )
        }
      >
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Scheduled</th>
                <th>Recipient</th>
                <th>Subject</th>
                <th>From</th>
                <th>Group</th>
                <th>Status</th>
                <th>Engagement</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!emails.data && <LoadingRows columns={8} rows={5} />}
              {emails.data?.items.map((email) => (
                <tr key={email.id}>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatDateTime(email.scheduledAt)}
                  </td>
                  <td>
                    <div className="font-medium">{email.toEmail}</div>
                    {(email.firstName || email.company) && (
                      <div className="text-xs text-muted">
                        {[email.firstName, email.company]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="max-w-xs">
                    <div className="truncate" title={email.subject}>
                      {email.subject}
                    </div>
                    {email.lastError && (
                      <div
                        className="mt-0.5 truncate text-xs text-failed"
                        title={email.lastError}
                      >
                        {email.lastError}
                      </div>
                    )}
                  </td>
                  <td className="text-xs text-muted">{email.sendingEmail}</td>
                  <td className="text-xs text-muted">{email.group ?? '—'}</td>
                  <td>
                    <StatusBadge status={email.status} />
                    {email.attempts > 0 && (
                      <div className="mt-0.5 text-xs text-muted">
                        {plural(email.attempts, 'attempt')}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <Engagement email={email} />
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {email.status === 'pending' && (
                        <>
                          <IconButton
                            label="Reschedule"
                            loading={busyId === email.id}
                            onClick={() => openReschedule(email)}
                            icon={<Icon>{ICONS.reschedule}</Icon>}
                          />
                          <IconButton
                            label="Cancel"
                            tone="danger"
                            loading={busyId === email.id}
                            onClick={() => void act(email.id, 'cancel')}
                            icon={<Icon>{ICONS.cancel}</Icon>}
                          />
                        </>
                      )}
                      {(email.status === 'failed' ||
                        email.status === 'cancelled') && (
                        <IconButton
                          label="Retry now"
                          loading={busyId === email.id}
                          onClick={() => void act(email.id, 'retry')}
                          icon={<Icon>{ICONS.refresh}</Icon>}
                        />
                      )}
                      {email.status === 'sent' && (
                        <span className="text-xs text-muted">
                          {formatShort(email.sentAt)}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {emails.data?.items.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title="Nothing matches"
                      description={
                        filtersActive
                          ? 'Try clearing a filter.'
                          : 'Import a sheet to queue your first campaign.'
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {emails.data && (
          <Pagination
            page={page}
            pageSize={emails.data.pageSize}
            total={emails.data.total}
            onPage={setPage}
          />
        )}
      </Card>

      <Dialog
        open={rescheduling !== null}
        onClose={() => setRescheduling(null)}
        title="Reschedule"
        description={
          rescheduling && (
            <>
              <span className="font-medium text-ink">
                {rescheduling.toEmail}
              </span>{' '}
              is due {formatDateTime(rescheduling.scheduledAt)}.
            </>
          )
        }
        footer={
          <>
            <Button onClick={() => setRescheduling(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!newTime}
              onClick={() => void confirmReschedule()}
            >
              Move it
            </Button>
          </>
        }
      >
        <Field label={`New send time (${localZone()})`}>
          <Input
            type="datetime-local"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirmReschedule();
            }}
          />
        </Field>
      </Dialog>
    </Shell>
  );
}
