# 10 — Checkout

## Goal

Allow authenticated customers to convert their shopping cart into an order using Cash on Delivery (COD).

A single checkout may contain products from multiple shops, with each shop handling its own order confirmation and delivery.

The checkout must validate customer information, delivery addresses, products, prices, stock, and delivery fees before creating orders.

Business rules for this feature come from `context/business-decisions-features-10-18.md` (decisions D1–D11, approved 2026-11-09). Where this spec references a decision, that record is the source.

## Design & Architecture Decisions

### 0. Ownership

| Responsibility | Owner |
|---|---|
| Customer-facing checkout: summary, validation, idempotency, the placement request and its transaction, confirmation response, removal of ordered cart lines | **This feature** |
| Order, shop order, and order item records; their creation function; snapshots; lifecycle; order stock rules | Feature 11 (`11-order-management.md`) |
| Delivery records (created later, at seller confirmation) | Feature 12 |
| Payment record shape and its creation function | Feature 13 |
| Delivery fee value | Feature 06 (shop setting) |
| Saved addresses | Feature 05 |
| Cart and its line rules | Feature 09 |

Checkout calls the order-creation function of Feature 11 and the payment-creation function of Feature 13 **inside its own transaction**. Neither feature creates orders or payments any other way.

### 1. Authentication

- Customers must register or log in before checkout.
- Guest checkout is not supported.
- Every checkout must be associated with an authenticated customer.
- The backend must derive customer identity from the verified authentication context.

### 2. Delivery address and recipient (D11)

Customers must select a saved delivery address or create a new one through the existing address feature (spec 05). Checkout does not add a second address editor or address API.

The order stores the information needed for delivery as an immutable snapshot (owned by spec 11):

- **Recipient name:** required at checkout, 1–100 characters, plain text (NFC, trimmed, no control characters). Pre-filled from the profile's `fullName`, editable for this order. Stored only in the order snapshot, never on the saved address.
- **Contact phone:** the address's `deliveryPhone`, otherwise the profile phone (spec 05 rule). It is shown on the summary. To use another number, the customer edits the address. It is unverified contact data (spec 03) and is never labelled verified.
- **City, district, landmark, and label** from the saved address. The landmark serves as the delivery instructions; there is no separate note.
- **Location coordinates:** always present, because every saved address has a confirmed map pin (spec 05). **GPS is optional:** a pin placed manually on the map is accepted. Location source and accuracy are copied too.

GPS location is collected only with customer permission.

Manual address entry must remain available.

Do not require GPS access to complete checkout.

The saved address can be deleted later (hard delete, spec 05). The order never references it.

### 3. Multiple-shop checkout

A single checkout can contain items from multiple shops.

The system must create separate seller-specific order records (shop orders) under one customer checkout (order), as defined in spec 11.

Each shop handles its own confirmation and delivery independently.

One shop rejecting or failing to confirm its order must not automatically cancel the orders belonging to other shops.

### 4. Order confirmation

- Newly created shop orders begin in `PENDING`, with a response deadline (`respondBy`, D7, spec 11).
- Each seller must independently confirm or reject their **whole** shop order (O3).
- An order remains pending until its seller responds, or until its deadline passes and it expires (D7).
- Sellers must not access or modify another shop's orders.

The seller confirmation workflow is part of the order lifecycle (spec 11). Do not treat checkout creation as seller confirmation.

### 5. Payment

For the initial version, support only Cash on Delivery.

- No card payment.
- No online payment gateway.
- No wallet.
- No third-party payment provider.

The customer pays in cash when the delivery is made. Each shop order gets one payment record, created by this checkout's transaction through spec 13's function (D9).

### 6. Delivery responsibility

- Delivery is handled by the seller.
- Delivery fees are determined by the seller.
- Delivery fees are collected by the seller.
- Delivery responsibility belongs to the seller.
- Failed delivery responsibility belongs to the seller.

Do not introduce a centralized delivery company or platform-managed logistics workflow.

### 7. Delivery fee and totals (D2)

