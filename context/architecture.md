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

- `apps/web/` — Next.js application responsible for the customer storefront, seller dashboard, and administrator dashboard. All routes live under `app/[locale]/`, and `src/proxy.ts` maps public URLs onto them (see Web Localization).

- `apps/mobile/` — Flutter application responsible for mobile customer and seller experiences. It opens on the public storefront; the account is a dock destination (`lib/app_shell.dart`). Seller product management on mobile is a future feature that reuses the existing `/api/v1/sellers/me/products` routes.

- `apps/api/` — Node.js + Express backend responsible for REST endpoints, request validation, authentication verification, authorization, and marketplace business logic.

- `apps/api/src/modules/auth/` — Authentication integration with Supabase Auth (access-token verification, email-confirmation checks), session validation, and account-related operations. Passwords and email flows stay in Supabase Auth.

- `apps/api/src/modules/users/` — Customer profiles, seller accounts, user roles, and account management.

- `apps/api/src/modules/shops/` — Shop registration, shop profiles, business information, the `Shop.status` lifecycle, and the shop authorization rules (onboarding exceptions and `requireApprovedSeller`). Administrator decisions are exposed through `modules/admin/`.

- `apps/api/src/modules/products/` — Product catalog, categories, product variants, images, prices, and product availability. Seller routes live under `/api/v1/sellers/me/products` (`requireApprovedSeller`). `PUBLIC_PRODUCT_WHERE` is the single definition of a publicly visible product (`feature-specs/07-product-management.md`), with `productVisibility` beside it for a product already loaded, which the cart uses. Archiving is reversible: restoring returns a product to `DRAFT` and never publishes it. Public discovery routes (`/api/v1/products`, `/products/facets`, `/products/:productId`) live in `catalog.routes.ts` and `catalog.service.ts`, need no authentication, and expose no stock quantities or private shop data (`feature-specs/08-product-discovery.md`).

- `apps/api/src/modules/media/` — Server-side image normalization shared by shop logos and product images: signature check, header pixel limit, orientation, resizing, re-encoding without metadata, and one process-wide processing limit. Each feature supplies its own limits and error codes.

- `apps/api/src/modules/inventory/` — Stock management, inventory updates, and product availability validation. Seller stock updates are compare-and-set under the product row lock (spec 07). Availability has one definition here (including its query form for the public availability filter and `isQuantityAvailable` for the cart), derived from current stock and separate from publication visibility. Carts reserve nothing. **Order stock (spec 11, D1):** a separate internal function, not the seller `StockService`. `takeOrderStock` (`order-stock.ts`, built with spec 10) takes stock at placement with a conditional update (`stock >= quantity`); `returnOrderStock` returns it once per item when a shop order ends without delivery, recording unappliable returns as skipped (built with spec 11). Every such change is recorded in an append-only `StockMovement`.

- `apps/api/src/modules/cart/` — The customer's shopping cart (`/api/v1/customers/me/cart`): one per application user, with lines from any number of shops. Prices, availability, and totals are worked out from PostgreSQL on every read and write (`cart-rules.ts`). It reports problems and never changes a quantity or a variant on its own. It reserves no stock, so checkout must validate stock and prices again (`feature-specs/09-shopping-cart.md`). Guest carts and merging are not part of this version.

- `apps/api/src/modules/addresses/` — Customer delivery addresses, GPS coordinates, location confirmation, and address management. Addresses belong to the authenticated user, always have a confirmed map location inside Mauritania, and are limited to 10 per customer with one default (`feature-specs/05-address-management.md`). Orders must store a snapshot of the delivery address.

- `apps/api/src/modules/checkout/` — The customer's checkout (`/api/v1/customers/me/checkout`, spec 10): the summary (the cart's own read, plus fees, owners, address, and blocking problems; writes nothing) and the placement: `Idempotency-Key`, and one transaction locking cart → shops (`FOR SHARE`) → products (`FOR UPDATE`, by ID), re-running `evaluateCartLine`, comparing the client's shown figures (never stored), then order, stock, payments, notifications, and removal of the ordered cart lines. Cash on delivery only.

- `apps/api/src/modules/orders/` — Orders, shop orders, items, snapshots, and the shop order lifecycle (spec 11). Built: the tables, `createOrder` (called only by checkout), the one amount calculation, the random reference, the lifecycle (`ShopOrderLifecycle`: confirmation, rejection, customer, seller, and administrator cancellation, expiry, reminders; conditional updates under the lock order shop `FOR SHARE` → shop order → delivery → products), the outcomes spec 12 will call (`markShopOrderDelivered`, `markShopOrderFailedDelivery`), the suspension function (`cancelShopOrdersForSuspension`, called by `ShopLifecycle`), and the routes (`/customers/me/orders`, `/sellers/me/orders` with `approvedSeller`, `/admin/orders`), each with its own allowlisted view.

