# Account Types Audit and Plan (AT-1)

Date: 2026-11-13. Status: **decision confirmed by the project owner; the 12 open questions were answered the same day (section 15) and the plan below is updated to match. Implementation has not started.** No application code, migration, database row, or Supabase setting was changed by this audit. The only database access was two read-only aggregate queries against the development database (counts and statuses, no identifiers or personal data).

Legend used below: **Existing** = what the code does today. **Required** = needed to satisfy the confirmed decisions. **Recommended** = a technical proposal within those decisions. **Qn** = the owner's answer to question n (section 15).

---

## 1. The decision (AT-1, confirmed 2026-11-13)

Chicman has three **mutually exclusive account types**: **Buyer**, **Seller**, **Administrator**. An account has exactly one type, set when the account is created, and it never changes. Each type has its own registration or provisioning, its own permissions, and its own dashboard.

- **Buyer:** public buyer registration. Browses, favorites, cart, addresses, checkout, own orders and their notifications. No shop, no seller operations, no administration.
- **Seller:** separate public seller registration that creates a Seller account and its shop application (`PENDING`) together. Seller operations only, subject to the shop status (`PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`; unchanged rules, including D8 for suspended shops). Cannot purchase.
- **Administrator:** created only by a controlled provisioning process; no public registration. Administrative operations only. Cannot purchase, cannot own a shop, has no notification audience (consistent with O6.1).

**Reasoning (as stated by the owner):** the account type becomes a fundamental, server-held property instead of something inferred from a role set, shop ownership, or the page in use. This removes whole classes of combined-role cases (administrators administering their own shop, sellers buying from themselves, buyers drifting into seller areas).

**Consequences:**
- One email address = one Supabase identity = one account = one type. A person who wants to buy and to sell needs two accounts with two email addresses.
- The current role set (`UserRole`, "every user holds `CUSTOMER`", "approval grants `SELLER`") is superseded.
- "Any registered customer may apply to become a seller" (spec 06) is superseded: shops are created only through seller registration.
- Several existing checks become structurally unreachable (O2 own-shop purchase, administrator self-administration). They are **kept** as defense in depth.
- Every account currently in the development database combines roles (section 11) and needs a deliberate migration.

---

## 2. Current account and role architecture (Existing)

**Identity.** Supabase Auth (email + password, mandatory confirmation, Turnstile). The API verifies the access token (JWKS) and takes only `sub`. Roles are **never** in token claims or `user_metadata`; they are loaded from PostgreSQL on every request. This is the right foundation and stays.

**Data model** (`apps/api/prisma/schema.prisma`):
- `enum Role { CUSTOMER, SELLER, ADMIN }` and `UserRole(userId, role)` with a composite primary key: **a user holds a set of roles**.
- `User` (id, `supabaseUserId` unique). `CustomerProfile` (one per user, required `phone`, `fullName`, `preferredLocale`) and `CustomerPhoneChange` history.
- `Shop.ownerUserId` unique (one shop per user, any roles).
- Buyer data keyed by `userId`: `CustomerAddress`, `Cart`/`CartItem`, `Favorite`, `Order.customerUserId`. `Notification.userId` for every recipient.

**How roles are granted:**
- `POST /api/v1/customers/me` (account setup, spec 04): creates `User` + `CUSTOMER` + `CustomerProfile` in one transaction (`customer.repository.ts` bootstrap). **Every** account gets `CUSTOMER`.
- Shop approval (`shop-lifecycle.ts`): grants `SELLER` to the owner on initial approval; never revoked.
- `apps/api/scripts/grant-admin.ts`: an operator adds or removes `ADMIN` on an **already bootstrapped** user (who therefore already holds `CUSTOMER`).

**Guards** (`modules/auth/auth.guards.ts`, `middleware/`):

| Guard | Rule today |
|---|---|
| `tokenOnly` | Verified token; user may not exist yet (only account setup) |
| `user` | Verified token + bootstrapped `User` (**any** roles) |
| `role("ADMIN")` | Holds `ADMIN` (may also hold anything else) |
| `approvedSeller` | Holds `SELLER` + owns a shop + `Shop.status = APPROVED` |
| `requireDeliverySeller` | Holds `SELLER` + owns a shop that is `APPROVED` or `SUSPENDED` |
| `requireOwnedShop` + `requireShopOperation` | Owns a shop (no role needed); operation allowed by status (and `SELLER` for `APPROVED`) |

**Route groups and their guard today:**

| Routes | Guard today | Who can call it today |
|---|---|---|
| `GET /session` | `user` | everyone bootstrapped |
| `POST /customers/me` | `tokenOnly` | any confirmed identity |
| `GET/PATCH /customers/me` (profile) | `user` | everyone |
| `/customers/me/addresses…`, `/cart…`, `/checkout`, `/favorites…`, `/orders…` (customer side) | `user` | **everyone, including sellers and admins** |
| `/customers/me/notifications…` | `user` | everyone (one inbox per user, two audiences) |
| `GET/POST /sellers/me/shop` | `user` | **everyone** (apply, view) |
| `PATCH /sellers/me/shop`, `…/resubmit`, `…/change-requests`, `…/logo/uploads…` | owned shop + status | any shop owner |
| `/sellers/me/products…`, `/sellers/me/orders…`, `/sellers/me/payments/summary`, `…/delivery/ready`, `…/dispatch` | `approvedSeller` | SELLER + approved shop |
| `/sellers/me/deliveries/in-progress`, `…/delivery/delivered`, `…/fail`, `…/close` | `requireDeliverySeller` | SELLER + approved or suspended shop |
| `/admin/shops…`, `/admin/orders…`, `/admin/orders/:id/payment/notes` | `role("ADMIN")` | anyone holding ADMIN (**also a shop owner and buyer**) |
| `/products`, `/products/:id`, `/products/facets` | public | anyone |

