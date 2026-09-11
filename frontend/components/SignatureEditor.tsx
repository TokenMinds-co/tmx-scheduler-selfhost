'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SignatureDto } from '@ims/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SignatureBuilder, type SignatureValue } from './SignatureBuilder';
import { Alert, Button, Card, Field, Input } from './ui';

/**
 * One library signature: its name and what it says.
 *
 * Which mailboxes send with it is not decided here. Each mailbox picks its
 * signature on its own edit page, so there is exactly one place that changes
 * what a mailbox signs off with.
 */
export function SignatureEditor({ signature }: { signature?: SignatureDto }) {
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin';

  const [name, setName] = useState(signature?.name ?? '');
  const [value, setValue] = useState<SignatureValue>({
    html: signature?.html ?? '',
    text: signature?.text ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const users = signature?.accounts ?? [];
  // Preview with a mailbox that really sends it, when there is one, so the
  // email line reads the way at least one recipient will see it.
  const previewEmail = users[0]?.email;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give the signature a name.');
      return;
    }
    if (!value.html.trim()) {
      setError('The signature is empty — fill in a field first.');
      return;
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), html: value.html, text: value.text };
      if (signature) {
        await api<SignatureDto>(`/signatures/${signature.id}`, {
          method: 'PATCH',
          body,
        });
      } else {
        await api<SignatureDto>('/signatures', { method: 'POST', body });
      }
      router.push('/signatures');
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!signature) return;
    if (!window.confirm(`Delete "${signature.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/signatures/${signature.id}`, { method: 'DELETE' });
      router.push('/signatures');
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <Card title="Name">
        <div className="p-4">
          <Field
            label="Signature name"
            hint="Only operators see this — it is how the signature is picked on a mailbox."
          >
            <Input
              value={name}
              required
              maxLength={120}
              placeholder="Anchor Chan — CEO"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Signature">
        <div className="p-4">
          <SignatureBuilder
            value={value}
            onChange={setValue}
            previewEmail={previewEmail}
          />
        </div>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" loading={busy}>
            {signature ? 'Save changes' : 'Create signature'}
          </Button>
          <Button type="button" onClick={() => router.push('/signatures')}>
            Cancel
          </Button>
          {signature && (
            <Button
              type="button"
              variant="danger"
              className="ml-auto"
              disabled={users.length > 0}
              title={
                users.length
                  ? `Used by ${users.map((account) => account.email).join(', ')}. Pick a different signature on those mailboxes first.`
                  : undefined
              }
              onClick={() => void remove()}
            >
              Delete signature
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