- `apps/api/src/modules/delivery/` — Seller-managed delivery (spec 12): the `Delivery` record (created `PENDING` by spec 11's confirmation, cancelled with the shop order before dispatch), its attempts (`DeliveryAttempt`, one open at most) and append-only history, and `DeliveryLifecycle`: ready, dispatch (first attempt or retry, no limit), "delivered, cash received" (delivery, shop order, and payment in one transaction), failure with a fixed reason, and closure as undeliverable (`markShopOrderFailedDelivery`: stock returned, payment `FAILED`). Each is a conditional update under spec 11's lock order (shop `FOR SHARE` → shop order → delivery → products). Routes under `/sellers/me/orders/:shopOrderId/delivery` and `/sellers/me/deliveries/in-progress`. `ready` and `dispatch` use `approvedSeller`; delivered, fail, close, and the in-progress list use the narrow delivery guard (`requireDeliverySeller`: `SELLER`, owner, shop `APPROVED` or `SUSPENDED`; a suspended shop may act only on a delivery out for delivery or failed and not closed, checked under the locks). `requireApprovedSeller` is unchanged. `closeDueDeliveries` is the automatic closure job. Delivery fees are a shop setting (spec 06) and an order snapshot (spec 11), not managed here.

- `apps/api/src/modules/payments/` — Cash-on-delivery payments (spec 13). `Payment` (one per shop order, `PENDING` at placement) and append-only `PaymentEvent`. Functions run inside the caller's transaction: `createPayment` (spec 10 placement), `collectPayment` (spec 12's delivered action: exact amount only, the shown amount a precondition), `markPaymentCancelled`, `markPaymentFailed` (specs 11 and 12). One view per viewer (`payment-views.ts`): customer (method, amount due, status), seller (plus collection time and amount), administrator (plus events and correction notes, through spec 11's admin order view). Routes: `GET /sellers/me/payments/summary` (`approvedSeller`; shop orders placed in a UTC period of at most 366 days, by status) and `POST /admin/orders/:shopOrderId/payment/notes` (append-only `ADMIN_NOTE`, never on the administrator's own shop). No ledger, settlement, refunds, or payouts.

- `apps/api/src/modules/notifications/` — Notification creation, delivery, and notification history.
  - **Today:** it records `Notification` rows (allowlisted payloads) inside the transaction of the event that triggers them (shop decisions, spec 06).
  - **Spec 15:** keeps that approach, with no outbox. Built so far (with spec 10): the unique `eventKey`, resource references, and `recordNotification` (an insert that does nothing on a key conflict), used by `SHOP_ORDER_PLACED`. Not built: the read API and keys for the six shop decisions.
  - **Delivery channels:** none are built. Transactional recording guarantees in-app persistence only; email, push, or other external delivery is not implemented and needs its own specification.

- `apps/api/src/modules/reviews/` — Product reviews and ratings.

- `apps/api/src/modules/favorites/` — Customer wishlists and favorite products.

- `apps/api/src/modules/admin/` — Administrative operations, seller approvals, marketplace monitoring, and platform management.

- `apps/api/src/workers/` — Background processing for notifications, search indexing, and asynchronous tasks. Current jobs: phone-change history retention (every 24 h), shop logo cleanup and reconciliation (every 5 min), and product image cleanup and reconciliation (every 5 min), each behind its own PostgreSQL advisory lock. Shop order expiry and seller response reminders (spec 11) and the automatic closure of failed deliveries (spec 12, `DELIVERY_FAILED_AUTO_CLOSE_DAYS`) run every 5 minutes, each behind its own lock, and are idempotent.

- `packages/shared/` — Shared API contracts, validation schemas, enums, and common business definitions where compatible with both web and backend TypeScript applications. Application code only: no visual design tokens.

- `packages/design-tokens/` — Single source of truth for visual foundations: colors (light and dark), fonts, type scale, spacing, component and icon sizes, and border radii (`src/tokens.ts`). A generator (`pnpm tokens`) produces the platform theme definitions: CSS variables, Tailwind theme, and next/font loaders for `apps/web`, and Dart theme constants plus the pubspec font block for `apps/mobile`. Generated files are committed and never edited by hand. `pnpm tokens:check` (also run by `pnpm typecheck`) fails if they drift. Platform theme files (`globals.css`, `app_theme.dart`) only adapt the generated tokens to shadcn/ui and Material 3.

- `infrastructure/` — Docker configuration, deployment configuration, environment templates, and infrastructure-related resources.

### Web Localization

