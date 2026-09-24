# Security policy

TMX Scheduler stores mailbox credentials and sends mail on your behalf, so we
take reports seriously and would rather hear about a false alarm than miss a
real one.

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest `0.x` release | Yes |
| Anything older | No — please upgrade first |

## Reporting a vulnerability

**Please do not open a public issue.**

Report it privately through GitHub's advisory form:
<https://github.com/TokenMinds-co/tmx-scheduler/security/advisories/new>.
If you cannot use that, email <tech@tokenminds.co> with "TMX Scheduler
security" in the subject.

Include what you can of:

- the version — the `version` field from `GET /health`, or the release tag;
- how it is deployed (the Docker image, from source, something else);
- steps to reproduce, or the request and response that demonstrates it;
- what an attacker gains.

## What to expect

- Acknowledgement within **3 business days**.
- An initial assessment within **7 days**: confirmed, not reproducible, or
  by design (with reasoning).
- A fix within **30 days** for anything rated high or critical, **90 days**
  otherwise. We will tell you if that slips and why.
- Coordinated disclosure: we publish an advisory and a release together, and
  credit you in it unless you ask otherwise. There is no bug bounty.

## Out of scope / by design

- **Require TLS off.** Disabling it is offered for a plain-SMTP relay on the
  same host and documented as sending the password in the clear elsewhere.
- **Session token in `localStorage`.** A deliberate trade-off — see the
  Security section of the README. A report needs to show a way to run script
  on the admin origin, not that the token is readable once you can.
- **Rate limits and lockouts** on the login endpoint are basic. Proposals are
  welcome as ordinary issues.
- **Self-hosting mistakes** — a database published to the internet, a
  `CREDS_KEY` committed to git, a reverse proxy that strips nothing — are the
  operator's, though we will happily improve a doc that led someone there.