**Combined-role compensations that exist today** (all would be unnecessary under AT-1 but stay as defense in depth):
- `assertNotOwnShop` (spec 06 rule 7, spec 11, spec 13): an administrator cannot decide on their own shop.
- O2 (spec 10): checkout refuses a cart line from the buyer's own shop (`OWN_SHOP`).

**Web** (`apps/web`):
- One sign-up (`/register`) → callback → account setup (phone) → `/account`. Login always lands on `/account`.
- `/account` shows the roles and role-dependent links (`SELLER` → products, orders; `ADMIN` → `/admin/shops`); "Ma boutique" is shown to everyone.
- Storefront header shows cart, favorites, and the bell to every signed-in user.
- `/seller/*` (spec 16 shell, uncommitted): status-aware navigation, a "no shop → become a seller" state for any user without a shop.
- `/admin/*`: pages only, **no admin layout or client guard** (the API is the only gate); spec 17's protected layout is not built.

**Flutter** (`apps/mobile`): one sign-up and account setup (phone), customer storefront, cart, checkout, favorites, orders, customer notifications, and the spec 06 shop application and status screens (`features/shop/`), which O1 kept. The session shows the roles.

**Documentation** states the same multi-role model: `architecture.md` (Auth and Access Model), `project-overview.md` (flows), specs 03, 04, 06, and the comments in `grant-admin.ts`.

---

## 3. Problems and inconsistencies found

1. **Every account is a buyer.** Account setup grants `CUSTOMER` unconditionally, so sellers and administrators can use every customer route (cart, checkout, favorites, addresses, customer orders). Only O2 stops a seller from buying from their *own* shop.
2. **Administrators are created from buyer accounts.** `grant-admin.ts` adds `ADMIN` to a bootstrapped (therefore `CUSTOMER`) user; nothing stops that user from also owning a shop.
3. **Any account can apply for a shop**, including administrators (`POST /sellers/me/shop` is `guards.user`).
4. **The account type is inferred** from a role set plus shop ownership and status. `SELLER` is granted on approval, so a `PENDING` or `REJECTED` applicant is a "customer with a shop", not a seller.
5. **Administrator self-administration already happened in the data**: one `APPLICATION_APPROVED` decision in the development database was made by the shop's own owner (before or outside the `assertNotOwnShop` rule). The audit record is preserved; it is reported here, not changed.
6. **Both existing accounts combine roles** (section 11). One holds all three.
7. **No database-level protection** exists against a shop owned by an administrator, a cart or order belonging to a seller, and so on. Every rule lives in the API.
8. **Web has no area guards for `/admin`** and lands every account on `/account` after login.
9. **Flutter (O1) keeps the shop application screens**, which contradicts "buyers cannot create shops". Resolved by Q5: Flutter becomes buyer only (section 15).
10. **Spec 16's seller dashboard** (built 2026-11-11, uncommitted) assumes "a user without a shop may apply from the seller area". Under AT-1 that state disappears for sellers, and buyers must not see the seller area at all.
11. **Notifications:** one inbox per user carrying both customer and seller audiences; the administrator in the development data has 4 notifications from their buyer and seller activity. AT-1 hides them (no administrator audience), which is consistent with O6.1.

---

## 4. Proposed final account model

### 4.1 Data (Required)

- **`User.accountType`**: new `enum AccountType { BUYER, SELLER, ADMIN }`, `NOT NULL`, set only at creation. It is the single source of truth.
- **Immutable:** a `BEFORE UPDATE` trigger rejects any change of `accountType` (Required). No API, script, or migration path changes it after the AT-1 data migration itself.
- **`UserRole` / `Role`**: superseded. Recommended: keep the table read-only for one release (no writes, not read by guards), then drop it in a later migration once nothing reads it. The `SELLER` grant in `shop-lifecycle.ts` and the `ADMIN` grant script are removed.
- **Profile (Q2, Q3 decided):** every account type has a personal profile (`fullName`, `preferredLocale`, personal `phone`). One profile table for all types (renaming `CustomerProfile` to `AccountProfile` is optional and cosmetic). The personal phone is **required for Buyers and Sellers and optional for Administrators**: the column becomes nullable, with the profile carrying its account type (composite key to `User(id, accountType)`) and `CHECK (accountType = 'ADMIN' OR phone IS NOT NULL)`.
- **Administrator deactivation (Q7 decided):** `User.adminAccessDeactivatedAt` (nullable). When set, every administrative route refuses the account (`403`); the type stays `ADMIN` and is never converted. Each deactivation appends an audit record (section 6).
- **Shop:** unchanged columns; one shop per Seller account (still `ownerUserId` unique).

### 4.2 Database-level type protection

**Implemented with triggers instead (phase 4, 2026-11-13).** Prisma cannot model the composite keys below without overlapping relations on six models, and reads `NOT VALID` keys as schema drift. Row triggers (which Prisma ignores) enforce the same rules, need no extra columns, and, like `NOT VALID`, run only when the owner or customer column is written, so pre-AT-1 rows stay untouched. See migration `account_types_contract`. The original design follows for reference.

