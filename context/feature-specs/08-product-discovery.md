# 08 — Product Discovery

## Goal

Allow customers to discover products across all approved shops through a public storefront.

Customers must be able to browse categories, view product listings, filter results, sort products, and inspect product details without creating an account.

Authentication is required only when the customer proceeds to checkout.

This feature covers product browsing and product details. It does not cover shopping carts, checkout, or advanced search infrastructure.

## Design & Architecture Decisions

### 1. Public storefront

The storefront is publicly accessible.

Customers can:

- Browse products.
- Browse categories.
- View product details.
- View shop information.
- Navigate between product listings.

Do not require login to access the storefront.

### 2. Product visibility

Only products satisfying all these conditions can appear publicly:

- Product status is `PUBLISHED`.
- The associated shop status is `APPROVED`.
- The product is valid and available for public display.

Draft, archived, and products from pending, rejected, or suspended shops must not appear.

Visibility is implemented only by the tested `PUBLIC_PRODUCT_WHERE` filter from feature 07 (`apps/api/src/modules/products/product-visibility.ts`). Do not write a second definition.

Availability is applied separately from visibility, using `apps/api/src/modules/inventory/availability.ts`:

- A published product at zero stock stays visible and shows a clear unavailable state.
- It becomes available again when stock is replenished, without republishing.
- A restored product is a draft and stays hidden until the seller publishes it again.

### 3. Categories

Support only:

- Clothing.
- Shoes.
- Fashion accessories.

Category navigation must be simple and easy to understand.

### 4. Product listing

Each product card should display:

- Main product image.
- Product name.
- Price in MRU.
- Shop name.
- Availability indicator where relevant.

Product cards must be reusable across the storefront.

### 5. Filtering

Support relevant filters:

- Category.
- Minimum price.
- Maximum price.
- Availability.
- Size, when applicable.
- Color, when applicable.

Filters must only use attributes supported by the product model.

### 6. Sorting

Support:

- Newest products.
- Price: lowest to highest.
- Price: highest to lowest.

Do not invent popularity or review-based ranking before those systems exist.

### 7. Pagination

Use server-side pagination.

Avoid loading the entire product catalog into the browser.

Pagination must remain consistent when filters and sorting are applied.

### 8. Product details

The product details page should display:

- Product name.
- Description.
- Images.
- Price.
- Available variants.
- Current stock availability.
- Shop name.
- Relevant shop information.

The customer must be able to identify the selected size and color where applicable.

Unavailable products and variants are shown as unavailable and must not offer a purchase action. Server-side enforcement belongs to the cart and checkout (specs 09 and 10).

### 9. Localization

- Support French and Arabic.
- Support RTL layouts.
- Display prices in MRU.
- Use localized product-category labels.
- Product content must be displayed in the language supplied by the seller; do not automatically translate seller descriptions.

### 10. Search boundary

This specification covers browsing, filtering, sorting, and product details.

Do not implement a separate Meilisearch integration or advanced full-text search system here. Keep the API compatible with adding search later.

## Implementation Details

### Backend

Implement public product discovery endpoints for:

- Listing public products.
- Filtering products.
- Sorting products.
- Paginating results.
- Listing products by category.
- Reading public product details.

Ensure that visibility restrictions are enforced server-side.

Never rely on the frontend to hide unpublished or suspended-shop products.

Filter every public query with `PUBLIC_PRODUCT_WHERE`. Do not filter out-of-stock products by default; the availability filter is an explicit customer choice.

### Web

Implement:

- Storefront homepage product sections.
- Category navigation.
- Product listing pages.
- Filter controls.
- Sorting controls.
- Pagination.
- Product detail pages.

Reuse the existing product-card and shared UI components.

### Mobile

Implement customer-facing product discovery screens in Flutter.

Keep the web and mobile customer experience consistent in terms of product information and business rules.

### Shared packages

Reuse shared API contracts and product types.

Avoid duplicating business rules between web, mobile, and backend.

### Documentation

Update `context/progress-tracker.md` after implementation.

Do not implement cart, checkout, orders, favorites, or advanced search infrastructure.

## Verification Checklist

- [ ] Customers can browse without authentication.
- [ ] Only published products from approved shops are visible.
- [ ] Suspended-shop products are excluded.
- [ ] Category filtering works.
- [ ] Price filtering works.
- [ ] Size and color filtering work where applicable.
- [ ] Sorting works correctly.
- [ ] Pagination works with filters and sorting.
- [ ] Product details display correct information.
- [ ] Unavailable products are clearly identified.
- [ ] Published products at zero stock stay visible and return to available when replenished, without republishing.
- [ ] Unavailable products and variants offer no purchase action.
- [ ] Public queries use `PUBLIC_PRODUCT_WHERE`, and availability is applied separately.
- [ ] Archived products stay hidden, and restored products stay hidden until published again.
- [ ] Product visibility is enforced by the backend.
- [ ] French and Arabic are supported.
- [ ] RTL layouts work correctly.
- [ ] Web and mobile use consistent API contracts.
- [ ] Relevant tests and project quality checks pass.