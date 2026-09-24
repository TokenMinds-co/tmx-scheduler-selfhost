'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type {
  AuditEntryDto,
  Paginated,
  SessionUserDto,
  UserRole,
} from '@tmx-scheduler/shared';
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
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadingRows,
  PageHeader,
  Pagination,
  ROWS_PER_PAGE,
  Select,
  usePagedRows,
} from '@/components/ui';

/**
 * Audit metadata is whatever the action recorded — a mailbox id, a count, a
 * filter. Shown as `key value` pairs rather than the raw JSON the table used
 * to print, which put braces and quotes in front of anyone reading a log.
 */
function Metadata({ value }: { value: Record<string, unknown> | null }) {
  if (!value || !Object.keys(value).length) {
    return <span className="text-muted">—</span>;
  }
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
      {Object.entries(value).map(([key, raw]) => (
        <div key={key} className="flex items-baseline gap-1">
          <dt className="text-muted">{key}</dt>
          <dd className="max-w-[16rem] truncate font-mono text-[11px]">
            {typeof raw === 'string' ? raw : JSON.stringify(raw)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const users = useSWR<SessionUserDto[]>(
    isAdmin ? '/auth/users' : null,
    fetcher,
  );
  // /auth/users returns every operator at once, so this table pages here.
  const userRows = usePagedRows(users.data);
  const [auditPage, setAuditPage] = useState(1);
  const audit = useSWR<Paginated<AuditEntryDto>>(
    isAdmin ? `/audit?page=${auditPage}&pageSize=${ROWS_PER_PAGE}` : null,
    fetcher,
    // Paging keeps the current rows on screen instead of flashing the loading
    // skeleton between two pages that are both already one request away.
    { keepPreviousData: true },
  );

  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    role: 'operator' as UserRole,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isAdmin) {
    return (
      <Shell>
        <PageHeader title="Settings" />
        <Card>
          <EmptyState
            title="Admins only"
            description="User management and the audit log need the admin role."
          />
        </Card>
      </Shell>
    );
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/auth/users', { method: 'POST', body: form });
      setNotice(`Created ${form.email}.`);
      setForm({ email: '', name: '', password: '', role: 'operator' });
      void users.mutate();
      void audit.mutate();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(target: SessionUserDto) {
    if (
      !window.confirm(
        `Delete ${target.email}? They will be signed out and unable to sign in again.`,
      )
    ) {
      return;
    }
    try {
      await api(`/auth/users/${target.id}`, { method: 'DELETE' });
      void users.mutate();
      void audit.mutate();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Settings"
        description="Who can operate the tool, and what they have done with it."
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
        <Card title="Add a user">
          <form onSubmit={createUser} className="grid gap-3 p-4">
            <Field label="Email">
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Name">
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Password" hint="At least 10 characters.">
              <Input
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field
              label="Role"
              hint="Operators can import and manage the queue; admins also manage mailboxes and users."
            >
              <Select
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as UserRole })
                }
              >
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Button type="submit" variant="primary" loading={busy}>
              <Icon className="size-3.5">{ICONS.user}</Icon>
              Create user
            </Button>
          </form>
        </Card>

        <Card title="Users">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {!users.data && <LoadingRows columns={4} rows={2} />}
                {userRows.rows?.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">
                      {row.email}
                      {row.id === user?.id && (
                        <span className="ml-2 text-xs text-muted">(you)</span>
                      )}
                    </td>
                    <td>{row.name}</td>
                    <td>
                      <Badge tone={row.role === 'admin' ? 'good' : 'neutral'}>
                        {row.role}
                      </Badge>
                    </td>
                    <td className="text-right">
                      {row.id !== user?.id && (
                        <IconButton
                          label="Delete user"
                          tone="danger"
                          onClick={() => void removeUser(row)}
                          icon={<Icon>{ICONS.trash}</Icon>}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={userRows.page}
            pageSize={userRows.pageSize}
            total={userRows.total}
            onPage={userRows.setPage}
          />
        </Card>
      </div>

      <Card title="Audit log" className="mt-4">
        <div className="table-scroll table-scroll-wide">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {!audit.data && <LoadingRows columns={5} rows={4} />}
              {audit.data?.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-muted">
                    {formatShort(entry.createdAt)}
                  </td>
                  <td className="whitespace-nowrap">{entry.actorEmail}</td>
                  <td>
                    <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs">
                      {entry.action}
                    </code>
                  </td>
                  <td
                    className="max-w-[14rem] truncate"
                    title={entry.target ?? ''}
                  >
                    {entry.target ?? '—'}
                  </td>
                  <td className="text-xs">
                    <Metadata value={entry.metadata} />
                  </td>
                </tr>
              ))}
              {audit.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState title="Nothing logged yet" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {audit.data && (
          <Pagination
            page={auditPage}
            pageSize={audit.data.pageSize}
            total={audit.data.total}
            onPage={setAuditPage}
          />
        )}
      </Card>
    </Shell>
  );
}
