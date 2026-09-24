'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AuthType,
  COMMON_TIMEZONES,
  DEFAULTS,
  PROVIDER_PRESETS,
  type AccountDto,
  type DomainCheck,
  type SignatureDto,
} from '@tmx-scheduler/shared';
import useSWR from 'swr';
import { Shell } from '@/components/Shell';
import { SIGNATURE_NONE, SignaturePicker } from '@/components/SignaturePicker';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Select,
  cx,
} from '@/components/ui';

// ---------------------------------------------------------------------------
// A guided setup that ends in a real mailbox.
//
// The earlier version of this page explained what to do and then sent the
// operator to a separate form, which meant reading instructions, leaving, and
// trying to remember them. So the instructions and the fields they describe now
// occupy one screen each: the app password is pasted on the step that explains
// how to generate it, and the last step POSTs the whole thing.
//
// The plain form at /accounts/new is untouched and stays the faster path for
// anyone who already knows their settings.
// ---------------------------------------------------------------------------

interface ProviderStep {
  title: string;
  body: ReactNode;
  /** Rendered as a click path inside a browser-chrome mock. */
  path?: string[];
  tip?: ReactNode;
}

interface Provider {
  presetId: string;
  label: string;
  blurb: string;
  /** Names the secret on the step that collects it. */
  credentialLabel: string;
  credentialHint: string;
  steps: ProviderStep[];
}

function ext(href: string, label: string) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2"
    >
      {label}
    </a>
  );
}

