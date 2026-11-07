# 04 — Customer Profile

## Goal

Allow authenticated customers to view and manage their personal profile information.

## Design & Architecture Decisions

- Each customer has one profile associated with their Supabase Auth user ID.
- PostgreSQL stores customer profile information.
- The backend controls profile access and updates.
- Customers can only access their own profiles.
- Authentication data (email identity, email-confirmation status, password, sessions) remains managed by Supabase Auth.
- The customer's **phone number is contact information stored in the profile** (`CustomerProfile.phone`). It is required, collected during account setup after email confirmation, and editable by the customer. It is not an authentication identity and is **not verified** in the initial release (see spec 03, Future Phone Verification). The profile has no phone-verification field; a future phone-verification feature would add one.

## Account Bootstrap and the One-Profile Invariant

**States:**

- **Pre-bootstrap:** a Supabase Auth user with a valid access token may have **zero** application `User` and `CustomerProfile` records. This is a normal state (for example right after the first sign-in following email confirmation). Such a token is authenticated but has no application role, and grants access only to the bootstrap endpoint. Every other protected route returns `403`.
- **Post-bootstrap:** **exactly one** `User` and **exactly one** `CustomerProfile` exist for that Supabase user.

**Database constraints** (Prisma migrations; application-level "find, then create" checks are never relied on for uniqueness):

- `User.supabaseUserId` (UUID, the verified token `sub`) is `@unique`.
- `CustomerProfile.userId` is a `@unique` foreign key to `User.id`, which makes the relation 1:1.

**Bootstrap** (`POST /api/v1/customers/me`, called from the account-setup screen when the session check returns `403` after email confirmation; safe to repeat):

- The identity comes only from the verified token (`sub`). No identity, role, ownership, or verification-status field is read from the request body.
- **Email confirmation is required.** Before creating anything, bootstrap confirms from Supabase Auth on the server that the identity's email is confirmed (`email_confirmed_at` set), for example from the Auth user endpoint called with the user's access token, or the Admin API with the secret key held only by the API. Token claims that the user can write (`user_metadata`) and client-supplied values are never used for this check. An unconfirmed identity → `403` (error code `EMAIL_NOT_CONFIRMED`), and nothing is written. If Supabase Auth cannot be reached → `503` (`AUTH_UNAVAILABLE`), nothing is written, and the client keeps the session and retries.
- **Request body:** a strict schema with exactly one field, `phone` (required). Any other field → `400`, nothing is written.
- **Phone (contact information).** The customer enters it on the account-setup screen after email confirmation. It is never taken from the sign-up device, client-side storage, or Supabase `user_metadata`. It is validated and normalized server-side to E.164 (`+` followed by 8–15 digits; an 8-digit national number gets `+222`) and stored as unverified contact data. A missing or invalid phone → `400`, nothing is written. When the `CustomerProfile` already exists, it is reused unchanged: bootstrap never overwrites its phone (changes go through `PATCH`), and the response returns the stored profile.
- The `User` and the `CustomerProfile` are created or reused in **one database transaction**:
  1. Create or reuse the `User` by `supabaseUserId` (`INSERT … ON CONFLICT ("supabaseUserId") DO NOTHING`, then `SELECT`, or a Prisma native upsert). A newly created `User` gets the `CUSTOMER` role (`UserRole` row, same transaction; see `architecture.md`). An existing `User` keeps its roles unchanged (for example a user who is also `SELLER`).
  2. Create or reuse the `CustomerProfile` by `userId` in the same way. This also **repairs** an existing `User` whose `CustomerProfile` is missing. When this call creates the profile, it also inserts the `ACCOUNT_SETUP` row of the phone change history (see Phone Change History).
  3. Read both rows inside the transaction and return them.
- **Conflicts:** a unique violation on either `supabaseUserId` or `CustomerProfile.userId` (Prisma `P2002`, for example from a concurrent request) rolls back the transaction. The whole transaction is then retried a bounded number of times (3). On a retry, the rows committed by the other request are reused. If the retries are exhausted, the response is `503` (never a `500` with partial data).
- **Atomicity:** any failure rolls back the whole transaction, so bootstrap never leaves a `User` it created without a `CustomerProfile`. A success response is sent only after the transaction has committed with both rows present.
- **Idempotency:** repeated or concurrent calls return the same `User` and `CustomerProfile`. The response is `201` when this call created the profile, otherwise `200`.