- **Storefront pages have one URL per language:** French without a prefix (`/products/…`), Arabic under `/ar` (`/ar/products/…`). Crawlers keep no cookie, so this is what makes Arabic pages indexable. `hreflang` links connect the versions.
- **All other pages keep one URL** (`/login`, `/account`, `/seller/…`, `/admin/…`, and `/auth/callback`, which is on the Supabase allowlist and opened by mobile links) and follow the `chicman_locale` cookie. `/ar/login` redirects to `/login`, so security headers matched on those paths always apply.
- **Rules:** `routeLocale` in `apps/web/src/lib/locale.ts`, tested. A saved choice of Arabic redirects unprefixed storefront URLs to `/ar`; a request with no cookie gets the URL's language. Any cache or CDN added in front of the site must vary unprefixed storefront URLs on this cookie.
- **Components** read the language with `useLocale()`; server code uses `currentLocale()` (`lib/page-metadata.ts`). Storefront links go through `localizedPath`.
- **Language synchronization (web):** the profile's `preferredLocale` applies once per browser session, when a signed-in user is first seen. After that, the language switch and the profile form both update the profile and the cookie, and a `sessionStorage` marker stops an in-flight or failed save from changing the language back. A guest's choice stays on the device until sign-in, when the profile wins. A new account saves the language it was created in, because `POST /customers/me` accepts only the phone. Email-link pages (`/auth/…`) are never redirected.

### Mobile Localization

The app follows the profile's `preferredLocale` (`core/locale/app_locale_controller.dart`, `profileLocaleSyncProvider`). The language is kept on the device under `chicman-locale`, so it applies from the first frame, offline, and after signing out. It is read from the profile when a signed-in user is first seen, at launch or at sign-in, and a failed read leaves it unchanged. Saving the profile form applies it at once. A new account saves the language it was set up in. Without a saved language, such as for a guest who has never signed in, the app follows the device.

### Server-Rendered Storefront

- The web server reads the public API with no token and no cache (`features/storefront/catalog-server.ts`), with an 8-second timeout. `API_INTERNAL_URL` overrides the address when the server reaches the API differently from browsers.
- **Rate limits stay per customer.** The web server sends `x-chicman-client-address` with `x-chicman-internal-key` (`CATALOG_INTERNAL_KEY`, same value on the API and web, server only). The API uses the address only with the right key. Without the key, all rendered pages share the web server's limit, and the API logs a warning in production.
- **Real 404s:** a product page's shell is sent before the product is read, so `proxy.ts` checks the product first, on full page loads only (`HEAD /products/:id`, 1.5-second timeout), and rewrites a missing one to a route that answers 404. Only a `404` from the API counts: on any failure the page loads and reports it, so an outage never tells search engines a product is gone. Each full product page load therefore costs two API reads against the customer's rate limit. Client navigations use the page's own not-found view. Next sends an empty document for these responses and the browser fills it in, so the tab title stays the default. `ThemeInit` renders the theme script for the server and hydration, and adds it directly on those pages, because React does not run a script it creates on the client and warns about it.
- **Search engine files:** `robots.txt` blocks everything and `sitemap.xml` is empty until `NEXT_PUBLIC_SITE_URL` is a public HTTPS domain (`configuredSiteUrl`). The sitemap lists home, listing, categories, and products in both languages, is cached for an hour, returns an error rather than a shortened list when the API fails, and is capped at 24,000 products (one file's limit); splitting it is the next step past that.
- **Production requirement:** the web server must sit behind a proxy that sets `X-Forwarded-For`. `TRUST_PROXY_HOPS` on the web (default 1) says how many proxies to count from the right. A web server exposed directly would let clients choose the forwarded address.

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
- **Normal seller operations** (products, inventory, seller orders, delivery) require an authenticated user, role `SELLER`, ownership of the target shop, **and** `Shop.status = APPROVED`, all checked server-side on every request (`requireApprovedSeller`). Role alone is never sufficient, and neither is the status alone. `PENDING`, `REJECTED`, and `SUSPENDED` shops are denied. The one exception is spec 12's narrow delivery guard (`requireDeliverySeller`) for finishing deliveries already under way at suspension (D8).
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

5. **Shop approval is mandatory.** Only shops with `Shop.status = APPROVED` can publish products or process marketplace orders. `PENDING`, `REJECTED`, and `SUSPENDED` shops cannot. The one exception: a suspended shop's owner may finish deliveries already under way at suspension (deliver with collection, fail, close), and nothing else. Its other open orders are cancelled by the suspension itself (D8, specs 06, 11, 12). A user owns at most one shop (database-enforced). Only an administrator's initial approval grants `SELLER`; seller access always requires both the role and the approved status.

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