const PROVIDERS: Provider[] = [
  {
    presetId: 'gmail',
    label: 'Gmail',
    blurb: 'A personal @gmail.com address.',
    credentialLabel: 'App Password',
    credentialHint: 'The 16-character code Google just showed you.',
    steps: [
      {
        title: 'Turn on 2-Step Verification',
        body: (
          <>
            App Passwords do not appear as an option until this is on. Turn it
            on at{' '}
            {ext(
              'https://myaccount.google.com/signinoptions/twosv',
              'Google Account → Security',
            )}
            .
          </>
        ),
        path: ['myaccount.google.com', 'Security', '2-Step Verification'],
      },
      {
        title: 'Create the App Password',
        body: (
          <>
            Open{' '}
            {ext(
              'https://myaccount.google.com/apppasswords',
              'myaccount.google.com/apppasswords',
            )}{' '}
            and give it a name like <em>TMX Scheduler</em>.
          </>
        ),
        path: ['myaccount.google.com', 'App passwords', 'Create'],
        tip: 'Google shows the code once. Paste it on the next step before you close that tab — it can only be regenerated, never shown again.',
      },
    ],
  },
  {
    presetId: 'google_workspace',
    label: 'Google Workspace',
    blurb: 'Gmail on your own domain.',
    credentialLabel: 'App Password',
    credentialHint: 'The 16-character code Google just showed you.',
    steps: [
      {
        title: 'Admin: allow 2-Step Verification',
        body: (
          <>
            Choose the org unit this mailbox belongs to in the left-hand panel,
            then tick{' '}
            <strong>Allow users to turn on 2-Step Verification</strong>.
            Enforcement is a separate setting below it and is not needed here.
          </>
        ),
        path: [
          'admin.google.com',
          'Security',
          'Authentication',
          '2-Step Verification',
        ],
        tip: 'Most tenants allow this already, so it is usually a no-op. If you are not a Workspace admin, skip straight to the next step — you only need this if that one has no App Passwords option.',
      },
      {
        title: 'Turn on 2SV for the sending account',
        body: (
          <>
            Sign in as the sending account itself and enable it at{' '}
            {ext(
              'https://myaccount.google.com/signinoptions/twosv',
              'myaccount.google.com → Security → 2-Step Verification',
            )}
            . An admin cannot do this, or create an App Password, on someone
            else's behalf.
          </>
        ),
        path: ['myaccount.google.com', 'Security', '2-Step Verification'],
      },
      {
        title: 'Create the App Password',
        body: (
          <>
            Open{' '}
            {ext(
              'https://myaccount.google.com/apppasswords',
              'myaccount.google.com/apppasswords',
            )}{' '}
            and name it <em>TMX Scheduler</em>.
          </>
        ),
        path: ['myaccount.google.com', 'App passwords', 'Create'],
        tip: 'If the page says App Passwords are unavailable, your admin has blocked them — tick the OAuth2 box on the next step instead.',
      },
    ],
  },
  {
    presetId: 'microsoft365',
    label: 'Microsoft 365',
    blurb: 'Outlook on a company tenant.',
    credentialLabel: 'Mailbox password',
    credentialHint:
      'The password this mailbox signs in with, or an app password under MFA.',
    steps: [
      {
        title: 'Switch on Authenticated SMTP',
        body: 'This is off by default on most tenants, and is the single most common reason a correct password is rejected.',
        path: [
          'admin.microsoft.com',
          'Users',
          'Active users',
          'Mail',
          'Manage email apps',
        ],
        tip: 'Tick "Authenticated SMTP" and save.',
      },
      {
        title: 'Check no tenant policy overrides it',
        body: 'A tenant-wide switch beats the per-user one. An admin can confirm with Set-TransportConfig -SmtpClientAuthenticationDisabled $false.',
      },
      {
        title: 'Watch for Conditional Access',
        body: 'Security defaults, or a policy blocking legacy authentication, will still refuse the login. The account needs an exclusion, or a move to OAuth2.',
        tip: 'Microsoft throttles around 30 messages a minute, so the minimum gap stays at 2 seconds or more.',
      },
    ],
  },
  {
    presetId: 'outlook_personal',
    label: 'Outlook.com',
    blurb: 'A personal @outlook.com or @hotmail.com address.',
    credentialLabel: 'OAuth2 credentials',
    credentialHint: 'Personal Outlook refuses plain passwords over SMTP.',
    steps: [
      {
        title: 'This is the hard path',
        body: 'Personal Outlook.com accounts no longer accept an app password over SMTP. They need a full OAuth2 app registration, and they are rate limited far below anything useful for outreach.',
        tip: 'If you have any alternative — a Workspace or Microsoft 365 mailbox on your own domain — use it instead. It will take less time to set up and deliver better.',
      },
      {
        title: 'Register an application',
        body: 'Create the registration, add the SMTP.Send permission, then collect the client ID, a client secret and a refresh token for the next step.',
        path: ['entra.microsoft.com', 'App registrations', 'New registration'],
      },
    ],
  },
  {
    presetId: 'zoho',
    label: 'Zoho Mail',
    blurb: 'Zoho-hosted mailbox.',
    credentialLabel: 'App password',
    credentialHint: 'The application-specific password Zoho generated.',
    steps: [
      {
        title: 'Check the host matches your region',
        body: 'smtp.zoho.com is the US. Europe is smtp.zoho.eu, India smtp.zoho.in, Australia smtp.zoho.com.au. You can correct it a couple of steps from now.',
        tip: 'The wrong region rejects credentials that are otherwise perfectly correct. This is the usual Zoho mistake.',
      },
      {
        title: 'Generate an app password',
        body: 'Required whenever two-factor authentication is on.',
        path: ['accounts.zoho.com', 'Security', 'App Passwords', 'Generate'],
      },
    ],
  },
  {
    presetId: 'custom',
    label: 'Own domain',
    blurb: 'cPanel, Plesk or your own server.',
    credentialLabel: 'Mailbox password',
    credentialHint: 'The password set when this mailbox was created.',
    steps: [
      {
        title: 'Find the exact host',
        body: 'The panel prints the precise hostname and ports for that mailbox. Usually mail.yourdomain.com, though some shared hosts want the server hostname instead. You will enter it a couple of steps from now.',
        path: ['cPanel', 'Email Accounts', 'Connect Devices'],
      },
      {
        title: 'Publish SPF, DKIM and DMARC',
        body: 'Without them mail authenticates fine and still lands in spam. cPanel exposes both under Email Deliverability.',
        path: ['cPanel', 'Email Deliverability'],
      },
    ],
  },
  {
    presetId: 'mailpit',
    label: 'Mailpit',
    blurb: 'Local testing. No real mail is sent.',
    credentialLabel: 'Password',
    credentialHint: 'Anything at all — Mailpit accepts any credentials.',
    steps: [
      {
        title: 'Start the local stack',
        body: (
          <>
            <code className="rounded bg-accent-soft px-1 text-accent">
              pnpm infra:up
            </code>{' '}
            brings up Mongo, Redis and Mailpit together.
          </>
        ),
        tip: 'Everything sent is captured at localhost:8025 and never leaves this machine.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

/** A click path, drawn as browser chrome so it reads as "go here, then here". */
function PathMock({ path }: { path: string[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-canvas">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="size-2 rounded-full bg-failed/40" />
        <span className="size-2 rounded-full bg-pending/40" />
        <span className="size-2 rounded-full bg-sent/40" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 p-3">
        {path.map((part, i) => (
          <span key={part} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted">›</span>}
            <span
              className={cx(
                'rounded-full px-2.5 py-1 text-xs font-medium',
                i === path.length - 1
                  ? 'brand-gradient text-white'
                  : 'bg-surface text-muted ring-1 ring-border',
              )}
            >
              {part}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-accent/25 bg-accent-soft px-3 py-2 text-sm text-accent">
      {children}
    </p>
  );
}

/** One DNS finding, as a coloured dot plus a sentence. */
function Finding({
  ok,
  label,
  detail,
}: {
  ok: boolean | null;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex gap-2">
      <span
        className={cx(
          'mt-1.5 size-2 shrink-0 rounded-full',
          ok === true ? 'bg-sent' : ok === false ? 'bg-pending' : 'bg-border',
        )}
      />
      <span className="text-sm">
        <span className="font-medium">{label}</span>{' '}
        <span className="text-muted">{detail}</span>
      </span>
    </li>
  );
}

// Six weeks of a sane warm-up, about 20% a week.
const RAMP = [20, 24, 29, 35, 42, 50];

function RampChart() {
  return (
    <svg
      viewBox="0 0 240 124"
      role="img"
      aria-label="Warm-up ramp: 20, 24, 29, 35, 42 and 50 messages a day across six weeks"
      className="w-full text-accent"
    >
      {RAMP.map((v, i) => {
        const h = (v / 50) * 80;
        const x = 6 + i * 40;
        const y = 100 - h;
        return (
          <g key={v}>
            <rect
              x={x}
              y={y}
              width={28}
              height={h}
              rx={4}
              fill="currentColor"
              opacity={0.35 + i * 0.13}
            />
            <text
              x={x + 14}
              y={y - 4}
              textAnchor="middle"
              fontSize={9}
              fontWeight="600"
              fill="currentColor"
            >
              {v}
            </text>
            <text
              x={x + 14}
              y={114}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
              opacity={0.6}
            >
              W{i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Turns the SMTP rejection the API passes through into the thing to go and
 * change. The raw reply is still shown — it is what a provider's support desk
 * will ask for.
 */
function diagnose(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes('5.7.8') || m.includes('username and password not accepted')) {
    return 'That looks like the account password rather than an app password — or 2-Step Verification is not on yet. Step back and generate an app password.';
  }
  if (m.includes('5.7.139') || m.includes('authentication unsuccessful')) {
    return 'Microsoft 365 has not enabled Authenticated SMTP for this mailbox. An admin ticks it under Users → Active users → Mail → Manage email apps.';
  }
  if (
    m.includes('timeout') ||
    m.includes('econnrefused') ||
    m.includes('enotfound')
  ) {
    return 'Nothing answered at that host and port. Check the SMTP host spelling, and note that many office networks block outbound 587 and 465.';
  }
  if (
    m.includes('certificate') ||
    m.includes('self signed') ||
    m.includes('self-signed')
  ) {
    return 'The server certificate did not validate. Fix the certificate rather than turning off Require TLS, unless this relay is on the same machine.';
  }
  if (m.includes('already configured')) {
    return 'This address already has a mailbox. Edit the existing one from the Mailboxes page instead.';
  }
  return null;
}

interface Draft {
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
}

const EMPTY_DRAFT: Draft = {
  email: '',
  displayName: '',
  authType: AuthType.SmtpPassword,
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  requireTls: true,
  smtpPassword: '',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthRefreshToken: '',
  oauthTenantId: '',
  signature: SIGNATURE_NONE,
  dailyLimit: DEFAULTS.dailyLimit,
  minGapSeconds: DEFAULTS.minGapSeconds,
  timezone: DEFAULTS.timezone,
};

interface Slide {
  phase: string;
  title: string;
  content: ReactNode;
  /** False keeps Next disabled until this step has what it needs. */
  ready?: boolean;
  /**
   * Overrides the forward button's label. An optional step that has been left
   * blank reads "Skip", so moving on does not look like an accidental omission.
   */
  nextLabel?: string;
  /**
   * Lets one step break out of the reading width. The deck is sized for prose
   * — a paragraph at 48rem is comfortable, at 72rem it is not — but the
   * signature step is a form beside a live preview, and squeezing that into a
   * column of prose is what makes it awkward to fill in.
   */
  wide?: boolean;
}

export default function MailboxSetupPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [providerId, setProviderId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // Lookup state lives here rather than inside the first slide, so stepping
  // back to it still shows what was found instead of an empty form.
  const [domainInput, setDomainInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<DomainCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<AccountDto | null>(null);
  const [testState, setTestState] = useState<string | null>(null);
  const signatures = useSWR<SignatureDto[]>('/signatures', fetcher);

  const provider = PROVIDERS.find((p) => p.presetId === providerId) ?? null;
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  const usesOAuth = draft.authType !== AuthType.SmtpPassword;
  const canCreate = user?.role === 'admin';

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  /** Applies a preset's connection defaults without discarding typed input. */
  function choose(id: string) {
    setProviderId(id);
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setDraft((d) => ({
      ...d,
      smtpHost: p.smtpHost || d.smtpHost,
      smtpPort: p.smtpPort,
      dailyLimit: p.suggestedDailyLimit,
      // Fall back to whatever the provider does support — personal Outlook has
      // no password option at all.
      authType: p.supportedAuth.includes(d.authType)
        ? d.authType
        : p.supportedAuth[0],
      requireTls: p.id === 'mailpit' ? false : d.requireTls,
    }));
  }

  async function runCheck(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setCheckError(null);
    setCheck(null);
    try {
      const result = await api<DomainCheck>('/accounts/check-domain', {
        method: 'POST',
        body: { domain: domainInput },
      });
      setCheck(result);

      // A full address is the sending address; a bare domain is not.
      if (domainInput.includes('@')) {
        const address = domainInput.trim().toLowerCase();
        setDraft((d) => ({ ...d, email: address, smtpUser: address }));
      }

      if (
        result.presetId &&
        PROVIDERS.some((p) => p.presetId === result.presetId)
      ) {
        choose(result.presetId);
      } else {
        setProviderId(null);
        setManual(true);
      }
    } catch (cause) {
      setCheckError((cause as Error).message);
      setManual(true);
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: Record<string, unknown> = {
        email: draft.email.trim().toLowerCase(),
        displayName: draft.displayName.trim(),
        authType: draft.authType,
        smtpHost: draft.smtpHost.trim(),
        smtpPort: Number(draft.smtpPort),
        smtpUser: draft.smtpUser.trim(),
        requireTls: draft.requireTls,
        dailyLimit: Number(draft.dailyLimit),
        minGapSeconds: Number(draft.minGapSeconds),
        timezone: draft.timezone.trim(),
      };
      if (draft.signature !== SIGNATURE_NONE) {
        payload.signatureId = draft.signature;
      }
      if (usesOAuth) {
        payload.oauthClientId = draft.oauthClientId.trim();
        payload.oauthClientSecret = draft.oauthClientSecret.trim();
        payload.oauthRefreshToken = draft.oauthRefreshToken.trim();
        if (draft.oauthTenantId.trim()) {
          payload.oauthTenantId = draft.oauthTenantId.trim();
        }
      } else {
        payload.smtpPassword = draft.smtpPassword;
      }

      const account = await api<AccountDto>('/accounts', {
        method: 'POST',
        body: payload,
      });
      setCreated(account);
    } catch (cause) {
      setSubmitError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function sendTest() {
    if (!created || !user) return;
    setTestState('sending');
    try {
      await api(`/accounts/${created.id}/test`, {
        method: 'POST',
        body: { to: user.email },
      });
      setTestState(`Sent to ${user.email}.`);
    } catch (cause) {
      setTestState((cause as Error).message);
    }
  }

  // Slides depend on nearly every piece of state, so they are rebuilt each
  // render rather than memoised against a long dependency list.
  function buildSlides(): Slide[] {
    const first: Slide = {
      phase: 'Start',
      title: 'What address will you send from?',
      ready: Boolean(provider),
      content: (
        <div className="space-y-4">
          <form onSubmit={runCheck} className="space-y-3">
            <Field
              label="Your sending address"
              hint="We read that domain's public DNS to work out who runs its mail. Nothing is sent and no credentials are needed."
            >
              <Input
                type="text"
                value={domainInput}
                placeholder="you@yourcompany.com"
                autoComplete="email"
                onChange={(e) => setDomainInput(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={checking}
              disabled={!domainInput.trim()}
            >
              Check my domain
            </Button>
          </form>

          {checkError && <Alert>{checkError}</Alert>}

          {check &&
            (provider ? (
              <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-accent">
                  {check.confidence === 'certain' ? 'Found it' : 'Best match'}
                </p>
                <p className="mt-1 text-lg font-semibold">{provider.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {check.reason}
                </p>
                <ul className="mt-3 space-y-1.5 border-t border-accent/20 pt-3">
                  <Finding
                    ok={check.mx.length > 0}
                    label="Mail host"
                    detail={
                      check.mx.length > 0
                        ? check.mx.slice(0, 2).join(', ')
                        : 'no MX records published'
                    }
                  />
                  <Finding
                    ok={check.spfIncludesProvider ?? (check.spf ? null : false)}
                    label="SPF"
                    detail={
                      !check.spf
                        ? 'not published — mail from this domain will be treated as suspicious'
                        : check.spfIncludesProvider === false
                          ? 'published, but it does not authorise this provider to send'
                          : 'published and authorises this provider'
                    }
                  />
                  <Finding
                    ok={Boolean(check.dmarc)}
                    label="DMARC"
                    detail={
                      check.dmarc
                        ? 'published'
                        : 'not published — Gmail and Yahoo want this for bulk sending'
                    }
                  />
                </ul>
                <div className="mt-4">
                  <Button variant="primary" onClick={() => setStep(1)}>
                    Continue with {provider.label}
                  </Button>
                </div>
              </div>
            ) : (
              <Alert>
                {check.reason} Pick the closest match from the list below.
              </Alert>
            ))}

          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setManual((m) => !m)}
              className="text-sm text-accent underline underline-offset-2"
            >
              {manual ? 'Hide the list' : 'Or pick from the list yourself'}
            </button>

            {manual && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.presetId}
                    type="button"
                    onClick={() => {
                      choose(p.presetId);
                      setStep(1);
                    }}
                    className={cx(
                      'rounded-xl border p-3 text-left transition',
                      p.presetId === providerId
                        ? 'border-accent bg-accent-soft'
                        : 'border-border bg-canvas hover:border-accent/50',
                    )}
                  >
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {p.blurb}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ),
    };

    if (!provider) return [first];

    const credentialSlides: Slide[] = provider.steps.map((s) => ({
      phase: 'Get the password',
      title: s.title,
      content: (
        <div className="space-y-3">
          <div className="text-sm leading-relaxed text-muted">{s.body}</div>
          {s.path && <PathMock path={s.path} />}
          {s.tip && <Tip>{s.tip}</Tip>}
        </div>
      ),
    }));

    // The step that collects the secret sits immediately after the ones that
    // explain how to produce it, so it is pasted while still on screen.
    const secretSlide: Slide = {
      phase: 'Get the password',
      title: usesOAuth ? 'Paste the OAuth2 credentials' : 'Paste it here now',
      ready: usesOAuth
        ? Boolean(
            draft.oauthClientId.trim() &&
            draft.oauthClientSecret.trim() &&
            draft.oauthRefreshToken.trim(),
          )
        : draft.smtpPassword.length > 0,
      content: (
        <div className="space-y-3">
          {usesOAuth ? (
            <>
              <Field label="Client ID">
                <Input
                  value={draft.oauthClientId}
                  onChange={(e) => set('oauthClientId', e.target.value)}
                />
              </Field>
              <Field label="Client secret">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={draft.oauthClientSecret}
                  onChange={(e) => set('oauthClientSecret', e.target.value)}
                />
              </Field>
              <Field label="Refresh token">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={draft.oauthRefreshToken}
                  onChange={(e) => set('oauthRefreshToken', e.target.value)}
                />
              </Field>
              {draft.authType === AuthType.OAuthMicrosoft && (
                <Field
                  label="Tenant ID"
                  hint="Leave blank for a multi-tenant app registration."
                >
                  <Input
                    value={draft.oauthTenantId}
                    onChange={(e) => set('oauthTenantId', e.target.value)}
                  />
                </Field>
              )}
            </>
          ) : (
            <Field
              label={provider.credentialLabel}
              hint={provider.credentialHint}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={draft.smtpPassword}
                onChange={(e) => set('smtpPassword', e.target.value)}
              />
            </Field>
          )}

          <p className="text-sm leading-relaxed text-muted">
            It is encrypted with AES-256-GCM before being stored, and the API
            never sends it back to a browser.
          </p>

          {preset && preset.supportedAuth.length > 1 && (
            <Checkbox
              label="My admin blocked app passwords — use OAuth2 instead"
              checked={usesOAuth}
              onChange={(e) =>
                set(
                  'authType',
                  e.target.checked
                    ? (preset.supportedAuth.find(
                        (a) => a !== AuthType.SmtpPassword,
                      ) ?? AuthType.SmtpPassword)
                    : AuthType.SmtpPassword,
                )
              }
            />
          )}
        </div>
      ),
    };

    const detailSlides: Slide[] = [
      {
        phase: 'Fill in the details',
        title: 'Who is this mail from?',
        ready: Boolean(draft.email.trim() && draft.displayName.trim()),
        content: (
          <div className="space-y-3">
            <Field
              label="Sending address"
              hint="Must match the Sending Email column of your CSV exactly. It cannot be changed later."
            >
              <Input
                type="email"
                value={draft.email}
                placeholder="outreach@yourcompany.com"
                onChange={(e) => {
                  const next = e.target.value;
                  // Mirror into the SMTP username until that is edited by hand.
                  setDraft((d) => ({
                    ...d,
                    email: next,
                    smtpUser: d.smtpUser === d.email ? next : d.smtpUser,
                  }));
                }}
              />
            </Field>
            <Field
              label="From name"
              hint="The name the recipient sees in their inbox list."
            >
              <Input
                value={draft.displayName}
                placeholder="Ada at Example Ltd"
                onChange={(e) => set('displayName', e.target.value)}
              />
            </Field>
          </div>
        ),
      },
      {
        phase: 'Fill in the details',
        title: 'Confirm the connection',
        ready: Boolean(draft.smtpHost.trim() && draft.smtpUser.trim()),
        content: (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              {preset?.smtpHost
                ? `Filled in from the ${provider.label} preset. Change it only if you know this mailbox lives somewhere else.`
                : 'Your provider or hosting panel gave you these.'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="SMTP host">
                <Input
                  value={draft.smtpHost}
                  placeholder="mail.yourdomain.com"
                  onChange={(e) => set('smtpHost', e.target.value)}
                />
              </Field>
              <Field label="Port" hint="587 STARTTLS · 465 implicit TLS">
                <Input
                  type="number"
                  value={draft.smtpPort}
                  onChange={(e) => set('smtpPort', Number(e.target.value))}
                />
              </Field>
              <Field
                label="SMTP username"
                hint="The full address, not just the part before the @."
                className="sm:col-span-2"
              >
                <Input
                  value={draft.smtpUser}
                  onChange={(e) => set('smtpUser', e.target.value)}
                />
              </Field>
            </div>
            <Checkbox
              label="Require TLS"
              hint="Leave on. Off is only for a plain-SMTP relay on this machine — over a network it sends the password in the clear."
              checked={draft.requireTls}
              onChange={(e) => set('requireTls', e.target.checked)}
            />
          </div>
        ),
      },
      {
        phase: 'Fill in the details',
        title: 'Set the pace',
        ready: draft.dailyLimit > 0 && Boolean(draft.timezone.trim()),
        content: (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              A new address that sends hundreds of messages on day one is the
              clearest spam signal there is. Start near 20 a day and raise the
              limit about 20% a week.
            </p>
            <RampChart />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="Daily limit"
                hint={
                  preset?.providerDailyLimit
                    ? `${provider.label} caps at ${preset.providerDailyLimit}.`
                    : 'Plan-dependent — check yours.'
                }
                error={
                  preset?.providerDailyLimit != null &&
                  draft.dailyLimit > preset.providerDailyLimit
                    ? `Above the ${provider.label} ceiling.`
                    : undefined
                }
              >
                <Input
                  type="number"
                  min={1}
                  value={draft.dailyLimit}
                  onChange={(e) => set('dailyLimit', Number(e.target.value))}
                />
              </Field>
              <Field label="Minimum gap" hint="Seconds. 30–90 is a human pace.">
                <Input
                  type="number"
                  min={0}
                  value={draft.minGapSeconds}
                  onChange={(e) => set('minGapSeconds', Number(e.target.value))}
                />
              </Field>
              <Field
                label="Timezone"
                hint="The daily limit renews at 9 AM in this zone, not at midnight."
              >
                <Select
                  value={draft.timezone}
                  onChange={(e) => set('timezone', e.target.value)}
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ),
      },
      {
        phase: 'Fill in the details',
        title: 'Choose a signature',
        nextLabel: draft.signature !== SIGNATURE_NONE ? 'Next' : 'Skip',
        content: (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              Appended to every message this mailbox sends. Signatures live in a
              shared library, so one can serve several mailboxes — its email
              line always shows the sending mailbox&rsquo;s own address.
              Optional — you can attach one later.
            </p>
            <SignaturePicker
              value={draft.signature}
              onChange={(choice) => set('signature', choice)}
              senderEmail={draft.email}
            />
          </div>
        ),
      },
    ];

    const summary: [string, string][] = [
      ['From', `${draft.displayName || '—'} <${draft.email || '—'}>`],
      ['Server', `${draft.smtpHost || '—'}:${draft.smtpPort}`],
      ['Username', draft.smtpUser || '—'],
      ['Authentication', usesOAuth ? 'OAuth2' : 'Password'],
      ['Pace', `${draft.dailyLimit}/day, ${draft.minGapSeconds}s apart`],
      ['Day resets in', draft.timezone],
      [
        'Signature',
        draft.signature === SIGNATURE_NONE
          ? 'None'
          : (signatures.data?.find((s) => s.id === draft.signature)?.name ??
            'Attached'),
      ],
    ];

    const hint = submitError ? diagnose(submitError) : null;

    const finish: Slide = {
      phase: 'Finish',
      title: created ? 'The mailbox is live' : 'Check it over, then create it',
      content: created ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-sent/30 bg-sent-soft p-4">
            <p className="text-sm font-medium text-sent">
              {created.email} signed in successfully and is ready to send.
            </p>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            Send yourself a test to see the signature and rendering before a
            campaign goes out. After that, any CSV row whose{' '}
            <strong>Sending Email</strong> matches this address routes through
            it automatically.
          </p>
          {testState && testState !== 'sending' && (
            <Alert tone={testState.startsWith('Sent') ? 'success' : 'error'}>
              {testState}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={testState === 'sending'}
              onClick={() => void sendTest()}
            >
              Send a test to {user?.email}
            </Button>
            <Button onClick={() => router.push('/accounts')}>
              Go to mailboxes
            </Button>
            <Button onClick={() => router.push('/import')}>Import a CSV</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <dl className="divide-y divide-border rounded-xl border border-border">
            {summary.map(([label, value]) => (
              <div
                key={label}
                className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="truncate font-medium">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="text-sm leading-relaxed text-muted">
            Creating it signs in to the mailbox first. If the login fails,
            nothing is saved and you can step back and correct it.
          </p>

          {!canCreate && (
            <Alert>
              Your account is an operator, so it cannot add mailboxes. An admin
              can create this one.
            </Alert>
          )}

          {submitError && (
            <div className="space-y-2">
              <Alert>{submitError}</Alert>
              {hint && <Tip>{hint}</Tip>}
            </div>
          )}
        </div>
      ),
    };

    return [first, ...credentialSlides, secretSlide, ...detailSlides, finish];
  }

  const slides = buildSlides();
  const total = slides.length;
  const index = Math.min(step, total - 1);
  const current = slides[index];
  const atStart = index === 0;
  const atEnd = index === total - 1;
  const blocked = current.ready === false;

  function go(delta: number) {
    setStep((s) => Math.min(Math.max(s + delta, 0), total - 1));
  }

  // Arrow keys move the deck, which is how anyone treats a carousel. Ignored
  // while a field has focus, so typing a password is not navigation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' && !blocked && !atEnd) go(1);
      if (e.key === 'ArrowLeft' && !atStart) go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Shell>
      <PageHeader
        title="Add a mailbox, step by step"
        description="Explains each setting and collects it as you go. Around three minutes."
        actions={
          <Link href="/accounts/new">
            <Button>I know my settings — plain form</Button>
          </Link>
        }
      />

      <div
        className={cx(
          'mx-auto transition-[max-width] duration-300',
          current.wide ? 'max-w-6xl' : 'max-w-3xl',
        )}
      >
        <Card>
          <div className="border-b border-border px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-accent">{current.phase}</span>
              <span className="text-muted">
                Step {index + 1} of {total}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className="brand-gradient h-full rounded-full transition-all duration-300"
                style={{ width: `${((index + 1) / total) * 100}%` }}
              />
            </div>
          </div>

          {/* A floor on the height stops the card resizing wildly between a
              two-line slide and the warm-up chart. */}
          <div className="min-h-[22rem] px-4 py-5">
            <h2 className="text-lg font-semibold tracking-tight">
              {current.title}
            </h2>
            <div className="mt-4">{current.content}</div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <Button
              onClick={() => go(-1)}
              disabled={atStart || Boolean(created)}
            >
              Back
            </Button>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.phase + s.title}
                  type="button"
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  aria-current={i === index ? 'step' : undefined}
                  onClick={() => setStep(i)}
                  disabled={!provider && i > 0}
                  className={cx(
                    'size-2 rounded-full transition disabled:opacity-30',
                    i === index
                      ? 'brand-gradient w-5'
                      : i < index
                        ? 'bg-accent/40'
                        : 'bg-border',
                  )}
                />
              ))}
            </div>

            {atEnd ? (
              // Once the mailbox exists the body carries the follow-on actions
              // (send a test, go to import), so this slot stays empty rather
              // than offering a second way to do the same thing.
              !created && (
                <Button
                  variant="primary"
                  loading={submitting}
                  disabled={!canCreate}
                  onClick={() => void submit()}
                >
                  Create mailbox
                </Button>
              )
            ) : (
              <Button
                variant="primary"
                onClick={() => go(1)}
                disabled={blocked}
              >
                {current.nextLabel ?? 'Next'}
              </Button>
            )}
          </div>
        </Card>

        {provider && !created && (
          <p className="mt-3 text-center text-xs text-muted">
            Setting up {provider.label} · nothing is saved until the last step ·{' '}
            <button
              type="button"
              className="text-accent underline underline-offset-2"
              onClick={() => {
                setProviderId(null);
                setStep(0);
              }}
            >
              start over
            </button>
          </p>
        )}
      </div>
    </Shell>
  );
}