## Editable-Field Allowlist

Customers update their profile only through `PATCH /api/v1/customers/me`. The route has no profile ID in the path, and the target is always the profile of the authenticated user.

| Field | Rule |
|---|---|
| `fullName` | string, trimmed, 1–100 characters |
| `preferredLocale` | `fr` or `ar` |
| `phone` | contact phone, required (cannot be cleared); normalized server-side to E.164 (`+` followed by 8–15 digits; an 8-digit national number gets `+222`); stored unverified |

These are the **complete** initial editable fields (confirmed product decisions). `phone` is set at bootstrap and editable here:

- **Avatar** is out of scope for the initial release (no field, no upload).
- **Email** is the authentication identity, managed by Supabase Auth. It is not a profile field and cannot be changed through Chicman in the first release (no screen, endpoint, or custom workflow; see spec 03, Sign-in Email Changes). Email-change support is a possible future enhancement.
- **Phone** is profile contact data, not authentication data. Customers may change it with no SMS OTP or other verification. A change never touches the Supabase Auth identity, never marks the number as verified, and never affects shop contact phones (spec 06). The existing profile authorization rules apply: token-scoped `PATCH`, strict schema, and rate limiting (spec 03, Abuse Protection). Every effective change is recorded in the private phone change history (see Phone Change History).
- **Other authentication data** (password, email-confirmation status, sessions) is managed by Supabase Auth.
- **Supabase user ID, role, and ownership keys** are server-managed.
- **Delivery addresses** belong to the separate address-management feature (`modules/addresses/`), not to this endpoint.

- The request body is validated with a **strict** schema that accepts only the fields above. Unknown or protected fields cause `400 Bad Request` (they are rejected, not silently dropped), and nothing is written.
- **Never editable through this endpoint:** `id`, `userId`, `supabaseUserId`, `email` and any other authentication data (managed by Supabase Auth), any phone-verification status (for example `phoneVerified`), `role`/roles, shop or ownership keys, `createdAt`, `updatedAt`, and any other server-managed field.
- The database update is built only from the validated object (`data: { fullName, preferredLocale, phone }`, only the keys present), scoped by `where: { userId: authenticatedUser.id }`. The request body is never passed to Prisma. A phone change and its history row are written in one transaction.
- Adding a new editable field requires a product decision and an update to this allowlist and its schema.

## Phone Change History

Customer phone changes are recorded in a lightweight, private history for this one field. It is **not** a generic audit platform. It is independent of the shop audit records in spec 06.

**Model** (`CustomerPhoneChange`, append-only):

| Field | Rule |
|---|---|
| `id` | server-generated |
| `customerProfileId` | foreign key to `CustomerProfile.id`, indexed |
| `actorUserId` | foreign key to `User.id`: the authenticated user resolved from the verified token, never a client value. In the initial release it is always the profile owner. It is stored explicitly so that later actors (for example an administrator) can be distinguished. |
| `changeType` | enum `CustomerPhoneChangeType { ACCOUNT_SETUP, CUSTOMER_UPDATE }` |
| `previousPhone` | the stored E.164 value before the change; `null` only for `ACCOUNT_SETUP` |
| `newPhone` | the stored E.164 value after the change |
| `createdAt` | server time, UTC |

**Rules:**

- **Same transaction:** a history row is written in the same database transaction as the phone write, so the stored phone and its history never disagree. A failure rolls back both.
  - Bootstrap writes `ACCOUNT_SETUP` only when it creates the `CustomerProfile`. Reusing an existing profile writes nothing.
  - `PATCH` with a different phone writes `CUSTOMER_UPDATE`.
