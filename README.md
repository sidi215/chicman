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
│   ├── shared/       # Shared TypeScript definitions (web + API)
│   └── design-tokens/ # Design token source; generates web + Flutter themes
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

The TypeScript projects (`apps/api`, `apps/web`, `packages/shared`, `packages/design-tokens`) form a pnpm workspace with a single root lockfile. The Flutter app is not part of the workspace and uses `pub`.

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
| `pnpm tokens` | Regenerate web and Flutter theme files from `packages/design-tokens` |
| `pnpm tokens:check` | Fail if generated design-token files are out of date (also part of `pnpm typecheck`) |

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

Supabase Auth is not part of this Docker stack. Hosted Supabase projects serve the shared environments. For local auth development, use the Supabase CLI (`supabase start`; `supabase/config.toml` is not created yet). It runs Auth locally with the Inbucket email catcher (default `http://127.0.0.1:54324`), so confirmation and password-recovery emails can be opened there without sending real email. A hosted project cannot deliver email to the local Inbucket. Setup, local URLs, and required settings: `context/feature-specs/03-authentication.md`, Email Testing and Delivery. Hosted projects: `node supabase/apply-auth-config.mjs` (dry run; `--apply` to change) applies the Auth settings and the email templates in `supabase/templates/` through the Management API (needs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SITE_URL`).

### API

```bash
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL and the SUPABASE_* values
pnpm --filter @chicman/api db:migrate    # apply Prisma migrations
pnpm dev:api                # http://localhost:4000/api/v1/health
```

The API refuses to start if a required value is missing (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_PUBLISHABLE_KEY`). Rate-limit counters use Redis (`REDIS_URL`, required in production; without it, development uses in-memory counters). The API needs no Supabase secret key. The Supabase project must use asymmetric JWT signing keys and email + password auth with "Confirm email" enabled (see `context/feature-specs/03-authentication.md`, Supabase Project Configuration). Secret keys never go in a client `.env`.

Tests (`pnpm --filter @chicman/api test`) use a local JWKS server and need no Supabase project. The database tests also need a separate PostgreSQL database, set as `TEST_DATABASE_URL`, and the rate-limit integration tests also need `REDIS_URL` (they use their own Redis key namespace); each is skipped without its variable. Prepare it once:

```bash
DATABASE_URL=<TEST_DATABASE_URL> pnpm --filter @chicman/api db:deploy
```

Background worker (12-month retention of the phone change history, once at start and then every 24 hours): it runs persistently as the `worker` service of `infrastructure/docker/docker-compose.yml` (`docker compose up -d worker`, logs with `docker compose logs -t worker`). Only one instance does the work, enforced by a PostgreSQL advisory lock. To run it on the host instead: `pnpm --filter @chicman/api worker`.

App-level scripts: `pnpm --filter @chicman/api <build|start|typecheck|test|worker|db:generate|db:migrate|db:deploy>`. The Prisma Client is generated into `src/generated/` (not committed) by `build`, `dev`, `typecheck`, and `test`.

### Web

```bash
cp apps/web/.env.example apps/web/.env.local   # Supabase URL + publishable key, API URL, site URL, Turnstile site key
pnpm dev:web                # http://localhost:3000 (/login, /register, /forgot-password, /auth/callback, /account)
```

App-level scripts: `pnpm --filter @chicman/web <build|start|lint|typecheck|test>`.

### Mobile

```bash
cd apps/mobile
flutter pub get
flutter run \
  --dart-define=SUPABASE_URL=https://<project-ref>.supabase.co \
  --dart-define=SUPABASE_PUBLISHABLE_KEY=<publishable-key> \
  --dart-define=API_BASE_URL=http://10.0.2.2:4000 \
  --dart-define=SITE_URL=http://localhost:3000 \
  --dart-define=TURNSTILE_SITE_KEY=<public site key>
```

`API_BASE_URL=http://10.0.2.2:4000` reaches the host API from the Android emulator. `SITE_URL` is the email-callback base and the App Links host. `TURNSTILE_SITE_KEY` is optional (empty disables Turnstile). The same values can be kept in `apps/mobile/.env` (git-ignored, public values only) and passed with `flutter run --dart-define-from-file=.env --dart-define=API_BASE_URL=http://10.0.2.2:4000 --dart-define=SITE_URL=http://localhost:3000`. The session is stored in platform secure storage (Android Keystore, iOS Keychain). On iOS, set the `APP_LINK_HOST` build setting for Universal Links.

Without the Supabase values the app still launches and shows that authentication is not configured.

## Documentation

Product, architecture, standards, and feature specs live in [`context/`](context/). Read `CLAUDE.md` for the reading order.
