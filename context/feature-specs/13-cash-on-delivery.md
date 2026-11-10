# 13 — Cash on Delivery

## Goal

Implement cash on delivery as Chicman's initial and only supported payment method. Track the amount due, collection by each seller, and the final payment state of each shop order.

Business rules come from `context/business-decisions-features-10-18.md` (D2, D5–D10; approved 2026-11-09).

**Built:** `Payment`, `PaymentEvent`, and `createPayment` (with spec 10, 2026-11-09); `markPaymentCancelled` and `markPaymentFailed` (with spec 11, 2026-11-10); `collectPayment` (`collect`, with spec 12, 2026-11-10); the rest — administrator correction notes, the seller collection summary, the seller's collection details, and the screens — on 2026-11-10 (Implementation Notes).

## Design & Architecture Decisions

### 1. Ownership

This feature owns:

- the payment record;
- payment statuses and events;
- the collection rules and the collection function (called by spec 12's "delivered" action);
- the closing functions (called by specs 11 and 12);
- administrator correction notes;
- reconciliation.

| Not owned here | Owner |
|---|---|
| Creating the payment at placement | Spec 10's transaction, through this feature's creation function |
| Order and delivery statuses | Specs 11 and 12. This feature never sets them |
| Fee value | Spec 06 |
| Fee snapshot | Spec 11 |

**Code location:** a new module, `apps/api/src/modules/payments/`.

### 2. Scope

- Cash on delivery (COD) is the only payment method in the MVP.
- Do not integrate online card payments, wallets, bank transfers, or third-party payment providers.
- Cash is collected by the seller, or whoever delivers for them, for their own delivery. **Only the shop owner records it. Administrators never record collection** (D9).
- In a multi-shop checkout, COD collection is independent for each shop order and occurs with that seller's delivery.
- Do not introduce platform commission settlement, seller payouts, or a financial ledger.

### 3. Amount due

- **One payment per shop order** (unique), created `PENDING` at placement with `amountDue` = the shop order's products subtotal + its delivery fee snapshot (spec 11, D2).
- **Never recalculated:** product prices and totals are not recomputed from current catalog prices after checkout.
- **Currency:** `DECIMAL(12, 2)`, MRU, decimal strings in the API.

### 4. Separate facts

- A seller confirming an order does not mean it has been paid.
- A delivery and a collection are separate records.
- They are recorded **by one seller action, "delivered, cash received"** (spec 12), in one transaction. The delivery becomes `DELIVERED`, the shop order `DELIVERED`, and the payment `COLLECTED` together, or nothing changes (D9).
- **No "delivered but unpaid":** a customer who cannot pay is a failed attempt with reason `CUSTOMER_COULD_NOT_PAY` (spec 12). The payment stays `PENDING` while the delivery can still be retried.

### 5. Statuses and mapping (D9)

| Status | Set when | Final |
|---|---|---|
| `PENDING` | At placement; stays during confirmation, preparation, dispatch, and open failed attempts | No |
| `COLLECTED` | The delivered action (spec 12) | Yes |
| `FAILED` | The delivery is closed as undeliverable: shop order `FAILED_DELIVERY` | Yes |
| `CANCELLED` | The shop order becomes `REJECTED`, `CANCELLED`, or `EXPIRED`, so no delivery was attempted | Yes |

Each change is a conditional update from `PENDING`, in the transaction of the triggering order or delivery change. A final payment never changes again.

### 6. Collection rules

- **Eligible delivery:** an open attempt (`OUT_FOR_DELIVERY`) on the seller's own shop order, whose shop is `APPROVED` or, under spec 12's narrow guard, `SUSPENDED`.
- **Exact amount only:** no partial payment and no discount at the door. The collected amount always equals `amountDue`.
- **Client amount is a check only:** the request carries the amount the seller was shown. A different value → `409 PAYMENT_AMOUNT_MISMATCH`, and nothing changes. The stored amount always comes from the payment record, never from the request. Strings only: numbers, other fields, or malformed amounts → `400`.
- **No double collection:** the conditional update from `PENDING` refuses a second collection. Repeating a completed delivered action returns the current state and writes nothing.
- **Recorded on collection:** who recorded it (the shop owner's user), when, and the amount.

### 7. Corrections (D9)

- **Statuses are final:** nothing is overwritten, reversed, or deleted.
- **Admin notes:** an administrator may append a **correction note** to a payment, with a required reason (10–500 characters, plain text). This records a dispute or a mistake for the audit trail without changing any status or amount.
- **Restrictions:** never on a shop the administrator owns (`403 SHOP_SELF_ADMINISTRATION_FORBIDDEN`, as in spec 06). Notes are internal: never in customer or seller responses or notifications.

### 8. Audit trail

Every payment change appends a **payment event**: `CREATED`, `COLLECTED`, `FAILED`, `CANCELLED`, or `ADMIN_NOTE`, with the amount (where relevant), actor type, actor user, time, and reason or note.

Events are written in the same transaction as the change, and no route updates or deletes them.

### 9. Reconciliation

Reconciliation compares, for each shop order, the amount due with the amount collected. They are always equal for `COLLECTED`, by section 6.

The seller also gets a **collection summary** over a period:
- the number and total of collected payments;
- the number of failed and cancelled payments;
- the total still `PENDING`.

There is no ledger, settlement, commission, or payout.

### 10. Visibility

| Viewer | Sees |
|---|---|
| Customer (own orders) | Payment method (Cash on Delivery), amount due, status |
| Seller (own shop orders) | The customer's view, plus collection time and amount |
| Administrator | Everything, including events and correction notes |

Customer-facing payment responses carry no internal audit metadata.

### 11. Returns and refunds (D10)

Returns, exchanges, and refunds are handled entirely outside Chicman in the first release. A collected payment stays `COLLECTED`, and there is no refund status or record.

## Implementation Details

Likely areas:

- `apps/api/src/modules/payments/` — records, creation, collection and closing functions, routes, views.
- Prisma schema and migrations (below).
- `apps/web/` — the amount due and the "delivered, cash received" confirmation on the seller order page; the seller collection summary (web only, O1); the customer payment display.
- `apps/mobile/` — customer payment method and status in order details. **No seller payment screens in Flutter** (O1).
- `packages/shared/` — payment types, statuses, error codes.
- `context/architecture.md` — the new `payments` module boundary.
- `context/progress-tracker.md`.

### Database

| Model | Key fields | Constraints |
|---|---|---|
| `Payment` | `id`, `shopOrderId`, `method` (`CASH_ON_DELIVERY`), `amountDue`, `status`, `collectedAmount`, `collectedAt`, `collectedByUserId`, `createdAt`, `updatedAt` | Unique `shopOrderId`; `amountDue ≥ 0`; `collectedAmount = amountDue` exactly when `COLLECTED` |
| `PaymentEvent` | `id`, `paymentId`, `type`, `amount`, `actorType`, `actorUserId`, `reason`, `createdAt` | Append-only; index `(paymentId, createdAt)` |

### Functions used by other features

These run inside the caller's transaction:

| Function | Called by | Effect |
|---|---|---|
| `createPayment` | Spec 10 placement | Creates the `PENDING` payment and its `CREATED` event |
| `collect` | Spec 12 delivered action | Applies section 6 |
| `markFailed` | Spec 12 final closure | `PENDING` → `FAILED` |
| `markCancelled` | Spec 11 rejection, cancellation, expiry, suspension | `PENDING` → `CANCELLED` |

### Routes

| Route | Guard | Purpose |
|---|---|---|
| `GET /api/v1/sellers/me/payments/summary?from=&to=` | `approvedSeller` | Section 9. UTC dates, at most 366 days |
| `POST /api/v1/admin/orders/:shopOrderId/payment/notes` | `role("ADMIN")` | `{ reason }`. Correction note |

Customers and administrators read payments through spec 11's order routes.

### Requirements

- Persist the COD payment method and amount due when the order is committed.
- Associate payment records with the correct shop order.
- Use transactional and idempotent collection operations.
- Enforce seller ownership on collection operations.
- Ensure a seller cannot collect a different amount from the amount due.
- Do not trust an amount or payment status supplied by the client.
- Preserve payment history and prevent unauthorized changes to completed collection records.
- Keep customer-facing payment responses free of internal audit metadata.

## Verification Checklist

- [x] Checkout creates one `PENDING` COD payment per shop order, with its `CREATED` event.
- [x] Multi-shop checkout creates independent COD obligations for each shop order.
- [x] The amount due equals the shop order's products subtotal plus its delivery fee snapshot, and never changes with catalog prices.
- [x] Collection happens only through the delivered action on an open attempt of the seller's own shop order.
- [x] A seller cannot collect payment for another seller's order (`404`).
- [x] Duplicate collection requests cannot collect twice.
- [x] A displayed amount different from the amount due is refused (`409`), and the stored amount always comes from the server.
- [x] Failed delivery (final) sets the payment `FAILED`; rejection, cancellation, expiry, and suspension set it `CANCELLED`; an open failed attempt leaves it `PENDING`.
- [x] A final payment never changes; administrator correction notes are appended without changing status or amount, and are refused on the administrator's own shop.
- [x] Payment events retain actor and timestamp information and cannot be edited.
- [x] The seller collection summary matches persisted payments.
- [x] Customer responses show method, amount due, and status only.
- [x] API, web, and mobile tests cover the supported workflows.

## Implementation Notes (2026-11-10)

### Scope

The payment record, its events, creation, the closing functions, and `collect` were built with specs 10–12, with their database checks (`amountDue ≥ 0`, collected amount exactly when `COLLECTED`). This step added the rest: correction notes, the collection summary, the seller's collection details, and the screens. No migration was needed.

### Decisions the spec left open

- **Module:** `payment-views.ts` (one view per viewer: `customerPaymentView`, `sellerPaymentView`, `adminPaymentEventView`, used by spec 11's and 12's views), `payment-service.ts` (`PaymentService`: `addAdminNote`, `sellerSummary`), `payments.routes.ts`. Shared contracts: `packages/shared/src/payments/payments.ts`.
- **Seller view (section 10):** `SellerPayment` = the customer's view plus `collectedAmount` and `collectedAt` (`null` until collected), in the seller shop order detail and in every `SellerDelivery` (delivery action results and the in-progress list). The customer view is unchanged: method, amount due, status.
- **Correction note:** `POST /admin/orders/:shopOrderId/payment/notes`, body `{ reason }` only (plain text, trimmed, 10–500, as shop decision reasons). Order of checks: role guard `403` → body `400` → unknown shop order `404 SHOP_ORDER_NOT_FOUND` → own shop `403 SHOP_SELF_ADMINISTRATION_FORBIDDEN`. It appends an `ADMIN_NOTE` event (no amount, actor `ADMIN`) and touches nothing else, on any payment status, final ones included. Each call appends a new note (no idempotency key). Response `201` with the new event (`AdminPaymentEvent`). Notes appear only in the admin shop order detail's `payment.events`. The admin screen for adding notes belongs to spec 17 (admin order screens); this spec lists no admin screen.
- **Summary period (section 9):** `from` and `to` are both required UTC days, both included, `from ≤ to`, at most 366 days (`400 BAD_REQUEST` otherwise). The period selects the shop orders **placed** in it (`ShopOrder.createdAt`, as the admin order list filter), so "still `PENDING`" is meaningful and the four counts partition those payments. Response: `{ from, to, collected: { count, total }, pending: { count, total }, failed: { count }, cancelled: { count } }`; `collected.total` sums the collected amounts, `pending.total` the amounts due. Guard `approvedSeller`: a suspended shop's owner gets `403`.
- **Clients:** web `/seller/orders/[shopOrderId]` shows "Encaissé : {montant} le {date}" once collected; new page `/seller/payments` (period form defaulting to the current UTC month up to today, checked with the API's schema before asking), linked from `/seller/orders`. Customer payment display (web and mobile) was already built with spec 11; a mobile widget test now covers method, amount due, and each status. No Flutter seller screens (O1).
- **Tests:** API +12 (`test/payments.test.ts`: contracts, views, notes, refusals, summary and its reconciliation against the records, period boundaries), web +4, Flutter +1. Removing the summary's shop filter and removing the self-administration check were each caught.