- **No-op updates:** if the normalized submitted phone equals the stored one, nothing is changed and no history row is written.
- **Concurrency:** `previousPhone` is the value read inside the same transaction under a row lock (or a conditional update on the old value). Concurrent changes therefore form a consistent chain.
- **Append-only:** application code never updates history rows, and deletes them only through retention.
- **Retention: 12 months.** A history row is kept for 12 months from its `createdAt`. A scheduled cleanup job in the existing background workers (`apps/api/src/workers/`) deletes older rows. This is the only way rows are deleted. The current phone in `CustomerProfile` is never affected by retention. The cleanup is idempotent and runs in bounded batches.
- **Private:** no customer, seller, or public API returns the history in the initial release, and no admin endpoint is defined (a future admin feature would have to define one). Phone values are never written to application logs.
- **No verification state:** neither the history nor the profile has a verified flag or verification timestamp. A changed phone is unverified, like every phone in the initial release.

## Profile Settings

- The customer profile settings screen (web and mobile) shows the profile fields above and the **theme selector** (System / Light / Dark).
- The theme preference stays **device-local** (key `chicman-theme`; see `ui-context.md`). It is not a profile field and is not sent to the API.

## Implementation Details

**Backend:**
- `apps/api/src/modules/customers/`
- Customer profile Prisma model (`CustomerProfile` with `phone`), and the `CustomerPhoneChange` model and its `CustomerPhoneChangeType` enum (new migration; not yet created).

**Web:**
- `apps/web/src/features/profile/`

**Mobile:**
- `apps/mobile/lib/features/profile/`

**Do not touch:**
- Authentication provider configuration.
- Delivery address management.
- Shopping cart.
- Order management.

## Implementation Notes

**Status: Implementation complete (2026-11-07).** One verification is pending: the first scheduled 24-hour run of the retention worker. The project owner will verify it manually.

Implemented on 2026-11-05 (API).

**Status (2026-11-07):**

| Area | Status |
|---|---|
| Data model and migration (`CustomerProfile`, `CustomerPhoneChange`, constraints) | Implemented and tested (PostgreSQL) |
| Account setup `POST /customers/me` (email-confirmation check, phone, atomic idempotent bootstrap, history entry, rate limit) | Implemented and tested; verified live on the web (hosted project, 2026-11-05) |
| `GET /customers/me` | Implemented and tested |
| `PATCH /customers/me` (allowlist, phone change with history, row lock, rate limit) | Implemented and tested (API only; no UI calls it yet) |
| Phone-history retention (`purgeExpiredPhoneChanges`, 12 months, batched) | Implemented and tested. Runs persistently as the Compose `worker` service (since 2026-11-07, see Retention Worker Scheduling). Start-up runs, graceful stop, restart, crash recovery, and the single-instance guard are verified. **The first scheduled 24-hour run has not been recorded yet** (due about 2026-11-08 13:49 UTC, 24 h after the start at boot on 2026-11-07 13:49:27Z) |
| Web account-setup form and account panel (phone shown as unverified) | Implemented; verified live on the web |
| Mobile account-setup form and account screen | Implemented; widget tests pass; Android authentication manually verified by the project owner (2026-11-06) |
| Web profile settings screen (`apps/web/src/features/profile/`, route `/account/profile`): edit `fullName`, `preferredLocale`, `phone`; theme selector | Implemented (2026-11-06); unit tests pass; verified live signed in by the project owner (2026-11-07) |
| Mobile profile settings screen (`apps/mobile/lib/features/profile/`, opened from the account screen): same fields; theme selector | Implemented (2026-11-06); domain and widget tests pass; verified on Android by the project owner (2026-11-07) |

Implementation is complete. The only open item is a verification, not implementation: a scheduled 24-hour run of the retention worker must be recorded in its logs. The project owner will check it manually (see Retention Worker Scheduling, How to confirm daily runs).

**Profile settings screens (2026-11-06):**

- Both clients send only the allowlisted fields that changed (`fullName` trimmed, and NFC on web; `phone` normalized to E.164; `preferredLocale` `fr`/`ar`). An untouched form sends no request (an empty `PATCH` would be `400`). The same phone in another format is not a change.
- Client checks mirror the API: name 1–100 characters, no control characters; a set name cannot be cleared; the phone is required and cannot be cleared. The API validates again.
- Responses: `200` → saved; `400 INVALID_PHONE` → phone field error; other `400` → invalid; `401` → sign-out; `403`/`404` → back to account setup; `429` → rate-limited message; `503` (any code) or a network error → unavailable message, form kept.
- The phone stays labelled "non vérifié". `preferredLocale` is stored only; the interface language does not switch until the i18n feature exists.
- The theme selector sits in an Appearance section. It stays device-local (`chicman-theme`) and makes no API call (mobile widget test).
- Tests: web `src/features/profile/profile.test.ts` (13); mobile `test/features/profile/` (17).

