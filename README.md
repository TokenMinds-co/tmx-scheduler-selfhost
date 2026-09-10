# TMX Scheduler

Schedules and sends outreach email from several company mailboxes, imported from
a spreadsheet. One repo, two apps, one shared contract package.

```
backend/           NestJS API + poller + send worker (Prisma + Postgres)
frontend/          Next.js admin UI
packages/shared/   TypeScript contracts both sides import (@ims/shared)
docker-compose.yml Redis and Mailpit for local work (Postgres is external)
```

## Quick start

```bash
pnpm install
pnpm infra:up                        # Redis, Mailpit

# Postgres is not in docker-compose: the app uses the existing local-postgres
# container on 127.0.0.1:5433, in its own database.
docker exec local-postgres psql -U postgres -c "CREATE DATABASE mail_scheduler;"

cp backend/.env.example backend/.env
pnpm --filter backend keygen         # paste into CREDS_KEY
# also set JWT_SECRET and UNSUBSCRIBE_SECRET to long random strings

cp frontend/.env.local.example frontend/.env.local

pnpm --filter @ims/shared build      # backend and frontend import the built output
pnpm --filter backend db:migrate     # creates the tables
pnpm seed                            # creates the first admin from SEED_ADMIN_*
pnpm dev                             # API on :4000, UI on :3000
```

Sign in at <http://localhost:3000> with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

**Setting up a mailbox for the first time?** Use the guided setup at
<http://localhost:3000/accounts/help>. It asks for the sending address, reads
that domain's DNS to work out who runs its mail, walks through generating the
app password for that provider, collects every field as it explains it, and
creates the mailbox at the end. `/accounts/new` remains the plain form for
anyone who already knows their settings.

`pnpm build` runs shared → backend → frontend in that order. Editing
`packages/shared` means rebuilding it (`pnpm --filter @ims/shared dev` watches).

## How it works

```
CSV import ──> email_queue (Postgres, status=pending, scheduledAt in UTC)
                     │
       poller (2s)   │  UPDATE … FOR UPDATE SKIP LOCKED: pending -> sending
                     ▼
               BullMQ job (Redis)
                     │
       send worker   │  claim a per-mailbox send slot              [atomic]
                     ▼
               Nodemailer ──> SMTP ──> sent / failed / deferred
```

**Why two stages.** Postgres holds the schedule; Redis only ever holds work that
is due right now. A pending message can be cancelled or rescheduled with one
update — not true of a job already delayed inside Redis. Both claims are single
atomic statements, so any number of API instances can run without a lock.

The poller's claim uses `FOR UPDATE SKIP LOCKED`, so concurrent pollers each
take a *different* due row instead of queueing behind the same one.

**Retries live on the queue document**, not in BullMQ. The dashboard has to show
the attempt count and the next attempt time, and two independent retry
mechanisms would disagree about both. BullMQ jobs are created with `attempts: 1`.

**Throttling is an atomic claim** (`AccountsService.claimSendSlot`). The daily
counter and the pacing gap are checked and written in one `UPDATE`, so
concurrent workers cannot all pass a limit check and then collectively exceed
it. A `CASE` in the same statement resets the counter on a day boundary in the
mailbox's own timezone.

**A crash is recoverable.** A row moves to `sending` before its Redis job
exists. If the process dies in that window nothing else would ever look at it
again, so `ReaperService` sweeps every minute and returns claims older than
`STUCK_SENDING_TIMEOUT_MS` to `pending`.

### Signatures

SMTP sends the bytes it is given and nothing else. A signature configured in
Gmail's or Outlook's web UI lives only in that compose box, so it never appears
on a message sent from here — every mailbox needs its own signature stored
against it, and both halves of the multipart message need one.

The mailbox form builds it: pick a layout, fill in the fields, watch the
preview. `packages/shared/src/signature.ts` renders the HTML — table-based,
inline styles only, because Outlook lays out through Word — and the plain-text
part alongside it, so the text half is authored rather than salvaged from tags.
Pasting hand-written HTML is still available for a block handed over by a brand
team; that path derives its text part with `htmlToText`.

The stored value is HTML, so a template signature also carries the fields that
produced it in a `data-ims-signature-fields` attribute. Without it, re-opening a
mailbox would have nothing to put back in the form.

`signature-templates.spec.ts` asserts every template survives
`sanitizeSignatureHtml` **byte for byte**. The renderer and the sanitiser are
two files that must agree on a vocabulary of tags, attributes and CSS
properties, and when they drift nothing fails loudly — the operator approves a
correct preview and the recipient gets the layout stripped out.

### Failure handling

| Outcome | Treatment |
|---|---|
| 4xx SMTP reply | Transient. Retried at 1m, 4m, 15m (±20% jitter), then failed. |
| 5xx SMTP reply | Permanent → `failed`. |
| 5xx naming the recipient (550/551/553) | Hard bounce → address suppressed, remaining mail to it cancelled. |
| 5xx about quota or rate | Treated as transient — the mailbox is over quota, not wrong. |
| Connection error (no SMTP reply) | Transient, and the daily slot is given back: nothing was sent. |
| Daily limit reached | Deferred to the next local day. Not an attempt. |
| Pacing gap not open | Deferred to when it opens, plus jitter. Not an attempt. |

## Import format

