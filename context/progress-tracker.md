# Progress Tracker

## Current Phase

Feature 03 (Authentication) is in progress. Feature 04 (Customer Profile) is **implementation complete**; the first scheduled 24-hour worker run is pending manual verification by the project owner. Foundation (project setup, pnpm workspace, design system, shared tokens, theme selection, brand wordmark) is complete.

- **Authentication** is email + password with mandatory email confirmation; the phone is unverified contact information; no SMS. It is implemented on the API, web, and mobile.
- **Web:** verified end to end on the hosted development project (2026-11-05), including registration, confirmation, account setup, login, recovery, and reset.
- **Android:** authentication manually verified and complete by the project owner (2026-11-06).
- **CAPTCHA (Turnstile) is enabled** on the hosted project, by the project owner, and enforced (a login without a token → `captcha_failed`).
- **Security verification executed (2026-11-06):** callback link attacks, rate limits with Redis and the in-memory fallback, safe error logging, `503` for database outages, and anti-enumeration (unregistered address).
- **Still open:** the registered-address anti-enumeration checks, the email-check scaling decision, the database password rotation, and all domain-dependent work (SMTP, branded templates, App Links / Universal Links, iOS).
- **Feature 04: implementation complete (2026-11-07).** Backend, web, and mobile are done. The profile settings screens were verified live (web signed in, Android) by the project owner on 2026-11-07. The retention worker runs persistently as the Compose `worker` service; its first scheduled 24-hour run (due 2026-11-08T13:49:27Z, after the 2026-11-07 reboot reset the clock) is **pending**; the project owner will verify it manually.
- Development uses Supabase's default email provider (team addresses only) until a domain exists.

### Authentication verification summary

| Category | Items |
|---|---|
| Implemented and tested | Web live flow; Android authentication (manually verified by the project owner); callback attack cases; Turnstile on web (real key, `localhost`); CAPTCHA enforcement (login without a token); API rate limits, Redis fallback, and recovery; safe logging; database outage → `503`; anti-enumeration (unregistered); token verification and JWKS hardening; authorization; client unit and widget tests; no secrets in client bundles |
| Implemented, not manually verified | Registered-address anti-enumeration; CAPTCHA on sign-up and recovery without a token; Turnstile failure and retry states; real expired emails; cross-device confirmation; unconfirmed-email login; the retention worker schedule |
| Not implemented | Local Supabase CLI setup; the production email-check approach (decision pending) |
| Deferred (domain or production infrastructure) | Production Site URL and allowlist; Resend SMTP with SPF/DKIM/DMARC; branded templates; external-recipient email; Android App Links and iOS Universal Links; iOS build and testing; production CSP origins and HSTS |

Details: `feature-specs/03-authentication.md` (Verification Status) and `feature-specs/04-customer-profile.md` (Implementation Notes, Status).

## Feature Status

| # | Feature | Spec | Status |
|---|---|---|---|
| 01 | Project Setup | `feature-specs/01-project-setup.md` | Completed |
| — | Adopt pnpm Workspaces | No spec — scope from Decisions | Completed |
| 02 | Design System | `feature-specs/02-design-system.md` | Completed |
| — | Design System decisions: shared tokens + theme selection | No spec — scope from Decisions | Completed |
| 03 | Authentication | `feature-specs/03-authentication.md` | In Progress (web verified end to end; Android manually verified by the project owner; CAPTCHA enabled by the project owner and enforced; security checks executed; remaining manual checks, database password rotation, and domain-dependent work pending) |
| 04 | Customer Profile | `feature-specs/04-customer-profile.md` | Implementation Complete (first scheduled 24-hour worker run pending manual verification by the project owner) |
| 06 | Shop Management | `feature-specs/06-shop-management.md` | Not Started (spec decisions resolved, no open questions; nothing implemented) |

## Completed Work

### CodeRabbit review findings resolved (2026-11-07)

Each finding was checked against the code first. Findings that the code already met got regression tests; documentation was changed only where it was wrong or incomplete.

- **Theme fallback (web):** already fixed by the in-memory `sessionPreference` (current-issues 3). Added tests for `window.localStorage` unavailable (a getter that throws, or no storage at all): light, dark, and system selection; the selector and the applied theme agree; OS changes after an explicit choice are ignored. No code change.
- **SELLER transitions:** already consistent; reinstatement never grants `SELLER` anywhere. Made explicit in `architecture.md`, spec 03, and the decisions here that resubmission (`REJECTED` → `PENDING`) grants no role.
- **Token verification and 401/403/503 contract:** already implemented (`token-verifier.ts`, `jwks-key-store.ts`) and documented in spec 03, which matches the code. No change.
- **Seller approval:** `requireApprovedSeller` (SELLER + owned shop + `APPROVED`, loaded server-side) and its tests already exist. Added the onboarding acceptance cases to spec 03 as pending spec 06 (no onboarding routes exist yet).
- **JWKS refresh:**
  - Already bounded: our own store, not jose's `createRemoteJWKSet`, with timeout, single flight, cooldown and backoff, a negative cache, and rotation.
  - Added a test: 50 concurrent distinct unknown `kid`s → one JWKS request, all `401`, repeats served from the negative cache.
  - **Fixed:** a failed refresh logged the raw error message (for example `fetch failed`). It now logs a fixed reason only (`network error`, `timeout`, `http status N`, `invalid response`), with a test.
- **One-profile invariant:** already enforced (`User.supabaseUserId` and `CustomerProfile.userId` unique; atomic idempotent bootstrap with bounded `P2002` retry). Existing PostgreSQL tests cover normal, repeated, concurrent, and retried creation. No change.
- **Spec 06 (specification only; no shop application or logo code exists yet):**
  - **Rejection:** the transitions table wrongly required an internal reason for `PENDING` → `REJECTED`; it now requires `applicantReason` only, matching the decision table, validation rules, and endpoint.
  - **Logo commit order:** the previous `ACTIVE` object is released before the new one is activated (the partial unique index is checked per statement), with the fenced upload completion first.
  - **Stale attempts:** every attempt write is fenced (`status = 'PROCESSING' AND attempt = $attempt`). A stale attempt never resets or regresses the upload or touches the newer logo; it cleans up only its own object and returns the current state. Database errors are told apart from a lost fence.
  - **Abandoned `PROCESSING` uploads:** the cleanup job reclaims an expired lease: before `completeBy` → `PENDING` (`LEASE_EXPIRED`), after → `EXPIRED`, then the staging object is deleted.
  - New acceptance items cover these cases.
- **`tokens.ts`:** the shop-management comments listed under it do not apply. The file holds design tokens only, and its only "logo" mention is the brand-wordmark comment. No change.
- **Results:**
  - API: 108/108 against PostgreSQL and Redis (+2 JWKS tests; the error-logging assertion follows the new fixed reason).
  - Web: 55/55 (+4 theme tests).
  - Flutter: 78/78, `flutter analyze` clean.
  - Root `pnpm typecheck` (including `tokens:check`), web lint, the API build, and the web production build all pass; `git diff --check` is clean.
- **Pre-existing, not changed:** the root `pnpm lint` script (`pnpm -r lint`) fails with `Command "lint" not found`, because only `apps/web` defines `lint`; `pnpm -r run lint` works.

### 04: persistent retention worker (Docker Compose) and live profile checks (2026-11-07)

- **Live checks:** the project owner verified the web profile settings (signed in) and the Android profile settings screen.
- **Mechanism:** a new `worker` service in `infrastructure/docker/docker-compose.yml` runs `pnpm --filter @chicman/api worker`.
  - Image `chicman-api:dev`, from a new `apps/api/Dockerfile`; no API image existed before. New root `.dockerignore` keeps env files and other apps out of the image.
  - `init: true`, `restart: unless-stopped`, `depends_on` Postgres `service_healthy` (with `restart: true`), and `container_name: chicman-worker`, so only one container can exist.
  - `DATABASE_URL` is built from the `postgres` service's `POSTGRES_*` variables.
  - Rotated `json-file` logs. No queue or scheduler platform was added.
- **Worker changes:**
  - `retention-schedule.ts`: start run plus a 24-hour interval (unchanged), no overlapping runs, and a stop that waits for an in-flight run.
  - `advisory-lock.ts`: a PostgreSQL advisory lock; a second process skips its runs.
  - Run lines now carry the run number, deleted count, and next run time.
  - Failure logs no longer print error messages: `describeError` moved to `lib/describe-error.ts` and is re-exported by the error handler.
