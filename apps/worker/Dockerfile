# syntax=docker/dockerfile:1
#
# Multi-stage build for @anvil/worker. Build context is the REPO ROOT
# (needs the lockfile + packages/sdk), not this directory:
#   docker build -f apps/worker/Dockerfile .

# ---- build: install the workspace, build SDK + worker, then produce a
#      self-contained production tree via `pnpm deploy`.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Manifests first so `pnpm install` is cached across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile

# Sources, then build only what the worker needs and deploy prod deps.
COPY packages/sdk packages/sdk
COPY apps/worker apps/worker
RUN pnpm --filter @ykstormsorg/anvil --filter @anvil/worker build
RUN pnpm --filter @anvil/worker deploy --prod /app

# ---- runtime: minimal, non-root. No port; the worker only talks to Redis.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
CMD ["node", "dist/index.js"]