Before order creation, the customer must see:

- Products subtotal (per shop and overall).
- Delivery fee for each shop.
- Total amount payable.

Because one checkout can contain multiple shops, delivery fees are calculated separately for each shop:

- **Source:** the shop's flat `deliveryFee` (spec 06), set by the seller. It is charged **once per shop order**, regardless of the number of items.
- **Zero:** `0.00` is valid (free delivery).
- **Not set:** a shop whose `deliveryFee` is `null` cannot be checked out. Its lines block the checkout (section 8).
- **Snapshot:** placement copies the fee onto the shop order. It never changes afterwards, whatever the seller later sets.
- The fee is shown on the checkout summary only, not in the cart.

The backend must calculate the final amounts.

Never trust client-provided totals, product prices, or delivery fees. The placement request carries the figures the customer was shown (each shop's products subtotal and fee, and the total) **only as a precondition**: they are compared with the server's figures, and any difference refuses the placement with `409 CHECKOUT_TOTALS_CHANGED` and nothing is written. Stored amounts always come from the server. This is the same safeguard as the cart's price acceptance (spec 09).

All amounts are `DECIMAL(12, 2)` in MRU, exchanged as decimal strings.

### 8. Eligibility and stock validation (D1, D3)

**The whole checkout is blocked** while any cart line has one of these problems. Checkout never changes a line itself: the summary lists the problems and links to the cart, where the existing spec 09 actions resolve them.

| Problem | Source | Resolved in the cart by |
|---|---|---|
| Product archived, unpublished, or from a shop that is not `APPROVED`; variant unavailable | Cart issues `PRODUCT_ARCHIVED`, `PRODUCT_UNPUBLISHED`, `SHOP_UNAVAILABLE`, `VARIANT_UNAVAILABLE` | Removing the line |
| Quantity above the available stock | Cart issue `INSUFFICIENT_STOCK` | "Ramener la quantité à N", or removing the line |
| Price changed and not yet accepted | Cart issue `PRICE_CHANGED` | Accepting the price (`accept-price`), or removing the line |
| Shop without a delivery fee | Checkout only (`deliveryFee` is `null`) | Removing that shop's lines; the seller is prompted to set a fee |
| Product from a shop the customer owns (O2) | Checkout only (`Shop.ownerUserId` = the customer) | Removing that shop's lines |
| Empty cart | Checkout only | Adding products |

Before creating orders, under the locks of the placement transaction (section 9), checkout re-runs the cart's line rules (`evaluateCartLine`, spec 09) on fresh data:

- Revalidate product publication status.
- Revalidate shop approval status.
- Revalidate variants.
- Revalidate stock.
- Revalidate current prices, and require that every line's current price equals its accepted price (`priceSnapshot`).

Nothing from an earlier read is trusted.

**Stock is taken at placement (D1)**, through the order stock function defined in spec 11 (implemented in `modules/inventory/`). For each line, a conditional update lowers the product's or variant's stock only if enough remains. If any line cannot be taken, the whole placement rolls back. Taken stock is immediately unavailable to other customers. Concurrent checkouts cannot oversell. The return rules (rejection, cancellation, expiry, final delivery failure) are spec 11's.

**Own shop (O2, confirmed 2026-11-09):** a customer cannot buy from a shop they own.
- **Whole checkout refused:** if any cart line belongs to a shop whose `ownerUserId` is the authenticated user, the whole checkout is refused, in a multi-shop checkout too.
- **Enforced by the API:** the summary lists the problem, and placement checks it again under the shop locks. It does not rely on any client.
- **Unchanged:** the cart (spec 09).

### 9. Checkout integrity

Checkout must be protected against duplicate submissions.

- **Idempotency key:** every placement request carries an `Idempotency-Key` header, a client-generated UUID, new for each attempt the customer starts. It is stored on the order, unique per customer.
  - The same key again (a retry, a double tap) returns `200` with the order it created, and writes nothing.
  - Two concurrent requests with the same key: one creates the order, and the other hits the unique constraint, rolls back, and returns that order.
  - A missing or malformed key → `400`.
- **Second protection:** a successful placement empties the cart, so a new key after success finds an empty cart (`409 CHECKOUT_CART_EMPTY`).
- **One transaction** for the whole placement. In this order:
  1. Lock the customer's cart row.
  2. Lock the shops `FOR SHARE`, ordered by ID.
  3. Lock the products, ordered by ID. This is the same cart → shop → product order as the cart (spec 09) and seller writes (spec 07), so concurrent checkouts cannot deadlock.
  4. Validate (sections 2, 7, 8).
  5. Through spec 11's creation function: create the order, its shop orders, and order items. The snapshots include the delivery details, the shop contact phones, and each item's image reference at placement (S2-7), plus `respondBy`. Take the stock and record the stock movements. Write the initial status history.
  6. Through spec 13's function: create one `PENDING` payment per shop order.
  7. Record the notifications (spec 15).
  8. Delete the ordered cart lines (every line, under D3).
- If any step fails, nothing is committed: no partial order, no taken stock, no payment record, no removed cart line.

Order creation and cart handling must be consistent if a database operation fails.

### 10. Customer communication

After successful checkout, display a confirmation summary.

The customer must be able to see:

- Checkout reference.
- Orders grouped by shop.
- Products and quantities.
- Delivery address and recipient.
- Delivery fees.
- Total amount payable.
- Payment method: Cash on Delivery.
- Initial order status (`PENDING`, awaiting the seller) and the response deadline.

Notifications for order updates belong to the notification feature (spec 15) and must follow its requirements.

### 11. Localization

- Support French and Arabic.
- Support RTL.
- Display all amounts in MRU.
- Use clear localized COD labels.

## Implementation Details

### Backend

Implement (module `apps/api/src/modules/checkout/`):

- Checkout validation (sections 7–8), reusing `evaluateCartLine` (`modules/cart/cart-rules.ts`), `productVisibility`, `isQuantityAvailable`, and `isShopStillApproved`. Do not write second definitions.
- Delivery address selection from the customer's own saved addresses (`modules/addresses/`; another customer's address → `404`).
- Shop-specific order creation through spec 11's creation function.
- Price and delivery-fee calculation from PostgreSQL only.
- Stock validation and taking through spec 11's order stock function. **Never** through the seller `StockService`.
- Idempotent checkout submission (section 9).
- Checkout confirmation response.
- Removal of the ordered cart lines inside the placement transaction. `DELETE /customers/me/cart` is not used by checkout.