- **Verified:**
  - Initial run succeeded against `postgres:5432/chicman`; the worker stays up afterwards.
  - Graceful SIGTERM stop: exit 0 in 0.4 s.
  - Stop/start/restart: each leaves one container, one process, and one lock holder.
  - `--scale worker=2` refused; a host-run worker skipped its run because of the lock.
  - SIGKILL crash → automatic restart.
  - Logs carry no secrets or phone numbers; Postgres and Redis were not recreated.
  - Details: spec 04, Retention Worker Scheduling.
- **Tests:** API 106/106 (+7: schedule and PostgreSQL lock); typecheck passes.
- **Not verified yet:** the first scheduled 24-hour run (originally due 2026-11-08T12:11:04Z; the machine reboot at 13:49 restarted the worker, so it is now due 2026-11-08T13:49:27Z). The reboot itself confirmed a graceful stop at shutdown and an automatic start at boot.
- **Local note:** this machine's Postgres and Redis were created with `POSTGRES_PORT=5442 REDIS_PORT=6389`. Pass the same values to `docker compose` commands, or they are recreated on the default ports.

### 04: profile settings screens and retention worker run (2026-11-06)

- **Web:** `/account/profile` (`apps/web/src/features/profile/`), linked from the account panel (which now also shows the name). It edits `fullName`, `preferredLocale` (Français / العربية), and the contact phone (labelled "non vérifié") through `PATCH /customers/me`. It has an Appearance section with the theme selector (device-local).
- **Mobile:** `ProfileSettingsScreen` (`apps/mobile/lib/features/profile/`), opened from the account screen. It has the same fields and handling and uses `ThemeModeSelector`. `CustomerAccount` now carries `preferredLocale`.
- **Behaviour (both):** only changed allowlisted fields are sent; an untouched form sends nothing. Client checks mirror the API. `400 INVALID_PHONE`, `401`, `403`/`404`, `429`, and `503` are handled (details in spec 04, Implementation Notes). `preferredLocale` is stored only; the UI language switches with the i18n feature.
- **Retention worker:** started against the local development database. The start-up run completed (0 rows older than 12 months), and it stays running on its 24-hour interval. There is no persistent scheduler yet.
- **Results:** web 51/51 (+13), typecheck and lint pass, `/account/profile` serves on the dev server; Flutter 78/78 (+17), `flutter analyze` clean.
- **Not verified:** a live signed-in web edit (the Chrome extension was not connected, and login needs Turnstile), the Android device check, and the 24-hour repeat run.

### Status confirmations and secret cleanup (2026-11-06)

- **Android:** authentication manually verified and complete by the project owner.
- **CAPTCHA:** enabled in the hosted Supabase project by the project owner (Turnstile).
- **Database password rotation:** not done; it stays outstanding.
- **Unused secrets removed from `apps/api/.env`:**
  - `SUPABASE_SECRET_KEY`: no code, config loader, script, Compose file, or template reads it; the API config schema ignores it.
  - `TURNSTILE_SECRET_KEY`: only `supabase/apply-auth-config.mjs` reads it, as an optional input passed when the script runs (it never reads `apps/api/.env`); the API never needs it, because Supabase validates tokens with the secret in its CAPTCHA settings.
  - Neither variable was in any `.env.example`, Docker Compose file, or other env file.
  - After removal, the API starts (health `ok`) and API tests pass 99/99.
  - No values were printed.

### API: temporary database outages return 503 (2026-11-06)

- **Classifier:** `apps/api/src/lib/database-errors.ts` decides from Prisma codes, driver-adapter kinds, and PostgreSQL SQLSTATEs observed with Prisma 7 + `@prisma/adapter-pg`. Unreachable, timeout, connection-closed, pool-exhausted, shutdown, and too-many-connections failures → `503 SERVICE_UNAVAILABLE` (logged as `Database unavailable (<code> <kind>)`).
- **Unchanged (500):** wrong credentials, missing database, query and constraint errors, and programming errors stay `500 INTERNAL_ERROR`. Bodies stay code-only, with no database details or credentials.
- **Tests:** API 99/99 (+3); the database-failure logging test now expects 503; a new test drives real division-by-zero, wrong-password, and missing-database errors → 500. Docs: spec 03, spec 04, and the shared error-code comment.

### Security verification: rate limits, error logging, anti-enumeration (2026-11-06)

- **Hosted Auth settings (read-only `--show`):** CAPTCHA **enabled** (Turnstile, by the user); emails 2/h; `rate_limit_verify` 30, `rate_limit_otp` 30, `rate_limit_token_refresh` 150. No settings were changed.
- **Rate limits (executed, real Redis and PostgreSQL):** account setup 10 per user and 60 per IP per 10 min; profile update 20 per user and 100 per IP per 10 min. `429` with a code-only body and `Retry-After`; window reset; refused requests write nothing; shared across two API instances; Redis outage → memory limits with one warning; recovery → Redis again; limiter failure → `503`. Supabase-owned limits (sign-up, login, recovery) were read, not flooded.
- **CAPTCHA enforcement (executed):** login without a token → `400 captcha_failed`.
- **Error logging (executed):** exception, database down, Redis down, Supabase Auth down, and JWKS 500 → generic client responses, diagnostic logs, no secrets or personal data. New failure logs for the email-confirmation check and JWKS refresh (they were silent before). `RedisRateLimiter` takes a key prefix (tests use their own namespace).
- **Anti-enumeration:** unregistered address, live through the UI → login `invalid_credentials` with the generic message; recovery `200 {}` with the generic message. Regression tests: the clients give identical outcomes for registered and unregistered addresses (login, recovery, sign-up). **Registered-address live comparison: pending (manual, controlled address).**
- **Results:** API 96/96 (+11: 6 integration, 5 logging), web 38/38 (+3), Flutter 61/61; typecheck (including `tokens:check`), lint, and build pass; `flutter analyze` is clean.

### Brand logo in the UI (2026-11-06)

- **Before:** the UI already used the design system (tokens for colours, type, spacing, radii), but the brand appeared as plain text ("Chicman"), and the home page `/` was still the Next.js starter (Next/Vercel logos, hard-coded `zinc` colours).
- **Wordmark master:** `packages/design-tokens/brand/chicman-wordmark.png`, made from `logo-chicman.jpeg` (transparent, cropped, 1224 × 278). It is copied to web and Flutter by `pnpm tokens`, and the copies and size are verified by `tokens:check`.
- **New tokens:** `brand-wordmark` (32 px), `brand-wordmark-lg` (48 px), `--brand-wordmark-url`/`--brand-wordmark-aspect`, and `AppBrand` (Dart).
- **Web:** `BrandLogo` (CSS mask in the current text colour, accessible label) on all auth screens; `/` is now a temporary branded page (wordmark, tagline, links to sign-up and login) using tokens only. The unused starter SVGs were removed from `public/`.
- **Flutter:** `BrandWordmark` (asset tinted with `onSurface`) in `AuthScaffold`; the asset is declared in `pubspec.yaml`.
- **Verified:**
  - Browser (dev server): the wordmark is 32 px tall on `/login` and 48 px on `/`, near-black in light and near-white in dark, labelled "Chicman"; Turnstile still works.
  - Automated: Flutter 61/61 (2 new wordmark tests), web 35/35, API 85/85; typecheck (including `tokens:check`), lint, and build pass; `flutter analyze` is clean.
- **Not done:** favicon and app icons still use the defaults (no square brand mark exists; the wordmark is too wide for an icon).

### Fix: `INTERNAL_ERROR` after a successful login (2026-11-06)

- **Cause:** `apps/api/.env` defined `DATABASE_URL` twice. dotenv used the last one, a Supabase pooler URL whose password contains unencoded `?!`. Every database query (`GET /auth/session`, `/customers/me`) failed with `ERR_INVALID_URL`, which the error handler returned as `500 INTERNAL_ERROR`. Login itself worked because it goes straight to Supabase. Reproduced with the API's own config loader; the same lookup succeeds against the local database.
- **Change:** the API now refuses to start when `DATABASE_URL` is not a valid `postgres://`/`postgresql://` URL (the message does not echo the value). At startup it warns about keys defined more than once in `.env` (key names only). Tests: 85/85 (+3 config tests).
- **User action:** keep one `DATABASE_URL` and one `TEST_DATABASE_URL` (local, port 5442) in `apps/api/.env`, then restart the API.

