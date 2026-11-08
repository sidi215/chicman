import type { Prisma } from "../../generated/prisma/client.js";

/**
 * The single definition of a publicly visible product (spec 07, spec 08):
 * `PUBLISHED`, in an `APPROVED` shop, with at least one image to display.
 * No public route exists yet; product discovery (spec 08) must filter with
 * this, so a suspended shop's products disappear without changing their status.
 *
 * Stock is deliberately not part of it: a published product with no stock
 * stays visible and is identified as unavailable. Availability is applied
 * separately (`modules/inventory/availability.ts`). Purchasing is refused by
 * stock validation in the cart and checkout (specs 09 and 10).
 */
export const PUBLIC_PRODUCT_WHERE = {
  status: "PUBLISHED",
  shop: { status: "APPROVED" },
  images: { some: { status: "ACTIVE" } },
} as const satisfies Prisma.ProductWhereInput;
