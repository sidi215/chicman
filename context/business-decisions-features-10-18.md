# Business Decisions: Features 10–18

Status: **11 decisions confirmed by the project owner on 2026-11-09, one at a time, and this record approved by the owner on 2026-11-09 (Stage 1 gate passed).** O1 and O3 were confirmed at the same time. O2 and the Stage 2 additions (S2-1 to S2-7) were confirmed at the Stage 2 review the same day (below). Stage 2 updates the specifications from this record.

Source of each question: `context/specification-overlap-audit.md` (section E for C-numbers, section G for Q-numbers). `S10 L52` means `context/feature-specs/10-checkout.md`, line 52.

## Summary

| ID | Topic | Confirmed decision |
|---|---|---|
| D1 | Stock | Deducted at order placement; returned when an order ends without delivery; order-only stock history |
| D2 | Delivery fee | One flat fee per shop, set by the seller; 0 allowed; unset blocks checkout; copied onto the order |
| D3 | Checkout eligibility | Any problem line blocks the whole checkout; unaccepted price changes must be accepted first |
| D4 | Statuses | Order holds the decision and outcome; delivery holds progress; seller records everything; no group status |
| D5 | Failed delivery | Seller retries or closes, no limit; inactive failure closed automatically after 7 days |
| D6 | Cancellation | Customer before confirmation; seller after confirmation with a reason; admin before dispatch |
| D7 | Unanswered orders | `EXPIRED` after 48 hours; no late answer; one reminder halfway |
| D8 | Suspended shops | Unshipped orders cancelled at suspension; deliveries under way may only be finished |
| D9 | Cash on delivery | Delivered and collected in one action; exact amount; final statuses; admin notes only |
| D10 | Returns and refunds | Entirely outside Chicman in the first release; customer told so |
| D11 | Recipient and privacy | Recipient name at checkout; pin mandatory; address phone; seller sees full contact after confirming |

### Combined status model

These lists result from D4, D5, D7 and D9 together.

