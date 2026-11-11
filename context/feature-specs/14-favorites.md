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

- [x] An authenticated customer can add a product to favorites.
- [x] Repeated add requests do not create duplicates.
- [x] A customer can remove a favorite.
- [x] A customer cannot view or modify another customer's favorites.
- [x] Favorites persist across web and mobile sessions. *(Automated: server-held list read again under a new session, and both clients read the same API. A real account on a web browser and an Android device is not verified.)*
- [x] Unavailable or archived products are represented safely.
- [x] Favorite actions do not change cart contents.
- [x] Empty, loading, and error states work in French and Arabic. *(Automated: web message parity tests; Flutter widget tests in both languages, including RTL. Not checked by eye in a browser.)*
- [x] API, web, and mobile tests cover the supported workflows.

## Implementation Notes (2026-11-10)

### Decisions the spec left open

- **Hidden products (O9 / audit C11):** follows the audit's recommendation, which applies this spec's own rule ("use the existing public product visibility rules"). A product that is no longer public (archived, unpublished, no active image, or its shop not `APPROVED`) is returned with `state: "UNAVAILABLE"`, its name and image only, and `product: null`: no price, no shop, no link, and no reason. Favorites keep no price snapshot. The project owner should confirm this; it is recorded in `progress-tracker.md`.
- **Adding:** only a publicly visible product can become a new favorite. Hidden and unknown products give the same `404 PRODUCT_NOT_FOUND` as the catalog and the cart. Sold-out public products can be added (`state: "SOLD_OUT"`).
- **Routes:** `GET /api/v1/customers/me/favorites`, `PUT /…/favorites/:productId` (add), `DELETE /…/favorites/:productId` (remove). No body: the product is in the path, the owner comes from the verified token (`guards.user`). Every route answers `200` with the whole list (`FavoriteList`), most recently added first. Writes are rate-limited per user and IP (`favorite-write`: 300 / 600 per 10 minutes, like the cart).
- **Safe repeats:** `PUT` of a product already in the list succeeds and changes nothing (its date is kept), even if the product has since been hidden. `DELETE` of a product not in the list succeeds. A malformed ID is `404 PRODUCT_NOT_FOUND`.
- **Limit:** at most `FAVORITES_MAX_ITEMS` = 200 per customer (`409 FAVORITE_LIMIT_REACHED`), so every read is bounded. Additions for one customer are serialized by a row lock on `User` (`FOR NO KEY UPDATE`), so the limit holds under concurrent requests; the unique pair prevents duplicates regardless.
- **Data model:** `Favorite` (`userId`, `productId`, `createdAt`), unique `(userId, productId)`, `RESTRICT` on both foreign keys (products are never hard-deleted, as for cart lines). Migration `20261110180000_favorites`.
- **Response shape:** `FavoriteItem` = `productId`, `addedAt`, `name`, `imageUrl` (`null` only when hidden), `state` (`AVAILABLE` / `SOLD_OUT` / `UNAVAILABLE`), and `product` (the catalog's `PublicProductSummary`, from the same mapping function `toPublicProductSummary`, now exported from `catalog.service.ts`). No stock figure.
- **Cart:** favorites never write the cart. Buying goes through the product page and the existing cart route, which still refuses hidden products.
- **Web:** `FavoritesProvider` (same pattern and account-change guard as `CartProvider`) in the storefront layout; a heart on every product card (beside the card link, not inside it) and on the product page; a heart link in the header; the `/favorites` page (one URL, follows the language cookie like `/cart`). Guests and accounts without setup are sent to sign in or finish their account.
- **Mobile:** `favoritesProvider` (same pattern as `cartProvider`); a heart on product cards and the product page; a **Favorites dock destination** between Home and Account, which reads the list again each time it is opened.

