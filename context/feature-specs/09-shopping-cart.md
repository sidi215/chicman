# 09 — Shopping Cart

## Goal

Allow customers to add products to a shopping cart, update quantities, select product variants, remove items, and review their intended purchases before checkout.

The cart must support products from multiple shops in one shopping session.

Customers can manage a cart without immediately placing an order.

## Design & Architecture Decisions

### 1. Cart ownership

- A cart belongs to one authenticated customer.
- Customers must be able to browse products without authentication.
- A customer must authenticate before proceeding to checkout.
- Do not implement guest-to-account cart merging in this version.

### 2. Multiple shops

One cart can contain products from multiple shops.

The cart must group items by their associated shop for presentation.

Do not create separate customer checkouts for each shop.

### 3. Cart items

Each cart item must identify:

- Product.
- Shop.
- Selected variant, when applicable.
- Quantity.
- Price snapshot for display and review.

The backend must verify that the product and selected variant actually belong together.

### 4. Quantity and stock

- Quantity must be a positive integer.
- A customer cannot add a quantity greater than the currently available stock.
- The backend must validate stock when adding or updating an item.
- Stock can change after an item is added.
- Cart contents do not guarantee stock reservation.

Revalidate stock during checkout.

### 5. Price handling

- Display prices in MRU.
- The backend remains the source of truth for prices.
- Do not trust prices sent by the client.
- Cart totals must be calculated using validated server-side prices.
- Recalculate prices when the cart is read or modified.

The cart is not a financial commitment and does not guarantee that a displayed price will remain unchanged until checkout.

### 6. Cart persistence

Cart contents must remain available when a customer signs out and signs in again.

The cart must be associated with the customer's application identity, not a client-generated user ID.

### 7. Invalid cart items

Handle these situations:

- Product becomes archived.
- Product becomes unpublished.
- Shop becomes suspended.
- Selected variant becomes unavailable.
- Stock becomes insufficient.
- Product price changes.

The customer must receive clear information and be able to update or remove affected items.

Do not silently change quantities or variants.

### 8. Cart interface

Display:

- Product image.
- Product name.
- Shop name.
- Selected size and color.
- Unit price.
- Quantity controls.
- Item subtotal.
- Cart subtotal.
- Availability warnings.
- Remove action.

Group items by shop while maintaining one overall cart.

### 9. Localization

Support French, Arabic, RTL, and MRU formatting.

## Implementation Details

### Backend

Implement:

- Cart data model.
- Cart item data model.
- Add item operation.
- Read cart operation.
- Update quantity operation.
- Remove item operation.
- Clear cart operation.

The backend must validate product ownership, variant relationships, publication state, shop status, stock, and prices.

### Web

Implement:

- Add-to-cart interactions.
- Cart icon and item count.
- Cart page.
- Quantity controls.
- Item removal.
- Availability and price-change messages.

### Mobile

Implement the same cart business rules in Flutter.

The customer should have a consistent cart across supported customer interfaces.

### Shared packages

Share cart contracts and validation rules where appropriate.

Do not duplicate price or stock validation logic in the frontend.

### Boundaries

Do not implement:

- Stock reservation.
- Order creation.
- Payment.
- COD confirmation.
- Delivery management.
- Guest cart merging.

These belong to checkout and order-management features.

### Documentation

Update `context/progress-tracker.md` after implementation.

## Verification Checklist

- [x] An authenticated customer can add products.
- [x] Products from multiple shops can coexist in one cart.
- [x] Items are grouped by shop.
- [x] Variants are validated against their products.
- [x] Quantities must be positive integers.
- [x] Quantities cannot exceed available stock at validation time.
- [x] Prices are calculated by the backend.
- [x] Cart contents persist across sessions.
- [x] Unpublished products are identified.
- [x] Suspended-shop products are identified.
- [x] Price changes are communicated clearly.
- [x] Insufficient stock is communicated clearly.
- [x] Customers can update and remove items.
- [x] Web and mobile use consistent cart rules.
- [x] French, Arabic, and RTL are supported.
- [x] Relevant tests and project quality checks pass.

Checked by automated tests and browser runs with a test-signed session. A real Supabase sign-in and a real Android device or emulator have not been used: see Verification Status.

## Implementation Notes

Decisions the spec left open, made during implementation (2026-11-08).

### API

Routes under `/api/v1/customers/me/cart`, for bootstrapped users. Each answers with the whole recalculated cart.

| Route | Purpose |
|---|---|
| `GET /customers/me/cart` | Read. Writes nothing; no cart yet reads as empty. |
| `DELETE /customers/me/cart` | Clear. No client offers it yet (the spec lists it for the backend only). Checkout does **not** use it: it removes the ordered lines inside its own placement transaction (spec 10, D3). |
| `POST /customers/me/cart/items` | Add. Adding an existing line raises its quantity. |
| `PATCH /customers/me/cart/items/:itemId` | Set the quantity. |
| `DELETE /customers/me/cart/items/:itemId` | Remove a line. |
| `POST /customers/me/cart/items/:itemId/accept-price` | Acknowledge a price change. **Added to the spec's list:** see below. |

### Decisions