The web and mobile account screens show the account-setup form and the unverified contact phone.

- **Migration `customer_profiles`:**
  - `CustomerProfile`: `fullName` is nullable until set, `preferredLocale` (enum `Locale`) defaults to `fr`, and `phone` is `VARCHAR(16)`.
  - `CustomerPhoneChange` and the enum `CustomerPhoneChangeType`, with indexes on `(customerProfileId, createdAt)` and `(createdAt)`.
  - Foreign keys are `RESTRICT`.
  - Database `CHECK` constraints: phones match E.164, and `previousPhone` is `NULL` exactly for `ACCOUNT_SETUP`.
- **Routes** (`apps/api/src/modules/customers/`):
  - `POST /customers/me` (guard `tokenOnly`, rate-limited): validates the strict body first, then runs the server-side confirmation check, then bootstraps. The body is validated before the network call, so an unconfirmed identity with an invalid body gets `400`.
  - `GET /customers/me` (guard `user`).
  - `PATCH /customers/me` (guard `user`, rate-limited).
  - Responses: `{ userId, roles, profile: { id, fullName, preferredLocale, phone, createdAt, updatedAt } }`. The phone history is never included.
- **Errors:**
  - `400 BAD_REQUEST`: unknown or protected field, wrong type, empty `PATCH`, or invalid `fullName`/locale;
  - `400 INVALID_PHONE`;
  - `403 EMAIL_NOT_CONFIRMED`;
  - `404 PROFILE_NOT_FOUND`;
  - `429 RATE_LIMITED`;
  - `503 SERVICE_UNAVAILABLE` after 3 bootstrap attempts end in unique conflicts, or when the database is temporarily unreachable or overloaded (any route; see spec 03, Implementation Notes). Other unexpected errors → `500 INTERNAL_ERROR`.
- **`fullName` input:** NFC-normalized and trimmed; control characters are rejected.
- **Phone update concurrency:** `PATCH` locks the profile row (`SELECT … FOR UPDATE`) in the transaction that writes the phone and its history row.
- **Retention:** `apps/api/src/workers/phone-change-retention.ts` deletes in batches of 1000 (at most 100 batches per run). `retention-schedule.ts` runs it at start and then every 24 hours (`RETENTION_INTERVAL_MS`). Runs never overlap, and `stop()` waits for an in-flight run. `advisory-lock.ts` holds a PostgreSQL session advisory lock (`hashtext('chicman:phone-change-retention')`) on a dedicated connection; a process without the lock skips its runs. Failures are logged with the error type, code, and stack frames only (`lib/describe-error.ts`).
- **Tests:** `apps/api/test/customers.test.ts` (PostgreSQL), `email-confirmation.test.ts`, and `rate-limit.test.ts`.

## Retention Worker Scheduling

**Mechanism (development):** the `worker` service in `infrastructure/docker/docker-compose.yml`. No queue or scheduler platform is used; the process schedules its own runs.

- **Image:** `chicman-api:dev`, built from `apps/api/Dockerfile` (repository root as the build context).
  - It installs only the API workspace dependencies (`pnpm install --frozen-lockfile --filter @chicman/api...`).
  - pnpm is cached at build time, so a start needs no network.
  - The container runs as the `node` user.
  - No env file enters the image (`/.dockerignore`); only `apps/api/.env.example` is present.