PostgreSQL can enforce "only a Seller owns a shop" and "only a Buyer has a cart, favorites, addresses, or orders" declaratively:

1. `User`: add `UNIQUE (id, accountType)`.
2. In each dependent table add a constant type column with a check, and a composite foreign key:
   - `Shop(ownerUserId, ownerAccountType)` with `CHECK (ownerAccountType = 'SELLER')` → `User(id, accountType)`.
   - `Cart`, `Favorite`, `CustomerAddress`: `(userId, userAccountType)` with `CHECK (= 'BUYER')`.
   - `Order(customerUserId, customerAccountType)` with `CHECK (= 'BUYER')`.
3. Because existing rows violate these (section 11), add the composite foreign keys **`NOT VALID`**: PostgreSQL then enforces them for every new or changed row and leaves historical rows untouched. Legacy rows are preserved (Q9), so the keys are never validated against them.

An alternative is triggers on insert. The composite key is preferred because it is declarative, cheap, and cannot be bypassed by a code path that forgets a check.

### 4.3 Server-side resolution (Required)

`loadAppUser` returns `{ id, accountType }` from PostgreSQL by the verified `sub`, as today. Nothing comes from token claims, `user_metadata`, request bodies, or client state. A change of type through `PATCH` is impossible: the profile allowlist has no such field, and the trigger rejects it anyway.

---

## 5. Registration flows

Both flows reuse the same Supabase sign-up, confirmation, Turnstile, rate limits, and callback. **Only the account-setup step differs**, and it is where the type is fixed, server-side, after email confirmation.

### 5.1 Buyer (Required)

1. `/register` (existing form). Email + password + Turnstile. Confirmation email.
2. Callback → buyer account setup (existing screen: phone).
3. **`POST /api/v1/accounts/me/setup`** with the phone (5.3; today `POST /customers/me`), `tokenOnly`, server-side confirmation check (unchanged). The `BUYER` intent selects the type. One transaction: `User(accountType = BUYER)` + profile + phone history + intent consumed. Idempotent.
4. If the identity already has a `User` of another type → **`409 ACCOUNT_TYPE_CONFLICT`**, nothing written.
5. Redirect to the buyer area (`/account`), then the existing address prompt (spec 05).

### 5.2 Seller (Required)

1. **Separate entry point** on the web only (`/register/seller`; implemented there rather than under `/seller`, whose pages all sit in the Seller-only area), reached from the public "Vendre sur Chicman" link (Q10). Same email + password + Turnstile.
2. Callback → seller account setup: personal contact phone (Q2) **and** the spec 06 application fields (`shopName`, `description`, `contactPhone`, `whatsappPhone`, `city`, `address`; same allowlist and validation).
3. The same **`POST /api/v1/accounts/me/setup`**, with the phone and the application fields; the `SELLER` intent selects the type. One transaction: `User(accountType = SELLER)` + profile + `Shop(status = PENDING)` + its `ShopStatusEvent` (submission) + intent consumed. Idempotent on retries; an identity that already has another type → `409 ACCOUNT_TYPE_CONFLICT`.
4. Redirect to `/seller` (pending state). Logo upload, editing, resubmission, change requests: unchanged spec 06 flows afterwards.
5. **No buyer permissions at any point:** the account never holds a buyer type, so every buyer route refuses it.

### 5.3 Registration intent, kept server-side (Q4 decided)

The chosen type must survive email confirmation on another device, through a **server-side registration intent**, not client state. The app database is a separate PostgreSQL from the hosted Supabase project, so the API records the intent itself:

1. The client signs up with Supabase as today (email, password, Turnstile). With confirmation required, Supabase returns the new identity's `user.id` and no session.
2. The client immediately calls **`POST /api/v1/registration-intents`** with `{ supabaseUserId, accountType }`, where `accountType` is `BUYER` or `SELLER` (never `ADMIN`; the schema rejects it). No session exists yet, so the route is unauthenticated, rate-limited per IP, and **write-once**: the first intent for an identity is kept; a different later value → `409 REGISTRATION_INTENT_CONFLICT`, the same value → `200`. The answer is the same whether or not the identity exists, so it reveals nothing.
3. The confirmation link opens on any device. Account setup is one endpoint, **`POST /api/v1/accounts/me/setup`** (`tokenOnly`, confirmed email checked server-side), which reads the intent **by the verified `sub`** and creates that type: Buyer (phone) or Seller (phone + the spec 06 application fields, shop `PENDING`). The client sends no type. The intent is marked consumed in the same transaction.
4. **Missing intent** (the call in step 2 failed, or a pre-AT-1 identity): setup answers `409 REGISTRATION_INTENT_REQUIRED`; the setup screen asks "acheteur ou vendeur", records the choice through the same intent endpoint (write-once), and retries. It is still a server-side record.
5. Intents not consumed after 30 days are deleted by a worker job, which never touches a consumed intent. A registration attempt with an email that already exists gets an obfuscated identity from Supabase, so its intent row is never used and expires.

Why this is safe: only the identity's creator receives its `user.id` before confirmation, and the ID is random (UUID v4). Writing an intent for someone else's identity would require that ID, and write-once stops later changes. Either value is a public type the person could choose anyway; `ADMIN` can never be written. `user_metadata` is not used.