### 03: Turnstile readiness, CSP, link tests, secure mobile storage (2026-11-06)

- **Audit first.** Established: the web widget existed but no site key was configured. The mobile WebView loaded `<SITE_URL>/auth/turnstile`, which an emulator cannot reach at `localhost`. There was no site-wide CSP. The mobile session was in plaintext `shared_preferences`. API rate limiting failed open without Redis.
- **Turnstile:**
  - The existing widget's **site key** is now in `apps/web/.env.local` and `apps/mobile/.env`; the secret is in neither.
  - Web: loading, error, and retry states.
  - Mobile: a bundled widget document loaded with the `SITE_URL` origin as its base URL (hostname `localhost` in development), with loading, error, and retry states. The web page `/auth/turnstile` was removed.
  - All flows already passed `captchaToken` (sign-up, sign-in, recovery, resend) and reset it after each attempt.
  - A real token issued on `localhost` was checked once with Siteverify: success, hostname `localhost`, action `signup`.
  - **CAPTCHA was still disabled in Supabase at this point**, as requested. *(Superseded: the user enabled it later; observed enabled and enforced on 2026-11-06.)*
- **Web security headers:** site-wide CSP (host allowlist; no `unsafe-eval` in production; Turnstile, Supabase, and API origins only), `nosniff`, `X-Frame-Options`, `Referrer-Policy`, COOP, `Permissions-Policy`, HSTS only on HTTPS. The `/auth/callback` policy stays stricter. Nonces were not used because every page is static; the reason is in spec 03.
- **Callback:** a fragment-only second link now reloads the page and is processed once. Browser tests ran against the hosted project: expired or reused redirect, tampered session tokens, tampered confirmation and recovery hashes, and redirect injection. All showed the invalid-link screen with a cleaned URL, no session, and no new records.
- **Mobile session storage:**
  - `SecureSessionStorage` (`flutter_secure_storage` 11.2.0) holds the session: Android Keystore-backed AES-GCM, and the iOS Keychain with `first_unlock_this_device`.
  - An existing plaintext session is moved once, so a signed-in user stays signed in.
  - Web sessions are unchanged.
- **Rate limiting:**
  - With Redis down, limits are enforced with in-process counters (not switched off).
  - If the limiter fails, the response is `503`.
  - Sign-up, sign-in, and recovery are limited by Supabase; `apply-auth-config.mjs --show` prints those limits (read-only).
- **Logging:** the API 500 handler logs only the error type, code, and stack frames.
- **Verified (automated):**
  - API 82/82, web 35/35, Flutter 59/59.
  - Root `pnpm build`, `pnpm typecheck` (including `tokens:check`), `pnpm lint`; `flutter analyze` clean; Android debug APK built with the real site key.
  - Client bundles (web `.next/static`, the APK) contain no secret value; the only `sb_secret_` match is SDK text.
- **Needs manual testing:** the mobile Turnstile WebView on the emulator; session restore and refresh on a device after secure-storage migration; a real expired or reused email link; registered-email anti-enumeration; and CAPTCHA enforcement after it is enabled in Supabase.

### 03: hosted end-to-end web test passed (2026-11-05)

- **Setup:** hosted development project `hamdzxesiorzmxgymeyb`, Supabase **default** email provider, an authorized team email, web app on `http://localhost:3000`, API with the local PostgreSQL. The redirect allowlist was applied with step 1 of `supabase/apply-auth-config.mjs`.
- **Passed (reported by the user):** email/password registration → confirmation email delivered → confirmation through `/auth/callback` → account setup with phone collection → login → recovery email delivered → password reset.
- **Corroborated read-only:**
  - Supabase: 1 user, confirmed, with no auth phone.
  - Local database: 1 `User` holding CUSTOMER, 1 `CustomerProfile`, 1 `ACCOUNT_SETUP` phone-history entry.
  - The recovery step could not be confirmed from the project logs; it is recorded on the user's report.
- **Spec 03 checklist updated:** sign-up, confirmation email, browser callback, redirect allowlist, account setup, the unconfirmed-bootstrap refusal, web password recovery, and login/logout are now checked.
- **Still open** (cross-device and mobile items were split out of these): cross-device confirmation, mobile recovery, unconfirmed-login and expired-link live checks, Turnstile, App Links / Universal Links, and the domain-dependent email items.
- **Not changed:** implementation, decisions, and settings.

### Development email mode: Supabase default provider (2026-11-05)

- **Decision:** no domain yet, so no custom SMTP and no custom templates (the free plan refuses templates without custom SMTP). Mandatory email confirmation stays on, and the email/password architecture is unchanged.
- **Web and mobile `/auth/callback`:** also accepts Supabase's default-template redirect (`#access_token=…&refresh_token=…&type=signup|recovery`), passed to `setSession` (Supabase checks the token). It follows the same rules as the token-hash links. Mobile now uses the implicit flow, so default links work from any device.
- **`supabase/apply-auth-config.mjs`:** two steps; step 2 (templates) is skipped without SMTP variables. It also prints the API's error message. Tested against a stand-in API.
- **Verified:** web 35 tests, mobile 51 tests (new default-link cases). **Not verified:** real confirmation and recovery emails. The redirect allowlist is not applied yet: step 1 needs the user's Supabase token.

### 03 + 04 core: email authentication implementation (2026-11-05)

