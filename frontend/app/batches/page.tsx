'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import type { BatchDto, EmailStatus } from '@ims/shared';
import { Shell } from '@/components/Shell';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatShort, plural } from '@/lib/format';
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Stat,
  cx,
  usePagedRows,
} from '@/components/ui';

/** 0.638 → "63.8%". Two significant places; a tenth of a point is signal here. */
function percent(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * The statuses worth putting on a batch card.
 *
 * `sent` is already the headline number and `sending` is a state a row is in
 * for seconds, so neither earns a chip. What is left is what somebody might
 * have to act on.
 */
const CHIP_STATUSES: EmailStatus[] = ['pending', 'failed', 'cancelled'];

const CHIP_CLASS: Record<string, string> = {
  pending: 'bg-pending-soft text-pending',
  failed: 'bg-failed-soft text-failed',
  cancelled: 'bg-cancelled-soft text-cancelled',
};

/**
 * One rate, with the rule beside it.
 *
 * The rule is what separates the two rates from the count to their left at a
 * glance — the same job the vertical keyline does in a campaign report.
 */
function Rate({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'open' | 'click';
}) {
  return (
    <div className="flex items-stretch gap-3">
      <div
        className={cx(
          'w-0.5 rounded-full',
          tone === 'open' ? 'bg-sent' : 'bg-accent',
        )}
      />
      <div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}

function BatchCard({
  batch,
  canRename,
  onRename,
}: {
  batch: BatchDto;
  canRename: boolean;
  onRename: (batch: BatchDto) => void;
}) {
  const { stats } = batch;
  const sending = stats.byStatus.pending + stats.byStatus.sending > 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4">
        <div className="min-w-[16rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              Batch {batch.number}
            </span>
            {CHIP_STATUSES.map((status) =>
              stats.byStatus[status] > 0 ? (
                <span
                  key={status}
                  className={cx(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    CHIP_CLASS[status],
                  )}
                >
                  {stats.byStatus[status].toLocaleString()} {status}
                </span>
              ) : null,
            )}
          </div>

          <h2 className="mt-1.5 truncate font-medium" title={batch.name}>
            {batch.name}
          </h2>

          {/* Where it came from and who ran it — the questions asked of a batch
              nobody recognises. */}
          <p className="mt-0.5 text-xs text-muted">
            Imported {formatShort(batch.createdAt)}
            {batch.createdBy && <> by {batch.createdBy}</>}
            {stats.lastSentAt && <> · last send {formatShort(stats.lastSentAt)}</>}
          </p>
        </div>

        <div>
          <div className="text-lg font-semibold tabular-nums">
            {stats.sent.toLocaleString()}
          </div>
          <div className="text-xs text-muted">
            {sending ? `of ${batch.inserted.toLocaleString()} sent` : 'emails sent'}
          </div>
        </div>

        <Rate label="opened" value={percent(stats.openRate)} tone="open" />
        <Rate label="clicked" value={percent(stats.clickRate)} tone="click" />

        <div className="flex gap-2">
          <Link href={`/queue?batch=${batch.id}`}>
            <Button>Messages</Button>
          </Link>
          {canRename && (
            <Button variant="ghost" onClick={() => onRename(batch)}>
              Rename
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function BatchesPage() {
  const { user } = useAuth();
  const batches = useSWR<BatchDto[]>('/batches', fetcher, {
    // Slower than the queue: a batch's numbers move as mail sends, but nobody
    // watches this page waiting for a single row to flip.
    refreshInterval: 30_000,
  });

  const paged = usePagedRows(batches.data);
  const [renaming, setRenaming] = useState<BatchDto | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Totals across every batch, not an average of the rates: a batch of 40 must
  // not weigh as heavily as one of 4,000.
  const totals = (batches.data ?? []).reduce(
    (sum, batch) => ({
      sent: sum.sent + batch.stats.sent,
      opened: sum.opened + batch.stats.opened,
      clicked: sum.clicked + batch.stats.clicked,
    }),
    { sent: 0, opened: 0, clicked: 0 },
  );

  function openRename(batch: BatchDto) {
    setName(batch.name);
    setRenaming(batch);
  }

  async function confirmRename() {
    if (!renaming) return;
    const batch = renaming;
    setRenaming(null);
    setBusy(true);
    setError(null);
    try {
      await api(`/batches/${batch.id}`, { method: 'PATCH', body: { name } });
      void batches.mutate();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Batches"
        description="Every import that reached the queue, and how the mail it queued performed."
      />

      {error && <Alert>{error}</Alert>}
      {batches.error && <Alert>{(batches.error as Error).message}</Alert>}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Batches" value={batches.data?.length ?? '—'} />
        <Stat
          label="Emails sent"
          value={batches.data ? totals.sent.toLocaleString() : '—'}
          tone="sent"
        />
        <Stat
          label="Opened"
          value={
            batches.data && totals.sent
              ? percent(totals.opened / totals.sent)
              : '—'
          }
          hint={
            batches.data && totals.sent
              ? `${percent(totals.clicked / totals.sent)} clicked`
              : undefined
          }
        />
      </div>

      {!batches.data && !batches.error && (
        <div className="grid gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-border bg-surface"
            />
          ))}
        </div>
      )}

      <div className="grid gap-3">
        {paged.rows?.map((batch) => (
          <BatchCard
            key={batch.id}
            batch={batch}
            canRename={Boolean(user)}
            onRename={openRename}
          />
        ))}
      </div>

      {batches.data?.length === 0 && (
        <Card>
          <EmptyState
            title="No batches yet"
            description="Import a sheet and the mail it queues becomes batch 1."
            action={
              <Link href="/import">
                <Button variant="primary">Import a sheet</Button>
              </Link>
            }
          />
        </Card>
      )}

      {batches.data && batches.data.length > paged.pageSize && (
        <Card className="mt-3">
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
          />
        </Card>
      )}

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={renaming ? `Rename batch ${renaming.number}` : 'Rename batch'}
        description={
          <>
            The number never changes — it is how this batch is referred to
            everywhere else. Only the label does.
          </>
        }
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!name.trim()}
              onClick={() => void confirmRename()}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              renaming ? plural(renaming.inserted, 'message') : undefined
            }
          />
        </Field>
      </Dialog>
    </Shell>
  );
}