Alternative considered and not chosen: putting an opaque intent reference in `emailRedirectTo`. It depends on Supabase's redirect allowlist accepting query strings, and the reference travels in a URL the user can edit.

**Flutter (Q5):** the app only ever writes `BUYER` intents.

### 5.4 Endpoints that change

- `POST /sellers/me/shop` (create a shop from an existing account): **removed** for normal use. Recommended: keep it callable only by a Seller account that has no shop (a repair path, for example after a failed migration step); buyers and administrators get `403`.
- `POST /customers/me`: **removed** (Q11 decided). Backward compatibility does not require it: there is no production release and no store build, only development builds that ship with the same change. If a compatibility need appears before release, an alias may forward only to the intent-based setup, which can never create an ambiguous or multi-role account.

---

## 6. Administrator provisioning (Required)

- **No public path.** Neither setup endpoint can create `ADMIN`.
- **New operator script** `admin:provision` (replaces `admin:grant`):
  1. The operator creates or invites the identity in Supabase (dashboard), and the person confirms the email and sets a password. The identity must **not** have completed buyer or seller setup, and its registration intent, if any, is ignored and deleted.
  2. `pnpm --filter @chicman/api admin:provision -- --supabase-user-id <uuid>` creates `User(accountType = ADMIN)` + profile in one transaction. It **refuses** if any `User` already exists for that identity (no conversion of a buyer or seller), and prints only the outcome.
  3. `--list` keeps working (type instead of roles).
- **Deactivation (Q7 decided):** `admin:deactivate -- --supabase-user-id <uuid> --reason "…"` sets `User.adminAccessDeactivatedAt` and appends an `AdminAccessEvent` (account, action, reason, operator note, time) in one transaction. The `admin` guard refuses a deactivated account on its next request (types are read from PostgreSQL each time), so no token revocation is needed. The account is never converted to another type. Reactivation was not decided and is not provided.
- An administrator's personal phone is optional (Q3), so provisioning needs no phone.
- Every administrative route requires `accountType = ADMIN`. The administrator area has no buyer or seller features and no notification inbox.

---

## 7. Role and permission matrix (Required)

`—` = refused by the API (`403`; a resource scoped to another account stays `404` as today). Guests keep public catalog access.

| Capability | Guest | Buyer | Seller | Admin |
|---|---|---|---|---|
| Public catalog, product pages, search (specs 08, 18) | yes | yes | yes, read only (Q6) | yes, read only (Q6) |
| Buyer registration / setup | start | — (already set up) | `409` | `409` |
| Seller registration / setup | start | `409` | — (already set up) | `409` |
| Own profile, language, theme (spec 04) | — | yes | yes | yes |
| Addresses (spec 05) | — | yes | — | — |
| Cart (spec 09) | — | yes | — | — |
| Checkout (spec 10) | — | yes | — | — |
| Own orders, cancel own pending order (spec 11) | — | yes | — | — |
| Favorites (spec 14) | — | yes | — | — |
| Notifications inbox (spec 15) | — | own, customer audience | own, seller audience | — |
| View own shop and its status (spec 06) | — | — | yes, any status | — |
| Edit application, logo (spec 06) | — | — | `PENDING`, `REJECTED`, `APPROVED` | — |
| Resubmit (spec 06) | — | — | `REJECTED` | — |
| Change request for name or city (spec 06) | — | — | `APPROVED` | — |
| Delivery fee (D2) | — | — | as spec 06 edit rules | — |
| Products, stock, images (spec 07) | — | — | `APPROVED` | — |
| Seller orders: list, confirm, reject, cancel (spec 11) | — | — | `APPROVED` | — |
| Delivery: ready, dispatch (spec 12) | — | — | `APPROVED` | — |
| Delivery: delivered + cash, fail, close, in-progress list (specs 12, 13; D8) | — | — | `APPROVED`, or `SUSPENDED` on deliveries under way | — |
| Collection summary (spec 13) | — | — | `APPROVED` | — |
| Shop decisions, change-request decisions (spec 06) | — | — | — | yes (own-shop check kept) |
| Order oversight: read, cancel, payment note (specs 11, 13, 17) | — | — | — | yes (own-shop check kept) |
| Record a registration intent (5.3) | yes (write-once, `BUYER` or `SELLER`) | — | — | — |
| Administrator provisioning and deactivation | — | — | — | operator scripts only; a deactivated administrator is refused everywhere administrative |

Unchanged and not weakened: shop ownership resolved from the authenticated account only; order isolation per buyer and per shop; staged delivery details (D11); D8's narrow suspended-shop guard; administrator reasons kept internal; `assertNotOwnShop` and O2 kept.

---

## 8. Feature-by-feature impact

