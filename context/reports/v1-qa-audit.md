# Chicman V1 — Independent QA Audit

**Date:** 2026-11-17
**Auditor role:** independent QA (did not write the code under review)
**Commit audited:** `60ac066` on `develop` (working tree clean at the start of the audit)
**Verdict:** **QA FAIL** (see section 14). The core marketplace logic tested well. V1 still cannot launch: required launch infrastructure is missing, the real-account journeys have never been run, one mobile-web layout defect remains, and the owner has not decided part of the V1 scope.

---

## 1. Executive summary

The API's business core is solid. Checkout, stock, the order lifecycle, delivery, cash on delivery, suspension rules, and authorization all held up under independent adversarial tests:
- concurrent last-unit checkouts;
- idempotency-key storms;
- price changes during checkout;
- forged totals;
- cross-tenant access;
- suspension during delivery;
- expiry racing a seller confirmation;
- stale search indexes.

None of these found a business-rule defect. All existing suites pass: API 703, web 299, Flutter 276, plus 39 integration tests that are skipped by default and that I ran explicitly. Typecheck, lint, and `flutter analyze` are clean.

V1 is still not ready to launch, for four reasons:

1. **Launch infrastructure is incomplete (Critical).** Production email delivery is missing: the Supabase default provider sends only to team addresses. Because email confirmation is mandatory, members of the public cannot finish registration. There is also no production deployment configuration: the only API image is a development image, there is no web image, and the only Compose file is for development. App Links, Universal Links, and the production domain are not set up either.
2. **The critical journeys have never run end to end with real accounts.** No real buyer or seller registration has gone through Supabase, Turnstile, and email confirmation since account types (AT-1) were introduced. Checkout → order → delivery has never run in a browser with a real session, or on Android. The project's own tracker says so, and this audit could not close that gap: it had no credentials and no device.
3. **The scope of V1 is undecided (High).** The overview's success criterion 15 says administrators manage customers and products. It also lists ratings and reviews, and category management. All of these are "unresolved" (O4, O10), so they are neither built nor formally descoped.
4. **The mobile-web storefront header overflows (Medium).** At phone widths, the guest's "Se connecter" button is pushed off-screen and the page scrolls sideways, in French and in Arabic.

There is also no CI pipeline, and one test suite silently skips on every normal run (Medium).

---

## 2. V1 scope reviewed

Sources: `project-overview.md`, `architecture.md`, `business-decisions-features-10-18.md` (D1–D11, O1–O10), `account-types-audit.md` (AT-1), and feature specs 01–18.

| Area | In approved V1 scope | Built |
|---|---|---|
| Account types (Buyer, Seller, Administrator), separate registration, operator-provisioned administrators | Yes (AT-1) | API, web, Flutter (buyer only) |
| Email and password auth, mandatory confirmation, Turnstile, recovery | Yes (spec 03) | Yes. Production SMTP, domain, and verified links are pending |
| Profile and phone at setup (04), addresses with GPS (05) | Yes | Yes |
| Shops: application, approval, rejection, suspension, reinstatement (06) | Yes | Yes |
| Products, variants, stock, images (07) | Yes | API and web (seller is web only, O1) |
| Discovery (08), cart (09), checkout (10), orders (11), delivery (12), COD (13) | Yes | API, web, Flutter (buyer side) |
| Favorites (14), notifications, in-app only (15) | Yes | Yes. No email or push channel by design |
| Seller dashboard (16) | Yes | Web |
| Admin dashboard (17) | Partially | Shops, orders, and payment notes only. User oversight, product moderation, and statistics are open (O4); categories are open (O10) |
| Search (18) | Yes | Yes |
| Ratings and reviews; reported issues | Listed in the overview | **No spec; open (O10)** |
| Returns and refunds | Outside Chicman (D10) | Customer is told so |

---

## 3. Test environment and limitations

