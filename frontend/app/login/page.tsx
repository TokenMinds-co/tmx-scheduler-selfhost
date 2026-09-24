'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not reach the API. Is the backend running?',
      );
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      {/* A wash of the brand colour behind the card, so the sign-in screen
          belongs to the same product as the dashboard behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[48rem] -translate-x-1/2 rounded-full bg-accent-soft blur-3xl"
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg shadow-accent/5"
      >
        <span
          aria-hidden
          className="brand-gradient mb-4 grid size-10 place-items-center rounded-xl text-sm font-extrabold text-white"
        >
          T
        </span>
        <h1 className="flex items-baseline gap-1.5">
          <span className="brand-text text-2xl font-extrabold tracking-tight">
            TMX
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Scheduler
          </span>
        </h1>
        <p className="mt-1 mb-5 text-sm text-muted">
          Sign in to manage mailboxes and the send queue.
        </p>

        {error && (
          <div className="mb-4">
            <Alert onDismiss={() => setError(null)}>{error}</Alert>
          </div>
        )}

        <div className="space-y-3">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
        </div>

        <Button
          type="submit"
          variant="primary"
          loading={busy}
          className="mt-5 w-full"
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
