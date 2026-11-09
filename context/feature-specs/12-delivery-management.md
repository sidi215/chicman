# 12 — Delivery Management

## Goal

Allow sellers to manage delivery for their confirmed shop orders, update delivery progress, and record delivery outcomes. Customers can follow delivery status without accessing seller-only operational information.

Business rules come from `context/business-decisions-features-10-18.md` (D2, D4, D5, D8, D9, D11, O1; approved 2026-11-09).

## Design & Architecture Decisions

### 1. Ownership

This feature owns:

- the delivery record and its attempts;
- delivery statuses and transitions;
- failure recording, retry, and closure;
- the "delivered, cash received" action;
- the automatic closure job;
- the in-progress access of suspended shops.

| Not owned here | Owner |
|---|---|
| The order lifecycle, snapshots, stock rules, cancellation | Spec 11 (this feature calls its outcome functions) |
| The delivery fee value | Spec 06 |
| The fee snapshot | Spec 11, written by spec 10 |
| Payment records | Spec 13 (this feature calls its collection and failure functions) |
| Notifications | Spec 15 |

- **Seller-managed delivery:** delivery is handled by the seller, not by a central Chicman delivery fleet.
- **Per shop order:** each seller is responsible for delivering their own shop order. In a multi-shop checkout, each shop order has its own delivery lifecycle.
- **Fees:** determined and managed by the seller in shop settings (spec 06, D2).
- **Who records progress:** only the shop owner (D4). Whoever physically delivers (the owner, an employee, or a courier the seller hires) has no account and no role.
- **Failure responsibility:** belongs to the seller.
- **Communication:** customers see delivery progress and the shop's contact phones on their own order (spec 11). Buyer and seller communicate by phone.
- **Out of scope for the MVP:** GPS tracking, live courier maps, third-party delivery integrations, and automatic courier assignment.

### 2. Records

- **Delivery:** one per shop order (unique). Created by spec 11's confirmation transaction as `PENDING`. **Never created before confirmation, and never for a rejected, cancelled, or expired shop order.**
- **Delivery attempt:** one per dispatch. Number, dispatch time and actor, outcome (`DELIVERED` or `FAILED`; empty while in progress), failure reason, outcome time and actor. At most one open attempt per delivery.
- **Delivery status event:** append-only history (from, to, actor, time, reason).

The delivery uses the shop order's immutable delivery snapshot and fee snapshot (spec 11). It stores no copy of the address and never reads the saved address (spec 05), which may have been edited or deleted.

### 3. Statuses (D4)

| Status | Meaning |
|---|---|
| `PENDING` | The shop order is confirmed; the seller is preparing it |
| `ASSIGNED` | Optional: prepared, and the seller has arranged who delivers |
| `OUT_FOR_DELIVERY` | An attempt is in progress |
| `DELIVERED` | Delivered and paid (with spec 13). Final |
| `FAILED` | The last attempt failed. While `closedAt` is empty, it can be retried or closed. Once closed, it is final (undeliverable) |
| `CANCELLED` | The shop order was cancelled before dispatch. Final |

Keep order status and delivery status distinct. A delivery change updates the shop order **only** in these cases, always in the same transaction:

- `DELIVERED` → shop order `DELIVERED` (and payment `COLLECTED`);
- final closure → shop order `FAILED_DELIVERY` (and payment `FAILED`).

### 4. Transitions

Each is a conditional update from the expected status, writes a status event, and returns the current state on an exact repeat (`409 DELIVERY_STATUS_CONFLICT` on any other mismatch).

| From | To | Actor | Effects |
|---|---|---|---|
| (shop order `CONFIRMED`) | `PENDING` | System, in spec 11's confirmation | — |
| `PENDING` | `ASSIGNED` | Seller | Optional step |
| `PENDING`, `ASSIGNED` | `OUT_FOR_DELIVERY` | Seller | Opens attempt 1 |
| `OUT_FOR_DELIVERY` | `DELIVERED` | Seller: "delivered, cash received" | Closes the attempt; shop order `DELIVERED`; payment `COLLECTED` (spec 13); one transaction |
| `OUT_FOR_DELIVERY` | `FAILED` | Seller, with a required reason | Closes the attempt as failed; `autoCloseAt` = now + the configured period |
| `FAILED` (open) | `OUT_FOR_DELIVERY` | Seller (approved shop only) | Opens the next attempt; clears `autoCloseAt` |
| `FAILED` (open) | `FAILED` (closed) | Seller, or the automatic closure job | `closedAt` set; shop order `FAILED_DELIVERY`; stock returned (spec 11); payment `FAILED` (spec 13) |
| `PENDING`, `ASSIGNED` | `CANCELLED` | System, through spec 11's cancellation | — |

