'use client';

import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useRef, useState, type DragEvent } from 'react';
import type { AccountDto, ImportResult } from '@tmx-scheduler/shared';
import { COMMON_TIMEZONES, DEFAULTS, IMPORT_COLUMNS } from '@tmx-scheduler/shared';
import { Shell } from '@/components/Shell';
import { ICONS, Icon } from '@/components/icons';
import { api, fetcher } from '@/lib/api';
import { plural } from '@/lib/format';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Stat,
  cx,
  usePagedRows,
} from '@/components/ui';

/**
 * Built from IMPORT_COLUMNS so the template cannot drift from the columns the
 * parser actually reads. Two example rows: one bare local time, which the
 * timezone dropdown resolves, and one carrying its own zone, which overrides it.
 */
function templateCsv(sender: string): string {
  const rows: Record<string, string>[] = [
    {
      'Sending Email': sender,
      'First Name': 'Ada',
      'Last Name': 'Lovelace',
      Email: 'ada@example.com',
      Company: 'Analytical Engines',
      Schedule: 'Sep 10 2026 9:00 AM',
      Message:
        'Hi {{firstName}}, I noticed {{company}} is hiring. Our case studies are at https://tokenminds.co/work',
      'Message HTML':
        '<p>Hi {{firstName}}, I noticed {{company}} is hiring.</p><p>Our <a href="https://tokenminds.co/work">case studies</a> might be useful.</p>',
      Subject: 'Quick question for {{company}}',
      Group: 'pilot-2026',
    },
    {
      'Sending Email': sender,
      'First Name': 'Alan',
      'Last Name': 'Turing',
      Email: 'alan@example.com',
      Company: 'Bletchley',
      Schedule: 'Sep 10 2026 2:30 PM',
      Message: 'Hi {{firstName}}, following up on my last note.',
      'Message HTML': '',
      Subject: 'Following up',
      Group: 'pilot-2026',
    },
  ];

  // Quote every field and double any embedded quote: message bodies contain
  // commas as a matter of course.
  const escape = (value: string) => '"' + value.replace(/"/g, '""') + '"';

  return [
    IMPORT_COLUMNS.map(escape).join(','),
    ...rows.map((row) =>
      IMPORT_COLUMNS.map((column) => escape(row[column] ?? '')).join(','),
    ),
  ].join('\r\n');
}

function downloadTemplate(sender: string) {
  // A BOM so Excel opens it as UTF-8 instead of mangling the placeholders.
  const blob = new Blob(['﻿' + templateCsv(sender)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'tmx-scheduler-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A drop target that also opens the file picker. The native file input is
 * kept — it is what actually holds the file — but visually hidden: its default
 * rendering is a grey button with the browser's own label, which looks like a
 * control from a different application inside a styled form.
 */
function DropZone({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cx(
        'rounded-lg border-2 border-dashed p-5 text-center transition',
        over
          ? 'border-accent bg-accent-soft'
          : file
            ? 'border-border bg-canvas'
            : 'border-border hover:border-accent/50',
      )}
    >
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex items-center justify-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent">
            <Icon>{ICONS.file}</Icon>
          </span>
          <div className="min-w-0 text-left">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted">{formatSize(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="ml-2 text-xs font-medium text-accent hover:underline"
          >
            Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-2"
        >
          <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
            <Icon>{ICONS.upload}</Icon>
          </span>
          <span className="text-sm">
            <span className="font-medium text-accent">Choose a CSV</span>
            <span className="text-muted"> or drop it here</span>
          </span>
          <span className="text-xs text-muted">Up to 10 MB / 20,000 rows</span>
        </button>
      )}
    </div>
  );
}

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  // Only used to name a real sender in the downloadable template.
  const accounts = useSWR<AccountDto[]>('/accounts', fetcher);
  const templateSender =
    accounts.data?.find((account) => account.active)?.email ??
    accounts.data?.[0]?.email ??
    'outreach@yourcompany.com';

  const [defaultTimezone, setDefaultTimezone] = useState<string>(
    DEFAULTS.timezone,
  );
  const [batchName, setBatchName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function chooseFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setCommitted(null);
    setError(null);
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const result = await api<ImportResult>('/emails/import', {
        method: 'POST',
        formData: body,
        query: {
          dryRun: String(dryRun),
          defaultTimezone: defaultTimezone || undefined,
          batchName: batchName.trim() || undefined,
        },
      });
      if (dryRun) {
        setPreview(result);
        setCommitted(null);
      } else {
        setCommitted(result);
        setPreview(null);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const result = committed ?? preview;
  // A bad sheet can fail hundreds of rows; they page rather than fill the screen.
  const errorRows = usePagedRows(result?.errors);
  // The primary action moves with the workflow: check first, then queue.
  const canQueue = Boolean(preview && preview.inserted > 0 && !committed);

  return (
    <Shell>
      <PageHeader
        title="Import a sheet"
        description="Check the file first, then commit. Nothing is queued until you do."
        actions={
          <Button onClick={() => downloadTemplate(templateSender)}>
            <Icon className="size-3.5">{ICONS.file}</Icon>
            Download template
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card title="File">
            <div className="grid gap-4 p-4">
              <DropZone file={file} onFile={chooseFile} />
              <Field
                label="Name this batch"
                hint="Optional. Left empty it is called after its own number — Batch 7 — and can be renamed from the batches screen at any time."
              >
                <Input
                  value={batchName}
                  placeholder={
                    file
                      ? file.name.replace(/\.csv$/i, '')
                      : 'Autumn outreach — US'
                  }
                  maxLength={120}
                  onChange={(e) => setBatchName(e.target.value)}
                />
              </Field>
              <Field
                label="What timezone is this sheet written in?"
                hint="Applied to Schedule cells that carry no zone of their own. A cell that names its own zone always overrides this."
              >
                <Select
                  value={defaultTimezone}
                  onChange={(e) => setDefaultTimezone(e.target.value)}
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <Button
                variant={canQueue ? 'secondary' : 'primary'}
                disabled={!file || Boolean(committed)}
                loading={busy && !canQueue}
                onClick={() => void run(true)}
              >
                <Icon className="size-3.5">{ICONS.check}</Icon>
                {preview ? 'Check again' : 'Check file'}
              </Button>
              <Button
                variant={canQueue ? 'primary' : 'secondary'}
                disabled={!canQueue}
                loading={busy && canQueue}
                onClick={() => void run(false)}
                title={
                  preview
                    ? undefined
                    : 'Run the check first so you can see what will be queued'
                }
              >
                <Icon className="size-3.5">{ICONS.send}</Icon>
                {preview
                  ? `Queue ${plural(preview.inserted, 'message')}`
                  : 'Queue'}
              </Button>
              {preview && !committed && (
                <span className="text-xs text-muted">
                  Checked — nothing has been queued yet.
                </span>
              )}
            </div>
          </Card>

          {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

          {committed && (
            <Alert tone="success">
              Queued {plural(committed.inserted, 'message')}
              {committed.batch ? (
                <>
                  {' '}
                  as batch {committed.batch.number}, “{committed.batch.name}
                  ”
                </>
              ) : (
                <> — every row was already in the queue, so no batch was opened</>
              )}
              .{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => router.push('/queue')}
              >
                Open the queue
              </button>
            </Alert>
          )}

          {result && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Rows read" value={result.totalRows} />
                <Stat
                  label={committed ? 'Queued' : 'Will queue'}
                  value={result.inserted}
                  tone="sent"
                />
                <Stat
                  label="Skipped"
                  value={result.skippedDuplicates + result.skippedSuppressed}
                  tone="cancelled"
                  hint={`${result.skippedDuplicates} duplicate · ${result.skippedSuppressed} suppressed`}
                />
                <Stat
                  label="Errors"
                  value={result.errors.length}
                  tone="failed"
                />
              </div>

              {/* Said here, while the sheet is still open, because after the
                  send it only ever shows as 0% clicked. */}
              {result.untracked.rows > 0 && (
                <Alert tone="warning">
                  <span className="font-medium">
                    {result.untracked.rows === result.inserted
                      ? 'None of these messages'
                      : `${result.untracked.rows.toLocaleString()} of these messages`}
                  </span>{' '}
                  carry a link that can be tracked, so clicks will never be
                  recorded for them. The message has no URL, and{' '}
                  {result.untracked.mailboxes.length === 1
                    ? `the mailbox ${result.untracked.mailboxes[0]} has`
                    : `the mailboxes ${result.untracked.mailboxes.join(', ')} have`}{' '}
                  no P.S. link in the signature. Add one, or a link to the
                  sheet, before queueing if this batch should report clicks.
                </Alert>
              )}

              {result.errors.length > 0 && (
                <Card
                  title={`${plural(result.errors.length, 'row')} need attention`}
                >
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Recipient</th>
                          <th>Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errorRows.rows?.map((row) => (
                          <tr key={`${row.row}-${row.toEmail}`}>
                            <td className="tabular-nums">{row.row}</td>
                            <td>{row.toEmail ?? '—'}</td>
                            <td className="text-failed">{row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={errorRows.page}
                    pageSize={errorRows.pageSize}
                    total={errorRows.total}
                    onPage={errorRows.setPage}
                  />
                  <p className="border-t border-border px-4 py-2 text-xs text-muted">
                    These rows are skipped. Fix them in the sheet and import
                    again — already-queued rows will be recognised as duplicates.
                  </p>
                </Card>
              )}
            </>
          )}
        </div>

        <Card title="Expected columns">
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-4 text-sm lg:grid-cols-1">
            {IMPORT_COLUMNS.map((column) => (
              <li key={column}>
                <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent">
                  {column}
                </code>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t border-border px-4 py-3 text-xs leading-relaxed text-muted">
            <p>
              <strong className="text-ink">Schedule</strong> can be a plain
              date and time — <code>Sep 10 2026 9:00 AM</code> — and the
              timezone chosen on the left is applied to it. A cell may still
              carry its own zone (<code>Sep 10 2026 9:00 AM SGT</code>), which
              overrides the dropdown for that row.
            </p>
            <p>
              <strong className="text-ink">Message</strong> and{' '}
              <strong className="text-ink">Subject</strong> may use{' '}
              <code>{'{{firstName}}'}</code>, <code>{'{{lastName}}'}</code>,{' '}
              <code>{'{{company}}'}</code> and <code>{'{{email}}'}</code>.
            </p>
            <p>
              <strong className="text-ink">Message HTML</strong> is optional.
              Fill it in to control the formatting and to use real links —{' '}
              <code>&lt;a href&gt;</code> — instead of bare URLs. Leave it blank
              and the HTML half is derived from Message. Either way Message is
              required, as the plain-text alternative.
            </p>
            <p>
              <strong className="text-ink">Sending Email</strong> must match a
              configured, active mailbox.
            </p>
            <p>
              Signatures and the unsubscribe line are added automatically — do
              not put them in the sheet.
            </p>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
