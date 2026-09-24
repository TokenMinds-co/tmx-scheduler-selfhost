# Backend image for TMX Scheduler (the `backend` workspace package).
#
# The build context is the WORKSPACE ROOT, not this directory — the install
# needs pnpm-lock.yaml, pnpm-workspace.yaml and packages/shared:
#
#   docker build -f backend/Dockerfile -t tmx-scheduler-backend .

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:25-alpine AS builder

# corepack reads `packageManager` from the root package.json, so the image
# installs with exactly the pnpm the lockfile was written by.
RUN corepack enable pnpm

WORKDIR /app

# Manifests first, so the install layer is cached until a dependency changes.
# The frontend manifest is here only so pnpm can resolve the workspace graph;
# --filter keeps its dependencies from being installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/shared/package.json packages/shared/

# The backend's postinstall runs `prisma generate`, which needs the schema to
# exist before `pnpm install` — so it is copied ahead of the install, not with
# the rest of the source.
COPY backend/prisma backend/prisma

# The 60s default fetch timeout is not enough here: both stages install at
# once, and a timed-out fetch fails the whole build instead of retrying.
RUN pnpm config set store-dir /tmp/.pnpm-store && \
    pnpm config set fetch-timeout 600000 && \
    pnpm install --frozen-lockfile --prefer-offline --filter backend...

COPY packages/shared packages/shared
COPY backend backend

# @tmx-scheduler/shared has to be compiled before the backend — its imports resolve to
# dist/index.d.ts, which does not exist until then. The backend's own build
# script runs `prisma generate` again before `nest build`.
RUN pnpm --filter @tmx-scheduler/shared build && \
    pnpm --filter backend build

# ---------------------------------------------------------------------------
# Production stage
# ---------------------------------------------------------------------------
FROM node:25-alpine AS production

RUN corepack enable pnpm

WORKDIR /app

# Short commit SHA, passed by the CI build and reported by GET /health. The
# deploy job compares it against the tag it just pulled, so a deploy that
# silently kept the old container cannot report success.
ARG COMMIT_SHA=dev
ENV COMMIT_SHA=$COMMIT_SHA
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/shared/package.json packages/shared/
COPY backend/prisma backend/prisma

# Production dependencies only. No --ignore-scripts: the backend's postinstall
# is what generates the Prisma client, prisma's own postinstall is what fetches
# the query engine, and `allowBuilds` in pnpm-workspace.yaml already limits
# which packages may run one. `prisma` is a runtime dependency on purpose —
# the CMD below runs `migrate deploy` with it.
#
# The store, pnpm's tarball cache and Prisma's engine download cache are
# dropped in the same layer: node_modules already holds everything they
# contain, and together they are ~600 MB. /root/.cache/node stays — that is
# corepack's copy of pnpm, which the CMD needs.
RUN pnpm config set store-dir /tmp/.pnpm-store && \
    pnpm config set fetch-timeout 600000 && \
    pnpm install --frozen-lockfile --prefer-offline --prod --filter backend... && \
    rm -rf /tmp/.pnpm-store /root/.cache/pnpm /root/.cache/prisma

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/backend/dist backend/dist

# The app reads PORT (default 4000). The compose files pin it to 4000 inside
# the container and treat PORT in .env as the host port.
EXPOSE 4000

# Apply pending migrations, then start. A container that cannot migrate never
# serves. `exec` hands PID 1 to Nest so `docker stop` reaches
# enableShutdownHooks() — the poller stops and SMTP pools drain instead of a
# send being dropped mid-flight.
CMD ["sh", "-c", "pnpm --filter backend exec prisma migrate deploy && exec node backend/dist/main.js"]
