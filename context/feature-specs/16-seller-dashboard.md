# 16 — Seller Dashboard

## Goal

Provide approved sellers with a web workspace to manage their shop operations, products, orders, deliveries, and COD collections. The dashboard must reflect the seller's actual permissions and shop status.

## Design & Architecture Decisions

- The seller dashboard is a web-only experience.
- **Flutter (O1, approved 2026-11-09):** seller-side order, delivery, and cash-on-delivery screens are web-only in the first release. The Flutter app stays customer-focused (shopping, checkout, customer order tracking). Flutter keeps its existing shop application and shop status screens from spec 06, which are not removed. Seller mobile functionality may come in a future phase.
- Only an authenticated owner of an `APPROVED` shop with the required seller authorization can perform normal seller operations.
- Pending or rejected applicants may access only the shop application and status-management areas permitted by Spec 06.
- Suspended sellers must not perform normal shop operations. **The one exception** (D8, spec 12 section 8): the owner of a `SUSPENDED` shop sees only the deliveries that were already out for delivery, or failed and not closed, at suspension. For those, they may mark delivered with the cash collection, mark failed, or close as undeliverable. No new attempts, and nothing else.
- The dashboard must not bypass API authorization. Hiding a button is not a security control.
- A seller can manage only their own shop and its resources.
- The dashboard should provide access to the following. Each area's rules and screens belong to the listed spec; this feature provides the shell and navigation only.

| Area | Owner | Existing route |
|---|---|---|
| Shop profile and permitted shop settings, including the delivery fee (D2) | Spec 06 | `/seller/shop` (exists) |
| Product management | Spec 07 | `/seller/products…` (exists) |
| Inventory and stock | Spec 07 | `/seller/products…` (exists) |
| Orders and seller decisions | Spec 11 | `/seller/orders…` (new) |
| Delivery management | Spec 12 | On the seller order pages |
| COD collection status and the collection summary | Spec 13 | On the seller order pages, plus the summary |
| Notifications | Spec 15 | Notification center |

- **Missing delivery fee:** while an `APPROVED` shop has no delivery fee, the dashboard shows a prompt to set one, because its products cannot be checked out (D2).
- Show operational summaries using real persisted data.
- Do not introduce financial analytics, seller payouts, advertising, advanced reports, or multi-shop management in the MVP.
- Reuse existing design tokens, components, localization, and responsive behavior.

> **AT-1 (2026-11-13): account types implemented in the API, the web, and Flutter (phases 4, 7, 8).** The seller area becomes **Seller accounts only**: buyers and administrators are redirected to their own area, so the "no shop yet → become a seller" state and the account page's "Ma boutique" link for buyers go away (a Seller always has a shop from registration). The status-dependent areas and restricted states built here are unchanged. The API (phase 4), the web (phase 7), and Flutter (phase 8) follow this. Details: `account-types-audit.md`.

## Implementation Details

Inspect existing web routes and implemented features before deciding what to create.

Likely areas:
- `apps/web/src/app/` — seller dashboard routes and layouts.
- `apps/web/src/components/` — seller navigation, tables, forms, and status components.
- `apps/web/src/lib/` — API access and role-aware navigation.
- `apps/api/src/` — only add endpoints if an existing feature does not already provide the required data.
- `packages/shared/` — shared contracts.
- `context/ui-context.md`
- `context/progress-tracker.md`.

Requirements:
- Build a seller-specific layout and navigation.
- Show the current shop status clearly.
- Provide appropriate pending/rejected/suspended states without exposing internal administrative reasons. The suspended state shows the in-progress deliveries list (`GET /api/v1/sellers/me/deliveries/in-progress`, spec 12) when it is not empty.
- Integrate existing product, order, delivery, payment, and notification features instead of duplicating their business logic.
- Show useful empty, loading, and error states.
- Use server-authorized API data for dashboard summaries.
- Ensure responsive web behavior and French/Arabic RTL support.
- Do not create seller screens in Flutter.

## Verification Checklist