| Spec | Existing | Required change | Recommended |
|---|---|---|---|
| 03 Authentication | One sign-up; roles from PostgreSQL; `/session` returns roles | Two registration entry points (seller on the web only); server-side registration intent; one intent-based setup endpoint; `accountType` in `/session`; post-login routing by type | — |
| 04 Profile | Bootstrap grants `CUSTOMER` + profile with required phone | Setup creates the intended type; a profile for every type; phone required for Buyers and Sellers, optional for Administrators; no type field editable | One profile table for all types |
| 05 Addresses | `guards.user` | Buyer only | Composite FK `NOT VALID` |
| 06 Shops | Any user applies; approval grants `SELLER`; Flutter application screens | Shop created only by seller setup (web); no role grant; seller-only owner routes; `requireShopOperation` drops the role check (type + status); Flutter shop screens removed (Q5) | Keep `POST /sellers/me/shop` only as a seller repair path |
| 07 Products | `approvedSeller` (SELLER role + approved) | Guard reads `accountType = SELLER` | — |
| 08 Discovery | Public; add-to-cart and heart shown to every signed-in user | Hide or disable buy and favorite actions for sellers and admins (API refuses anyway) | "Seller account: browsing only" note on product pages |
| 09 Cart | `guards.user` | Buyer only | Composite FK `NOT VALID` |
| 10 Checkout | `guards.user`; O2 check | Buyer only; O2 kept (defense in depth) | — |
| 11 Orders | Customer routes `guards.user`; admin routes `role("ADMIN")` | Customer routes buyer only; seller routes seller; admin routes admin; self-administration check kept | `Order` composite FK `NOT VALID` |
| 12 Delivery | `approvedSeller` / `requireDeliverySeller` (role-based) | Guards read the type; D8 unchanged | — |
| 13 COD | Seller summary `approvedSeller`; admin notes `role("ADMIN")` | Guards read the type | — |
| 14 Favorites | `guards.user` | Buyer only | Composite FK `NOT VALID` |
| 15 Notifications | One inbox per user; audiences CUSTOMER and SELLER; no admin audience | Buyer reads customer audience, seller reads seller audience, admin `403`. Recipients are already the buyer (`customerUserId`) or the shop owner; no recording change | Old rows of reclassified accounts are kept, not shown to the wrong type (section 11) |
| 16 Seller dashboard | Shell for any signed-in user; "no shop → apply" state | Seller only; buyers and admins redirected to their area; the no-shop state becomes a repair case only; restricted states by status unchanged | Account page link "Ma boutique" goes away for buyers |
| 17 Admin dashboard | Not built; pages without a client guard | Protected admin layout requires an active `ADMIN`; provisioning and deactivation per section 6; "never on own shop" kept | Admin area without bell (as O6.1) |
| 18 Search | Not built; public | None beyond spec 08's actions | — |

No impact found on: specs 01, 02; `CATALOG_INTERNAL_KEY`; storage and media; the worker jobs (expiry, reminders, auto-close, retention), which act on records, not account types.

---

## 9. Database schema changes (Required unless marked)

Two migrations (nothing already applied is edited), split so the code keeps working between phases:

- **Expand** (`20261113120000_account_types_expand`, phase 3, **done 2026-11-13, applied to the test database only**): items 1, 3, 4 (column, check, and `AdminAccessEvent`), 6, 7, plus the nullable `accountType` of item 2. Additive; the current code is unaffected.
- **Contract** (`20261113140000_account_types_contract`, phase 4, **done 2026-11-13, applied to the test database only**): stops unless every account is classified, then `SET NOT NULL` of item 2, item 5 (as a trigger), item 8 (as triggers, see 4.2), and drops the now unused `UNIQUE (id, accountType)`. The backfill itself is done beforehand by the reviewed classification script (`accounts:classify`), not by the migration.

**Runbook for a database with accounts (phase 6).** `prisma migrate deploy` cannot stop between the two migrations: (1) deploy: expand applies, contract stops on the unclassified accounts and changes nothing; (2) `accounts:classify` dry run, owner review, `--apply --approve <digest>`; (3) `prisma migrate resolve --rolled-back 20261113140000_account_types_contract`; (4) deploy again. Rehearsed on the test database on 2026-11-13.


1. `CREATE TYPE "AccountType" AS ENUM ('BUYER', 'SELLER', 'ADMIN')`.
2. `ALTER TABLE "User" ADD COLUMN "accountType" "AccountType"` (nullable during the backfill), backfill per section 11, then `SET NOT NULL`.
3. `UNIQUE ("id", "accountType")` on `User`; `BEFORE UPDATE` trigger rejecting a change of `accountType`.
4. `User.adminAccessDeactivatedAt timestamptz NULL` and `CHECK (adminAccessDeactivatedAt IS NULL OR accountType = 'ADMIN')`; new append-only `AdminAccessEvent` (user, action `DEACTIVATED`, reason, operator note, time).
5. Profile: `phone` nullable; profile carries its account type with a composite key to `User(id, accountType)` and `CHECK (accountType = 'ADMIN' OR phone IS NOT NULL)` (Q3).
6. New `RegistrationIntent` (`supabaseUserId` primary key, `accountType` with `CHECK (accountType IN ('BUYER', 'SELLER'))`, `createdAt`, `consumedAt`), section 5.3; index on `createdAt` for the 30-day cleanup.
7. New append-only `ShopOwnershipEvent` (shop, previous owner, new owner, reason, operator note, time) for the approved transfer (Q8).
8. Composite foreign keys `NOT VALID` for `Shop`, `Cart`, `Favorite`, `CustomerAddress`, `Order` as in 4.2. Q9 decided that legacy rows are preserved, so these are **never** validated against them.
9. `UserRole` and `Role`: no longer written; dropped in a later migration after one release.
10. Seed and test fixtures create accounts with an explicit type.

The backfill **does not run automatically against an ambiguous account**: the migration aborts if any `User` would be classified without an explicit owner decision (section 11.3). This keeps the migration safe on the hosted database and any other environment.

---

## 10. API authorization changes (Required)