- **No false "delivered":** a seller cannot mark a delivery delivered except through an open attempt (`OUT_FOR_DELIVERY` → `DELIVERED`). No route changes a final delivery.
- **No cancellation after dispatch:** a delivery that is out, or failed and open, cannot be cancelled. Spec 11 refuses the cancellation (`409`).
- **Retries:** after a failure the seller decides: a new attempt, or closure. No attempt limit (D5). The customer asks for a new attempt by phone; there is no in-app request.

### 5. Failure reasons (D5)

Required on every failed attempt, from a fixed list, shown to the customer translated (French, Arabic). No free text.

`CUSTOMER_UNREACHABLE`, `CUSTOMER_ABSENT`, `CUSTOMER_REFUSED`, `ADDRESS_NOT_FOUND`, `CUSTOMER_COULD_NOT_PAY`, `OTHER`.

A customer who cannot pay is a failed attempt with `CUSTOMER_COULD_NOT_PAY` (D9). "Delivered but unpaid" does not exist.

### 6. Automatic closure (D5)

- **When:** a delivery left `FAILED` with no new attempt and no closure is closed as undeliverable once `autoCloseAt` passes.
- **Period:** `DELIVERY_FAILED_AUTO_CLOSE_DAYS`, default 7, a configuration value. It is applied when the failure is recorded, so a later configuration change does not move existing deadlines.
- **Job:** in the existing worker, every 5 minutes, under its own PostgreSQL advisory lock. It handles bounded batches, one transaction per delivery, with the same effects as a seller closure.
  - A conditional update (`status = 'FAILED' AND closedAt IS NULL AND autoCloseAt < now()`) makes a second run, or a racing seller action, change nothing.

### 7. Delivery fee

- **Snapshot only:** this feature shows the shop order's fee snapshot.
- **No fee changes:** no route changes a fee after placement. A shop's later fee changes (spec 06) affect only future checkouts.

### 8. Suspended shops (D8)

- **Already handled at suspension:** spec 11's suspension function cancels deliveries that are `PENDING` or `ASSIGNED`.
- **What the owner of a `SUSPENDED` shop may still do,** for deliveries that are `OUT_FOR_DELIVERY`, or `FAILED` and not closed, and nothing else:
  - mark the attempt delivered with the cash collection;
  - mark the attempt failed;
  - close the delivery as undeliverable.
- **No new attempts:** a failed delivery of a suspended shop can only be closed, by the seller or by the job.
- **What the owner sees:** only these deliveries, with the full delivery snapshot. Other and completed orders stay hidden until reinstatement.
- **Narrow guard:** this access is a new, narrow guard: role `SELLER`, owner of the shop, shop `APPROVED` or `SUSPENDED`, delivery in one of those two states. For an `APPROVED` shop, every delivery operation is available through `approvedSeller`. **`requireApprovedSeller` is not loosened**, and every other seller operation of a suspended shop stays `403`.

### 9. Customer view

On their own order (spec 11), the customer sees:

- the derived status label;
- the dispatch time of the current attempt;
- the number of attempts;
- each failure reason, translated;
- the delivered time.

They never see the seller's internal data. Whoever physically delivers is not recorded.

## Implementation Details

Likely areas:

- `apps/api/src/modules/delivery/` — records, lifecycle service, routes, views, the narrow guard.
- `apps/api/src/workers/` — the automatic closure job (reuse `retention-schedule.ts` and `advisory-lock.ts`).
- Prisma schema and migrations (below).
- `apps/web/` — seller delivery actions on the seller order pages (web only, O1).
- `apps/mobile/` — customer delivery status inside order details. **No seller delivery screens in Flutter** (O1).
- `packages/shared/` — delivery contracts, statuses, reasons, error codes.
- `context/progress-tracker.md`.

