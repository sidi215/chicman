# 07 — Product Management

## Goal

Allow approved sellers to create, manage, publish, update, and deactivate their products through the seller dashboard.

Customers must only see products that are published, not archived, and associated with an approved shop. A published product whose stock reaches zero stays visible and is shown as unavailable; it cannot be purchased until stock is replenished.

This feature covers product information, product images, variants, pricing, and stock management. It does not cover customer browsing, shopping carts, or checkout.

## Design & Architecture Decisions

### 1. Product ownership

- Every product belongs to exactly one shop.
- A product must have a valid `shopId`.
- The backend derives ownership from the authenticated user and their shop.
- Sellers cannot create or modify products belonging to another shop.
- Only owners of approved shops can perform normal product-management operations.

### 2. Product information

A product should support:

- Product name.
- Description.
- Category.
- Brand (optional).
- Price in MRU.
- Product images.
- Variants.
- Stock quantity.
- Product status.
- Creation and update timestamps.

Prices must use an appropriate precise monetary representation. Do not use floating-point arithmetic for financial calculations.

### 3. Product categories

Initially support only:

- Clothing.
- Shoes.
- Fashion accessories.

Products must belong to one valid category.

Do not introduce unrelated marketplace categories.

### 4. Product variants

Products may have variants such as:

- Size.
- Color.

Each variant must have its own identifier and stock quantity.

A product without variants can have stock managed directly at product level.

Do not assume every product must have both size and color.

### 5. Product images

Reuse the existing S3-compatible storage architecture.

- Support JPEG, PNG, and WebP.
- Uploaded original: at most 15 MB and 64 megapixels, so phone photographs can reach the server.
- Published image: at most 2 MB and 1024 × 1024. Larger images within the upload limits are reduced, keeping their proportions.
- The server normalizes every image: upright orientation, resized when needed, re-encoded in the same format, with all metadata removed (EXIF including GPS coordinates and device information, XMP, IPTC, ICC profiles).
- Only the normalized image becomes public, never the uploaded file.
- Validation and metadata removal are authoritative on the server. Client-side processing is never a security boundary.
- SVG is prohibited.
- Use presigned uploads.
- Verify actual file content on the backend.
- Never trust client-provided MIME types or extensions.
- Do not save temporary presigned URLs.
- Never overwrite another product's image object.

Keep product-image upload behavior consistent with the shop-logo upload security and recovery rules. Shop logos use the same normalizer with their own limits and error codes (`feature-specs/06-shop-management.md`).

### 6. Product lifecycle

Use explicit product states:

- `DRAFT`: product is not publicly visible.
- `PUBLISHED`: product is publicly visible when all publication conditions are satisfied.
- `ARCHIVED`: product is no longer offered for sale. It stays excluded from public listings and purchasing, and can be restored.

A seller must not publish products while their shop is not `APPROVED`.

Publishing requires at least one valid image. Zero stock does not prevent publication.

Archiving is reversible. Restoring moves an `ARCHIVED` product to `DRAFT`, preserves its information, images, variants, and stock, and never publishes it: the seller publishes it again under the normal rules. Restoring requires the same authorization and shop ownership as every other operation.

Archiving must not delete historical order information.

### 7. Stock management

- Sellers can update stock.
- Stock cannot be negative.
- Stock must be associated with the correct product or variant.
- A product is unavailable when its relevant stock is zero.
- Availability is separate from publication: it is derived from current stock, so a product becomes purchasable again when stock is replenished, without republishing.
- A variant is unavailable when its own stock is zero, and an unavailable variant cannot be purchased.
- Stock must eventually be reserved and adjusted safely during checkout and order processing.

Do not implement checkout stock reservation in this feature.

### 8. Seller interface

The seller dashboard should provide:

- Product list.
- Product creation form.
- Product editing form.
- Product details.
- Image management.
- Variant management.
- Stock management.
- Publish, archive, and restore actions.
- Clear messages for the publication requirements (an image is required; zero stock is allowed) and for the unavailable state.

Follow the existing Chicman design system and shared design tokens.

Support French and Arabic, including RTL layouts.

## Implementation Details

### Backend

Inspect the existing API architecture before implementation.

Implement the necessary:

- Product data model.
- Product variant model.
- Product image metadata model.
- Product validation schemas.
- Product services.
- Product controllers and routes.
- Product ownership and shop-status authorization.
- Stock update operations.

Use Prisma and PostgreSQL.

### API boundaries

Provide seller operations for:

- Creating a product.
- Listing products belonging to the seller's shop.
- Reading a product.
- Updating product information.
- Managing product images.
- Managing variants.
- Updating stock.
- Publishing a product.
- Archiving a product.
- Restoring an archived product.

Never trust a client-provided owner ID or shop ownership claim.

### Web

Implement seller-facing product-management pages and reusable components using the existing Next.js, Tailwind, and shadcn/ui architecture.

### Shared packages

Reuse shared types, validation schemas, and design tokens where appropriate.

### Documentation

Update `context/progress-tracker.md` after implementation.

Do not implement customer discovery, cart, checkout, or order processing here.

## Verification Checklist