- **Supabase (read-only inspection through the MCP):** project `hamdzxesiorzmxgymeyb` has an ES256 JWKS, email on, phone off, `mailer_autoconfirm: false`, 0 users, an empty `public` schema, and no advisories. No settings were changed: the MCP has no Auth-config tools. `supabase/apply-auth-config.mjs` applies them through the Management API once `SUPABASE_ACCESS_TOKEN` is available.
- **Email templates:** `supabase/templates/{confirmation,recovery}.html`, bilingual, with token-hash links in the URL fragment.
- **API:**
  - Migration `customer_profiles` (`CustomerProfile`, `CustomerPhoneChange`, enums, E.164 and history `CHECK` constraints).
  - `modules/customers/`: `POST`/`GET`/`PATCH /customers/me`.
  - Server-side email-confirmation check (`GET /auth/v1/user` with the user's token and the publishable key; no secret key in the API).
  - Redis rate limits (`ioredis` 5.11.1; fail open).
  - The retention worker (`src/workers/`, `pnpm --filter @chicman/api worker`).
  - New config: `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_AUTH_TIMEOUT_MS`, `REDIS_URL`, `TRUST_PROXY_HOPS`.
- **Shared:** `API_ERROR_CODES`, `EMAIL_NOT_CONFIRMED`, the customer profile contracts, and `isE164PhoneNumber`.
- **Web:**
  - Pages: email sign-up with "check your email" and resend; login with the unconfirmed-email message and resend; `/forgot-password`; `/auth/callback` (fragment token, stripped immediately, verified once, fixed destinations, full page loads, its own CSP and no-referrer); `/auth/update-password`; account setup (phone) on `/account`; `/auth/turnstile` for the mobile WebView.
  - Turnstile widget (disabled without a site key).
  - The phone + OTP code was removed.
- **Mobile:**
  - The same flows.
  - `app_links` link handling with each token handled once; `detectSessionInUri: false`; Flutter deep linking disabled.
  - Android App Links intent filter with the host from `SITE_URL`; iOS `Runner.entitlements` with `APP_LINK_HOST`.
  - Turnstile in a `webview_flutter` WebView.
  - Messages generated from the web wording.
  - New `--dart-define`s: `SITE_URL`, `TURNSTILE_SITE_KEY`.
- **Verified:**
  - API: 80 tests (+30 new: bootstrap, profile, phone history, retention, email-confirmation client, rate limits), against PostgreSQL for the profile tests. The Redis limiter was checked against a real Redis. The confirmation client against the hosted project: a fake token is rejected with 401 → invalid.
  - Web: 33 tests.
  - Mobile: 50 tests, `flutter analyze` clean; a debug APK built with the App Links host taken from `SITE_URL`.
  - Root build, typecheck (including `tokens:check`), lint, and tests pass.
  - Browser checks:
    - the callback with a fake token: one verify request, fragment stripped, invalid-link screen, no CSP violation;
    - the sign-up form has no phone field;
    - the Turnstile test key yields a token on `/login`, and the mobile page posts it to the channel.
  - Client bundles hold no secret keys.
- **Not verified:** real sign-up, confirmation email, login, and recovery (blocked on the hosted Auth settings); iOS (no macOS here); App Links verification (no domain); local Supabase CLI (not installed).
- **Local environment notes:**
  - Redis runs on port 6389 (`REDIS_PORT=6389`), because a password-protected Redis on this machine already holds 6379.
  - `apps/api/.env` contains `DATABASE_URL` twice, and the last one (the Supabase pooler) wins. Commands in this session passed the local URL explicitly.

### Phone at setup, phone change history, Turnstile (specification only)

- **Phone during registration:** the sign-up form has no phone field. The phone is collected only at account setup, after email confirmation. No `User` or `CustomerProfile` exists until account setup completes (spec 03, Registration and Account Setup; spec 04).
- **Phone change history (spec 04, Phone Change History):** `CustomerPhoneChange` (`customerProfileId`, `actorUserId` from the verified token, `changeType` `ACCOUNT_SETUP`/`CUSTOMER_UPDATE`, `previousPhone`, `newPhone`, `createdAt`). It is append-only and written in the same transaction as the phone write, with no row for no-op updates and a consistent chain under concurrency. It is private (no API exposes it) and has no verified flag. Checklist tests added.
- **CAPTCHA (spec 03, Bot Protection):** Cloudflare Turnstile on sign-up, login, and recovery, through Supabase Auth's CAPTCHA protection (`captchaToken`). The rules cover:
  - Siteverify, if the API ever needs Turnstile itself;
  - single-use tokens, with a reset after each attempt;
  - fail closed;
  - the public site key versus a secret key that never reaches clients;
  - hostname restriction and CSP;
  - no Turnstile on `/auth/callback`;
  - a WebView widget on mobile;
  - test keys locally.
- `architecture.md` (stack row, auth model, storage model) and `project-overview.md` updated.
- **Pending implementation:** a Prisma migration for `CustomerProfile` and `CustomerPhoneChange`, the Turnstile integration on both clients, the local `[auth.captcha]` config, and the Cloudflare and Supabase CAPTCHA configuration. Nothing is implemented; no code, schema, or migration changed.

### Email authentication decisions finalized (specification only)

- **Resolved** the eight authentication open questions with the approved decisions. They are now in spec 03 (sections Registration and Account Setup, Sign-in Email Changes, Confirmation and Recovery Links, Site URL and Redirect URL Allowlist, Mobile Verified Links, Email Testing and Delivery, Abuse Protection and Sessions, Supabase Project Configuration) and in spec 04 (`{ phone }` bootstrap body; `phone` added to the `PATCH` allowlist; email not changeable).
- `architecture.md`, `project-overview.md`, and `README.md` updated to match (single callback with verified links, account-setup phone, Inbucket locally, Resend in production).
- **Repository state checked; none of the following exists yet:** a `/auth/callback` route, a `supabase/` directory, email templates, `.well-known` association files, an Android App Links intent filter, an iOS `Runner.entitlements`, or a `SITE_URL` variable. The Supabase CLI is not installed. All of these are listed as implementation work or deployment prerequisites, not as done.
- **Not changed:** application code, the Prisma schema, migrations, environment files, and Supabase or Resend settings.

### Authentication requirements: email + password (specification only)

- **Decision:** Supabase Auth with **email + password** and **mandatory email confirmation** replaces phone + password with SMS OTP for the initial launch. Password recovery uses Supabase's email recovery flow. The phone number stays required at registration as **unverified contact information** in `CustomerProfile.phone`; it is never an authentication identity and is never used for login or recovery. No SMS provider is required for the launch, and phone verification may be added later.
- **Spec 03:** new section Email Registration, Confirmation, Login, and Recovery (10-step registration and bootstrap flow, login, recovery, separate web and mobile callbacks and redirect URLs, Supabase project configuration, future phone verification). The Implementation Notes mark the phone + SMS OTP client flow as superseded. The checklist is rewritten for email auth.
- **Spec 04:** bootstrap checks email confirmation from Supabase Auth on the server (`403 EMAIL_NOT_CONFIRMED` when unconfirmed, `503 AUTH_UNAVAILABLE` when Auth is unreachable; never client input or `user_metadata`), and stores a required, server-validated E.164 `phone` as unverified contact data. `phone` stayed out of the `PATCH` allowlist until its editing policy was decided (since decided: editable without verification). Atomicity, idempotency, retries, and the one-profile invariant are unchanged.
- **Spec 06:** shop contact phones are now separate from the customer profile phone (there is no authentication phone anymore).
- **`architecture.md`, `project-overview.md`, `current-issues.md`:** phone OTP, phone login, and the SMS provider removed; email identity, confirmation, and recovery documented. Authorization, roles, seller onboarding, and `SELLER` transitions are unchanged.
- **Not changed:** application code, the Prisma schema, migrations, and Supabase project settings. The current web and mobile auth code (phone + OTP) now differs from spec 03 and must be reworked.

### 03 — Authentication (in progress)

> The client registration and login flows below implement the **superseded** phone + SMS OTP requirement. They are kept as a record and must be reworked for email authentication. The API items are unaffected.

- **API config** (`apps/api/src/config/env.ts`): zod-validated; the API refuses to start without `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`. Optional JWKS timeout, cooldown, and max age use the spec defaults. `createApp` now takes its dependencies (config, verifier, repositories), so tests build the app with test doubles.
- **Token verification** (`modules/auth/`): `JwksKeyStore` implements every hardening guarantee itself: timeout, single flight, cooldown with exponential backoff capped at 5 min, bounded negative cache (1000), cache lifetime, stale on error, fail closed. `TokenVerifier` checks ES256/RS256 only, binds the header `alg` to the key, and checks issuer, audience, `exp`/`nbf`/`iat` (±30 s), and a UUID `sub`. `jose` is used for `jwtVerify` and JWK import; why `createRemoteJWKSet` is not used is recorded in spec 03, Implementation Notes.
- **Middleware** (`apps/api/src/middleware/`): `authenticate` (exactly one Bearer header) → `loadAppUser` (roles from PostgreSQL) → `requireAppUser` / `requireRole` → `requireApprovedSeller` (SELLER + owned shop + `APPROVED`). Composed as guards `tokenOnly`, `user`, `role(...)`, `approvedSeller`. Centralized error handler with code-only bodies (`UNAUTHORIZED` 401, `AUTH_UNAVAILABLE` 503, `FORBIDDEN` 403, `NOT_FOUND` 404).
- **Endpoint:** `GET /api/v1/auth/session` → `{ userId, roles }`.
- **Database:** Prisma 7.10.1 (`prisma-client` generator, `@prisma/adapter-pg`, `prisma.config.ts`). Migration `auth_users_roles_shops`: `User`, `UserRole`, and a minimal `Shop` (ownership and status only; extended by feature 06). Prisma install scripts allowed in `pnpm-workspace.yaml`. The generated client is git-ignored.
- **Shared** (`@chicman/shared`): roles, shop statuses, auth error codes, the session response type, and `normalizePhoneNumber` (E.164; 8-digit numbers get +222).
- **Web** (`apps/web/src/features/auth/`, `src/lib/supabase.ts`, `src/lib/api-client.ts`): `AuthProvider` (session restored from `localStorage`, tracks auth changes), `/register` (phone + password → SMS OTP, resend, change number), `/login`, `/account` (API session check: 401 signs out, 503 keeps the session with a retry, 403 "account not set up"), and logout. French and Arabic texts. `.env.example` added (and un-ignored).
- **Mobile** (`apps/mobile/lib/features/auth/`, `lib/core/{config,network,auth}/`): `supabase_flutter` 2.18 and `http`. `AuthRepository` (Supabase-backed), Riverpod providers (`authSessionProvider`, `sessionCheckProvider`), `AuthGate`, and login, registration (OTP step), and account screens with the same 401/503 rules. Configured with `--dart-define`; Supabase init never blocks startup (5 s timeout) and the app launches without it. The demo counter screen was replaced by `AuthGate`; the theme selector now sits on the auth screens. Added the macOS network-client entitlement. (The Android `INTERNET` permission was already present.)
- **Docs:** spec 03 Implementation Notes and checklist; spec 06 notes the existing minimal `Shop`; `code-standards.md` testing and Prisma conventions; `README.md` setup.

**Verified:**
- API: 50 tests pass: 20 token verification (HTTP level), 13 JWKS hardening (local JWKS server with request counting, latency, refused, dropped, and 500 responses), 17 role and seller authorization against PostgreSQL (fixture routes using the production guards). The API refuses to start with missing config and starts with it.
- Web: 23 `node:test` tests. Production build checked in a browser: validation errors, network-error message, signed-out redirect from `/account`. With the real API and a test JWKS: a stored session was restored on reload and accepted (roles from PostgreSQL); after a restart with the JWKS down the account showed the 503 message and kept the session; logout cleared it.
- Mobile: `flutter analyze` clean, 39 tests pass (including 15 new auth tests: restore, login, registration with OTP, logout, 401, 503, no config, Arabic RTL). `flutter build apk --debug` and `flutter build web` succeed.
- Root `pnpm build`, `pnpm typecheck` (including `tokens:check`), `pnpm lint`, and `pnpm test` pass.

**Not verified:** registration and password login against a real Supabase project (none was configured at the time). Local dev used PostgreSQL on port 5442 because 5432 was taken on this machine.

### 01 — Project Setup

- Monorepo structure: `apps/{api,web,mobile}`, `packages/shared`, `infrastructure/docker`, `context`.
- Root `README.md` (structure, prerequisites, per-app run instructions) and `.gitignore` (env files except `.env.example`, dependencies, build output, Flutter/Gradle generated files).
- API (`apps/api`): `@chicman/api`, ESM, strict `tsconfig` (`src` → `dist`), scripts `dev`/`build`/`start`/`typecheck`. Minimal Express entry point with `GET /api/v1/health`, env config (`PORT`, `CORS_ORIGINS`), `.env.example`.
- Web (`apps/web`): `@chicman/web`, added `typecheck` script (`next typegen && tsc --noEmit`, since `LayoutProps`/route types are generated by Next).
- Shared (`packages/shared`): `@chicman/shared` package with strict `tsconfig` and empty `src/index.ts`.
- Mobile (`apps/mobile`): `pubspec.yaml` description set; dependencies unchanged.
- Infrastructure: `infrastructure/docker/docker-compose.yml` with PostgreSQL 17, Redis 7.4, Meilisearch v1.15, SeaweedFS 3.97 (S3 API), healthchecks, named volumes, ports configurable via `infrastructure/docker/.env` (template: `.env.example`).

**Verified:** API install/typecheck/build/start and health endpoint; web install/typecheck/lint/build/dev; `flutter pub get`, `flutter analyze`, `flutter test`; `docker compose config` valid and all services start (PostgreSQL, Redis, Meilisearch healthy; S3 enforces credentials); git ignores env and generated files.

### Adopt pnpm Workspaces

- Root `package.json` (`packageManager: pnpm@10.27.0`) and `pnpm-workspace.yaml` covering `apps/api`, `apps/web`, `packages/*`. `apps/mobile` is excluded.
- Single root `pnpm-lock.yaml`; removed `apps/api/package-lock.json` (npm) and `apps/web/pnpm-lock.yaml`. Dependencies were re-resolved within the existing semver ranges.
- `onlyBuiltDependencies: [esbuild]` in `pnpm-workspace.yaml` (pnpm blocks install scripts by default; `tsx` needs esbuild's).
- `@chicman/shared` now compiles to `dist/` (JS + `.d.ts`) so the compiled API can import it at runtime under Node; `apps/api` and `apps/web` depend on it via `workspace:*`.
- Root scripts: `dev:api`, `dev:web`, `build`, `build:shared`, `typecheck`, `lint`.
- `README.md` updated for the workspace workflow.

**Verified:** `pnpm install` from root; `pnpm build` (shared → api/web in dependency order), `pnpm typecheck`, `pnpm lint` pass; `pnpm dev:api` and `pnpm dev:web` start; a temporary export from `@chicman/shared` resolved in the API (via `tsx` and compiled `node dist`) and rendered in a web build page (probe removed afterwards); `packages/shared/dist` is git-ignored.

### 02 — Design System

- **Web tokens** (`apps/web/src/app/globals.css`): semantic CSS variables from `ui-context.md` (light, plus a new dark palette and foreground tokens), with shadcn/ui variables mapped onto them. Tailwind utilities `bg-page`, `bg-surface`, `bg-highlight`, `bg-chip-*`, `text-success`/`warning`/`error`. Explicit radius scale (`2xl` = 16px, `3xl` = 24px). Class-based dark variant (`.dark`), matching `.dark` itself and its descendants.
- **Web layout** (`apps/web/src/app/layout.tsx`): Plus Jakarta Sans, Noto Sans Arabic, and JetBrains Mono via `next/font/google`. `lang`/`dir` come from a `fr`→`ltr` / `ar`→`rtl` map (default `fr`) and feed Base UI's `DirectionProvider`. Metadata is set to Chicman.
- **Web components** (`apps/web/src/components/ui/`): `Button` restyled (pill, 44px default, new `highlight` variant, logical padding). Added `Input`, `Card`, `Badge`, and `Chip`. All use tokens only.
- **Mobile theme** (`apps/mobile/lib/core/theme/`): `AppColors` `ThemeExtension` (light and dark, same values as the web) with `context.appColors`. `AppTypography` (same type scale; Arabic fallback). `AppTheme.light`/`.dark` customize the M3 color scheme, buttons, inputs, cards, chips, dialogs, sheets, navigation bar, snackbars, and more. `AppRadius`, `AppSpacing`, `AppIconSize`, and `AppSizes` live in `app_theme.dart`.
- **Mobile wiring:** fonts bundled in `apps/mobile/assets/fonts/` (static TTFs plus OFL licenses) and declared in `pubspec.yaml`. Added `flutter_localizations`. `main.dart` `MaterialApp` uses the themes (`ThemeMode.light`) and `fr`/`ar` locales. The demo home screen is unchanged.
- **Tests:** `apps/mobile/test/core/theme/app_theme_test.dart` covers token values, both themes, and LTR for `fr` / RTL for `ar`.
- `ui-context.md` now documents the dark palette, foreground tokens, theme switching, type scale, radius/spacing mapping, and component set.

**Verified:** `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass; `flutter analyze` is clean; `flutter test` passes (6 tests); `flutter build web` and `flutter build apk --debug` succeed. A temporary web probe page (since removed) was screenshotted in headless Chrome in light/dark × LTR/RTL. Components, tokens, Arabic font, and RTL mirroring rendered correctly. This check caught and fixed a `text-base` collision (the page-background utility was renamed from `base` to `page`).

### Design System decisions: shared tokens + theme selection

- **`packages/design-tokens/`** (`@chicman/design-tokens`): typed token source `src/tokens.ts` covering colors (light/dark), fonts, type scale and text roles, spacing, component sizes, icon sizes, and radii. Generators in `src/targets/` produce:
  - web: `design-tokens.generated.css`, `fonts.generated.ts`
  - Flutter: `lib/core/theme/generated/design_tokens.g.dart`, and the pubspec font block between markers
  Generated files are committed. Runs with `tsx` (the local Node build has no native TypeScript support). Root scripts: `pnpm tokens`, `pnpm tokens:check`. The check also runs in `pnpm typecheck` and validates that font assets exist.
- **Web:** `globals.css` now holds only mappings (no raw values). Fonts come from the generated loaders. Components use token utilities: `h-control*`, `size-icon-*`, and `type-*` text roles. To avoid `cn` merge conflicts between `type-*` utilities, the button text style is set per size.
- **Web theme:**
  - `src/lib/theme.ts`: preference store (`localStorage` key `chicman-theme`, default `system`) and an inline init script in the root layout (`<head>`, no flash; reacts to OS, cross-tab, and in-page changes). `<html>` has `suppressHydrationWarning`.
  - `useThemePreference` hook (`useSyncExternalStore`) and `ThemeSelector` (Base UI `ToggleGroup`, labels in French and Arabic).
  - Locale constants moved to `src/lib/locale.ts`.
- **Flutter:** added `flutter_riverpod` and `shared_preferences`.
  - `app_colors.dart`, `app_typography.dart`, and `app_theme.dart` now re-export or adapt the generated classes. `AppSizes` was renamed to the token names (`control`, `controlSm`, `controlLg`, `touchTarget`). Added a segmented-button theme.
  - `sharedPreferencesProvider` (`lib/core/storage/`) is overridden in `main()`. `themeModeProvider` / `ThemeModeController` default to `ThemeMode.system` and persist `system`/`light`/`dark`.
  - `ThemeModeSelector` widget. `MaterialApp` is wrapped in `ProviderScope` and watches the theme mode.
- **Temporary placement:** the theme selector is mounted on the web starter `page.tsx` (fixed, top-end) and on the Flutter demo home screen, until a header or profile settings screen exists.
- **Docs:** `architecture.md` (design-tokens boundary, `packages/shared` scope, invariant 17), `code-standards.md`, `ui-context.md` (theme behavior, token implementation, utilities), root `README.md`, and the package README.

**Verified:**
- `pnpm tokens:check` passes, and fails after a hand edit to a generated file. `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
- `flutter analyze` is clean. `flutter test` passes 11 tests, including controller default/restore/invalid-value/persist and a selector widget test that switches the app to dark. `flutter build web` and `flutter build apk --debug` succeed.
- Headless-Chrome CDP run against the production web build (11/11 checks): the System default follows the OS (including a live change); manual Dark and Light override the OS; the choice persists across reload; switching back to System works; the selector shows the pressed state.

### Current issues (`current-issues.md`) — fixes

- **Mobile startup:** `loadSharedPreferences()` never blocks `runApp` (catch plus 3 s timeout → `null`). `sharedPreferencesProvider` is now nullable, with an in-memory theme store fallback.
- **Mobile write ordering:** `ThemePreferenceStore` abstraction (shared_preferences / in-memory). `setMode` serializes writes so the latest selection wins (the Linux backend does not order overlapping writes).
- **Web storage-unavailable theme:** in-memory `sessionPreference` plus a non-clearing `selected` in the init script. The init script is now a literal string. Added `node:test` tests via `tsx` (`pnpm test`; `tsx` added as a web devDependency, already in the lockfile).
- **Status text tokens:** `state-{success,warning,error}-text`. The contrast rules in `tokens.ts` are enforced by `pnpm tokens:check`.
- **Auth, seller-approval, and profile contracts:** written into specs 03 and 04 and `architecture.md`. They are enforced when those features are implemented.

**Verified:** `pnpm build`, `pnpm typecheck` (including `tokens:check`), `pnpm lint`, and `pnpm test` (10 web tests) pass. `flutter analyze` is clean and `flutter test` passes 20 tests. Headless Chrome against the production build passes 8/8 with storage blocked and 11/11 with normal storage.

### Product decisions and architecture review corrections

- **Confirmed decisions documented:**
  - Profile fields (spec 04).
  - One shop per user (`Shop.ownerUserId` is unique, whatever application roles the user holds) and the four-status lifecycle (`architecture.md`, spec 06).
  - Theme selector placement in the web header and profile settings (`ui-context.md`, spec 04).
- **New spec:** `feature-specs/06-shop-management.md` covers the lifecycle, allowed transitions (conditional updates, `409` on conflict), seller authorization rules 1–7 with default deny, and the verification checklist.
- **Contracts (not implemented; per the user's decision to keep C/D/E as spec contracts until features 03/04/06 are built):**
  - Pre/post-bootstrap invariant and the atomic, retrying bootstrap (spec 04, `architecture.md`).
  - JWKS retrieval hardening, with tests listed (spec 03).
  - Onboarding authorization exceptions (spec 06, spec 03, `architecture.md`).
- **Status icon contrast (implemented):**
  - `tokens.ts` contrast rules now carry `purpose: text | icon`. Every status `-text` token is checked at 4.5:1 (text) and 3:1 (icon) on surface, base, muted, and the 15% tint, in both palettes.
  - `ui-context.md` gains a fill-vs-foreground usage table and the rating-star rule. Generated outputs are unchanged.

**Verified:**
- `pnpm build`, `pnpm typecheck` (including `tokens:check`), `pnpm lint`, and `pnpm test` (10 web tests) pass.
- `flutter analyze` is clean and `flutter test` passes 20 tests. Mobile tokens are unchanged.
- The new icon rule rejects the light warning fill used as an icon (2.15:1 < 3:1).
- No API tests exist: the API has no auth, bootstrap, or shop code yet. Contracts C, D, and E are **not verified** until features 03, 04, and 06 implement their checklists.

### Shop management decisions (spec 06)

- **Documented the four confirmed decisions** in `feature-specs/06-shop-management.md` and `architecture.md`:
  - **Initial submission:** creating a shop submits it as `PENDING`, with no draft status.
  - **Seller eligibility:** any bootstrapped customer may apply. Only admin approval grants `SELLER`. Seller access needs both the role and an `APPROVED` shop.
  - **Application fields:** a strict allowlist (5 required, 2 optional) with validation and sanitizing rules, and the protected fields.
  - **Suspension and reinstatement:** `SUSPENDED` → `APPROVED` by an administrator. A reason is required for suspension and reinstatement. Every status change is audited in `ShopStatusEvent`.
- **Architecture consequence:** users hold a **set of roles** (`UserRole`), since one user can be both `CUSTOMER` and `SELLER`. Specs 03 and 04 now use role sets instead of a single `role` (bootstrap grants `CUSTOMER`; existing roles are kept). Spec 03 now says sellers use their own registered account.
- **Spec 06 additions** (to make the decisions enforceable; open to revision):
  - Every transition runs in one transaction (conditional update, audit record, and, for initial approval only, the `SELLER` grant).
  - Field bounds: phones in E.164 format, `logoUrl` limited to the media origin, a 1–500 character reason.
  - Rule table renumbered: rule 2 is now resubmission, because creation submits the application.
- **Verified:** documentation only, no code changed. No API tests exist, so none of the spec 06 success criteria can be verified until the feature is implemented.

### Specification consistency fixes (specs 03 and 06)

- **Restored `feature-specs/06-shop-management.md`.** It was missing from disk and had never been committed, so it was rewritten from the last version written in this session, then corrected.
- **JWKS unavailability (spec 03):** the general `401` rule now names its only exception. A new Authentication Response Codes table separates `401` (invalid credentials with key material available, or an unknown `kid` after a successful refresh) from `503 AUTH_UNAVAILABLE` (uncached `kid` and the JWKS retrieval timed out or hit a network error). A `503` is never treated as an invalid session. The general rule, the hardening table, the authorization contract, and the checklist now agree.
- **`Shop.status` ownership (spec 03):** approval, rejection, suspension, and reinstatement are administrator-only. The owner may only resubmit their own rejected application (`REJECTED` → `PENDING`); shop creation sets the initial `PENDING`.
- **Initial submission (spec 06):** creating a shop is the initial submission (created as `PENDING`, no existing shop needed). Resubmission is allowed only from `REJECTED` by the owner; any other status gives `409`. There is no draft status, and the one-shop invariant and the server-side ownership checks are unchanged. Checklist items were added for both.
- **Verified:** documentation only. Both specs and `architecture.md` were cross-checked by searching for contradictory `Shop.status`, JWKS-failure, and submission statements. None remain.

### Spec 06 decisions: approved editing, logo upload, rejection reason (specification only)

- **Resolved** the three spec 06 open questions in `feature-specs/06-shop-management.md`. This is a **specification decision, not implementation**: no API, web, or mobile code exists for spec 06.
- **Approved-shop editing (split policy):** `shopName` and `city` go through a `ShopChangeRequest` (one open per shop), which an admin approves or rejects. Approved values stay public until then, and `Shop.status` never changes. `description`, `contactPhone`, `whatsappPhone`, `address`, and `logoUrl` update immediately, with validation, ownership checks, and an audit record (`ShopFieldChangeEvent`).
- **Logo upload:** presigned PUT (5 minutes) into a private staging bucket. JPEG, PNG, or WebP only (no SVG), 2 MB maximum, 1024 × 1024 maximum. The server checks the real size, the file signature, and the decoded dimensions, then copies the file to the public media bucket. Only then is `logoUrl` saved. `architecture.md` Storage Model updated (staging bucket and verification before public serving).
- **Rejection reason:** mandatory for application rejection (10–500 characters), shown to the owner while `REJECTED`, and kept in `ShopStatusEvent`. Internal admin notes are a separate `internalNote` field that is never returned by seller-facing APIs.
- **Verified:** documentation only. No build or test commands are relevant; the spec 06 checklist stays unchecked until implementation.

### Spec 06: decision reason visibility (specification only)

- **Resolved** the last spec 06 open question. This is a specification decision; nothing is implemented.
- Only the application-rejection reason (`applicantReason`, required, 10–500 characters) is visible to the owner.
- Approval, suspension, reinstatement, and change-request rejection now **require** an `internalReason`. Before, approval and change-request reasons were optional. It is retained for audit and never exposed through seller-facing APIs or notifications. `internalNote` stays optional and internal.
- Owner-visible and internal texts are separate fields and columns. Owners see outcomes without reasons: `latestDecision.type` (`APPROVED`/`REJECTED`/`SUSPENDED`/`REINSTATED`) and the change-request outcome.
- `architecture.md` audit sentence updated to match. Transitions and authorization rules unchanged.

### Spec 06: decision reasons, owner visibility, and notifications (specification only)

- **Resolved** as specification decisions; nothing is implemented, and the spec 06 checklist stays unchecked.
- **Decision reasons:** all six administrative decisions require exactly one reason of 10–500 characters, retained with the decision type, actor, and timestamp. The initial application rejection takes `applicantReason` only (`internalReason` is not accepted); the other five take `internalReason`. This supersedes the earlier 1–500 bounds and the optional change-request-approval reason.
- **Owner visibility:** only the initial application rejection's reason is owner-visible, as `rejection.applicantReason` while `REJECTED`. No general `reason` field exists in seller-facing responses.
- **Decision type and status:** separate concepts. `ShopDecisionType` is `APPLICATION_APPROVED`, `APPLICATION_REJECTED`, `SUSPENDED`, or `REINSTATED`, and change requests use their own `APPROVED`/`REJECTED` outcome. The owner view separates `status`, `latestDecision`, `rejection`, and `changeRequest`. No new shop status.
- **Notifications (requirements level):** one owner notification per decision, carrying the outcome and non-sensitive status only. It never includes internal reasons, notes, admin identities, audit metadata, or the rejection reason (the dashboard shows that). Delivery uses the existing notifications module and workers.
- `architecture.md` audit sentence updated to match.

### Spec 06: single application-rejection reason (specification only)

- **Clarified:** an initial application rejection takes **exactly one** reason (`applicantReason`, 10–500 characters). It serves as both the audit reason and the owner-facing `rejection.applicantReason`; `internalReason` is not accepted on a rejection. The other five decisions keep one internal-only `internalReason` (10–500).
- Notifications still omit the rejection reason, because the notification rules in spec 06 do not authorize it. Creation and resubmission remain owner actions and never change `latestDecision`.
- Specification only; nothing implemented.

### Spec consistency and logo-recovery fixes (specification only)

- **One-shop rule:** described everywhere as one shop per **user** (`Shop.ownerUserId` is unique, whatever application roles the user holds). The last "one shop per seller" wording was removed (tracker and spec 06).
- **`SELLER` role transitions**, stated identically in `architecture.md`, spec 03, and spec 06:
  - Initial approval (including after a resubmission) grants `SELLER` if absent.
  - Suspension retains it and blocks operations through the status check.
  - Reinstatement retains it with no new grant and is recorded as `REINSTATED`.
  - No revocation rule. This corrects earlier wording that had reinstatement grant `SELLER`.
- **Logo completion and recovery (spec 06):**
  - Idempotent completion, using a lease claim fenced by the attempt number.
  - Verified bytes are written to a new immutable key on every attempt.
  - One transaction sets `logoUrl`, activates the object, marks the upload `COMPLETED`, and writes the audit event.
  - Recovery is defined for a failed public write, a database failure after the write, and a failed compensating delete.
  - A reconciliation and cleanup job in the existing workers handles orphaned, released, and staging objects, and never deletes a referenced object.
  - New state: `ShopLogoUpload` statuses `PENDING | PROCESSING | COMPLETED | REJECTED | EXPIRED` plus lease, attempt, and cleanup fields; a new `ShopLogoObject` record; config `LOGO_COMPLETION_LEASE_MS` and `LOGO_COMPLETION_WINDOW_MS`.
- **Rejection contract:** obsolete tracker wording saying all six decisions require `internalReason` was corrected. A rejection takes `applicantReason` only; the other five decisions take `internalReason`.
- Specification only; nothing implemented.

## Decisions

- **pnpm Workspaces at the repository root** for shared TypeScript packages between web (`apps/web`) and backend (`apps/api`). Flutter (`apps/mobile`) remains independent of the workspace. Implemented.
- **Local object storage: SeaweedFS** (Docker Compose). MinIO was ruled out because its community images are no longer published.
- **Production object storage: Cloudflare R2.**
- **Both storage providers are integrated through the S3-compatible API**, so switching environments is a configuration change, not a code change.
- Supabase Auth is hosted for shared environments and is not part of the Chicman Docker stack. Local auth development uses the Supabase CLI local stack with Inbucket (separate from Docker Compose).
- **Design tokens have one source: `packages/design-tokens`.** Platform theme definitions are generated from it and committed. No design values are maintained by hand in either app. (Supersedes the earlier hand-synced approach.)
- **`packages/shared` stays separate:** application types, schemas, and contracts only, no visual tokens.
- **Access tokens:** verified on the API against the Supabase JWKS (asymmetric keys only). The Supabase project must use asymmetric JWT signing keys.
- **Seller approval:** `Shop.status` (`PENDING`/`APPROVED`/`REJECTED`/`SUSPENDED`) is authoritative. Normal seller operations need `SELLER`, an owned shop, and `APPROVED`. Onboarding operations have their own rules (spec 06). Suspended shops keep only status viewing.
- **One shop per user** (initial release): `Shop.ownerUserId` is unique, so a user owns at most one shop whatever application roles they hold, and owner routes resolve the shop from the authenticated user.
- **Shop creation submits the application:** shops start as `PENDING`, with no draft status, and are immediately reviewable.
- **Becoming a seller:** any bootstrapped customer may apply without `SELLER`. Only the administrator's initial approval (`PENDING` → `APPROVED`, including after a resubmission) grants `SELLER`; applying and resubmitting grant nothing (users hold a role set, so `CUSTOMER` is kept). Suspension retains the role, and the status check blocks access. Reinstatement retains the role with no new grant and is recorded as `REINSTATED`. No role-revocation rule exists.
- **Shop application fields:** required `shopName`, `description`, `contactPhone`, `city`, `address`; optional `whatsappPhone`, `logoUrl`. Strict allowlist. Shop contact phones are separate from the customer's profile phone (there is no authentication phone). No identity documents in the initial release.
- **Suspension and reinstatement:** admin-only (`APPROVED` ↔ `SUSPENDED`), with a required reason. Every status change is audited (actor, reason, time).
- **Approved-shop editing:** split policy. `shopName`/`city` changes need admin re-review through a change request (approved values stay public until it is decided); other fields update immediately and are audited. Status is unchanged.
- **Shop logo upload:** presigned PUT (5 min) into a private staging bucket; JPEG/PNG/WebP, ≤ 2 MB, ≤ 1024 × 1024, no SVG; server-side content verification before the public `logoUrl` is saved. Completion is idempotent and safe under concurrency, every attempt writes a new immutable object, and orphaned objects are reconciled without deleting referenced logos.
- **Application rejection reason:** mandatory (10–500 characters), shown to the applicant, kept in the audit history. Internal admin notes are separate and never exposed to sellers.
- **Decision reasons and visibility (MVP):** each of the six administrative shop decisions requires exactly one reason (10–500). For an initial application rejection, that reason is also shown to the owner (`rejection.applicantReason`); the other five reasons are internal only. Owners see outcomes (`latestDecision`, including `REINSTATED`, and change-request outcomes), never internal reasons or notes.
- **Shop decision notifications:** one per decision, outcome and non-sensitive status only. They never contain internal reasons, notes, audit metadata, or the rejection reason.
- **Authentication (supersedes phone + SMS OTP):** Supabase Auth with email + password; email confirmation mandatory before an active Chicman account exists (checked server-side at bootstrap); password recovery by Supabase email. The phone is required, unverified contact information, never an identity, and never used for login or recovery. No SMS provider at launch; phone verification may be a later feature. Supabase secret keys only on the API. Callback `/auth/callback` (web, plus mobile App Links / Universal Links, browser fallback); token-hash email templates for cross-device confirmation; the phone is entered at account setup and is editable without verification; no sign-in email changes in the first release; Inbucket locally; Resend SMTP in production (the domain stays configurable).
- **Profiles:** the editable fields are `fullName`, `preferredLocale`, and `phone` (required, unverified contact information; no OTP). The phone is collected only at account setup (not on the sign-up form). Phone changes are recorded in a private, append-only `CustomerPhoneChange` history, kept for 12 months. Avatar is out of scope; email is the auth identity and is not a profile field; auth data stays with Supabase; IDs, roles, and ownership keys are server-managed; addresses belong to the address feature.
- **CAPTCHA:** Cloudflare Turnstile on sign-up, login, and password recovery, verified server-side (Supabase Auth CAPTCHA protection), in addition to rate limits. Enabled on the hosted development project.
- **Bootstrap:** zero application records before bootstrap; exactly one `User` and one `CustomerProfile` after, created or repaired in one transaction with bounded retry on unique conflicts. Refused for unconfirmed emails.
- **JWKS hardening:** timeout, single flight, cooldown with backoff, a bounded negative cache, stale-on-error, and fail closed (`401` unknown key, `503` key set unavailable).
- **Status icons:** meaningful status icons and text use the `state-*-text` tokens (≥ 3:1 and ≥ 4.5:1, both enforced by `tokens:check`). Light fills are for tints only.
- **Storefront and theme selector:** the web home `/` is a temporary branded page (wordmark, links to sign-up and login), and the Flutter app opens on the auth gate; neither is the storefront. The theme selector belongs in the web header and in customer profile settings (device-local preference). It moves there when those features are built.
- **Theme behavior:** System by default, with a manual System / Light / Dark selector. The choice persists on the device (key `chicman-theme`); System follows the OS.
- **Flutter fonts are bundled** (no runtime font fetching).

## Open Questions

### Decided (email authentication, approved product decisions)

1. **Web callback:** `/auth/callback` (Next.js), implemented with the auth rework. The production domain stays configurable (`SITE_URL`) and is never hardcoded. Supabase redirect URLs are exact allowlist entries per environment (spec 03, Site URL and Redirect URL Allowlist).
2. **Mobile links:** Android App Links and iOS Universal Links on the same `/auth/callback` URL, with the web callback as the browser fallback. Intent filter, Associated Domains entitlement, `assetlinks.json`, and `apple-app-site-association` are specified (spec 03, Mobile Verified Links).
3. **Cross-device confirmation:** custom Supabase confirmation and recovery templates with token-hash links, verified by the callback. Tokens are kept in the URL fragment and never logged. No arbitrary redirects. Expired, invalid, or used links are handled. App-not-installed fallback in the browser. No duplicate bootstrap.
4. **Phone at account setup:** entered again after email confirmation, sent in the bootstrap request (`{ phone }`), validated and stored unverified by the API. It never depends on sign-up-device state, client storage, or `user_metadata`.
5. **Phone changes:** allowed through `PATCH /api/v1/customers/me`, validated (E.164), no SMS OTP, stays unverified, and never changes the auth identity.
6. **Sign-in email changes:** not supported in the first release (no profile field, screen, or custom workflow). Recorded as a possible future enhancement.
7. **Local email testing:** Supabase CLI local stack with Inbucket. The hosted development project is separate and cannot deliver to the local Inbucket.
8. **Production email:** Resend through Supabase custom SMTP, from a verified Chicman sending domain with SPF, DKIM, and DMARC. Credentials stay only in Supabase and the secret store.
9. **Phone on the sign-up form:** not collected there; collected only at account setup after email confirmation. No `User` or `CustomerProfile` exists until account setup completes.
10. **Phone change history:** a lightweight, private, append-only `CustomerPhoneChange` record (previous value, new value, time, authenticated actor, change type `ACCOUNT_SETUP`/`CUSTOMER_UPDATE`), written in the same transaction as the phone write. No generic audit platform, and no verified flag. **Retention: 12 months**, enforced by a scheduled cleanup job in the background workers.
11. **CAPTCHA:** Cloudflare Turnstile on sign-up, login, and password recovery, in addition to rate limits, verified server-side by Supabase Auth's CAPTCHA protection (the API uses Siteverify if it ever needs Turnstile itself). A client-side result is never trusted alone.

### Still requires configuration (deployment prerequisites; not done)

- The production domain (and so the production Site URL).
- Final production (and hosted development) Site URL and redirect allowlist values in the Supabase projects.
- Android release signing (and Play App Signing) fingerprints for `assetlinks.json`; the Gradle host placeholder value.
- Apple Developer Team ID, the Associated Domains capability, and provisioning for `apple-app-site-association` and `Runner.entitlements`.
- Hosting both association files on the production domain (HTTPS, correct content type, no redirects).
- Custom confirmation and recovery templates applied to the hosted projects (pending domain setup: requires custom SMTP on the free plan; the templates are kept in `supabase/templates/`).
- **Pending domain setup:** a domain, the Resend account, and the verified Chicman sending domain. Until then, development uses Supabase's default email provider (team addresses only).
- SMTP credentials (a Resend API key) entered in the Supabase project's SMTP settings (pending domain setup).
- DNS records for the sending domain (SPF, DKIM, DMARC) and Resend domain verification (pending domain setup).
- Branded email delivery and external-recipient testing (pending domain setup).
- Supabase Auth rate limits reviewed for each environment, after custom SMTP.
- The Supabase CLI installed locally, and an asymmetric local signing key configured (not committed).
- Turnstile for production: add the production hostname to the widget (development uses `localhost`, verified), and enter the production secret in the production Supabase project. *(Development is done: the widget exists, the site key is in the web and mobile builds, the secret is in the hosted development project's CAPTCHA settings, and CAPTCHA is enabled.)*
- Production CSP origins (site, API, Supabase) and HSTS, once the domain exists. *(The site-wide CSP is implemented; the mobile Turnstile page is no longer needed: the widget document is bundled in the app.)*
- **Security housekeeping:** rotate the hosted Supabase database password (it appeared in session output). **Outstanding**; the project owner will do it later. *(Done 2026-11-06: the unused `SUPABASE_SECRET_KEY` and `TURNSTILE_SECRET_KEY` were removed from `apps/api/.env`.)*

### Remaining questions

- **Email-confirmation check at scale (technical decision):** `GET /auth/v1/user` shares Supabase's per-IP sign-in bucket (30 per 5 minutes), and every account setup comes from the API's IP. Options: the Admin API with the secret key on the API, or `Sb-Forwarded-For` with the secret key and IP forwarding. Either option would reintroduce a Supabase secret key, in the API environment only (it was removed on 2026-11-06 because nothing used it).
- A general personal-data retention policy for the platform is not defined; only the phone change history has one.

## Next Steps

**Feature 03, verification (no domain needed):**
1. Registered-address anti-enumeration: login with a wrong password, the recovery email arriving, sign-up with an existing address (uses the 2 emails per hour of the built-in provider).
2. CAPTCHA: sign-up and recovery without a token → `captcha_failed`; the web Turnstile failure and retry states.
3. Real expired and reused email links; cross-device confirmation; login with an unconfirmed email.
4. Decide the email-confirmation check approach at scale (see Remaining questions).
5. Rotate the hosted database password (outstanding; the project owner will do it later).

**Feature 04, pending verification (project owner, manual):**
1. After 2026-11-08T13:49:27Z (any further restart moves this), run `docker compose logs -t worker | grep "run #"` in `infrastructure/docker`. Look for `run #2 succeeded` with no `Worker started` line just before it, then tick the spec 04 checklist item. A restart before then resets the 24-hour clock (spec 04, Retention Worker Scheduling).

**Optional, local:** install the Supabase CLI and create `supabase/config.toml` (Inbucket, asymmetric signing key, `[auth.captcha]` with test keys).

**Deferred until a domain exists:** Resend custom SMTP and DNS (SPF, DKIM, DMARC); apply the branded templates (`apply-auth-config.mjs` step 2); external-recipient email tests; production Site URL and allowlist; `assetlinks.json` and `apple-app-site-association`; iOS build and Universal Links test; production CSP origins and HSTS.

**Decision (2026-11-05), still in force:** keep Supabase's default email provider for development; do not configure SMTP or apply the custom templates until a domain is verified.
