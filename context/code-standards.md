# Code Standards

## General
- Write clean, readable, and maintainable code.
- Keep functions and components small and focused.
- Follow a consistent naming and formatting convention.
- Avoid code duplication.
- Separate responsibilities between the frontend, backend, and database.
- Use environment variables for configuration and sensitive information.
- Handle errors clearly and consistently.

## TypeScript
- Use TypeScript for the Next.js web application and Node.js backend.
- Enable strict type checking.
- Avoid using `any`; define proper types and interfaces.
- Use clear and consistent naming for variables, functions, and types.
- Validate external data before using it.
- Keep shared types and API contracts consistent.

## Framework
- **Next.js:** Use the App Router and reusable components. Keep business logic outside UI components.
- **Flutter:** Use a feature-based structure and reusable widgets. Follow Material 3 with the project's customized design system.
- **Node.js + Express:** Organize the backend into modules. Keep controllers focused on handling requests and services responsible for business logic.
- Use Riverpod for Flutter state management.
- Use Prisma as the ORM for database operations.

## Styling
- Follow the project's design system across web and mobile.
- Use shared design tokens for colors, typography, spacing, and border radius. Define or change values only in `packages/design-tokens/src/tokens.ts`, then run `pnpm tokens`. Never edit `*.generated.*` / `*.g.dart` files or duplicate token values in app code.
- Use Tailwind CSS and shadcn/ui for the web application.
- Use Flutter themes and Material 3 components for the mobile application.
- Avoid hardcoded colors and inconsistent styles.
- Support responsive layouts and both French (LTR) and Arabic (RTL) interfaces.

## API Routes
- Use REST API conventions.
- Prefix API routes with `/api/v1`.
- Keep route handlers simple and move business logic into services.
- Validate request parameters, query strings, and request bodies.
- Use consistent response formats and HTTP status codes.
- Verify Supabase authentication tokens on protected routes.
- Check user roles and resource ownership before allowing access.
- Handle errors through centralized error middleware.

## Testing
- API: `node:test` run with `tsx`, in `apps/api/test/`. Tests that need PostgreSQL use `TEST_DATABASE_URL` (a separate database) and are skipped without it. Auth tests use a local JWKS server and test key pairs, never a real Supabase project. Rate-limit integration tests also need `REDIS_URL` and use their own Redis key prefix. Object-storage integration tests need `TEST_S3_ENDPOINT` (with `TEST_S3_ACCESS_KEY_ID` and `TEST_S3_SECRET_ACCESS_KEY`), create and delete their own buckets, and are skipped without it; other storage tests use an in-memory fake with failure injection. Never print secrets, tokens, or connection URLs in test output.
- Web: `node:test` for logic kept outside components (`*.test.ts`).
- Mobile: `flutter test`, with fake repositories and `http`'s `MockClient` for API calls.
- Never run `dart format` over generated files (`*.g.dart`); restore them with `pnpm tokens`.

## Logging and Errors
- Error responses carry only a stable error code (`{ "error": { "code": "…" } }`), never messages, stack traces, or database details.
- Log error types, codes, and stack frames, never error messages that can quote data, request bodies, headers, tokens, credentials, connection URLs, or personal data.
- Do not swallow failures silently: a degraded path (fallback, `503`) logs its reason.

## Data and Storage
- Use PostgreSQL as the primary database.
- Use Prisma for database access and migrations. The Prisma Client is generated into `apps/api/src/generated/` and is not committed.
- Use Supabase Auth for user authentication.
- Use S3-compatible storage for product images and uploaded files.
- Use Redis for caching and background jobs.
- Use Meilisearch for product search.
- Store money using appropriate decimal types, never floating-point values.
- Store timestamps in UTC.
- Keep PostgreSQL as the main source of truth.

## File Organization
- Organize the project by application and feature.
- Keep shared code in dedicated packages.
- Separate UI components, business logic, data access, and configuration.

```text
project/
├── apps/
│   ├── web/                 # Next.js application
│   ├── mobile/              # Flutter application
│   └── api/                 # Node.js + Express backend
│
├── packages/
│   ├── shared/              # Shared types and utilities
│   └── design-tokens/       # Design token source + platform generators
│
├── infrastructure/          # Docker and deployment configuration
│
└── docs/                    # Project documentation
```

- Keep each application's files organized by feature and responsibility.
