'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import useSWR from 'swr';
import type { AccountDto, AuthType, SignatureDto } from '@tmx-scheduler/shared';
import { AUTH_TYPES, COMMON_TIMEZONES, PROVIDER_PRESETS } from '@tmx-scheduler/shared';
import { api, fetcher } from '@/lib/api';
import { ICONS, Icon } from './icons';
import {
  SIGNATURE_NONE,
  SignaturePicker,
  initialSignatureChoice,
} from './SignaturePicker';
import {
  AccordionSection,
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
} from './ui';

interface FormState {
  email: string;
  displayName: string;
  authType: AuthType;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  requireTls: boolean;
  smtpPassword: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRefreshToken: string;
  oauthTenantId: string;
  /** A library signature id, or SIGNATURE_NONE. */
  signature: string;
  dailyLimit: number;
  minGapSeconds: number;
  timezone: string;
  active: boolean;
}

function initialState(account?: AccountDto): FormState {
  return {
    email: account?.email ?? '',
    displayName: account?.displayName ?? '',
    authType: account?.authType ?? 'smtp_password',
    smtpHost: account?.smtpHost ?? '',
    smtpPort: account?.smtpPort ?? 587,
    smtpUser: account?.smtpUser ?? '',
    requireTls: account?.requireTls ?? true,
    // Secrets are never sent to the browser. An empty field means "unchanged"
    // on an edit, which is why these always start blank.
    smtpPassword: '',
    oauthClientId: account?.hasOAuthCredentials ? '' : '',
    oauthClientSecret: '',
    oauthRefreshToken: '',
    oauthTenantId: '',
    signature: initialSignatureChoice(account),
    dailyLimit: account?.dailyLimit ?? 20,
    minGapSeconds: account?.minGapSeconds ?? 45,
    timezone: account?.timezone ?? 'Asia/Singapore',
    active: account?.active ?? true,
  };
}

type SectionId = 'identity' | 'connection' | 'pace' | 'signature';

