# Contributing

Thanks for looking. Bug reports, fixes, docs and features are all welcome;
this page is what you need to get a change from your editor to `main`.

## Setup

You need Node 22 (`.nvmrc`; `nvm use` picks it up), pnpm (`corepack enable`
installs the version pinned in `package.json`) and Docker.

```bash
git clone https://github.com/TokenMinds-co/tmx-scheduler.git && cd tmx-scheduler
pnpm install
pnpm setup                                   # env files with fresh secrets; prints the admin password
pnpm infra:up                                # Postgres, Redis, Mailpit
pnpm --filter @tmx-scheduler/shared build
pnpm --filter backend db:migrate
pnpm dev
```

Everything sent in development lands in Mailpit at <http://localhost:8025>;
nothing leaves the machine.

**The one gotcha:** `backend` and `frontend` import `@tmx-scheduler/shared`
through its compiled `dist/`. After editing anything in `packages/shared`,
rebuild it — or run `pnpm --filter @tmx-scheduler/shared dev` in a second
terminal to have it rebuild on save. A stale `dist/` shows up as a type error
that makes no sense.

## Scripts

| Command                                                | What it does                                |
| ------------------------------------------------------ | ------------------------------------------- |
| `pnpm dev`                                             | API on :4000 and UI on :3000, both watching |
| `pnpm test`                                            | Backend unit tests (Jest)                   |
| `pnpm typecheck`                                       | `tsc --noEmit` in every package             |
| `pnpm lint` / `pnpm lint:fix`                          | ESLint                                      |
| `pnpm format` / `pnpm format:check`                    | Prettier                                    |
| `pnpm build`                                           | shared → backend → frontend                 |
| `pnpm --filter backend db:migrate --name <snake_case>` | Create a migration from schema changes      |
| `pnpm --filter backend db:studio`                      | Browse the local database                   |

CI runs `typecheck`, `lint`, `format:check`, `test` and `build`, so running
them locally first saves a round trip.

## Making a change

1. Branch from `main`.
2. Keep the pull request to one concern. A rename and a behaviour change are
   two PRs.
3. If you change `backend/prisma/schema.prisma`, run `db:migrate --name …`
   and commit the generated folder under `backend/prisma/migrations/`. CI
   applies every migration to an empty database and fails if the result
   differs from the schema.
4. Add or update a test where there is something to assert. The backend tests
   are pure unit tests — no database, no Redis — and live beside the code as
   `*.spec.ts`. There are no frontend tests yet; a PR that starts them is
   welcome.
5. Update the README if you change behaviour someone would read about there,
   and add a line under `[Unreleased]` in `CHANGELOG.md`.
6. Open the PR against `main`. The template asks how you tested it. PRs are
   squash-merged, so the PR title becomes the commit message — write it as
   one.

## Conventions

- **Comments explain why, not what.** The codebase leans on this: a claim that
  is atomic on purpose, a rule that rejects instead of guesses, a vocabulary
  two files must share. When you make a choice that a reader could reasonably
  make differently, say why you made it.
- **Prettier decides formatting; ESLint decides the rest.** Both run in CI.
  `pnpm format` before committing keeps the diff to what you meant.
- **Do not rename the `ims_*` / `data-ims-*` identifiers.** `ims` is the
  project's old internal name. It survives in the BullMQ prefix, the session
  cookie, two localStorage keys and the attributes stored inside every
  signature; renaming any of them signs users out or strands their data.
- **Secrets never reach the API response**, and never the audit log. The UI
  only learns whether a secret exists.
- **User-facing copy is plain English**, sentence case, no exclamation marks.

## Reporting bugs and proposing features

Use the issue templates. For a bug, the version from `GET /health` (or the
release tag) and how you deployed it are the two things that most often
decide whether it can be reproduced. For a security problem, **do not open an
issue** — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the
project's [MIT license](LICENSE). There is no CLA.
