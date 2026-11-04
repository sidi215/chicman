# Chicman

A multi-vendor fashion marketplace for Mauritania, with web and mobile apps that share one backend.

## Repository structure

```text
chicman/
├── apps/
│   ├── api/          # Node.js + Express + TypeScript REST API
│   ├── web/          # Next.js storefront, seller dashboard, admin dashboard
│   └── mobile/       # Flutter app for customers and sellers
├── packages/
│   └── shared/       # Shared TypeScript definitions (web + API)
├── infrastructure/
│   └── docker/       # Local development services (Docker Compose)
└── context/          # Project documentation and feature specs
```

## Prerequisites

- Node.js 22+
- pnpm 10+ (`corepack enable` picks up the pinned version from `package.json`)
- Flutter SDK (Dart ^3.12)
- Docker with Docker Compose v2

## Local development

The TypeScript projects (`apps/api`, `apps/web`, `packages/shared`) form a pnpm workspace with a single root lockfile. The Flutter app is not part of the workspace and uses `pub`.

Install all TypeScript dependencies once, from the repository root:

```bash
pnpm install
```

Root scripts:

| Command | What it does |
|---|---|
| `pnpm dev:api` | Build `@chicman/shared`, then run the API in watch mode |
| `pnpm dev:web` | Build `@chicman/shared`, then run the web dev server |
| `pnpm build` | Build every package in dependency order |
| `pnpm typecheck` | Typecheck every package |
| `pnpm lint` | Lint every package that defines a lint script |

`@chicman/shared` compiles to `packages/shared/dist`. Rebuild it (`pnpm build:shared`) after changing it, or run `pnpm --filter @chicman/shared dev` for watch mode. Apps depend on it with `"@chicman/shared": "workspace:*"`.

### Infrastructure services

PostgreSQL, Redis, Meilisearch, and S3-compatible object storage (SeaweedFS):

```bash
cd infrastructure/docker
cp .env.example .env        # adjust ports/credentials if needed
docker compose up -d
```

| Service | Default port |
|---|---|
| PostgreSQL | 5432 |
| Redis | 6379 |
| Meilisearch | 7700 |
| S3 API (SeaweedFS) | 8333 |

If a port is already used on your machine, change it in `infrastructure/docker/.env`.

Authentication uses hosted Supabase Auth, so it is not part of the local stack.

### API

```bash
cp apps/api/.env.example apps/api/.env
pnpm dev:api                # http://localhost:4000/api/v1/health
```

App-level scripts: `pnpm --filter @chicman/api <build|start|typecheck>`.

### Web

```bash
pnpm dev:web                # http://localhost:3000
```

App-level scripts: `pnpm --filter @chicman/web <build|start|lint|typecheck>`.

### Mobile

```bash
cd apps/mobile
flutter pub get
flutter run
```

## Documentation

Product, architecture, standards, and feature specs live in [`context/`](context/). Read `CLAUDE.md` for the reading order.
