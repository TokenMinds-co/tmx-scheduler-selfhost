'use client';

import { use } from 'react';
import useSWR from 'swr';
import type { AccountDto } from '@ims/shared';
import { Shell } from '@/components/Shell';
import { AccountForm } from '@/components/AccountForm';
import { Alert, PageHeader, Spinner } from '@/components/ui';
import { fetcher } from '@/lib/api';

export default function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, error } = useSWR<AccountDto>(`/accounts/${id}`, fetcher);

  return (
    <Shell>
      <PageHeader
        title={data ? data.email : 'Mailbox'}
        description="Connection changes are re-tested against the provider on save."
      />
      {error && <Alert>{(error as Error).message}</Alert>}
      {!data && !error && <Spinner />}
      {/* Keyed on the loaded record so the form's initial state is never built
          from an undefined account on first render. */}
      {data && <AccountForm key={data.id} account={data} />}
    </Shell>
  );
}
