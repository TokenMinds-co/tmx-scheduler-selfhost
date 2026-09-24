# Deployment

The backend is one Docker image; Postgres and Redis are whatever you already
run. The frontend is a standard Next.js app. This page covers all three, then
the GitHub Actions pipeline the main repository deploys itself with.

## The backend image

[`backend/Dockerfile`](../backend/Dockerfile) builds from the **workspace
root**, not from `backend/` — the install needs `pnpm-lock.yaml`,
`pnpm-workspace.yaml` and `packages/shared`:

```bash
docker build -f backend/Dockerfile -t tmx-scheduler-backend .
```

Builder stage installs and compiles; production stage reinstalls with `--prod`
and copies `dist/` across. Worth knowing:

- `--filter backend...` (trailing dots included) selects the backend and its
  workspace dependencies, so the frontend's Next/React tree is never installed.
  Its `package.json` still has to be copied in, or pnpm cannot resolve the
  workspace graph.
- `backend/prisma` is copied **before** `pnpm install` in both stages, because
  the backend's `postinstall` runs `prisma generate` and needs the schema.
- `prisma` is a runtime dependency, not a dev one: the image's `CMD` runs
  `prisma migrate deploy` and then `exec`s Nest, so a container that cannot
  migrate never serves. Right for one replica; at several, move the migrate to
  a one-shot job.
- pnpm comes from corepack, which reads `packageManager` in the root
  `package.json` — the same version CI and developers use.
- `COMMIT_SHA` is a build argument that `GET /health` reports as `version`.
  The pipeline below uses it to prove a deploy actually replaced the container.

Pre-built images are published to `ghcr.io/tokenminds-co/tmx-scheduler-backend`:
`<short-sha>` for every commit on `main`, `production-latest` for the newest of
those, and `vX.Y.Z` for tagged releases.

### Ports

The app reads `PORT` (default 4000). Both compose files pin it to **4000 inside
the container** and treat `PORT` in `backend/.env` as the **host** port, which
is what `"127.0.0.1:${PORT:-4000}:4000"` reads. Loopback only: a reverse proxy
on the host is what serves it (`main.ts` trusts exactly one proxy hop).

### Health

`GET /health` answers 200 `{"status":"ok","version":"<sha>",…}` once migrations
have run and Postgres is reachable, and **503** until then. The compose
healthcheck only reads the status line, so this is what makes it a real check
rather than one nothing could fail.

## Running the image

### Locally, to check the image

```bash
pnpm infra:up                                        # Postgres and Redis from the root compose file
docker compose -f backend/docker-compose.yml up --build
```

[`backend/docker-compose.yml`](../backend/docker-compose.yml) builds from
source and runs against the root compose file's Postgres and Redis through
`host.docker.internal`, because inside a container "localhost" is the
container. Use it to check the container, the migration step and the health
probe; day-to-day development runs the app on the host.

### On a server

[`backend/docker-compose-production.yml`](../backend/docker-compose-production.yml)
pulls the image instead of building, and defines **one service**. Postgres and
Redis are expected to be the server's own containers: they outlive any deploy
and are never restarted when the API is replaced. The backend only joins their
networks, both declared `external` so Compose refuses to start rather than
quietly bringing up an API that can reach neither. Addresses come from
`DATABASE_URL` and `REDIS_URL` in `.env`, where they name those containers.

One-time setup:

```bash
git clone https://github.com/TokenMinds-co/tmx-scheduler.git
cp tmx-scheduler/backend/.env.example tmx-scheduler/backend/.env
# fill in: DATABASE_URL and REDIS_URL (by container name), CREDS_KEY,
# JWT_SECRET, UNSUBSCRIBE_SECRET, TRACKING_SECRET, PUBLIC_API_URL,
# TRACKING_BASE_URL, CORS_ORIGINS, SEED_ADMIN_*

# Both networks must exist and have the shared container attached:
docker network create postgres_network && docker network connect postgres_network <postgres container>
docker network create redis_network    && docker network connect redis_network <redis container>

cd tmx-scheduler
IMAGE_TAG=production-latest docker compose -f backend/docker-compose-production.yml up -d
```

Put a reverse proxy (Caddy, nginx, Traefik) in front of `127.0.0.1:4000` with
TLS. `PUBLIC_API_URL` and `TRACKING_BASE_URL` are what recipients see in
unsubscribe and tracking links, so they must be the public hostnames.

If you run Postgres and Redis some other way — managed services, a different
compose project — drop the `networks:` blocks from the compose file and point
`DATABASE_URL` / `REDIS_URL` wherever they live. Nothing in the image assumes
the container names.

## The frontend

The admin UI is a Next.js 15 app in `frontend/`. `NEXT_PUBLIC_API_URL` is read
at **build time** and baked into the browser bundle, so build it with the
production API URL:

```bash
pnpm install --frozen-lockfile
pnpm --filter @tmx-scheduler/shared build
NEXT_PUBLIC_API_URL=https://api.example.com/api pnpm --filter frontend build
pnpm --filter frontend start          # serves on :3000; put it behind the same reverse proxy
```

The API must list the UI's origin in `CORS_ORIGINS`.

On Vercel or a similar host: root directory `frontend`, install command
`pnpm install`, build command
`pnpm --filter @tmx-scheduler/shared build && pnpm --filter frontend build`,
and `NEXT_PUBLIC_API_URL` as an environment variable.

A frontend Docker image is not provided yet; the issue tracking it is linked
from the README roadmap.

## The pipeline

Two workflows in `.github/workflows/`:

| Workflow     | Runs on                                                    | Does                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`     | every push and pull request, any fork                      | install → build shared → typecheck → lint → format check → unit tests → build both apps; applies every migration to an empty Postgres and fails on schema drift; scans history with gitleaks; builds the backend image without pushing |
| `deploy.yml` | push to `main` touching backend paths, or **Run workflow** | builds the image, pushes it to GHCR tagged `<short-sha>` and `production-latest`, then deploys it over SSH and verifies                                                                                                                |

`deploy.yml` is guarded with `if: github.repository == 'TokenMinds-co/tmx-scheduler'`,
so on a fork it is a no-op rather than a red run. To use it for your own
server: change that guard to your repository, add the three secrets below, do
the one-time server setup above, and make sure the server's clone of the repo
can `git fetch` (a public repo needs nothing; a private one needs a deploy
key).

| Secret             | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `VPS_STAGING_HOST` | Hostname or IP the workflow SSHes to                              |
| `VPS_STAGING_USER` | Login user; must be able to run `docker`                          |
| `VPS_STAGING_KEY`  | Private key whose public half is in that user's `authorized_keys` |

`GITHUB_TOKEN` handles GHCR on both ends.

Each deploy checks the server's clone out at the deployed commit (only the
compose file and `.env` are read from it — the app comes from the image),
pulls the `<short-sha>` tag, runs `docker compose up -d`, then polls
`GET /health` from inside the container until it answers 200 and reports the
same `version` as the tag it pulled — so a deploy that silently kept the old
container fails loudly. Old image tags are removed afterwards so they do not
fill the disk.

Backend paths are `backend/**`, `packages/shared/**`, the root manifests and
lockfile, `.dockerignore` and the workflow itself. A frontend-only or docs-only
push does not spend a deploy; **Run workflow** redeploys the current `main`
without a commit.
