# Progress Tracker

## Current Phase

Feature 03 (Authentication) is in progress. Feature 04 (Customer Profile) is **implementation complete**; the first scheduled 24-hour worker run is pending manual verification by the project owner. Foundation (project setup, pnpm workspace, design system, shared tokens, theme selection, brand wordmark) is complete.

- **Authentication** is email + password with mandatory email confirmation; the phone is unverified contact information; no SMS. It is implemented on the API, web, and mobile.
- **Web:** verified end to end on the hosted development project (2026-11-05), including registration, confirmation, account setup, login, recovery, and reset.
- **Android:** authentication manually verified and complete by the project owner (2026-11-06).
- **CAPTCHA (Turnstile) is enabled** on the hosted project, by the project owner, and enforced (a login without a token → `captcha_failed`).
- **Security verification executed (2026-11-06):** callback link attacks, rate limits with Redis and the in-memory fallback, safe error logging, `503` for database outages, and anti-enumeration (unregistered address).
- **Still open:** the registered-address anti-enumeration checks, the email-check scaling decision, the database password rotation, and all domain-dependent work (SMTP, branded templates, App Links / Universal Links, iOS).
- **Feature 04: implementation complete (2026-11-07).** Backend, web, and mobile are done. The profile settings screens were verified live (web signed in, Android) by the project owner on 2026-11-07. The retention worker runs persistently as the Compose `worker` service; its first scheduled 24-hour run (now due 2026-11-09T17:20:18Z: restarts on 2026-11-08 at 00:53, 12:40, and 17:20 UTC each reset the clock, and the logs show no run #2 yet) is **pending**; the project owner will verify it manually.
- Development uses Supabase's default email provider (team addresses only) until a domain exists.
- **Feature 06: implementation complete (2026-11-08)** on the API, web, and mobile: every checklist item verified, including web and Android by the project owner and Cloudflare R2. Automated tests across the project: API 200, web 84, Flutter 121. `S3_*` values are in `apps/api/.env`. Pending: the web storage origins for non-development builds (development falls back to local SeaweedFS), and a worker restart after the feature 04 24-hour check (see Next Steps).

- **Feature 07: implementation complete (2026-11-08)** on the API and web (the spec lists no mobile work). API 327, web 107. The product decisions are recorded under Decisions.
- **Feature 08: implementation complete (2026-11-08)** on the API, web, and mobile. The public storefront is live on `/`, and the mobile app opens on it. Follow-up done the same day: web language switch, visible thousands separator, server-rendered public pages. Language sync, real 404s, and a sitemap followed. The mobile app now follows the profile language too. API 400, web 162, Flutter 165. A check on a real Android device is pending.
- **Feature 10: implementation complete (2026-11-09)** on the API, web, and mobile: cash-on-delivery checkout of the whole cart into one order with one shop order per shop. By the project owner's choice, only the parts of specs 06, 11, 13, and 15 that checkout calls were built with it (spec 10, Implementation Notes). API 512, web 203, Flutter 222. Not verified in a browser or on a device.
- **Feature 11: implementation complete (2026-11-10)** on the API, web, and mobile: the shop order lifecycle (confirm, reject, customer, seller, and administrator cancellation, expiry, reminders), stock returns, the suspension function, and the order screens. The parts of specs 12, 13, and 15 it calls were built with it (spec 11, Implementation Notes). API 555, web 213, Flutter 233. Not verified in a browser or on a device.
- **Feature 12: implementation complete (2026-11-10)** on the API, web (seller), and mobile (customer): dispatch, attempts, "delivered, cash received", failure, closure, the automatic closure job, and the narrow access of suspended shops. Spec 13's `collect` and spec 15's four delivery notifications were built with it (spec 12, Implementation Notes). API 579, web 217, Flutter 237. Not verified in a browser or on a device.
- **Feature 13: implementation complete (2026-11-10)** on the API, web (seller), and mobile (customer): administrator correction notes, the seller collection summary (`/seller/payments`), and the seller's collection time and amount. The rest was built with specs 10–12. API 591, web 221, Flutter 238. Not verified in a browser or on a device.
- **Feature 09: implementation complete (2026-11-08)** on the API, web, and mobile. One cart per customer, grouped by shop, at `/cart` on the web and on a dedicated screen on mobile. Reviewed 2026-11-09: API 470, web 187, Flutter 206. A real sign-in and Android on a device or emulator are not verified.

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
| 05 | Address Management | `feature-specs/05-address-management.md` | Implementation Complete (2026-11-08; built after feature 06 without changing it; checkout selection belongs to the checkout feature; manual web and Android check pending) |
| 06 | Shop Management | `feature-specs/06-shop-management.md` | Implementation Complete (2026-11-08: every checklist item verified, including web and Android by the project owner and Cloudflare R2; the Compose worker still needs a restart to run the logo cleanup job) |
| 07 | Product Management | `feature-specs/07-product-management.md` | Implementation Complete (2026-11-08: API and web; every checklist item verified by automated tests and a browser run with a test-signed session; sign-in with a real account, real phone photos, and product images on R2 pending; the Compose worker needs a rebuild to run the image cleanup job) |
| 08 | Product Discovery | `feature-specs/08-product-discovery.md` | Implementation Complete (2026-11-08: API, web, and mobile; every checklist item verified by automated tests and, on the web, a browser run; Flutter on a real device pending) |
| 09 | Shopping Cart | `feature-specs/09-shopping-cart.md` | Implementation Complete (2026-11-09 audit against the spec: API, web, and mobile; automated tests pass; browser runs used a test-signed or stubbed session; a real Supabase sign-in and Android on a device or emulator are **not verified**; the code is not committed yet) |
| 10 | Checkout | `feature-specs/10-checkout.md` | Implementation Complete (2026-11-09: API, web, and mobile, with the prerequisites it calls from specs 06, 11, 13, and 15; automated tests pass; the web page in a browser, a real Supabase sign-in, and Android are **not verified**; not committed) |
| 11 | Order Management | `feature-specs/11-order-management.md` | Implementation Complete (2026-11-10: API, web, and mobile, with the parts of specs 12, 13, and 15 it calls; automated tests pass; the web pages in a browser, a real Supabase sign-in, Android, and the jobs in the Compose worker are **not verified**; not committed) |
| 12 | Delivery Management | `feature-specs/12-delivery-management.md` | Implementation Complete (2026-11-10: API, web seller pages, and mobile customer view, with spec 13's `collect` and spec 15's delivery notifications; automated tests pass; the web pages in a browser, a real Supabase sign-in, Android, and the closure job in the Compose worker are **not verified**; not committed) |
| 13 | Cash on Delivery | `feature-specs/13-cash-on-delivery.md` | Implementation Complete (2026-11-10: API, web seller pages, and mobile customer view; with specs 10–12 for creation, closing, and collection; automated tests pass; the web pages in a browser, a real Supabase sign-in, and Android are **not verified**; not committed) |

## Completed Work

### 13: cash on delivery — API, web, and mobile (2026-11-10)

- **Scope:** the rest of the spec; the record, creation, closing, and collection were built with specs 10–12. No migration. Details and the decisions the spec left open: spec 13, Implementation Notes.
- **Shared:** `payments/payments.ts` (`SellerPayment`, `paymentNoteSchema`, `sellerPaymentSummaryQuerySchema`, `SellerPaymentSummary`). The seller shop order detail and `SellerDelivery` now carry `SellerPayment`.
- **API:** `payment-views.ts`, `PaymentService` (`addAdminNote`, `sellerSummary`), `payments.routes.ts` (`GET /sellers/me/payments/summary`, `POST /admin/orders/:shopOrderId/payment/notes`), wired in `app.ts`, `server.ts`, and the test harness.
- **Web:** collected amount and time on `/seller/orders/[shopOrderId]`; new `/seller/payments` summary page, linked from `/seller/orders`.
- **Mobile:** no change to screens (customer method, amount, status already shown); a widget test now covers them.
- **Tests:** API 591/591 (+12), web 221/221 (+4), Flutter 238/238 (+1); API and web typecheck, web lint, and `flutter analyze` pass. Two deliberate breaks (summary shop filter, self-administration check) were each caught.

### 12: delivery management — API, web, and mobile (2026-11-10)

- **Scope:** the whole spec. As for specs 10 and 11, what it calls from other specs was built with it: `collectPayment` (spec 13 `collect`) and the four customer delivery notifications (spec 15). Details and the decisions the spec left open: spec 12, Implementation Notes.
- **Shared:** `delivery/delivery.ts` (failure reasons, request schemas, customer progress, seller delivery and record views with allowed actions, admin attempts, error codes `DELIVERY_STATUS_CONFLICT` and `PAYMENT_AMOUNT_MISMATCH`, notification payloads). The customer shop order gains `deliveryProgress`; the seller detail gains `deliveryRecord`; the admin `deliveryRecord` gains attempts and `autoCloseAt`.
- **Database:** migration `delivery_attempts` (additive): `DeliveryAttempt`, its enums, the one-open-attempt partial unique index, and checks. Applied to the local development and test databases; no drift.
- **API:** `modules/delivery/` (`DeliveryLifecycle`, `closeDueDeliveries`, `requireDeliverySeller`, views, `DeliveryQueries`, routes), `collectPayment` in `modules/payments/`, `delivery-notifications.ts`, `DELIVERY_FAILED_AUTO_CLOSE_DAYS` (default 7), worker job every 5 minutes with lock `chicman:delivery-auto-close`. `requireApprovedSeller` is unchanged.
- **Web:** delivery panel on `/seller/orders/[shopOrderId]`; new `/seller/deliveries` (deliveries under way; the only orders a suspended shop's owner sees), linked from `/seller/orders` and the shop dashboard (approved and suspended shops); delivery progress on `/account/orders/[orderId]`. French and Arabic.
- **Mobile:** delivery progress on the order detail (attempts, current dispatch, translated failure reasons, delivered time, "call the shop" while a failure is open). No seller screens (O1).
- **Tests:** API 579/579 (+24 delivery, +1 configuration), web 217/217 (+4), Flutter 237/237 (+4), `flutter analyze` clean. Root typecheck, web lint, API and web production builds, and `git diff --check` pass.
- **Not verified:** the web pages in a browser with real accounts, Android on a device, and the closure job in the Compose worker (needs a rebuild).

### 11: order management — API, web, and mobile (2026-11-10)

- **Scope:** as for spec 10, only what spec 11 calls from other specs was built: the `Delivery` record and its history (created at confirmation, cancelled before dispatch; spec 12), `markPaymentCancelled`/`markPaymentFailed` (spec 13), and the five lifecycle notifications (spec 15). Details and the decisions the spec left open: spec 11, Implementation Notes.
- **Shared:** `orders/lifecycle.ts` (reason codes, request schemas, list queries, seller and admin views, notification payloads); the customer view gains `deliveryStatus`, `closedAt`, `decision`, `canCancel`; new error codes `SHOP_ORDER_NOT_FOUND`, `SHOP_ORDER_STATUS_CONFLICT`, `SHOP_ORDER_EXPIRED`.
- **Database:** migration `order_lifecycle` (additive): `Delivery`, `DeliveryStatusEvent`, and checks on shop order decision fields. Applied to the local development and test databases. An earlier draft of its checks let NULLs pass; it was fixed and re-applied before anything else used it.
- **API:** `modules/orders/` (`ShopOrderLifecycle`, views, `OrderQueries`, routes), `modules/delivery/`, `returnOrderStock` in `modules/inventory/order-stock.ts`, suspension hook in `ShopLifecycle`, worker jobs (expiry and reminders, every 5 min, own advisory locks).
- **Web:** `/account/orders`, `/account/orders/[orderId]` (cancellation while pending), `/seller/orders`, `/seller/orders/[shopOrderId]` (confirm, reject, cancel, staged delivery details). Links from the account panel, the shop dashboard, and the checkout confirmation. The checkout labels now come from the order messages.
- **Mobile:** `features/orders/` (list with paging, detail, cancellation sheet), from the account screen and the checkout confirmation. The order models moved from the checkout domain (re-exported, no behaviour change).
- **Tests:** API 555/555 (+43), web 213/213 (+10), Flutter 233/233 (+11), `flutter analyze` clean. Root typecheck, web lint, API and web production builds, and `git diff --check` pass. Three deliberate breaks of the lifecycle were each caught.
- **Not verified:** the web pages in a browser, a real Supabase sign-in, Android on a device or emulator, and the jobs in the running Compose worker.

### 10: checkout — API, web, and mobile (2026-11-09)

- **Scope (project owner, 2026-11-09):** checkout calls functions owned by specs 06, 11, 13, and 15, none of which existed. Chosen option: build only what checkout calls, as those specs define it. Built: `Shop.deliveryFee` (API, audit, web dashboard), the order tables with `createOrder`, `takeOrderStock`, and the customer order view (11), `Payment`/`PaymentEvent` with `createPayment` (13), and `eventKey`/resource columns with `recordNotification` and `SHOP_ORDER_PLACED` (15). Everything else of those specs is still open. Details and decisions: spec 10, Implementation Notes.
- **Shared:** `checkout/` (strict placement schema with the shown figures as a precondition, `Idempotency-Key`, problems, summary type, `expectedFigures`), `orders/` (statuses, label map, customer view, notification payload), `money.ts` (zero-allowing amounts; `PRODUCT_PRICE_PATTERN` now comes from it). `SHOP_FIELDS` and `OwnerShopResponse` gain `deliveryFee`.
- **Database:** migration `order_chain_checkout` (additive): `Shop.deliveryFee`, `ShopField.deliveryFee`, notification `eventKey`/`resourceType`/`resourceId`, and `Order`, `ShopOrder`, `OrderItem`, `ShopOrderStatusEvent`, `StockMovement`, `Payment`, `PaymentEvent`, with checks (sums, non-negative amounts, line totals, deadlines, collection consistency). Applied to the local development and test databases; no drift.
- **API:** `modules/checkout/` (`GET`/`POST /customers/me/checkout`), `modules/orders/`, `modules/payments/`, `modules/inventory/order-stock.ts`, `modules/notifications/notifications.ts`. `cart-lines.ts` holds the cart's line loader, now shared with checkout (no behaviour change). The product image cleanup keeps objects that order items reference (S2-7). New configuration: `ORDER_RESPONSE_TIMEOUT_HOURS`, `CHECKOUT_RATE_LIMIT_*` (`.env.example`).
- **Web:** `/checkout` in `(storefront)` (not indexed): problems with a link to the cart, address and phone, recipient, shops with fees, cash on delivery, totals, confirmation, then a cart reload. Address list selection mode (`?select=checkout`) and `returnTo=checkout` on the editor. "Passer la commande" on `/cart`. Delivery fee section on `/seller/shop`. `formatDateTime` moved to `lib/date-time.ts`.
- **Mobile:** `features/checkout/` (screen opened from the cart, controller with the cart's account-change guard, confirmation), `AddressListScreen(selectForCheckout: true)`, "Passer la commande" on the cart screen. `ApiClient.send` accepts extra headers.
- **Tests:** API 512/512 (+42: 39 checkout, 3 configuration), web 203/203 (+16), Flutter 222/222 (+16), `flutter analyze` clean. Root typecheck, web lint, API and web production builds, and `git diff --check` pass. The S3 suite was skipped as before (`TEST_S3_ENDPOINT` not set; no storage code changed).
- **Test strength:** five deliberate breaks of the placement were each caught (see spec 10).
- **Not verified:** the web checkout page in a browser (no session tooling was run this time), a real Supabase sign-in, Android on a device or emulator, and the seller fee section in a browser.
- **Operational:** existing approved shops have no fee, so their products cannot be checked out until each seller sets one (D2).

### 09: audit against the spec (2026-11-09)

- **Reopened at the project owner's request** to implement spec 09. The feature already existed, uncommitted, so it was audited against the spec rather than rebuilt. Everything matched except the defect below.
- **Defect found and fixed: one account's cart could show to the next account.** A cart change still on its way when the account changed displayed its answer over the next account's cart, until the next read. It needs a sign-out and sign-in during one request, for example from another tab on the web. Mobile dropped late answers to reads only; the web dropped them only for its first read. Both now drop every late answer (`cart_providers.dart`, `cart-provider.tsx`).
- **Proof:** Flutter +2 (a successful answer and a session answer), both failing before the fix. Web: a browser script (dev server, stubbed session and API, cross-tab sign-out and sign-in through the auth channel) showed the previous account's product before the fix and the empty cart after it. Quantity change, refusal, and header count rechecked in French. **The web fix has no automated test,** because web tests cover logic outside components, and the script was not kept.
- **Results:** API 470/470 with `.env` loaded (no API code changed afterwards), web 187/187, Flutter 206/206, `flutter analyze` clean, root typecheck, web lint, API and web production builds, `git diff --check`, and `prisma migrate status` on the development database pass.
- **Still not verified:** a real Supabase account and Android on a device or emulator (none attached): see Next Steps.

### 09: final review and verification (2026-11-09)

- **Decisions approved by the project owner:** conditional stock display and the accept-price route. Rules and safeguards: spec 09, Implementation Notes. No API behaviour needed changing.
- **Tests added:** API +14 (stock figure limited to the affected line and variant, none on public routes or in errors, client stock refused; stale, repeated, concurrent, and tampered acceptance; totals on every read and write). Web +8. Flutter +4.
- **Test strength:** deliberate breaks caught: figure on every line (20 tests fail), figure from the product total (1), acceptance surviving a price change (10), no equality check (5). "Store the client's price" fails no test and cannot: the equality check first makes the value identical.
- **Results:** API 470/470 with `.env` loaded (the S3 suite was skipped: `TEST_S3_ENDPOINT` not set, no storage code changed), web 187/187, Flutter 204/204, `flutter analyze` clean, root typecheck, web lint, API build, and `git diff --check` pass.
- **Build failure explained:** it was not intermittent. The failing command had sourced `apps/api/.env` into its shell, which sets `NODE_ENV=development`. With that one variable: 3 of 3 builds failed, plus 1 of 1 with the whole file. With the same file minus that variable, or a plain shell: all passed, including clean `.next`, the same command sequence as the failure, and one CPU core. Next's prerender then fails with `useContext` of null, on a page that varies between runs, so it has nothing to do with the cart. Repository configuration does not set this value for the web build (Compose and the API Dockerfile set it for the API and worker only). **No repository change was needed.** Final runs: 5 consecutive plain builds passed; the negative control with `NODE_ENV=development` still fails, so no error was hidden.
- **Defect found and fixed: a CSP violation on every page.** Checking the whole flow found `eval script-src` from Zod's capability probe, on a production build, on every page including `/login`. It predates the cart and was invisible on the dev server, whose CSP allows `eval`. Fixed for browsers in `src/instrumentation-client.ts`. After the fix: 0 violations.
- **Web, production build, test-signed session, 46/46:** add, quantity, removal, grouping, refresh, header count, low stock and its correction, a price change, a stale acceptance from the real page, acceptance and total, archived, unpublished, and suspended lines, French and Arabic, 320, 390, and 1280 px, no overflow. Expected console errors only: a `404` from the profile route the test API does not mount, and the provoked `409`. One earlier run timed out waiting for the guest message when reusing a browser page; it did not recur in 15 fresh loads or a clean rerun, so page reuse is the likely cause, not proven.
- **Cross-platform, partial:** the real browser and the real Dart `CartController` and `ApiClient` (a new Flutter test process per step), one test-signed account: web add → Dart read and quantity change → web shows it → price change → Dart warning and acceptance → web agrees → archive → Dart flag and removal → web agrees → web quantity change → Dart agrees. Totals matched at every step. No device and no Flutter screens were involved.
- **Migration:** present last in the history; applies to a clean temporary database (since dropped); no difference from the schema on clean, development, and test; indexes and constraints inspected. It is additive, and the API needs it because the cart routes read these tables. Production untouched.
- **Android: not verified.** No device attached. An emulator (`Pixel_7_Pro`, read-only) booted, then the machine restarted before any app ran. The previous boot's journal ends under memory pressure with containerd stalled, with 11 of 15 GB in use by other work (IDE, other projects' containers). Likely related, not proven. It was not retried, to avoid losing other work on the machine.
- **Real account: not verified.** Signing in needs the owner's password and a Turnstile challenge, and the Chrome extension had no connected browser with an existing session. The development database holds one cart line (quantity 4, updated 2026-11-09 00:09), which suggests someone has used the cart with the real account; this was not treated as verification and was left unchanged.
- **Feature 10 review:** see Open Questions.

### 09: shopping cart — API, web, and mobile (2026-11-08)

- **Shared (`packages/shared/src/cart/`):** strict schemas (no client price, shop, or owner), error and issue codes, response types.
- **Database:** migration `shopping_cart` (additive): `Cart`, `CartItem`. Raw SQL: one line per variant and per variant-less product, positive quantity and price, a selected variant records its values. Applied to the local development and test databases; no drift against the schema.
- **API (`modules/cart/`):** read, add, update quantity, remove, clear, plus accept-price (added: see spec 09, Implementation Notes). `cart-rules.ts` reports each spec state without changing anything. `isQuantityAvailable` and `productVisibility` sit beside the existing single definitions.
- **Web (`features/cart/`):** `/cart`, header icon with count, add to cart on the product page, quantity controls, removal, availability and price messages. French and Arabic.
- **Mobile (`features/cart/`):** the same rules and wording. Cart screen, app bar icon on the storefront screens, add to cart on the product screen. `accountTabRequestProvider` lets a pushed screen open the account tab to sign in.
- **Existing tests changed for the intended behaviour:** three Flutter product-detail tests asserted "no purchase action" (spec 08), which this feature replaces.
- **Bug found and fixed:** on a 320 px phone the quantity controls and the remove button overflowed their row (found by a new widget test).
- **Tests:** API 456/456 (+55 in `test/cart.test.ts`, with `.env` loaded into the shell so the worker lock suite ran), web 179/179 (+17), Flutter 200/200 (+35), `flutter analyze` clean. **One API suite was skipped** and is not counted in the summary's `skipped 0`: S3-compatible storage (`TEST_S3_ENDPOINT` not set); no storage code changed. Root typecheck, web lint, API build, and `git diff --check` pass.
- **Web production build:** one run failed with `Export encountered an error on /_global-error/page`; the next three passed. *(Explained in the 2026-11-09 review: `NODE_ENV=development` in that command's shell.)*
- **Test strength:** six deliberate breaks of the cart code were each caught, then restored: stock check off (10 tests fail), renamed variant accepted (2), price from the snapshot (3), no cart row lock (1), removal ignoring the owner (1), any acknowledged price accepted (1).
- **Browser (Playwright, dev server, real API rules on the test database, test-signed session, placeholder images), 40/40:** guest invitation; sold-out and unavailable variants not addable; grouping by shop; server subtotals; quantity controls and refusal above stock; low stock not changed silently and then corrected; price change shown and acknowledged; archived, unpublished, and suspended-shop lines identified and left out of the subtotal; removal; a new page keeps the cart; French and Arabic at 390 px, Arabic at 1280 px; no horizontal overflow. Console errors: a `404` from the profile route, which the test API did not mount, and the expected `409`. Test data removed and the test database reset.
- **Not verified at the time:** see the 2026-11-09 review above.

### Mobile follows the profile language; script warning fixed (2026-11-08)

- **Decision (project owner):** the mobile app follows the profile's language. Rules: `architecture.md`, Mobile Localization. This replaces the earlier rule that Flutter follows the device, which stays as the fallback until a language is known.
- **Mobile:** new `core/locale/app_locale_controller.dart` and `profileLocaleSyncProvider`; `MyApp` sets `locale`; the profile form applies a saved language at once, and its messages use the new language; account setup saves the language in use.
- **Web warning:** "Encountered a script tag" came from the root layout's theme script on 404 pages, which React builds in the browser. `ThemeInit` replaces the script tag and `ThemeInitFallback`. JSON-LD was not the cause: React exempts data blocks. This also clears the dev-only warning recorded earlier.
- **Consequence:** an existing account keeps its stored language, `fr` by default, so a phone in Arabic now shows French after sign-in until the profile is changed.
- **Tests:** Flutter 165/165 (+10), `flutter analyze` clean, web 162/162, root typecheck, web lint, and the web production build pass. API not rerun: no API code changed.
- **Browser (dev server, dark mode):** four 404 pages and four normal pages, French and Arabic: no script warning, no error overlay, dark mode kept. The only console errors are Turnstile's own and the expected 404s.
- **Not verified:** the mobile language on a real device (widget tests only), including the Arabic layout with a real signed-in account.

### 08 follow-up: language sync, real 404s, sitemap (2026-11-08)

- **Language sync (web):** rules in `architecture.md`, Web Localization. New `lib/locale-choice.ts`, `features/profile/use-locale-sync.ts`, `LocaleSync`.
- **Real 404s:** `proxy.ts` checks products before the page starts (`features/storefront/product-check.ts`), with a `missing-product` route. Tried first and rejected: a normal page with a status on the rewrite, because Next ignores it for a prerendered page and answers 200.
- **Sitemap and robots:** `app/sitemap.ts`, `app/robots.ts`, gated on `configuredSiteUrl`.
- **Bugs found and fixed:** `/products/facets` crashed the product page, because the word reached the API's facets route as an ID (from the first 08 work); product IDs are now checked as UUIDs. On every 404 the theme script did not run, so dark-mode users got a light page; fixed, now in `ThemeInit`.
- **Tests:** web 162/162 (+12), root typecheck and web lint pass. API and Flutter were not rerun: no API or mobile code changed in this round (last results API 400/400, Flutter 155/155).
- **Production build, API on the test database, curl:** real `404` for a draft, a suspended shop's product, an unknown UUID, `facets`, an invalid ID, and an extra segment, in French and Arabic and for browser, Googlebot, and Facebook agents; existing products `200`. API stopped: existing and unknown products both load (`200`), never a false 404. A separate build with a public domain gave the full `robots.txt` and a valid sitemap with both languages and no hidden products; without one, `Disallow: /` and an empty sitemap. With the API stopped, the sitemap kept serving its cached list.
- **Browser (production build; signed-in flows used a stubbed session and stubbed profile responses, not a real account):** the profile language applies once per session; the switch writes only `preferredLocale`; a failed save does not bounce; guests send nothing; the profile form switches the interface; a new account keeps its language; `/auth/callback` is left alone. Dark mode and the selector work on 404 pages. Client navigation to a missing product shows the not-found view without a reload. Test data removed and the test database reset.
- **Not verified:** a real signed-in account across two devices; the failed-sitemap path before any list is cached; a real crawl. The sitemap's API error path has no automated test.

### 08 follow-up: language switch, thousands formatting, server rendering (2026-11-08)

- **Decisions:** Arabic storefront pages get their own URLs (`/ar/…`) because crawlers keep no cookie; other pages keep one URL and follow a cookie. Public pages are rendered per request without a cache, so visibility and stock are always current. Details: `architecture.md` (Web Localization, Server-Rendered Storefront).
- **Web:** all routes moved under `app/[locale]/`; new `src/proxy.ts`, `lib/locale-provider.tsx`, `lib/page-metadata.ts`, `features/storefront/{catalog-server,seo,home-sections}.ts`, `LanguageSwitch`, `CatalogFailureView`, localized not-found pages, and `robots.txt`. Every `use*Messages` hook now follows the page's language, so account, seller, and admin screens switch too. `formatMru` and `formatDateTime` now require a locale. `ThemeSelector` and Turnstile follow the language. Private page titles are translated.
- **API:** `rateLimit` takes an optional address source; the catalog routes accept the customer's address with `CATALOG_INTERNAL_KEY` (optional, at least 32 characters, warning in production when unset).
- **Thousands:** U+202F → U+00A0 on web and mobile.
- **Bug found in the browser:** the product not-found view lost its page frame, because Next's not-found boundary sits above the page; fixed. Next's dev validation also raised an overlay on unknown URLs; the catch-all route opts out with `instant = false`. *(The dev warning about the theme script was fixed later the same day.)*
- **Tests (default environment):** API 400/400 (+7), web 150/150 (+21), Flutter 155/155, `flutter analyze` clean. The worker lock and S3 suites are skipped in this run and were not run separately; no worker or storage code changed. Root typecheck, web lint, API and web production builds, and `git diff --check` pass.
- **Raw HTML (production build, API on the test database, curl with no JavaScript):** product name, price, JSON-LD, title, canonical, and `hreflang` present for browser, Googlebot, and Facebook user agents. Metadata is in `<head>` for Facebook's agent and in `<body>` for Googlebot, which Next documents as supported. `/auth/callback` keeps its strict CSP and no-referrer in both languages. The forwarded address reached the rate-limit counter.
- **Browser (Playwright, production build at 1280 and 390 px, then the dev server):** language switching both ways on the storefront and login, query kept, saved choice, RTL, no overflow, filters, sort, back button, pagination, variants, client navigation, not-found in both languages, no hydration errors or CSP violations from this site. The console on `/login` shows Turnstile's own messages. With the API stopped: failure message, `noindex` on product and listing pages. Test data removed (31 media objects) and the test database reset.
- **Not verified:** a real crawl by Google (needs a public domain); `CATALOG_INTERNAL_KEY` behind a real production proxy; signed-in account, seller, and admin screens in Arabic in a browser (their pages redirect to login without a session; the login page was checked); the mobile separator on a device.

### 08: product discovery — API, web, and mobile (2026-11-08)

- **Shared (`packages/shared/src/products/catalog.ts`):** the query schemas, sorts, decimal price bounds, and public response types. `PRODUCT_PRICE_PATTERN` is now exported.
- **API (`modules/products/catalog.*`):** `GET /products`, `/products/facets`, `/products/:productId`, with no guard. Every query starts from `PUBLIC_PRODUCT_WHERE`; `AVAILABLE_PRODUCT_WHERE` and `AVAILABLE_VARIANT_WHERE` sit beside the availability definition. No migration. Decisions are in spec 08, Implementation Notes.
- **Web (`features/storefront/`, route group `app/(storefront)/`):** the home page replaces the temporary page, plus `/products` (filters, sort, and page in the URL) and `/products/[productId]`. `StorefrontHeader` carries the theme selector, whose temporary placement is gone. `publicApiRequest` sends no token.
- **Mobile (`features/catalog/`, `lib/app_shell.dart`):** home, listing with filter and sort sheets, and details. The app now opens on the storefront. `ApiClient.getPublic` sends no token. `formatMru` matches the web.
- **Existing tests changed for the intended behaviour:** six Flutter test files now pump `MyApp(home: AuthGate())`, because `MyApp` opens on the storefront; `AppShell` has its own tests, including an incoming email link. The spec 07 test "no public route exposes products yet" now checks that a draft stays out of the public routes and that seller routes still need a token.
- **Bugs found and fixed while verifying:** `%` and `_` in a size or color filter acted as wildcards (Prisma's case-insensitive `equals` is `ILIKE`); the Flutter price used a normal space before the currency, unlike the web; Flutter card images had different heights in a row when one title wrapped; the web header took about a quarter of a phone screen and stayed sticky.
- **Tests (default environment):** API 393/393 (+27 in `test/catalog.test.ts`, 3 of them without PostgreSQL), web 129/129 (+22), Flutter 155/155 (+34), `flutter analyze` clean. **Two API suites were skipped** and are not counted in the summary's `skipped 0`: the retention worker lock and S3-compatible storage. The worker suite was then run separately, 7/7; the S3 suite was not rerun, and no storage code changed. Root typecheck, web lint, API and web production builds, and `git diff --check` pass.
- **Browser (Playwright, the running dev server, real CSP, API on the test database, SeaweedFS; 27 public products created through the real seller services, with real images):** French at 1280 and 390 px: 47 of 48 checks passed. The one failure was the check's own regex, which expected a normal space before `MRU`; the page's values were confirmed correct. Arabic with `DEFAULT_LOCALE` temporarily `ar` (restored): 9/9 at phone and desktop widths, in light mode. No CSP violation and no horizontal overflow. The only console errors were the expected `404`s for the draft, the suspended shop's product, and a malformed ID. Test objects were removed (31 media objects) and the test database reset.
- **Not verified:** Flutter on a real device or emulator (none attached): screens were checked by widget tests and rendered images with the real fonts and theme, and those renders used placeholder images, so real network images and the Arabic product grid were not seen; a signed-in storefront header; production CSP with R2 media.
- **Noticed:** the narrow thousands separator was barely visible in Plus Jakarta Sans. *(Fixed in the follow-up above.)*

### 06: shop logo normalization (2026-11-08)

- **Architecture:** the normalizer moved to `modules/media/image-normalizer.ts`, with per-feature limits and one shared processing limit. Thin wrappers keep the error codes: `shops/logo/logo-normalizer.ts` and `products/images/image-normalizer.ts`. `logo-verifier.ts` was removed. Product image behaviour is unchanged.
- **Logo flow:** only the verify step changed: it now normalizes, and the result is what gets written. Claim, fencing, immutable keys, idempotency, recovery, and cleanup are unchanged. Uploads may be 15 MB and 64 megapixels; published logos are at most 2 MB and 1024 × 1024. Migration `shop_logo_upload_limit` relaxes the staged upload's size check and is applied to the local development and test databases.
- **Clients:** web and Flutter accept 15 MB and explain the processing (French and Arabic). Flutter's presigned upload timeout went from 60 seconds to 5 minutes for large photos on mobile connections. No client processes images.
- **Tests (default environment):** API 366/366 (+39), web 107/107, Flutter 121/121, `flutter analyze` clean. **Two API suites were skipped** and are not counted in the summary's `skipped 0`: the retention worker lock (`TEST_DATABASE_URL` is not in the process environment) and S3-compatible storage (`TEST_S3_ENDPOINT` not set). Run separately with those variables: worker tests 7/7, S3 2/2 (local SeaweedFS). Root typecheck, web lint, API and web production builds, and `git diff --check` pass.
- **Test strength:** publishing the original (25 of 43 fail), skipping orientation (13 of 43 fail), and skipping the resize (4 of 4 relevant tests fail) are each detected; the normalizer was restored after each.
- **Cloudflare R2, test buckets only:** the logo suite passed 8/8, including a generated photo with GPS and device data read back from the public URL at 1024 × 768 with no metadata. 0 objects left. **One earlier full run failed all 8 with `fetch failed`**, before any logo logic ran; it passed alone and in the next full run, and the cause was not determined. No storage setting was changed. Product images have not been tested on R2.
- **Browser (Chrome, local SeaweedFS, test database, test-signed session), 8/8, French:** an 8.1 MB generated photo with orientation 6 was shown upright at 768 × 1024; the public object was 106 KB with no metadata. Test objects were removed and the test database reset.
- **Not verified:** a real Android or iPhone photo (no device attached; fixtures are generated), the Flutter logo screen on a device with a large photo, production, and memory under load.
- **Known limits:** logos published before this change keep their metadata until replaced or removed (no backfill); HEIC is refused; animated images keep their first frame.

### 07: product image normalization (2026-11-08)

- **Decision:** the server resizes phone photos and removes their metadata. The upload limit rises to 15 MB and 64 megapixels, because the old 2 MB limit kept phone photos from reaching the server; 2 MB and 1024 × 1024 now apply to the published image.
- **API:** `modules/products/images/image-normalizer.ts`; `lib/concurrency-limiter.ts` (two uploads processed at once per API process). The completion flow writes the normalized bytes; claim, fencing, recovery, and cleanup are otherwise unchanged. Migration `product_image_upload_limit` relaxes the staged upload's size check and is applied to the local development and test databases.
- **Shop logos:** unchanged. `logo-verifier.ts` is back to its original form, and regression tests pin its verdicts.
- **Web:** the 15 MB pre-check and updated French and Arabic texts. No image processing in the browser.
- **Tests (default environment):** API 327/327 (+41), web 107/107 (+1). **Two API suites were skipped** and are not counted in the summary's `skipped 0`: the retention worker lock (`TEST_DATABASE_URL` is not in the process environment) and S3-compatible storage (`TEST_S3_ENDPOINT` not set). Run separately with those variables: worker tests 7/7, S3 2/2 (local SeaweedFS). Root typecheck, web lint, API and web production builds, and `git diff --check` pass.
- **End to end (Chrome, local SeaweedFS, test database, test-signed session), 9/9:** an 8.1 MB generated 3000 × 4000 JPEG with EXIF, GPS, and orientation 6 went straight to storage; the page showed it upright at 1024 × 768; the public object was 106 KB, with no EXIF, GPS, or device data. French only.
- **Not verified:** real phone photos (fixtures are generated); Cloudflare R2 for product images; the Arabic page with the new texts in a browser (dictionary tests only); memory and timing under production load.

### 07: approved product decisions implemented (2026-11-08)

- **Restore:** `POST /sellers/me/products/:productId/restore` moves `ARCHIVED` → `DRAFT` under the shop and product locks; data is preserved and nothing is published. The web product page has a Restaurer action, and archive messages now say archiving is reversible.
- **Availability:** one definition in `modules/inventory/availability.ts`, derived from current stock and separate from `PUBLIC_PRODUCT_WHERE`. Variants now report `available`, and the seller page marks unavailable variants. Replenishing needs no republishing.
- **Publication messages:** the page states that an image is required and that zero stock does not block publication, and explains the out-of-stock state.
- **Specs:** 07 and 08 aligned. Specs 09 and 10 already require server-side stock validation and were not changed. Purchasing is not enforced by any route yet, because no cart or checkout exists.
- **Tests (default environment):** API 286/286 (+15), web 106/106 (+5). **Two API suites were skipped** and are not counted in the summary's `skipped 0`: the retention worker lock (it reads `TEST_DATABASE_URL` from the process environment only, not `.env`) and S3-compatible storage (`TEST_S3_ENDPOINT` not set). Each was then run separately with those variables: worker tests 7/7 and S3 2/2 (local SeaweedFS). The default run also includes the shop logo R2 suite, because `R2_TEST_*` is set; no product image test uses R2.
- **Checks:** root typecheck, web lint, API and web production builds, and `git diff --check` pass.
- **Browser (test-signed session, test database, local SeaweedFS), French and Arabic, 11/11 each:** publish blocked without an image, publishing at zero stock, out-of-stock note, replenishing without republishing, archive, restore, publish again, no CSP violation, no horizontal overflow. Test objects were removed and the test database reset.

### 07: product management — API and web (2026-11-08)

- **Shared (`packages/shared/src/products/`):** categories, statuses, limits, error codes, strict schemas, decimal-string price schema, and response types.
- **Database:** migration `product_management` (additive): `Product`, `ProductVariant`, `ProductImageUpload`, `ProductImage`. Raw SQL: positive price, stock range, status timestamps, variant attribute required, case-insensitive variant uniqueness, verified image metadata. Applied to the local development and test databases.
- **API:** `modules/products/` (products, variants, image removal and order, `PUBLIC_PRODUCT_WHERE`), `modules/products/images/` (upload flow and cleanup, same rules as logos), `modules/inventory/` (compare-and-set stock). Routes under `/sellers/me/products`, all `requireApprovedSeller`. `verifyImage` was split out of `verifyLogo` (logo behaviour unchanged). The worker gains the product image cleanup job (5 min, own advisory lock).
- **Web:** `/seller/products` (list, status filter, pagination), `/seller/products/new`, `/seller/products/[productId]` (details, editing, images with order, stock, variants, publish, archive with confirmation; read-only when archived). `formatMru` in `lib/money.ts`. Linked from the account panel (`SELLER`) and the approved shop dashboard. French and Arabic texts. `SectionCard` and `TextAreaField` are now exported from the shop dashboard for reuse.
- **Tests:** API 271/271 (+71 in `test/products.test.ts`: authorization, isolation, prices, categories, variants, stock, lifecycle, visibility, images, failure recovery, cleanup). Web 101/101 (+17). Root typecheck, web lint, production build, and `git diff --check` pass. Flutter was not run: no mobile file changed. The worker-lock and S3 suites still skip without their test env variables, although the summary prints `skipped 0`.
- **Browser (Chrome, dev server, real CSP, real API on the test database, local SeaweedFS, test-signed session):** French flow from empty list to archive, with real presigned PUTs without the bearer token; oversized and disguised-SVG images refused by the server; stale stock refused; no CSP violation, no horizontal overflow at 390 px and 1280 px. Arabic with `DEFAULT_LOCALE` temporarily `ar` (restored): 11/11 checks and the phone layout inspected. One French check failed only because it counted the create form that Next keeps hidden for back navigation; the page itself is read-only, as its screenshot shows.
- **Found and fixed in the browser:** going back to the create page showed the old values and a permanently disabled button, because Next keeps a visited page's state (Cache Components). The form now resets on success; rechecked in the browser. No automated test covers this component behaviour.
- **Cleanup:** 7 test objects removed from the local media bucket (0 left under `product-images/`), test database reset.
- **Not verified:** a signed-in session from hosted Supabase; product images on Cloudflare R2; the image cleanup job inside the running worker (covered by tests only).
- **Environment:** the machine rebooted during this work (about 17:20 UTC), which restarted the Compose worker. It was not rebuilt.

### 03: Android Turnstile fail-closed and diagnosis (2026-11-08)

- **Cause found (reproduced):** `apps/mobile/.env` has the site key but no `SITE_URL`. Built from it alone, `turnstileBaseUrl` was `null`, so the challenge was silently removed and login went out without a token, which Supabase refuses (`captcha_failed`). Whether this is exactly what happened on the project owner's phone is not proven: no phone was attached. Separately, the emulator's `API_BASE_URL=http://10.0.2.2:4000` does not work on a phone (use `adb reverse`, see `README.md`).
- **Fix (`turnstile_field.dart`, `app_config.dart`, messages):** a site key always requires a token (fail closed, with a visible configuration error); load watchdog (20 s); stale and empty tokens refused; separate load-failure, rejection, and expiry messages in French and Arabic; third-party cookies for this WebView only; the view is an injectable provider. `webview_flutter_android` became a direct dependency. The token wiring to `signUp` and `signInWithPassword` was already correct and is unchanged. Web, hosted Supabase settings, and env files are unchanged.
- **Results:** Flutter 113/113 (+13), `flutter analyze` clean. Emulator results and what was not executed: spec 03, Android verification status.
- **Real phone (2026-11-08, Samsung SM-A165F, Android 16, WebView 156):** the project owner solved the real challenge and logged in against hosted Supabase. The reported chromium `"Error"` line is Cloudflare's own `console.debug`/`console.dir` output and also appears in this successful run; it was not a failure. No failure was reproduced this round, so the earlier failure's exact cause on this phone stays unproven.
- **Debug-only diagnostics added:** `[turnstile]` logcat lines (Turnstile error codes, page and resource events, environment facts; token length only) and WebView remote debugging. Flutter 116/116, analyzer clean.
- **Pending (project owner):** sign-up on the phone.
- **Spec 03 checklist:** the onboarding item left open as "spec 06, not implemented yet" is ticked: `test/shops.test.ts` covers each clause, and the shop onboarding routes do not use `requireApprovedSeller`. API 196/196 including R2; two suites were skipped because their test env variables were not set (retention worker lock, S3-compatible storage), though the summary prints `skipped 0`.

### Review fixes across features 03, 05, and 06 (2026-11-08)

- **Logo completion:** bytes are deleted only when this attempt released its own row. Before, a commit that succeeded but reported an error deleted the live logo's object.
- **Addresses:** an accuracy-only patch no longer stores an accuracy on a `MANUAL` pin.
- **Admin list:** `openChangeRequest=false` now selects shops without a pending request; absent stays unfiltered.
- **Owner forms (web, mobile):** the fields form is keyed by status instead of `updatedAt`, so saves and logo changes keep unsaved edits and the saved message. On the web, the save and change-request confirmations live in the dashboard.
- **Mobile:** presigned uploads have a 60-second timeout; other requests stay at 15 seconds.
- **Not changed:** status event timestamps. A new test shows decisions and resubmissions that wait for the shop lock are already timestamped after the wait.
- **Results:** API 199/199 (worker lock and S3 suites skipped: env not set), web 84/84, Flutter 118/118, typecheck, lint, and analyzer clean. The web form changes have unit tests for the merge only and were not run in a browser.
- **Follow-up fixes:** `decideChangeRequest` takes `decidedAt` after the shop lock; the mobile change-request card is no longer remounted, so its "sent" message stays and the form restarts from current values only when a request opens or is decided. The regression tests for the timestamp and the message failed before the fix. API 200/200 (same two suites skipped), API typecheck clean, Flutter 121/121, analyzer clean. Manual web and Android checks of these form changes are pending (project owner).

### 05: address management — mobile, integration, and verification (2026-11-08)

- **Mobile** (`features/addresses/`): address list (default, edit, delete with confirmation), editor (map + details → confirmation → save; "Plus tard" during onboarding), `maplibre_gl` ^0.27.1 map with the fixed center pin, `geolocator` ^14.1.2 (permission asked only on "Utiliser ma position"; denied, permanently denied, service off, and timeout keep the manual path). Android location permissions and the iOS usage text added. After account setup the onboarding address screen opens; the account screen links to the addresses and prompts while none exists.
- **Existing tests adjusted for the intended change:** the auth flow test now expects the onboarding address screen after account setup and leaves it with "Plus tard"; widget tests use a fake map view (MapLibre platform views do not render in tests).
- **Results:** API 199/199 (PostgreSQL, Redis, SeaweedFS, R2; +13 addresses); web 83/83; Flutter 100/100 (+9: domain and screens), `flutter analyze` clean, debug APK builds; root typecheck, web lint, API and web production builds, and `git diff --check` pass.
- **Feature 06 untouched** apart from the shared test harness and helper (`resetDatabase` also clears addresses; the harness mounts the address routes).
- **Open:** checkout selection (checkout feature); manual check on web (signed in) and an Android device (real GPS prompt, map gestures); iOS not built here.

### 05: address management — API and web (2026-11-08)

- **Spec decisions** (project owner): every address has a map pin (manual entry = placing the pin), Mauritania-style fields, OpenFreeMap tiles, skippable onboarding prompt. Implementation details recorded in spec 05, Decisions.
- **API** (`modules/addresses/`, migration `customer_addresses`): `CustomerAddress` with `DECIMAL(9,6)` coordinates, `locationSource`, `locationConfirmedAt`, and DB guards (one default per user, E.164, non-blank text, Mauritania bounding box). Routes under `/customers/me/addresses` (list, create, get, patch, delete, set default); writes lock the user row (10-address limit and single default hold under concurrency); default switches do not change `updatedAt`; rate limit 30/user, 100/IP per 10 min. Shared schemas and types in `packages/shared/src/addresses/`.
- **Web** (`features/addresses/`): `/account/addresses` (list, default, edit, delete with inline confirmation), `/account/addresses/new` (`?onboarding=1` adds "Plus tard"), `/account/addresses/[addressId]`; MapLibre (`maplibre-gl` 6.15.0) with a fixed center pin, "Utiliser ma position" (browser geolocation), and a confirmation step before saving. The account panel links to the addresses and shows a prompt while none exists (dismissal device-local); after account setup the customer is sent to the skippable address screen.
- **CSP:** map style origin (`NEXT_PUBLIC_MAP_STYLE_URL`, default `https://tiles.openfreemap.org`) in `connect-src`; `worker-src 'self' blob:`. MapLibre's worker is copied to `public/maplibre/` by `scripts/copy-maplibre-worker.mjs` before `dev`/`build` (git-ignored, lint-ignored). Note: the dev server reloads its config only when `next.config.ts` itself changes, not `src/lib/csp.ts`; restart it (or touch the config) after CSP changes.
- **Found and fixed in the browser check:** MapLibre's stylesheet (`.maplibregl-map { position: relative }`) overrode the container's absolute positioning, so drags never reached the map; the container is now sized directly. Pin moves are detected without relying on `originalEvent`.
- **Results:** API addresses 13/13 (PostgreSQL). Web 83/83 (+7 address logic, +1 CSP), typecheck, lint, and production build pass. Browser (Playwright Chrome on the dev server, real CSP and OpenFreeMap tiles, stubbed Supabase session and API): account prompt shown; map loads (16 tiles, worker served, no CSP violation); no pin → error; GPS position; drag → manual pin; confirmation step sends nothing; save sends an allowlisted body with `locationConfirmed: true` and redirects; prompt hidden afterwards; list shows the default address.

### 06: no self-administration of an owned shop (2026-11-08)

- **Rule:** An administrator cannot perform administrative decisions on a shop they own, even when their account has the ADMIN role.
- **API:** `assertNotOwnShop` (`modules/shops/shop-lifecycle.ts`) runs inside each decision transaction after locking the shop row and before any write: application approval and rejection, suspension, reinstatement, and change-request approval and rejection (the change-request decision now locks the shop row first, the same lock order as the owner's submission). The admin shop detail (internal reasons and notes) applies it too. A refused attempt returns `403 SHOP_SELF_ADMINISTRATION_FORBIDDEN` (new shared code) and writes nothing. Order of checks: invalid body `400`, unknown shop `404`, own shop `403`, wrong status `409`.
- **Web:** the admin screens show "Vous ne pouvez pas administrer une boutique dont vous êtes propriétaire…" for that code (display only; the API enforces the rule).
- **Tests:** `test/shops.test.ts` +7 (PostgreSQL): an `ADMIN`+`CUSTOMER` owner cannot approve or reject its own application, suspend or reinstate its own shop, or decide its own change request, and cannot read its shop's admin history; shop, status events, field changes, change requests, notifications, logo objects, and roles are compared before and after and are unchanged; another administrator administers that shop normally and the admin-owner administers other shops; the owner's seller operations are unchanged; `400`/`404` still come first. Web +1.
- The project owner's account keeps `ADMIN`; no role or account was changed. Their development shop must now be decided by another administrator account.

### 06: Cloudflare R2 verification (2026-11-08)

- **Setup by the project owner:** buckets `chicman-staging-test` (private, CORS `PUT` + `content-type` from `http://localhost:3000`) and `chicman-media-test` (public via `r2.dev`), a bucket-scoped Object Read & Write token, and `R2_TEST_*` values in `apps/api/.env` (never printed).
- **`test/shop-logo-r2.test.ts`: 7/7 against R2:**
  1. Presigned PUT: `X-Amz-Expires=300`, signed headers `content-length;content-type;host`, no checksum parameters; wrong type, wrong length, and another key are refused by R2; the correct PUT → `200`.
  2. Staging CORS preflight from `http://localhost:3000` → allowed for that origin.
  3. Completion publishes to the media bucket; the public `r2.dev` URL serves the same bytes with `image/png` (96 × 64); an unsigned GET of the staging key is refused; a repeated completion returns the same URL; the staging object is deleted and `stagingDeletedAt` set.
  4. Verification on R2: SVG declared as PNG → `422 LOGO_UNSUPPORTED_TYPE`, 1100 px wide → `422 LOGO_TOO_LARGE_DIMENSIONS`, not uploaded → `422 LOGO_NOT_UPLOADED`; a 2.2 MB staged object is refused by the capped read; deleting a missing key succeeds.
  5. Replacement: the worker job (`runLogoCleanup`) deletes the replaced object from R2 and keeps the active one.
  6. Database failure after the write: the compensating delete removes the new object from R2; the retry publishes under a new key.
  7. Stale attempt: cannot commit; only its own object is removed from R2.
  The `after` hook deletes every object under the test-shop prefixes in both buckets, asserts none remain, and resets the test database.
- **Real browser (Playwright Chromium, page origin `http://localhost:3000`, CSP from the real `buildContentSecurityPolicy`):** with the current dev configuration (no R2 origin) the PUT is blocked by `connect-src`, as designed; with `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN`/`NEXT_PUBLIC_MEDIA_BASE_URL` set to R2, the browser PUT → `200` with no violation, completion published it, and the page displayed it from `r2.dev` (200 × 100). The production CSP for R2 contains the R2 origins and not `localhost:8333`. Cleanup: 1 object removed, 0 left; test database reset.
- **No code change was needed.** SeaweedFS behaviour unchanged: the full API suite passes 179/179 (172 + 7 R2; the R2 tests run whenever `R2_TEST_*` is set).
- **Not tested:** a custom domain in front of the media bucket (only `r2.dev`), and the hosted production deployment (not set up yet).

### 06: manual verification and R2 suite prepared (2026-11-07)

- **Verified manually by the project owner:** the signed-in web flow and Android both work. Spec 06 checklist: only the R2 item stays open.
- **R2:** no R2 credentials exist in the project, so nothing ran against R2 yet. The adapter needs no change for R2 (region `auto`, path-style, SigV4 presigned PUT, `Range` reads, 404 detection, public URL = base + key). `test/shop-logo-r2.test.ts` is ready: it uses existing buckets (no bucket creation, no ACLs), isolated test-shop prefixes, real presigned PUTs, publication, public URL fetch, verification failures, replacement and job deletion, failure recovery, stale attempts, staging cleanup, and optionally the staging CORS preflight; it deletes every object it wrote and resets the test database. It skips without `R2_TEST_*` (documented in `apps/api/.env.example`).
- API 172/172 (SeaweedFS included) unchanged.

### Administrator role script (2026-11-07)

- `pnpm --filter @chicman/api admin:grant -- --list | --supabase-user-id <uuid> [--revoke]` (`apps/api/scripts/grant-admin.ts`): grants (`ON CONFLICT DO NOTHING`) or revokes `ADMIN` for an existing, bootstrapped user, from `DATABASE_URL`. It changes roles only; accounts are still created by sign-up and email confirmation. No API route grants `ADMIN`.
- **Granted** `ADMIN` to the only development account (Supabase user `3cf112d4-…`, created 2026-11-05; roles now `ADMIN, CUSTOMER`). That account also owns the development shop (`PENDING`), so it could review its own application at the time. *(Superseded 2026-11-08: self-administration is now forbidden; see "no self-administration of an owned shop".)*
- Checked: a repeated grant changes nothing; an unknown ID is refused (exit 1).

### 06: CSP fix for direct logo uploads (2026-11-07)

- **Cause:** the CSP read the storage origins from `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN` / `NEXT_PUBLIC_MEDIA_BASE_URL`, but `apps/web/.env.local` defines neither, so `connect-src` (presigned PUT) and `img-src` (logo display) left storage out and the browser refused the upload.
- **Fix:** the CSP builder moved from `next.config.ts` to `apps/web/src/lib/csp.ts`. In development it falls back to `http://localhost:8333` when the variables are unset; in production it uses only the configured origins (no fallback). No other directive changed; no wildcard.
- **Tests:** `src/lib/csp.test.ts` (+6): dev default, dev override, production without the local origin, production with configured R2/media origins (reduced to their origins), invalid or wildcard values ignored, other directives unchanged. Web 74/74; typecheck, lint, and production build pass. The production server header has no `localhost:8333` and no `unsafe-eval`.
- **Live check (Playwright Chromium, dev server, page on `http://localhost:3000`):** a real presigned PUT (LogoService against the test database and the local SeaweedFS buckets) of a browser-generated 160 × 120 PNG → `200`, with no CSP violation; server completion verified it and published it to `chicman-media`; the public logo URL then rendered in the page (160 × 120). Control requests to `http://localhost:9999` stayed blocked by `connect-src` and `img-src`. The signed-in flow (API token) was not exercised: the Chrome extension was not connected, and signing in needs Turnstile. Probe objects and test rows were removed.

### 06: shop management mobile and wrap-up (2026-11-07)

- **Mobile** (`apps/mobile/lib/features/shop/`), opened from the account screen (**Ma boutique**): application form, status with the latest decision and the rejection reason, resubmission, field editing limited by status, the `shopName`/`city` change request and its outcome, and the logo (picked with `image_picker` ^1.2.4, signature and size checked, presigned PUT without the bearer token, completion retried on `409`). `ApiClient.putToStorage` sends the bytes. iOS `NSPhotoLibraryUsageDescription` added. French and Arabic texts (same wording as the web).
- **Results:** Flutter 91/91 (+13), `flutter analyze` clean, debug APK builds. API 172/172 and root typecheck pass.
- **Docs:** spec 06 Implementation Notes (decisions the spec left open) and checklist (59 items checked by automated tests; 3 open), `architecture.md` (notifications module, workers, bucket setup), `code-standards.md` (S3 integration tests).
- **Local SeaweedFS:** the `object-storage` service was started (it was not running) with `POSTGRES_PORT=5442 REDIS_PORT=6389`; Postgres and Redis were not recreated. `chicman-uploads` (private, CORS PUT from `http://localhost:3000`) and `chicman-media` (`public-read`) were created by the setup script.

### 06: shop management web (2026-11-07)

- **Seller dashboard** `/seller/shop` (`apps/web/src/features/shop/`), linked from the account panel: application form (no shop yet), status badge and help, latest decision (`REINSTATED` shown distinctly), the rejection reason and date (plain text) with **Renvoyer la demande**, field editing limited by status (all fields while `PENDING`/`REJECTED`, immediate fields while `APPROVED`, nothing while `SUSPENDED`), the `shopName`/`city` change request with current and proposed values and the outcome (no reason), and the logo upload (request → presigned PUT straight to storage → completion, retried on `409 LOGO_COMPLETION_IN_PROGRESS`) and removal.
- **Admin** `/admin/shops` (filters: pending, open change requests, approved, suspended, rejected) and `/admin/shops/[shopId]` (`apps/web/src/features/admin/`): details, the decisions allowed from the status (rejection asks for the applicant-facing reason only, the others for an internal reason, each with an optional internal note), change-request review, and the full history. The account panel links to it for `ADMIN` users (navigation only; the API enforces the role).
- Forms validate with the shared zod schemas (the web now depends on `zod` 4.6.7) and send only allowlisted, changed fields. French and Arabic texts.
- **CSP:** `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN` is added to `connect-src` and `NEXT_PUBLIC_MEDIA_BASE_URL` to `img-src` (`.env.example` updated; `apps/web/.env.local` was not changed).
- **Results:** web 68/68 (+13), typecheck, lint, and the production build pass.
- **Not verified:** the screens in a signed-in browser (signing in needs the hosted Supabase project and Turnstile); the API flows behind them are covered by the API tests.

### 06: shop management backend (2026-11-07)

- **Shared (`packages/shared/src/shops/`):** constants (field bounds, decision types, change-request statuses, logo limits, rejection and error codes), strict zod schemas (create, update, change request, logo upload request, internal decision, application rejection), and the owner and admin response types. `@chicman/shared` now depends on `zod` (same version as the API).
- **Database:** migration `shop_management`. `Shop` gains the application fields (required, no defaults: the table was empty); new `ShopStatusEvent`, `ShopChangeRequest`, `ShopFieldChangeEvent`, `ShopLogoUpload`, `ShopLogoObject`, and `Notification`. Raw SQL: partial unique indexes (one open change request, one `ACTIVE` logo per shop), E.164 checks, the reason shape of each decision type, change-request decision fields, and completed-upload consistency.
- **API:**
  - `modules/shops/`: owner routes (`POST`/`GET`/`PATCH /sellers/me/shop`, `…/resubmit`, `…/change-requests`, `…/logo/uploads`, `…/uploads/:uploadId/complete`), the status policy (rules 3–5, 8, 9), the lifecycle (conditional updates, audit, `SELLER` grant on initial approval only, notification, one transaction), change-request decisions, the logo service (claim, verify, record, write, fenced commit, recovery cases A–D), the verifier (`sharp` 0.35.5: magic bytes, header dimensions, full decode within a 1024 × 1024 pixel limit), the S3 adapter (`@aws-sdk/client-s3` 3.1153.0, presigned PUT with `content-type` and `content-length` signed, no flexible checksums), and the cleanup job.
  - `modules/admin/`: decisions, change-request decisions, `GET /admin/shops` (filters `status`, `openChangeRequest`) and `GET /admin/shops/:shopId` (full history).
  - `modules/notifications/`: the allowlisted shop-decision payload, recorded in the decision transaction. There was no notifications module before; only the record exists (no delivery channel or read route yet).
  - `middleware/shop-onboarding.ts`: `requireOwnedShop` (`404` without a shop) and `requireShopOperation` (`403`); the service re-checks the status under a row lock.
  - Logo uploads are rate-limited at 10 per shop per 10 minutes (the spec sets no number).
  - Config: `S3_*`, `MEDIA_PUBLIC_BASE_URL`, `LOGO_COMPLETION_LEASE_MS`, `LOGO_COMPLETION_WINDOW_MS`. Storage is all-or-nothing and required in production; without it, logo routes return `503 LOGO_STORAGE_NOT_CONFIGURED`.
- **Worker:** the logo cleanup job runs every 5 minutes with its own advisory lock, when storage is configured. The schedule and lock helpers take a job name (defaults unchanged).
- **Storage setup:** `pnpm --filter @chicman/api storage:setup [-- --public-acl]` creates both buckets, sets the staging CORS rule (PUT from `CORS_ORIGINS`), and on SeaweedFS makes the media bucket `public-read` (SeaweedFS refused the bucket-policy forms tried; R2 public access is a dashboard setting).
- **Tests:** API 172/172 against PostgreSQL, Redis, and SeaweedFS (+64: 32 shop lifecycle and access, 26 logo flow and cleanup, 2 S3 integration, 4 config). Root typecheck passes.
- **Not done yet:** web and mobile; the Compose `worker` was **not** restarted (its pending 24-hour retention check would reset), so the running worker does not run the logo job yet; `apps/api/.env` was not changed (add the `S3_*` values from `.env.example`).

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
- **Shop logo upload:** presigned PUT (5 min) into a private staging bucket; JPEG/PNG/WebP up to 15 MB and 64 megapixels, no SVG or HEIC; the server verifies and normalizes the content (at most 2 MB and 1024 × 1024, upright, no metadata) and publishes only that result before the public `logoUrl` is saved. Completion is idempotent and safe under concurrency, every attempt writes a new immutable object, and orphaned objects are reconciled without deleting referenced logos.
- **Application rejection reason:** mandatory (10–500 characters), shown to the applicant, kept in the audit history. Internal admin notes are separate and never exposed to sellers.
- **Decision reasons and visibility (MVP):** each of the six administrative shop decisions requires exactly one reason (10–500). For an initial application rejection, that reason is also shown to the owner (`rejection.applicantReason`); the other five reasons are internal only. Owners see outcomes (`latestDecision`, including `REINSTATED`, and change-request outcomes), never internal reasons or notes.
- **Shop decision notifications:** one per decision, outcome and non-sensitive status only. They never contain internal reasons, notes, audit metadata, or the rejection reason.
- **Authentication (supersedes phone + SMS OTP):** Supabase Auth with email + password; email confirmation mandatory before an active Chicman account exists (checked server-side at bootstrap); password recovery by Supabase email. The phone is required, unverified contact information, never an identity, and never used for login or recovery. No SMS provider at launch; phone verification may be a later feature. Supabase secret keys only on the API. Callback `/auth/callback` (web, plus mobile App Links / Universal Links, browser fallback); token-hash email templates for cross-device confirmation; the phone is entered at account setup and is editable without verification; no sign-in email changes in the first release; Inbucket locally; Resend SMTP in production (the domain stays configurable).
- **Profiles:** the editable fields are `fullName`, `preferredLocale`, and `phone` (required, unverified contact information; no OTP). The phone is collected only at account setup (not on the sign-up form). Phone changes are recorded in a private, append-only `CustomerPhoneChange` history, kept for 12 months. Avatar is out of scope; email is the auth identity and is not a profile field; auth data stays with Supabase; IDs, roles, and ownership keys are server-managed; addresses belong to the address feature.
- **CAPTCHA:** Cloudflare Turnstile on sign-up, login, and password recovery, verified server-side (Supabase Auth CAPTCHA protection), in addition to rate limits. Enabled on the hosted development project.
- **Bootstrap:** zero application records before bootstrap; exactly one `User` and one `CustomerProfile` after, created or repaired in one transaction with bounded retry on unique conflicts. Refused for unconfirmed emails.
- **JWKS hardening:** timeout, single flight, cooldown with backoff, a bounded negative cache, stale-on-error, and fail closed (`401` unknown key, `503` key set unavailable).
- **Status icons:** meaningful status icons and text use the `state-*-text` tokens (≥ 3:1 and ≥ 4.5:1, both enforced by `tokens:check`). Light fills are for tints only.
- **Storefront and theme selector (updated by feature 08):** the web home `/` is the public storefront, and the Flutter app opens on it, with the account as a dock destination. The theme selector is in the web header and in customer profile settings (device-local preference).
- **Theme behavior:** System by default, with a manual System / Light / Dark selector. The choice persists on the device (key `chicman-theme`); System follows the OS.
- **Flutter fonts are bundled** (no runtime font fetching).

- **Product visibility and availability (feature 07):** published products stay visible at zero stock, marked unavailable, and become purchasable again when replenished, without republishing. Unavailable variants cannot be purchased. Public queries use `PUBLIC_PRODUCT_WHERE`; availability is applied separately.
- **Archiving is reversible (feature 07):** restoring returns a product to `DRAFT` with its data preserved and never publishes it. Archived products stay out of public listings and purchasing.
- **Publication (feature 07):** at least one valid image is required; zero stock does not prevent publication.
- **Product image normalization (feature 07):** the server re-encodes every product image, reduces it to at most 1024 × 1024 and 2 MB, and removes all metadata. Only the result is public. Uploads may be up to 15 MB and 64 megapixels.
- **Public catalog data (feature 08):** availability is exposed as a state, never as a stock quantity. Public shop data is limited to name, description, city, and logo.
- **Cart ownership (feature 09):** a cart belongs to a signed-in customer. Guest carts and merging are out of this version, which replaces the earlier plan in `project-overview.md`.
- **Web cart is a page (feature 09):** `/cart`, as spec 09 requires, replacing the drawer in `ui-context.md`.
- **Price changes need acknowledgement (feature 09, approved 2026-11-09):** a warning stays until the customer accepts the price, removes the line, or the price returns. `POST …/items/:itemId/accept-price` compares the shown price with the current one and stores only the current one. Safeguards: spec 09.
- **Stock figure in the cart (feature 09, approved 2026-11-09):** shown only on a line already above the stock, only for that line, so it can be corrected. Never automatic, never on public pages. Rules: spec 09.
- **Mobile seller management:** not part of feature 07. It is a future feature that reuses the existing seller product API; it has no spec yet.

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

- **First web visit:** defaults to French without reading the browser's language.
- **Email-confirmation check at scale (technical decision):** `GET /auth/v1/user` shares Supabase's per-IP sign-in bucket (30 per 5 minutes), and every account setup comes from the API's IP. Options: the Admin API with the secret key on the API, or `Sb-Forwarded-For` with the secret key and IP forwarding. Either option would reintroduce a Supabase secret key, in the API environment only (it was removed on 2026-11-06 because nothing used it).
- A general personal-data retention policy for the platform is not defined; only the phone change history has one.
- **Features 10–18 (2026-11-09):** the earlier Feature 10 questions (unaccepted prices, unbuyable lines, stock, delivery fee, address fields) are **decided**: `business-decisions-features-10-18.md` (D1–D11, O1, O3, approved by the project owner). O2 (shop owners buying their own products) was confirmed at the Stage 2 review and is enforced by checkout. Still open there: O4–O10 (admin scope, retention, notification recipients, search, favorites, categories, reviews). Audit: `specification-overlap-audit.md`.
- **Notifications delivery (feature 06 follow-up):** shop decision notifications are recorded but not delivered; the channels (in-app list, push, email) and a read API belong to a notifications feature that has no spec yet.

## Next Steps

**Before production (web storefront):** set the same `CATALOG_INTERNAL_KEY` on the API and web, set `NEXT_PUBLIC_SITE_URL` to the real domain (canonical URLs use it), and put the web server behind a proxy that sets `X-Forwarded-For`. `robots.txt` is fixed at build time, so build with the real domain set. Then submit `/sitemap.xml` to Google Search Console.

**Feature 03, verification (no domain needed):**
1. Registered-address anti-enumeration: login with a wrong password, the recovery email arriving, sign-up with an existing address (uses the 2 emails per hour of the built-in provider).
2. CAPTCHA: sign-up and recovery without a token → `captcha_failed`; the web Turnstile failure and retry states.
3. Real expired and reused email links; cross-device confirmation; login with an unconfirmed email.
4. Decide the email-confirmation check approach at scale (see Remaining questions).
5. Rotate the hosted database password (outstanding; the project owner will do it later).

**Feature 04, pending verification (project owner, manual):**
1. After 2026-11-09T17:20:18Z (any further restart moves this), run `docker compose logs -t worker | grep "run #"` in `infrastructure/docker`. Look for `run #2 succeeded` with no `Worker started` line just before it, then tick the spec 04 checklist item. A restart before then resets the 24-hour clock (spec 04, Retention Worker Scheduling).

**Feature 06, remaining (project owner):**
1. Add the `S3_*` and `MEDIA_PUBLIC_BASE_URL` values from `apps/api/.env.example` to `apps/api/.env`, and `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN` / `NEXT_PUBLIC_MEDIA_BASE_URL` to `apps/web/.env.local`, then restart the API and web dev servers. Without them, logo uploads return `503`.
2. After the feature 04 24-hour check, rebuild and restart the worker (`POSTGRES_PORT=5442 REDIS_PORT=6389 docker compose -f infrastructure/docker/docker-compose.yml up -d --build worker`) so it runs the logo cleanup job; until then the running worker does only the retention job.
3. ~~Live check in a signed-in browser and on Android~~ — **done**: verified manually by the project owner on 2026-11-07 (web signed in, Android).
4. ~~R2 verification~~ — **done** 2026-11-08 (7/7 tests and a real browser upload).

**Feature 07, remaining (project owner):**
1. Sign in with an approved seller account and run through `/seller/products` on the web, including photos from real iPhone and Android phones (also over a mobile connection).
3. After the feature 04 24-hour check, rebuild and restart the worker (same command as feature 06, item 2; it resets the 24-hour clock) so the product image cleanup job runs. Until then, removed images stay in storage and abandoned uploads are not expired.
4. Before production: run a product image upload against Cloudflare R2.

**Features 06 and 07, image verification (project owner):**
1. Upload a real Android phone photo with EXIF as a shop logo and as a product image. Check the orientation, dimensions, and size, and inspect the public object for metadata (for example with `exiftool`).
2. Deploy the migrations `product_image_upload_limit` and `shop_logo_upload_limit` with the matching API version.

**Feature 08, remaining (project owner):**
1. Run the storefront on an Android device against an API with published products: home, filters, sorting, details, real images, the Arabic layout, and opening an email link from the storefront.
2. Open the storefront signed in on the web and check the header's account link.

**Feature 09, remaining (project owner):**
1. **Web, real account:** start the API and web, sign in, and follow spec 09's flow with products from two shops: quantity, removal, refresh, header count, a changed price, an unavailable item. Watch the browser console for CSP messages.
2. **Android, real account:** free memory first (for example, stop other projects' containers), then run on a device or one emulator (`adb reverse tcp:4000 tcp:4000`, `adb reverse tcp:8333 tcp:8333`). Check add, quantity, removal, unavailable items, price acceptance, restarting the app, loading, empty, error and retry states, and French and Arabic layouts.
3. **Web and Android on one account:** spec 09's cross-platform sequence.
4. Deploy the migration `shopping_cart` with the matching API version.

**Feature 10, remaining (project owner):**
1. **Seller fee:** on `/seller/shop`, set a delivery fee for each approved test shop (none has one, so nothing can be checked out yet).
2. **Web, real account:** with products from two shops in the cart, open `/checkout`: problems and the link to the cart, choosing and adding an address (and coming back), the recipient, the per-shop fees, placing, the confirmation, and the emptied cart. Check French and Arabic and the console for CSP messages.
3. **Android, real account:** the same flow from the cart screen, including the address choice and a retry after turning the network off during placement.
4. Deploy the migration `order_chain_checkout` with the matching API version.

**Feature 11, remaining (project owner):**
1. **Web, real accounts:** place an order across two shops; as each seller, open `/seller/orders`, confirm one and reject the other; as the customer, check `/account/orders` (labels, reason, contact phones), and cancel a pending one with `OTHER`. Check French, Arabic, and the console for CSP messages.
2. **Android:** the order list, details, and cancellation from the account screen.
3. **Worker:** rebuild and restart it (same command as feature 06, item 2) so the expiry and reminder jobs run; check the logs for `shop order expiry run #`.
4. Deploy the migration `order_lifecycle` with the matching API version.

**Feature 12, remaining (project owner):**
1. **Web, real accounts:** with a confirmed order, on `/seller/orders/[shopOrderId]`: mark ready, dispatch, record a failure with a reason, retry, then "delivered, cash received" (check the amount shown); on another order, fail and close. As the customer, check `/account/orders/[orderId]` (progress, translated reasons, labels). Suspend a shop with a delivery out and a failed one, then check `/seller/deliveries` and that everything else is `403`. French, Arabic, and the console for CSP messages.
2. **Android:** the delivery progress on the order details, in French and Arabic.
3. **Worker:** rebuild and restart it (same command as feature 06, item 2); check the logs for `delivery auto close run #`.
4. Deploy the migration `delivery_attempts` with the matching API version; set `DELIVERY_FAILED_AUTO_CLOSE_DAYS` if not 7.

**Feature 13, remaining (project owner):**
1. **Web, real accounts:** as a seller, deliver an order with "delivered, cash received" and check the collected line on `/seller/orders/[shopOrderId]`; open `/seller/payments` and compare the figures with your orders (try a period with no orders, and one over 366 days). French, Arabic, and the console for CSP messages.
2. **Admin note:** `POST /api/v1/admin/orders/:shopOrderId/payment/notes` with a reason (no admin screen until spec 17); check it shows in `GET /admin/orders/:shopOrderId` and nowhere else.
3. **Android:** the payment status on the order details, in French and Arabic.

**Order chain (specs 15, 16, 17):** checkout (10), the lifecycle (11), delivery (12), and cash on delivery (13) are built. Remaining, in the planned order: 15 (phase 1 rest: keys for shop decisions, read API, notification centers), 16, 17 (admin order screens over the existing `/admin/orders` API); 14 and 18 independently.

**Future feature (no spec yet):** mobile seller management in Flutter, reusing `/api/v1/sellers/me/products`.

**Optional, local:** install the Supabase CLI and create `supabase/config.toml` (Inbucket, asymmetric signing key, `[auth.captcha]` with test keys).

**Deferred until a domain exists:** Resend custom SMTP and DNS (SPF, DKIM, DMARC); apply the branded templates (`apply-auth-config.mjs` step 2); external-recipient email tests; production Site URL and allowlist; `assetlinks.json` and `apple-app-site-association`; iOS build and Universal Links test; production CSP origins and HSTS.

**Decision (2026-11-05), still in force:** keep Supabase's default email provider for development; do not configure SMTP or apply the custom templates until a domain is verified.