- [x] Only approved shop owners can manage products.
- [x] A seller cannot access another seller's products.
- [x] Product categories are restricted to the three supported categories.
- [x] Product prices are validated and stored precisely.
- [x] Product variants can be managed independently.
- [x] Stock cannot become negative.
- [x] Product images follow the upload security rules.
- [x] Oversized photographs are resized to at most 1024 × 1024 in their permitted format, with acceptable quality.
- [x] EXIF metadata, including GPS coordinates and device information, is removed on the server.
- [x] The public object is the normalized image, not the uploaded file.
- [x] Verification, immutable objects, retries, recovery, and cleanup still hold with normalization.
- [x] Shop logo processing is unchanged.
- [x] Draft products are not publicly visible.
- [x] Only eligible published products are publicly visible.
- [x] Archiving does not delete historical records.
- [x] Restoring returns an archived product to `DRAFT`, preserves its data, and does not publish it.
- [x] Only the approved owner can restore a product; archived products stay out of public listings.
- [x] Publishing requires at least one image; zero stock does not block it.
- [x] A published product at zero stock stays eligible for public listing and is marked unavailable, and becomes available again when replenished, without republishing.
- [x] French and Arabic interfaces work correctly.
- [x] RTL layouts are supported.
- [x] Backend authorization and validation are tested.
- [x] Existing build, typecheck, lint, and relevant tests pass.

Verification notes:

- **Public visibility:** no public product route exists yet (spec 08). The rule is the single filter `PUBLIC_PRODUCT_WHERE`, tested against PostgreSQL; spec 08 must use it.
- **Purchasing:** no cart or checkout exists yet, so "cannot be purchased" is not enforced by any route today. This feature supplies the availability data (`available` on products and variants); enforcement belongs to specs 08 (no purchase action), 09, and 10 (server-side stock validation).
- **French and Arabic:** the UI has no runtime language switch yet (i18n feature). Arabic and RTL were checked in a browser by temporarily setting `DEFAULT_LOCALE` to `ar`.
- **Browser checks** used the real API, the test database, and local SeaweedFS with a test-signed session, not a hosted Supabase sign-in. Cloudflare R2 was not exercised for product images (same adapter as logos, which were verified on R2).

## Implementation Notes

Implementation decisions.

- **Publication conditions:** `DRAFT` → `PUBLISHED` needs an `APPROVED` shop and at least one image (spec 08 shows a main image on every card). Images in this list have passed content verification. A published product keeps at least one image (`409 PRODUCT_LAST_IMAGE_REQUIRED`). Zero stock does not block publication.
- **Visibility:** `PUBLISHED`, shop `APPROVED`, and an active image. A suspended shop's products keep their status and disappear through the filter; reinstatement brings them back. An out-of-stock published product stays visible and is marked unavailable. Availability has one definition, `modules/inventory/availability.ts`, derived from current stock on each read and kept out of the visibility filter.
- **Transitions:** only `DRAFT` → `PUBLISHED`, `DRAFT` → `ARCHIVED`, `PUBLISHED` → `ARCHIVED`, and `ARCHIVED` → `DRAFT` (`POST /sellers/me/products/:productId/restore`). Any other transition returns `409 PRODUCT_STATUS_CONFLICT`. An archived product is read-only until restored. There is no unpublish and no delete route.
- **Restore:** clears `archivedAt` and keeps `publishedAt` as the last publication (the page hides it on a draft; publishing again replaces it). It takes the same shop and product locks as other writes, so a suspended shop cannot restore.
- **Money:** `DECIMAL(12, 2)`; the API accepts and returns decimal strings only (`"1500.50"`), so JSON numbers are refused. Variants have no price of their own.
- **Stock:** `{ stock, expectedStock }` is a compare-and-set under the product row lock (`409 PRODUCT_STOCK_CONFLICT`), so a stale screen cannot overwrite a newer value. Limit 1,000,000; negative values are refused by validation and by a database constraint.
- **Stock with variants:** the first variant clears the product's own stock (the form warns first), and from then on the stock is the sum of the variants. Removing the last variant returns the product to its own stock at zero.
- **Variants:** a size, a color, or both; unique per product ignoring case (expression index). Removing a variant deletes its row, so **orders (spec 10) must snapshot variant details**.
- **Locks:** every write takes the shop row `FOR SHARE` (re-checking `APPROVED`), then the product row `FOR UPDATE`.
- **Images:** the logo flow's rules (staging bucket, signature checks, lease and fencing, recovery, reconciliation) in `ProductImageService` and `runProductImageCleanup`, with its own tables and error codes. `ProductImage` stores the object key and the metadata of the normalized image, never a URL. Keys are `product-images/<shopId>/<productId>/<uploadId>/<imageId>.<ext>`.
- **Normalization (`modules/media/image-normalizer.ts`, shared with shop logos; `images/image-normalizer.ts` holds the product limits and error codes):** every image is re-encoded on every attempt, including small ones, with sharp. The signature must match the declared type; the pixel count is read from the header and refused above the limit before decoding. Pixels go through a raw buffer, which removes metadata and any appended data, and the result is checked again before it can be published. Quality starts at JPEG 85 and WebP 82 and steps down, and PNG falls back to a palette, only when needed to fit 2 MB. Colours are converted to sRGB. Only the first frame of an animated image is kept. Two uploads per API process, across product images and logos, are read and normalized at once, which bounds memory. A database check keeps stored images within 2 MB and 1024 × 1024.
- **Rejection codes:** `PRODUCT_IMAGE_TOO_LARGE` means over 15 MB, or an output that cannot fit 2 MB; `PRODUCT_IMAGE_TOO_LARGE_DIMENSIONS` means over 64 megapixels.
- **Limits the spec does not set:** 10 images and 100 variants per product; name 150, description 5000, brand 100, size 30, color 50 characters; writes 300 per user and 600 per IP per 10 minutes; upload requests 60 per user and 120 per IP per 10 minutes.
- **Module boundary:** stock operations are in `modules/inventory/`; their routes are mounted with the product routes under `/api/v1/sellers/me/products`.
- **Mobile:** Flutter seller screens are not part of this feature. Mobile seller management is a future feature that reuses these API routes; it has no spec yet.
- **Not built:** Meilisearch indexing (spec 08 boundary) and an audit history of product changes.
