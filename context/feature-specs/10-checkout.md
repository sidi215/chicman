# 10 — Checkout

## Goal

Allow authenticated customers to convert their shopping cart into an order using Cash on Delivery (COD).

A single checkout may contain products from multiple shops, with each shop handling its own order confirmation and delivery.

The checkout must validate customer information, delivery addresses, products, prices, and stock before creating orders.

## Design & Architecture Decisions

### 1. Authentication

- Customers must register or log in before checkout.
- Guest checkout is not supported.
- Every checkout must be associated with an authenticated customer.
- The backend must derive customer identity from the verified authentication context.

### 2. Delivery address

Customers must select a saved delivery address or create a new one.

The address must include the information needed for delivery, such as:

- Recipient name.
- Contact phone.
- City.
- Address details.
- Optional location coordinates and delivery instructions.

GPS location is collected only with customer permission.

Manual address entry must remain available.

Do not require GPS access to complete checkout.

### 3. Multiple-shop checkout

A single checkout can contain items from multiple shops.

The system must create separate seller-specific order records under one customer checkout.

Each shop handles its own confirmation and delivery independently.

One shop rejecting or failing to confirm its order must not automatically cancel the orders belonging to other shops.

### 4. Order confirmation

- Newly created seller orders begin in `PENDING`.
- Each seller must independently confirm or reject their order.
- An order remains pending until its seller responds.
- Sellers must not access or modify another shop's orders.

The seller confirmation workflow is part of the order lifecycle. Do not treat checkout creation as seller confirmation.

### 5. Payment

For the initial version, support only Cash on Delivery.

- No card payment.
- No online payment gateway.
- No wallet.
- No third-party payment provider.

The customer pays in cash when the delivery is made.

### 6. Delivery responsibility

- Delivery is handled by the seller.
- Delivery fees are determined by the seller.
- Delivery fees are collected by the seller.
- Delivery responsibility belongs to the seller.
- Failed delivery responsibility belongs to the seller.

Do not introduce a centralized delivery company or platform-managed logistics workflow.

### 7. Delivery fee and totals

Before order creation, the customer must see:

- Products subtotal.
- Delivery fee for each shop.
- Total amount payable.

Because one checkout can contain multiple shops, delivery fees must be calculated separately for each shop.

The backend must calculate the final amounts.

Never trust client-provided totals, product prices, or delivery fees.

### 8. Stock validation

Before creating orders:

- Revalidate product publication status.
- Revalidate shop approval status.
- Revalidate variants.
- Revalidate stock.
- Revalidate current prices.

Stock must be handled safely to prevent overselling when concurrent customers place orders.

The stock reservation and release rules must be explicit and consistent with the order lifecycle.

### 9. Checkout integrity

Checkout must be protected against duplicate submissions.

Use an idempotency mechanism so that retrying the same checkout request does not create duplicate orders.

Order creation and cart handling must be consistent if a database operation fails.

### 10. Customer communication

After successful checkout, display a confirmation summary.

The customer must be able to see:

- Checkout reference.
- Orders grouped by shop.
- Products and quantities.
- Delivery address.
- Delivery fees.
- Total amount payable.
- Payment method: Cash on Delivery.
- Initial order status.

Notifications for order updates belong to the notification feature and must follow its requirements.

### 11. Localization

- Support French and Arabic.
- Support RTL.
- Display all amounts in MRU.
- Use clear localized COD labels.

## Implementation Details

### Backend

Implement:

- Checkout validation.
- Delivery address selection.
- Shop-specific order creation.
- Price and delivery-fee calculation.
- Stock validation and safe reservation.
- Idempotent checkout submission.
- Checkout confirmation response.
- Cart clearing or reconciliation after successful order creation.

Use database transactions where required to preserve consistency.

If checkout spans multiple shops, ensure that a failure cannot leave partially created orders without a valid parent checkout record.

### Web

Implement:

- Checkout page.
- Address selection.
- Address creation.
- Order summary.
- Shop-specific delivery fee display.
- COD selection.
- Final order confirmation.

### Mobile

Implement the same customer checkout rules in Flutter.

Maintain consistent pricing and order information between web and mobile.

### Shared packages

Reuse shared checkout, address, and order contracts.

The backend remains authoritative for checkout calculations and validation.

### Boundaries

Do not implement:

- Online payments.
- Payment gateways.
- Wallets.
- Centralized delivery services.
- Advanced order tracking.
- Notification delivery infrastructure.

These belong to later specifications.

### Documentation

Update `context/progress-tracker.md` after implementation.

## Verification Checklist

- [ ] Checkout requires authentication.
- [ ] A customer can select a saved address.
- [ ] A customer can create an address during checkout.
- [ ] GPS is optional and requires permission.
- [ ] One checkout supports products from multiple shops.
- [ ] Separate seller orders are created under one checkout.
- [ ] Each seller order starts as `PENDING`.
- [ ] Sellers can only access their own orders.
- [ ] COD is the only payment method.
- [ ] Delivery fees are calculated separately per shop.
- [ ] The backend calculates all final totals.
- [ ] Stock and prices are revalidated before order creation.
- [ ] Concurrent checkout requests cannot oversell stock.
- [ ] Repeated submissions cannot create duplicate orders.
- [ ] Database failures do not leave partially created checkouts.
- [ ] Successful checkout returns a clear confirmation.
- [ ] Cart handling is consistent after checkout.
- [ ] French, Arabic, and RTL are supported.
- [ ] Web and mobile follow the same business rules.
- [ ] Relevant tests and project quality checks pass.