| Record | Owner | Statuses | Final statuses |
|---|---|---|---|
| Seller order | Feature 11 | `PENDING`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `EXPIRED`, `DELIVERED`, `FAILED_DELIVERY` | All except `PENDING` and `CONFIRMED` |
| Delivery | Feature 12 | `PENDING`, `ASSIGNED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `CANCELLED` | `DELIVERED`, `CANCELLED`, and `FAILED` once closed |
| Payment | Feature 13 | `PENDING`, `COLLECTED`, `FAILED`, `CANCELLED` | All except `PENDING` |

| Event | Seller order | Delivery | Payment | Stock |
|---|---|---|---|---|
| Placement | `PENDING` | none | `PENDING` (amount due) | Taken |
| Seller confirms | `CONFIRMED` | `PENDING` (created) | `PENDING` | — |
| Seller marks ready (optional) | `CONFIRMED` | `ASSIGNED` | `PENDING` | — |
| Dispatch | `CONFIRMED` | `OUT_FOR_DELIVERY` | `PENDING` | — |
| Delivered, cash received | `DELIVERED` | `DELIVERED` | `COLLECTED` | — |
| Attempt failed | `CONFIRMED` | `FAILED` | `PENDING` | — |
| Retry | `CONFIRMED` | `OUT_FOR_DELIVERY` (new attempt) | `PENDING` | — |
| Closed as undeliverable (seller, or job after 7 days) | `FAILED_DELIVERY` | `FAILED` (closed) | `FAILED` | Returned |
| Seller rejects | `REJECTED` | none | `CANCELLED` | Returned |
| Customer, seller or admin cancels | `CANCELLED` | `CANCELLED` if one exists | `CANCELLED` | Returned |
| Seller never answers (48 h) | `EXPIRED` | none | `CANCELLED` | Returned |
| Shop suspended before dispatch | `CANCELLED` | `CANCELLED` if one exists | `CANCELLED` | Returned |

---

## D1. Stock reservation and release

**Question.** When is stock taken and returned, and how is overselling prevented? (Audit Q1; S10 L102–104.)

**Confirmed decision.** Deduct at placement (option A). Return automatically when an order ends without delivery. Skip and record a return that cannot be applied. Keep an append-only history of order-caused stock changes only.

**Business rules**
1. **Taking stock:** placing an order lowers the stock of each line's product or variant inside the order-placement transaction. If any line has too little stock, the whole checkout fails and nothing is written.
2. **Availability:** the taken stock is unavailable to other customers immediately. The deduction is final at placement, and delivery changes no stock.
3. **When stock returns:** exactly once per order item, when its seller order becomes `REJECTED`, `CANCELLED`, `EXPIRED`, or `FAILED_DELIVERY`.
4. **No return after delivery:** a delivered order never returns stock, including after a customer return (D10).
5. **Returns that can't be applied:** if the variant was deleted, the product's variant structure changed, or the return would pass the 1,000,000 limit, the quantity is not returned. The reason and quantity are recorded, and the triggering operation still succeeds.
6. **Archived products and suspended shops:** stock is returned to them too. Returning stock never requires an editable product or an approved seller.
7. **Seller edits:** unchanged (Feature 07 compare-and-set). If an order changes the stock while a seller has the page open, their update gets `409` and they reload.

**Affected features:** 07, 10, 11, 12.

**Technical consequences**
- **A new internal function in `modules/inventory/`, not `StockService`:**
  - **Taking:** a conditional update (`stock = stock − q WHERE stock >= q`).
  - **Returning:** an increment.
  - **Locking:** shop row `FOR SHARE`, then product rows, ordered by product ID so concurrent multi-shop checkouts cannot deadlock.
- **New append-only stock-movement table:** order item, product, variant (nullable), quantity, `TAKEN` or `RETURNED`, applied or skipped with a reason, time. A unique key on (order item, type) makes a return idempotent.
- **No change** to catalog, cart, facet, or availability queries: the stock column keeps meaning "available to sell".

**Dependencies:** D7 (required because stock is held from placement), D5, D6, D8 (release events).

**Unresolved details:** none at the business level.

---

## D2. Delivery fee

**Question.** Who sets the fee, how is it calculated, where is it stored, and can it change? (Audit C4, Q2; S10 §7, S12 L12, L42–43.)

**Confirmed decision.** One flat fee per shop, set by the seller. 0 MRU is allowed. A shop with no fee cannot be checked out. The fee is copied onto the order, and a fee change during checkout is refused.

**Business rules**
1. **What it is:** each shop has one delivery fee, in MRU, charged once per seller order regardless of the number of items.
2. **Who sets it:** the seller, in shop settings, while the shop is `APPROVED`. It changes immediately with no admin review, and every change is audited. A suspended shop cannot change it (existing S06 rule).
3. **Zero and missing fees:** 0 means free delivery. A shop that has never set a fee cannot be checked out, and the seller is prompted to set one.
4. **Snapshot:** placement copies the fee onto each seller order. A later change to the shop's fee affects only future orders.
5. **Where the customer sees it:** on the checkout summary, per shop, with the products subtotal and the total payable. Not in the cart.
6. **Changed fee:** the placement request carries the totals the customer saw, used only as a check and never stored. If the fee or any total differs from the server's figures, placement is refused with `409` and the new figures.

**Affected features:** 06 (allowlist, audit), 10, 12, 13, 16.

**Technical consequences**
- A new nullable decimal field on `Shop` (precision as product prices, minimum 0). It joins S06's immediate-field allowlist and the `ShopField` audit enum.
- A fee snapshot column on the seller order.
- **Operational:** existing approved shops have no fee and cannot be checked out until they set one.

**Dependencies:** D3 (a missing fee blocks checkout), D9 (amount due includes the fee).

**Unresolved details**
- An upper bound for the fee (technical; proposed: the same bound as product prices).
- Following O1, the fee is edited on the web seller dashboard only; the Flutter shop screen does not show it in this release (confirmed, S2-2).

---

## D3. Checkout eligibility

**Question.** What happens when the cart has an unavailable product, an unaccepted price change, too little stock, or an ineligible shop? (Audit Q3.)

**Confirmed decision.** Block the whole checkout until every line is resolved (option A). An unaccepted price change also blocks.

**Business rules**
1. **What blocks checkout:** any of the following on any line:
   - a remove-only cart issue (`SHOP_UNAVAILABLE`, `PRODUCT_ARCHIVED`, `PRODUCT_UNPUBLISHED`, `VARIANT_UNAVAILABLE`),
   - `INSUFFICIENT_STOCK`,
   - a shop with no fee (D2),
   - an unaccepted `PRICE_CHANGED`.
2. **Fixing problems:** the summary lists them and links to the cart, where the existing Feature 09 actions resolve them (remove, bring the quantity down, accept the price). Checkout never changes a line itself.
3. **Fresh validation:** at placement, checkout validates every line again on the server, under locks. It never trusts figures calculated earlier.
4. **Cart after the order:** the whole cart is ordered, and its lines are removed in the order transaction. A failed placement leaves the cart unchanged.

**Affected features:** 09 (consumed, unchanged), 10.

**Technical consequences**
- Checkout reuses `evaluateCartLine` and treats `PRICE_CHANGED` as blocking at checkout only. No new cart issue code, and the cart's own behaviour is unchanged.
- Cart lines are deleted inside the order transaction, not through `DELETE /customers/me/cart` (audit C14).

**Dependencies:** D1 (the stock shortfall is detected again by the conditional update), D2.

**Confirmed at the Stage 2 review (O2):** a cart line from a shop the customer owns blocks the whole checkout, enforced by the API.

---

## D4. Order and delivery statuses

**Question.** How do the order and delivery lifecycles relate, who performs each change, and what does `ASSIGNED` mean? (Audit C3, Q4; S11 L13–22, S12 L15–22.)

**Confirmed decision.** Split ownership (model Y). `ASSIGNED` is an optional "ready" step. Only the seller records progress, with no new role. Status is shown per shop only.

**Business rules**
1. **Seller order statuses (Feature 11):** `PENDING`, `CONFIRMED`, `REJECTED`, `CANCELLED`, `EXPIRED` (D7), `DELIVERED`, `FAILED_DELIVERY`. S11's `PROCESSING` and `READY_FOR_DELIVERY` are no longer order statuses: their meaning is delivery `PENDING` and `ASSIGNED`.
2. **Delivery statuses (Feature 12):** `PENDING` (being prepared), `ASSIGNED` (ready, delivery arranged), `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `CANCELLED`.
3. **Order transitions:**

