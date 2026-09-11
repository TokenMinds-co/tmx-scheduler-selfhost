'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  fillSignature,
  type AccountDto,
  type SignatureDto,
} from '@ims/shared';
import { fetcher } from '@/lib/api';
import { Alert, Field, Select } from './ui';

/** No signature at all. */
export const SIGNATURE_NONE = 'none';

/** What the picker starts on for an existing mailbox, or a new one. */
export function initialSignatureChoice(account?: AccountDto): string {
  return account?.signatureId ?? SIGNATURE_NONE;
}

/**
 * Points a mailbox at one of the library's signatures.
 *
 * Signatures are written on their own page and shared between mailboxes; this
 * only chooses one. The preview is filled with this mailbox's address, which
 * is what its recipients will actually see on the email line.
 */
export function SignaturePicker({
  value,
  onChange,
  senderEmail,
}: {
  value: string;
  onChange: (choice: string) => void;
  senderEmail: string;
}) {
  const { data, error } = useSWR<SignatureDto[]>('/signatures', fetcher);
  const selected = data?.find((signature) => signature.id === value);
  const address = senderEmail.trim() || 'mailbox@yourdomain.com';
  const html = selected ? fillSignature(selected.html, address, 'html') : '';

  const others = selected
    ? selected.accounts.filter((account) => account.email !== senderEmail)
        .length
    : 0;
  const hint = selected
    ? others
      ? `Shared with ${others} other ${others === 1 ? 'mailbox' : 'mailboxes'} — editing it changes theirs too.`
      : 'The email line shows this mailbox’s own address.'
    : undefined;

  return (
    <div className="space-y-3">
      {error && <Alert>{(error as Error).message}</Alert>}

      <Field label="Signature" hint={hint}>
        <Select
          value={value}
          disabled={!data}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value={SIGNATURE_NONE}>No signature</option>
          {data?.map((signature) => (
            <option key={signature.id} value={signature.id}>
              {signature.name}
            </option>
          ))}
        </Select>
      </Field>

      {/* White whatever the admin theme: the signature is judged in an inbox. */}
      {html ? (
        <div className="rounded-lg border border-border bg-white p-4">
          <div
            className="text-[#111827]"
            // Sanitised by the server before it was stored.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted">
          {data && !data.length
            ? 'The library has no signatures yet.'
            : 'No signature — messages end after the body.'}
        </p>
      )}

      {/* New tabs, so a half-filled mailbox form survives a detour to write a
          signature. The list above refreshes when this tab regains focus. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {selected && (
          <Link
            href={`/signatures/${selected.id}`}
            target="_blank"
            className="font-medium text-accent hover:underline"
          >
            Edit this signature
          </Link>
        )}
        <Link
          href="/signatures"
          target="_blank"
          className="font-medium text-accent hover:underline"
        >
          Manage signatures
        </Link>
      </div>
    </div>
  );
}
