# syntax=docker/dockerfile:1
#
# Multi-stage build for @anvil/server. Build context is the REPO ROOT
# (needs the lockfile + packages/sdk), not this directory:
#   docker build -f apps/server/Dockerfile .

# ---- build: install the workspace, build SDK + server, then produce a
#      self-contained production tree via `pnpm deploy`.
FROM node:26.5.0-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9 --activate

# Manifests first so `pnpm install` is cached across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

# Sources, then build only what the server needs and deploy prod deps.
COPY packages/sdk packages/sdk
COPY apps/server apps/server
RUN pnpm --filter @ykstormsorg/anvil --filter @anvil/server build
RUN pnpm --filter @anvil/server deploy --prod /app

# ---- runtime: minimal, non-root.
FROM node:26.5.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