| Item | State |
|---|---|
| Host | Linux, local development machine |
| Services running | API `:4000` (dev, `tsx watch`), web `:3000` (Next dev), PostgreSQL 17 `:5442`, Redis `:6389`, Meilisearch 1.15 `:7700`, SeaweedFS `:8333`, Compose `worker` (code identical to HEAD; checked file by file) |
| Development database `chicman` | Migrations up to date (16). **Only read** by this audit: GET requests and `migrate status` |
| Test database `chicman_test` | Used by the existing suites and the audit probes. It is reset by design on every test run |
| Meilisearch | Dev index `products` (6 documents) read only. Integration tests used throwaway `test-…` indexes, which they delete; afterwards only `products` remained |
| Object storage | S3 integration test used throwaway `chicman-test-*` buckets, which it deletes |
| Supabase | Not touched. No accounts created, no configuration read or changed |
| Browser | Playwright Chromium, guest only, at 1280, 768, and 390 px, light and dark, French and Arabic |

**Limitations. These areas were not verified by this audit:**
- **Real authentication.** No Supabase credentials were used. Every signed-in flow was exercised through the repository's test harness: real Express app and real PostgreSQL, with a locally signed ES256 JWT in place of Supabase.
- **Android.** No device or emulator was attached (`adb devices` was empty). Flutter is verified only by unit and widget tests and `flutter analyze`.
- **iOS.** No iOS environment. **Unverified.**
- **Physical tablets and phones.** Tablet and mobile web were checked by viewport emulation only, not on hardware.
- **Signed-in web UI.** Cart, checkout, orders, seller, and admin pages were not exercised in a browser.
- **Production configuration** (R2, Resend SMTP, domain, CDN, proxy). It does not exist yet.

---

## 4. Functional test results

Legend:
- **Pass:** verified by this audit.
- **Pass (suite):** covered by the existing passing suite and judged meaningful after reading the code.
- **Unverified:** neither of the above.

### 4.1 Account types and authentication

| Check | Result | Evidence |
|---|---|---|
| Token verification: bad token, `alg:none`, missing token | Pass | Live dev API: `401 UNAUTHORIZED` for each |
| Account-type isolation (buyer, seller, and admin routes) | Pass | Probe E2E-1 and EDGE-6. Seller → buyer route `403`; buyer → seller route `403`; buyer or seller → `/admin/orders` `403`. Suite: 80-route authorization matrix |
| Deactivated administrator refused | Pass | EDGE-6: `adminAccessDeactivatedAt` set → `/admin/orders` `403` |
| Unauthenticated access to buyer, seller, and admin web areas | Pass | Browser: guest on `/account`, `/seller`, `/admin/shops` → redirected to `/login` |
| Registration intent, setup by type, conflicts, phone rules | Pass (suite) | `accounts.test.ts`, `account-types.test.ts` (DB triggers, immutability) |
| Real buyer and seller registration with email confirmation and Turnstile | **Unverified** | Needs Supabase. Tracker lists it as pending since AT-1 |
| Cross-device confirmation, expired or reused links, unconfirmed login | **Unverified** | Spec 03 checklist items open |
| Session expiry | Pass (suite) | `token-verification.test.ts` (expired → 401); client refresh not verified live |

### 4.2 Buyer functionality

| Check | Result | Evidence |
|---|---|---|
| Catalog list, facets, details, 404 for unknown or hidden products | Pass | Live API, plus browser real-404 (`Sec-Fetch-Mode: navigate` → `404`, French and Arabic) |
| Input validation on the catalog (page 0, huge page, unknown param, relevance without `q`) | Pass | Live API: `400 BAD_REQUEST` |
| Search (French) | Pass | Live Meilisearch: typos (`bantlon`, `boubo`), `tshirt`/`t shirt`/`t-shirt`, accents (`vetement`), category terms |
| Search (Arabic) | Pass (suite) | Real-Meilisearch tests run explicitly (39/39). Dev data has no Arabic names, so not checked live |
| Cart: price change flagged, accept-price must match the price shown | Pass | EDGE-3: `PRICE_CHANGED` issue; accepting the old price → `409`; accepting the new price → `200` |
| Checkout: multi-shop, per-shop fee, zero fee, totals | Pass | E2E-1: 2 shop orders; totals `3100.00` and `2500.50`; order `5600.50`; one payment per shop order with the right amount due |
| Checkout: forged totals, another buyer's address | Pass | EDGE-4: `409`; `404`; nothing written |
| Checkout: price changed after the summary | Pass | EDGE-3: `409 CHECKOUT_BLOCKED`; no order; stock unchanged |
| Order cancellation by the customer (pending only) | Pass | E2E-1: cancel after confirmation → `409` |
| Order privacy between buyers | Pass | E2E-1: another buyer → `404` |
| Delivery tracking labels | Pass | E2E-1: `DELIVERED/COLLECTED`, `REJECTED/CANCELLED` |
| Favorites, addresses, notifications, buyer dashboard | Pass (suite) | Web and Flutter UI not verified with a real session |

