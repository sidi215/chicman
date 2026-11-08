# Architecture Context

## Stack

| Layer | Technology | Role |
|---|---|---|
| Web Framework | Next.js + TypeScript | Customer storefront, seller dashboard, and admin dashboard |
| Web UI | Tailwind CSS + shadcn/ui | Web interface and reusable components |
| Mobile Framework | Flutter + Dart | Customer and seller mobile applications |
| Mobile UI | Flutter Material 3 (customized) | Native mobile interface following the shared design system |
| Backend | Node.js + Express + TypeScript | REST API and centralized marketplace business logic |
| Authentication | Supabase Auth | Email + password authentication with mandatory email confirmation, email password recovery, and session management for customers, sellers, and administrators |
| Bot Protection | Cloudflare Turnstile (verified by Supabase Auth CAPTCHA protection) | CAPTCHA on sign-up, login, and password recovery, in addition to rate limits |
| Authorization | Express middleware + PostgreSQL | Role-based and resource-level access control |
| Database | PostgreSQL | Primary source of truth for marketplace data |
| ORM | Prisma | Database access, schema management, and migrations |
| Object Storage | S3-compatible API — SeaweedFS (local), Cloudflare R2 (production) | Product images, shop images, and other uploaded media |
| Search Engine | Meilisearch | Product search, filtering, and indexing |
| Cache / Queue | Redis | Caching, background jobs, and asynchronous processing |
| Notifications | Application notification service; account emails sent by Supabase Auth (Resend through Supabase custom SMTP in production; Inbucket locally) | Customer and seller notifications; email confirmation and password recovery messages. No SMS provider at initial launch (an SMS channel, for example for future phone verification, may be added later). |
| Maps | MapLibre + OpenStreetMap (OpenFreeMap vector tiles, configurable style URL) | GPS location visualization and delivery location selection (`maplibre-gl` on the web, `maplibre_gl` on Flutter) |
| Package Management | pnpm Workspaces (root) | Shared TypeScript packages between web and backend, plus the design-token generator; Flutter is managed independently with pub |
| Containerization | Docker | Consistent development and deployment environments |
| CI/CD | GitHub Actions | Automated testing and deployment |
| Infrastructure | VPS / Cloud Hosting + Cloudflare | Application hosting, DNS, CDN, and security |

## System Boundaries

- `apps/web/` — Next.js application responsible for the customer storefront, seller dashboard, and administrator dashboard.

- `apps/mobile/` — Flutter application responsible for mobile customer and seller experiences. Seller product management on mobile is a future feature that reuses the existing `/api/v1/sellers/me/products` routes.

- `apps/api/` — Node.js + Express backend responsible for REST endpoints, request validation, authentication verification, authorization, and marketplace business logic.

- `apps/api/src/modules/auth/` — Authentication integration with Supabase Auth (access-token verification, email-confirmation checks), session validation, and account-related operations. Passwords and email flows stay in Supabase Auth.

- `apps/api/src/modules/users/` — Customer profiles, seller accounts, user roles, and account management.

- `apps/api/src/modules/shops/` — Shop registration, shop profiles, business information, the `Shop.status` lifecycle, and the shop authorization rules (onboarding exceptions and `requireApprovedSeller`). Administrator decisions are exposed through `modules/admin/`.

- `apps/api/src/modules/products/` — Product catalog, categories, product variants, images, prices, and product availability. Seller routes live under `/api/v1/sellers/me/products` (`requireApprovedSeller`). `PUBLIC_PRODUCT_WHERE` is the single definition of a publicly visible product (`feature-specs/07-product-management.md`). Archiving is reversible: restoring returns a product to `DRAFT` and never publishes it.

- `apps/api/src/modules/media/` — Server-side image normalization shared by shop logos and product images: signature check, header pixel limit, orientation, resizing, re-encoding without metadata, and one process-wide processing limit. Each feature supplies its own limits and error codes.

- `apps/api/src/modules/inventory/` — Stock management, inventory updates, and product availability validation. Seller stock updates are compare-and-set under the product row lock (spec 07). Availability has one definition here, derived from current stock and separate from publication visibility. Checkout reservation is not built yet.

- `apps/api/src/modules/cart/` — Shopping cart operations, cart items, and guest-to-authenticated cart merging.

- `apps/api/src/modules/addresses/` — Customer delivery addresses, GPS coordinates, location confirmation, and address management. Addresses belong to the authenticated user, always have a confirmed map location inside Mauritania, and are limited to 10 per customer with one default (`feature-specs/05-address-management.md`). Orders must store a snapshot of the delivery address.

- `apps/api/src/modules/orders/` — Customer orders, seller-specific orders, order lifecycle, acceptance, rejection, and cancellation.

