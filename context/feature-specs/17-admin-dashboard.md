# 17 — Admin Dashboard

## Goal

Provide platform administrators with a secure web workspace to oversee Chicman, review shop applications, manage platform data, and monitor marketplace operations.

## Design & Architecture Decisions

- The admin dashboard is web-only.
- Administrative authorization must be enforced server-side.
- Do not grant admin privileges through client-side role selection, registration fields, or editable user profiles.
- Admin accounts must be provisioned through the approved administrative process.

- **AT-1 (2026-11-13): account types implemented in the API, the web, and Flutter (phases 4, 7, 8).** Administrator is its own account type, created only by the operator script `admin:provision` for a confirmed identity that has no buyer or seller account (replacing `admin:grant`, which added `ADMIN` to a customer). Administrators cannot buy, own a shop, or open the buyer or seller areas, and have no notification inbox. The protected admin layout redirects every other type. An administrator is removed by **deactivating administrative access** (operator script, audited); the account is never converted to another type. The personal phone is optional for administrators. "Never on a shop the administrator owns" stays checked as defense in depth. The API (phase 4), the web (phase 7), and Flutter (phase 8) follow this. Details: `account-types-audit.md`.
- The dashboard must respect the existing role and permission model.
- Administrative capabilities include:
  - Shop application review and decisions.
  - Shop suspension and reinstatement.
  - Shop change-request review.
  - User and account oversight. **Post-V1 (project owner, 2026-11-20; O4):** no dedicated customer-management capability in V1.
  - Individual product moderation. **In V1 (project owner, 2026-11-20; O4).** Specified in `19-product-moderation.md` (approved 2026-11-20; O11 resolved). Built 2026-11-20 (`/admin/products`, `/admin/moderation`).
  - Order and delivery oversight (approved scope below).
  - Platform category management. **Post-V1 (project owner, 2026-11-20; O10):** no administrator-managed category CRUD in V1; categories stay the fixed list of spec 07.
  - Basic marketplace statistics. **Post-V1 (project owner, 2026-11-20; O4):** no dedicated marketplace analytics or statistics dashboard in V1.
- **Not in V1 (project owner, 2026-11-20):** product ratings and reviews (O10), so there is nothing to moderate there.
- **Order and delivery oversight (D6, D9, D11, approved 2026-11-09).** The rules and routes belong to specs 11 and 13; this feature provides the screens.
  - **Read:** all shop orders, with their items, delivery snapshot, history, delivery attempts, payment, payment events, and stock movements (`GET /api/v1/admin/orders…`, spec 11).
  - **Cancel:** a shop order that is `PENDING`, or `CONFIRMED` with the delivery not yet out for delivery, with a required internal reason (10–500) and an optional internal note. The customer sees only "Annulée par Chicman" (spec 11).
  - **Annotate:** append a correction note with a required reason to a payment. No status or amount changes (spec 13).
  - **Never on a shop the administrator owns** (`403 SHOP_SELF_ADMINISTRATION_FORBIDDEN`, as spec 06). Reading orders of their own shop is not a decision and is allowed.
  - **No other order, delivery, or payment action.** Administrators do not confirm, reject, dispatch, deliver, record collection, or reopen anything.
- All sensitive administrative decisions must be audited.
- Follow Spec 06 for shop decisions, required reasons, applicant-facing rejection reasons, and protected information.
- Admin decision reasons are internal unless an existing specification explicitly authorizes owner visibility.
- Do not allow admins to modify customer authentication identities or protected ownership fields through generic profile editing.
- Statistics must be derived from actual data and clearly define their time period and meaning.
- Do not introduce complex BI, accounting, seller payouts, or advanced fraud detection in the MVP.
- Do not duplicate business rules already implemented in individual feature modules.

## Implementation Details

Inspect the existing admin routes, role model, and shop-management implementation.

Likely areas:
- `apps/api/src/` — admin authorization, moderation, reporting, and administrative operations.
- Prisma schema and migrations — only where existing audit or administrative data is insufficient.
- `apps/web/src/app/` — admin dashboard routes and layouts.
- `apps/web/src/components/` — admin navigation, tables, filters, decision forms, and statistics.
- `packages/shared/` — administrative contracts and types.
- `context/architecture.md`
- `context/feature-specs/06-shop-management.md`
- `context/progress-tracker.md`.

