/**
 * Contracts shared by the API and the admin UI. Everything here is a plain
 * value or type — no runtime dependency — so both a CommonJS Nest build and a
 * bundled Next app can import it.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const EmailStatus = {
  Pending: 'pending',
  Sending: 'sending',
  Sent: 'sent',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

export const EMAIL_STATUSES: EmailStatus[] = Object.values(EmailStatus);

export const AuthType = {
  SmtpPassword: 'smtp_password',
  OAuthGoogle: 'oauth_google',
  OAuthMicrosoft: 'oauth_microsoft',
} as const;
export type AuthType = (typeof AuthType)[keyof typeof AuthType];

export const AUTH_TYPES: AuthType[] = Object.values(AuthType);

export const UserRole = {
  Admin: 'admin',
  Operator: 'operator',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const SuppressionReason = {
  Bounce: 'bounce',
  Unsubscribe: 'unsubscribe',
  Complaint: 'complaint',
  Manual: 'manual',
  ReplyNo: 'reply_no',
} as const;
export type SuppressionReason =
  (typeof SuppressionReason)[keyof typeof SuppressionReason];

export const SUPPRESSION_REASONS: SuppressionReason[] =
  Object.values(SuppressionReason);

// ---------------------------------------------------------------------------
// Provider presets
//
// The UI offers these as a dropdown; the API uses the same table to warn when a
// daily limit is set above what the provider will actually accept. Limits are
// the published per-day ceilings — see the build plan's provider table.
// ---------------------------------------------------------------------------

export interface ProviderPreset {
  id: string;
  label: string;
  smtpHost: string;
  smtpPort: number;
  /** Provider ceiling per 24h. `null` when the host defines it (self-hosted). */
  providerDailyLimit: number | null;
  /** What a new mailbox defaults to — a warm-up figure, never the ceiling. */
  suggestedDailyLimit: number;
  supportedAuth: AuthType[];
  notes: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail (free)',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    providerDailyLimit: 500,
    suggestedDailyLimit: 20,
    supportedAuth: [AuthType.SmtpPassword, AuthType.OAuthGoogle],
    notes: 'Requires 2-Step Verification, then an App Password.',
  },
  {
    id: 'google_workspace',
    label: 'Google Workspace',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    providerDailyLimit: 2000,
    suggestedDailyLimit: 20,
    supportedAuth: [AuthType.SmtpPassword, AuthType.OAuthGoogle],
    notes: 'App Password or OAuth2. 2,000 recipients/day per user.',
  },
  {
    id: 'microsoft365',
    label: 'Microsoft 365',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    providerDailyLimit: 10000,
    suggestedDailyLimit: 20,
    supportedAuth: [AuthType.SmtpPassword, AuthType.OAuthMicrosoft],
    notes:
      'Admin must enable Authenticated SMTP. Basic auth is retired after Dec 2026 — plan for OAuth2. Throttles at 30 messages/minute.',
  },
  {
    id: 'outlook_personal',
    label: 'Outlook.com (personal)',
    smtpHost: 'smtp-mail.outlook.com',
    smtpPort: 587,
    providerDailyLimit: 300,
    suggestedDailyLimit: 10,
    supportedAuth: [AuthType.OAuthMicrosoft],
    notes: 'OAuth2 only and heavily rate limited — avoid for outreach.',
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    providerDailyLimit: null,
    suggestedDailyLimit: 20,
    supportedAuth: [AuthType.SmtpPassword],
    notes: 'Limit is plan-dependent and very low on the free tier.',
  },
  {
    id: 'mailpit',
    label: 'Mailpit (local capture)',
    // 127.0.0.1 rather than localhost: Node resolves localhost to ::1 first on
    // a dual-stack machine, and Mailpit publishes on IPv4 only, so 'localhost'
    // fails with ECONNREFUSED ::1:1025.
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    providerDailyLimit: null,
    suggestedDailyLimit: 10000,
    supportedAuth: [AuthType.SmtpPassword],
    notes: 'Development only — captures mail at http://localhost:8025.',
  },
  {
    id: 'custom',
    label: 'Own domain / hosting (cPanel, Plesk, …)',
    smtpHost: '',
    smtpPort: 587,
    providerDailyLimit: null,
    suggestedDailyLimit: 20,
    supportedAuth: [AuthType.SmtpPassword],
    notes:
      'Confirm SPF, DKIM and DMARC are published for the domain or mail will be spam-foldered.',
  },
];