### 4.3 Seller functionality

| Check | Result | Evidence |
|---|---|---|
| Product create, image upload and normalization, publish | Pass | Probes create every product through the real routes |
| Stock compare-and-set against orders | Pass | EDGE-8: seller lowers stock 3→1 → later placement for 3 → `409`; stock never negative |
| Confirm and reject independently per shop | Pass | E2E-1: A confirms, B rejects; only B's stock returned; repeated reject is idempotent |
| Seller isolation | Pass | E2E-1: seller B → seller A's shop order: `404` on read and on confirm |
| Delivery: ready → dispatch → fail → retry → delivered | Pass | E2E-1 |
| COD: exact amount only; repeat is idempotent | Pass | E2E-1: `3000.00` → `409`; `3100.00` → `200`; payment `COLLECTED`; no stock change |
| Cancellation blocked once out for delivery | Pass | E2E-1: `409` |
| Seller dashboard figures against persisted data | **Unverified** | Spec 16 checklist open |

### 4.4 Administrator functionality

| Check | Result | Evidence |
|---|---|---|
| Suspension cancels pending and confirmed-not-dispatched orders, returns stock | Pass | EDGE-5: 2 cancelled, stock 7→9, out-for-delivery order untouched |
| Suspended shop: normal operations `403`; finishing a delivery allowed; products hidden | Pass | EDGE-5 |
| Reinstatement restores no cancelled order | Pass | EDGE-5 |
| Admin cancel before dispatch; internal reason never shown to buyer or seller | Pass | EDGE-6 |
| Admin cancel after dispatch | Pass | EDGE-6: `409` |
| Payment correction note | Pass | EDGE-6: `201` |
| User oversight, product moderation, statistics, categories | **Not built** | Open questions O4 and O10 (see QA-03) |

### 4.5 Search reliability

| Check | Result | Evidence |
|---|---|---|
| A stale index never exposes a hidden or unknown product | Pass | SEARCH-1: engine returned an archived ID and a random ID; only the public product was shown |
| PostgreSQL fallback when the engine fails | Pass | SEARCH-1: `degraded: true`, correct result |
| Worker indexing and reconciliation | Pass | Worker logs: indexing run #2160, reconciliation every 6 h, no failures in 12 h |
| `total` after a stale hit | **Defect (Low)** | QA-06 |

---

## 5. End-to-end workflow results

| # | Workflow | Result |
|---|---|---|
| 1 | Buyer registers → confirms → setup → browse → cart → checkout → tracks delivery | **Partially verified.** Registration and confirmation are unverified (real Supabase needed). Everything from browsing onwards passes at API level (E2E-1). Web and Android UI not verified signed in |
| 2 | Seller registers → setup → shop approved → publishes → fulfills an order | **Partially verified.** Registration unverified. Approval (suite), publishing, and fulfillment through COD collection pass (E2E-1) |
| 3 | Admin reviews a shop, inspects an order, performs an allowed action | Pass at API level (EDGE-5, EDGE-6, and suite). The project owner reported a browser check on 2026-11-14 (not repeated here) |
| 4 | Multi-shop checkout, independent seller orders, correct COD amounts | **Pass** (E2E-1) |
| 5 | Shop suspended while orders are in flight; existing-order rules respected | **Pass** (EDGE-5) |

