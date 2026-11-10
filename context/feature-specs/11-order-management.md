# 11 — Order Management

## Goal

Provide a complete order lifecycle for customers and sellers. Customers can view their orders and follow their progress, while each seller independently accepts or rejects the order assigned to their shop in a multi-shop checkout.

Business rules come from `context/business-decisions-features-10-18.md` (D1, D4, D6, D7, D8, D11, O3; approved 2026-11-09).

**Built (2026-11-10):** the whole feature on the API, web, and mobile. The tables, `createOrder`, `takeOrderStock`, and the image cleanup guard came with spec 10 (2026-11-09). See Implementation Notes below.

## Design & Architecture Decisions

### 1. Ownership

This feature owns:

- the order records and their creation function (called by checkout, spec 10);
- snapshots;
- the shop order lifecycle: confirmation, rejection, cancellation, expiry, and the outcome set by delivery;
- order stock rules;
- order history;
- order-level authorization.

| Not owned here | Owner |
|---|---|
| Checkout validation, idempotency, the placement transaction | Spec 10 |
| Delivery progress, attempts, failure, the delivered action | Spec 12 |
| Payment records and statuses | Spec 13 |
| Notification storage and the event contract | Spec 15 |
| Shop status and suspension | Spec 06 (calls this feature's suspension function) |
| Seller stock editing | Spec 07 |

### 2. Records

- **Order** (customer-facing, one per checkout): a reference, the customer, totals, and the idempotency key (spec 10).
- **Shop order** (one per shop in the checkout): belongs to exactly one order and exactly one shop. It holds the status, the response deadline, the delivery fee snapshot, the shop name snapshot, and the delivery snapshot.
- **Order item** (one per cart line): belongs to one shop order.
- **Shop order status event:** append-only history.
- **Stock movement:** append-only record of order-caused stock changes (D1).

A checkout containing products from multiple shops creates one order and separate seller-managed shop orders. Each seller manages only the shop order belonging to their shop. Seller decisions are independent: one seller's response never accepts, rejects, or cancels another seller's shop order (O3).

### 3. Snapshots

Purchase-time values never change when the product, variant, shop, address, or profile is later edited or deleted.

- **Order item:**
  - **Copied:** product ID, variant ID (as a plain value: variants are hard-deleted, spec 07), product name, size, color, unit price, quantity, line total.
  - **Where the values come from:** the locked product rows at placement, never the cart.
  - **Image (S2-7):** the object key of the product's first active image at placement (`imageObjectKey`). The order displays that image, never the product's current one. If the product had no active image, the key is empty and a placeholder is shown.
- **Shop order:**
  - **Copied:** shop name, delivery fee (spec 06, D2), products subtotal, total (products subtotal + fee).
  - **Shop contact (S2-7):** the shop's `contactPhone` and `whatsappPhone` at placement. The customer is shown these, never the shop's current values. Like all phones, they are unverified (spec 03) and never labelled verified.
  - **Delivery snapshot (D11):** recipient name, delivery phone, address label, city, district, landmark, latitude, longitude, location source, accuracy.
- **Order:** products subtotal, delivery fee total, and total across shop orders.

**Keeping snapshotted images available (S2-7):**
- **The cleanup job never deletes them:** product image cleanup (spec 07, `runProductImageCleanup`) never deletes a media object whose key any order item references, even after the seller removes the image from the product or archives the product. It keeps such an object for as long as the order exists. How long orders are kept is unresolved (O5).
- **Fallback:** if a referenced object is missing anyway (for example, removed outside the application), clients show the placeholder. The order stays readable, and no error is raised.
- **No copies:** no image is copied at placement. The order references the same immutable object the product used. Spec 07 never rewrites objects under a key.
- **Money:** all amounts are `DECIMAL(12, 2)` MRU, decimal strings in the API, never recalculated from current catalog prices.

### 4. Statuses (D4, D7)

| Status | Meaning | Final |
|---|---|---|
| `PENDING` | Placed, awaiting the seller's decision until `respondBy` | No |
| `CONFIRMED` | Accepted by the seller; a delivery exists (spec 12) | No |
| `REJECTED` | Refused by the seller | Yes |
| `CANCELLED` | Cancelled by the customer, the seller, an administrator, or a shop suspension | Yes |
| `EXPIRED` | The seller did not answer before `respondBy` | Yes |
| `DELIVERED` | Set only by the delivery reaching `DELIVERED` (spec 12) | Yes |
| `FAILED_DELIVERY` | Set only by the delivery's final closure as undeliverable (spec 12) | Yes |

Delivery progress (being prepared, ready, out for delivery, failed attempts) is **not** an order status: it lives on the delivery record (spec 12). The `PROCESSING` and `READY_FOR_DELIVERY` steps of the earlier draft are delivery `PENDING` and `ASSIGNED`.

### 5. Transitions

Do not allow arbitrary status updates. Each transition has an authorized actor and a valid previous state, and is applied with a conditional update (`… WHERE id = $1 AND status = $expected`).

| From | To | Actor | Conditions and effects |
|---|---|---|---|
| (placement) | `PENDING` | Checkout (spec 10) | `respondBy` = placement + timeout; `remindAt` = placement + half the timeout |
| `PENDING` | `CONFIRMED` | Seller (approved shop) | Before `respondBy`. Creates the delivery (`PENDING`, spec 12) in the same transaction |
| `PENDING` | `REJECTED` | Seller (approved shop) | Before `respondBy`. Required reason. Stock returned; payment `CANCELLED` |
| `PENDING` | `CANCELLED` | Customer | Before `respondBy`. Optional reason. Stock returned; payment `CANCELLED` |
| `PENDING` | `CANCELLED` | Administrator | Not their own shop. Required internal reason. Same effects |
| `PENDING` | `CANCELLED` | System, at shop suspension (D8) | Reason `SHOP_UNAVAILABLE`. Same effects |
| `PENDING` | `EXPIRED` | System, at or after `respondBy` | Stock returned; payment `CANCELLED` |
| `CONFIRMED` | `CANCELLED` | Seller (approved shop) | Delivery `PENDING` or `ASSIGNED`. Required reason. Delivery `CANCELLED`; stock returned; payment `CANCELLED` |
| `CONFIRMED` | `CANCELLED` | Administrator | Delivery not out; not their own shop. Required internal reason. Same effects |
| `CONFIRMED` | `CANCELLED` | System, at shop suspension (D8) | Delivery not out. Same effects |
| `CONFIRMED` | `DELIVERED` | Spec 12's delivered action only | Same transaction as delivery `DELIVERED` and payment `COLLECTED` |
| `CONFIRMED` | `FAILED_DELIVERY` | Spec 12's final closure only | Stock returned; payment `FAILED` |

- No route sets `DELIVERED` or `FAILED_DELIVERY` directly.
- **Once the delivery is `OUT_FOR_DELIVERY` (or later), nobody can cancel.** The failure path of spec 12 applies.
- **Repeats:** repeating a completed transition by the same kind of actor returns the current shop order (`200`) and writes nothing. Any other mismatch with the expected status → `409 SHOP_ORDER_STATUS_CONFLICT`.
- **Deadline:** after `respondBy`, confirm, reject, and customer cancel are refused with `409 SHOP_ORDER_EXPIRED`, even if the expiry job has not run. The request first applies the expiry in its own transaction (same effects as the job), so the outcome depends only on the time.
- Pending orders cannot be treated as confirmed.

### 6. Cancellation and rejection reasons (D6)

Reasons are stored as codes and shown translated (French, Arabic). No free text reaches customers.

| Kind | Codes | Required | Customer sees |
|---|---|---|---|
| Seller rejection | `OUT_OF_STOCK`, `CANNOT_DELIVER_TO_AREA`, `PRICE_ERROR`, `OTHER` | Yes | The translated reason |
| Seller cancellation | The rejection codes plus `CUSTOMER_REQUESTED` | Yes | The translated reason |
| Customer cancellation | `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `OTHER`. With `OTHER`, a short explanatory text is required (`reasonText`, plain text, 3–200 characters, NFC, trimmed, no control characters) | No, but `OTHER` needs the text | — (the seller and administrators see the code and the text, always rendered escaped) |
| System | `SHOP_UNAVAILABLE` (suspension) | — | The translated reason |
| Administrator | Internal reason (10–500 characters) and optional internal note (1–1000), plain text | Reason yes | Only "Annulée par Chicman" / "ألغتها شيكمان" |

The customer reason codes and the `OTHER` text were confirmed at the Stage 2 review (S2-4). The 3–200 character bound is an implementation value. The customer's text is never put in notifications, which carry codes only (spec 15).

Administrator reasons and notes are internal. They are never returned by customer or seller APIs and never put in notifications, following spec 06's separation of fields.

### 7. Order stock rules (D1)

- **Taking:** at placement, for each order item, a conditional update lowers the variant's stock (or the product's own stock when the item has no variant) only if `stock >= quantity`. A failure rolls back the placement (spec 10). Each take writes a `TAKEN` movement.
- **Returning:** exactly once per order item, when its shop order becomes `REJECTED`, `CANCELLED`, `EXPIRED`, or `FAILED_DELIVERY`, in the same transaction. Each return writes a `RETURNED` movement.
- **Delivered orders** return nothing, including after a customer return (D10).
- **Returns that can't be applied:** the movement is recorded as skipped with the quantity and reason, and the operation still succeeds.

| Situation | Skip reason |
|---|---|
| The item's variant no longer exists | `VARIANT_REMOVED` |
| The item had no variant, and the product now has variants | `VARIANT_STRUCTURE_CHANGED` |
| The return would take the stock above 1,000,000 | `ABOVE_MAXIMUM`; nothing is returned |

- **No seller conditions:** returning stock works on archived products and on products of suspended shops. It requires neither an editable product nor an approved seller.
- **Implementation:** a dedicated internal function in `apps/api/src/modules/inventory/`, never the seller `StockService` (spec 07), which stays unchanged.
- **No double returns:** a unique key on (order item, movement type) makes a second return impossible.
- **Lock order:** cart, shop, shop order, products ordered by ID. This is compatible with spec 07 (shop → product) and spec 09 (cart → shop → product).

### 8. Response deadline and expiry (D7)

- **Timeout:** `ORDER_RESPONSE_TIMEOUT_HOURS`, default 48, a configuration value. `respondBy` and `remindAt` are set at placement, so a later configuration change never moves existing deadlines.
- **Expiry job:** in the existing worker, every 5 minutes, under its own PostgreSQL advisory lock. It handles bounded batches of `PENDING` shop orders with `respondBy < now()`, one transaction each:
  - conditional update to `EXPIRED`,
  - stock returned,
  - payment `CANCELLED`,
  - history,
  - notifications to the customer and the seller.

  A second run, or a request that already applied the expiry, changes nothing.
- **Reminder job:** same schedule and its own lock. For `PENDING` shop orders with `remindAt <= now()`, it records one seller notification with the event key `shop-order-reminder:<shopOrderId>`. The unique key (spec 15) makes it impossible to send twice.

### 9. Suspended shops (D8)

Spec 06's suspension transaction calls this feature's suspension function with the shop already locked. It cancels, with reason `SHOP_UNAVAILABLE`, every shop order of that shop that is:

- `PENDING`, or
- `CONFIRMED` with a delivery that is not yet `OUT_FOR_DELIVERY`.

Each cancellation has the effects of section 5 (delivery cancelled, stock returned, payment `CANCELLED`, history, customer notification).

- **Deliveries already under way** (`OUT_FOR_DELIVERY`, or `FAILED` and not closed) are not touched. Spec 12 defines what the suspended owner may still do with them.
- **New orders** are already impossible: the cart reports `SHOP_UNAVAILABLE`, which blocks checkout (spec 10).
- **Seller order routes** of this feature keep `requireApprovedSeller`: a suspended owner gets `403` for all of them. Only spec 12's in-progress delivery routes are available to them.
- **Reinstatement** restores nothing.

### 10. Visibility (D11)

Every response is built field by field from an allowlist, never by serializing rows.

| Viewer | Sees |
|---|---|
| Customer (own orders only) | Order reference, totals, payment method and status (spec 13), each shop order's derived label, decision reason (translated), items with their snapshotted images, delivery snapshot, shop name, the shop contact phones snapshotted at placement, the delivery status and failure reasons (spec 12). On a delivered shop order, a fixed sentence (French and Arabic) that returns and exchanges are arranged directly with the shop (D10) |
| Seller (own shop orders only), `PENDING` | Items, totals, fee, city and district only, deadline |
| Seller, from `CONFIRMED` on | The full delivery snapshot (recipient, phone, landmark, coordinates, accuracy) |
| Administrator | Everything, including history, internal reasons, notes, and stock movements |

The customer's own profile phone history, administrator identities, and internal notes are never shown to customers or sellers.

### 11. Customer status label

One label per shop order, derived from the order status and the delivery status. There is no combined label for the whole order. The label map lives in shared contracts so web and mobile agree; Arabic labels are in the message files.

| Shop order | Delivery | French label |
|---|---|---|
| `PENDING` | — | En attente de la boutique |
| `CONFIRMED` | `PENDING` | En préparation |
| `CONFIRMED` | `ASSIGNED` | Prête pour la livraison |
| `CONFIRMED` | `OUT_FOR_DELIVERY` | En cours de livraison |
| `CONFIRMED` | `FAILED` (open) | Livraison échouée, à reprogrammer |
| `DELIVERED` | — | Livrée |
| `FAILED_DELIVERY` | — | Livraison impossible |
| `REJECTED` | — | Refusée par la boutique |
| `CANCELLED` | — | Annulée |
| `EXPIRED` | — | Expirée (sans réponse de la boutique) |

### 12. Returns

Returns are handled by the seller, entirely outside Chicman in the first release (D10): no return status, request, or refund record. Do not introduce a platform return workflow.

### 13. Boundaries

- Do not implement payment collection (spec 13) or delivery execution (spec 12) here.
- All amounts use MRU.

## Implementation Details

Likely areas:

- `apps/api/src/modules/orders/` — records, creation function, lifecycle services, routes, views, validation, authorization, and the suspension function.
- `apps/api/src/modules/inventory/` — the order stock function and stock movements (section 7).
- `apps/api/src/workers/` — the expiry and reminder jobs, with their advisory locks (reuse `retention-schedule.ts` and `advisory-lock.ts`).
- Prisma schema and migrations (below).
- `apps/web/` — seller order pages (web only, O1) and customer order history and details.
- `apps/mobile/` — customer order history, details, and cancellation.
- `packages/shared/` — order types, schemas, reason codes, status labels, and error codes.
- `context/progress-tracker.md`.

### Database

| Model | Key fields | Constraints |
|---|---|---|
| `Order` | `id`, `reference` (unique, server-generated, not sequential), `userId`, `idempotencyKey`, `productsSubtotal`, `deliveryFeeTotal`, `total`, `createdAt` | Unique `(userId, idempotencyKey)`; amounts ≥ 0 |
| `ShopOrder` | `id`, `orderId`, `shopId` (FK `RESTRICT`), `shopName`, `shopContactPhone`, `shopWhatsappPhone` (snapshots), `status`, `respondBy`, `remindAt`, `productsSubtotal`, `deliveryFee`, `total`, delivery snapshot fields, decision fields (`decidedAt`, `reasonCode`, `reasonText`, `cancelledBy` actor type, `internalReason`, `internalNote`), outcome timestamps, `createdAt`, `updatedAt` | Unique `(orderId, shopId)`; `total = productsSubtotal + deliveryFee`; `deliveryFee ≥ 0`; index `(shopId, status, createdAt)`, `(status, respondBy)`, `(status, remindAt)` |
| `OrderItem` | `id`, `shopOrderId`, `productId` (FK `RESTRICT`; products are never deleted), `variantId` (plain UUID, no FK), `productName`, `size`, `color`, `imageObjectKey` (nullable), `unitPrice`, `quantity`, `lineTotal` | `quantity ≥ 1`; `unitPrice > 0`; `lineTotal = unitPrice × quantity`; index `imageObjectKey` (checked by the image cleanup) |
| `ShopOrderStatusEvent` | `id`, `shopOrderId`, `fromStatus`, `toStatus`, `actorType` (`CUSTOMER`, `SELLER`, `ADMIN`, `SYSTEM`), `actorUserId`, `reasonCode`, `reasonText`, `internalReason`, `internalNote`, `createdAt` | Append-only; written in the transition's transaction |
| `StockMovement` | `id`, `orderItemId`, `productId`, `variantId`, `quantity`, `type` (`TAKEN`, `RETURNED`), `applied`, `skipReason`, `createdAt` | Unique `(orderItemId, type)`; append-only |

Migrations are additive.

### Routes

| Route | Guard | Purpose |
|---|---|---|
| `GET /api/v1/customers/me/orders` | `user` | Own orders, newest first, paginated |
| `GET /api/v1/customers/me/orders/:orderId` | `user` | Own order with its shop orders (`404` for another customer's) |
| `POST /api/v1/customers/me/orders/:orderId/shop-orders/:shopOrderId/cancel` | `user` | Customer cancellation: optional `{ reason, reasonText }`; `reasonText` is required with `OTHER` and refused otherwise (`400`) |
| `GET /api/v1/sellers/me/orders` | `approvedSeller` | Own shop orders; filter by status; paginated |
| `GET /api/v1/sellers/me/orders/:shopOrderId` | `approvedSeller` | Detail, with staged visibility (section 10) |
| `POST /api/v1/sellers/me/orders/:shopOrderId/confirm` | `approvedSeller` | Confirm |
| `POST /api/v1/sellers/me/orders/:shopOrderId/reject` | `approvedSeller` | `{ reason }` |
| `POST /api/v1/sellers/me/orders/:shopOrderId/cancel` | `approvedSeller` | `{ reason }` |
| `GET /api/v1/admin/orders` | `role("ADMIN")` | All shop orders; filters `status`, `shopId`, date range; paginated |
| `GET /api/v1/admin/orders/:shopOrderId` | `role("ADMIN")` | Full detail |
| `POST /api/v1/admin/orders/:shopOrderId/cancel` | `role("ADMIN")` | `{ internalReason, internalNote? }`; `403 SHOP_SELF_ADMINISTRATION_FORBIDDEN` on own shop |

- Seller lookups are scoped by `req.sellerShop.id`: another shop's order → `404`. Customer lookups are scoped by the authenticated user: another customer's order → `404`.
- **Write transactions:** shop `FOR SHARE` (re-checking `APPROVED` for seller actions), then the shop order `FOR UPDATE`, then products by ID when stock returns.
- **Rate limit:** seller and customer order writes reuse the product write limits (300 per user, 600 per IP per 10 minutes).

### Clients

- **Web, seller (O1):** `/seller/orders` and `/seller/orders/[shopOrderId]`, with confirm, reject, cancel, deadline, and staged details. Linked from the seller dashboard (spec 16).
- **Web, customer:** `/account/orders` and `/account/orders/[orderId]`.
- **Mobile, customer:** order list and details, and cancellation while `PENDING`. **No seller order screens in Flutter** (O1).
- New client state follows the cart providers' account-change guard (web `cart-provider.tsx`, mobile `cart_providers.dart`).

### Constraints

- Ensure each shop order belongs to exactly one shop.
- Enforce ownership on every seller order operation.
- Prevent customers from accessing another customer's orders.
- Record status changes with actor, timestamp, and relevant metadata.
- Ensure retries cannot create duplicate orders (spec 10's idempotency key and unique constraint).
- Keep internal administrative notes and private seller information out of customer-facing responses.
- Do not modify product discovery, authentication, customer profile, or shop approval behavior, except the documented suspension call (spec 06).

## Verification Checklist

- [x] One-shop checkout creates one shop order.
- [x] Multi-shop checkout creates the correct shop orders under one customer-facing order.
- [x] Sellers see only their own shop orders; another shop's is `404`.
- [x] Each seller can independently confirm or reject their whole shop order; another shop's order is unaffected.
- [x] Pending orders cannot be treated as confirmed; a delivery exists only after confirmation.
- [x] Customer cancellation works only while `PENDING` and before `respondBy`.
- [x] Seller cancellation works only while `CONFIRMED` with the delivery not out, and requires a reason.
- [x] Administrator cancellation works before dispatch, requires an internal reason, is refused on their own shop, and shows customers only "Annulée par Chicman". *(API only: the admin web screens belong to spec 17.)*
- [x] Nobody can cancel once the delivery is out for delivery. *(Delivery status set directly in tests: dispatch is spec 12.)*
- [x] Invalid status transitions are rejected; repeated completed transitions change nothing.
- [x] Orders past `respondBy` expire (job or request), return stock, cancel the payment, and refuse late decisions.
- [x] The expiry and reminder jobs are idempotent and do not run twice concurrently; one reminder per shop order. *(Tests call the jobs and the locks directly; the Compose worker was not rebuilt.)*
- [x] Stock is returned exactly once on rejection, cancellation, expiry, and final failed delivery, including for archived products and suspended shops; unappliable returns are recorded as skipped. *(Final failed delivery through `markShopOrderFailedDelivery`, which spec 12 will call.)*
- [x] Shop suspension cancels pending and not-yet-dispatched shop orders in the same transaction and leaves deliveries in progress alone.
- [x] Order item snapshots remain unchanged after product, variant, shop, address, or profile edits and deletions.
- [x] An order shows the product image and the shop contact phones from placement, not the current ones.
- [x] Removing a product image, or archiving the product, never deletes an image an order references; a missing image shows the placeholder. *(Cleanup guard tested with spec 10; the web placeholder on a load error was not seen in a browser.)*
- [x] A customer cancellation with `OTHER` requires the explanatory text; the text is refused with any other reason.
- [x] Sellers see the full delivery snapshot only from confirmation on.
- [x] Concurrent or repeated requests do not create duplicate orders. *(Spec 10 tests; transitions also race-tested here.)*
- [x] Customer, seller, and admin authorization is enforced server-side.
- [x] Internal reasons and notes never appear in customer or seller responses.
- [x] French and Arabic labels, RTL, and MRU formatting work on web and mobile. *(Dictionary parity tests on both, a Flutter RTL widget test; the web pages were not opened in a browser.)*
- [x] API, web, and mobile tests cover the supported workflows.

## Implementation Notes (2026-11-10)

### Scope

As with spec 10, only what this feature calls from other specifications was built with it, as those specifications define it:

| Built with this feature | Owner spec | Left for that spec |
|---|---|---|
| `Delivery` and `DeliveryStatusEvent` (all spec 12 columns); `createDelivery` (confirmation), `cancelDelivery` (`PENDING`/`ASSIGNED` only) in `modules/delivery/` | 12 | Attempts, dispatch, ready, failure, closure, the delivered action, the auto-close job, the narrow guard, seller delivery routes and screens |
| `markPaymentCancelled`, `markPaymentFailed` | 13 | `collect`, admin notes, the seller summary |
| `SHOP_ORDER_CONFIRMED`, `_REJECTED`, `_CANCELLED`, `_EXPIRED`, `_RESPONSE_REMINDER`, recorded through `recordNotification` | 15 | Read API, notification centers, delivery events |
| `markShopOrderDelivered`, `markShopOrderFailedDelivery`: the outcomes spec 12 will call in its transactions | 11 (this) | Their callers (spec 12) |

### Decisions the spec left open

- **Migration** `order_lifecycle` (additive): the delivery tables and checks on shop orders (free text only with `OTHER`; `cancelledBy` only when `CANCELLED`; internal reason exactly for administrator cancellations; `closedAt` exactly on final statuses).
- **Outcome timestamps:** `decidedAt` is the seller's answer (confirmation or rejection); `closedAt` is when the shop order reached a final status.
- **Deadline:** `now >= respondBy` counts as past. Any write that finds a pending shop order past its deadline expires it in its own transaction and answers `409 SHOP_ORDER_EXPIRED`; an `EXPIRED` shop order answers the same to every action. A suspension expires such orders instead of cancelling them.
- **Order of checks:** body `400` → unknown or another's `404` → seller shop not approved `403` / administrator's own shop `403 SHOP_SELF_ADMINISTRATION_FORBIDDEN` → status `409`. A customer's unknown order is `ORDER_NOT_FOUND`; a shop order outside that order is `SHOP_ORDER_NOT_FOUND`.
- **Confirmation body:** none; an empty object is accepted, anything else is `400`.
- **Seller detail stage:** the full delivery snapshot exactly when a delivery exists (that is, the order was confirmed), including after a later cancellation.
- **Who sees what of a decision:** customers see the seller's or system's reason code, "Chicman" for an administrator, and nothing for their own cancellation; sellers see the code and the customer's `OTHER` text, and "Chicman" with no reason for an administrator.
- **Notifications:** keys follow spec 15 (`<type>:<status event ID>:<recipient>`). The reminder is keyed by the shop order (`SHOP_ORDER_RESPONSE_REMINDER:<shopOrderId>:<seller>`), which makes a second one impossible, as section 8 requires. A suspension notifies the customer and the seller (spec 15's table) with `cancelledBy: CHICMAN`, `reasonCode: SHOP_UNAVAILABLE`.
- **Jobs:** batches of 100, one transaction per shop order; a failing shop order is counted and retried next run without stopping the batch. The reminder is sent only before the deadline. Locks `chicman:shop-order-expiry` and `chicman:shop-order-reminder`.
- **Lists:** `page`/`pageSize` (default 20, at most 50), newest first. Admin `from`/`to` are inclusive UTC days.
- **Admin detail of an owned shop:** readable (the spec grants administrators everything); only cancellation is refused, and `canCancel` is `false`.
- **Clients:** web `/account/orders`, `/account/orders/[orderId]`, `/seller/orders`, `/seller/orders/[shopOrderId]`, linked from the account panel, the shop dashboard, and the checkout confirmation. Mobile: `OrderListScreen` and `OrderDetailScreen` (cancellation in a bottom sheet), from the account screen and the checkout confirmation. Labels have one copy per platform, used by checkout too. Failure reasons of delivery attempts are shown since spec 12 (2026-11-10).

### Verification status

- **Automated:** API `test/orders.test.ts` (43 tests, PostgreSQL), web `features/orders/orders.test.ts` (10), Flutter `test/features/orders/orders_test.dart` (11). Deliberate breaks each caught: no stock return (13 failures), no deadline in requests (2), suspension cancelling deliveries under way (1).
- **Not verified:** the web pages in a browser, a real Supabase sign-in, Android on a device or emulator, and the jobs inside the running Compose worker (it needs a rebuild).
