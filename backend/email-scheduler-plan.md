# Bulk Email Scheduler — Build Plan

Internal tool for scheduling and sending outreach emails from multiple company mailboxes, imported from a spreadsheet.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | NestJS (TypeScript) | Team preference; modules map cleanly to accounts / queue / sender |
| Database | MongoDB + Mongoose | Flexible import columns, atomic `findOneAndUpdate` for job claiming |
| Job queue | BullMQ + Redis (`@nestjs/bullmq`) | Retries, backoff, concurrency, job dedupe out of the box |
| Scheduler | `@nestjs/schedule` cron every 2 s | Polls Mongo for due emails, pushes into BullMQ |
| Sending | Nodemailer over SMTP | Works with every provider; supports password and OAuth2 (XOAUTH2) |
| Admin UI | Any (Next.js / React / plain Nest views) | Accounts CRUD, CSV import, queue dashboard |
| Secrets | AES-256-GCM, key in env `CREDS_KEY` | Never store SMTP passwords / refresh tokens in plaintext |

## 2. Sending method: SMTP

SMTP is the universal standard. Every account row stores its own connection settings.

**Required credentials per account**

- Host (e.g. `smtp.gmail.com`)
- Port — 587 STARTTLS (default) or 465 implicit TLS
- Username — the full email address
- Password — provider-specific (see table), or OAuth2 client id / secret / refresh token
- From name + address — must match the mailbox or an allowed alias

**Provider reference**

| Provider | Host : port | Auth | Daily limit (approx.) |
|---|---|---|---|
| Gmail (free) | smtp.gmail.com : 587 | 2-Step Verification → App Password | 500 |
| Google Workspace | smtp.gmail.com : 587 | App Password or OAuth2 | 2,000 / user |
| Microsoft 365 | smtp.office365.com : 587 | Admin enables "Authenticated SMTP"; password until Dec 2026, then OAuth2 | 10,000 recipients/day, 30 msg/min |
| Outlook.com personal | smtp-mail.outlook.com : 587 | OAuth2 only | low — avoid |
| Zoho | smtp.zoho.com : 465 | Mailbox / app password | plan-dependent, low on free |
| Own domain on hosting (cPanel etc.) | mail.yourdomain : 465/587 | Mailbox password | host-defined, often 100–500/hour |

**Company domain (`@email.tmx.center`)** — settings depend on who hosts the domain's mail. Check with `nslookup -type=MX email.tmx.center`:
- MX → google.com → use Google Workspace row
- MX → outlook.com → use Microsoft 365 row
- MX → zoho.com → Zoho row
- MX → own/hosting server → hosting row; verify SPF, DKIM, DMARC are published or mail will be spam-foldered
- No MX → domain cannot send/receive; set up a provider first

**Signatures** — SMTP (and the Gmail/Graph APIs) never add a signature. The app stores `signatureHtml` + `signatureText` per account and appends them when building each message. Logo images should be inline (base64 / CID) or hosted URLs.

Deferred options (not needed for v1): Gmail API / Microsoft Graph for inbox reading (reply detection); transactional providers (Resend, Brevo, MailerSend) are free but their terms prohibit cold outreach, so not used.

## 3. Data model (Mongo collections)

### `accounts`
| Field | Notes |
|---|---|
| email, displayName | From header |
| authType | `smtp_password` \| `oauth_google` \| `oauth_microsoft` |
| smtpHost, smtpPort, smtpUser, smtpPasswordEnc | Password auth |
| oauthClientId, oauthClientSecretEnc, oauthRefreshTokenEnc | OAuth2 auth |
| signatureHtml, signatureText | Appended to every send |
| dailyLimit (default 200), minGapSeconds (default 45) | Throttling |
| sentToday, sentTodayDate, lastSentAt | Runtime counters |
| active | Kill switch |

### `email_queue`
| Field | Notes |
|---|---|
| accountId, sendingEmail | Which mailbox sends it |
| toEmail, firstName, lastName, company, group | From sheet |
| subject, bodyText, bodyHtml? | bodyText is raw, no signature |
| scheduledAt | **Always UTC** |
| status | `pending` → `sending` → `sent` \| `failed` \| `cancelled` |
| attempts, lastError, sentAt, providerMessageId | Tracking |
| dedupeKey (unique) | sha1(sendingEmail, to, subject, scheduledAt) |

