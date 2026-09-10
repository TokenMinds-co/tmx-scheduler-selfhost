'use client';

import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { AccountForm } from '@/components/AccountForm';
import { Button, PageHeader } from '@/components/ui';

export default function NewAccountPage() {
  return (
    <Shell>
      <PageHeader
        title="Add mailbox"
        description="The credentials are tested and encrypted before anything is saved."
        actions={
          <Link href="/accounts/help">
            <Button>Guide me through it instead</Button>
          </Link>
        }
      />
      <AccountForm />
    </Shell>
  );
}