export function AccountForm({ account }: { account?: AccountDto }) {
  const router = useRouter();
  const editing = Boolean(account);
  const [form, setForm] = useState<FormState>(() => initialState(account));
  const [presetId, setPresetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One section at a time: the four are independent, and a page of four open
  // panels is the wall of fields this replaced.
  const [open, setOpen] = useState<SectionId | null>('identity');
  const formRef = useRef<HTMLFormElement>(null);
  const signatures = useSWR<SignatureDto[]>('/signatures', fetcher);

  function toggle(id: SectionId) {
    setOpen((current) => (current === id ? null : id));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      smtpHost: preset.smtpHost || current.smtpHost,
      smtpPort: preset.smtpPort,
      // Never carry a preset's suggestion over a limit the operator has
      // already tuned for a warmed-up mailbox.
      dailyLimit: editing ? current.dailyLimit : preset.suggestedDailyLimit,
      authType: preset.supportedAuth.includes(current.authType)
        ? current.authType
        : preset.supportedAuth[0],
      requireTls: preset.id === 'mailpit' ? false : current.requireTls,
    }));
  }

  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
  const overLimit =
    preset?.providerDailyLimit != null &&
    form.dailyLimit > preset.providerDailyLimit;

  /**
   * Native validation, but pointed at the right section first.
   *
   * A collapsed panel is `display:none`, and the browser refuses to report a
   * problem on a control it cannot show — it silently cancels the submit and
   * logs "not focusable" to the console. So the form carries `noValidate` and
   * this runs the same checks by hand: find the first invalid control, open the
   * section holding it, and hand the browser back its own bubble once the field
   * is on screen.
   *
   * Returns true when everything passes.
   */
  function validate(): boolean {
    const element = formRef.current;
    if (!element) return true;

    const invalid = element.querySelector<HTMLInputElement>(
      'input:invalid, select:invalid, textarea:invalid',
    );
    if (!invalid) return true;

    const section = invalid.closest('[data-section]')?.getAttribute(
      'data-section',
    ) as SectionId | null;
    if (section && section !== open) setOpen(section);

    // The panel is still hidden in this tick; report once React has shown it.
    requestAnimationFrame(() => invalid.reportValidity());
    return false;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy(true);

    // Omit blank secrets on an edit so an untouched field keeps the stored
    // value; send them on create where blank genuinely means empty.
    const payload: Record<string, unknown> = {
      displayName: form.displayName,
      authType: form.authType,
      smtpHost: form.smtpHost,
      smtpPort: Number(form.smtpPort),
      smtpUser: form.smtpUser,
      requireTls: form.requireTls,
      dailyLimit: Number(form.dailyLimit),
      minGapSeconds: Number(form.minGapSeconds),
      timezone: form.timezone,
      active: form.active,
    };
    if (!editing) payload.email = form.email;

    // Only a change is sent, so saving other settings never touches which
    // signature the mailbox uses.
    if (form.signature !== initialSignatureChoice(account)) {
      payload.signatureId =
        form.signature === SIGNATURE_NONE ? null : form.signature;
    }

    for (const key of [
      'smtpPassword',
      'oauthClientId',
      'oauthClientSecret',
      'oauthRefreshToken',
      'oauthTenantId',
    ] as const) {
      if (form[key]) payload[key] = form[key];
      else if (!editing && key === 'smtpPassword' && form.authType === 'smtp_password') {
        payload[key] = '';
      }
    }

    try {
      if (editing) {
        await api(`/accounts/${account!.id}`, { method: 'PATCH', body: payload });
      } else {
        await api('/accounts', { method: 'POST', body: payload });
      }
      router.push('/accounts');
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete ${account!.email}? Queued mail from this mailbox will stop sending.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/accounts/${account!.id}`, { method: 'DELETE' });
      router.push('/accounts');
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  /**
   * What each collapsed section is hiding. Without these the accordion is four
   * headings that make the operator open all of them to find one field.
   */
  const summaries: Record<SectionId, string> = {
    identity: [form.displayName, form.email].filter(Boolean).join(' · ') || '—',
    connection: form.smtpHost
      ? `${form.smtpHost}:${form.smtpPort} · ${
          form.authType === 'smtp_password' ? 'password' : 'OAuth2'
        }`
      : 'Not configured',
    pace: `${form.dailyLimit}/day · ${form.minGapSeconds}s apart · ${form.timezone}`,
    signature:
      form.signature === SIGNATURE_NONE
        ? 'None'
        : (signatures.data?.find((s) => s.id === form.signature)?.name ??
          'Library signature'),
  };

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="space-y-3">
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <AccordionSection
        id="identity"
        title="Identity"
        icon={<Icon>{ICONS.user}</Icon>}
        summary={summaries.identity}
        open={open === 'identity'}
        onToggle={() => toggle('identity')}
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field
            label="Email address"
            hint={editing ? 'The address cannot be changed after creation.' : undefined}
          >
            <Input
              type="email"
              value={form.email}
              disabled={editing}
              required
              onChange={(e) => {
                set('email', e.target.value);
                // The SMTP username is the full address for every provider in
                // the preset table, so mirror it until it is edited by hand.
                if (!editing && form.smtpUser === form.email) {
                  set('smtpUser', e.target.value);
                }
              }}
            />
          </Field>
          <Field label="From name" hint="Shown as the sender in the inbox.">
            <Input
              value={form.displayName}
              required
              onChange={(e) => set('displayName', e.target.value)}
            />
          </Field>
        </div>
      </AccordionSection>

      <AccordionSection
        id="connection"
        title="Connection"
        icon={<Icon>{ICONS.plug}</Icon>}
        summary={summaries.connection}
        open={open === 'connection'}
        onToggle={() => toggle('connection')}
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Provider preset" hint={preset?.notes}>
            <Select
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="">Choose a provider…</option>
              {PROVIDER_PRESETS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Authentication">
            <Select
              value={form.authType}
              onChange={(e) => set('authType', e.target.value as AuthType)}
            >
              {AUTH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'smtp_password'
                    ? 'Password / app password'
                    : type === 'oauth_google'
                      ? 'OAuth2 — Google'
                      : 'OAuth2 — Microsoft'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="SMTP host">
            <Input
              value={form.smtpHost}
              required
              onChange={(e) => set('smtpHost', e.target.value)}
            />
          </Field>
          <Field
            label="Port"
            hint="587 for STARTTLS, 465 for implicit TLS."
          >
            <Input
              type="number"
              value={form.smtpPort}
              required
              onChange={(e) => set('smtpPort', Number(e.target.value))}
            />
          </Field>
          <Field label="SMTP username">
            <Input
              value={form.smtpUser}
              required
              onChange={(e) => set('smtpUser', e.target.value)}
            />
          </Field>

          {form.authType === 'smtp_password' ? (
            <Field
              label="Password"
              hint={
                editing
                  ? 'Leave blank to keep the stored password.'
                  : 'App password for Gmail/Workspace, mailbox password elsewhere.'
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.smtpPassword}
                onChange={(e) => set('smtpPassword', e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label="OAuth client ID">
                <Input
                  value={form.oauthClientId}
                  onChange={(e) => set('oauthClientId', e.target.value)}
                />
              </Field>
              <Field
                label="OAuth client secret"
                hint={editing ? 'Leave blank to keep the stored secret.' : undefined}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.oauthClientSecret}
                  onChange={(e) => set('oauthClientSecret', e.target.value)}
                />
              </Field>
              <Field
                label="Refresh token"
                hint={editing ? 'Leave blank to keep the stored token.' : undefined}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.oauthRefreshToken}
                  onChange={(e) => set('oauthRefreshToken', e.target.value)}
                />
              </Field>
              {form.authType === 'oauth_microsoft' && (
                <Field
                  label="Tenant ID"
                  hint="Leave blank for a multi-tenant app registration."
                >
                  <Input
                    value={form.oauthTenantId}
                    onChange={(e) => set('oauthTenantId', e.target.value)}
                  />
                </Field>
              )}
            </>
          )}

          <div className="sm:col-span-2">
            <Checkbox
              label="Require TLS"
              hint="Turn off only for a plain-SMTP relay on this machine. Over a network this sends the password in the clear."
              checked={form.requireTls}
              onChange={(e) => set('requireTls', e.target.checked)}
            />
          </div>
        </div>
        <p className="border-t border-border px-4 py-3 text-xs text-muted">
          Saving tests the login before anything is stored. A mailbox that cannot
          authenticate is never added to the queue.
        </p>
      </AccordionSection>

      <AccordionSection
        id="pace"
        title="Pace"
        icon={<Icon>{ICONS.gauge}</Icon>}
        summary={summaries.pace}
        open={open === 'pace'}
        onToggle={() => toggle('pace')}
      >
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <Field
            label="Daily limit"
            hint="Start a new mailbox at 10–20 and raise ~20% a week."
            error={
              overLimit
                ? `Above the published ${preset?.label} ceiling of ${preset?.providerDailyLimit}.`
                : undefined
            }
          >
            <Input
              type="number"
              min={1}
              value={form.dailyLimit}
              onChange={(e) => set('dailyLimit', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Minimum gap (seconds)"
            hint="30–90 is a human cadence. Jitter is added automatically."
          >
            <Input
              type="number"
              min={0}
              value={form.minGapSeconds}
              onChange={(e) => set('minGapSeconds', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Timezone"
            hint="The daily limit renews at 9 AM in this zone, not at midnight. Messages held for the limit go out from 9 AM."
          >
            <Select
              value={form.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            >
              {/* An existing mailbox may hold a zone outside the curated
                  list; keep it selectable rather than silently changing it. */}
              {!COMMON_TIMEZONES.some((tz) => tz.value === form.timezone) && (
                <option value={form.timezone}>{form.timezone}</option>
              )}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </AccordionSection>

      <AccordionSection
        id="signature"
        title="Signature"
        icon={<Icon>{ICONS.signature}</Icon>}
        summary={summaries.signature}
        open={open === 'signature'}
        onToggle={() => toggle('signature')}
      >
        <div className="p-4">
          <SignaturePicker
            value={form.signature}
            onChange={(choice) => set('signature', choice)}
            senderEmail={form.email}
          />
        </div>
      </AccordionSection>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          {editing ? 'Save changes' : 'Add mailbox'}
        </Button>
        <Button type="button" onClick={() => router.push('/accounts')}>
          Cancel
        </Button>
        {editing && (
          <Button
            type="button"
            variant="danger"
            className="ml-auto"
            onClick={() => void remove()}
          >
            Delete mailbox
          </Button>
        )}
      </div>
    </form>
  );
}