Indexes: `{status:1, scheduledAt:1}`, unique `dedupeKey`.

### `suppression`
Recipients that bounced, unsubscribed or replied "no". Import rejects rows whose `toEmail` is here.

### `users`
Admin logins for the tool itself (role: admin / operator).

## 4. Flows

### 4.1 Account setup (admin)
1. Admin enters email, display name, auth type, SMTP settings, signature (rich-text editor → HTML, plus plain-text fallback), daily limit.
2. Server encrypts secrets, runs `transporter.verify()` to test the login, saves.
3. "Send test email to myself" button.

### 4.2 CSV / sheet import
Input columns (as in the sample sheet): Sending Email, First Name, Last Name, Email, Company, Schedule, Message, Subject, Group.
1. Parse file (papaparse / csv-parse).
2. Resolve `Sending Email` → account (reject unknown / inactive).
3. Parse `Schedule` with explicit timezone, e.g. `Sep 10 2026 12:03 AM SGT` → UTC. Unknown suffix → import error for that row.
4. Validate recipient email, check suppression list.
5. Compute `dedupeKey`; duplicates are skipped and reported.
6. Insert rows as `pending`; show summary (inserted / skipped / errors).

### 4.3 Poller (cron every 2 s)
```
loop up to 50 times:
  doc = email_queue.findOneAndUpdate(
          { status:'pending', scheduledAt: { $lte: now } },
          { $set: { status:'sending' } },
          { sort:{ scheduledAt:1 }, new:true })
  if none → break
  bullmq.add('send', { emailId }, { jobId: emailId, attempts:4, backoff: exponential 60s })
```
Atomic claim = safe with multiple app instances. Guard against overlapping ticks.

### 4.4 Send worker (BullMQ processor, concurrency 5)
1. Load email + account; abort if account inactive.
2. Reset `sentToday` if date changed.
3. Throttle: if `sentToday >= dailyLimit` → reschedule +1 h; if gap since `lastSentAt` < `minGapSeconds` → reschedule by the remaining gap + random jitter. Both set status back to `pending`.
4. Build message: text = body + signatureText; html = body→HTML + signatureHtml.
5. Send via cached Nodemailer transport (1 connection per account).
6. Success → `sent`, store `providerMessageId`, bump counters.
7. Failure → 5xx = permanent → `failed`; 4xx/network → retry with backoff; out of retries → `failed`.

### 4.5 Dashboard
- Queue table with filters (status, account, group, date), search by recipient.
- Actions: cancel pending, reschedule, retry failed, bulk cancel by group.
- Per-account stats: sent today / limit, last send, last error.
- Failed list with error text.

## 5. Deliverability rules (non-negotiable)
- **Warm-up**: new mailbox starts at `dailyLimit` 10–20, raise ~20 %/week to target.
- **Spacing**: `minGapSeconds` 30–90 with jitter; never burst.
- **Auth**: SPF, DKIM, DMARC published for every sending domain.
- **Suppression**: bounces and "no" replies go on the list; never re-send to them.
- **Unsubscribe line** in every template.
- Spread a campaign across several mailboxes rather than maxing one.

## 6. Security
- Secrets encrypted at rest (AES-256-GCM); key only in env, rotate by re-encrypting.
- Admin auth (JWT or session), roles, audit log of account edits and imports.
- Rate-limit the admin API; no SMTP settings returned to the client after save (show masked).

## 7. Build phases

| Phase | Deliverable |
|---|---|
| 1 | Nest project, Mongo + Redis wiring, `accounts` CRUD with encryption + `verify()` test, signature editor |
| 2 | CSV import with timezone parsing, dedupe, suppression check |
| 3 | Poller + BullMQ worker + SMTP sender; throttling; send test campaign of 5 |
| 4 | Dashboard: queue view, cancel/retry, per-account counters |
| 5 | Hardening: OAuth2 for M365/Gmail, bounce handling (IMAP or webhook), reply detection, audit log |

## 8. Open items
- Confirm MX / mail host for `email.tmx.center` → exact SMTP settings.
- Decide admin UI framework.
- Decide whether reply detection ("reply Yes") is in scope for v1 (needs IMAP polling or Gmail/Graph API).
