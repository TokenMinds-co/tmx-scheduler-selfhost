# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-24

First public release.

### Added

- Spreadsheet import with a dry run, per-row timezone parsing that rejects an
  unrecognised zone rather than guessing, and duplicate detection keyed on
  everything but the send time.
- Several sending mailboxes (SMTP password or OAuth2 for Google and
  Microsoft), each with a daily limit, a warm-up default, and a minimum gap
  between sends — enforced by one atomic SQL claim per send.
- Two-stage queue: Postgres holds the schedule, Redis (BullMQ) holds only what
  is due now; a reaper returns claims orphaned by a crash.
- Retries with backoff and jitter recorded on the queue row; hard bounces
  suppress the address and cancel its remaining mail.
- One-click unsubscribe with RFC 8058 `List-Unsubscribe` headers.
- Open and click tracking with scanner filtering, judged at read time from
  stored evidence.
- Signature builder producing Outlook-safe HTML and an authored plain-text
  half; pasted HTML is sanitised server-side.
- Guided mailbox setup that reads the domain's MX and SPF records.
- Batches with per-batch delivery and engagement stats.
- Append-only audit log; secrets encrypted at rest with AES-256-GCM.
- Docker image for the backend; Docker Compose for local Postgres, Redis and
  Mailpit; GitHub Actions CI and a gated deploy workflow.

[Unreleased]: https://github.com/TokenMinds-co/tmx-scheduler/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TokenMinds-co/tmx-scheduler/releases/tag/v0.1.0