---

## 6. Cross-platform results

| Platform | Result |
|---|---|
| Desktop web, 1280 px, Arabic RTL, guest | Pass: correct RTL mirroring, no overflow |
| Tablet web, 768 px emulated, French | Pass: no overflow |
| Mobile web, 390 px emulated, French and Arabic, guest | **Fail: QA-04.** Page overflows 116 px (French) and 85 px (Arabic) on `/` and `/products`; "Se connecter" is off-screen. `/login` and `/cart` pages are fine |
| Dark theme | Renders correctly (390 px, French) |
| Web: signed-in pages | Unverified in browser |
| Android (Flutter) | Unverified on a device. Unit and widget tests 276/276, analyze clean |
| iOS | **Unverified.** No environment; Universal Links not configured |
| Network interruption and recovery | By code review: web and Flutter keep the idempotency key across retryable failures, and the server deduplicates (EDGE-2). Not exercised on a device |

Console: the only errors on `/login` come from inside Cloudflare's Turnstile iframe (its own CSP). None come from Chicman code.

---

## 7. Critical edge cases

| Edge case | Result | Detail |
|---|---|---|
| Concurrent checkout on the last unit (6 buyers) | Pass | One `201`, five `409`; stock 0, never negative; the losers' carts kept |
| Same idempotency key fired 8 times concurrently | Pass | One `201` and seven `200`, all the same order ID; stock taken once. A later reuse of the key with a changed cart returns the original order and writes nothing |
| Price change during checkout | Pass | `409`, no writes |
| Client-forged totals | Pass | `409` |
| Expiry job run twice in parallel with a seller confirmation | Pass | One `EXPIRED` outcome; stock returned exactly once; confirmation `409`; 2 notifications (customer and seller), no duplicates |
| Duplicate notification prevention | Pass | E2E-1: every `eventKey` unique across the whole journey |
| Stock return idempotency (repeated reject) | Pass | Stock unchanged on the repeat |
| Worker restart, single writer (advisory locks) | Pass | Lock suite, run explicitly (see QA-05) |
| Meilisearch down | Pass | Fallback (SEARCH-1, suite) |
| Object-storage failure during upload | Pass (suite) | Fault-injection tests in `shop-logo.test.ts` and `products.test.ts`; real S3 test run explicitly |
| Database outage | Pass (suite) | `database-errors.test.ts` → `503` |

---

## 8. Test coverage quality assessment

**Strengths**
- API tests are real integration tests: real Express, real PostgreSQL with the real triggers and constraints, and real JWT verification against a local JWKS. Mocks are limited to the system boundaries: S3 (backed by a real-S3 suite), Meilisearch (backed by a real-Meilisearch suite), and Supabase email confirmation.
- Assertions check outcomes, not calls: stock values, row counts, "nothing written" snapshots, error codes, and that internal reasons never leak.
- Authorization has a full route × actor matrix that fails when a route is added without an entry.
- Rollback is proven through fault injection (`beforeCommit` hooks).

**Weaknesses**
1. **No CI.** There is no `.github/` directory, although the architecture specifies GitHub Actions. Nothing runs the suites on push or pull request (QA-05).
2. **Silently skipped suites.** `retention-worker.test.ts` reads `TEST_DATABASE_URL` without loading `.env`, so the worker-lock suite **always skips** on `pnpm test`. The real Meilisearch (×2) and S3 suites also skip by default. The summary prints `skipped 0` because skipped suites are reported as passing `# SKIP` lines, so a reader sees "703 pass" and no warning (QA-05).
3. **Web tests are logic only.** The 19 web test files hold no component rendering tests and no browser end-to-end suite. Layout regressions such as QA-04 cannot be caught.
4. **Flutter has no `integration_test`.** Widget tests use stubbed HTTP.
5. **No automated end-to-end test of real Supabase auth.** The signed-in path is proven only with locally signed tokens.