- `apps/api/src/modules/delivery/` — Seller-managed delivery operations, delivery fees, delivery status, and failed delivery handling.

- `apps/api/src/modules/notifications/` — Notification creation, delivery, and notification history. Today it records `Notification` rows (allowlisted payloads) inside the transaction of the event that triggers them (shop decisions, spec 06); delivery channels and a read API are not built yet.

- `apps/api/src/modules/reviews/` — Product reviews and ratings.

- `apps/api/src/modules/favorites/` — Customer wishlists and favorite products.

- `apps/api/src/modules/admin/` — Administrative operations, seller approvals, marketplace monitoring, and platform management.

- `apps/api/src/workers/` — Background processing for notifications, search indexing, and asynchronous tasks. Current jobs: phone-change history retention (every 24 h), shop logo cleanup and reconciliation (every 5 min), and product image cleanup and reconciliation (every 5 min), each behind its own PostgreSQL advisory lock.

- `packages/shared/` — Shared API contracts, validation schemas, enums, and common business definitions where compatible with both web and backend TypeScript applications. Application code only: no visual design tokens.

- `packages/design-tokens/` — Single source of truth for visual foundations: colors (light and dark), fonts, type scale, spacing, component and icon sizes, and border radii (`src/tokens.ts`). A generator (`pnpm tokens`) produces the platform theme definitions: CSS variables, Tailwind theme, and next/font loaders for `apps/web`, and Dart theme constants plus the pubspec font block for `apps/mobile`. Generated files are committed and never edited by hand. `pnpm tokens:check` (also run by `pnpm typecheck`) fails if they drift. Platform theme files (`globals.css`, `app_theme.dart`) only adapt the generated tokens to shadcn/ui and Material 3.

- `infrastructure/` — Docker configuration, deployment configuration, environment templates, and infrastructure-related resources.

## Storage Model

- **PostgreSQL**: Primary source of truth. Stores users' application profiles (including the private customer phone change history), shops, seller approvals, products, categories, variants, inventory, carts, addresses, orders, seller orders, delivery information, reviews, favorites, and notification records.