- `AppUser = { id, accountType }`; `UserRepository` selects `accountType`.
- New guards replacing `role(...)`: `buyer`, `seller` (any shop status), `approvedSeller` (seller + approved), `deliverySeller` (seller + approved or suspended), `admin` (`ADMIN` and `adminAccessDeactivatedAt` is null).
- New routes: `POST /registration-intents` (unauthenticated, rate-limited, write-once) and `POST /accounts/me/setup` (`tokenOnly`, intent-based); `POST /customers/me` removed (Q11). Profile reads and updates move to `GET/PATCH /accounts/me` for every type.
- New worker job: delete unconsumed registration intents older than 30 days. `user` remains for routes open to every type (`/session`, profile).
- Apply them per the matrix: every `/customers/me/*` buyer route moves from `user` to `buyer`; shop owner routes to `seller`; admin routes to `admin`; notifications to `buyer | seller`, each scoped to its audience.
- `requireShopOperation` / `isShopOperationAllowed`: replace the role parameter with the account type (a Seller is required; status rules unchanged).
- `shop-lifecycle.ts`: remove the `SELLER` grant on approval. Keep `assertNotOwnShop`.
- `checkout.service.ts`: keep O2.
- `/session` returns `{ userId, accountType }` (no `roles`; Q11: no compatibility window needed).
- New error codes `ACCOUNT_TYPE_CONFLICT` and `REGISTRATION_INTENT_CONFLICT` (`409`); `403` for a route of another type.
- Tests: an authorization matrix test that calls **every** route with each account type and expects the matrix in section 7 (API, PostgreSQL), plus the existing ownership, isolation, D8, and self-administration tests.

---

## 11. Existing accounts: classification and migration

### 11.1 What exists (development database, read-only check on 2026-11-13)

Two accounts, both with a profile. **There is no single-role account.**