---

## 9. Bugs and reproducible steps

### QA-01 — Launch prerequisites incomplete: public email delivery and production deployment (Critical)

- **Platform:** all.
- **Evidence:**
  - `progress-tracker.md`: "Development uses Supabase's default email provider (team addresses only)"; Resend SMTP, the domain, and templates are "pending domain setup".
  - `apps/api/Dockerfile` is labelled "Development image" (`NODE_ENV=development`, runs `tsx`).
  - No web Dockerfile; `infrastructure/docker/docker-compose.yml` is "Local development services".
  - No `assetlinks.json` or `apple-app-site-association` hosting.
  - The hosted database password rotation is listed as outstanding.
- **Reproduction:** register a buyer with an address outside the Supabase team. The confirmation email is not delivered, so setup can never complete. (Inferred from the documented provider limit; not executed, to avoid writing to Supabase.)
- **Expected:** any member of the public can register, confirm, and buy; a production deployment exists.
- **Actual:** only team addresses can complete registration; no production build or deploy path exists.
- **Impact:** V1 cannot acquire a single real customer or seller.

### QA-02 — Critical journeys never run with real accounts (High; verification gap)

- **Platform:** web and Android.
- **Evidence:**
  - Tracker: "Pending: the owner's manual checks with real registrations, web and Android".
  - Specs 09–13: "a real Supabase sign-in, and Android are **not verified**".
  - Spec 16: "Dashboard summaries match persisted data" unchecked.
- **Expected:** each workflow in section 5 executed once with real accounts on web and Android before launch.
- **Actual:** proven only at API level with test tokens, and by unit and widget tests.
- **Impact:** integration faults are not covered. Examples: client session handling, CSP origins, Supabase token claims, deep links, real GPS and map behaviour, and real phone photos.

### QA-03 — V1 scope undecided for admin oversight, categories, and reviews (High; decision required)

- **Platform:** web (admin), storefront.
- **Evidence:**
  - `project-overview.md` success criterion 15: "Administrators can manage shops, customers, products, and marketplace orders". The Features section lists "Product ratings and reviews", "Product and category management", and "Reported issue management".
  - Spec 17 marks user oversight, product moderation, and statistics "Unresolved (O4)" and categories "Unresolved (O10)".
  - No reviews module exists (`apps/api/src/modules/reviews/` is absent, although `architecture.md` lists it).
- **Expected:** each item either built or formally descoped from V1, with the overview updated.
- **Actual:** neither. An administrator cannot remove an abusive product or look up a customer.
- **Impact:** no moderation tool exists for illegal or counterfeit listings. The only lever is suspending the whole shop.

### QA-04 — Mobile-web storefront header overflows; sign-in button off-screen (Medium)

- **Platform:** web, phone widths (all widths below about 500 px), French and Arabic, guest. Tablet (768) and desktop are fine.
- **Evidence:** `apps/web/src/features/storefront/components/storefront-header.tsx:138`. The actions row `div.flex.items-center.gap-2` (language, "Vendre sur Chicman", bell, favorites, cart, account action) does not wrap or collapse. It measured 490 px in a 390 px viewport after AT-1 added the always-visible "Vendre sur Chicman" link. Measured: `scrollWidth - innerWidth` = 116 px (French) and 85 px (Arabic) on `/` and `/products`.
- **Reproduction:**
  1. Open `http://localhost:3000/` as a guest with a 390×844 viewport.
  2. Observe the horizontal scrollbar. "Se connecter" sits at x = 382–506, outside the viewport.
- **Expected:** no page-level horizontal overflow from 375 px up (`ui-context.md` responsive rule); sign-in reachable without sideways scrolling.
- **Actual:** the page scrolls sideways; the primary sign-in call to action is hidden.
- **Workaround:** scroll sideways, or open the cart or favorites icon, which leads to sign-in.
- **Impact:** most Mauritanian visitors are expected on phones; it is the first screen they see.
- **Note:** the tracker recorded "no overflow at 390 px" for AT-1 phase 7, but that check used a stubbed signed-in session, which has fewer header actions.

