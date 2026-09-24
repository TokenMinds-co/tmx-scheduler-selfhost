# Architecture

How the scheduler is put together, and why. The README covers what it does
and how to run it; this page is the design record.

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

## Two stages, one source of truth

Postgres holds the schedule; Redis only ever holds work that is due right
now. A pending message can be cancelled or rescheduled with one update — not
true of a job already delayed inside Redis. Both claims are single atomic
statements, so any number of API instances can run without a lock.

The poller's claim uses `FOR UPDATE SKIP LOCKED`, so concurrent pollers each
take a _different_ due row instead of queueing behind the same one.

**Retries live on the queue row**, not in BullMQ. The dashboard has to show
the attempt count and the next attempt time, and two independent retry
mechanisms would disagree about both. BullMQ jobs are created with
`attempts: 1`.

**Throttling is an atomic claim** (`AccountsService.claimSendSlot`). The daily
counter and the pacing gap are checked and written in one `UPDATE`, so
concurrent workers cannot all pass a limit check and then collectively exceed
it. A `CASE` in the same statement resets the counter on a day boundary in the
mailbox's own timezone.

**A crash is recoverable.** A row moves to `sending` before its Redis job
exists. If the process dies in that window nothing else would ever look at it
again, so `ReaperService` sweeps every minute and returns claims older than
`STUCK_SENDING_TIMEOUT_MS` to `pending`.

## Failure handling

| Outcome                                | Treatment                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------- |
| 4xx SMTP reply                         | Transient. Retried at 1m, 4m, 15m (±20% jitter), then failed.              |
| 5xx SMTP reply                         | Permanent → `failed`.                                                      |
| 5xx naming the recipient (550/551/553) | Hard bounce → address suppressed, remaining mail to it cancelled.          |
| 5xx about quota or rate                | Treated as transient — the mailbox is over quota, not wrong.               |
| Connection error (no SMTP reply)       | Transient, and the daily slot is given back: nothing was sent.             |
| Daily limit reached                    | Deferred to 9 AM the next send day, in the mailbox's zone. Not an attempt. |
| Pacing gap not open                    | Deferred to when it opens, plus jitter. Not an attempt.                    |

The classification lives in `backend/src/mail/smtp-error.ts`.

## Import

`Schedule` may be a plain date and time (`Sep 10 2026 9:00 AM`), in which case
the **timezone chosen on the import screen** is applied to it. A cell may carry
its own zone instead (`... 9:00 AM SGT`, `2026-09-10T00:03+08:00`, or a full
IANA name), and that always overrides the dropdown for that row.

A zone token that is present but unrecognised is still **rejected for that row**
rather than guessed: the author meant a zone and mistyped it, and silently
overriding what someone wrote is how a campaign goes out seven hours early in
another country. Recognised abbreviations are listed in
`backend/src/emails/schedule-parse.ts`.

Duplicates are keyed on `(sending mailbox, recipient, subject, group)` —
deliberately **not** the send time, so re-importing a sheet with a corrected
schedule does not mail the same person twice.

Every import opens a **batch**, which is what the batches screen reports on:
how many rows were read, queued, skipped and rejected, and later how many were
delivered, opened and clicked.

## Signatures

SMTP sends the bytes it is given and nothing else. A signature configured in
Gmail's or Outlook's web UI lives only in that compose box, so it never appears
on a message sent from here — every mailbox needs its own signature stored
against it, and both halves of the multipart message need one.

The signature builder makes one: pick a layout, fill in the fields, watch the
preview. `packages/shared/src/signature.ts` renders the HTML — table-based,
inline styles only, because Outlook lays out through Word — and the plain-text
part alongside it, so the text half is authored rather than salvaged from tags.
Pasting hand-written HTML is still available for a block handed over by a brand
team; that path derives its text part with `htmlToText`.

The stored value is HTML, so a template signature also carries the fields that
produced it in a `data-ims-signature-fields` attribute. Without it, re-opening
a signature would have nothing to put back in the form. (`ims` is the project's
old internal name; the attribute is part of every stored signature, so it
stays.)

`signature-templates.spec.ts` asserts every template survives
`sanitizeSignatureHtml` **byte for byte**. The renderer and the sanitiser are
two files that must agree on a vocabulary of tags, attributes and CSS
properties, and when they drift nothing fails loudly — the operator approves a
correct preview and the recipient gets the layout stripped out.

## Tracking

Every open and click is stored as it arrives, with the evidence attached: how
long after the send it came, how many distinct links from the same message were
hit within a burst, the user agent, the reverse DNS of the address, and how many
unrelated recipients' mail the same /24 has clicked.

Whether a hit was a person is decided **when it is read**, from that evidence
and the rules in `backend/src/tracking/classify.ts`. Change a threshold and
every batch ever sent is re-judged on the next page load; nothing has to be
collected again. The rules today:

- a hit sooner than 30 seconds after the send was not a person reading;
- three or more distinct links from one message inside a burst is a scan;
- a click with no open before it, inside the first five minutes, is a gateway
  that fetched the link without rendering the message;
- one network following the links in mail to three or more unrelated
  companies is a scanner's address pool — the one signal a scanner cannot
  dress up.

Tracking links are signed with their own secret, so a leaked URL can never be
replayed as an unsubscribe or a session.

## Database

Prisma against Postgres. The schema is `backend/prisma/schema.prisma`;
migrations live beside it and are applied with `db:migrate` in development or
`db:deploy` in production. CI applies every migration to an empty database and
fails if the result differs from the schema.

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
- Authentication is on by default; a route opts out explicitly with
  `@Public()`. Only `/health`, `/unsubscribe` and the tracking endpoints do.
- Session, unsubscribe and tracking links are signed with three separate
  secrets, so no token issued for one purpose is valid for another.
- Every mailbox edit, import and bulk action is written to an append-only audit
  log, secret _values_ excluded.
- Signature HTML and imported message HTML go through the same server-side
  sanitiser before storage and before sending.
- The admin session token is kept in `localStorage` and sent as a header, not
  as an ambient cookie: the UI and API are separate origins, and a header
  cannot be replayed by a cross-site form post. The trade-off is that any
  script on the admin origin could read it, which is why nothing untrusted is
  rendered there unsanitised.
- Turning off **Require TLS** is offered for a plain-SMTP relay on the same
  host. Over a network it sends the mailbox password in the clear.

## Repository layout

```
backend/           NestJS API + poller + send worker (Prisma + Postgres, BullMQ + Redis)
frontend/          Next.js admin UI
packages/shared/   TypeScript contracts both sides import (@tmx-scheduler/shared)
docs/              This page, the deployment guide, screenshots
docker-compose.yml Postgres, Redis and Mailpit for local work
backend/Dockerfile Production image; backend/docker-compose*.yml run it
.github/workflows/ ci.yml checks every push and PR; deploy.yml ships main
```

`backend` and `frontend` import `@tmx-scheduler/shared` through its compiled
`dist/`, so `pnpm build` runs shared → backend → frontend in that order, and
editing `packages/shared` means rebuilding it
(`pnpm --filter @tmx-scheduler/shared dev` watches).
