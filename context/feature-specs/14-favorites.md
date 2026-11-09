# 14 — Favorites

## Goal

Allow authenticated customers to save products they are interested in and manage a personal favorites list across web and mobile.

## Design & Architecture Decisions

- Favorites belong to the authenticated customer.
- Guests may browse products but cannot persist favorites to an account.
- A customer can add or remove a product from favorites.
- A customer cannot create duplicate favorite entries for the same product.
- Favorites must reference existing products.
- Archived, unpublished, or unavailable products must not become purchasable simply because they remain in a favorites list.
- Show the current product availability and price when displaying favorites.
- Removing a product from favorites must not delete the product.
- Product deletion or archival behavior must be consistent with the existing product lifecycle and referential-integrity rules.
- Favorites are separate from the shopping cart. Adding a favorite must not automatically add it to the cart.
- Synchronize the same account's favorites across web and mobile.
- Respect the existing French/Arabic localization and RTL requirements.

## Implementation Details

Inspect the existing customer authentication, product, and shared API patterns.

Likely areas:
- `apps/api/src/` — favorites routes, service, validation, and authorization.
- Prisma schema and migrations — customer-product favorite relationship with a unique constraint.
- `apps/web/` — favorite controls and customer favorites page.
- `apps/mobile/` — favorite controls and favorites screen.
- `packages/shared/` — favorite contracts and types.
- `context/progress-tracker.md`.

Requirements:
- Provide authenticated operations to list, add, and remove favorites.
- Derive the customer identity from the verified authenticated context.
- Never accept another customer's ID as an authorization source.
- Make add/remove operations safe under repeated requests.
- Return current product information using the existing public product visibility rules.
- Use consistent loading, empty, error, and unavailable-product states.
- Do not build product discovery or cart functionality again.

## Verification Checklist

- [ ] An authenticated customer can add a product to favorites.
- [ ] Repeated add requests do not create duplicates.
- [ ] A customer can remove a favorite.
- [ ] A customer cannot view or modify another customer's favorites.
- [ ] Favorites persist across web and mobile sessions.
- [ ] Unavailable or archived products are represented safely.
- [ ] Favorite actions do not change cart contents.
- [ ] Empty, loading, and error states work in French and Arabic.
- [ ] API, web, and mobile tests cover the supported workflows.