| Column | Notes |
|---|---|
| Sending Email | Must match a configured, active mailbox |
| First Name, Last Name, Company | Optional, used for personalisation |
| Email | Recipient |
| Schedule | **Must carry a timezone** — see below |
| Message, Subject | May use `{{firstName}}`, `{{lastName}}`, `{{company}}`, `{{email}}` |
| Group | Campaign label; drives filtering and bulk actions |

`Schedule` may be a plain date and time (`Sep 10 2026 9:00 AM`), in which case
the **timezone chosen on the import screen** is applied to it. A cell may carry
its own zone instead (`... 9:00 AM SGT`, `2026-09-10T00:03+08:00`, or a full
IANA name), and that always overrides the dropdown for that row.

A zone token that is present but unrecognised is still **rejected for that row**
rather than guessed: the author meant a zone and mistyped it, and silently
overriding what someone wrote is how a campaign goes out seven hours early in
another country. Recognised abbreviations are listed in
`backend/src/emails/schedule-parse.ts`.

Import always offers a dry run first: the same validation, no writes.

Duplicates are keyed on `(sending mailbox, recipient, subject, group)` —
deliberately **not** the send time, so re-importing a sheet with a corrected
schedule does not mail the same person twice.

## Deliverability

The tool enforces what it can; the rest is operational discipline.

- **Warm up.** New mailboxes default to 20/day. Raise ~20% a week.
- **Pace.** `minGapSeconds` 30–90, jitter added automatically.
- **Authenticate the domain.** SPF, DKIM and DMARC must be published or mail
  will be spam-foldered regardless of anything here.
- **Unsubscribe works.** Every campaign message carries a signed link plus
  RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers, so Gmail and
  Outlook render their native unsubscribe button. Using it suppresses the
  address *and* cancels everything still queued for it.
- **Spread a campaign across mailboxes** rather than maxing one out.

Cold outreach from Gmail and Google Workspace runs against their bulk-sender
terms independently of CAN-SPAM or GDPR obligations. That is a decision for
whoever runs the campaign, not something the tool can settle.

## Database

Prisma against Postgres. The schema is `backend/prisma/schema.prisma`; migrations
live beside it and are applied with `db:migrate` in development or `db:deploy`
in production.

`email_queue.accountId` is an indexed column rather than a foreign key. That
preserves the delete semantics the app was built on: removing a mailbox leaves
its sent history intact rather than cascading it away, and a queued row whose
mailbox has gone is reported at send time as "Sending mailbox no longer exists".
Adding the constraint would change what deleting a mailbox does, so it is a
separate decision from the storage engine.

## Security

- SMTP passwords and OAuth secrets are encrypted with AES-256-GCM under
  `CREDS_KEY` and never returned by the API — the UI only learns whether a
  secret exists.
- Stored ciphertext is versioned (`v1.<iv>.<tag>.<data>`) so a key rotation can
  re-encrypt as a background sweep rather than a stop-the-world migration.
- Authentication is on by default; a route opts out explicitly with `@Public()`.
  Only `/health` and `/unsubscribe` do.
- Every mailbox edit, import and bulk action is written to an append-only audit
  log, secret *values* excluded.
- Signature HTML is sanitised server-side before storage and before sending —
  whether it came from the template builder or was pasted in by hand.
- Turning off **Require TLS** is offered for a plain-SMTP relay on the same
  host. Over a network it sends the mailbox password in the clear.

## Environment

See `backend/.env.example` for the full list. The ones that matter:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Points at `local-postgres` on 5433 by default. |
| `CREDS_KEY` | 32 bytes base64. Encrypts stored secrets. Boot fails if wrong length. |
| `JWT_SECRET` / `UNSUBSCRIBE_SECRET` | Separate keys, so an unsubscribe link can never be replayed as a session. |
| `PUBLIC_API_URL` | Base for unsubscribe links inside outgoing mail. |
| `POLL_INTERVAL_MS`, `CLAIM_BATCH_SIZE` | Poller cadence and per-tick budget. |
| `SEND_CONCURRENCY` | Ceiling across all mailboxes; per-mailbox pacing is separate. |
| `STUCK_SENDING_TIMEOUT_MS` | How long a claim may sit before the reaper takes it back. |
| `DRY_RUN_SENDING` | Logs messages instead of sending. Use for a first run against real data. |

## Commands

```bash
pnpm dev              # both apps
pnpm build            # shared -> backend -> frontend
pnpm test             # backend unit tests
pnpm typecheck        # every package
pnpm infra:up / :down # local Redis and Mailpit
pnpm seed             # first admin (refuses to run if any user exists)

pnpm --filter backend db:migrate   # create/apply a migration in development
pnpm --filter backend db:deploy    # apply pending migrations (production)
pnpm --filter backend db:studio    # browse the data
```

## Still open

- **`email.tmx.center` MX** — run `nslookup -type=MX email.tmx.center` and use
  the matching provider preset. That decides the real SMTP settings.
- **Reply detection** ("reply Yes") needs IMAP polling or the Gmail/Graph API.
  Not built; the suppression list currently fills from unsubscribes and hard
  bounces at send time.
- **Asynchronous bounces** (a delivery-status notification arriving minutes
  later) are not read. Only bounces reported synchronously by the SMTP
  transaction are caught today.
