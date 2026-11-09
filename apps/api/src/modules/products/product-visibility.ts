import type { Prisma } from "../../generated/prisma/client.js";

/**
 * The single definition of a publicly visible product (spec 07, spec 08):
 * `PUBLISHED`, in an `APPROVED` shop, with at least one image to display.
 * Every public query (`catalog.service.ts`) filters with this, so a suspended
 * shop's products disappear without changing their status.
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

/**
 * `PUBLIC_PRODUCT_WHERE` for a product already loaded, naming the first condition
 * it fails. Keep the two together: this is the same rule, not a second one.
 */
export type ProductVisibility = "PUBLIC" | "SHOP_NOT_APPROVED" | "ARCHIVED" | "NOT_PUBLISHED";

export function productVisibility(product: { status: string; shopStatus: string; hasActiveImage: boolean }): ProductVisibility {
  if (product.shopStatus !== PUBLIC_PRODUCT_WHERE.shop.status) return "SHOP_NOT_APPROVED";
  if (product.status === "ARCHIVED") return "ARCHIVED";
  if (product.status !== PUBLIC_PRODUCT_WHERE.status || !product.hasActiveImage) return "NOT_PUBLISHED";
  return "PUBLIC";
}