### QA-05 — No CI, and one test suite always silently skips (Medium)

- **Platform:** repository and release process.
- **Evidence:**
  - No `.github/workflows`.
  - `apps/api/test/retention-worker.test.ts:178` reads `process.env.TEST_DATABASE_URL` with no `dotenv.config()`, so "retention worker lock (PostgreSQL) # SKIP TEST_DATABASE_URL is not set" appears on every `pnpm test`, while all other suites see the variable.
  - Meilisearch and S3 suites also skip by default.
- **Reproduction:** `pnpm --filter @chicman/api test` → `grep "# SKIP"` shows 4 skipped suites, while the summary reads `skipped 0`.
- **Expected:** CI runs every suite, including service-backed ones; a skipped suite is visible and fails CI.
- **Actual:** the advisory-lock guarantee (one writer per job, which prevents double expiry, double closure, and double reminders) is never tested automatically.
- **Explicit run (this audit):** 39/39 pass with `TEST_MEILI_URL`, `TEST_S3_*`, and an exported `TEST_DATABASE_URL`.

### QA-06 — Search `total` overcounts while the index is stale (Low)

- **Platform:** API; affects web and Flutter result counts and pagination.
- **Evidence:** `catalog.service.ts` `searchList` returns `total: hits.total` from Meilisearch after PostgreSQL drops hidden IDs. SEARCH-1: `total` 3 with 1 product shown.
- **Reproduction:** archive a product; before the worker's next 10 s run, search for its name. The count includes it.
- **Expected:** count and pagination consistent with the visible results.
- **Actual:** "Résultats : N" can exceed the cards shown, and a page can be short. Documented as accepted in the code comment; self-heals within about 10 s.

### QA-07 — Informational

1. **Free-text colors produce messy facets.** Live `/products/facets` returns colors `"bleu, noir, blanch"` (one variant holding a list, misspelled) next to `"Noir"`. Consider guidance or normalization in the seller form.
2. **Customer gets no notification at placement.** The overview lists "Order confirmation notifications", but spec 15 sends `SHOP_ORDER_PLACED` to the seller only; the buyer sees the confirmation screen. The behaviour matches the spec; align the overview's wording.
3. **Spec checklists are stale.** Spec 10's "Sellers can only access their own orders" and spec 06's suspension items are unchecked, but they are implemented and pass (E2E-1, EDGE-5).
4. **Dev services bind to all network interfaces.** PostgreSQL, Redis (no password), Meilisearch (dev master key), and SeaweedFS listen on `0.0.0.0`. This is acceptable on a trusted network only; production must use a private network (`architecture.md` already says so for Meilisearch).
5. **Unused `image_picker` dependency** remains in Flutter (already noted by the tracker).

---

## 10. Severity and business impact

| ID | Severity | Business impact |
|---|---|---|
| QA-01 | Critical | No public registration and no production deployment; V1 cannot launch |
| QA-02 | High | Integration defects could reach the first real customers unseen |
| QA-03 | High | Announced V1 capability (admin customer and product management, reviews) is missing or unscoped; no listing moderation |
| QA-04 | Medium | First impression on phones; sign-in hidden |
| QA-05 | Medium | Regressions can merge undetected; the worker single-writer guarantee is untested in routine runs |
| QA-06 | Low | Brief count mismatch in search results |
| QA-07 | Informational | Data quality and documentation hygiene |

No defect was found in checkout, stock, order lifecycle, delivery, COD amounts, authorization, or notification idempotency.

---

## 11. Missing tests

1. A CI workflow running typecheck, lint, API (with PostgreSQL, Meilisearch, and S3 service containers), web, and Flutter, where any `# SKIP` fails the build.
2. `dotenv.config()` in `retention-worker.test.ts`.
3. Browser end-to-end suite (for example Playwright): guest storefront at 375/390/768/1280 px with an overflow assertion, French and Arabic; checkout with a seeded test account.
4. Web component tests for the header, checkout page, and order pages.
5. Flutter `integration_test` covering browse → cart → checkout → order detail against a test API.
6. A repeatable staging test of real Supabase sign-up and confirmation (Inbucket with the Supabase CLI, as spec 03 intends).
7. Search: a test asserting the behaviour chosen for `total` under a stale index (QA-06).