- **Supabase Auth**: Stores and manages authentication identities (email), email-confirmation status, credentials (passwords are never stored in PostgreSQL), and authentication sessions, and sends confirmation and recovery emails. Application profiles (including the customer's unverified contact phone) and marketplace permissions remain managed by the backend.

- **S3-Compatible Object Storage**: Stores product images, shop logos, banners, and other uploaded media. PostgreSQL stores file references and metadata rather than binary image contents. Local development uses SeaweedFS (Docker Compose); production uses Cloudflare R2. The backend talks to both only through the S3-compatible API, so the provider is selected by configuration (endpoint, bucket, credentials), never by provider-specific code. Client uploads go directly to storage with short-lived presigned PUT URLs into a **private staging bucket**. The backend verifies each object's real content and normalizes it (a resized re-encode without metadata) before writing the result to the **public media bucket** and saving its reference; the uploaded file and unverified content are never publicly served (`feature-specs/06-shop-management.md`, `feature-specs/07-product-management.md`). Buckets are prepared with `pnpm --filter @chicman/api storage:setup`; the media bucket is made public with the `public-read` ACL on SeaweedFS and through the dashboard on R2 (which has no ACLs). The staging bucket is never public.

- **Redis**: Stores temporary cache data, session-related temporary data when needed, queue data, rate-limit counters, and background job state.

- **Meilisearch**: Stores searchable product indexes derived from PostgreSQL. It is a secondary search system, not the authoritative source for product information.

## Auth and Access Model

- Every customer, seller, and administrator authenticates through Supabase Auth using an **email address and password**. The email is the authentication identity.

- **Email confirmation is mandatory.** A Supabase Auth identity may exist before confirmation, but an unconfirmed identity never receives an active Chicman account: account bootstrap checks the confirmation status from Supabase Auth on the server and refuses unconfirmed identities (`feature-specs/04-customer-profile.md`). Password recovery uses Supabase's email recovery flow. Confirmation and recovery links use custom token-hash email templates, so they work across devices. They point to one callback, `<SITE_URL>/auth/callback`: a Next.js route on the web, which mobile opens through Android App Links and iOS Universal Links, with the web page as the browser fallback. The site URL and production domain are configurable, and Supabase redirect URLs are explicitly allowlisted. The callback follows no client-supplied redirect and never logs tokens (`feature-specs/03-authentication.md`). Sign-in email changes are not supported in the first release.

- **Bot protection:** Cloudflare Turnstile guards sign-up, login, and password recovery, in addition to rate limits. Tokens are verified server-side by Supabase Auth's CAPTCHA protection (or by the API through Cloudflare Siteverify, for any future API endpoint that needs it). A client-side result is never trusted alone. The Turnstile secret key never reaches a client.

- **API abuse protection and errors:** account setup and profile updates are rate-limited per user and per IP with Redis counters shared by all API instances. If Redis fails, the same limits are enforced with per-process counters (never switched off), and a limiter failure returns `503`. Error responses carry only a stable code: unexpected errors → `500 INTERNAL_ERROR`, temporary database outages → `503 SERVICE_UNAVAILABLE`. Logs record error types, codes, and stack frames, never tokens, credentials, connection URLs, or personal data (`feature-specs/03-authentication.md`, Implementation Notes).

- **Sessions:** the web keeps the Supabase session in `localStorage` (supabase-js). The mobile app keeps it in platform secure storage (Android Keystore, iOS Keychain), never in plain preferences.

- **The phone number is required contact information, not an authentication identity.** It is collected during account setup after email confirmation (never recovered from the sign-up device), stored in the customer profile, editable by the customer without verification, unverified in the initial release, and never used for login or recovery. Each phone change is recorded in a private, append-only phone change history (previous and new value, actor, time, change type), written in the same transaction and kept for 12 months, after which a background cleanup job deletes it (`feature-specs/04-customer-profile.md`). No application `User` or `CustomerProfile` exists until account setup completes. No SMS provider is required for the initial launch; phone verification may be added by a later feature and must never be implied by email confirmation.

- Supabase Auth issues access tokens that are sent to the Express API as Bearer tokens.

- Express middleware verifies access tokens and identifies the authenticated user before processing protected requests.

- Application roles and permissions are managed by the backend and PostgreSQL, not trusted directly from client-side role information.

- Supported application roles include:
  - `CUSTOMER`
  - `SELLER`
  - `ADMIN`

- **Users hold a set of roles** (`UserRole`: `userId` + `role`, composite primary key), so one user can be both `CUSTOMER` and `SELLER`. Every bootstrapped user holds `CUSTOMER`. Roles are granted only by server-side operations: bootstrap grants `CUSTOMER`, and an administrator's initial shop approval grants `SELLER`. No client input adds or removes a role.

- **Shop status (authoritative):** `Shop.status` in PostgreSQL is the only source of a shop's approval state:
  - `PENDING`: application submitted, awaiting admin review. Creating a shop submits its application, so every shop starts as `PENDING` (there is no draft status).
  - `APPROVED`: approved; normal seller operations enabled.
  - `REJECTED`: application rejected; the owner may correct and resubmit it (→ `PENDING`).
  - `SUSPENDED`: a previously approved shop suspended by an administrator; it keeps no operational access. An administrator may reinstate it (→ `APPROVED`).

  Allowed transitions: `PENDING` → `APPROVED` / `REJECTED` (admin), `REJECTED` → `PENDING` (owner), `APPROVED` → `SUSPENDED` (admin), `SUSPENDED` → `APPROVED` (admin). Any other transition is rejected server-side. Only administrators approve, reject, suspend, or reinstate. An administrator cannot perform administrative decisions on a shop they own, even when their account has the ADMIN role. (Checked server-side inside each decision transaction; the same applies to change-request decisions and to the shop's administrative history.) Client-provided status values are never trusted.
- **Becoming a seller (`SELLER` role transitions):** any bootstrapped user may create a shop (apply) without holding `SELLER`. Applying does not grant it.
  - **Initial approval** (`PENDING` → `APPROVED`, including approval of a resubmitted application): grants `SELLER` if not already held, in the same transaction as the status change and the recorded decision. The shop becomes eligible for normal seller operations.
  - **Resubmission** (`REJECTED` → `PENDING`, by the owner): no role change. It never grants `SELLER`; only a later approval does.
  - **Suspension** (`APPROVED` → `SUSPENDED`): `SELLER` is retained, not revoked; normal seller operations are blocked because the shop is not `APPROVED`.
  - **Reinstatement** (`SUSPENDED` → `APPROVED`): restores `APPROVED` and retains the existing `SELLER` role. No new role grant; it is recorded as `REINSTATED`, not as an initial approval.
  - No role-revocation rule is defined.
- **Shop status changes are audited:** each change appends a `ShopStatusEvent` (actor, from/to status, decision type, reasons, time) in the same transaction. Every administrative shop decision (application approval and rejection, suspension, reinstatement, change-request approval and rejection) requires exactly one reason (10–500 characters), retained with the decision type, actor, and time. For an initial application rejection, that single reason is both the administrative audit reason and the owner-facing `rejection.applicantReason`. For every other decision, the reason is internal and is never exposed through seller-facing APIs or notifications; neither are internal admin notes or audit metadata. Owner actions (creating or resubmitting an application) are not decisions and never create or overwrite `latestDecision`.
- **Shop application data** is a strict allowlist (see `feature-specs/06-shop-management.md`). The owner is always the authenticated user. The shop's contact phones are business data, separate from the customer's personal contact phone; neither is an authentication identity.
- **One shop per user (initial release):** `Shop.ownerUserId` is `@unique`, enforced by the database. A user owns at most one shop, whatever application roles they hold.
- **Normal seller operations** (products, inventory, seller orders, delivery) require an authenticated user, role `SELLER`, ownership of the target shop, **and** `Shop.status = APPROVED`, all checked server-side on every request (`requireApprovedSeller`). Role alone is never sufficient, and neither is the status alone. `PENDING`, `REJECTED`, and `SUSPENDED` shops are denied.
- **Onboarding exceptions:** shop creation (which submits the application), resubmission, pending and rejected application management, and status viewing do **not** use `requireApprovedSeller`. Each has its own server-side rule (see `feature-specs/06-shop-management.md`). Every rule resolves the shop from the authenticated user, never from a client-provided shop ID. Operations not listed there are denied.

- Access tokens are verified on the API: signature (Supabase JWKS, asymmetric algorithms only), issuer, audience, expiry, and subject (see `feature-specs/03-authentication.md`). JWKS retrieval is bounded (request timeout, single-flight refresh, refresh cooldown and backoff, negative caching of unknown `kid`s). A token is never accepted because its key could not be retrieved. Identity comes only from the verified `sub`. Roles and permissions come only from PostgreSQL, never from token claims or client input.

- **Account bootstrap:** before bootstrap, a Supabase Auth user (with a valid token) may have **zero** application `User` and `CustomerProfile` records; such a token grants access only to the bootstrap endpoint. Bootstrap creates or reuses the `User` and the `CustomerProfile` in **one database transaction**. After a successful bootstrap there is **exactly one** of each for that Supabase user, enforced by unique constraints (`User.supabaseUserId`, `CustomerProfile.userId`). Bootstrap is idempotent and safe under retries and concurrency (see `feature-specs/04-customer-profile.md`).

- Customers can browse the product catalog without authentication, but must authenticate before placing orders.

- Each shop belongs to its registered seller account.

- Sellers can manage only their own shops, products, inventory, seller orders, and delivery operations.

- Customers can access only their own profiles, carts, addresses, orders, favorites, and other private resources.

- Administrators can manage marketplace-wide resources according to their administrative permissions.

- Every protected resource must be authorized on the backend. Hiding a button in the frontend is not an access-control mechanism.

## Invariants

1. **PostgreSQL is the source of truth.** Redis and Meilisearch must never become authoritative sources for marketplace business data.

2. **One shared backend serves both platforms.** Web and mobile applications must use the same REST API and business rules.

3. **Authentication and authorization are separate.** Supabase Auth verifies identity; the backend determines what that identity is allowed to do.

4. **Seller isolation is mandatory.** A seller must never access or modify another seller's private resources without explicit administrative authorization.

5. **Shop approval is mandatory.** Only shops with `Shop.status = APPROVED` can publish products or process marketplace orders. `PENDING`, `REJECTED`, and `SUSPENDED` shops cannot. A user owns at most one shop (database-enforced). Only an administrator's initial approval grants `SELLER`; seller access always requires both the role and the approved status.

6. **Stock must be validated server-side.** A product cannot be ordered beyond its available stock.

7. **Multi-vendor checkout creates separate seller orders.** One customer checkout can produce multiple independently managed seller orders.

8. **Seller order decisions are independent.** Accepting or rejecting one seller order must not automatically cancel other seller orders.

9. **Money and order records must remain consistent.** Prices, delivery fees, and order totals must be validated and recorded at checkout. Use appropriate database transactions for critical order operations.

10. **Search indexing is asynchronous.** Changes to products in PostgreSQL must eventually be reflected in Meilisearch.

11. **Object storage is not a database.** Uploaded files are stored in object storage, while their references and ownership metadata are maintained in PostgreSQL.

12. **Background work must not block API requests.** Notifications, search indexing, and other asynchronous tasks must be processed through background workers.

13. **All API inputs must be validated.** Never trust client-submitted prices, roles, permissions, stock values, or order totals.

14. **Web and mobile must follow the same business rules.** Neither client may implement independent versions of critical marketplace logic.

15. **Localization is a first-class requirement.** French and Arabic must be supported, including correct RTL/LTR behavior and consistent MRU currency formatting.

16. **Payment model for the initial release is cash on delivery.** Sellers independently collect payment for their own orders.

17. **Design values have one source.** Colors, typography, spacing, sizes, and radii are defined only in `packages/design-tokens` and generated for each platform. Neither client hardcodes or duplicates them.
