'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { fillSignature, type SignatureDto } from '@ims/shared';
import { Shell } from '@/components/Shell';
import { ICONS, Icon } from '@/components/icons';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
} from '@/components/ui';

/**
 * One signature, as a card.
 *
 * The preview is filled in for the first mailbox that uses it, so the email
 * line reads as a recipient would see it. Which mailboxes send with it sits
 * underneath, because "who does editing this affect" is the question to answer
 * before opening one.
 */
function SignatureCard({
  signature,
  canEdit,
}: {
  signature: SignatureDto;
  canEdit: boolean;
}) {
  const count = signature.accounts.length;
  const sample = signature.accounts[0]?.email ?? 'mailbox@yourdomain.com';

  return (
    <Card
      title={
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{signature.name}</h2>
          <Badge tone={count ? 'good' : 'neutral'}>
            {count ? `${count} ${count === 1 ? 'mailbox' : 'mailboxes'}` : 'unused'}
          </Badge>
        </div>
      }
      actions={
        <Link href={`/signatures/${signature.id}`}>
          <Button>
            <Icon className="size-3.5">{ICONS.pencil}</Icon>
            {canEdit ? 'Edit' : 'View'}
          </Button>
        </Link>
      }
    >
      <div className="p-4">
        <div className="rounded-lg border border-border bg-white p-4">
          <div
            className="text-[#111827]"
            // Sanitised by the server before it was stored.
            dangerouslySetInnerHTML={{
              __html: fillSignature(signature.html, sample, 'html'),
            }}
          />
        </div>
      </div>
      <div className="border-t border-border px-4 py-3 text-xs text-muted">
        {count
          ? `Sent by ${signature.accounts.map((account) => account.email).join(', ')}`
          : 'Not used by any mailbox yet. Pick it on a mailbox’s edit page.'}
      </div>
    </Card>
  );
}

export default function SignaturesPage() {
  const { user } = useAuth();
  const signatures = useSWR<SignatureDto[]>('/signatures', fetcher);
  const canEdit = user?.role === 'admin';

  const create = canEdit && (
    <Link href="/signatures/new">
      <Button variant="primary">New signature</Button>
    </Link>
  );

  return (
    <Shell>
      <PageHeader
        title="Signatures"
        description="Shared sign-offs. Each mailbox picks one on its own edit page, and the email line always shows that mailbox’s address."
        actions={create}
      />

      {signatures.error && (
        <Alert>{(signatures.error as Error).message}</Alert>
      )}

      {!signatures.data && !signatures.error && (
        <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-xl border border-border bg-surface"
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {signatures.data?.map((signature) => (
          <SignatureCard
            key={signature.id}
            signature={signature}
            canEdit={canEdit}
          />
        ))}
      </div>

      {signatures.data?.length === 0 && (
        <Card>
          <EmptyState
            title="No signatures yet"
            description="Write one signature, then pick it on every mailbox that should sign off the same way."
            action={create}
          />
        </Card>
      )}
    </Shell>
  );
}