| From | To | Actor |
|---|---|---|
| (placement) | `PENDING` | Checkout |
| `PENDING` | `CONFIRMED` | Seller |
| `PENDING` | `REJECTED` | Seller |
| `PENDING` | `EXPIRED` | Expiry job (D7) |
| `PENDING` | `CANCELLED` | Customer, seller, admin, or suspension (D6, D8) |
| `CONFIRMED` | `CANCELLED` | Seller, admin, or suspension, while the delivery is not out (D6, D8) |
| `CONFIRMED` | `DELIVERED` | Only through delivery `DELIVERED`, in the same transaction |
| `CONFIRMED` | `FAILED_DELIVERY` | Only through final closure of the delivery (D5), in the same transaction |

4. **Delivery transitions:**

| From | To | Actor |
|---|---|---|
| (order `CONFIRMED`) | `PENDING` | System, in the confirmation transaction |
| `PENDING` | `ASSIGNED` | Seller (optional) |
| `PENDING`, `ASSIGNED` | `OUT_FOR_DELIVERY` | Seller |
| `OUT_FOR_DELIVERY` | `DELIVERED` | Seller (with collection, D9) |
| `OUT_FOR_DELIVERY` | `FAILED` | Seller, with a reason (D5) |
| `FAILED` | `OUT_FOR_DELIVERY` | Seller, new attempt (D5) |
| `FAILED` | closed | Seller, or job after 7 days (D5) |
| `PENDING`, `ASSIGNED` | `CANCELLED` | System, when the order is cancelled |

5. **No delivery before confirmation:** a delivery never exists before the order is confirmed, so it can never be assigned earlier.
6. **No direct outcome changes:** no API sets an order to `DELIVERED` or `FAILED_DELIVERY` directly.
7. **Who acts:** only the shop owner records delivery steps. Whoever physically delivers has no account.
8. **What the customer sees:** one label per seller order, derived from the order and delivery statuses. There is no combined status for a multi-shop checkout.

**Affected features:** 11, 12, 13, 15, 16, 17.

