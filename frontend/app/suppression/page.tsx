'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { Paginated, SuppressionDto, SuppressionReason } from '@tmx-scheduler/shared';
import { SUPPRESSION_REASONS } from '@tmx-scheduler/shared';
import { Shell } from '@/components/Shell';
import { ICONS, Icon } from '@/components/icons';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatShort, plural } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadingRows,
  PageHeader,
  Pagination,
  ROWS_PER_PAGE,
  Select,
  Textarea,
} from '@/components/ui';

/** Reasons the tool records on its own versus ones a person typed in. */
const REASON_TONE: Record<SuppressionReason, 'bad' | 'warn' | 'neutral'> = {
  bounce: 'bad',
  complaint: 'bad',
  unsubscribe: 'warn',
  reply_no: 'warn',
  manual: 'neutral',
};

export default function SuppressionPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [emails, setEmails] = useState('');
  const [reason, setReason] = useState<SuppressionReason>('manual');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useSWR<Paginated<SuppressionDto>>(
    `/suppression?page=${page}&pageSize=${ROWS_PER_PAGE}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    fetcher,
    { keepPreviousData: true },
  );

  // Counted live so the button can say how many it is about to add.
  const pending = emails
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!pending.length) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ added: number; submitted: number }>(
        '/suppression',
        { method: 'POST', body: { emails: pending, reason, note: note || undefined } },
      );
      const already = result.submitted - result.added;
      setNotice(
        `${plural(result.added, 'address', 'addresses')} added` +
          (already > 0 ? `; ${already} already listed.` : '.'),
      );
      setEmails('');
      setNote('');
      void list.mutate();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(email: string) {
    if (
      !window.confirm(
        `Remove ${email} from the suppression list? They will be able to receive campaign mail again.`,
      )
    ) {
      return;
    }
    try {
      await api(`/suppression/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      void list.mutate();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const columns = isAdmin ? 5 : 4;

  return (
    <Shell>
      <PageHeader
        title="Suppression list"
        description="Addresses that must never be contacted again. Import rejects them, and the worker re-checks at send time."
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

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card title="Add addresses">
          <form onSubmit={add} className="grid gap-4 p-4">
            <Field
              label="Email addresses"
              hint="One per line, or separated by commas."
            >
              <Textarea
                rows={5}
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder={'ada@example.com\nalan@example.com'}
              />
            </Field>
            <Field label="Reason">
              <Select
                value={reason}
                onChange={(e) =>
                  setReason(e.target.value as SuppressionReason)
                }
              >
                {SUPPRESSION_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {value.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!pending.length}
            >
              {pending.length
                ? `Add ${plural(pending.length, 'address', 'addresses')}`
                : 'Add to list'}
            </Button>
          </form>
        </Card>

        <Card
          title={
            list.data
              ? plural(list.data.total, 'suppressed address', 'suppressed addresses')
              : 'Suppressed addresses'
          }
          actions={
            <div className="relative">
              <Icon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted">
                {ICONS.search}
              </Icon>
              <Input
                value={search}
                placeholder="Search…"
                className="w-52 pl-8"
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            </div>
          }
        >
          <div className="table-scroll table-scroll-wide">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Reason</th>
                  <th>Note</th>
                  <th>Added</th>
                  {isAdmin && <th className="w-12" />}
                </tr>
              </thead>
              <tbody>
                {!list.data && <LoadingRows columns={columns} rows={4} />}
                {list.data?.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="font-medium">{entry.email}</td>
                    <td>
                      <Badge tone={REASON_TONE[entry.reason] ?? 'neutral'}>
                        {entry.reason.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td
                      className="max-w-xs truncate text-xs text-muted"
                      title={entry.note ?? ''}
                    >
                      {entry.note ?? '—'}
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {formatShort(entry.createdAt)}
                    </td>
                    {isAdmin && (
                      <td className="text-right">
                        <IconButton
                          label="Remove from list"
                          tone="danger"
                          onClick={() => void remove(entry.email)}
                          icon={<Icon>{ICONS.trash}</Icon>}
                        />
                      </td>
                    )}
                  </tr>
                ))}
                {list.data?.items.length === 0 && (
                  <tr>
                    <td colSpan={columns}>
                      <EmptyState
                        title={search ? 'No matches' : 'Nothing suppressed'}
                        description={
                          search
                            ? 'Try a shorter search.'
                            : 'Bounces and unsubscribes land here automatically.'
                        }
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {list.data && (
            <Pagination
              page={page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={setPage}
            />
          )}
        </Card>
      </div>
    </Shell>
  );
}
