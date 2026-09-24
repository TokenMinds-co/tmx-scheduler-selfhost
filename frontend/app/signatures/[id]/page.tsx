'use client';

import { use } from 'react';
import useSWR from 'swr';
import type { SignatureDto } from '@tmx-scheduler/shared';
import { Shell } from '@/components/Shell';
import { SignatureEditor } from '@/components/SignatureEditor';
import { Alert, PageHeader, Spinner } from '@/components/ui';
import { fetcher } from '@/lib/api';

export default function EditSignaturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, error } = useSWR<SignatureDto>(`/signatures/${id}`, fetcher);

  return (
    <Shell>
      <PageHeader
        title={data ? data.name : 'Signature'}
        description="Changes apply to every attached mailbox from its next message."
      />
      {error && <Alert>{(error as Error).message}</Alert>}
      {!data && !error && <Spinner />}
      {/* Keyed on the loaded record: the editor reads its initial state once. */}
      {data && <SignatureEditor key={data.id} signature={data} />}
    </Shell>
  );
}
