'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import type {
  AccountDto,
  AccountStats,
  BatchDto,
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
  ROWS_PER_PAGE,
  Select,
  Spinner,
  Stat,
  StatusBadge,
  cx,
  usePagedRows,
} from '@/components/ui';

interface Filters {
  status: EmailStatus[];
  accountId: string;
  group: string;
  batchId: string;
  search: string;
}

const EMPTY_FILTERS: Filters = {
  status: [],
  accountId: '',
  group: '',
  batchId: '',
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

/**
 * What the mailbox table says when it is closed.
 *
 * Capacity across every mailbox as one bar, and anything that would make
 * someone open it — mail waiting, sends that failed — called out by name.
 */
function MailboxSummary({ rows }: { rows: AccountStats[] | undefined }) {
  if (!rows) {
    return <div className="h-12 animate-pulse bg-canvas/60" aria-hidden />;
  }

  const sent = rows.reduce((n, row) => n + row.sentToday, 0);
  const capacity = rows.reduce((n, row) => n + row.dailyLimit, 0);
  const pending = rows.reduce((n, row) => n + row.pending, 0);
  const failed = rows.reduce((n, row) => n + row.failed, 0);
  const paused = rows.filter((row) => !row.active).length;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="w-28">
          <Meter value={sent} max={capacity} tone={sent >= capacity ? 'full' : 'accent'} />
        </div>
        <span className="tabular-nums">
          {sent.toLocaleString()} / {capacity.toLocaleString()}
        </span>
        <span className="text-muted">sent today</span>
      </div>

      <span className="text-muted">
        {plural(rows.length, 'mailbox', 'mailboxes')}
        {paused > 0 && <> · {paused} paused</>}
      </span>

      {pending > 0 && (
        <span className="text-muted">
          {plural(pending, 'message')} waiting
        </span>
      )}
      {failed > 0 && (
        <span className="font-medium text-failed">
          {plural(failed, 'failure')}
        </span>
      )}
    </div>
  );
}

/**
 * `?batch=<id>` is how the batch list drills in here, so the filter is read
 * from the URL as well as from the dropdown — which also makes a filtered
 * queue a link somebody can send.
 */