- [x] Approved sellers can access their dashboard.
- [x] Customers and unauthorized users cannot access seller operations.
- [x] Pending, rejected, and suspended shops receive the correct restricted experience; a suspended shop sees and can finish only its in-progress deliveries.
- [x] An approved shop without a delivery fee sees the prompt to set one.
- [x] Sellers can access only their own shop data.
- [x] Product, order, delivery, COD, and notification sections use existing feature APIs.
- [x] Dashboard summaries match persisted data. *(Real-account verification reported done by the project owner on 2026-11-20, QA audit QA-02.)*
- [x] Loading, empty, and error states are implemented.
- [x] Responsive layout works at supported screen sizes.
- [x] French and Arabic RTL layouts work correctly.
- [x] Web tests cover access control and important seller workflows.

## Implementation Notes (2026-11-11)

**Web only; no API, shared-contract, or Flutter change.** Every figure comes from an existing endpoint, so no endpoint was added.

- **Shell** (`apps/web/src/app/[locale]/seller/layout.tsx`, `features/seller/`): `SellerShopProvider` reads `GET /sellers/me/shop` (spec 06) on sign-in and again on each page change; `SellerShell` shows a header (wordmark, "Espace vendeur", theme selector, language switch, storefront link, notification bell) and the navigation the status allows: a sidebar from `md` up, a horizontally scrolling pill row below. Guests go to `/login`; a `403` on the shop read goes to `/account`, as on the shop page.
- **Areas by status** (`seller-dashboard.ts`, `sellerAreas`): approved → overview, shop, products, orders, deliveries, payments, notifications; pending, rejected, or no shop yet → overview, shop, notifications; suspended → overview, shop, deliveries, notifications (D8). The layout always renders the page (Next.js validates every segment for instant navigation, so a layout must not drop `{children}`); the seven pages a status can close (products, new product, product, orders, order, deliveries, payments) wrap their content in `SellerAreaGate`, which shows a loading state while the shop is read and, outside these areas, a restricted state (`sellerGate`) that says why in general terms and links to the application or the deliveries; it never shows an administrative reason. While the shop cannot be read (outage) the page itself is shown and its own API calls decide. **The API remains the only control.**
- **Overview** (`/seller`, `SellerOverview`): name, status badge, and the status help text from spec 06. Approved: the missing-fee prompt (D2) and eight tiles, each a link to its area: orders awaiting a decision and confirmed orders (`GET /sellers/me/orders?status=…&pageSize=1`, its `total`), deliveries in progress (`GET /sellers/me/deliveries/in-progress`), published products and drafts (`GET /sellers/me/products?status=…&pageSize=1`), amounts to collect and collected this month (`GET /sellers/me/payments/summary`, the current UTC month as on `/seller/payments`), and unread notifications (the bell's count). Each tile loads on its own (skeleton, then the value or "—" with one retry). No products at all → an "add a product" prompt. No shop → the invitation to apply. Suspended → the in-progress deliveries list with its actions, hidden when empty (the list was extracted from `/seller/deliveries` as `InProgressDeliveryList`, so the logic exists once).
- **Existing pages:** unchanged behavior; their own wordmark was removed (the shell header carries it). `NotificationsAreaBar` was removed (the bell is in the header). The account page's "Ma boutique" link now opens `/seller`.
- **Build fix (pre-existing):** `NotificationsProvider` read `usePathname()` outside `<Suspense>`, which made `next build` fail on `/seller/orders/[shopOrderId]` (it failed on the committed code too). The page-change refresh now sits in a small component inside `<Suspense>`; the behavior is the same.
- **Tests:** web 260/260 (+16 in `features/seller/seller-dashboard.test.ts`: areas per status, path parsing with and without a locale, the gate for every status, the delivery-fee rule, the summary queries checked against the API's own schemas, French/Arabic message parity). The seller workflows themselves keep their tests in `orders` and `products`. Typecheck, lint, and the production build pass.
- **Browser check (dev server, stubbed session and API):** approved with and without a fee (FR, 1280 px), suspended on `/seller/orders` (restricted, four-item navigation), suspended overview with no deliveries (list hidden), pending on `/seller/products` and no shop on `/seller/payments` (restricted), Arabic RTL at 390 px with no horizontal page scroll. **Not verified:** a real sign-in with persisted data, and a suspended shop with real deliveries in progress.