The independent probes used for this audit are kept outside the repository, in the session scratchpad (`qa-scenarios.test.ts`, 10 scenarios). They can be added to `apps/api/test/` if the owner authorizes it.

---

## 12. Unverified features

- Real buyer and seller registration, email confirmation, Turnstile, recovery, cross-device links, expired or reused links (spec 03).
- Every signed-in web page in a browser: cart, checkout, orders, addresses with map and GPS, favorites, notifications, buyer dashboard, seller area, admin area.
- The Android app on a device: all features; GPS permission; real photos; Arabic layout; network loss during placement.
- iOS: everything, including Universal Links.
- Seller dashboard figures against persisted data (spec 16).
- Product images on Cloudflare R2 and real phone photos with EXIF (specs 06, 07).
- Production SMTP, branded templates, and external-recipient delivery.
- The worker's daily jobs over a full 24 h cycle (only the start-up runs appear in the 12 h log window).

---

## 13. Recommended remediation order

1. **QA-03: decide scope.** Either formally descope admin user oversight, product moderation, statistics, categories, and reviews from V1 (update the overview and success criterion 15), or specify and build at least product moderation.
2. **QA-01: launch prerequisites.** Domain → Resend SMTP with SPF/DKIM/DMARC → Supabase templates and redirect allowlist → production Turnstile hostname → production API, worker, and web images and deployment → R2 → App Links (iOS Universal Links if iOS ships) → rotate the database password.
3. **QA-04:** let the header actions wrap or collapse below `sm` (for example, hide or move "Vendre sur Chicman" into a menu on phones). Retest at 360/375/390 px in both languages.
4. **QA-05:** add CI with service containers and the skip-fails rule; fix the missing `dotenv` call.
5. **QA-02:** run the five section 5 workflows with real accounts on staging, on web and Android, and record the results in the tracker.
6. **QA-06 and QA-07:** low-priority clean-up.

---

## 14. Final decision

**QA FAIL**

One Critical item (QA-01) and two High items (QA-02, QA-03) are unresolved. QA-01 and QA-02 are about environment and verification rather than code. QA-03 is a scope decision. The application code under test performed well: every business-rule probe passed, including concurrency, idempotency, and authorization.

The verdict can move to **QA PASS WITH CONDITIONS** once:
- QA-01 is done for a staging environment;
- QA-03 is decided and documented;
- QA-04 is fixed;
- the section 5 workflows have passed once with real accounts on web and Android (QA-02).

The remaining conditions would then be CI (QA-05) and the iOS decision.

---

### Appendix A — Commands and results

| Command | Result |
|---|---|
| `pnpm --filter @chicman/api test` (test DB) | 703 / 703 pass; 4 suites skipped (see QA-05) |
| Skipped suites run explicitly (retention lock, Meilisearch ×2, S3) | 39 / 39 pass; throwaway indexes and buckets removed |
| `pnpm --filter @chicman/web test` | 299 / 299 pass |
| `flutter test` | 276 / 276 pass |
| `flutter analyze` | No issues |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| Independent probes (scratchpad, test DB) | 10 / 10 pass after two probe-side corrections (the accept-price body; a test-data check constraint). Neither was an application defect |
| `prisma migrate status` (dev DB, read only) | Up to date, 16 migrations |

### Appendix B — Safety log

- No commits, pushes, resets, or branch changes.
- The development database was only read. `chicman_test` was reset by the test suites, as designed.
- No Supabase or production access.
- No application code, specification, or configuration was changed. This report is the only file added.
- Browser screenshots that Playwright wrote under `.playwright-mcp/` were moved to the session scratchpad, leaving the working tree clean apart from this report.