function QueueView() {
  const batchParam = useSearchParams().get('batch') ?? '';
  const [filters, setFilters] = useState<Filters>({
    ...EMPTY_FILTERS,
    batchId: batchParam,
  });
  const [page, setPage] = useState(1);
  // Collapsed by default. Mailbox capacity is a glance-and-forget number, and
  // expanded it pushed the queue itself — the reason the page exists — below
  // the fold on a laptop. The summary keeps what would make someone look.
  const [mailboxesOpen, setMailboxesOpen] = useState(false);
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
    if (filters.batchId) params.set('batchId', filters.batchId);
    if (filters.search) params.set('search', filters.search);
    params.set('page', String(page));
    params.set('pageSize', String(ROWS_PER_PAGE));
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
  const batches = useSWR<BatchDto[]>('/batches', fetcher);
  // A row carries only its batch id. The list the filter already loaded is
  // what turns that into the number people actually say.
  const batchById = useMemo(
    () => new Map((batches.data ?? []).map((batch) => [batch.id, batch])),
    [batches.data],
  );

  // Arriving from the batch list, or moving between two batches without this
  // page unmounting in between.
  useEffect(() => {
    setPage(1);
    setFilters((current) => ({ ...current, batchId: batchParam }));
  }, [batchParam]);
  // Every mailbox comes back in one response, so this table pages client-side.
  const mailboxRows = usePagedRows(accountStats.data);

  const filtersActive =
    filters.status.length > 0 ||
    Boolean(
      filters.accountId || filters.group || filters.batchId || filters.search,
    );

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
      <Card
        title="Mailboxes today"
        className="mb-6"
        actions={
          <Button variant="ghost" onClick={() => setMailboxesOpen((o) => !o)}>
            {mailboxesOpen ? 'Hide' : 'Show'}
            <Icon
              className={cx(
                'size-3.5 transition-transform',
                mailboxesOpen && 'rotate-180',
              )}
            >
              {ICONS.chevron}
            </Icon>
          </Button>
        }
      >
        {!mailboxesOpen && <MailboxSummary rows={accountStats.data} />}
        <div hidden={!mailboxesOpen} className="table-scroll table-scroll-wide">
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
              {mailboxRows.rows?.map((row) => (
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

        {mailboxesOpen && (
          <Pagination
            page={mailboxRows.page}
            pageSize={mailboxRows.pageSize}
            total={mailboxRows.total}
            onPage={mailboxRows.setPage}
          />
        )}
      </Card>

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
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
          </div>
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
          <Field label="Batch">
            <Select
              value={filters.batchId}
              onChange={(e) => setFilter('batchId', e.target.value)}
            >
              <option value="">All batches</option>
              {batches.data?.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  Batch {batch.number} · {batch.name}
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
        </div>

        {/* Status is a row of toggles, not a form field, and it shares its line
            with the count so the filter bar ends on what it selected. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted">
              Status
            </span>
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
          {filtersActive && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>
                Showing{' '}
                {emails.data
                  ? plural(emails.data.total, 'match', 'matches')
                  : '…'}
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
        </div>
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
                <th>Sent from</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!emails.data && <LoadingRows columns={5} rows={5} />}
              {emails.data?.items.map((email) => (
                <tr key={email.id}>
                  {/* The zone is stated once in the page header, so every row
                      does not have to repeat "GMT+7". */}
                  <td className="whitespace-nowrap tabular-nums">
                    <div title={formatDateTime(email.scheduledAt)}>
                      {formatShort(email.scheduledAt)}
                    </div>
                    {email.sentAt && (
                      <div className="text-xs text-muted">
                        sent {formatShort(email.sentAt)}
                      </div>
                    )}
                  </td>

                  {/* Who it is for, then what they were sent. The subject used
                      to have a column of its own, which on a campaign repeated
                      the same sentence down the entire screen. */}
                  <td className="max-w-sm">
                    <div className="truncate font-medium">{email.toEmail}</div>
                    {(email.firstName || email.company) && (
                      <div className="truncate text-xs text-muted">
                        {[email.firstName, email.company]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                    <div
                      className="truncate text-xs text-muted"
                      title={email.subject}
                    >
                      {email.subject}
                    </div>
                  </td>

                  {/* Every mailbox here is anchor@<something>, so the domain is
                      the part worth reading. Below it, where the message came
                      from: its batch, and the group the sheet gave it. */}
                  <td className="text-xs">
                    <div className="whitespace-nowrap">
                      <span className="text-muted">
                        {email.sendingEmail.split('@')[0]}@
                      </span>
                      {email.sendingEmail.split('@')[1]}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {email.batchId && (
                        // Clicking it filters to that batch, which is the thing
                        // anyone wants next after noticing which batch a row is
                        // from.
                        <button
                          type="button"
                          title={
                            batchById.get(email.batchId)?.name ??
                            'Filter to this batch'
                          }
                          onClick={() =>
                            setFilter('batchId', email.batchId as string)
                          }
                          className="rounded-full bg-accent-soft px-1.5 py-0.5 font-medium text-accent transition hover:opacity-80"
                        >
                          Batch {batchById.get(email.batchId)?.number ?? '…'}
                        </button>
                      )}
                      {email.group && (
                        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-muted">
                          {email.group}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status, what the recipient did with it, and why it failed:
                      one story about one message, in one column. */}
                  <td className="max-w-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={email.status} />
                      <Engagement email={email} />
                    </div>
                    {email.attempts > 1 && (
                      <div className="mt-0.5 text-xs text-muted">
                        {plural(email.attempts, 'attempt')}
                      </div>
                    )}
                    {email.lastError && (
                      <div
                        className="mt-0.5 truncate text-xs text-failed"
                        title={email.lastError}
                      >
                        {email.lastError}
                      </div>
                    )}
                  </td>

                  {/* Sent and sending mail has nothing to act on, and an
                      empty cell reads as a button that failed to draw. */}
                  <td className="w-24 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {(email.status === 'sent' || email.status === 'sending') && (
                        <span className="text-muted">—</span>
                      )}
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
                    </div>
                  </td>
                </tr>
              ))}
              {emails.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5}>
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

export default function QueuePage() {
  // useSearchParams() suspends, and the queue is a static route; without this
  // boundary the build refuses the page rather than the browser.
  return (
    <Suspense fallback={null}>
      <QueueView />
    </Suspense>
  );
}
