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

- [ ] Approved sellers can access their dashboard.
- [ ] Customers and unauthorized users cannot access seller operations.
- [ ] Pending, rejected, and suspended shops receive the correct restricted experience; a suspended shop sees and can finish only its in-progress deliveries.
- [ ] An approved shop without a delivery fee sees the prompt to set one.
- [ ] Sellers can access only their own shop data.
- [ ] Product, order, delivery, COD, and notification sections use existing feature APIs.
- [ ] Dashboard summaries match persisted data.
- [ ] Loading, empty, and error states are implemented.
- [ ] Responsive layout works at supported screen sizes.
- [ ] French and Arabic RTL layouts work correctly.
- [ ] Web tests cover access control and important seller workflows.