**Technical consequences**
- Every change is a conditional update from the expected status. A repeat returns the current state, and a conflicting change gets `409`.
- Every change appends a history row (from, to, actor, time, reason).
- The client label mapping lives in shared contracts so web and mobile agree.

**Dependencies:** D5, D6, D7, D8, D9.

**Confirmed with O3:** a seller accepts or rejects the whole seller order; individual items cannot be decided separately.

---

## D5. Failed delivery and retry

**Question.** Can a failed delivery be retried, by whom, how often, and who closes it? (Audit Q5; S12 L47, L49.)

**Confirmed decision.** The seller retries or closes, with no attempt limit. An inactive failure is closed automatically after 7 days (configurable). Reasons come from a fixed list shown to the customer. Customers ask for another attempt by phone only.

**Business rules**
1. **After a failure:** the seller either starts a new attempt or closes the delivery as undeliverable. There is no attempt limit.
2. **Recording failures:** each failed attempt needs a reason from a fixed list: customer unreachable, customer absent, customer refused, address not found, customer could not pay, other. It is shown to the customer in French or Arabic. No free text.
3. **Attempt history:** each attempt is recorded separately and never overwritten.
4. **Customer requests:** the customer asks for another attempt by phone. The seller records it. There is no in-app request.
5. **Automatic closure:** a delivery left `FAILED` with no new attempt and no closure for 7 days is closed as undeliverable automatically.
6. **Effects of closure:** order `FAILED_DELIVERY`, payment `FAILED` (D9), stock returned (D1), customer and seller notified.

**Affected features:** 11, 12, 13, 15.

**Technical consequences**
- A delivery-attempt table (one delivery per seller order, many attempts).
- A new worker job every 5 minutes with its own advisory lock and an idempotent conditional update. The 7-day period is a configuration value, and the deadline is computed from the failure time.

**Dependencies:** D1, D4, D8 (no new attempts while suspended), D9.

**Unresolved details:** none at the business level.

---

## D6. Cancellation

**Question.** What is the cancellation window, who may cancel, and with what reason? (Audit C1, Q6; Overview L116 against S11 L24.)

**Confirmed decision.** Customers cancel before confirmation. Sellers cancel after confirmation with a reason. Administrators cancel before dispatch. Reasons come from fixed lists.

**Business rules**

| Actor | Allowed when | Reason | Customer sees |
|---|---|---|---|
| Customer | `PENDING` | Optional, fixed list | — |
| Seller, rejection | `PENDING` | Required: out of stock, cannot deliver to this area, price error, other | The reason, translated |
| Seller, cancellation | `CONFIRMED`, delivery not `OUT_FOR_DELIVERY` | Required: same list plus "customer asked" | The reason, translated |
| Administrator | `PENDING`, or `CONFIRMED` with delivery not out; never their own shop | Required internal reason (10–500 characters), optional internal note | "Cancelled by Chicman" |

1. **Once out for delivery,** no one can cancel. The failure path (D5) applies instead.
2. **Effects:** stock returned (D1), an open delivery `CANCELLED`, payment `CANCELLED` (D9), notifications. Only that seller order is affected.
3. **Repeats:** repeating a completed cancellation returns the cancelled order unchanged. A conflicting concurrent change gets `409`.
4. **Overview wording:** Overview L116 ("before shipment") is corrected in Stage 2.

**Affected features:** 11, 12, 13, 15, 16, 17; Overview.

**Technical consequences:**
- Reasons are stored as codes with translated labels.
- The admin reason and note are internal fields, never in customer or seller responses, following S06's separation.

**Dependencies:** D1, D4, D9.