### Database

| Model | Key fields | Constraints |
|---|---|---|
| `Delivery` | `id`, `shopOrderId`, `status`, `autoCloseAt`, `closedAt`, `createdAt`, `updatedAt` | Unique `shopOrderId`; `closedAt` only with `FAILED`; index `(status, autoCloseAt)` |
| `DeliveryAttempt` | `id`, `deliveryId`, `number`, `dispatchedAt`, `dispatchedByUserId`, `outcome`, `failureReason`, `outcomeAt`, `outcomeByUserId` | Unique `(deliveryId, number)`; one open attempt per delivery (partial unique index where `outcome IS NULL`); `failureReason` exactly when `outcome = FAILED` |
| `DeliveryStatusEvent` | `id`, `deliveryId`, `fromStatus`, `toStatus`, `actorType`, `actorUserId`, `reasonCode`, `createdAt` | Append-only |

### Routes

Base path `/api/v1/sellers/me/orders/:shopOrderId/delivery`.

| Route | Guard | Purpose |
|---|---|---|
| `POST …/ready` | `approvedSeller` | `PENDING` → `ASSIGNED` |
| `POST …/dispatch` | `approvedSeller` | → `OUT_FOR_DELIVERY` (first attempt or retry) |
| `POST …/delivered` | Narrow guard | `{ amount }`. The amount the seller saw, a precondition only (spec 13). → `DELIVERED` with payment `COLLECTED` |
| `POST …/fail` | Narrow guard | `{ reason }` → `FAILED` |
| `POST …/close` | Narrow guard | Closes an open failure as undeliverable |
| `GET /api/v1/sellers/me/deliveries/in-progress` | Narrow guard | The deliveries a seller must finish (used when suspended) |

- Customers read delivery data through spec 11's order routes; no separate customer route.
- Administrators read it through spec 11's admin order detail.
- **Lookups:** by the owner's shop; another shop's → `404`.
- **Write transactions:** shop `FOR SHARE`, shop order `FOR UPDATE`, delivery `FOR UPDATE`, then products by ID when stock returns. This follows spec 11's lock order.

### Requirements

- Provide seller operations to update delivery information for eligible orders only.
- Enforce seller ownership of delivery records through the associated shop and shop order.
- Record delivery status transitions and their actors.
- Capture a failure outcome without allowing the seller to mark an order delivered through an invalid transition.
- Expose only customer-safe delivery information.

## Verification Checklist

- [ ] A delivery is created only by confirming a shop order, never for a rejected, cancelled, or expired one.
- [ ] A seller cannot access or update another seller's delivery (`404`).
- [ ] Delivery status transitions are validated; repeats change nothing; invalid ones return `409`.
- [ ] `ASSIGNED` is optional: dispatch works from `PENDING` and from `ASSIGNED`.
- [ ] "Delivered, cash received" sets delivery and shop order `DELIVERED` and payment `COLLECTED` in one transaction, and fails as a whole on any error.
- [ ] A failed attempt requires a reason from the list; the customer sees it translated.
- [ ] Retries open new attempts with no limit; the attempt history is never overwritten.
- [ ] Closing a failure (seller or job) sets the shop order `FAILED_DELIVERY`, returns stock once, and sets the payment `FAILED`.
- [ ] The automatic closure job closes failures after the configured period, is idempotent, and does not run twice concurrently.
- [ ] A cancelled shop order cancels a delivery that is not out; a delivery that is out cannot be cancelled.
- [ ] A suspended shop's owner can finish only deliveries already out or failed, cannot retry, and is `403` for everything else.
- [ ] Customer delivery status reflects the correct shop order, without seller-only data.
- [ ] Delivery address and contact snapshots are read from the shop order and never change.
- [ ] Delivery fees come from the snapshot and cannot be changed after placement.
- [ ] Multi-shop orders keep independent delivery records.
- [ ] Unauthorized and invalid operations are rejected.
- [ ] API, web (seller), and mobile (customer) tests cover the supported workflows.
