# Development image of the Chicman API workspace (apps/api).
# Build context: the repository root, e.g.
#   docker compose -f infrastructure/docker/docker-compose.yml build worker
# Used by the `worker` service; it can also run the API (`pnpm --filter @chicman/api dev`).
# No .env file is copied (see /.dockerignore): configuration comes from the
# Compose `environment` block.
FROM node:22.22.1-alpine3.23

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=development \
    TZ=UTC
# pnpm is fetched at build time into a cache readable by the `node` user, so a
# container start or restart never needs the network.
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate && chmod -R a+rX /opt/corepack

WORKDIR /app

# Dependency layer: only the manifests the API needs, so source edits do not reinstall.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @chicman/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @chicman/shared build && pnpm --filter @chicman/api db:generate

# Run as the unprivileged `node` user; the worker regenerates the Prisma Client at start.
RUN chown -R node:node /app/apps/api/src/generated
USER node

CMD ["pnpm", "--filter", "@chicman/api", "worker"]
