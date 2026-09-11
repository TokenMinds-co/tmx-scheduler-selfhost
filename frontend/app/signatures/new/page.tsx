'use client';

import { Shell } from '@/components/Shell';
import { SignatureEditor } from '@/components/SignatureEditor';
import { PageHeader } from '@/components/ui';

export default function NewSignaturePage() {
  return (
    <Shell>
      <PageHeader
        title="New signature"
        description="Write it once, then tick every mailbox that should sign off with it."
      />
      <SignatureEditor />
    </Shell>
  );
}