- **Price snapshot:** `priceSnapshot` is the last price the customer accepted. Totals always use the current price. Reading, changing the quantity, and adding more leave it unchanged, so a price-change warning stays until the customer acknowledges it, removes the line, or the price returns.
- **Accepting a price (approved by the project owner, 2026-11-09):** `POST /customers/me/cart/items/:itemId/accept-price`. Safeguards:
  - The body's `price` is only a precondition: the price the customer was shown. It is compared with the current price from PostgreSQL, and a difference gives `409 CART_PRICE_CHANGED`.
  - What is stored always comes from the product row, never from the request. Other fields, numbers instead of strings, and malformed amounts give `400`.
  - The precondition is what makes a stale acceptance detectable. Without it, the API could not tell whether the customer saw the price it would be accepting.
  - An acceptance covers that price only: any later change warns again, with the accepted price as `previousPrice`.
  - The read of the price and the write hold a shared lock on the product, so a concurrent seller price change is ordered before or after, never in between.
- **Remove-only lines:** a line whose shop is unavailable, or whose product is archived or unpublished, or whose variant is unavailable, can only be removed. It shows the last price the customer saw, because the current price of a hidden product is not public.
- **Conditional stock display (approved by the project owner, 2026-11-09):** the available quantity is shown only when a cart line's quantity is above its current stock, only on that line, and only as `INSUFFICIENT_STOCK.availableQuantity`.
  - It is that line's own stock (the variant's, when it has one), recalculated by the API on every read. Clients never send stock.
  - It is not returned for a line at or below its stock, a remove-only line, another variant, or another seller, and error responses carry only a code.
  - Public listings and product details never expose stock quantities, signed in or not.
  - The quantity is never changed for the customer. The explicit action is "Ramener la quantité à N" (web and mobile), which sends an ordinary quantity update.
- **Subtotals** count purchasable lines only. A line with a price change stays counted at the new price; the page says when lines are left out. The cart icon counts all units.
- **At checkout (D3, spec 10):** the cart's behaviour does not change. Checkout reruns these rules and blocks the whole checkout on any non-purchasable line **and on any price change not yet accepted**, even though the cart counts such a line as purchasable.
- **Removed or renamed variants:** removing a variant clears `variantId` (`ON DELETE SET NULL`) and the line keeps the chosen size and color, flagged `VARIANT_UNAVAILABLE`. A rename also flags it (a change of case does not), because the customer did not choose the new value. Choosing that variant again clears the flag. A line without a variant is flagged once the product gains variants.
- **Adding a hidden product** gives `404 PRODUCT_NOT_FOUND`, the same as an unknown product and the public catalog.
- **Limits:** 100 lines per cart. Writes: 300 per user and 600 per address per 10 minutes.
- **Concurrency:** each write locks the customer's cart row, then takes shared locks on the shop and the product (the seller lock order). What was validated holds until the commit. No stock is reserved.

### Clients

- **Web:** a cart page at `/cart`, as this spec requires, not the drawer `ui-context.md` previously described. It has one URL per the Web Localization rules and is not indexed.
- **Add to cart** adds one unit from the product page only. Product cards still link to the product page, because variants must be chosen there.
- **Guests** see the cart icon and an invitation to sign in. After signing in they land on the account page, as with every login; they are not returned to the product.
- **Sold-out lines:** quantity controls are disabled; the line recovers by itself when replenished, or can be removed.
- **Changing account:** both clients drop the answer to any cart request started before the session changed, so one account's cart never shows for the next.

### Browser CSP and Zod

Zod probes for `eval` with `Function("")`. It catches the error, but the CSP (which never allows `unsafe-eval`) reported it as a violation on every page. This predates the cart. `apps/web/src/instrumentation-client.ts` sets `z.config({ jitless: true })` in the browser only; the API keeps Zod's faster mode.

### Web production build

`next build` fails on prerendering (`useContext` of null) when `NODE_ENV=development` is set in the shell. Which page it names varies between runs, for example `/_global-error`, `/_not-found`, or `/fr/forgot-password`. `apps/api/.env` sets that value, so never source it into a shell that then builds the web app.

### Verification Status

| Check | Status | Evidence |
|---|---|---|
| API, web, and Flutter automated tests | Done | See `progress-tracker.md`, 09 final review |
| Web production build, whole flow, 46 checks | Done, **test-signed session** | Real API rules on the test database, placeholder images |
| CSP across the whole web flow, production build | Done, **test-signed session** | 0 violations on `/login`, `/products/:id`, `/cart`, `/ar/products/:id` |
| Web at 320 px, French and Arabic | Done | No overflow, and no element outside the page |
| Web and Dart client on one cart, both directions | Done, **partial** | Real browser and the real Dart `CartController` and `ApiClient` in a Flutter test process, on one test-signed account. No device, no Flutter screens. |
| Migration on a clean database, development, test | Done | Applied; no difference from the schema |
| **Real Supabase account, web** | **Not done** | Needs the owner's password and Turnstile, which an agent must not enter |
| **Android device or emulator** | **Not done** | Attempt abandoned: see the tracker |
| **Real Android app: restart persistence, French and Arabic layouts** | **Not done** | Widget tests only |
| Production deployment | Out of scope | Not attempted |