Requirements:
- Create a protected admin layout.
- Enforce admin permissions on every administrative API operation.
- Provide shop application review with the required decision reasons.
- Provide suspension, reinstatement, and change-request decisions according to Spec 06.
- Preserve audit history and prevent unauthorized modification of historical decisions.
- Provide safe order and delivery oversight as approved above. Individual product moderation is required in V1 and specified in spec 19 (approved 2026-11-20). User oversight is post-V1.
- Avoid exposing sensitive authentication information or internal data unnecessarily.
- Make administrative lists searchable, filterable, and paginated where appropriate.
- Use real persisted data for statistics (post-V1).
- Do not create a public admin registration flow.

## Verification Checklist

- [x] Only authorized admins can access admin routes and APIs. *(API: `admin` guard on every route, authorization matrix; web: `AccountGate area="admin"` on every admin page.)*
- [x] Admin provisioning follows the approved process. *(AT-1 `admin:provision`; no public registration.)*
- [x] Shop review and decisions follow Spec 06.
- [x] All required administrative reasons are validated. *(Shared schemas, used by the API and by the web forms before sending.)*
- [x] Administrative actions are audited. *(`ShopStatusEvent`, change requests, `ShopOrderStatusEvent`, `PaymentEvent` `ADMIN_NOTE`.)*
- [x] Non-admin users cannot perform administrative operations.
- [x] Product moderation preserves ownership and protected fields. *(V1; spec 19, built 2026-11-20: moderation writes only the moderation state, its case, and its event; seller fields, ownership, and orders are untouched. User management is post-V1.)*
- [x] Order and delivery oversight does not bypass normal business invariants: administrators can only read, cancel before dispatch, and annotate payments, never on their own shop.
- Statistics use real data and correct definitions. *(Post-V1 by the owner's decision of 2026-11-20; not a V1 check.)*
- [x] Lists support appropriate filtering and pagination.
- [x] French and Arabic RTL support works. *(Every text exists in both languages, checked by a test; browser checks with a real administrator passed, reported by the project owner on 2026-11-14.)*
- [x] API and web tests cover authorization and administrative workflows.

## Implementation Notes (2026-11-14)

- **Scope built:** the approved parts only. Shop review, suspension, reinstatement, and change requests already existed from spec 06 (API and web); order and delivery oversight routes from specs 11 and 13. This feature adds the admin area navigation, the order oversight screens, and search and pagination on the lists. **Not built:** user oversight, product moderation, and statistics (O4), category management (O10). *(2026-11-20, project owner: product moderation is V1, specified in spec 19 (approved 2026-11-20), and not built yet; user oversight, statistics, and category management are post-V1.)*
- **Shared (`packages/shared/src/admin/admin.ts`):** `adminShopListQuerySchema` (`status`, `openChangeRequest`, `q` plain text 1–100, `page`, `pageSize` default 20, at most 50), `normalizeOrderReferenceSearch` and `orderReferenceSearchSchema`. `AdminShopListResponse` now carries `page`, `pageSize`, `total`. `adminOrderListQuerySchema` (spec 11) gains `reference`.
- **API (no new route, no migration):** `GET /admin/shops` validates with the shared schema; `q` matches the shop name or city (case-insensitive, contains); paginated, still oldest change first. The old `limit` parameter is refused (`400`; only the web used it). `GET /admin/orders?reference=` matches order references containing the code: case-insensitive, spaces ignored, with or without `CM-`, 3–10 letters or digits (`400` otherwise).
- **Web:** `features/admin/admin-dashboard.ts` (areas, list queries checked with the API's schemas, paths, cancellation and payment-note bodies), `components/admin-shared.tsx` (session-guarded API hook, reason form, pagination), `components/admin-orders.tsx`. `AdminShell` has a navigation (Boutiques, Commandes). `/admin/shops`: search, an "all" filter, result count, pages; the shop detail links to the shop's orders. `/admin/orders`: status chips, reference search, placement days (UTC), the shop filter from `?shopId=`, pages. `/admin/orders/[shopOrderId]`: shop and customer, decision (with internal reason and note), items and amounts, the delivery snapshot, the delivery record (attempts with actors, history, automatic closure), the payment and its events, the order history, stock movements; the cancellation form only when the API says `canCancel`, and the payment note form (`403` on an owned shop is explained). No other action is offered.
- **Tests:** API 677 (+1 shop search and pagination; the order list test covers the reference search). Web 284 (+13 in `admin-dashboard.test.ts`, including French/Arabic key parity). Typecheck, lint, and the production build pass.
- **Verified (2026-11-14):** the project owner reported that all browser checks with a real administrator session passed.