**Confirmed at the Stage 2 review (S2-4):** customer reasons are `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `OTHER`; `OTHER` requires a short explanatory text.

---

## D7. Unanswered seller orders

**Question.** What happens when a seller never answers a pending order? (Audit Q7; S10 L52.)

**Confirmed decision.** Orders expire after 48 hours (configurable) into a separate `EXPIRED` status. Late answers are refused. One reminder is sent halfway.

**Business rules**
1. **Deadline:** at placement, each seller order gets a deadline 48 hours later by default. Changing the setting later does not move existing deadlines.
2. **Expiry:** at the deadline, a `PENDING` order becomes `EXPIRED`. Stock is returned, the payment is `CANCELLED`, and the customer and seller are notified.
3. **No late answers:** after the deadline, the seller cannot confirm or reject (`409`), even before the job has run.
4. **Reminder:** the seller receives one in-app reminder when half the time has passed.

**Affected features:** 10, 11, 13, 15.

**Technical consequences**
- `respondBy` stored on the seller order.
- A worker job every 5 minutes with its own advisory lock. It uses a conditional update from `PENDING` with `respondBy < now`, and running it twice changes nothing.
- The reminder uses idempotent notification recording (an event key), which Feature 15 must provide first.

**Dependencies:** D1, D4, D9; Feature 15 phase 1.

**Unresolved details:** none at the business level.

---

## D8. Suspended shops with open orders

**Question.** What happens to existing orders when a shop is suspended? (Audit C5, Q8; S06 L286, L292; Arch invariant 5.)

**Confirmed decision.** Unshipped orders are cancelled at suspension. Deliveries already under way may be finished, narrowly. The suspended seller sees only those deliveries.

**Business rules**

| Stage at suspension | Outcome |
|---|---|
| New orders | Already impossible: cart issue `SHOP_UNAVAILABLE` blocks checkout (D3) |
| `PENDING` | Cancelled in the suspension transaction (system actor, reason "shop unavailable"); stock returned; payment `CANCELLED`; customer notified |
| `CONFIRMED`, delivery not out | Same, and the delivery is `CANCELLED` |
| Delivery `OUT_FOR_DELIVERY` or `FAILED` | The suspended owner may only: mark delivered with collection, mark failed, close as undeliverable. **No new attempts.** The 7-day job still applies |
| Final orders | Unchanged |

1. **Nothing else loosens:** every other seller operation stays `403`, as today.
2. **Visibility:** while suspended, the owner sees only the deliveries listed above. Other and completed orders are hidden until reinstatement.
3. **Reinstatement:** cancelled orders are not restored.

**Affected features:** 06 (suspension transaction), 11, 12, 13, 15, 16.

**Technical consequences**
- S06's suspension transaction gains the cancellations, stock returns, payment closures and notifications for that shop's open orders. It still follows the lock order shop → products.
- A new narrow guard (owner, `SELLER`, shop `SUSPENDED` or `APPROVED`, scoped to deliveries that were out when the shop was suspended). `requireApprovedSeller` is unchanged.

**Dependencies:** D1, D4, D5, D6, D9.

**Unresolved details:** the number of open orders one suspension can cancel in a single transaction (technical; expected to be small; to be confirmed in Stage 2).

---

## D9. Cash on delivery

**Question.** When is cash collected, by whom, for what amount, how are mistakes corrected, and what is reconciliation? (Audit C10, Q9; S13.)

**Confirmed decision.** One action records delivery and collection. Exact amount only. Statuses are final, and corrections are admin notes. The status mapping is confirmed.

**Business rules**
1. **Payment record:** one per seller order, created `PENDING` at placement, with amount due = product lines + fee snapshot. Never recalculated from current prices.
2. **Who records collection:** the seller (or whoever delivers for them) collects the cash, and only the shop owner records it. Administrators never record collection.
3. **One action, two facts:** "Delivered, cash received" records delivery `DELIVERED`, order `DELIVERED`, and payment `COLLECTED` in one transaction, as separate records. A customer who cannot pay is a failed attempt ("customer could not pay"), so "delivered but unpaid" cannot exist.
4. **Exact amount:** no partial payment and no discount at the door. The client sends the amount it displayed only as a check: a mismatch gets `409`, and the stored amount always comes from the server.
5. **No double collection:** guaranteed by a conditional update from `PENDING`.
6. **Status mapping:** `DELIVERED` → `COLLECTED`; final undeliverable → `FAILED`; `REJECTED`, `CANCELLED`, `EXPIRED` → `CANCELLED`. While a failed attempt is still open, the payment stays `PENDING`.
7. **Corrections:** statuses are final. An administrator may append a correction note with a required reason, never on their own shop. Nothing is overwritten or reversed.
8. **Audit:** every payment change appends an event (type, amount, actor, time, reason).
9. **Reconciliation:** amount due against amount collected per seller order, plus a collected-cash summary for the seller over a period. No ledger, settlement, commission, or payouts.

**Affected features:** 10 (creates the record), 11, 12, 13, 16, 17.

**Technical consequences**
- Payment table with a unique seller-order key, and an append-only payment-event table.
- A new `payments` (or `cod`) module boundary in `architecture.md`.
- Money as `DECIMAL(12, 2)` decimal strings, as for prices.

**Dependencies:** D2, D4, D5, D6, D7, D8.

**Unresolved details:** the length bounds of the admin correction reason (proposed: 10–500, as in S06).

---

## D10. Returns and refunds

**Question.** What is the first-release scope for returns and refunds? (Audit Q10; Overview L107, S11 L25.)

**Confirmed decision.** Entirely outside Chicman (option A), with a fixed sentence telling the customer.

**Business rules**
1. **Outside the platform:** returns, exchanges, and refunds are arranged directly between the customer and the shop.
2. **No records:** no return status, refund record, or request flow. Order and payment stay `DELIVERED` and `COLLECTED`.
3. **No automatic restock:** the seller may adjust stock through the normal Feature 07 stock screen.
4. **Customer information:** a delivered order shows a fixed sentence (French and Arabic) that returns and exchanges are arranged with the shop, next to the shop's contact (D11).

**Affected features:** 11, 13; Overview (wording is consistent: "seller-managed").

**Technical consequences:** none beyond the sentence.

**Dependencies:** D1 (no stock return after delivery), D9, D11.

**Unresolved details:** none for the first release. A later return workflow would need its own specification.

---

## D11. Recipient information and contact privacy

**Question.** Where does the recipient name come from, are coordinates required, which phone is used, and who sees what when? (Audit C9, C15, Q11; S10 L24–30 against S05.)

**Confirmed decision.** A recipient field at checkout, pre-filled. The map pin stays mandatory. The phone is the address phone, otherwise the profile phone. Seller visibility is staged.

**Business rules**
1. **Recipient name:** required at checkout (1–100 characters), pre-filled from the profile name, editable for this order only, stored only in the order snapshot. Saved addresses do not change.
2. **Map pin:** stays mandatory (S05). GPS stays optional, because a manually placed pin is accepted. The address's landmark serves as the delivery instructions; there is no separate note.
3. **Delivery phone:** the address's `deliveryPhone`, otherwise the profile phone (S05 rule), shown on the summary. To use another number, the customer edits the address. It is never labelled verified.
4. **Snapshot:** each seller order stores recipient name, delivery phone, label, city, district, landmark, latitude, longitude, location source, and accuracy. It never references the saved address, which can be deleted.
5. **Visibility:**

| Viewer | Before seller confirmation | After confirmation |
|---|---|---|
| Seller (own shop only) | City, district, items | Full snapshot, including the pin and accuracy |
| Customer (own orders only) | Own snapshot; shop name, `contactPhone`, WhatsApp | Same |
| Administrator | Everything, read-only | Everything, read-only |
| Public | Nothing | Nothing |

6. **Suspended sellers:** they see only deliveries in progress (D8).
7. **Unchanged rules:** the shop's business address is never shown to customers, and public routes are unchanged (S08).

**Affected features:** 05 (no change; S10 wording aligned to it), 08 (unchanged), 10, 11, 12, 17.

**Technical consequences**
- Separate response views for each stage and viewer, built field by field from allowlists, never by serializing rows.

**Dependencies:** D4, D8, D10.

**Unresolved details:** how long personal data in old orders is kept (open question O5).

---

## Confirmed with the Stage 1 approval (2026-11-09)

| # | Question | Confirmed decision |
|---|---|---|
| O1 | Flutter seller screens (C6, Q12) | Seller-side order, delivery, and cash-on-delivery screens are **web only** in the first release, through the seller dashboard. The Flutter app stays customer-focused: shopping, checkout, and customer order tracking. Seller mobile functionality may come in a future phase. The existing Flutter shop application screens (spec 06) are not removed. |
| O3 | Whole seller order or per item (Q17) | A seller accepts or rejects the **entire** shop order. Items cannot be decided individually. In a multi-shop order, each shop's order is handled independently, and one seller's decision never determines another's. |

## Confirmed at the Stage 2 review (2026-11-09)

| # | Topic | Confirmed decision |
|---|---|---|
| O2 | Shop owners buying from their own shop (Q13) | **No.** A customer cannot buy from a shop they own. If any line of the cart belongs to a shop owned by the authenticated customer, the **whole** checkout is refused, including in a multi-shop checkout. Enforced by the API at placement, not only by clients. The cart itself is unchanged |
| S2-1 | Delivery fee once set | It can be updated but never cleared. A shop without a configured fee cannot receive checkout orders until it sets one (confirms D2) |
| S2-2 | Delivery fee editing | Web only in the first release, consistent with O1 |
| S2-3 | Notifications (O7) | In-app notifications are persisted in the same database transaction as their business change, with unique event keys. No outbox is needed for in-app notifications. This guarantees **in-app persistence only**: email, push, or any external delivery is not implemented or implied by it, and stays out of scope until separately specified |
| S2-4 | Customer cancellation reasons | `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `OTHER`. Choosing `OTHER` requires a short explanatory text. The reason itself stays optional (D6) |
| S2-5 | Duplicate checkout submissions | An `Idempotency-Key` header on checkout placement |
| S2-6 | Checkout rate limits | 20 per user and 60 per IP address per 10 minutes, as initial **configurable** server-side values, not business rules |
| S2-7 | Historical order information | An order keeps the information that applied at placement. Each order item stores the **product image reference** used at placement, and each shop order stores the **shop contact phone numbers** used at placement. Historical orders never depend on the seller's current image or contact details. Referenced images are kept available (product image cleanup never deletes an object an order references), with a placeholder as a safe fallback if an image is missing anyway |

