# 17 — Admin Dashboard

## Goal

Provide platform administrators with a secure web workspace to oversee Chicman, review shop applications, manage platform data, and monitor marketplace operations.

## Design & Architecture Decisions

- The admin dashboard is web-only.
- Administrative authorization must be enforced server-side.
- Do not grant admin privileges through client-side role selection, registration fields, or editable user profiles.
- Admin accounts must be provisioned through the approved administrative process.
- The dashboard must respect the existing role and permission model.
- Administrative capabilities include:
  - Shop application review and decisions.
  - Shop suspension and reinstatement.
  - Shop change-request review.
  - User and account oversight. **Unresolved (O4):** what it shows and its data source (`User` stores no email; the API has no Supabase secret key).
  - Product moderation and platform catalog oversight. **Unresolved (O4, audit C12):** moderation needs a product state or actor that spec 07's lifecycle does not have. Not built until decided.
  - Order and delivery oversight (approved scope below).
  - Platform category management, where supported. **Unresolved (O10, audit C13):** categories are a fixed list (spec 07), so none is supported today.
  - Basic marketplace statistics. **Unresolved (O4):** definitions and periods.
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
- Provide safe order and delivery oversight as approved above. User and product oversight wait for O4.
- Avoid exposing sensitive authentication information or internal data unnecessarily.
- Make administrative lists searchable, filterable, and paginated where appropriate.
- Use real persisted data for statistics.
- Do not create a public admin registration flow.

## Verification Checklist

- [ ] Only authorized admins can access admin routes and APIs.
- [ ] Admin provisioning follows the approved process.
- [ ] Shop review and decisions follow Spec 06.
- [ ] All required administrative reasons are validated.
- [ ] Administrative actions are audited.
- [ ] Non-admin users cannot perform administrative operations.
- [ ] User and product management preserve ownership and protected fields.
- [ ] Order and delivery oversight does not bypass normal business invariants: administrators can only read, cancel before dispatch, and annotate payments, never on their own shop.
- [ ] Statistics use real data and correct definitions.
- [ ] Lists support appropriate filtering and pagination.
- [ ] French and Arabic RTL support works.
- [ ] API and web tests cover authorization and administrative workflows.