| Account | Roles | Shop | Buyer data | Seller data |
|---|---|---|---|---|
| A | `ADMIN`, `CUSTOMER`, `SELLER` | `APPROVED`, 5 products, all `PUBLISHED`, 0 shop orders received | 1 order placed (from B's shop, `DELIVERED`, payment `COLLECTED`), 1 address, 2 cart items, 0 favorites | 4 notifications (buyer and seller events) |
| B | `CUSTOMER`, `SELLER` | `APPROVED`, 1 product `PUBLISHED`, 1 shop order (A's, delivered) | 0 orders, 1 address, 1 cart item, 0 favorites | 2 notifications |

Also: one `APPLICATION_APPROVED` decision was made by the shop's own owner (problem 5). The only order is closed, so no order, delivery, or payment is in flight.

The test database is reset by the test suites and needs no migration. The hosted Supabase project's identities without an application `User` (signed up, never set up) have no type yet and simply choose a flow at setup. They cannot be listed without the Supabase secret key, which the API no longer has.

### 11.2 Classification rule (Required)

| Current roles | Becomes | Note |
|---|---|---|
| `CUSTOMER` only | Buyer | none exist today |
| `CUSTOMER` + `SELLER`, or a `CUSTOMER` that owns a shop | Seller | buyer data kept, unreachable |
| anything with `ADMIN` | Administrator | shop and buyer data kept, unreachable |

The migration script lists every account with its proposed type and its incompatible data and **requires the owner's approval of that list** before writing (dry run first).

### 11.3 Proposed handling (Recommended, nothing transferred or deleted automatically)

**Account B → Seller.** Its shop, product, received order, and history stay as they are. Its address and cart line remain stored with their ownership but no route serves them to a Seller (Q9). The composite foreign keys are `NOT VALID`, so these rows do not block the migration.

**Account A → Administrator.** Its admin decisions and audit records stay attributed to it. Its order stays in B's history (the customer side is still correct; A simply cannot open the buyer view any more). Its address, cart, and notifications remain stored and unreachable.

**Account A's test shop** (approved, 5 published products, no orders). It must not stay operable by an administrator, and it must not stay purchasable with no one able to operate it. Proposed steps, **each run only with the owner's explicit approval**:
1. Create a **new Seller account** with a new email through the seller registration (normal confirmation), but stop before it creates a new shop. This needs a provisioning variant `seller:provision --supabase-user-id …` that creates a Seller account without a shop, or the repair path in 5.4.
2. An operator script `shop:transfer-owner --shop <id> --to <supabaseUserId>` that: requires the target to be a Seller account without a shop; moves `Shop.ownerUserId` in one transaction; appends an ownership-change audit record (new `ShopOwnershipEvent`: shop, from, to, operator note, time); changes nothing else (products, images, status, history).
3. Until the transfer is done, run the migration in a maintenance window, or have **another** administrator suspend the shop (self-administration forbids A from doing it).

Q8 decided: **transfer to a newly created Seller account through an audited, explicitly approved operation** (steps 1 and 2). Suspension or unpublishing are not used. The transfer runs only after the owner approves the specific shop and target account at that time; nothing is transferred automatically.

### 11.4 Sessions and tokens

Roles were never in JWT claims, and the type will not be either. Existing sessions keep working; the next request resolves the new type from PostgreSQL. No token revocation is needed. Clients hold cached roles in memory (web account page, Flutter session): they must read `accountType` after the deployment, and an outdated client gets `403` on routes of another type, which is safe.

---

## 12. Web and Flutter changes

### Web (Required)
- **Registration:** `/register` (buyer, existing) and `/seller/register` (new). Account setup split: buyer setup (phone) and seller setup (phone + spec 06 application fields, reusing the spec 06 form logic).
- **Callback:** routes by the flow hint (5.3) to the matching setup screen.
- **After login:** redirect by `accountType`: Buyer → `/account`, Seller → `/seller`, Admin → `/admin`; pre-setup identities → setup.
- **Area guards** (client side, in addition to the API): the buyer area (`/account`, `/cart`, `/checkout`, `/favorites`, `/notifications`), `/seller/*`, and `/admin/*` each redirect another type to its own dashboard. Per the instant-navigation rule (spec 16 fix), the guards live inside the pages or a wrapper inside `{children}`, never as a layout that drops `{children}`.
- **Storefront header:** cart, favorites, and bell for buyers only; an "Espace vendeur" or "Administration" link for the other types; a public "Vendre sur Chicman" link to `/seller/register` (Q10). A signed-in account that opens it is told that selling needs a separate account with another email (Q12).
- **Product pages:** add-to-cart and heart hidden or replaced by a short note for sellers and admins.
- **Account page:** no roles list; the seller and admin links move to their dashboards.
- **Seller dashboard (spec 16):** remove the "no shop → apply" path for buyers; keep the status states.
- **Admin dashboard (spec 17):** protected layout and navigation; no bell.
- **Logout and switching:** no in-app account switching. A person with two accounts signs out and signs in with the other email (one session at a time).

### Flutter (Required; Q5 decided: buyer only)
- Sign-up writes a `BUYER` intent only; account setup and session read `accountType`.
- A Seller or Administrator account that signs in sees a screen saying the account is managed on the web ("Votre compte vendeur se gère sur le web" / administration), with sign-out. No buyer screen is reachable.
- `features/shop/` (shop application, status, editing, logo) is **removed**. This supersedes O1's clause that kept those screens. Seller registration and shop management are web only.

---

## 13. Risks, edge cases, and compatibility

- **Losing access to buyer history:** after reclassification, A and B cannot see their old carts, addresses, and (for A) their order from the buyer side. Data is kept; only access changes. Acceptable for test accounts; would need communication for real users.
- **Unoperated published products** (A's shop) between reclassification and transfer: buyers could order from a shop no one can confirm (orders would expire after 48 h, spec 11). Mitigated by the order of operations (section 14) or a suspension by another administrator.
- **Only one administrator:** today A is the only administrator. Self-administration rules plus AT-1 mean A cannot act on its own test shop. A second administrator should be provisioned before or during the migration.
- **Same email for two types:** impossible by design. Users must use two addresses.
- **Abandoned setups:** an identity that confirmed the email but never completed setup has no type. It can still choose a flow; that is intended.
- **Wrong flow chosen (Q12):** no self-service conversion. The person creates a new account with another email.
- **Race between the two setup endpoints** on one identity: both run in a transaction on `User.supabaseUserId` (unique); the loser gets `409 ACCOUNT_TYPE_CONFLICT`. Covered by a concurrency test.
- **Backward compatibility (Q11):** no production release or store build exists, so the API contract changes with the clients and `POST /customers/me` is removed. An old development build gets `404` on setup and must be updated.
- **Registration intent call fails** after a successful sign-up: the setup screen asks for the type and records it (5.3, step 4).
- **Re-registration of an unconfirmed email with the other type:** Supabase returns the same identity; the write-once intent answers `409`, and the screen explains that the account is already being created as the first type.
- **Deactivated administrator** keeps a valid Supabase session but every administrative route refuses it; their profile stays readable to themselves.
- **`NOT VALID` constraints** leave legacy rows unchecked until validated; any later update of such a row is checked and would fail (for example, editing A's old address is impossible anyway, because no route serves it).
- **Supabase `user_metadata`** stays untrusted; a modified client cannot pick ADMIN, and cannot change its type after setup.

---

## 14. Implementation phases (Recommended order)

Each phase is a separate, verifiable step (ai-workflow-rules). None starts before this plan is approved.

1. **Decisions:** done (section 15, answered 2026-11-13). **Awaiting the go-ahead to start phase 2.**
2. **Shared contracts:** `AccountType`, registration intent, setup and session contracts, new error codes. **Done 2026-11-13** (`packages/shared/src/accounts/account-types.ts`; additive, the role and session types stay until phase 4).
3. **Database (expand):** the expand migration of section 9, applied to the test database; the classification script `accounts:classify` (dry run by default; writes only `User.accountType`, only with `--apply --approve <digest>` of the reviewed plan, refuses while any account is blocked or the column is missing). **Done 2026-11-13.** Development dry run: account B → Seller (address and cart kept, unreachable), account A → Administrator (shop, order, address, cart, notifications kept, unreachable), 0 blocked, digest `757b49cb…86eb`. Not applied anywhere but the test database.
4. **API and contract migration** (**done 2026-11-13**; see the progress tracker): registration intents and intent-based setup, type-based guards route by route, removal of the `SELLER` grant and `POST /customers/me`, `/accounts/me`, `admin:provision` and `admin:deactivate`, the intent cleanup job, and the full authorization-matrix test.
5. **Operator tools for the migration** (**done 2026-11-13**): `seller:provision -- --supabase-user-id <uuid> --phone <number>` (Seller account without a shop, for an identity with no account; refuses a buyer intent; consumes a seller intent) and `shop:transfer-owner -- --shop <id> --to <supabaseUserId> --reason "…" [--note]` (dry run with a digest; `--apply --approve <digest>` writes only that transfer, rechecked under the shop row lock: `Shop.ownerUserId` and one `ShopOwnershipEvent`, nothing else; the target must be a Seller without a shop; **refused while the shop has pending or confirmed orders**, an operator safety rule added in phase 5 so that confirmations and deliveries never change hands mid-way; account A's shop has none).
6. **Development data migration** (owner present; **done 2026-11-13**: migrations by the runbook, classification with the reviewed digest, second administrator and the replacement Seller provisioned, shop "vibe" transferred with the approved digest; see the progress tracker): provision a second administrator; create A's replacement Seller account with a new email; apply the migration; transfer the test shop after explicit approval; verify.
7. **Web** (**done 2026-11-13**; see the progress tracker): buyer and seller registration, intent call, setup by intent (with `GET /registration-intents/me`, added to the API so the setup screen knows which form to show), post-login redirect, area guards, header and "Vendre sur Chicman", read-only catalog for sellers and admins, account page, spec 16 adjustments, admin layout (start of spec 17).
8. **Flutter** (**done 2026-11-13**; see the progress tracker): buyer only; non-buyer screen; remove `features/shop/`.
9. **Documentation and tracker** updated to "implemented"; manual verification by the owner.
10. Later release: drop `UserRole`/`Role`. The composite keys stay `NOT VALID` because legacy rows are preserved (Q9).

---

## 15. Owner decisions on the open questions (2026-11-13)

All 12 questions were answered by the project owner on 2026-11-13. No question remains open.

| # | Question | Decision |
|---|---|---|
| Q1 | Chicrim or Chicman | **Chicman** is the product name. |
| Q2 | Personal profiles | All three account types have a personal profile. |
| Q3 | Personal phone | Required for Buyers and Sellers; optional for Administrators. |
| Q4 | Confirmation on another device | The chosen type is preserved through a **server-side registration intent**, not client state (mechanism in 5.3). |
| Q5 | Flutter shop application | Flutter is **buyer only**. Seller registration and shop management are web only. Supersedes O1's clause keeping the Flutter shop screens. |
| Q6 | Catalog browsing | Sellers and Administrators may browse the public catalog read only; no buyer operation. |
| Q7 | Removing an administrator | Deactivate administrative access without converting the account to another type. |
| Q8 | Account A's test shop | Transfer to a newly created Seller account through an audited, explicitly approved operation. |
| Q9 | Old buyer data | Preserve historical records and ownership; never expose buyer functionality to reclassified accounts. |
| Q10 | "Sell on Chicman" | A public "Vendre sur Chicman" link leading to seller registration. |
| Q11 | Old setup endpoint | Kept only if backward compatibility requires it, and never able to create an ambiguous or multi-role account. Assessed: not required (no production release), so it is removed. |
| Q12 | Wrong account type | A new account with a different email; no self-service type conversion. |

**Implementation choices made inside these decisions** (technical, reviewable before phase 2): the intent is recorded by `POST /registration-intents` keyed by the new identity's ID, write-once, expiring after 30 days unconsumed (Q4); deactivation is a timestamp plus an audit record, with no reactivation path because none was decided (Q7); `POST /customers/me` is removed (Q11).

## 16. Verification checklist (for implementation)

**Automated (API, PostgreSQL):**
- [ ] Authorization matrix: every route × {guest, Buyer, Seller (each status), Admin} matches section 7.
- [ ] Buyer setup creates only `BUYER`; seller setup creates `SELLER` + `PENDING` shop atomically; neither can create `ADMIN`.
- [ ] Setup with the other type → `409 ACCOUNT_TYPE_CONFLICT`, nothing written; concurrent setups of both types on one identity → one wins, one `409`.
- [ ] `accountType` cannot be changed by any API request; the trigger rejects a direct `UPDATE`.
- [ ] Composite keys reject a new shop owned by a non-Seller and a new cart, favorite, address, or order for a non-Buyer.
- [ ] Approval grants no role; suspension and reinstatement unchanged; D8 unchanged.
- [ ] `assertNotOwnShop` and O2 still tested.
- [ ] Notifications: buyer sees customer audience, seller sees seller audience, admin `403`.
- [ ] `admin:provision` refuses an identity that already has an account; a deactivated administrator gets `403` on every administrative route and stays `ADMIN`.
- [ ] Registration intent: write-once (`409` on a different value), `ADMIN` rejected, same answer for unknown identities, consumed by setup, unconsumed intents purged after 30 days; setup without an intent asks and records the choice.
- [ ] Profile phone: required for Buyer and Seller setup, optional for Administrators (database check).
- [ ] Shop transfer: only to a Seller without a shop, one `ShopOwnershipEvent`, nothing else changed.
- [ ] Migration dry run classifies the fixtures as expected and aborts on an unapproved ambiguous account.

**Automated (web, Flutter):** routing by type, area guards, header actions per type, the "Vendre sur Chicman" link, setup screens with and without an intent; Flutter writes only `BUYER` intents and shows the non-buyer screen; no shop screen remains in Flutter.

**Manual (owner):**
- [ ] Buyer registration end to end (web and Android); seller registration end to end (web); confirmation link opened on another device for each flow.
- [ ] Each type lands on its dashboard after login; typing another area's URL redirects.
- [ ] A seller cannot add to cart or favorite; an administrator cannot either; neither sees a bell outside their area (admin: none).
- [ ] Development migration: A is Administrator, B is Seller, the test shop has its new Seller owner with an ownership record, every product, order, payment, and audit record still present.