- **Command:** `pnpm --filter @chicman/api worker`, with `init: true` (tini as PID 1), `stop_grace_period: 30s`, and `restart: unless-stopped`. Docker is enabled at boot, so the worker comes back after a reboot unless it was stopped by hand.
- **Database:** `DATABASE_URL` is built from the `postgres` service's own `POSTGRES_*` variables (`postgres:5432/${POSTGRES_DB}`), the development database. `apps/api/.env` is not loaded; it holds unrelated Supabase settings and a host-only `localhost` URL.
- **Startup order:** `depends_on: postgres: condition: service_healthy, restart: true`. The worker starts only after `pg_isready` passes, and Compose restarts it when it restarts Postgres.
- **One instance:**
  - The fixed `container_name: chicman-worker` makes `--scale worker=2` fail.
  - The PostgreSQL advisory lock makes any other worker process (for example a host-run `pnpm --filter @chicman/api worker`) skip its runs.
  - If the lock connection drops, the worker exits, Docker restarts it, and it acquires the lock again.
- **Schedule:** one run at every start, then every 24 hours from that start. A restart therefore runs immediately and restarts the 24-hour clock. Both are safe, because the purge is idempotent. Retention stays 12 months.
- **Shutdown:** SIGTERM reaches the worker through tini, pnpm, and tsx. The worker stops the timer, waits for an in-flight run (each batch `DELETE` is atomic), releases the lock, disconnects, and exits with code 0.
- **Logs:** `json-file`, 10 MB × 5 files. One line per run: run number, start time (UTC), deleted row count, and next run time. The start line shows host, port, and database name only. No credentials, URLs, phone values, or error messages are logged.

**Commands** (from `infrastructure/docker`; on this machine prefix `POSTGRES_PORT=5442 REDIS_PORT=6389`, the values the running services were created with, so `postgres` and `redis` are not recreated):

```sh
docker compose build worker
docker compose up -d worker
docker compose logs -t worker            # all runs and failures
docker compose logs -t worker | grep "run #"
docker compose ps worker
docker compose stop worker / start worker / restart worker
```

**How to confirm daily runs:** a scheduled run logs `phone-change retention run #2 succeeded at <start + 24 h>` (or `#3`, … after longer uptime) without a `Worker started` line just before it. A `run #1` line always follows a start, so it is not evidence of the schedule. `docker inspect chicman-worker --format '{{.RestartCount}} {{.State.StartedAt}}'` shows whether a restart reset the clock.

**Verification evidence (2026-11-07, this machine):**

| Check | Result |
|---|---|
| Build | `chicman-api:dev` built; the only env file in the image is `.env.example` |
| Start and initial run | `Worker started …; database postgres:5432/chicman`; `run #1 succeeded at 2026-11-07T12:09:06.972Z: deleted 0 row(s) …; next run at 2026-11-08T12:09:06.972Z` |
| Keeps running after the initial run | `Up`, with one worker node process; one advisory-lock holder in database `chicman` |
| Graceful stop | `docker compose stop worker`: `Worker received SIGTERM` → `Worker stopped cleanly`, exit code 0, 0.4 s |
| Start / restart | Each produced exactly one container, one worker process, one lock holder, and a new `run #1` |
| Scale to two | `--scale worker=2` refused (custom container name); still one container |
| Second process | Host-run worker against the same database: `run #1 skipped …: another worker instance holds the retention lock` |
| Crash recovery | SIGKILL of the worker process → Docker restarted the container (restart count 0 → 1), new run succeeded, one lock holder |
| Log safety | No URL, password, token, or phone number in the worker logs |
| Postgres and Redis | Not recreated (unchanged Compose config hashes) |
| Survives shutdown and reboot | The machine shut down at 13:33: `Worker received SIGTERM` → `Worker stopped cleanly`. It booted at 13:49, and Docker started the worker automatically: `Worker started` at 2026-11-07T13:49:27Z, then `run #1 succeeded …; next run at 2026-11-08T13:49:27.698Z` |
| **24-hour scheduled run** | **Not yet recorded.** Last start at 2026-11-07T13:49:27Z (after the reboot), so the next scheduled run is due at 2026-11-08T13:49:27Z if the container is not restarted |

Tests: `apps/api/test/retention-worker.test.ts` covers the schedule (24-hour interval, start run, no overlap, graceful stop, lock skip, failure keeps the schedule) and the advisory lock against PostgreSQL.

## Verification Checklist

