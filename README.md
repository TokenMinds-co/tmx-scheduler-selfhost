# TMX Scheduler

[![CI](https://github.com/TokenMinds-co/tmx-scheduler/actions/workflows/ci.yml/badge.svg)](https://github.com/TokenMinds-co/tmx-scheduler/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Self-hosted outreach email scheduler. Import a spreadsheet, send each row at
its scheduled time from one of several company mailboxes over SMTP, keep every
mailbox under its own daily limit and pacing gap, and see who opened and
clicked — with the security scanners filtered out.

It runs on your own server against your own mailboxes (Google Workspace,
Microsoft 365, Zoho, or any SMTP relay). No third party holds your credentials
or your recipient list.

## Features

- **Spreadsheet import with a dry run.** Every row names its sending mailbox,
  recipient, schedule, subject and message; `{{firstName}}`-style placeholders
  personalise it. The dry run runs the same validation and writes nothing.
- **Per-row timezones, never guessed.** A schedule cell may carry its own zone;
  an unrecognised one rejects the row instead of silently shifting it.
- **Several mailboxes, each throttled atomically.** Daily limit, warm-up
  default, and a minimum gap between sends with jitter — checked and written in
  one SQL statement, so concurrent workers cannot collectively exceed a limit.
- **Postgres holds the schedule; Redis only holds what is due now.** A pending
  message can be cancelled or rescheduled with one update.
- **Retries with backoff and jitter**, recorded on the queue row so the
  dashboard shows the real attempt count and next attempt time.
- **Hard bounces suppress the address** and cancel everything still queued for
  it; quota and rate errors are treated as transient.
- **One-click unsubscribe** — a signed link plus RFC 8058
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers, so Gmail and Outlook
  show their native button.
- **Open and click tracking with scanner filtering.** Raw hits are stored
  unfiltered and judged on read, so when the rules improve every past batch is
  re-judged for free.
- **Signature builder.** Table-based HTML that survives Outlook, plus an
  authored plain-text half; hand-written HTML is accepted and sanitised.
- **Guided mailbox setup.** Reads the sending domain's MX and SPF records to
  work out the provider, then walks through creating an app password.
- **SMTP password or OAuth2** (Google, Microsoft) for authentication.
- **Append-only audit log** of every mailbox edit, import and bulk action.
- **Secrets encrypted at rest** with AES-256-GCM under a key you hold.
- **Mailpit in the dev loop**, so nothing escapes while you try it out.

## Quick start

Needs Node 22 (`.nvmrc`), pnpm (via `corepack enable`) and Docker.

```bash
git clone https://github.com/TokenMinds-co/tmx-scheduler.git && cd tmx-scheduler
pnpm install
pnpm setup                                   # writes backend/.env and frontend/.env.local with fresh secrets; prints the admin password
pnpm infra:up                                # Postgres, Redis and Mailpit, all on 127.0.0.1
pnpm --filter @tmx-scheduler/shared build    # backend and frontend import the built output
pnpm --filter backend db:migrate             # creates the tables
pnpm dev                                     # API on :4000, UI on :3000
```

Sign in at <http://localhost:3000> with the email and password `pnpm setup`
printed. The first admin is created on boot from `SEED_ADMIN_*` whenever no
user exists (`pnpm seed` does the same by hand). Mail sent in development lands
in Mailpit at <http://localhost:8025>.

**Setting up a mailbox for the first time?** Use the guided setup at
<http://localhost:3000/accounts/help>. It asks for the sending address, reads
that domain's DNS to work out who runs its mail, walks through generating the
app password for that provider, collects every field as it explains it, and
creates the mailbox at the end. `/accounts/new` remains the plain form for
anyone who already knows their settings.

`pnpm build` runs shared → backend → frontend in that order. Editing
`packages/shared` means rebuilding it (`pnpm --filter @tmx-scheduler/shared dev`
watches).

## Repository layout

```
backend/           NestJS API + poller + send worker (Prisma + Postgres, BullMQ + Redis)
frontend/          Next.js admin UI
packages/shared/   TypeScript contracts both sides import (@tmx-scheduler/shared)
docs/              Deployment guide
docker-compose.yml Postgres, Redis and Mailpit for local work
backend/Dockerfile Production image; backend/docker-compose*.yml run it
.github/workflows/ ci.yml checks every push and PR; deploy.yml ships main
```

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
take a _different_ due row instead of queueing behind the same one.

**Retries live on the queue row**, not in BullMQ. The dashboard has to show
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
mailbox would have nothing to put back in the form. (`ims` is the project's
old internal name; the attribute is part of every stored signature, so it
stays.)

`signature-templates.spec.ts` asserts every template survives
`sanitizeSignatureHtml` **byte for byte**. The renderer and the sanitiser are
two files that must agree on a vocabulary of tags, attributes and CSS
properties, and when they drift nothing fails loudly — the operator approves a
correct preview and the recipient gets the layout stripped out.

### Tracking

Every open and click is stored as it arrives, with the evidence attached: how
long after the send it came, how many distinct links from the same message were
hit within a burst, the user agent, the reverse DNS of the address, and how many
unrelated recipients' mail the same /24 has clicked. Whether a hit was a person
is decided when it is read, from that evidence and the rules in
`backend/src/tracking/classify.ts`. Change a threshold and every batch ever
sent is re-judged on the next page load; nothing has to be collected again.

### Failure handling

| Outcome                                | Treatment                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------- |
| 4xx SMTP reply                         | Transient. Retried at 1m, 4m, 15m (±20% jitter), then failed.              |
| 5xx SMTP reply                         | Permanent → `failed`.                                                      |
| 5xx naming the recipient (550/551/553) | Hard bounce → address suppressed, remaining mail to it cancelled.          |
| 5xx about quota or rate                | Treated as transient — the mailbox is over quota, not wrong.               |
| Connection error (no SMTP reply)       | Transient, and the daily slot is given back: nothing was sent.             |
| Daily limit reached                    | Deferred to 9 AM the next send day, in the mailbox's zone. Not an attempt. |
| Pacing gap not open                    | Deferred to when it opens, plus jitter. Not an attempt.                    |

## Import format

| Column                         | Notes                                                               |
| ------------------------------ | ------------------------------------------------------------------- |
| Sending Email                  | Must match a configured, active mailbox                             |
| First Name, Last Name, Company | Optional, used for personalisation                                  |
| Email                          | Recipient                                                           |
| Schedule                       | **Must carry a timezone** — see below                               |
| Message, Subject               | May use `{{firstName}}`, `{{lastName}}`, `{{company}}`, `{{email}}` |
| Group                          | Campaign label; drives filtering and bulk actions                   |

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
  address _and_ cancels everything still queued for it.
- **Spread a campaign across mailboxes** rather than maxing one out.

Cold outreach from Gmail and Google Workspace runs against their bulk-sender
terms independently of CAN-SPAM, GDPR or PECR obligations. That is a decision
for whoever runs the campaign, not something the tool can settle — it will
send what you schedule, to whom you schedule it.

## Database

Prisma against Postgres. The schema is `backend/prisma/schema.prisma`; migrations
live beside it and are applied with `db:migrate` in development or `db:deploy`
in production. CI applies every migration to an empty database and fails if the
result differs from the schema.

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
  Only `/health`, `/unsubscribe` and the tracking endpoints do.
- Session, unsubscribe and tracking links are signed with three separate
  secrets, so a leaked tracking URL can never be replayed as a session.
- Every mailbox edit, import and bulk action is written to an append-only audit
  log, secret _values_ excluded.
- Signature HTML is sanitised server-side before storage and before sending —
  whether it came from the template builder or was pasted in by hand.
- The admin session token is kept in `localStorage` and sent as a header, not
  as an ambient cookie: the UI and API are separate origins, and a header
  cannot be replayed by a cross-site form post. The trade-off is that any
  script on the admin origin could read it, which is why nothing untrusted is
  rendered there unsanitised.
- Turning off **Require TLS** is offered for a plain-SMTP relay on the same
  host. Over a network it sends the mailbox password in the clear.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Environment

See `backend/.env.example` for the full list. The ones that matter:

| Variable                                              | Purpose                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `REDIS_URL`                           | Postgres and Redis. Default to the root `docker-compose.yml` services.                                               |
| `CREDS_KEY`                                           | 32 bytes base64. Encrypts stored secrets. Boot fails if wrong length.                                                |
| `JWT_SECRET`, `UNSUBSCRIBE_SECRET`, `TRACKING_SECRET` | Separate keys, so no token issued for one purpose is valid for another.                                              |
| `PUBLIC_API_URL`                                      | Base for unsubscribe links inside outgoing mail.                                                                     |
| `TRACKING_BASE_URL`                                   | Host tracking links point at. Defaults to `PUBLIC_API_URL`; give it a subdomain of the sending domain in production. |
| `CORS_ORIGINS`                                        | Origins allowed to call the API — the UI's origin.                                                                   |
| `POLL_INTERVAL_MS`, `CLAIM_BATCH_SIZE`                | Poller cadence and per-tick budget.                                                                                  |
| `SEND_CONCURRENCY`                                    | Ceiling across all mailboxes; per-mailbox pacing is separate.                                                        |
| `STUCK_SENDING_TIMEOUT_MS`                            | How long a claim may sit before the reaper takes it back.                                                            |
| `DRY_RUN_SENDING`                                     | Logs messages instead of sending. Use for a first run against real data.                                             |
| `SEED_ADMIN_*`                                        | The first admin, created on boot when no user exists.                                                                |

New mailboxes default to the `Asia/Singapore` timezone; each mailbox's zone is
editable in its form.

## Commands

```bash
pnpm dev              # both apps
pnpm build            # shared -> backend -> frontend
pnpm test             # backend unit tests
pnpm typecheck        # every package
pnpm lint             # ESLint, every package
pnpm format:check     # Prettier; `pnpm format` rewrites
pnpm infra:up / :down # local Postgres, Redis and Mailpit
pnpm seed             # first admin (refuses to run if any user exists)

pnpm --filter backend db:migrate   # create/apply a migration in development
pnpm --filter backend db:deploy    # apply pending migrations (production)
pnpm --filter backend db:studio    # browse the data
```

## Deployment

The backend ships as a Docker image, `ghcr.io/tokenminds-co/tmx-scheduler-backend`,
built from [`backend/Dockerfile`](backend/Dockerfile); the frontend is a
standard Next.js app. [docs/deployment.md](docs/deployment.md) covers the
image, running it with Docker Compose against your own Postgres and Redis, the
frontend, and the GitHub Actions pipeline this repository deploys itself with.

## Roadmap

Known gaps, each an open issue:

- **Reply detection.** A recipient who answers should drop out of the campaign.
  Needs IMAP polling or the Gmail / Microsoft Graph APIs; today the suppression
  list fills only from unsubscribes and hard bounces at send time.
- **Asynchronous bounces.** A delivery-status notification arriving minutes
  after the SMTP transaction is not read. Only synchronous bounces are caught.
- **OAuth consent flow.** Sending over XOAUTH2 works, but the refresh token has
  to be pasted into the mailbox form.
- **Frontend image.** The backend has a Dockerfile; the frontend does not yet.
- **Frontend tests.** The unit tests cover the backend only.
- **Configurable default timezone** for new mailboxes.

Issues labelled [`good first issue`](https://github.com/TokenMinds-co/tmx-scheduler/labels/good%20first%20issue)
are scoped for a first contribution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions and the pull
request flow. Everyone taking part is expected to follow the
[code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).
