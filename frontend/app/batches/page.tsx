'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import type { BatchDto, EmailStatus } from '@ims/shared';
import { Shell } from '@/components/Shell';
import { ICONS, Icon } from '@/components/icons';
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
  IconButton,
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
 * One number, its share as a bar, and the count it came from.
 *
 * The bar is the point: three percentages side by side are three numbers to
 * compare in your head, and three bars of different lengths are one glance.
 * It is drawn against the same 0–100% track in every card, so batches can be
 * compared down the column as well as across the row.
 */
function Metric({
  label,
  value,
  detail,
  share,
  tone,
  title,
}: {
  label: string;
  value: string;
  detail: string;
  share: number;
  tone: 'accent' | 'sent';
  /** What the number is made of, for whoever hovers to ask. */
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="truncate text-xs text-muted">{detail}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-canvas">
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-500',
            tone === 'sent' ? 'bg-sent' : 'bg-accent',
          )}
          // Clamped, because a rate can exceed 1: a recipient who opens a
          // message they were sent twice is counted on both rows.
          style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
        />
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted">
        {label}
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
  const queued = stats.byStatus.pending + stats.byStatus.sending;
  const progress = batch.inserted ? stats.sent / batch.inserted : 0;

  return (
    <Card>
      <div className="p-4">
        {/* Identity and actions. One row, so the eye runs along the batch
            names when scanning the list rather than hunting across a gap. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                Batch {batch.number}
              </span>
              <h2 className="truncate font-medium" title={batch.name}>
                {batch.name}
              </h2>
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

            {/* Where it came from and who ran it — the questions asked of a
                batch nobody recognises. */}
            <p className="mt-1 text-xs text-muted">
              Imported {formatShort(batch.createdAt)}
              {batch.createdBy && <> by {batch.createdBy}</>}
              {batch.sourceFile && <> · {batch.sourceFile}</>}
              {stats.lastSentAt && (
                <> · last send {formatShort(stats.lastSentAt)}</>
              )}
            </p>

            {/* A 0% that is not a result but a configuration: the mail has
                nothing to click. Judged against the mailboxes as they are
                set up now, so it clears once the signature is fixed. */}
            {stats.untracked > 0 && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-pending-soft px-2 py-1 text-xs text-pending">
                <Icon className="size-3.5 shrink-0">{ICONS.alert}</Icon>
                <span>
                  {stats.untracked === batch.inserted
                    ? 'No message in this batch carries'
                    : `${stats.untracked.toLocaleString()} of ${batch.inserted.toLocaleString()} messages carry no`}{' '}
                  link that can be tracked — clicks cannot be recorded for them.
                  Check the mailbox’s P.S. link.
                </span>
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Link href={`/queue?batch=${batch.id}`}>
              <Button>Messages</Button>
            </Link>
            {canRename && (
              <IconButton
                label="Rename batch"
                onClick={() => onRename(batch)}
                icon={<Icon>{ICONS.pencil}</Icon>}
              />
            )}
          </div>
        </div>

        {/* The numbers, on their own line and evenly spread. Three equal
            columns fill the card at any width, where a right-aligned cluster
            left a hole in the middle of a wide screen. */}
        <div className="mt-3 grid gap-x-6 gap-y-4 border-t border-border pt-3 sm:grid-cols-3">
          <Metric
            label="Emails sent"
            value={stats.sent.toLocaleString()}
            detail={
              queued
                ? `${queued.toLocaleString()} still queued`
                : `of ${batch.inserted.toLocaleString()}`
            }
            share={progress}
            tone="accent"
          />
          <Metric
            label="Opened"
            value={percent(stats.openRate)}
            detail={`${stats.opened.toLocaleString()} of ${stats.sent.toLocaleString()}`}
            share={stats.openRate}
            tone="sent"
          />
          <Metric
            label="Clicked"
            value={percent(stats.clickRate)}
            // People only. A gateway following the link is not a click, so
            // it is neither counted nor mentioned.
            detail={`${stats.clicked.toLocaleString()} of ${stats.sent.toLocaleString()}`}
            share={stats.clickRate}
            tone="accent"
            // Whether the link is even being reached, for anyone who asks why
            // a rate is zero: fetches of any kind mean tracking is working.
            title={
              stats.clickFetches === 0
                ? 'No link fetch has been recorded on this batch — nothing, person or scanner, has followed a link yet.'
                : `${plural(stats.clicked, 'person', 'people')} clicked · ${plural(
                    stats.clickFetches,
                    'link fetch',
                    'link fetches',
                  )} recorded${
                    stats.clicked === 0 ? ', all judged automatic' : ''
                  }`
            }
          />
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