- [x] Customer profile is created at account setup after email confirmation, with the phone number entered there stored as unverified contact information (independent of the sign-up device). *(Verified end to end on the hosted development project, web, 2026-11-05; cross-device setup supported by design, not tested live.)*
- [x] Bootstrap for an identity whose email is not confirmed → `403` (`EMAIL_NOT_CONFIRMED`), nothing is written; the check uses Supabase Auth server-side data, never client input or `user_metadata`.
- [x] Bootstrap with a missing or invalid phone, or any other body field → `400`, nothing is written.
- [x] Bootstrap for an existing profile returns it with the stored phone unchanged.
- [x] Sign-up and email confirmation alone create no `User` or `CustomerProfile`; only a completed account setup does. *(API: no route other than bootstrap writes them; tested. Live web flow verified on the hosted project on 2026-11-05.)*
- [x] No API response or screen presents the phone number as verified. *(API tests; web and mobile label it "non vérifié".)*
- [x] Authenticated customer can retrieve their profile.
- [x] Customer can update editable profile information. *(API `PATCH` tested; web and mobile settings screens tested with fake APIs, and verified live signed in on the web and on Android by the project owner, 2026-11-07.)*
- [x] Profile update tests:
  - [x] Allowed fields (`fullName`, `preferredLocale`, `phone`) update and persist; a phone change needs no verification and stays unverified.
  - [x] An invalid or empty `phone` → `400`; the Supabase Auth user is unchanged after a phone change.
  - [x] Each protected field (`supabaseUserId`, `userId`, `id`, `email`, any phone-verification flag, `role`, ownership keys, timestamps), alone or mixed with allowed fields → `400`, nothing is written.
  - [x] Invalid values (empty `fullName`, unsupported locale) → `400`.
  - [x] A user cannot read or modify another user's profile (no ID-based route; the target always comes from the token).
- [x] Phone change history tests (against PostgreSQL):
  - [x] Bootstrap that creates the profile writes one `ACCOUNT_SETUP` row (`previousPhone` null); repeated bootstrap writes none.
  - [x] A phone change writes one `CUSTOMER_UPDATE` row with the previous value, the new value, the authenticated actor, and the time, in the same transaction.
  - [x] Submitting the same normalized phone writes no row.
  - [x] An injected failure after the phone update leaves neither the new phone nor a history row.
  - [x] Concurrent phone changes produce a consistent `previousPhone` chain.
  - [x] The retention job deletes rows older than 12 months, keeps newer rows, leaves `CustomerProfile.phone` unchanged, and is safe to run repeatedly. *(Function tested against PostgreSQL.)*
- [ ] The retention worker runs on its daily schedule in a running environment. *(Persistent Compose `worker` service since 2026-11-07: start-up runs, restart, crash recovery, and single instance verified. Stays open until a scheduled 24-hour run is recorded in `docker compose logs worker`.)*
  - [x] No customer, seller, or public API response contains the history, and no history row carries a verified flag.
- [x] Bootstrap tests (against PostgreSQL):
  - [x] A valid token without application records (pre-bootstrap) gets `403` on protected routes other than bootstrap.
  - [x] First bootstrap creates exactly one `User` (holding `CUSTOMER`) and one `CustomerProfile` → `201`.
  - [x] Repeated bootstrap reuses both records → `200`, with no new rows.
  - [x] An existing `User` with a missing `CustomerProfile` is repaired (profile created, `User` and its roles unchanged).
  - [x] Concurrent bootstrap requests for the same user produce exactly one `User` and one `CustomerProfile`.
  - [x] An injected failure after the `User` insert rolls back the transaction: no `User` is left without a profile, and a retry succeeds.
  - [x] Direct duplicate inserts for the same `supabaseUserId` or `CustomerProfile.userId` fail on the database unique constraints.
- [x] The theme selector appears in profile settings, and the preference is not sent to the API. *(Web: `ThemeSelector` writes only `chicman-theme`; mobile widget test confirms no API request.)*
- [x] Profile changes are saved in PostgreSQL.
- [x] Customer cannot access another customer's profile.
- [x] Web and mobile display the correct profile information. *(Account panel and profile settings verified live on the web and on Android by the project owner, 2026-11-07.)*