Use database transactions where required to preserve consistency.

If checkout spans multiple shops, ensure that a failure cannot leave partially created orders without a valid parent checkout record.

**Routes** (bootstrapped users, guard `user`; identity from the token only):

| Route | Purpose |
|---|---|
| `GET /api/v1/customers/me/checkout?addressId=` | Summary. Writes nothing. Per shop: lines (from the cart), products subtotal, fee (or "not set"), subtotal with fee; overall total; the resolved address snapshot and default recipient name; and the list of blocking problems. Without `addressId`, the default address is used; with no address, the summary says one is required |
| `POST /api/v1/customers/me/checkout` | Placement. Header `Idempotency-Key`. Strict body: `{ addressId, recipientName, expected: { total, shops: [{ shopId, productsSubtotal, deliveryFee }] } }`. `201` with the created order (spec 11's customer view); `200` for a repeated key |

**Errors** (code-only bodies, shared constants `CHECKOUT_ERROR_CODES`):

| Response | Meaning |
|---|---|
| `409 CHECKOUT_BLOCKED` | A line has a problem from section 8; read the summary |
| `409 CHECKOUT_TOTALS_CHANGED` | A shown figure differs from the server's |
| `409 CHECKOUT_CART_EMPTY` | The cart is empty |
| `404 ADDRESS_NOT_FOUND` | Unknown address, or another customer's |
| `400` | Malformed body or key |
| `429` | Rate limited |

**Rate limit (S2-6):** placement starts at 20 per user and 60 per IP address per 10 minutes. These are **server configuration values** (`CHECKOUT_RATE_LIMIT_PER_USER`, `CHECKOUT_RATE_LIMIT_PER_IP`, `CHECKOUT_RATE_LIMIT_WINDOW_MS`, validated at startup with these defaults), not business rules. The same Redis limiter applies, with the in-memory fallback. The summary uses the cart's read rules.

### Web

Implement:

- A checkout page at `/checkout`, in the `(storefront)` route group, so that it shares the layout's `CartProvider`. It is not indexed, and the cart page links to it.
- Address selection: a selection mode on the existing address list (`features/addresses/`). Not a second list.
- Address creation, through the existing address editor, returning to checkout.
- Recipient name field, pre-filled.
- Order summary.
- Shop-specific delivery fee display.
- COD as the only payment method, stated clearly.
- The blocking-problem list, linking to the cart.
- Final order confirmation, then a reload of the cart state, which keeps the cart provider's account-change guard (spec 09).

### Mobile

Implement the same customer checkout rules in Flutter:

- A checkout screen opened from the cart screen.
- A selection mode on the existing address list screen.
- A recipient field.
- A summary with the blocking-problem list.
- A confirmation screen.

Maintain consistent pricing and order information between web and mobile.

### Shared packages

Reuse shared checkout, address, and order contracts (`packages/shared/src/checkout/`, `orders/`).

The backend remains authoritative for checkout calculations and validation.

### Boundaries

Do not implement:

- Online payments.
- Payment gateways.
- Wallets.
- Centralized delivery services.
- Advanced order tracking.
- Notification delivery infrastructure.
- A second cart, address, or catalog implementation.

These belong to other specifications.

### Documentation

Update `context/progress-tracker.md` after implementation.

## Verification Checklist

- [x] Checkout requires authentication.
- [x] A customer can select a saved address.
- [x] A customer can create an address during checkout.
- [x] GPS is optional and requires permission; a manual pin is accepted. *(Unchanged spec 05 editor, reused; the API tests place orders from `MANUAL` pins.)*
- [x] The recipient name is required, pre-filled from the profile, and stored only on the order.
- [x] The delivery phone follows the address-then-profile rule and is never shown as verified.
- [x] One checkout supports products from multiple shops.
- [x] Separate seller orders are created under one checkout.
- [x] Each seller order starts as `PENDING` with a response deadline.
- [ ] Sellers can only access their own orders. *(No seller order route exists yet: spec 11. Checkout exposes nothing to sellers except their own `SHOP_ORDER_PLACED` notification record.)*
- [x] COD is the only payment method, and one `PENDING` payment is created per shop order.
- [x] Delivery fees are calculated separately per shop, once per shop order, and a shop without a fee blocks checkout.
- [x] The backend calculates all final totals; changed totals or fees are refused with `409` and nothing is written.
- [x] Every blocking problem in section 8 blocks the whole checkout, including an unaccepted price change.
- [x] A cart with any product from a shop the customer owns is refused by the API, also in a multi-shop checkout and also when a client skips the summary.
- [x] The order keeps each item's image reference and the shop contact phones from placement.
- [x] The checkout rate limits come from configuration, with the stated defaults.
- [x] Stock and prices are revalidated under locks before order creation.
- [x] Concurrent checkout requests cannot oversell stock.
- [x] Repeated submissions (same key, concurrent or sequential) cannot create duplicate orders.
- [x] Database failures do not leave partially created checkouts, taken stock, payment records, or removed cart lines.
- [x] Successful checkout returns a clear confirmation.
- [x] The ordered cart lines are removed in the same transaction; a failed placement leaves the cart unchanged.
- [x] French, Arabic, and RTL are supported. *(Dictionary parity tests on web and mobile, a Flutter RTL widget test; the web page was not opened in a browser.)*
- [x] Web and mobile follow the same business rules. *(Both send the summary's figures, keep the key only while the outcome is unknown, and show the API's problems; neither decides a figure.)*
- [x] Relevant tests and project quality checks pass.

## Implementation Notes (2026-11-09)

### Scope decision (project owner, 2026-11-09)

Checkout calls functions that belong to other specifications, none of which existed. The project owner chose to build **only what checkout calls**, exactly as those specifications define it, and nothing else of them:

| Built with this feature | Owner spec | Left for that spec |
|---|---|---|
| `Shop.deliveryFee`: API (`PATCH /sellers/me/shop`, audited, never cleared, refused while suspended), owner and admin views, web seller dashboard section with the "set your fee" prompt | 06 (D2, S2-1, S2-2) | — |
| `Order`, `ShopOrder`, `OrderItem`, `ShopOrderStatusEvent`, `StockMovement`; `createOrder`, `loadCustomerOrder` (customer view), `shopOrderLabel` | 11 | Every lifecycle route and transition, expiry and reminder jobs, seller and admin views, stock returns, suspension function, order history pages |
| `takeOrderStock` in `modules/inventory/order-stock.ts` | 11 (D1) | The return function and its skip reasons |
| Product image cleanup never deletes an object an order item references (S2-7) | 11 | — |
| `Payment`, `PaymentEvent`, `createPayment` | 13 | `collect`, `markFailed`, `markCancelled`, notes, summary |
| `Notification.eventKey`, `resourceType`, `resourceId`; `recordNotification` (insert, nothing on a key conflict); `SHOP_ORDER_PLACED` | 15 | Keys for the six shop decisions, the read API, notification centers, every other event |

### Decisions the spec left open

- **Problem order at placement:** body or key `400` → repeated key `200` → empty cart `409` → address `404` → blocking problem `409` → changed figures `409`.
- **`Idempotency-Key`:** a missing or non-UUID key → `400 CHECKOUT_IDEMPOTENCY_KEY_INVALID`. Keys are compared in lower case. A repeated key returns the order whatever the new body says. Clients keep a key only while the outcome is unknown (no answer, `503`); any definite answer starts a new attempt.
- **Locks:** the products are locked `FOR UPDATE`, not `FOR SHARE`, because placement updates their stock (a shared lock upgraded by two placements would deadlock). Order still cart → shop → product. The placement transaction may wait up to 20 s for locks.
- **Summary:** the cart's own read (`CartService.read`), plus fees and owners; no rate limit, like the cart read. Problems are listed per line and per shop; `CART_EMPTY` when there is nothing. Without an address, `address` is `null`. `defaultRecipientName` is the profile name, or empty.
- **Order reference:** `CM-` and 10 random Crockford base32 characters (50 bits).
- **Display order** in the order view: shop orders by shop name, items by product name (the tables keep no position).
- **`SHOP_ORDER_PLACED` payload:** `itemsCount` counts units.
- **Address choice:** web `/account/addresses?select=checkout` (each address leads to `/checkout?addressId=…`; adding or editing with `returnTo=checkout` comes back with that address). Mobile: `AddressListScreen(selectForCheckout: true)` returns the chosen ID; after adding or editing, checkout reads the summary again. Only the fixed value `checkout` is accepted as a return target.
- **Cart:** `/cart` and the mobile cart always offer "Passer la commande"; checkout lists what is left to resolve.
- **Configuration:** `ORDER_RESPONSE_TIMEOUT_HOURS` (48), `CHECKOUT_RATE_LIMIT_PER_USER` (20), `CHECKOUT_RATE_LIMIT_PER_IP` (60), `CHECKOUT_RATE_LIMIT_WINDOW_MS` (600000), validated at startup.

### Verification status

- **Automated:** API `test/checkout.test.ts` (39 tests, PostgreSQL) and config tests; web `features/checkout/checkout.test.ts` and delivery fee tests; Flutter `test/features/checkout/checkout_test.dart` (16). Deliberate breaks each caught: price change not blocking, own shop not checked, no repeated-key check after the cart lock, total not compared, cart lines not removed.
- **Not verified:** the web checkout page in a browser, a real Supabase sign-in, and Android on a device or emulator.