// ---------------------------------------------------------------------------
// API resources
// ---------------------------------------------------------------------------

/**
 * An account as the API returns it. Secrets never appear here — only a boolean
 * saying whether one is stored.
 */
// ---------------------------------------------------------------------------
// Provider detection
//
// The setup guide asks for a domain and answers "which of these are you",
// rather than making an operator recognise their own mail host. The answer
// comes from that domain's public DNS: MX says who runs the mailboxes, SPF and
// DMARC say whether the domain is ready to send.
// ---------------------------------------------------------------------------

export type DetectionConfidence = 'certain' | 'likely' | 'unknown';

export interface DomainCheck {
  /** The domain actually queried, after any address was reduced to its host. */
  domain: string;
  /** Preset id the MX records point at, or null when nothing matched. */
  presetId: string | null;
  confidence: DetectionConfidence;
  /** Human-readable reason, so the answer is auditable rather than magic. */
  reason: string;
  /** MX hostnames in preference order. Empty when the domain receives no mail. */
  mx: string[];
  /** The domain's SPF record, if it publishes one. */
  spf: string | null;
  /** Whether that SPF authorises the detected provider to send. */
  spfIncludesProvider: boolean | null;
  /** The _dmarc TXT record, if published. */
  dmarc: string | null;
}

export interface AccountDto {
  id: string;
  email: string;
  displayName: string;
  authType: AuthType;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  /** STARTTLS required on a non-465 port. Off only for a trusted local relay. */
  requireTls: boolean;
  hasPassword: boolean;
  hasOAuthCredentials: boolean;
  signatureHtml: string;
  signatureText: string;
  dailyLimit: number;
  minGapSeconds: number;
  /** IANA zone that decides when this mailbox's daily counter rolls over. */
  timezone: string;
  sentToday: number;
  sentTodayDate: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  lastVerifiedAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailDto {
  id: string;
  accountId: string;
  sendingEmail: string;
  toEmail: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  group: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  scheduledAt: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  providerMessageId: string | null;
  claimedAt: string | null;
  /** First open and click, or null. Populated only for tracked campaign mail. */
  firstOpenAt: string | null;
  firstClickAt: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SuppressionDto {
  id: string;
  email: string;
  reason: SuppressionReason;
  note: string | null;
  createdAt: string;
}

export interface AuditEntryDto {
  id: string;
  actorEmail: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SessionUserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Column headers expected in the uploaded sheet, in the sample's order. */
export const IMPORT_COLUMNS = [
  'Sending Email',
  'First Name',
  'Last Name',
  'Email',
  'Company',
  'Schedule',
  'Message',
  /**
   * Optional. When present the HTML half of the message is taken from here
   * rather than derived from `Message`, which is what makes real anchor tags
   * possible — and therefore click tracking. `Message` is still required, as
   * the plain-text alternative every multipart message needs.
   */
  'Message HTML',
  'Subject',
  'Group',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export interface ImportRowError {
  /** 1-based row number in the source file, header excluded. */
  row: number;
  toEmail: string | null;
  reason: string;
}

export interface ImportResult {
  batchId: string;
  totalRows: number;
  inserted: number;
  /** Rows that matched an existing dedupe key. */
  skippedDuplicates: number;
  /** Rows whose recipient is on the suppression list. */
  skippedSuppressed: number;
  errors: ImportRowError[];
  /** Set when the caller asked for a dry run; nothing was written. */
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

/** How one recorded hit was judged. See backend/src/tracking/classify.ts. */
export type TrackingVerdict = 'counted' | 'machine' | 'suspect';

export interface TrackingBreakdown {
  /** Recipients whose hit passed every check. The number worth quoting. */
  counted: number;
  /** Scanners, proxies and sweeps. Kept visible rather than hidden. */
  machine: number;
  /** Passed the hard rules but looks off — no user agent, datacenter host. */
  suspect: number;
  /** Distinct recipients behind the counted hits. */
  people: number;
}

export interface TrackingStats {
  /** Messages actually sent, the denominator for both rates. */
  sent: number;
  clicks: TrackingBreakdown;
  opens: TrackingBreakdown;
  /**
   * Delay in seconds for every click, bucketed. The shape that decides where
   * the cut-off belongs — scanners cluster in the first bucket, people spread
   * across the rest.
   */
  clickDelayBuckets: { upToSeconds: number; hits: number }[];
  /** Why hits were rejected, commonest first. */
  reasons: { reason: string; hits: number }[];
  /** The thresholds these numbers were judged against. */
  rules: { minDelaySeconds: number; burstLinks: number };
}

export interface QueueStats {
  /** Messages in each state, all time. `sent` here never resets. */
  byStatus: Record<EmailStatus, number>;
  /** Sends recorded today across every mailbox, each in its own timezone. */
  sentToday: number;
  dueNow: number;
  next24h: number;
}

export interface AccountStats {
  accountId: string;
  email: string;
  active: boolean;
  sentToday: number;
  dailyLimit: number;
  remainingToday: number;
  pending: number;
  failed: number;
  lastSentAt: string | null;
  lastError: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Timezones
//
// A short curated list rather than the full IANA database. These are zones a
// dropdown can be scanned for; the field still accepts any valid IANA name
// through the API for anywhere not listed.
// ---------------------------------------------------------------------------

export interface TimezoneOption {
  /** IANA zone name — what is actually stored and parsed with. */
  value: string;
  label: string;
}

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: 'Asia/Singapore', label: 'Singapore — SGT (UTC+8)' },
  { value: 'Asia/Jakarta', label: 'Jakarta — WIB (UTC+7)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur — MYT (UTC+8)' },
  { value: 'Asia/Bangkok', label: 'Bangkok — ICT (UTC+7)' },
  { value: 'Asia/Manila', label: 'Manila — PHT (UTC+8)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong — HKT (UTC+8)' },
  { value: 'Asia/Shanghai', label: 'China — CST (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Tokyo — JST (UTC+9)' },
  { value: 'Asia/Seoul', label: 'Seoul — KST (UTC+9)' },
  { value: 'Asia/Kolkata', label: 'India — IST (UTC+5:30)' },
  { value: 'Asia/Dubai', label: 'Dubai — GST (UTC+4)' },
  { value: 'Australia/Sydney', label: 'Sydney — AEST/AEDT' },
  { value: 'Europe/London', label: 'London — GMT/BST' },
  { value: 'Europe/Paris', label: 'Central Europe — CET/CEST' },
  { value: 'America/New_York', label: 'New York — ET' },
  { value: 'America/Chicago', label: 'Chicago — CT' },
  { value: 'America/Denver', label: 'Denver — MT' },
  { value: 'America/Los_Angeles', label: 'Los Angeles — PT' },
  { value: 'UTC', label: 'UTC' },
];
export const DEFAULTS = {
  dailyLimit: 20,
  minGapSeconds: 45,
  /** Poller claim budget per tick. */
  claimBatchSize: 50,
  /** Worker concurrency across all accounts. */
  sendConcurrency: 5,
  timezone: 'Asia/Singapore',
} as const;

// ---------------------------------------------------------------------------
// Signature templates
// ---------------------------------------------------------------------------

export * from './signature';
