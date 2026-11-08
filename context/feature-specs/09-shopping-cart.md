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

- [ ] An authenticated customer can add products.
- [ ] Products from multiple shops can coexist in one cart.
- [ ] Items are grouped by shop.
- [ ] Variants are validated against their products.
- [ ] Quantities must be positive integers.
- [ ] Quantities cannot exceed available stock at validation time.
- [ ] Prices are calculated by the backend.
- [ ] Cart contents persist across sessions.
- [ ] Unpublished products are identified.
- [ ] Suspended-shop products are identified.
- [ ] Price changes are communicated clearly.
- [ ] Insufficient stock is communicated clearly.
- [ ] Customers can update and remove items.
- [ ] Web and mobile use consistent cart rules.
- [ ] French, Arabic, and RTL are supported.
- [ ] Relevant tests and project quality checks pass.