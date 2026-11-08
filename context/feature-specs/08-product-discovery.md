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

- [x] Customers can browse without authentication.
- [x] Only published products from approved shops are visible.
- [x] Suspended-shop products are excluded.
- [x] Category filtering works.
- [x] Price filtering works.
- [x] Size and color filtering work where applicable.
- [x] Sorting works correctly.
- [x] Pagination works with filters and sorting.
- [x] Product details display correct information.
- [x] Unavailable products are clearly identified.
- [x] Published products at zero stock stay visible and return to available when replenished, without republishing.
- [x] Unavailable products and variants offer no purchase action. (No purchase action exists yet; specs 09 and 10 add it and must keep this rule.)
- [x] Public queries use `PUBLIC_PRODUCT_WHERE`, and availability is applied separately.
- [x] Archived products stay hidden, and restored products stay hidden until published again.
- [x] Product visibility is enforced by the backend.
- [x] French and Arabic are supported. (The web has a language switch; web and mobile follow the profile language once it is known.)
- [x] RTL layouts work correctly. (Web in a browser; Flutter by widget tests and rendered screens, not yet on a device.)
- [x] Web and mobile use consistent API contracts.
- [x] Relevant tests and project quality checks pass.

## Implementation Notes

Decisions the spec left open (2026-11-08):

- **Routes:** `GET /api/v1/products`, `GET /api/v1/products/facets`, and `GET /api/v1/products/:productId` (`modules/products/catalog.*`), with no authentication guard. A category listing is `GET /products?category=…`. Unknown and hidden products give the same `404 PRODUCT_NOT_FOUND`.
- **Query:** `category`, `minPrice`, `maxPrice`, `availability=available`, `size`, `color`, `sort` (`newest`, `price_asc`, `price_desc`), `page`, `pageSize` (default 20, maximum 50). Strict: an unknown parameter is `400`. A later search parameter is added to the same schema.
- **Filter meaning:** price bounds are inclusive and decimal. `size` and `color` ignore case and match the whole value (`%` and `_` are escaped, because Prisma runs this as `ILIKE`). Together they must match one variant, and with `availability` that variant must be in stock.
- **Newest** means by `publishedAt`, so a republished product counts as new. The product ID breaks ties, so pages stay stable.
- **Facets (added):** the filter chips need the sizes and colors that exist, because sellers type them freely. The endpoint returns public values only, once each ignoring case, per category, up to 100 distinct values per attribute.
- **Public data:** availability is a state; stock quantities stay private. Public shop fields are name, description, city, and logo; contact phones, the address, and the owner are never loaded.
- **Rate limit (added):** 3000 requests per customer address per 10 minutes, generous because mobile customers can share a carrier address. The web server calls these routes while rendering pages, so it passes the customer's address with a shared key (`CATALOG_INTERNAL_KEY`); the API ignores that address without the key, and counts by `req.ip` as usual.
- **Product cards:** none existed, so one was created on each platform. It shows exactly the spec's fields; the Shop button, favorite heart, and rating from `ui-context.md` wait for their features.
- **Product details:** size and color are chosen separately. Unavailable values stay selectable and are marked, and the page states whether the choice is available, unavailable, or a combination not sold.
- **Web:** the listing's state lives in the URL with the API's parameter names; an invalid parameter is ignored rather than failing the page. Home, listing, and product pages are server-rendered from the API on every request, without a cache, so hidden products and stock changes show at once. Only the filter chips' sizes and colors are read from the browser.
- **SEO (added 2026-11-08):** product name, price, description, and JSON-LD are in the response HTML, with a title, description, Open Graph tags, a canonical URL, and `hreflang` links. Filtered and sorted listings are canonical to their category's page. A missing product answers a real `404`, checked in `proxy.ts` on full page loads. A failed load answers `200` with `noindex` on product and listing pages. `robots.txt` and the sitemap open once a public domain is configured; see `architecture.md`, Server-Rendered Storefront.
- **Language (added 2026-11-08):** routing is described in `architecture.md`, Web Localization.
- **Mobile:** the app now opens on the public storefront (`AppShell`, dock with Home and Account). `AuthGate` stays mounted to receive email links, which open the Account tab, but it builds no login screen (and no Turnstile WebView) until shown. Listings use previous and next pages, like the web.
- **Not built:** database indexes for price sorting and variant filters (no migration); they can follow real catalog sizes. A dedicated shop page, because the spec lists no shop route.