## Confirmed by the project owner (2026-11-11): O6, notifications

O6 is **resolved**. Security events (also named in O6) are unchanged: spec 03 defines none, so none is recorded (spec 15, section 5).

| # | Topic | Confirmed decision | Rationale |
|---|---|---|---|
| O6.1 | Administrator notifications | No separate administrator audience in the first release: no administrator-specific events or recipients. The admin area must not present an administrator's ordinary customer or seller notifications as administrator notifications. | No administrator event is defined yet; showing personal notifications in the admin area would be misleading. |
| O6.2 | Seller notifications on mobile | Web only in the first release. The Flutter app keeps showing customer order notifications only; no seller filter, tab, or screen is added. Sellers read theirs in the web seller notification center. | Follows O1: seller operations are web only. |
| O6.3 | Notification retention | Notifications are kept **365 days after creation**, then become eligible for deletion. A daily cleanup job deletes them in safe, bounded batches; it is idempotent and never deletes order, delivery, payment, or other business records. Deleting a notification must not weaken event idempotency: an event already recorded must never be recorded again after its notification is deleted. | Bounds the table's growth while keeping a year of history. |

External delivery (email, push, SMS) stays out of scope (S2-3): the channel interface remains an extension point only.

**Implementation status (2026-11-11):** implemented as spec 15 records it (section 7 and O6 follow-up): the admin area has no notification bell or center, and a daily bounded job deletes notifications older than 365 days while a separate, never-purged event-key ledger (`NotificationEvent`) keeps every event recorded once.

## Open questions (still unresolved)

These came from the audit and were not part of either decision round. None is assumed.

| # | Question | Blocks |
|---|---|---|
| O4 | Admin scope beyond D6 and D9: user oversight (no email stored; no Supabase secret key), product moderation (C12), statistics definitions, phone history access (Q14) | Feature 17 |
| O5 | Retention of orders, snapshots with personal data, payment events; effect on account deletion (Q18) | Data policy; not the first implementation |
| O8 | Search: sold-out products (C8), PostgreSQL fallback, production hosting (Q16) | Feature 18 |
| O9 | Favorites: price display for hidden products (C11) | Feature 14. **Implemented with the audit's recommendation (2026-11-10), awaiting the project owner's confirmation:** a hidden favorite shows "unavailable" with no price, shop, or link; no price snapshot (spec 14, Implementation Notes) |
| O10 | Category management (C13); reviews and reported issues (Q19, D8 in the audit) | Feature 17 scope; roadmap |
